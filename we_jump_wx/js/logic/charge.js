/**
 * 蓄力 -> 步数 映射（客户端本地镜像，用于进度条渲染与本地手感预览）。
 * 公式与服务端 Utils/Charge.cs 一致：
 *   第 k 格蓄满耗时 = FirstCellMs * Ratio^(k-1)
 *   蓄满 k 格累计耗时 C(k) = FirstCellMs * (1-Ratio^k)/(1-Ratio)
 */
var cfg = require('../config.js');

/** 蓄满 k 格的累计时长(ms)。k>=1。 */
function cumTime(k) {
  var acc = 0;
  for (var i = 1; i <= k; i++) {
    acc += cfg.FirstCellMs * Math.pow(cfg.Ratio, i - 1);
  }
  return acc;
}

/** 给定蓄力时长(ms)与当前可跳上限 n，返回应跳步数（1..n）。 */
function stepsForMs(ms, n) {
  if (!n || n < 1) n = 1;
  var max = Math.min(n, cfg.MaxStep);
  if (ms < 0) return 1;
  var s = 1;
  for (var k = 1; k <= max; k++) {
    if (ms >= cumTime(k) - 1) s = k; else break;
  }
  return s;
}

module.exports = {
  cumTime: cumTime,
  stepsForMs: stepsForMs
};
