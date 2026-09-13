/**
 * 结算弹窗：浮在上一局棋盘之上展示排行榜，并提供【再来一局】/【离开房间】。
 * 再来一局：上报 play_again，服务端在**全部在线玩家**都点过之后，按同一张地图直接开局；
 * 开局时会收到 game_start（App 切回对局场景），弹窗自然消失。
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
    this.data = data.data;       // {reason, reasonText, ranks:[...], championSeat}
    this.players = data.players || {}; // seat -> {nickname, avatarUrl, color}
    this.readySent = false;
    this.build();
  };

  /** 计算弹窗卡片与两个按钮的位置。 */
  scene.build = function () {
    var w = this.w, h = this.h;
    var padT = state.safeTop || 0, padB = state.safeBottom || 0;
    var d = this.data || {};
    var ranks = d.ranks || [];
    var champ = (d.championSeat >= 0);
    var rowH = 34;
    var cardW = Math.min(w * 0.88, 340);
    // 卡片高度：标题区 + 冠军横幅 + 名单 + 提示 + 按钮 + 内边距
    var cardH = 82 + (champ ? 46 : 6) + ranks.length * rowH + 34 + 46 + 16;
    var cardY = Math.max(padT + 12, Math.min((h - cardH) / 2, h - padB - cardH - 12));
    this.card = { x: (w - cardW) / 2, y: cardY, w: cardW, h: cardH };
    this.rowH = rowH;
    this.rowsTop = cardY + 82 + (champ ? 46 : 6);

    var bw = (cardW - 16 * 2 - 12) / 2;
    var bh = 46;
    var by = cardY + cardH - 16 - bh;
    this.buttons = [
      new Button(this.card.x + 16, by, bw, bh, '再来一局', function () {
        if (scene.isReady()) return;        // 已就绪：等其他人
        scene.app.send('play_again', {});
        scene.readySent = true;             // 本地即时反馈，服务端随后广播 room_state
      }, { bg: '#12b76a', size: 16 }),
      new Button(this.card.x + 16 + bw + 12, by, bw, bh, '离开房间', function () {
        scene.app.leaveRoom();
      }, { bg: '#e5484d', size: 16 })
    ];
  };

  /** 我是否已点“再来一局”（本地即时反馈 或 服务端已广播）。 */
  scene.isReady = function () {
    if (this.readySent) return true;
    var list = (state.room && state.room.players) || [];
    for (var i = 0; i < list.length; i++) {
      if (list[i].seat === state.mySeat) return !!list[i].ready;
    }
    return false;
  };

  /** 在线玩家就绪统计（用于弹窗提示，多人时要等全部人）。 */
  scene.readyStats = function () {
    var list = (state.room && state.room.players) || [];
    var online = 0, ready = 0;
    for (var i = 0; i < list.length; i++) {
      if (!list[i].online) continue;
      online++;
      if (list[i].ready) ready++;
    }
    return { online: online, ready: ready };
  };

  scene.readyMap = function () {
    var list = (state.room && state.room.players) || [];
    var m = {};
    for (var i = 0; i < list.length; i++) m[list[i].seat] = !!list[i].ready;
    return m;
  };

  scene.update = function () {
    if (!this.buttons.length) return;
    var ready = this.isReady();
    this.buttons[0].setLabel(ready ? '已准备' : '再来一局');
    this.buttons[0].setDisabled(ready);
  };

  scene.handleServer = function (type, data) {
    // room_state 由 App 统一更新 state.room；game_start 会切回对局场景
    return false;
  };

  scene.onTouchEnd = function (x, y) {
    for (var i = 0; i < this.buttons.length; i++) {
      var b = this.buttons[i];
      if (!b.disabled && b.hit(x, y)) { b.onTap(); return; }
    }
  };

  /** 先重画上一局棋盘，再叠遮罩与卡片：既是“弹窗”观感，也避免半透明遮罩逐帧叠加变黑。 */
  scene.drawBoardBehind = function (ctx) {
    var prev = this.app && this.app.prevScene;
    if (prev && typeof prev.render === 'function') {
      try { prev.render(ctx); return; } catch (e) { /* 降级为纯色背景 */ }
    }
    var g = ctx.createLinearGradient(0, 0, 0, this.h);
    g.addColorStop(0, '#1b2547');
    g.addColorStop(1, '#0d122b');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.w, this.h);
  };

  scene.render = function (ctx) {
    var w = this.w, h = this.h;
    this.drawBoardBehind(ctx);

    // 遮罩
    ctx.fillStyle = 'rgba(6,10,26,0.74)';
    ctx.fillRect(0, 0, w, h);

    var d = this.data || {};
    var c = this.card;
    draw.fillRoundRect(ctx, c.x + 3, c.y + 7, c.w, c.h, 20, 'rgba(0,0,0,0.35)');
    draw.fillRoundRect(ctx, c.x, c.y, c.w, c.h, 20, '#1b2340');
    draw.strokeRoundRect(ctx, c.x, c.y, c.w, c.h, 20, 'rgba(255,255,255,0.10)', 1);

    draw.text(ctx, '本局结束', w / 2, c.y + 34, 24, '#ffffff', 'center', true);
    draw.text(ctx, d.reasonText || '', w / 2, c.y + 62, 13, 'rgba(255,255,255,0.65)');

    // 冠军横幅
    if (d.championSeat >= 0) {
      draw.fillRoundRect(ctx, c.x + 16, c.y + 82, c.w - 32, 40, 12, 'rgba(255,199,0,0.16)');
      draw.text(ctx, '★ 本局冠军', w / 2, c.y + 102, 18, '#ffd34d', 'center', true);
    }

    // 排行榜
    var ranks = d.ranks || [];
    var readyMap = this.readyMap();
    for (var i = 0; i < ranks.length; i++) {
      var r = ranks[i];
      var py = this.rowsTop + i * this.rowH + this.rowH / 2;
      var medal = r.rank === 1 ? '#ffd34d' : (r.rank === 2 ? '#cfd8e6' : (r.rank === 3 ? '#d29a5b' : 'rgba(255,255,255,0.6)'));
      draw.fillRoundRect(ctx, c.x + 14, py - this.rowH / 2 + 2, c.w - 28, this.rowH - 6, 10, 'rgba(255,255,255,0.06)');
      draw.text(ctx, String(r.rank), c.x + 34, py, 15, medal, 'center', true);
      var plp = this.players[r.seat] || {};
      avatar.drawAvatar(ctx, c.x + 56, py, 9, plp.avatarUrl, r.nickname, state.seatColor(r.seat), plp.avatarChar);
      // 右侧留白 128px：68px 边距 + “剩 N 格/终点”约 52px + 8px 间隙
      draw.textAutoFit(ctx, r.nickname, c.x + 72, py, c.w - 72 - 128, 13,
        '#ffffff', 'left', r.seat === state.mySeat);
      // 已抵达显示“终点”，未完成显示剩余格数（服务端 game_end.ranks[].remain）
      draw.text(ctx, r.finished ? '终点' : ('剩 ' + r.remain + ' 格'), c.x + c.w - 68, py, 12,
        r.finished ? '#6ee7a8' : 'rgba(255,255,255,0.6)', 'right');
      if (readyMap[r.seat]) draw.text(ctx, '已准备', c.x + c.w - 14, py, 11, '#6ee7a8', 'right');
    }

    // 底部提示 + 按钮
    var st = this.readyStats();
    var ready = this.isReady();
    var hint;
    if (ready) hint = st.ready < st.online ? ('已准备 ' + st.ready + '/' + st.online + '，等待其他玩家…') : '开始新一局…';
    else hint = st.online > 1 ? '全员准备后按同一张地图开始' : '直接按同一张地图开始';
    draw.text(ctx, hint, w / 2, this.buttons[0].y - 14, 12, ready ? '#6ee7a8' : 'rgba(255,255,255,0.6)');

    for (var b = 0; b < this.buttons.length; b++) this.buttons[b].render(ctx);
  };

  return scene;
}

module.exports = { create: create };
