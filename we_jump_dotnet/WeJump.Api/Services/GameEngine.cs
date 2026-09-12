using WeJump.Api.Data;
using WeJump.Api.Models;
using WeJump.Api.Utils;

namespace WeJump.Api.Services;

/// <summary>
/// 单房间对局引擎：回合(wave)驱动。
/// - 每回合向所有在线未抵达玩家下发 WaveStart（含当前格/可跳格数）；
/// - 收集各玩家 Jump/Cancel 上报，超时未上报者本回合不动；
/// - 用蓄力时长权威反推步数并结算落点/出界/抵达；
/// - 首名抵达触发“冠军倒计时 10s”（模式A）；整局超时触发地图超时结束（模式B）；
/// - 结束后结算名次并落库。
/// 说明：出界判定采用“当前段安全步数 d”模型 —— 直线跳跃超过 d（越过拐弯/终点所在直线段）即飞出边界回起点。
/// </summary>
public sealed class GameEngine
{
    private const double WaveWaitMs = 12000;  // 每回合收集窗口
    private const double WaveGapMs = 1200;    // 回合结算展示间隔

    private readonly Room _room;
    private readonly Db _db;
    private readonly GameMap _map;
    private readonly object _lock = new();
    private readonly DateTime _createdAt = DateTime.UtcNow;

    private int _seq;
    private bool _waveOpen;
    private List<int> _activeSeats = new();
    private readonly Dictionary<int, double> _reports = new(); // seat -> 蓄力时长(ms)
    private readonly HashSet<int> _reporters = new();          // 已上报（含取消）
    private DateTime _waveEndsAt;
    private int _arrivalCounter;
    private DateTime? _championDeadline;
    private int _championSeat = -1;
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

    /// <summary>接收玩家本回合跳跃上报。返回 false 表示当前不接受（未开局/回合未开/座位不符）。</summary>
    public bool SubmitJump(int seq, int seat, double elapsedMs)
    {
        lock (_lock)
        {
            if (!_waveOpen || seq != _seq) return false;
            if (!_activeSeats.Contains(seat)) return false;
            _reports[seat] = elapsedMs;
            _reporters.Add(seat);
            return true;
        }
    }

    /// <summary>接收“取消蓄力”上报：本回合原地不动但视为已响应。</summary>
    public bool SubmitCancel(int seq, int seat)
    {
        lock (_lock)
        {
            if (!_waveOpen || seq != _seq) return false;
            if (!_activeSeats.Contains(seat)) return false;
            _reporters.Add(seat);
            return true;
        }
    }

