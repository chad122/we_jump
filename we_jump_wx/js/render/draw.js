/**
 * Canvas 2D 绘图小工具。
 */

function rr(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function fillRoundRect(ctx, x, y, w, h, r, color) {
  ctx.fillStyle = color;
  rr(ctx, x, y, w, h, r);
  ctx.fill();
}

function strokeRoundRect(ctx, x, y, w, h, r, color, lw) {
  ctx.strokeStyle = color;
  ctx.lineWidth = lw || 2;
  rr(ctx, x, y, w, h, r);
  ctx.stroke();
}

function text(ctx, str, x, y, size, color, align, bold) {
  ctx.fillStyle = color;
  ctx.font = (bold ? 'bold ' : '') + size + 'px sans-serif';
  ctx.textAlign = align || 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(str, x, y);
}

function textAutoFit(ctx, str, x, y, maxW, size, color, align, bold) {
  var s = size;
  ctx.font = (bold ? 'bold ' : '') + s + 'px sans-serif';
  while (s > 8 && ctx.measureText(str).width > maxW) {
    s -= 1;
    ctx.font = (bold ? 'bold ' : '') + s + 'px sans-serif';
  }
  ctx.fillStyle = color;
  ctx.textAlign = align || 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(str, x, y);
}

/** 时间格式化 mm:ss。 */
function fmtClock(totalSec) {
  if (totalSec < 0) totalSec = 0;
  var m = Math.floor(totalSec / 60);
  var s = Math.floor(totalSec % 60);
  return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
}

module.exports = {
  fillRoundRect: fillRoundRect,
  strokeRoundRect: strokeRoundRect,
  text: text,
  textAutoFit: textAutoFit,
  fmtClock: fmtClock
};
