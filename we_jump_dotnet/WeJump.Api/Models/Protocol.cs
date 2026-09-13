namespace WeJump.Api.Models;

/// <summary>WebSocket 协议消息类型（与客户端约定，见 docs/README）。</summary>
public static class Msg
{
    // Client -> Server
    public const string CreateRoom = "create_room";
    public const string JoinRoom = "join_room";
    public const string LeaveRoom = "leave_room";
    public const string SelectMap = "select_map";
    public const string StartGame = "start_game";
    public const string PlayAgain = "play_again";   // 结算弹窗点“再来一局”（全员就绪后按同一张地图重开）
    public const string Jump = "jump";     // 实时跳跃上报 {elapsedMs}
    public const string Ping = "ping";

    // Server -> Client
    public const string Joined = "joined";           // 加入/创建成功（附房间快照 + 本人座位）
    public const string RoomState = "room_state";    // 房间变化（成员/选图/阶段）
    public const string GameStart = "game_start";    // 开局（附地图路径与参赛者）
    public const string GameState = "game_state";    // 对局状态快照（断线重连同步）
    public const string Countdown = "countdown";     // 3-2-1；n=0 表示开始（此后可自由跳跃）
    public const string PlayerMove = "player_move";  // 某位玩家的一次移动结算
    public const string GameEnd = "game_end";        // 对局结束（附名次）
    public const string Error = "error";
}

/// <summary>房间成员（快照用）。</summary>
public sealed class RoomPlayerDto
{
    public int Seat { get; set; }
    public long UserId { get; set; }
    public string Nickname { get; set; } = "";
    public string AvatarUrl { get; set; } = "";
    /// <summary>头像文字（一个字，头像展示用）。</summary>
    public string AvatarChar { get; set; } = "";
    public bool Online { get; set; }
    /// <summary>结算弹窗里是否已点“再来一局”。</summary>
    public bool Ready { get; set; }
}

/// <summary>房间快照。</summary>
public sealed class RoomDto
{
    public string RoomNo { get; set; } = "";
    public int MapId { get; set; }
    public int Phase { get; set; }
    public int HostSeat { get; set; }
    public List<RoomPlayerDto> Players { get; set; } = new();
}

/// <summary>地图元信息（列表/选图用，含路径，供客户端绘制缩略图）。</summary>
public sealed class MapMetaDto
{
    public int Id { get; set; }
    public string Name { get; set; } = "";
    public string Difficulty { get; set; } = "";
    public int TotalCells { get; set; }
    public int TurnCount { get; set; }
    public int DurationSeconds { get; set; }
    public List<GridPoint> Path { get; set; } = new();
}