    private async Task RunAsync()
    {
        try
        {
            _room.SetPhase(RoomPhase.Playing);
            foreach (var p in _room.Players) Reset(p);

            var gameStartUtc = DateTime.UtcNow;
            BroadcastGameStart();

            // 3-2-1 倒计时
            for (int n = 3; n >= 1; n--)
            {
                if (_room.Aborted) return;
                _room.Broadcast(Msg.Countdown, new { n });
                await Task.Delay(1000);
            }
            if (_room.Aborted) return;

            while (true)
            {
                if (_room.Aborted) return;
                if (EvaluateEnd(gameStartUtc))
                {
                    await FinalizeAsync();
                    return;
                }

                var active = ActivePlayers();
                if (active.Count == 0)
                {
                    await FinalizeAsync();
                    return;
                }

                // 开回合
                int seq;
                lock (_lock)
                {
                    _seq++;
                    seq = _seq;
                    _waveOpen = true;
                    _activeSeats = active.Select(p => p.Seat).ToList();
                    _reports.Clear();
                    _reporters.Clear();
                    _waveEndsAt = DateTime.UtcNow.AddMilliseconds(WaveWaitMs);
                }

                var meta = active.Select(p => new
                {
                    seat = p.Seat,
                    index = p.Index,
                    n = AllowedN(p.Index),
                    remaining = _map.Path.Count - 1 - p.Index
                }).ToList();
                _room.Broadcast(Msg.WaveStart, new { seq, waitMs = (int)WaveWaitMs, players = meta });

                // 等待全部上报 / 超时 / 结束条件
                while (true)
                {
                    if (_room.Aborted) return;
                    if (EvaluateEnd(gameStartUtc)) break;
                    bool all;
                    lock (_lock) all = _reporters.Count >= _activeSeats.Count;
                    if (all) break;
                    if (DateTime.UtcNow >= _waveEndsAt) break;
                    await Task.Delay(150);
                }

                lock (_lock) _waveOpen = false;
                if (EvaluateEnd(gameStartUtc)) continue;

                SettleWave();

                // 回合间展示间隙，期间若触发结束则打断
                var gapEnd = DateTime.UtcNow.AddMilliseconds(WaveGapMs);
                while (DateTime.UtcNow < gapEnd)
                {
                    if (EvaluateEnd(gameStartUtc)) break;
                    await Task.Delay(150);
                }
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
    {
        var data = new
        {
            mapId = _map.Id,
            mapName = _map.Name,
            durationSeconds = _map.DurationSeconds,
            startTs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
            players = _room.Players.Select(p => new
            {
                seat = p.Seat,
                nickname = p.Nickname,
                avatarUrl = p.AvatarUrl
            }).ToList(),
            path = _map.Path.Select(pt => new { pt.X, pt.Y }).ToList()
        };
        _room.Broadcast(Msg.GameStart, data);
    }

    private List<RoomPlayer> ActivePlayers()
        => _room.Players.Where(p => !p.Finished && p.Online).ToList();

    private bool EvaluateEnd(DateTime gameStartUtc)
    {
        if (_room.Aborted) return true;

        if (_championDeadline is DateTime cd && DateTime.UtcNow >= cd)
        {
            _reason = EndReason.ChampionCountdown;
            return true;
        }
        if (DateTime.UtcNow - gameStartUtc >= TimeSpan.FromSeconds(_map.DurationSeconds))
        {
            _reason = EndReason.MapTimeout;
            return true;
        }

        var all = _room.Players;
        bool anyOnline = all.Any(p => p.Online && !p.Finished);
        if (!anyOnline)
        {
            _reason = all.Any(p => p.Finished) ? EndReason.ChampionCountdown : EndReason.MapTimeout;
            return true;
        }
        return false;
    }

    private void SettleWave()
    {
        var path = _map.Path;
        int n = path.Count;

        Dictionary<int, double> reports;
        int seq;
        lock (_lock)
        {
            reports = new Dictionary<int, double>(_reports);
            seq = _seq;
            _waveOpen = false;
        }

        var results = new List<object>();
        foreach (var seat in _activeSeats)
        {
            var p = _room.FindBySeat(seat);
            if (p == null || p.Finished) continue;
            if (!reports.TryGetValue(seat, out var elapsed)) continue; // 取消或超时：原地不动

            int from = p.Index;
            int remaining = n - 1 - from;
            int allowed = Math.Min(remaining, Charge.MaxStep);
            int steps = Math.Max(1, Math.Min(Charge.StepsForMs(elapsed), allowed));
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
                if (index == n - 1)
                {
                    isFinish = true;
                    p.Finished = true;
                    _arrivalCounter++;
                    p.ArrivalOrder = _arrivalCounter;
                    rank = p.ArrivalOrder;
                    if (_championDeadline == null)
                    {
                        _championSeat = p.Seat;
                        _championDeadline = DateTime.UtcNow.AddSeconds(10);
                    }
                }
            }

            p.Index = index;
            p.JumpCount++;

            results.Add(new
            {
                seat = p.Seat,
                from,
                steps = isOut ? steps : index - from,
                index,
                isOut,
                isFinish,
                rank
            });
        }

        _room.Broadcast(Msg.WaveResult, new { seq, results });

        if (_championDeadline != null && !_championNotified)
        {
            _championNotified = true;
            var champ = _room.FindBySeat(_championSeat);
            _room.Broadcast(Msg.Champion, new
            {
                championSeat = _championSeat,
                nickname = champ?.Nickname ?? "",
                deadlineTs = new DateTimeOffset(_championDeadline.Value).ToUnixTimeMilliseconds()
            });
        }
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

    private int AllowedN(int index)
        => Math.Min(_map.Path.Count - 1 - index, Charge.MaxStep);

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
