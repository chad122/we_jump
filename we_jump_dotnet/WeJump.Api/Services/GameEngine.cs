using WeJump.Api.Data;
using WeJump.Api.Models;
using WeJump.Api.Utils;

namespace WeJump.Api.Services;

/// <summary>
/// 单房间对局引擎：实时模式（无回合等待）。
/// - 3-2-1 倒计时结束后，所有玩家可各自随时蓄力松手，互不等待；
/// - 服务端每收到一次 Jump 即权威结算该玩家落点/出界/抵达，并立即广播 PlayerMove；
/// - 首名抵达触发“冠军倒计时 10s”（模式A）；整局超时触发地图超时结束（模式B）；
/// - 结束后结算名次并落库。
/// 说明：出界判定采用“当前段安全步数 d”模型 —— 直线跳跃超过 d（越过拐弯/终点所在直线段）即飞出边界回起点。
/// </summary>
public sealed class GameEngine
{
    /// <summary>服务端允许的最小跳跃间隔(ms)：防止“连点小跳”刷进度；客户端用 700ms，正常操作不会被拒。</summary>
    private const double JumpCooldownMs = 500;
    /// <summary>冠军产生后的收尾倒计时（秒）。</summary>
    private const int ChampionCountdownSeconds = 10;

    private readonly Room _room;
    private readonly Db _db;
    private readonly GameMap _map;
    private readonly object _lock = new();
    private readonly DateTime _createdAt = DateTime.UtcNow;
    private readonly Dictionary<int, DateTime> _lastJumpAt = new(); // seat -> 最近一次跳跃时间

    private bool _live;                 // 倒计时结束、进入可跳跃状态
    private DateTime _gameStartUtc;
    private long _startTs;
    private int _arrivalCounter;
    private DateTime? _championDeadline;
    private int _championSeat = -1;
    private string _championNickname = "";
    private bool _championNotified;
    private EndReason _reason = EndReason.None;
    private Task? _runTask;

    public GameEngine(Room room, Db db)
    {
        _room = room;
        _db = db;
        _map = room.Map;
    }

    public void Start()
    {
        _runTask = Task.Run(RunAsync);
    }

    /// <summary>接收玩家的一次跳跃上报（elapsedMs=本次蓄力时长）。返回 false 表示不接受（未开始/已抵达/离线/间隔过短）。</summary>
    public bool SubmitJump(int seat, double elapsedMs)
    {
        object movePayload;
        object? championPayload = null;

        lock (_lock)
        {
            if (!_live || _room.Phase != RoomPhase.Playing) return false;
            var p = _room.FindBySeat(seat);
            if (p == null || !p.Online || p.Finished) return false;

            var now = DateTime.UtcNow;
            if (_lastJumpAt.TryGetValue(seat, out var last) &&
                (now - last).TotalMilliseconds < JumpCooldownMs) return false;
            _lastJumpAt[seat] = now;

            var path = _map.Path;
            int total = path.Count;
            int from = p.Index;
            // 蓄力上限固定为单跳最大格数：临近终点不再按剩余距离收窄，蓄力过头即飞出边界
            int steps = Math.Max(1, Math.Min(Charge.StepsForMs(elapsedMs), Charge.MaxStep));
            int safe = SegmentSafe(from);

            bool isOut = false, isFinish = false;
            int rank = 0;
            int index = from;

            if (steps > safe)
            {
                // 直线跳跃越过本直线段（拐弯/终点所在边界）→ 飞出，回起点
                isOut = true;
                index = 0;
                p.OutCount++;
            }
            else
            {
                index = from + steps;
                if (index == total - 1)
                {
                    isFinish = true;
                    p.Finished = true;
                    _arrivalCounter++;
                    p.ArrivalOrder = _arrivalCounter;
                    rank = p.ArrivalOrder;
                    if (_championDeadline == null)
                    {
                        _championSeat = p.Seat;
                        _championNickname = p.Nickname;
                        _championDeadline = now.AddSeconds(ChampionCountdownSeconds);
                        _championNotified = false;
                    }
                }
            }

            p.Index = index;
            p.JumpCount++;

            movePayload = new
            {
                seat = p.Seat,
                from,
                steps = isOut ? steps : index - from,
                index,
                isOut,
                isFinish,
                rank
            };

            if (_championDeadline != null && !_championNotified)
            {
                _championNotified = true;
                championPayload = new
                {
                    championSeat = _championSeat,
                    nickname = _championNickname,
                    deadlineTs = new DateTimeOffset(_championDeadline.Value).ToUnixTimeMilliseconds()
                };
            }
        }

        _room.Broadcast(Msg.PlayerMove, movePayload);
        if (championPayload != null) _room.Broadcast(Msg.Champion, championPayload);
        return true;
    }

    private async Task RunAsync()
    {
        try
        {
            foreach (var p in _room.Players) Reset(p);

            _startTs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            _gameStartUtc = DateTime.UtcNow;
            BroadcastGameStart();

            // 3-2-1 倒计时；n=0 表示“开始”，此后玩家可各自自由跳跃
            for (int n = 3; n >= 1; n--)
            {
                if (_room.Aborted) return;
                _room.Broadcast(Msg.Countdown, new { n });
                await Task.Delay(1000);
            }
            if (_room.Aborted) return;

            _live = true;
            _room.Broadcast(Msg.Countdown, new { n = 0 });

            while (true)
            {
                if (_room.Aborted) return;
                if (EvaluateEnd())
                {
                    await FinalizeAsync();
                    return;
                }
                await Task.Delay(200);
            }
        }
        catch (Exception ex)
        {
            _room.Broadcast(Msg.Error, new { code = "server_error", msg = ex.Message });
            try { await FinalizeAsync(); } catch { /* 落库失败不阻塞 */ }
        }
    }

