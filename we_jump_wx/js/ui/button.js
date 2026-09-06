/**
 * 极简 Canvas 按钮（用于各场景）。
 */
var draw = require('../render/draw.js');

function Button(x, y, w, h, label, onTap, opts) {
  this.x = x;
  this.y = y;
  this.w = w;
  this.h = h;
  this.label = label;
  this.onTap = onTap;
  this.bg = (opts && opts.bg) || '#4a7dff';
  this.color = (opts && opts.color) || '#ffffff';
  this.disabled = !!(opts && opts.disabled);
  this.size = (opts && opts.size) || 18;
}

Button.prototype.setLabel = function (label) {
  this.label = label;
};

Button.prototype.setDisabled = function (v) {
  this.disabled = v;
};

Button.prototype.hit = function (x, y) {
  return x >= this.x && x <= this.x + this.w && y >= this.y && y <= this.y + this.h;
};

Button.prototype.render = function (ctx) {
  var bg = this.disabled ? '#c3c7d1' : this.bg;
  draw.fillRoundRect(ctx, this.x, this.y, this.w, this.h, this.h / 2, bg);
  draw.text(ctx, this.label, this.x + this.w / 2, this.y + this.h / 2, this.size, this.color);
};

module.exports = Button;
