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
    public const string Again = "again";
    public const string Jump = "jump";
    public const string Skip = "skip";     // 取消蓄力：本回合原地不动但已响应
    public const string Ping = "ping";

    // Server -> Client
    public const string Joined = "joined";           // 加入/创建成功（附房间快照 + 本人座位）
    public const string RoomState = "room_state";    // 房间变化（成员/选图/阶段）
    public const string GameStart = "game_start";    // 开局（附地图路径与参赛者）
    public const string Countdown = "countdown";     // 3-2-1
    public const string WaveStart = "wave_start";    // 每回合开始（附每人当前位置/可跳信息）
    public const string WaveResult = "wave_result";  // 每回合结算
    public const string Champion = "champion";       // 出现冠军，进入 10s 倒计时
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
    public bool Online { get; set; }
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

/// <summary>地图元信息（列表/选图用，不含路径；路径在对局开始下发）。</summary>
public sealed class MapMetaDto
{
    public int Id { get; set; }
    public string Name { get; set; } = "";
    public string Difficulty { get; set; } = "";
    public int TotalCells { get; set; }
    public int TurnCount { get; set; }
    public int DurationSeconds { get; set; }
}