    private void Reset(RoomPlayer p)
    {
        p.Index = 0;
        p.Finished = false;
        p.JumpCount = 0;
        p.OutCount = 0;
        p.ArrivalOrder = 0;
        p.FinalRank = 0;
    }

    private void BroadcastGameStart()
        => _room.Broadcast(Msg.GameStart, BuildStateData());

    /// <summary>断线重连时，把当前对局状态快照单独发给该连接。</summary>
    public void SendSnapshotTo(WsSession session)
        => session.TrySend(WsJson.Msg(Msg.GameState, BuildStateData()));

    /// <summary>对局状态快照：game_start 与 game_state 同构，客户端复用同一套同步逻辑。</summary>
    private object BuildStateData()
    {
        long? championDeadline = _championDeadline is DateTime cd
            ? new DateTimeOffset(cd).ToUnixTimeMilliseconds()
            : (long?)null;

        return new
        {
            mapId = _map.Id,
            mapName = _map.Name,
            durationSeconds = _map.DurationSeconds,
            startTs = _startTs,
            // 蓄力参数由服务端权威下发，避免两端常量不一致导致“显示的步数”与“结算步数”对不上
            maxStep = Charge.MaxStep,
            firstCellMs = Charge.FirstCellMs,
            ratio = Charge.Ratio,
            championSeat = _championSeat,
            championName = _championNickname,
            championDeadline,
            players = _room.Players.Select(p => new
            {
                seat = p.Seat,
                nickname = p.Nickname,
                avatarUrl = p.AvatarUrl,
                index = p.Index,
                finished = p.Finished,
                rank = p.ArrivalOrder
            }).ToList(),
            path = _map.Path.Select(pt => new { pt.X, pt.Y }).ToList()
        };
    }

    private bool EvaluateEnd()
    {
        if (_room.Aborted) return true;

        if (_championDeadline is DateTime cd && DateTime.UtcNow >= cd)
        {
            _reason = EndReason.ChampionCountdown;
            return true;
        }
        if (DateTime.UtcNow - _gameStartUtc >= TimeSpan.FromSeconds(_map.DurationSeconds))
        {
            _reason = EndReason.MapTimeout;
            return true;
        }

        var all = _room.Players;
        bool anyActive = all.Any(p => p.Online && !p.Finished);
        if (!anyActive)
        {
            _reason = all.Any(p => p.Finished) ? EndReason.ChampionCountdown : EndReason.MapTimeout;
            return true;
        }
        return false;
    }

    /// <summary>当前格到“下一方向变化点或终点”的安全步数（含可直跳到达的拐弯格，不含拐弯后的格）。</summary>
    private int SegmentSafe(int index)
    {
        var path = _map.Path;
        int n = path.Count;
        if (index >= n - 1) return 0;
        int dx = path[index + 1].X - path[index].X;
        int dy = path[index + 1].Y - path[index].Y;
        int steps = 0;
        for (int i = index; i < n - 1; i++)
        {
            int nx = path[i + 1].X - path[i].X;
            int ny = path[i + 1].Y - path[i].Y;
            if (nx != dx || ny != dy) break;
            steps++;
        }
        return steps;
    }

    private async Task FinalizeAsync()
    {
        var all = _room.Players;

        // 名次：已抵达按到达次序，未抵达按当前格数倒序
        var ordered = all
            .OrderByDescending(p => p.Finished)
            .ThenBy(p => p.Finished ? p.ArrivalOrder : int.MaxValue)
            .ThenByDescending(p => p.Index)
            .ToList();
        for (int i = 0; i < ordered.Count; i++) ordered[i].FinalRank = i + 1;

        var ranks = ordered.Select(p => new
        {
            seat = p.Seat,
            nickname = p.Nickname,
            index = p.Index,
            finished = p.Finished,
            rank = p.FinalRank
        }).ToList();

        _room.Broadcast(Msg.GameEnd, new
        {
            reason = (int)_reason,
            reasonText = _reason == EndReason.ChampionCountdown ? "冠军产生，倒计时结束" : "本轮无人抵达终点，按进度结算",
            ranks,
            championSeat = _championSeat
        });

        // 落库（正常结束才记录）
        if (!_room.Aborted && _reason != EndReason.None)
        {
            var endedAt = DateTime.UtcNow;
            var record = new GameRecord
            {
                RoomNo = _room.RoomNo,
                MapId = _map.Id,
                MapName = _map.Name,
                EndReason = (int)_reason,
                PlayerCount = all.Count,
                StartedAt = _createdAt,
                EndedAt = endedAt,
                DurationMs = (int)(endedAt - _createdAt).TotalMilliseconds
            };
            var gameId = await _db.InsertGameRecordAsync(record);
            var results = all.Select(p => new GamePlayerResult
            {
                GameId = gameId,
                UserId = p.UserId,
                Nickname = p.Nickname,
                AvatarUrl = p.AvatarUrl,
                Seat = p.Seat,
                Rank = p.FinalRank,
                Finished = p.Finished,
                EndIndex = p.Index,
                JumpCount = p.JumpCount,
                OutCount = p.OutCount
            }).ToList();
            await _db.InsertPlayerResultsAsync(results);
        }

        _room.SetPhase(RoomPhase.Ended);
        _room.Engine = null;
    }
}
