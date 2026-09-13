namespace WeJump.Api.Models;

/// <summary>房间阶段。</summary>
public enum RoomPhase
{
    Waiting = 0,   // 等待成员/选图/开局
    Playing = 1,   // 对局中（含 3-2-1 倒计时与逐回合）
    Ended = 2      // 本局已结束，可“再来一局”
}

/// <summary>对局结束原因。</summary>
public enum EndReason
{
    None = 0,
    ChampionArrived = 1, // 模式A：首名抵达终点，立即结算
    MapTimeout = 2       // 模式B：地图超时强制结束
}
