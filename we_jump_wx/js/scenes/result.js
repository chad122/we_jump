/**
 * 结算场景：展示名次与结束原因；房主可“再来一局”，其他人等待房主。
 */
var draw = require('../render/draw.js');
var Button = require('../ui/button.js');
var state = require('../state.js');
var avatar = require('../render/avatar.js');

function create() {
  var scene = {
    name: 'result',
    app: null, w: 0, h: 0,
    data: null,
    buttons: []
  };

  scene.enter = function (data) {
    this.app = data.app;
    this.w = data.w;
    this.h = data.h;
    this.data = data.data;       // {reason, ranks:[...], championSeat}
    this.players = data.players || {}; // seat -> {nickname, avatarUrl, color}
    this.buildButtons();
  };

  scene.buildButtons = function () {
    var w = this.w;
    var bw = Math.min(w * 0.72, 280);
    var bh = 48;
    var cx = w / 2;
    var buttons = [];

    if (this.isHost()) {
      buttons.push(new Button(cx - bw / 2, this.h - 150, bw, bh, '再来一局', function () {
        scene.app.send('again', {});
      }, { bg: '#12b76a' }));
    }

    buttons.push(new Button(cx - bw / 2, this.h - 86, bw, bh, '离开房间', function () {
      scene.app.leaveRoom();
    }, { bg: '#e5484d' }));

    this.buttons = buttons;
  };

  scene.isHost = function () {
    return !!(state.room && state.room.hostSeat === state.mySeat);
  };

  scene.handleServer = function (type, data) {
    // room_state(phase=0) 由 App 统一切回房间；game_end 不会重复进来
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
    var g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#231b3f');
    g.addColorStop(1, '#0e1330');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    var d = this.data || {};
    var pad = state.safeTop || 0;
    var titleY = Math.max(56, pad + 24);        // 避开刘海/状态栏
    var reasonY = titleY + 36;
    draw.text(ctx, '本局结束', w / 2, titleY, 30, '#ffffff', 'center', true);
    draw.text(ctx, d.reasonText || '', w / 2, reasonY, 14, 'rgba(255,255,255,0.7)');

    var ranks = d.ranks || [];
    var champSeat = d.championSeat;

    // 冠军横幅
    if (champSeat >= 0) {
      draw.fillRoundRect(ctx, w * 0.1, reasonY + 26, w * 0.8, 54, 14, 'rgba(255,199,0,0.18)');
      draw.text(ctx, '★ 本局冠军', w / 2, reasonY + 45, 20, '#ffd34d', 'center', true);
    }

    // 排名列表
    var ly = champSeat >= 0 ? reasonY + 108 : reasonY + 38;
    for (var i = 0; i < ranks.length; i++) {
      var r = ranks[i];
      var py = ly + i * 40;
      var medalColor = r.rank === 1 ? '#ffd34d' : (r.rank === 2 ? '#c0d0e0' : (r.rank === 3 ? '#d29a5b' : '#ffffff'));
      draw.fillRoundRect(ctx, w * 0.08, py - 17, w * 0.84, 34, 12, 'rgba(255,255,255,0.07)');
      var plp = this.players[r.seat] || {};
      avatar.drawAvatar(ctx, w * 0.22, py, 9, plp.avatarUrl, r.nickname, state.seatColor(r.seat));
      var pos = r.finished ? '终点' : ('第' + (r.index + 1) + '格');
      draw.text(ctx, r.nickname, w * 0.25, py, 14, '#ffffff', 'left');
      draw.text(ctx, pos, w * 0.88, py, 13, r.finished ? '#6ee7a8' : 'rgba(255,255,255,0.7)', 'right');
    }

    if (!this.isHost()) {
      draw.text(ctx, '等待房主开始下一局…', w / 2, h - 170, 13, 'rgba(255,255,255,0.7)');
    }

    for (var b = 0; b < this.buttons.length; b++) this.buttons[b].render(ctx);
  };

  return scene;
}

module.exports = { create: create };
