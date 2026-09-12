using WeJump.Api.Data;
using WeJump.Api.Models;

namespace WeJump.Api.Services;

/// <summary>
/// 房间总控：创建/加入/离开/选图/开局/再来一局，并维护“用户 -> 房间”映射。
/// 房间均为内存态（MVP 不落库）；断线重连通过重新 Join 恢复座位。
/// </summary>
public sealed class RoomManager : IDisposable
{
    private readonly Db _db;
    private readonly object _lock = new();
    private readonly Dictionary<string, Room> _rooms = new(StringComparer.Ordinal);
    private readonly Dictionary<long, string> _userRoom = new(); // userId -> roomNo
    private readonly Timer _sweepTimer;

    public RoomManager(Db db)
    {
        _db = db;
        _sweepTimer = new Timer(_ => SweepIdleRooms(), null, TimeSpan.FromMinutes(1), TimeSpan.FromMinutes(1));
    }

    public Room? GetRoomByNo(string roomNo)
    {
        lock (_lock) return _rooms.TryGetValue(roomNo, out var r) ? r : null;
    }

    public Room? GetRoomOfUser(long userId)
    {
        lock (_lock) return _userRoom.TryGetValue(userId, out var no) ? GetRoomByNo(no) : null;
    }

    /// <summary>创建房间（创建者自动成为房主）。返回 null 表示已在其他房间。</summary>
    public Room? CreateRoom(WsSession session)
    {
        lock (_lock)
        {
            if (_userRoom.ContainsKey(session.UserId)) return null;

            string no;
            do { no = Random.Shared.Next(100000, 999999).ToString(); }
            while (_rooms.ContainsKey(no));

            var room = new Room(no);
            _rooms[no] = room;
            room.AddPlayer(session);
            _userRoom[session.UserId] = no;
            return room;
        }
    }

    /// <summary>加入房间；已在本房的用户直接重连（恢复座位）。失败返回错误信息。</summary>
    public string? JoinRoom(WsSession session, string roomNo)
    {
        lock (_lock)
        {
            if (_userRoom.TryGetValue(session.UserId, out var cur) && cur != roomNo)
                return "你已在其他房间，请先退出";

            var room = _rooms.TryGetValue(roomNo, out var r) ? r : null;
            if (room == null) return "房间不存在";

            var member = room.FindByUser(session.UserId);
            if (member != null)
            {
                // 断线重连：恢复座位与连接
                room.AttachSession(member.Seat, session);
                _userRoom[session.UserId] = roomNo;
                return null;
            }

            if (room.Phase != RoomPhase.Waiting) return "对局进行中，暂不可加入";
            try { room.AddPlayer(session); }
            catch (InvalidOperationException ex) { return ex.Message; }

            _userRoom[session.UserId] = roomNo;
            return null;
        }
    }

    /// <summary>离开房间。等待阶段移除成员；对局中仅断开（不影响本局结算）。</summary>
    public void LeaveRoom(WsSession session)
    {
        lock (_lock)
        {
            var room = GetRoomOfUser(session.UserId);
            if (room == null) return;

            var p = room.FindByUser(session.UserId);
            if (p == null) return;

            if (room.Phase == RoomPhase.Waiting)
            {
                room.RemovePlayer(p.Seat);
                _userRoom.Remove(session.UserId);
                if (room.Aborted) _rooms.Remove(room.RoomNo);
                else room.Broadcast(Msg.RoomState, room.ToDto());
            }
            else
            {
                room.DetachSession(p.Seat);
                // 对局中掉线：保留座位与进度，引擎按“离线”处理为挂机
            }
        }
    }

    /// <summary>连接断开时的统一入口（不区分阶段，仅摘除连接）。</summary>
    public void OnSessionClosed(WsSession session)
    {
        lock (_lock)
        {
            var room = GetRoomOfUser(session.UserId);
            if (room == null) return;
            var p = room.FindByUser(session.UserId);
            if (p == null) return;
            room.DetachSession(p.Seat);

            // 等待阶段全部离线超过时限的房间由 Sweep 清理
            room.Broadcast(Msg.RoomState, room.ToDto());
        }
    }

    public string? SelectMap(WsSession session, int mapId)
    {
        lock (_lock)
        {
            var room = GetRoomOfUser(session.UserId);
            if (room == null) return "未加入房间";
            if (room.Phase != RoomPhase.Waiting) return "当前不可选图";
            if (!IsHost(room, session)) return "仅房主可选图";

            var map = MapCatalog.Get(mapId);
            if (map == null) return "地图不存在";
            room.TrySelectMap(map);
            room.Broadcast(Msg.RoomState, room.ToDto());
            return null;
        }
    }

    public string? StartGame(WsSession session)
    {
        lock (_lock)
        {
            var room = GetRoomOfUser(session.UserId);
            if (room == null) return "未加入房间";
            if (room.Phase != RoomPhase.Waiting) return "当前不可开局";
            if (!IsHost(room, session)) return "仅房主可开局";

            // 单人也能开局（单人练习 / 计时挑战）
            var onlineCount = room.Players.Count(p => p.Online);
            if (onlineCount < 1) return "没有在线玩家，无法开始";

            var engine = new GameEngine(room, _db);
            room.Engine = engine;
            room.SetPhase(RoomPhase.Playing); // 同步置为对局中，避免双击/连点重复开局
            engine.Start(); // 内部广播 GameStart 与 3-2-1 倒计时
            return null;
        }
    }

    public string? Again(WsSession session)
    {
        lock (_lock)
        {
            var room = GetRoomOfUser(session.UserId);
            if (room == null) return "未加入房间";
            if (room.Phase != RoomPhase.Ended) return "对局尚未结束";
            if (!IsHost(room, session)) return "仅房主可再来一局";

            room.SetPhase(RoomPhase.Waiting);
            room.Broadcast(Msg.RoomState, room.ToDto());
            return null;
        }
    }

    private static bool IsHost(Room room, WsSession session)
    {
        var p = room.FindByUser(session.UserId);
        return p != null && p.Seat == room.HostSeat;
    }

    private void SweepIdleRooms()
    {
        var now = DateTime.UtcNow;
        lock (_lock)
        {
            var stale = _rooms.Values
                .Where(r => r.Phase == RoomPhase.Waiting
                            && !r.Players.Any(p => p.Online)
                            && (now - r.CreatedAt) > TimeSpan.FromMinutes(10))
                .ToList();
            foreach (var r in stale)
            {
                foreach (var p in r.Players) _userRoom.Remove(p.UserId);
                _rooms.Remove(r.RoomNo);
            }
        }
    }

    public void Dispose() => _sweepTimer.Dispose();
}
