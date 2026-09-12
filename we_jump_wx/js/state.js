/**
 * 全局运行状态（单例）。
 */
var SEAT_COLORS = ['#ff6b6b', '#4ecdc4', '#45b7d1', '#f9ca24', '#a55eea', '#ff9f43'];

module.exports = {
  token: '',
  user: null,           // {id,nickname,avatarUrl}
  ws: null,             // WsClient
  wsReady: false,
  safeTop: 0,           // 安全区顶部留白（刘海/状态栏高度）
  safeBottom: 0,        // 安全区底部留白（home indicator）
  capsuleBottom: 0,     // 右上角胶囊按钮底边（小地图等右上内容靠它避让）
  room: null,           // 房间快照 {roomNo,mapId,phase,hostSeat,players:[...]}
  mySeat: -1,
  mapList: [],          // 服务端地图列表（含路径，用于选图缩略图）
  lastRoomNo: '',       // 用于断线重连后重新加入
  pendingRoomNo: '',    // 启动参数里的房间号（分享卡片直达）
  seatColor: function (seat) {
    return SEAT_COLORS[(seat % SEAT_COLORS.length + SEAT_COLORS.length) % SEAT_COLORS.length];
  }
};
