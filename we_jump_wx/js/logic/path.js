/**
 * 路径工具：给定 GameStart 下发的 path（[{x,y}...]）与玩家所在格序号，
 * 计算本直线段安全步数 d 与当前可跳上限 n（与服务端一致，仅用于本地提示渲染）。
 */
var charge = require('./charge.js');

/**
 * 蓄力上限 n（进度环格数）：由服务端下发（charge.maxStep()），
 * 不随“到终点的剩余距离”收窄。若蓄力超过当前直线段安全步数，会按“飞出边界”判定。
 */
function allowedN(path, index) {
  return charge.maxStep();
}

/** 到终点剩余格数。 */
function remainingToEnd(path, index) {
  return path.length - 1 - index;
}

/** 当前直线段安全步数 d：可同方向直线跳到（含）拐弯/终点所在格，超出则视为飞出。 */
function segmentSafe(path, index) {
  var n = path.length;
  if (index >= n - 1) return 0;
  var dx = path[index + 1].x - path[index].x;
  var dy = path[index + 1].y - path[index].y;
  var steps = 0;
  for (var i = index; i < n - 1; i++) {
    var nx = path[i + 1].x - path[i].x;
    var ny = path[i + 1].y - path[i].y;
    if (nx !== dx || ny !== dy) break;
    steps++;
  }
  return steps;
}

module.exports = {
  allowedN: allowedN,
  remainingToEnd: remainingToEnd,
  segmentSafe: segmentSafe
};
