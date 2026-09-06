using WeJump.Api.Models;

namespace WeJump.Api.Services;

/// <summary>房间内一名成员（座位模型）。座位号从 0 递增，房主初始为 0 号。</summary>
internal sealed class RoomPlayer
{
    public int Seat { get; init; }
    public long UserId { get; init; }
    public string Nickname { get; set; } = "";
    public string AvatarUrl { get; set; } = "";
    public WsSession? Session { get; set; }   // null 表示当前离线

    // ---- 以下为“本局运行时”状态，每次开局重置 ----
    public int Index = 0;         // 当前所在格序号（0 = 起点）
    public bool Finished = false;
    public int JumpCount = 0;
    public int OutCount = 0;
    public int ArrivalOrder = 0; // 抵达终点次序（1..n），0 = 未抵达

    public bool Online => Session != null && !Session.IsClosed;

    public RoomPlayerDto ToDto() => new()
    {
        Seat = Seat,
        UserId = UserId,
        Nickname = Nickname,
        AvatarUrl = AvatarUrl,
        Online = Online
    };
}

/// <summary>房间：等待成员/选图 -> 对局中 -> 已结束（可再来一局）。所有成员状态变更均受锁保护。</summary>
public sealed class Room
{
    public const int MaxPlayers = 6;

    private readonly object _sync = new();
    private readonly Dictionary<int, RoomPlayer> _bySeat = new();
    private int _nextSeat;

    public string RoomNo { get; }
    public DateTime CreatedAt { get; }
    public GameMap Map { get; private set; } = MapCatalog.Default;
    public RoomPhase Phase { get; private set; } = RoomPhase.Waiting;
    public int HostSeat { get; private set; } = -1;
    public bool Aborted { get; internal set; }
    public GameEngine? Engine { get; internal set; }

    public Room(string roomNo)
    {
        RoomNo = roomNo;
        CreatedAt = DateTime.UtcNow;
    }

    public IReadOnlyList<RoomPlayer> Players
    {
        get { lock (_sync) return _bySeat.Values.OrderBy(p => p.Seat).ToList(); }
    }

    public RoomPlayer? FindBySeat(int seat)
    {
        lock (_sync) return _bySeat.TryGetValue(seat, out var p) ? p : null;
    }

    public RoomPlayer? FindByUser(long userId)
    {
        lock (_sync) return _bySeat.Values.FirstOrDefault(p => p.UserId == userId);
    }

    public RoomPlayer AddPlayer(WsSession session)
    {
        lock (_sync)
        {
            if (_bySeat.Count >= MaxPlayers) throw new InvalidOperationException("房间人数已满");
            int seat = _nextSeat++;
            var p = new RoomPlayer
            {
                Seat = seat,
                UserId = session.UserId,
                Nickname = session.Nickname ?? "玩家",
                AvatarUrl = session.AvatarUrl ?? "",
                Session = session
            };
            _bySeat[seat] = p;
            if (HostSeat < 0) HostSeat = seat;
            return p;
        }
    }

    public void RemovePlayer(int seat)
    {
        lock (_sync)
        {
            _bySeat.Remove(seat);
            if (HostSeat == seat || !_bySeat.ContainsKey(HostSeat))
                HostSeat = _bySeat.Count == 0 ? -1 : _bySeat.Keys.Min();
            if (_bySeat.Count == 0) Aborted = true;
        }
    }

    public void AttachSession(int seat, WsSession session)
    {
        lock (_sync)
        {
            if (_bySeat.TryGetValue(seat, out var p))
            {
                p.Session = session;
                p.Nickname = session.Nickname ?? p.Nickname;
                p.AvatarUrl = session.AvatarUrl ?? p.AvatarUrl;
            }
        }
    }

    public void DetachSession(int seat)
    {
        lock (_sync) if (_bySeat.TryGetValue(seat, out var p)) p.Session = null;
    }

    public bool TrySelectMap(GameMap map)
    {
        lock (_sync)
        {
            if (Phase != RoomPhase.Waiting) return false;
            Map = map;
            return true;
        }
    }

    public void SetPhase(RoomPhase phase)
    {
        lock (_sync) Phase = phase;
    }

    public RoomDto ToDto()
    {
        lock (_sync)
        {
            return new RoomDto
            {
                RoomNo = RoomNo,
                MapId = Map.Id,
                Phase = (int)Phase,
                HostSeat = HostSeat,
                Players = _bySeat.Values.OrderBy(p => p.Seat).Select(p => p.ToDto()).ToList()
            };
        }
    }

    public void Broadcast(string type, object? data)
    {
        var json = WsJson.Msg(type, data);
        foreach (var p in Players) p.Session?.TrySend(json);
    }

    public void SendTo(long userId, string type, object? data)
    {
        var p = FindByUser(userId);
        p?.Session?.TrySend(WsJson.Msg(type, data));
    }
}
