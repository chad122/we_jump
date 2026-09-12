/**
 * 蓄力规则与时长 -> 步数映射。
 *
 * 参数全部由服务端下发（`game_start` / `game_state` 快照里的 maxStep / firstCellMs / ratio），
 * 客户端不再内置任何规则常量，避免两端不一致导致“显示蓄了 N 格、服务端只结算 M 格”。
 * 本地映射仅用于进度环渲染与手感提示，最终结算始终以服务端为准。
 *
 * 公式：第 k 格蓄满耗时 = firstCellMs * ratio^(k-1)
 *      蓄满 k 格累计耗时 C(k) = firstCellMs * (1 - ratio^k) / (1 - ratio)
 */
var rules = {
  maxStep: 1,
  firstCellMs: 0,
  ratio: 0
};

/** 用服务端下发的参数刷新规则（缺失或非法的字段保留原值）。 */
function apply(src) {
  if (!src) return;
  if (src.maxStep > 0) rules.maxStep = src.maxStep;
  if (src.firstCellMs > 0) rules.firstCellMs = src.firstCellMs;
  if (src.ratio > 0) rules.ratio = src.ratio;
}

/** 单跳最大格数（即当前可蓄力上限）。 */
function maxStep() {
  return rules.maxStep > 0 ? rules.maxStep : 1;
}

/** 蓄满 k 格的累计时长(ms)。k>=1；未拿到参数时返回 Infinity。 */
function cumTime(k) {
  if (!(rules.firstCellMs > 0) || !(rules.ratio > 0)) return Infinity;
  var acc = 0;
  for (var i = 1; i <= k; i++) {
    acc += rules.firstCellMs * Math.pow(rules.ratio, i - 1);
  }
  return acc;
}

/** 给定蓄力时长(ms)与当前可跳上限 n，返回应跳步数（1..min(n, maxStep)）。 */
function stepsForMs(ms, n) {
  var limit = maxStep();
  var max = (n > 0 ? Math.min(n, limit) : limit);
  if (ms < 0 || !isFinite(cumTime(1))) return 1;
  var s = 1;
  for (var k = 1; k <= max; k++) {
    if (ms >= cumTime(k) - 1) s = k; else break;
  }
  return s;
}

module.exports = {
  apply: apply,
  maxStep: maxStep,
  cumTime: cumTime,
  stepsForMs: stepsForMs
};
