/**
 * 对局场景：棋盘渲染 + 玩家蓄力/上划取消 + 回合结算动画 + 冠军倒计时/超时显示。
 */
var draw = require('../render/draw.js');
var cfg = require('../config.js');
var state = require('../state.js');
var charge = require('../logic/charge.js');
var pathUtil = require('../logic/path.js');

function create() {
  var scene = {
    name: 'game',
    app: null, w: 0, h: 0,
    path: [], players: {}, // seat -> player
    layout: null,
    // 状态
    seq: 0,
    countdownN: 0,
    championDeadline: null, championSeat: -1, championName: '',
    myAllowed: 0, myIndex: 0, myFinished: false, myRank: 0,
    canCharge: false,
    charging: false, canceled: false, startT: 0, startY: 0,
    jumped: false,
    statusHint: '',
    banners: [],
    anims: [],
    startTs: 0, duration: 0
  };

  // ---------------- 生命周期 ----------------
  scene.enter = function (data) {
    this.app = data.app;
    this.w = data.w;
    this.h = data.h;
    this.reset(data.data); // data.data = game_start payload
  };

  scene.reset = function (gs) {
    this.path = gs.path || [];
    this.players = {};
    (gs.players || []).forEach(function (p) {
      scene.players[p.seat] = {
        seat: p.seat,
        nickname: p.nickname,
        color: state.seatColor(p.seat),
        index: 0,
        finished: false,
        rank: 0,
        jumping: false
      };
    });
    this.startTs = gs.startTs || Date.now();
    this.duration = gs.durationSeconds || 300;
    this.seq = 0;
    this.countdownN = 0;
    this.championDeadline = null;
    this.championSeat = -1;
    this.championName = '';
    this.myAllowed = 0;
    this.myIndex = 0;
    this.myFinished = false;
    this.myRank = 0;
    this.canCharge = false;
    this.charging = false;
    this.canceled = false;
    this.jumped = false;
    this.statusHint = '';
    this.banners = [];
    this.anims = [];
    this.layout = this.computeLayout();
  };

  // ---------------- 布局 ----------------
  scene.computeLayout = function () {
    var w = this.w, h = this.h;
    var topH = 56;         // 顶栏
    var listH = 6 * 22 + 8; // 侧栏
    var boardTop = topH + 10;
    var boardBottom = h - 168; // 底部蓄力区
    var boardW = w - 30;
    var boardH = Math.max(40, boardBottom - boardTop);
    var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    this.path.forEach(function (p) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    });
    if (!isFinite(minX)) { minX = 0; maxX = 0; minY = 0; maxY = 0; }
    var spanX = Math.max(1, maxX - minX);
    var spanY = Math.max(1, maxY - minY);
    var cell = Math.min(boardW / spanX, boardH / spanY);
    cell = Math.max(6, Math.min(cell, 52));
    var ox = w / 2 - (minX + maxX) / 2 * cell;
    var oy = (boardTop + boardBottom) / 2 - (minY + maxY) / 2 * cell;
    return { cell: cell, ox: ox, oy: oy, boardTop: boardTop, boardBottom: boardBottom, listH: listH };
  };

  scene.world = function (p) {
    return {
      x: this.layout.ox + p.x * this.layout.cell,
      y: this.layout.oy + p.y * this.layout.cell
    };
  };

  // ---------------- 服务端消息 ----------------
  scene.handleServer = function (type, data) {
    switch (type) {
      case 'countdown':
        this.countdownN = data.n || 0;
        return true;
      case 'wave_start':
        this.onWaveStart(data);
        return true;
      case 'wave_result':
        this.onWaveResult(data);
        return true;
      case 'champion':
        this.championSeat = data.championSeat;
        this.championName = data.nickname || '';
        this.championDeadline = data.deadlineTs || 0;
        this.pushBanner(this.championName + ' 率先抵达终点！', '#ffd34d');
        return true;
      case 'game_end':
        // 记录本局成绩（开放数据域占位）
        (data.ranks || []).forEach(function (r) {
          if (r.seat === state.mySeat) scene.app.recordResult(r.rank, r.finished);
        });
        scene.app.showScene('result', { data: data });
        return true;
    }
    return false;
  };

  scene.onWaveStart = function (data) {
    this.seq = data.seq || 0;
    this.anims = [];
    this.countdownN = 0;
    var selfActive = false;
    var list = data.players || [];
    for (var i = 0; i < list.length; i++) {
      var m = list[i];
      var pl = this.players[m.seat];
      if (pl) {
        pl.index = m.index || 0; // 服务端权威位置（重连/对账用）
        if (m.seat === state.mySeat) {
          selfActive = true;
          this.myIndex = m.index || 0;
          this.myAllowed = m.n || 0;
        }
      }
    }
    this.canCharge = selfActive && !this.myFinished;
    this.charging = false;
    this.canceled = false;
    this.jumped = false;
    this.statusHint = selfActive ? '轮到你：长按蓄力，上划取消' : '等待其他玩家…';
  };

  scene.onWaveResult = function (data) {
    var results = data.results || [];
    var selfOut = false, selfFinish = false, selfRank = 0;
    for (var i = 0; i < results.length; i++) {
      var r = results[i];
      var pl = this.players[r.seat];
      if (!pl) continue;
      if (r.seat === state.mySeat) {
        if (r.isOut) selfOut = true;
        if (r.isFinish) { selfFinish = true; selfRank = r.rank; this.myRank = r.rank; this.myFinished = true; }
      }
      if (r.isFinish) {
        pl.finished = true;
        pl.rank = r.rank;
      }
      var dur = Math.min(750, 250 + (r.steps || 1) * 90);
      this.anims.push({
        seat: r.seat, from: r.from, to: r.index,
        start: Date.now(), dur: dur, isOut: r.isOut
      });
    }
    if (selfOut) this.pushBanner('飞出去了！回到起点', '#ff6b6b');
    else if (selfFinish) this.pushBanner('抵达终点！第 ' + selfRank + ' 名', '#6ee7a8');
    if (selfOut || selfFinish) this.statusHint = '';
  };

  scene.pushBanner = function (text, color) {
    this.banners.push({ text: text, color: color, start: Date.now() });
    if (this.banners.length > 3) this.banners.shift();
  };

  // ---------------- 触摸 ----------------
  scene.onTouchStart = function (x, y) {
    // 蓄力只在“轮到我可跳”时开启
    if (!this.canCharge || this.myFinished || this.charging || this.jumped) return;
    this.charging = true;
    this.canceled = false;
    this.startT = Date.now();
    this.startY = y;
  };

  scene.onTouchMove = function (x, y) {
    if (!this.charging || this.canceled) return;
    if (y < this.startY - cfg.ChargeCancelDy) {
      // 上划取消本次蓄力
      this.canceled = true;
      this.charging = false;
      this.statusHint = '已取消，本回合不动（可再次长按）';
      this.app.send('skip', { seq: this.seq });
      this.jumped = true; // 已向服务端表示跳过，本回合不再动作
    }
  };

  scene.onTouchEnd = function (x, y) {
    if (!this.charging) return;
    var elapsed = Date.now() - this.startT;
    this.charging = false;
    if (this.canceled) return;
    this.jumped = true;
    this.canCharge = false;
    this.statusHint = '等待其他玩家跳跃…';
    this.app.send('jump', { seq: this.seq, elapsedMs: elapsed });
  };

  // ---------------- 帧更新 ----------------
  scene.update = function (dt) {
    var now = Date.now();
    this.anims = this.anims.filter(function (a) {
      if (now - a.start >= a.dur) {
        var pl = scene.players[a.seat];
        if (pl) { pl.index = a.to; pl.jumping = false; }
        return false;
      }
      return true;
    });
    this.banners = this.banners.filter(function (b) { return now - b.start < 1600; });
  };

  // ---------------- 渲染 ----------------
  scene.render = function (ctx) {
    var w = this.w, h = this.h;
    var bg = ctx.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, '#1b2547');
    bg.addColorStop(1, '#0d122b');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    this.renderTopBar(ctx);
    this.renderBoard(ctx);
    this.renderStandings(ctx);
    this.renderChargeUI(ctx);
    this.renderBanners(ctx);

    if (this.countdownN > 0) {
      draw.fillRoundRect(ctx, 0, 0, w, h, 0, 'rgba(0,0,0,0.35)');
      draw.text(ctx, this.countdownN === 1 ? '开始！' : String(this.countdownN), w / 2, h / 2, 96, '#ffffff', 'center', true);
    }
  };

  scene.renderTopBar = function (ctx) {
    var w = this.w;
    var now = Date.now();
    draw.fillRoundRect(ctx, 0, 0, w, 50, 0, 'rgba(0,0,0,0.35)');
    var color = '#ffffff';
    var txt;
    if (this.championDeadline) {
      var remain = Math.max(0, Math.ceil((this.championDeadline - now) / 1000));
      txt = '冠军冲刺 ' + remain + 's';
      color = '#ffd34d';
    } else {
      var left = this.duration - (now - this.startTs) / 1000;
      txt = '剩余 ' + draw.fmtClock(left);
      if (left < 30) color = '#ff6b6b';
    }
    draw.text(ctx, txt, w / 2, 25, 20, color, 'center', true);
  };

  scene.renderStandings = function (ctx) {
    var w = this.w;
    var self = this;
    var seats = Object.keys(this.players).map(Number).sort(function (a, b) {
      var pa = self.players[a], pb = self.players[b];
      return (pb.finished ? 1 : 0) - (pa.finished ? 1 : 0) ||
        (pa.index - pb.index) || (a - b);
    });
    var x = 8;
    var y = 58;
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    ctx.fillRect(0, 54, w, seats.length * 24 + 6);
    for (var i = 0; i < seats.length; i++) {
      var pl = this.players[seats[i]];
      var py = 66 + i * 24;
      ctx.fillStyle = pl.color;
      ctx.beginPath();
      ctx.arc(x + 6, py, 5, 0, Math.PI * 2);
      ctx.fill();
      var marker = pl.seat === state.mySeat ? '▸' : '';
      var pos = pl.finished ? '终点' : ('第' + (pl.index + 1) + '格');
      draw.text(ctx, marker + pl.nickname, x + 16, py, 11, pl.seat === state.mySeat ? '#ffffff' : 'rgba(255,255,255,0.75)', 'left');
      draw.text(ctx, pos, w - 8, py, 11, pl.finished ? '#6ee7a8' : 'rgba(255,255,255,0.6)', 'right');
    }
  };

  scene.renderBoard = function (ctx) {
    var self = this;
    var path = this.path;
    if (!path || path.length === 0) return;

    // 连线
    ctx.strokeStyle = 'rgba(120,150,255,0.35)';
    ctx.lineWidth = this.layout.cell * 0.35;
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (var i = 0; i < path.length; i++) {
      var s = this.world(path[i]);
      if (i === 0) ctx.moveTo(s.x, s.y); else ctx.lineTo(s.x, s.y);
    }
    ctx.stroke();

    // 格子
    var cell = this.layout.cell;
    for (var j = 0; j < path.length; j++) {
      var p0 = this.world(path[j]);
      var isStart = j === 0;
      var isEnd = j === path.length - 1;
      var col = isStart ? '#2f9e44' : (isEnd ? '#e8590c' : '#4a5a9e');
      draw.fillRoundRect(ctx, p0.x - cell * 0.34, p0.y - cell * 0.34, cell * 0.68, cell * 0.68, cell * 0.16, col);
      if (isEnd) {
        draw.text(ctx, '终', p0.x, p0.y + 1, Math.max(9, cell * 0.3), '#ffffff', 'center', true);
      }
      // 拐弯箭头
      if (j < path.length - 1 && j > 0) {
        var prev = path[j - 1], cur = path[j], next = path[j + 1];
        var dInX = cur.x - prev.x, dInY = cur.y - prev.y;
        var dOutX = next.x - cur.x, dOutY = next.y - cur.y;
        if (dInX !== dOutX || dInY !== dOutY) {
          this.drawArrow(ctx, p0.x + dOutX * cell * 0.42, p0.y + dOutY * cell * 0.42, dOutX, dOutY, cell * 0.16, 'rgba(255,255,255,0.85)');
        }
      }
    }

    // 玩家
    var seats = Object.keys(this.players).map(Number);
    for (var k = 0; k < seats.length; k++) this.renderToken(ctx, seats[k]);
  };

  scene.drawArrow = function (ctx, x, y, dx, dy, size, color) {
    if (dx === 0 && dy === 0) return;
    var len = Math.sqrt(dx * dx + dy * dy);
    var ux = dx / len, uy = dy / len;
    var px = -uy, py = ux;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x + ux * size, y + uy * size);
    ctx.lineTo(x - ux * size * 0.6 + px * size * 0.7, y - uy * size * 0.6 + py * size * 0.7);
    ctx.lineTo(x - ux * size * 0.6 - px * size * 0.7, y - uy * size * 0.6 - py * size * 0.7);
    ctx.closePath();
    ctx.fill();
  };

  scene.tokenPx = function (seat) {
    var pl = this.players[seat];
    var t = 1;
    var from = pl.index;
    for (var i = 0; i < this.anims.length; i++) {
      if (this.anims[i].seat === seat) {
        var a = this.anims[i];
        t = Math.min(1, (Date.now() - a.start) / a.dur);
        from = a.from;
        break;
      }
    }
    var cell = this.layout.cell;
    var idx = Math.round(from + (pl.index - from) * t);
    var pos = this.path[Math.max(0, Math.min(this.path.length - 1, idx))];
    var base = this.world(pos);
    var offset = this.seatOffset(seat, cell);
    return { x: base.x + offset.x, y: base.y + offset.y, t: t, idx: idx };
  };

  scene.seatOffset = function (seat, cell) {
    var ring = 0.32 * cell;
    var angles = [0, 2.4, 4.0, 1.2, 3.6, 5.2];
    var a = angles[seat % angles.length];
    return { x: Math.cos(a) * ring, y: Math.sin(a) * ring };
  };

  scene.renderToken = function (ctx, seat) {
    var pl = this.players[seat];
    if (!pl) return;
    var tp = this.tokenPx(seat);
    var r = Math.max(6, this.layout.cell * 0.24);
    var jumping = tp.t < 1;
    // 跳跃拉伸效果（按比例压扁/拉长由 t 计算，简单缩放）
    var sy = jumping ? (1 + 0.18 * Math.sin(tp.t * Math.PI)) : 1;
    ctx.save();
    ctx.translate(tp.x, tp.y);
    ctx.scale(1, sy);
    ctx.fillStyle = pl.color;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = pl.finished ? '#ffd34d' : (pl.seat === state.mySeat ? '#ffffff' : 'rgba(255,255,255,0.5)');
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();

    // 自己的箭头标识
    if (pl.seat === state.mySeat) {
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.moveTo(tp.x, tp.y - r - 8);
      ctx.lineTo(tp.x - 5, tp.y - r - 16);
      ctx.lineTo(tp.x + 5, tp.y - r - 16);
      ctx.closePath();
      ctx.fill();
    }
    if (pl.finished) {
      draw.text(ctx, String(pl.rank), tp.x, tp.y, Math.max(8, r * 0.8), '#ffffff', 'center', true);
    }
  };

  scene.renderChargeUI = function (ctx) {
    var w = this.w, h = this.h;

    // 底部操作区背景
    draw.fillRoundRect(ctx, 0, h - 158, w, 158, 0, 'rgba(0,0,0,0.25)');

    // 已抵达终点：只显示状态
    if (this.myFinished) {
      draw.text(ctx, '你已抵达终点（第 ' + this.myRank + ' 名）', w / 2, h - 60, 16, '#6ee7a8', 'center', true);
      draw.text(ctx, '等待对局结束…', w / 2, h - 24, 13, 'rgba(255,255,255,0.7)');
      return;
    }

    // 未轮到本玩家：仅提示
    if (!this.canCharge || !this.myAllowed) {
      var t = this.jumped ? '已跳跃，等待其他玩家…' : (this.statusHint || '等待回合开始…');
      draw.text(ctx, t, w / 2, h - 40, 15, 'rgba(255,255,255,0.8)');
      return;
    }

    var barY = h - 118;
    var barH = 46;
    var x0 = w * 0.08, x1 = w * 0.92;
    var barW = x1 - x0;
    var n = this.myAllowed;

    // 进度条轨道
    draw.fillRoundRect(ctx, x0, barY, barW, barH, barH / 2, 'rgba(255,255,255,0.14)');

    // 本直线段安全步数（本地提示）
    var safe = pathUtil.segmentSafe(this.path, this.myIndex);
    var current = this.charging ? charge.stepsForMs(Date.now() - this.startT, n) : 0;

    var seg = barW / n;
    var fillColors = ['#6ee7a8', '#c9f24a', '#ffd93d', '#ff9f43', '#ff6b6b'];
    for (var i = 0; i < n; i++) {
      var cx = x0 + seg * i + 2;
      var cw = seg - 4;
      var color = 'rgba(255,255,255,0.08)';
      if (this.charging && i < current) {
        color = fillColors[Math.min(fillColors.length - 1, Math.floor(i / Math.max(1, n - 1) * (fillColors.length - 1)))];
      }
      draw.fillRoundRect(ctx, cx, barY + 4, cw, barH - 8, 6, color);
      if (!this.charging && (i === 0 || i === n - 1 || n <= 6)) {
        draw.text(ctx, String(i + 1), cx + cw / 2, barY + barH / 2, Math.max(10, Math.min(14, seg * 0.5)), 'rgba(255,255,255,0.85)', 'center');
      }
    }

    if (this.charging && current > safe) {
      draw.text(ctx, '危险！将飞出边界，上划取消', w / 2, barY + barH / 2, 16, '#ff6b6b', 'center', true);
    } else if (this.charging && current > 0) {
      draw.text(ctx, current + ' 步', w / 2, barY + barH / 2, 20, '#ffffff', 'center', true);
    } else if (!this.charging) {
      draw.text(ctx, '长按蓄力 · 上划取消', w / 2, barY + barH / 2, 13, 'rgba(255,255,255,0.7)');
    }
  };

  scene.renderBanners = function (ctx) {
    var w = this.w;
    var y0 = 78;
    for (var i = 0; i < this.banners.length; i++) {
      var b = this.banners[i];
      var alpha = 1;
      var age = Date.now() - b.start;
      if (age > 1200) alpha = Math.max(0, 1 - (age - 1200) / 400);
      ctx.globalAlpha = alpha;
      draw.text(ctx, b.text, w / 2, y0 + i * 26, 17, b.color, 'center', true);
      ctx.globalAlpha = 1;
    }
  };

  return scene;
}

module.exports = { create: create };
