/**
 * 主菜单场景：创建房间 / 输入房间号加入。
 */
var draw = require('../render/draw.js');
var Button = require('../ui/button.js');
var state = require('../state.js');

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
    var cx = this.w / 2;
    var y0 = this.h * 0.46;
    this.buttons = [
      new Button(cx - bw / 2, y0, bw, bh, '创建房间', function () {
        scene.app.actionCreate();
      }, { bg: '#ff9f43' }),
      new Button(cx - bw / 2, y0 + bh + 20, bw, bh, '输入房间号加入', function () {
        scene.app.promptJoin();
      }, { bg: '#4a7dff' })
    ];
  };

  scene.handleServer = function (type, data) {
    // joined / room_state 等由 App 统一处理
    return false;
  };

  scene.onTouchEnd = function (x, y) {
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

    draw.text(ctx, '多人跳一跳', w / 2, h * 0.18, 42, '#ffffff', 'center', true);
    draw.text(ctx, '棋盘版 · 实时竞速', w / 2, h * 0.18 + 40, 16, 'rgba(255,255,255,0.7)');

    var nick = state.user ? state.user.nickname : '';
    draw.text(ctx, '玩家：' + nick, w / 2, h * 0.32, 14, 'rgba(255,255,255,0.85)');

    for (var i = 0; i < this.buttons.length; i++) this.buttons[i].render(ctx);

    draw.text(ctx, '长按蓄力 · 上划取消 · 看谁先到终点', w / 2, h - 40, 13, 'rgba(255,255,255,0.6)');
  };

  return scene;
}

module.exports = { create: create };
