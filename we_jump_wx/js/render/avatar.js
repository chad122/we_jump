/**
 * 头像渲染：优先显示微信头像图片；未加载完成/失败时回退为“昵称首字 + 颜色”的生成头像。
 */
var draw = require('./draw.js');

var cache = {}; // url -> { img, ok }

/** 取已加载完成的头像 Image（未完成返回 null，并在后台加载）。 */
function getImage(url) {
  if (!url) return null;
  var e = cache[url];
  if (!e) {
    e = { img: null, ok: false };
    try {
      var img = wx.createImage();
      e.img = img;
      img.onload = function () { e.ok = true; };
      img.onerror = function () { e.ok = false; };
      img.src = url;
    } catch (err) {
      e.ok = false;
    }
    cache[url] = e;
  }
  return e.ok ? e.img : null;
}

/** 昵称首字：中文取第一个字，英文取大写首字母。 */
function initialOf(nickname) {
  var s = (nickname || '').trim();
  if (!s) return '?';
  var ch = s.charAt(0);
  return /[a-z]/.test(ch) ? ch.toUpperCase() : ch;
}

/** 截断过长的昵称。 */
function shortName(nickname, max) {
  var s = nickname || '';
  max = max || 6;
  return s.length > max ? (s.slice(0, max) + '…') : s;
}

/**
 * 在 (x,y) 绘制半径 r 的圆形头像。
 * @param url 头像地址（可空）
 * @param nickname 昵称（生成头像用）
 * @param color 主色（生成头像背景）
 * @param char 头像文字（一个字，可空；优先于昵称首字，设置后不再加载图片）
 */
function drawAvatar(ctx, x, y, r, url, nickname, color, char) {
  var img = char ? null : getImage(url);
  if (img) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    try { ctx.drawImage(img, x - r, y - r, r * 2, r * 2); } catch (e) { /* ignore */ }
    ctx.restore();
    return;
  }
  ctx.fillStyle = color || '#4a7dff';
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  // 文字垂直居中由 draw.text 按字形墨迹精确处理
  draw.text(ctx, char || initialOf(nickname), x, y, Math.max(9, r * 1.05), '#ffffff', 'center', true);
}

/** 取第一个“字”：emoji（代理对）按整字取，避免截出半个字符。 */
function firstChar(s) {
  var t = (s || '').replace(/^\s+/, '');
  if (!t) return '';
  var c = t.charCodeAt(0);
  return (c >= 0xd800 && c <= 0xdbff && t.length > 1) ? t.slice(0, 2) : t.charAt(0);
}

module.exports = {
  getImage: getImage,
  initialOf: initialOf,
  firstChar: firstChar,
  shortName: shortName,
  drawAvatar: drawAvatar
};
