/**
 * 全局运行状态（单例）。
 */
var SEAT_COLORS = ['#ff6b6b', '#4ecdc4', '#45b7d1', '#f9ca24', '#a55eea', '#ff9f43'];

module.exports = {
  token: '',
  user: null,           // {id,nickname,avatarUrl}
  ws: null,             // WsClient
  wsReady: false,
  room: null,           // 房间快照 {roomNo,mapId,phase,hostSeat,players:[...]}
  mySeat: -1,
  lastRoomNo: '',       // 用于断线重连后重新加入
  pendingRoomNo: '',    // 启动参数里的房间号（分享卡片直达）
  seatColor: function (seat) {
    return SEAT_COLORS[(seat % SEAT_COLORS.length + SEAT_COLORS.length) % SEAT_COLORS.length];
  }
};
