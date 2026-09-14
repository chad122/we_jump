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

    /// <summary>
    /// 创建房间（创建者自动成为房主）。返回 null 表示已在其他房间。
    /// 若映射到的房间已不存在、自己已不在其中，或座位并非由当前连接持有（重开小程序/已换连接），
    /// 视为残留座位先让出，避免“离开房间”后一直提示已在其他房间。
    /// </summary>
    public Room? CreateRoom(WsSession session)
    {
        lock (_lock)
        {
            if (_userRoom.ContainsKey(session.UserId))
            {
                var mine = GetRoomOfUser(session.UserId)?.FindByUser(session.UserId);
                if (mine != null && mine.Session == session) return null;
                LeaveLocked(session.UserId);
            }

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

    /// <summary>
    /// 主动离开房间：不分阶段都真正退出（移除成员 + 解除“用户→房间”映射），否则对局中/结算弹窗里
    /// 离开后仍会被判定为“已在其他房间”，无法再创建或加入新房间。
    /// 断线且需保留座位以便重连的情形走 <see cref="OnSessionClosed"/>，不受此处影响。
    /// </summary>
    public void LeaveRoom(WsSession session)
    {
        lock (_lock) LeaveLocked(session.UserId);
    }

    /// <summary>退出房间并回收：成员清空时连房间一起移除（对局中的引擎见 Aborted 后自行收尾）。需在 _lock 内调用。</summary>
    private void LeaveLocked(long userId)
    {
        var room = GetRoomOfUser(userId);
        _userRoom.Remove(userId);              // 兜底：房间已被 Sweep 清理时也要清掉残留映射
        var p = room?.FindByUser(userId);
        if (room == null || p == null) return;

        room.RemovePlayer(p.Seat);
        if (room.Aborted) _rooms.Remove(room.RoomNo);
        else room.Broadcast(Msg.RoomState, room.ToDto());
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
            room.DetachSession(p.Seat, session);   // 旧连接关闭时不动新会话（重连后旧连接才收到关闭事件）

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
            room.ResetReady();               // 防御：开局时清空上一局残留的“已准备”标记
            room.SetPhase(RoomPhase.Playing); // 同步置为对局中，避免双击/连点重复开局
            engine.Start(); // 内部广播 GameStart 与 3-2-1 倒计时
            return null;
        }
    }

    /// <summary>
    /// 结算弹窗点“再来一局”：标记自己已就绪；当**全部在线玩家**都就绪时，
    /// 直接用同一张地图重开一局（不再回等待房，也不能换图）。
    /// </summary>
    public string? PlayAgain(WsSession session)
    {
        lock (_lock)
        {
            var room = GetRoomOfUser(session.UserId);
            if (room == null) return "未加入房间";
            if (room.Phase != RoomPhase.Ended) return null;   // 已经开了/已回等待房：幂等忽略

            var p = room.FindByUser(session.UserId);
            if (p == null) return "未加入房间";

            p.Ready = true;
            var stats = room.ReadyStats();
            room.Broadcast(Msg.RoomState, room.ToDto());
            if (stats.ready < stats.online || stats.online < 1) return null;   // 还要等其他人

            room.ResetReady();
            room.Broadcast(Msg.RoomState, room.ToDto());   // 让客户端清掉上一局的“已准备”标记
            var engine = new GameEngine(room, _db);
            room.Engine = engine;
            room.SetPhase(RoomPhase.Playing);   // 先置对局中，避免重复开局
            engine.Start();                     // 同一张地图（room.Map 未变）
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
