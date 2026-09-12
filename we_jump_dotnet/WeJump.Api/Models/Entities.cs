namespace WeJump.Api.Models;

/// <summary>玩家（微信用户）记录。</summary>
public sealed class User
{
    public long Id { get; set; }
    public string OpenId { get; set; } = "";
    public string Nickname { get; set; } = "";
    public string AvatarUrl { get; set; } = "";
    /// <summary>是否已授权微信头像昵称（已授权则资料以库为准，不再被客户端兜底值覆盖）。</summary>
    public bool WxAuthorized { get; set; }
}

/// <summary>对局主记录（每一局一条）。</summary>
public sealed class GameRecord
{
    public long Id { get; set; }
    public string RoomNo { get; set; } = "";
    public int MapId { get; set; }
    public string MapName { get; set; } = "";
    public int EndReason { get; set; }
    public int PlayerCount { get; set; }
    public DateTime StartedAt { get; set; }
    public DateTime EndedAt { get; set; }
    public int DurationMs { get; set; }
}

/// <summary>单局内每个玩家的成绩（用于后续排行榜等）。</summary>
public sealed class GamePlayerResult
{
    public long GameId { get; set; }
    public long UserId { get; set; }
    public string Nickname { get; set; } = "";
    public string AvatarUrl { get; set; } = "";
    public int Seat { get; set; }
    public int Rank { get; set; }
    public bool Finished { get; set; }
    public int EndIndex { get; set; }
    public int JumpCount { get; set; }
    public int OutCount { get; set; }
}
