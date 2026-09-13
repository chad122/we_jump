/**
 * 主菜单场景：创建房间 / 输入房间号加入。
 */
var draw = require('../render/draw.js');
var Button = require('../ui/button.js');
var state = require('../state.js');
var avatar = require('../render/avatar.js');

function create() {
  var scene = {
    name: 'main',
    app: null, w: 0, h: 0,
    buttons: []
  };

  scene.enter = function (data) {
    this.app = data.app;
    this.w = data.w;
    this.h = data.h;

    var bw = Math.min(this.w * 0.7, 280);
    var bh = 52;
    var gap = 20;
    var cx = this.w / 2;
    var y0 = this.h * 0.46;
    // 标题 / 头像行（避开刘海与状态栏）
    this.titleY = Math.max(this.h * 0.18, (state.safeTop || 0) + 60);
    this.midY = Math.max(this.h * 0.32, this.titleY + 82);
    this.buttons = [
      new Button(cx - bw / 2, y0, bw, bh, '创建房间', function () {
        scene.app.actionCreate();
      }, { bg: '#ff9f43' }),
      new Button(cx - bw / 2, y0 + bh + gap, bw, bh, '输入房间号加入', function () {
        scene.app.promptJoin();
      }, { bg: '#4a7dff' })
    ];

    // 头像文字输入框：房间外只能靠这个字区分玩家，所以建房/加房前必须填
    var iw = Math.min(this.w * 0.66, 250), ih = 44;
    this.inputBox = { x: (this.w - iw) / 2, y: this.midY + 34, w: iw, h: ih };
  };

  scene.handleServer = function (type, data) {
    // joined / room_state 等由 App 统一处理
    return false;
  };

  scene.onTouchEnd = function (x, y) {
    var ib = this.inputBox;
    if (ib && x >= ib.x && x <= ib.x + ib.w && y >= ib.y && y <= ib.y + ib.h) {
      this.app.promptAvatarChar();
      return;
    }
    for (var i = 0; i < this.buttons.length; i++) {
      var b = this.buttons[i];
      if (!b.disabled && b.hit(x, y)) { b.onTap(); return; }
    }
  };

  scene.render = function (ctx) {
    var w = this.w, h = this.h;

    // 背景
    var g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#1f2a55');
    g.addColorStop(1, '#0e1330');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    var pad = state.safeTop || 0;
    var titleY = this.titleY;   // 避开刘海/状态栏
    draw.text(ctx, '多人跳一跳', w / 2, titleY, 42, '#ffffff', 'center', true);
    draw.text(ctx, '', w / 2, titleY + 40, 16, 'rgba(255,255,255,0.7)');

    // 当前玩家：头像（文字）+ 昵称
    var me = state.user || {};
    var ch = me.avatarChar || '';
    var midY = this.midY;
    avatar.drawAvatar(ctx, w / 2 - 54, midY, 16, me.avatarUrl, me.nickname, '#4a7dff', ch);
    draw.textAutoFit(ctx, me.nickname || '', w / 2 - 32, midY, w * 0.55, 15, '#ffffff', 'left', true);

    // 头像文字输入框（点击弹出输入，只取一个字）
    var ib = this.inputBox;
    draw.fillRoundRect(ctx, ib.x, ib.y, ib.w, ib.h, ib.h / 2, 'rgba(255,255,255,0.10)');
    draw.strokeRoundRect(ctx, ib.x, ib.y, ib.w, ib.h, ib.h / 2,
      ch ? 'rgba(255,255,255,0.26)' : '#ff9f43', 1.5);
    draw.text(ctx, ch ? (ch + '　点击修改头像') : '点击输入一个字作为头像', w / 2, ib.y + ib.h / 2, 14,
      ch ? '#ffffff' : 'rgba(255,255,255,0.75)');

    for (var i = 0; i < this.buttons.length; i++) this.buttons[i].render(ctx);

    draw.text(ctx, '长按蓄力 · 上划取消 · 看谁先到终点', w / 2, h - 40, 13, 'rgba(255,255,255,0.6)');
  };

  return scene;
}

module.exports = { create: create };
