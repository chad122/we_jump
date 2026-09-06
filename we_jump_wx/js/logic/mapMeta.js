/**
 * 地图元信息（菜单/选图展示用，与服务端 MapCatalog 保持一致）。
 * 对局时地图路径（含坐标）以服务端 GameStart 下发的 path 为准，客户端不重复保存坐标。
 */
module.exports = [
  { id: 1, name: '新手草原', difficulty: '简单', totalCells: 20, turnCount: 2, durationSeconds: 300 },
  { id: 2, name: '森林迷宫', difficulty: '中等', totalCells: 35, turnCount: 4, durationSeconds: 420 },
  { id: 3, name: '城市天际线', difficulty: '中等', totalCells: 30, turnCount: 4, durationSeconds: 360 },
  { id: 4, name: '火山熔岩', difficulty: '困难', totalCells: 40, turnCount: 7, durationSeconds: 480 },
  { id: 5, name: '星空幻境', difficulty: '极难', totalCells: 50, turnCount: 9, durationSeconds: 600 }
];
