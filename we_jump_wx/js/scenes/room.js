/**
 * 房间场景：展示成员、房主选图/开局/分享、退出。
 */
var draw = require('../render/draw.js');
var Button = require('../ui/button.js');
var state = require('../state.js');
var mapMeta = require('../logic/mapMeta.js');
var avatar = require('../render/avatar.js');

/** 在 size×size 的框内绘制地图路径缩略图（无路径时显示占位）。 */
function drawMapThumb(ctx, bx, by, size, path) {
  draw.fillRoundRect(ctx, bx, by, size, size, 8, 'rgba(255,255,255,0.08)');
  if (!path || path.length < 2) {
    draw.text(ctx, '无预览', bx + size / 2, by + size / 2, 10, 'rgba(255,255,255,0.5)', 'center');
    return;
  }
  var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (var i = 0; i < path.length; i++) {
    var p = path[i];
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  var pad = 8;
  var avail = size - pad * 2;
  var spanX = Math.max(1, maxX - minX), spanY = Math.max(1, maxY - minY);
  var k = Math.min(avail / spanX, avail / spanY);
  var ox = bx + pad + (avail - spanX * k) / 2 - minX * k;
  var oy = by + pad + (avail - spanY * k) / 2 - minY * k;

  ctx.strokeStyle = 'rgba(140,170,255,0.9)';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  for (var j = 0; j < path.length; j++) {
    var sx = ox + path[j].x * k, sy = oy + path[j].y * k;
    if (j === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
  }
  ctx.stroke();

  ctx.fillStyle = '#2f9e44';
  ctx.beginPath(); ctx.arc(ox + path[0].x * k, oy + path[0].y * k, 2.6, 0, Math.PI * 2); ctx.fill();
  var last = path[path.length - 1];
  ctx.fillStyle = '#e8590c';
  ctx.beginPath(); ctx.arc(ox + last.x * k, oy + last.y * k, 2.6, 0, Math.PI * 2); ctx.fill();
}

function create() {
  var scene = {
    name: 'room',
    app: null, w: 0, h: 0,
    buttons: []
  };

  scene.enter = function (data) {
    this.app = data.app;
    this.w = data.w;
    this.h = data.h;
    this.pickerOpen = false;
    this.rebuild();
  };

  scene.isHost = function () {
    return !!(state.room && state.room.hostSeat === state.mySeat);
  };

  scene.rebuild = function () {
    var w = this.w, h = this.h;
    var buttons = [];
    var isHost = this.isHost();
    var ended = !!(state.room && state.room.phase === 2);   // 上一局已结束（重进房间时）
    var bw = Math.min(w * 0.7, 280);
    var bh = 46;
    var gap = 14;
    var cx = w / 2;

    // 按实际按钮数量自下而上排列，避免按钮超出屏幕
    var items = [];
    if (isHost) {
      if (ended) {
        items.push({ label: '再来一局', bg: '#12b76a', tap: function () { scene.app.send('again', {}); } });
      } else {
        items.push({ label: '开始游戏', bg: '#12b76a', tap: function () { scene.app.send('start_game', {}); } });
        items.push({ label: '选择地图', bg: '#4a7dff', tap: function () { scene.pickMap(); } });
      }
      items.push({ label: '分享房间', bg: '#8b5cf6', tap: function () { scene.shareRoom(); } });
      items.push({ label: '离开房间', bg: '#e5484d', tap: function () { scene.app.leaveRoom(); } });
    } else {
      items.push({ label: '离开房间', bg: '#e5484d', tap: function () { scene.app.leaveRoom(); } });
    }

    var y = h - 60 - bh * items.length - gap * (items.length - 1);
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      buttons.push(new Button(cx - bw / 2, y + i * (bh + gap), bw, bh, it.label, it.tap, { bg: it.bg }));
    }
    this.buttons = buttons;
  };

  scene.pickMap = function () {
    this.pickerOpen = true;
  };

  /** 选图面板布局（行 / 取消按钮的命中区域）。 */
  scene.pickerLayout = function () {
    var w = this.w, h = this.h;
    var items = (state.mapList && state.mapList.length) ? state.mapList : mapMeta;
    var rowH = 78, gap = 8;
    var blockH = items.length * rowH;
    // 顶部至少留出安全区（刘海/状态栏），底部留出取消按钮
    var y0 = Math.max((state.safeTop || 0) + 30, (h - blockH - 56) / 2);
    var rows = [];
    for (var i = 0; i < items.length; i++) {
      rows.push({ x: 12, y: y0 + i * rowH, w: w - 24, h: rowH - gap, item: items[i] });
    }
    var close = { x: w / 2 - 60, y: y0 + blockH + 6, w: 120, h: 40 };
    return { items: items, rows: rows, close: close, titleY: y0 - 22 };
  };

  /** 选图面板：每张地图显示缩略图 + 名称 / 难度 / 格数 / 拐弯数。 */
  scene.renderPicker = function (ctx) {
    var w = this.w, h = this.h;
    var lay = this.pickerLayout();
    // 不透明底：选图时不再透出下层房间内容
    var g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#1f2a55');
    g.addColorStop(1, '#0e1330');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    draw.text(ctx, '选择地图', w / 2, lay.titleY, 20, '#ffffff', 'center', true);
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(24, lay.titleY + 18);
    ctx.lineTo(w - 24, lay.titleY + 18);
    ctx.stroke();

    var curId = state.room ? state.room.mapId : 0;
    for (var i = 0; i < lay.rows.length; i++) {
      var r = lay.rows[i];
      var it = r.item;
      var cur = it.id === curId;
      draw.fillRoundRect(ctx, r.x, r.y, r.w, r.h, 12, cur ? 'rgba(74,125,255,0.30)' : 'rgba(255,255,255,0.07)');
      if (cur) draw.strokeRoundRect(ctx, r.x, r.y, r.w, r.h, 12, '#4a7dff', 2);
      drawMapThumb(ctx, r.x + 8, r.y + 4, r.h - 8, it.path);
      var tx = r.x + r.h + 12;
      draw.text(ctx, it.name, tx, r.y + 22, 16, '#ffffff', 'left', true);
      draw.text(ctx,
        (it.difficulty || '') + ' · ' + (it.totalCells || 0) + ' 格 · ' + (it.turnCount || 0) + ' 拐弯 · ' + Math.round((it.durationSeconds || 0) / 60) + ' 分钟',
        tx, r.y + 46, 11, 'rgba(255,255,255,0.65)', 'left');
      if (cur) draw.text(ctx, '当前', r.x + r.w - 16, r.y + r.h / 2, 12, '#4a7dff', 'right', true);
    }

    var c = lay.close;
    draw.fillRoundRect(ctx, c.x, c.y, c.w, c.h, c.h / 2, 'rgba(255,255,255,0.14)');
    draw.text(ctx, '取消', c.x + c.w / 2, c.y + c.h / 2, 15, '#ffffff', 'center');
  };

  scene.shareRoom = function () {
    if (!state.room) return;
    wx.shareAppMessage({
      title: '一起来玩《多人跳一跳》！房间号 ' + state.room.roomNo,
      query: 'room=' + state.room.roomNo
    });
  };

  scene.handleServer = function (type, data) {
    if (type === 'room_state') {
      state.room = data;
      this.rebuild();
      return true;
    }
    return false;
  };

  scene.onTouchEnd = function (x, y) {
    if (this.pickerOpen) {
      var lay = this.pickerLayout();
      var c = lay.close;
      if (x >= c.x && x <= c.x + c.w && y >= c.y && y <= c.y + c.h) { this.pickerOpen = false; return; }
      for (var i = 0; i < lay.rows.length; i++) {
        var r = lay.rows[i];
        if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) {
          this.pickerOpen = false;
          this.app.send('select_map', { mapId: r.item.id });
          return;
        }
      }
      return; // 面板打开时吞掉其余点击，避免误触下层按钮
    }
    for (var k = 0; k < this.buttons.length; k++) {
      var b = this.buttons[k];
      if (!b.disabled && b.hit(x, y)) { b.onTap(); return; }
    }
  };

  scene.render = function (ctx) {
    var w = this.w, h = this.h;
    var g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#1f2a55');
    g.addColorStop(1, '#0e1330');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    if (!state.room) return;

    var pad = state.safeTop || 0;
    var roomY = Math.max(56, pad + 16);                  // 避开刘海/状态栏
    draw.text(ctx, '房间号 ' + state.room.roomNo, w / 2, roomY, 28, '#ffffff', 'center', true);

    var mapName = '未知地图';
    var dm = state.room.mapId;
    var src = (state.mapList && state.mapList.length) ? state.mapList : mapMeta;
    for (var i = 0; i < src.length; i++) if (src[i].id === dm) mapName = src[i].name;
    var mapY = roomY + 40;
    draw.text(ctx, '当前地图：' + mapName + '（房主可更换）', w / 2, mapY, 14, 'rgba(255,255,255,0.75)');

    // 成员列表（6 个位置：已加入的显示资料，其余显示空位）
    var players = state.room.players || [];
    var maxSlots = 6;
    var rowX = w * 0.08, rowW = w * 0.84;
    var listTop = mapY + 30;
    var btnTop = this.buttons.length ? this.buttons[0].y : h - 60;
    var avail = Math.max(150, btnTop - listTop - 10);
    var pitch = Math.max(26, Math.min(38, avail / maxSlots));   // 自适应行高，避免与下方按钮重叠
    var rowH = pitch - 6;
    var rowR = Math.min(14, rowH / 2);

    draw.text(ctx, '成员', rowX, listTop, 14, '#ffffff', 'left', true);
    draw.text(ctx, players.length + ' / ' + maxSlots, rowX + rowW, listTop, 13, 'rgba(255,255,255,0.55)', 'right');

    for (var j = 0; j < maxSlots; j++) {
      var py = listTop + 14 + pitch / 2 + j * pitch;
      var p = players[j];

      if (!p) {
        // 空位
        draw.fillRoundRect(ctx, rowX, py - rowH / 2, rowW, rowH, rowR, 'rgba(255,255,255,0.03)');
        ctx.strokeStyle = 'rgba(255,255,255,0.16)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(rowX + rowH / 2 + 2, py, Math.max(8, rowH * 0.36), 0, Math.PI * 2);
        ctx.stroke();
        draw.text(ctx, '等待玩家加入…', rowX + rowH + 12, py, 12, 'rgba(255,255,255,0.28)', 'left');
        continue;
      }

      var isMe = p.seat === state.mySeat;
      var isHostSeat = p.seat === state.room.hostSeat;

      // 行底：自己高亮 + 描边
      draw.fillRoundRect(ctx, rowX, py - rowH / 2, rowW, rowH, rowR,
        isMe ? 'rgba(74,125,255,0.26)' : 'rgba(255,255,255,0.07)');
      if (isMe) draw.strokeRoundRect(ctx, rowX, py - rowH / 2, rowW, rowH, rowR, 'rgba(122,160,255,0.9)', 1.5);

      // 头像（圆环用座位色，未加载时用昵称首字）
      var ar = Math.max(9, rowH * 0.34);
      var ax = rowX + rowH / 2 + 2;
      avatar.drawAvatar(ctx, ax, py, ar, p.avatarUrl, p.nickname, state.seatColor(p.seat));
      ctx.strokeStyle = state.seatColor(p.seat);
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(ax, py, ar + 1.5, 0, Math.PI * 2); ctx.stroke();

      // 房主徽标（头像左上角）
      if (isHostSeat) {
        draw.fillRoundRect(ctx, ax - ar - 3, py - ar - 3, 15, 15, 7, '#ffd34d');
        draw.text(ctx, '房', ax - ar + 4.5, py - ar + 4.5, 9, '#3a2a00', 'center', true);
      }

      // 昵称（自适应宽度，不压到状态文字）
      var statusW = 48;
      var nameX = ax + ar + 10;
      var nm = p.nickname + (isMe ? '（我）' : '');
      draw.textAutoFit(ctx, nm, nameX, py, Math.max(40, rowX + rowW - 12 - statusW - nameX), 13,
        isMe ? '#ffffff' : 'rgba(255,255,255,0.9)', 'left', isMe);

      // 在线状态：小圆点 + 文字
      var dotX = rowX + rowW - statusW;
      ctx.fillStyle = p.online ? '#6ee7a8' : 'rgba(255,255,255,0.35)';
      ctx.beginPath(); ctx.arc(dotX, py, 3.5, 0, Math.PI * 2); ctx.fill();
      draw.text(ctx, p.online ? '在线' : '离线', dotX + 8, py, 11,
        p.online ? '#6ee7a8' : 'rgba(255,255,255,0.45)', 'left');
    }

    var ended = !!(state.room && state.room.phase === 2);
    var hint = ended
      ? (this.isHost() ? '上一局已结束，点「再来一局」继续' : '上一局已结束，等待房主再来一局…')
      : (this.isHost() ? '1 人也可开始（单人练习）' : '等待房主选择地图并开始游戏…');
    draw.text(ctx, hint, w / 2, h - 20, 12, 'rgba(255,255,255,0.6)');

    for (var b = 0; b < this.buttons.length; b++) this.buttons[b].render(ctx);

    if (this.pickerOpen) this.renderPicker(ctx);
  };

  return scene;
}

module.exports = { create: create };
