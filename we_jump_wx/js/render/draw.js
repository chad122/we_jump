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

/**
 * 把文字**按字形墨迹**垂直居中到 y（不按字体上下沿取中）。
 * baseline=middle 用的是字体（含 ascent/descent 空白）的中线，汉字/emoji 的墨迹重心与它有零点几像素偏差，
 * 视觉上就是“看着偏下/偏上”。这里用 measureText 的墨迹度量把墨迹中心精确对到 y；
 * 取不到度量（老环境只返回 width）时退回 baseline=middle，行为与之前一致。
 */
function paint(ctx, str, x, y, align) {
  ctx.textAlign = align || 'center';
  var dy = null;
  try {
    var m = ctx.measureText(str);
    var a = m.actualBoundingBoxAscent, d = m.actualBoundingBoxDescent;
    if (typeof a === 'number' && typeof d === 'number' && isFinite(a) && isFinite(d) && a + d > 0) dy = (a - d) / 2;
  } catch (e) { /* 度量不可用：退回 middle 基线 */ }
  if (dy === null) {
    ctx.textBaseline = 'middle';
    ctx.fillText(str, x, y);
  } else {
    ctx.textBaseline = 'alphabetic';   // 基线就在 y 上，再叠上墨迹偏移即可精确居中
    ctx.fillText(str, x, y + dy);
  }
}

function text(ctx, str, x, y, size, color, align, bold) {
  ctx.fillStyle = color;
  ctx.font = (bold ? 'bold ' : '') + size + 'px sans-serif';
  paint(ctx, str, x, y, align);
}

function textAutoFit(ctx, str, x, y, maxW, size, color, align, bold) {
  var s = size;
  ctx.font = (bold ? 'bold ' : '') + s + 'px sans-serif';
  while (s > 8 && ctx.measureText(str).width > maxW) {
    s -= 1;
    ctx.font = (bold ? 'bold ' : '') + s + 'px sans-serif';
  }
  ctx.fillStyle = color;
  paint(ctx, str, x, y, align);
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
