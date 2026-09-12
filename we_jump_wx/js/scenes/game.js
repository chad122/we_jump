/**
 * 对局场景：相机跟随 + 视角随转弯旋转的棋盘渲染 + 自由蓄力/上划取消 + 实时移动动画。
 */
var draw = require('../render/draw.js');
var cfg = require('../config.js');
var state = require('../state.js');
var charge = require('../logic/charge.js');
var pathUtil = require('../logic/path.js');
var avatar = require('../render/avatar.js');

function create() {
  var scene = {
    name: 'game',
    app: null, w: 0, h: 0,
    path: [], players: {}, // seat -> player
    layout: null,
    // 状态
    countdownN: 0,
    championDeadline: null, championSeat: -1, championName: '',
    myAllowed: 0, myIndex: 0, myFinished: false, myRank: 0,
    canCharge: false,      // 是否可开始蓄力（自由跳跃；落地后短暂冷却）
    charging: false, startT: 0, startY: 0,
    cooldownUntil: 0,      // 落地恢复结束时间
    statusHint: '',
    banners: [],
    anims: [],
    startTs: 0, duration: 0,
    live: false,           // 3-2-1 结束、进入可自由跳跃状态
    cam: { x: 0, y: 0 },   // 相机：锚定在屏幕锚点上的世界格坐标
    rot: 0,                // 当前视角旋转（弧度；正前方恒为屏幕上方）
    rotCos: 1, rotSin: 0   // 旋转三角缓存
  };

  // ---------------- 生命周期 ----------------
  scene.enter = function (data) {
    this.app = data.app;
    this.w = data.w;
    this.h = data.h;
    this.reset(data.data); // data.data = game_start / game_state 快照
    if (data.resume) {
      // 断线重连进入进行中的对局：直接可跳
      this.live = true;
      this.canCharge = !this.myFinished;
      this.statusHint = this.myFinished ? '' : '长按蓄力起跳';
    }
  };

  /** 用服务端状态快照重建玩家与对局信息（game_start 与 game_state 同构）。 */
  scene.applyState = function (gs) {
    this.path = gs.path || this.path;
    // 蓄力规则参数全部由服务端下发（客户端不再内置常量）
    charge.apply(gs);
    var players = {};
    (gs.players || []).forEach(function (p) {
      players[p.seat] = {
        seat: p.seat,
        nickname: p.nickname,
        avatarUrl: p.avatarUrl || '',
        color: state.seatColor(p.seat),
        index: p.index || 0,
        finished: !!p.finished,
        rank: p.rank || 0,
        jumping: false
      };
    });
    this.players = players;
    this.startTs = gs.startTs || this.startTs || Date.now();
    this.duration = gs.durationSeconds || this.duration || 300;
    this.championDeadline = gs.championDeadline || null;
    this.championSeat = (gs.championSeat != null) ? gs.championSeat : -1;
    this.championName = gs.championName || '';
    this.anims = [];
    this.myIndex = 0;
    this.myFinished = false;
    this.myRank = 0;
    var me = this.players[state.mySeat];
    if (me) {
      this.myIndex = me.index;
      this.myFinished = me.finished;
      this.myRank = me.rank;
    }
    this.refreshAllowed();
  };

  scene.reset = function (gs) {
    this.countdownN = 0;
    this.canCharge = false;
    this.charging = false;
    this.cooldownUntil = 0;
    this.statusHint = '';
    this.banners = [];
    this.anims = [];
    this.live = false;
    this.applyState(gs);
    this.layout = this.computeLayout();
    // 相机直接对准自己（开局：起点在屏幕下方中央），视角直接对准前方
    var p = this.playerWorld(state.mySeat);
    this.cam.x = p.x;
    this.cam.y = p.y;
    this.rot = this.rotationFor(this.myIndex);
    this.rotCos = Math.cos(this.rot);
    this.rotSin = Math.sin(this.rot);
  };

  /** 依当前所在格重算可跳格数 N（进度条格数）。 */
  scene.refreshAllowed = function () {
    if (!this.path || this.path.length === 0) { this.myAllowed = 0; return; }
    this.myAllowed = pathUtil.allowedN(this.path, this.myIndex);
  };

  // ---------------- 布局 / 坐标 ----------------
  // 固定格子像素 + 相机跟随：玩家始终位于可视区下方中央，只渲染可视区附近的格子。
  scene.computeLayout = function () {
    var w = this.w, h = this.h;
    var pad = state.safeTop || 0;                     // 刘海屏顶部留白
    var padB = state.safeBottom || 0;                 // 底部 home indicator 留白
    var btnR = Math.max(38, Math.min(54, w * 0.14));  // 蓄力按钮半径
    var miniSide = Math.min(w * 0.32, 104);
    // 小地图同时避让刘海与右上角胶囊按钮
    var miniY = Math.max(pad + 10, (state.capsuleBottom || 0) + 8);
    var topH = Math.max(pad + 150, miniY + miniSide + 6);  // 顶部信息区（排名 + 提示 + 名次列表）
    var boardTop = topH;
    var boardBottom = h - padB - (btnR * 2 + 26);
    // 格子“扁宽”：横向继续加大（一格里能并排 6 个玩家），纵向压扁
    var cellW = Math.max(72, Math.min(120, (w - 32) / 3.2));
    var cellH = Math.max(34, cellW * 0.56);
    var mini = { x: w - miniSide - 10, y: miniY, side: miniSide };
    return {
      topH: topH,
      pad: pad,
      cellW: cellW,
      cellH: cellH,
      boardTop: boardTop,
      boardBottom: boardBottom,
      anchorX: w / 2,
      anchorY: boardBottom - cellH * 0.9,
      mini: mini,
      btn: { x: w / 2, y: h - padB - btnR - 10, r: btnR }
    };
  };

  /** 世界向量 -> 屏幕向量（应用当前视角旋转）。 */
  scene.rotateVec = function (vx, vy) {
    return { x: vx * this.rotCos - vy * this.rotSin, y: vx * this.rotSin + vy * this.rotCos };
  };

  /** 世界格坐标 -> 屏幕像素坐标（相机 + 视角旋转；正前方恒为屏幕上方，横纵尺度可不同）。 */
  scene.world = function (p) {
    var L = this.layout;
    // 先在“格子坐标系”里按横/纵各自缩放，再做视角旋转
    var v = this.rotateVec((p.x - this.cam.x) * L.cellW, (p.y - this.cam.y) * L.cellH);
    return { x: L.anchorX + v.x, y: L.anchorY + v.y };
  };

  /** 以某格为起点、指向下一格的方向（终点时沿用最后一段）。 */
  scene.headingAt = function (index) {
    var path = this.path;
    if (!path || path.length < 2) return { x: 0, y: -1 };
    var last = path.length - 1;
    var i = Math.max(0, Math.min(last, index));
    var j = (i + 1 <= last) ? (i + 1) : (i - 1);
    var dx = path[j].x - path[i].x, dy = path[j].y - path[i].y;
    var len = Math.sqrt(dx * dx + dy * dy) || 1;
    return { x: dx / len, y: dy / len };
  };

  /** 让“当前前进方向”指向屏幕上方所需的旋转角。 */
  scene.rotationFor = function (index) {
    var h = this.headingAt(index);
    return -Math.PI / 2 - Math.atan2(h.y, h.x);
  };

  /** 某玩家当前的世界格坐标（含跳跃弧线抬升，lift 单位为格）。 */
  scene.playerWorld = function (seat) {
    var pl = this.players[seat];
    var path = this.path;
    if (!pl || !path || path.length === 0) return { x: 0, y: 0, lift: 0, t: 1 };
    var last = path.length - 1;
    var anim = null;
    for (var i = 0; i < this.anims.length; i++) {
      if (this.anims[i].seat === seat) { anim = this.anims[i]; break; }
    }
    if (!anim) {
      var p0 = path[Math.max(0, Math.min(last, pl.index))];
      return { x: p0.x, y: p0.y, lift: 0, t: 1 };
    }
    var t = Math.min(1, (Date.now() - anim.start) / anim.dur);
    if (anim.isOut) {
      // 出界：从当前格直线飞回起点，高弧线
      var oa = path[Math.max(0, Math.min(last, anim.from))];
      var ob = path[Math.max(0, Math.min(last, anim.to))];
      return {
        x: oa.x + (ob.x - oa.x) * t,
        y: oa.y + (ob.y - oa.y) * t,
        lift: Math.sin(Math.PI * t) * 1.6,
        t: t
      };
    }
    // 正常：一次跳到目标格（整段一条抛物线，不再逐格蹦）
    var a = path[Math.max(0, Math.min(last, anim.from))];
    var b = path[Math.max(0, Math.min(last, anim.to))];
    var dist = Math.max(1, anim.to - anim.from);
    var amp = Math.min(1.1, 0.45 + 0.1 * (dist - 1));   // 跳得越远弧线越高
    return {
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t,
      lift: Math.sin(Math.PI * t) * amp,
      t: t
    };
  };

  // ---------------- 服务端消息 ----------------
  scene.handleServer = function (type, data) {
    switch (type) {
      case 'countdown':
        this.countdownN = data.n || 0;
        if (this.countdownN === 0) {
          // 开始：此后可各自自由跳跃
          this.live = true;
          this.canCharge = !this.myFinished;
          this.statusHint = this.myFinished ? '' : '长按蓄力起跳';
        }
        return true;
      case 'player_move':
        this.onPlayerMove(data);
        return true;
      case 'game_state':
        this.applyState(data);
        this.live = true;
        this.canCharge = !this.myFinished;
        this.statusHint = this.myFinished ? '' : '长按蓄力起跳';
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
        scene.app.showScene('result', { data: data, players: scene.players });
        return true;
    }
    return false;
  };

  /** 收到某位玩家的一次移动结算：立即播放动画；若是自己，则更新状态并进入落地冷却。 */
  scene.onPlayerMove = function (m) {
    var pl = this.players[m.seat];
    if (pl) {
      if (m.isFinish) { pl.finished = true; pl.rank = m.rank; }
      var dur = Math.min(750, 250 + (m.steps || 1) * 90);
      this.anims.push({
        seat: m.seat, from: m.from, to: m.index,
        start: Date.now(), dur: dur, isOut: m.isOut
      });
    }

    if (m.seat !== state.mySeat) return;

    this.myIndex = m.index;
    if (m.isFinish) {
      this.myFinished = true;
      this.myRank = m.rank;
      this.canCharge = false;
      this.statusHint = '';
      this.pushBanner('抵达终点！第 ' + m.rank + ' 名', '#6ee7a8');
    } else if (m.isOut) {
      this.pushBanner('飞出去了！回到起点', '#ff6b6b');
      this.startCooldown();
    } else {
      this.startCooldown();
    }
    this.refreshAllowed();
  };

  /** 落地恢复：短暂冷却后才能再次蓄力。 */
  scene.startCooldown = function () {
    this.canCharge = false;
    this.cooldownUntil = Date.now() + cfg.JumpCooldownMs;
    this.statusHint = '落地恢复中…';
  };

  scene.pushBanner = function (text, color) {
    this.banners.push({ text: text, color: color, start: Date.now() });
    if (this.banners.length > 3) this.banners.shift();
  };

  // ---------------- 触摸 ----------------
  /** 是否点中底部蓄力按钮。 */
  scene.inChargeButton = function (x, y) {
    var b = this.layout && this.layout.btn;
    if (!b) return false;
    var dx = x - b.x, dy = y - b.y;
    return dx * dx + dy * dy <= b.r * b.r;
  };

  scene.onTouchStart = function (x, y) {
    if (!this.live || !this.canCharge || this.myFinished || this.charging) return;
    if (!this.inChargeButton(x, y)) return; // 蓄力只能从按钮开始
    this.charging = true;
    this.startT = Date.now();
    this.startY = y;
  };

  scene.onTouchMove = function (x, y) {
    if (!this.charging) return;
    if (y < this.startY - cfg.ChargeCancelDy) {
      // 上划取消：放弃本次蓄力，可立即重新长按
      this.charging = false;
      this.statusHint = '已取消蓄力';
      this.canCharge = true;
    }
  };

  scene.onTouchEnd = function (x, y) {
    if (!this.charging) return;
    var elapsed = Date.now() - this.startT;
    this.charging = false;
    this.canCharge = false;
    this.statusHint = '落地恢复中…';
    this.app.send('jump', { elapsedMs: elapsed });
    this.startCooldown();
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

    // 落地冷却结束 → 恢复可蓄力
    if (this.live && !this.myFinished && !this.charging && !this.canCharge &&
        this.cooldownUntil && now >= this.cooldownUntil) {
      this.canCharge = true;
      this.cooldownUntil = 0;
      this.statusHint = '长按下方按钮蓄力';
    }

    // 相机缓动跟随自己：始终把自己放在可视区下方中央
    if (this.layout) {
      var me = this.playerWorld(state.mySeat);
      var k = Math.min(1, (dt || 16) / 110);
      this.cam.x += (me.x - this.cam.x) * k;
      this.cam.y += (me.y - this.cam.y) * k;

      // 视角缓动转向“前进方向”：转弯时视角跟着转弯，正前方恒为屏幕上方
      var target = this.rotationFor(this.myIndex);
      var diff = target - this.rot;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      this.rot += diff * Math.min(1, (dt || 16) / 160);
      this.rotCos = Math.cos(this.rot);
      this.rotSin = Math.sin(this.rot);
    }
  };

  // ---------------- 渲染 ----------------
  scene.render = function (ctx) {
    var w = this.w, h = this.h;
    var bg = ctx.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, '#1b2547');
    bg.addColorStop(1, '#0d122b');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    this.renderBoard(ctx);        // 视口内的棋盘（相机跟随）
    this.renderTopBar(ctx);       // 左上角：当前排名 + 状态提示
    this.renderStandings(ctx);    // 左上角：名次列表（在排名下方）
    this.renderTimeLeft(ctx);     // 左下角：剩余时间 / 冠军冲刺倒计时
    this.renderMinimap(ctx);      // 右上角：完整地图 + 当前位置
    this.renderChargeButton(ctx); // 底部中央：蓄力按钮
    this.renderBanners(ctx);

    if (this.countdownN > 0) {
      draw.fillRoundRect(ctx, 0, 0, w, h, 0, 'rgba(0,0,0,0.35)');
      draw.text(ctx, this.countdownN === 1 ? '开始！' : String(this.countdownN), w / 2, h / 2, 96, '#ffffff', 'center', true);
    }
  };

  /** 排序后的座位：已抵达终点的按名次在前，其余按当前格数从多到少。 */
  scene.sortedSeats = function () {
    var self = this;
    return Object.keys(this.players).map(Number).sort(function (a, b) {
      var pa = self.players[a], pb = self.players[b];
      var fa = pa.finished ? 0 : 1, fb = pb.finished ? 0 : 1;
      if (fa !== fb) return fa - fb;
      if (pa.finished && pb.finished) return pa.rank - pb.rank;
      return (pb.index - pa.index) || (a - b);
    });
  };

  scene.seatCount = function () { return Object.keys(this.players).length; };

  /** 我当前的排名（1 起）。 */
  scene.myRankNow = function () {
    var seats = this.sortedSeats();
    for (var i = 0; i < seats.length; i++) if (seats[i] === state.mySeat) return i + 1;
    return seats.length + 1;
  };

  /** 顶部：左上角当前排名 + 状态提示（蓄力进度已在按钮环形上体现）。 */
  scene.renderTopBar = function (ctx) {
    var w = this.w, now = Date.now();
    var L = this.layout;
    draw.fillRoundRect(ctx, 0, 0, w, L.topH - 4, 0, 'rgba(10,14,36,0.72)');

    // 左上角：当前排名（下移到安全区以下，避开刘海）
    var rankTxt = this.mySeat < 0 ? '观战中' : ('第 ' + this.myRankNow() + ' / ' + this.seatCount() + ' 名');
    draw.text(ctx, rankTxt, 12, L.pad + 26, 20, '#ffd34d', 'left', true);

    this.refreshAllowed();
    var n = this.myAllowed || 0;
    var safe = (this.path && this.path.length) ? pathUtil.segmentSafe(this.path, this.myIndex) : 0;
    var danger = this.charging && n > 0 && charge.stepsForMs(now - this.startT, n) > safe;

    var tip;
    if (this.myFinished) tip = '已抵达终点（第 ' + this.myRank + ' 名）';
    else if (danger) tip = '危险！将飞出边界，上划取消';
    else if (this.charging) tip = '蓄力中…';
    else if (!this.live) tip = '准备中…';
    else if (!this.canCharge) tip = this.statusHint || '落地恢复中…';
    else tip = '长按下方按钮蓄力 · 上划取消';
    draw.textAutoFit(ctx, tip, 12, L.pad + 48, Math.max(70, L.mini.x - 24), 13,
      danger ? '#ff6b6b' : 'rgba(255,255,255,0.8)', 'left');
  };

  /** 左下角：剩余时间 / 冠军冲刺倒计时。 */
  scene.renderTimeLeft = function (ctx) {
    var now = Date.now();
    var color = '#ffffff', txt;
    if (this.championDeadline) {
      var remain = Math.max(0, Math.ceil((this.championDeadline - now) / 1000));
      txt = '冠军冲刺 ' + remain + 's';
      color = '#ffd34d';
    } else {
      var left = this.duration - (now - this.startTs) / 1000;
      txt = '剩余 ' + draw.fmtClock(left);
      if (left < 30) color = '#ff6b6b';
    }
    var y = this.h - (state.safeBottom || 0) - 16;
    draw.fillRoundRect(ctx, 8, y - 13, 124, 26, 13, 'rgba(10,14,36,0.78)');
    draw.text(ctx, txt, 18, y, 15, color, 'left', true);
  };

  /** 左上角名次列表：排在排名下方（自己的那一行高亮）。 */
  scene.renderStandings = function (ctx) {
    var seats = this.sortedSeats();
    var L = this.layout;
    var x = 10;
    var maxRight = Math.max(x + 70, L.mini.x - 10);
    var y0 = L.pad + 68;
    for (var i = 0; i < seats.length; i++) {
      var pl = this.players[seats[i]];
      var py = y0 + i * 15;
      var mine = pl.seat === state.mySeat;
      if (mine) draw.fillRoundRect(ctx, x - 3, py - 8, maxRight - x + 6, 15, 7, 'rgba(255,255,255,0.12)');
      avatar.drawAvatar(ctx, x + 7, py, 7, pl.avatarUrl, pl.nickname, pl.color);
      draw.textAutoFit(ctx, (mine ? '▸' : '') + pl.nickname, x + 18, py, Math.max(30, maxRight - x - 56), 11,
        mine ? '#ffffff' : 'rgba(255,255,255,0.75)', 'left');
      var pos = pl.finished ? ('第' + pl.rank + '名') : ('第' + (pl.index + 1) + '格');
      draw.text(ctx, pos, maxRight, py, 10, pl.finished ? '#6ee7a8' : 'rgba(255,255,255,0.6)', 'right');
    }
  };

  scene.renderBoard = function (ctx) {
    var path = this.path;
    if (!path || path.length === 0) return;
    var L = this.layout, cellW = L.cellW, cellH = L.cellH;
    var cellMin = Math.min(cellW, cellH);
    var pad = Math.max(cellW, cellH) * 2;
    var left = -pad, right = this.w + pad;
    var top = L.boardTop - pad, bottom = L.boardBottom + pad;
    var vis = function (s) { return s.x >= left && s.x <= right && s.y >= top && s.y <= bottom; };

    // 连线（只画可视段）
    ctx.strokeStyle = 'rgba(120,150,255,0.35)';
    ctx.lineWidth = cellH * 0.34;
    ctx.lineCap = 'round';
    ctx.beginPath();
    var started = false;
    for (var i = 0; i < path.length; i++) {
      var sp = this.world(path[i]);
      if (!vis(sp)) { started = false; continue; }
      if (!started) { ctx.moveTo(sp.x, sp.y); started = true; }
      else ctx.lineTo(sp.x, sp.y);
    }
    ctx.stroke();

    // 格子（只画可视格；随视角一起旋转）
    for (var j = 0; j < path.length; j++) {
      var p0 = this.world(path[j]);
      if (!vis(p0)) continue;
      var isStart = j === 0;
      var isEnd = j === path.length - 1;
      var col = isStart ? '#2f9e44' : (isEnd ? '#e8590c' : '#4a5a9e');
      ctx.save();
      ctx.translate(p0.x, p0.y);
      ctx.rotate(this.rot);
      draw.fillRoundRect(ctx, -cellW * 0.34, -cellH * 0.34, cellW * 0.68, cellH * 0.68, cellMin * 0.16, col);
      ctx.restore();
      if (isStart) draw.text(ctx, '起', p0.x, p0.y + 1, Math.max(9, cellMin * 0.3), '#ffffff', 'center', true);
      if (isEnd) draw.text(ctx, '终', p0.x, p0.y + 1, Math.max(9, cellMin * 0.3), '#ffffff', 'center', true);
      // 拐弯箭头（方向同样随视角旋转）
      if (j < path.length - 1 && j > 0) {
        var prev = path[j - 1], cur = path[j], next = path[j + 1];
        var dInX = cur.x - prev.x, dInY = cur.y - prev.y;
        var dOutX = next.x - cur.x, dOutY = next.y - cur.y;
        if (dInX !== dOutX || dInY !== dOutY) {
          // 方向同样随视角旋转（横纵缩放不同，先归一化再取偏移）
          var dOut = this.rotateVec(dOutX * cellW, dOutY * cellH);
          var olen = Math.sqrt(dOut.x * dOut.x + dOut.y * dOut.y) || 1;
          var ux = dOut.x / olen, uy = dOut.y / olen;
          var off = cellMin * 0.46;
          this.drawArrow(ctx, p0.x + ux * off, p0.y + uy * off, ux, uy, cellMin * 0.16, 'rgba(255,255,255,0.85)');
        }
      }
    }

    // 玩家（先算同格并排布局）
    this.computeTokenLayout();
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
  /** 按格子分组（同一格上的玩家会并排排列）。 */
  scene.buildCellGroups = function () {
    var groups = {};
    var seats = Object.keys(this.players).map(Number);
    for (var i = 0; i < seats.length; i++) {
      var pl = this.players[seats[i]];
      var idx = Math.max(0, Math.min(this.path.length - 1, pl.index));
      if (!groups[idx]) groups[idx] = [];
      groups[idx].push(pl.seat);
    }
    for (var k in groups) groups[k].sort(function (a, b) { return a - b; });
    return groups;
  };

  /** 计算每个玩家的头像半径与横向错位：同格玩家排成一行并居中，一格里 6 人也排得下。 */
  scene.computeTokenLayout = function () {
    var L = this.layout;
    var cellW = L.cellW, cellMin = Math.min(L.cellW, L.cellH);
    var baseR = Math.max(7, cellMin * 0.21);   // 头像整体略小
    var groups = this.buildCellGroups();
    var layout = {};
    for (var idx in groups) {
      var list = groups[idx];
      var count = list.length;
      var r = baseR;
      var pitch = r * 2 * 0.94;
      // 圆心跨度上限：整行（含两端半径）不超过格子宽度
      var maxSpan = Math.max(pitch, cellW - r * 2);
      if (count > 1 && (count - 1) * pitch > maxSpan) {
        var scale = maxSpan / ((count - 1) * pitch);
        r *= scale;
        pitch *= scale;
      }
      for (var i = 0; i < count; i++) {
        layout[list[i]] = { r: r, dx: (i - (count - 1) / 2) * pitch, count: count };
      }
    }
    this.tokenLayout = layout;
  };

  scene.renderToken = function (ctx, seat) {
    var pl = this.players[seat];
    if (!pl) return;
    var L = this.layout, cellMin = Math.min(L.cellW, L.cellH);
    var pw = this.playerWorld(seat);
    var base = this.world({ x: pw.x, y: pw.y });
    var lay = (this.tokenLayout && this.tokenLayout[seat]) || { r: Math.max(7, cellMin * 0.21), dx: 0, count: 1 };
    var r = lay.r;
    // 同格玩家始终在屏幕上“横向”并排（不随视角旋转）
    var off = { x: lay.dx, y: 0 };
    var jumpPx = pw.lift * L.cellH;
    var x = base.x + off.x;
    var y = base.y + off.y - jumpPx;
    var airborne = pw.lift > 0.02;

    // 影子：跳起时缩小、变淡
    var shr = Math.max(0.4, 1 - pw.lift * 0.45);
    ctx.fillStyle = 'rgba(0,0,0,' + (0.28 * (1 - Math.min(0.7, pw.lift * 0.5))) + ')';
    ctx.beginPath();
    ctx.arc(base.x + off.x, base.y + off.y + r * 0.65, r * shr, 0, Math.PI * 2);
    ctx.fill();

    // 角色头像：起跳时轻微上下拉伸
    var sy = airborne ? 1 + 0.16 * Math.sin(Math.PI * Math.min(1, Math.max(0, pw.t))) : 1;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(1 / Math.sqrt(sy), sy);
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.beginPath(); ctx.arc(0, 0, r + 2, 0, Math.PI * 2); ctx.fill();
    avatar.drawAvatar(ctx, 0, 0, r, pl.avatarUrl, pl.nickname, pl.color);
    ctx.strokeStyle = pl.finished ? '#ffd34d' : (pl.seat === state.mySeat ? '#ffffff' : 'rgba(255,255,255,0.55)');
    ctx.lineWidth = pl.seat === state.mySeat ? 2.5 : 2;
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();

    // 自己的箭头标识
    if (pl.seat === state.mySeat) {
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.moveTo(x, y - r - 9);
      ctx.lineTo(x - 5, y - r - 17);
      ctx.lineTo(x + 5, y - r - 17);
      ctx.closePath();
      ctx.fill();
    }

    // 已抵达：名次徽标
    if (pl.finished) {
      var br = Math.max(7, r * 0.62);
      var bx = x + r * 0.8, by = y - r * 0.8;
      ctx.fillStyle = '#ffd34d';
      ctx.beginPath(); ctx.arc(bx, by, br, 0, Math.PI * 2); ctx.fill();
      draw.text(ctx, String(pl.rank), bx, by + 1, Math.max(9, br * 1.1), '#3a2a00', 'center', true);
    }

    // 昵称（带阴影描边）：同格人多时只显示自己的，避免文字重叠
    if (pl.seat === state.mySeat || lay.count <= 2) {
      var nm = avatar.shortName(pl.nickname, 6);
      var nSize = Math.max(8, Math.min(11, cellMin * 0.19));
      var ny = y + r + nSize + 3;
      draw.text(ctx, nm, x + 1, ny + 1, nSize, 'rgba(0,0,0,0.65)', 'center', true);
      draw.text(ctx, nm, x, ny, nSize, pl.seat === state.mySeat ? '#ffffff' : 'rgba(255,255,255,0.92)', 'center', true);
    }
  };

  /** 右上角小地图：完整地图缩略（每格一个点）+ 玩家位置 + 格子计数。 */
  scene.renderMinimap = function (ctx) {
    var L = this.layout, m = L.mini, path = this.path;
    if (!m || !path || path.length === 0) return;

    draw.fillRoundRect(ctx, m.x, m.y, m.side, m.side, 10, 'rgba(0,0,0,0.42)');

    var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    path.forEach(function (p) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    });
    if (!isFinite(minX)) return;

    var footH = 15;                     // 底部计数条
    var pad = 9;
    var box = m.side - pad * 2;
    var avail = box - footH;
    var spanX = Math.max(1, maxX - minX), spanY = Math.max(1, maxY - minY);
    var k = Math.min(avail / spanX, avail / spanY);
    var ox = m.x + pad + (box - spanX * k) / 2 - minX * k;
    var oy = m.y + pad + (avail - spanY * k) / 2 - minY * k;
    var toMini = function (p) { return { x: ox + p.x * k, y: oy + p.y * k }; };

    // 路径连线
    ctx.strokeStyle = 'rgba(120,150,255,0.5)';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    for (var i = 0; i < path.length; i++) {
      var s = toMini(path[i]);
      if (i === 0) ctx.moveTo(s.x, s.y); else ctx.lineTo(s.x, s.y);
    }
    ctx.stroke();

    // 每格一个点：直观体现格子数量
    var dot = Math.max(1.2, Math.min(2.4, k * 0.4));
    for (var c = 0; c < path.length; c++) {
      var pc = toMini(path[c]);
      var head = (c === 0) || (c === path.length - 1);
      ctx.fillStyle = (c === 0) ? '#2f9e44' : (c === path.length - 1 ? '#e8590c' : 'rgba(200,215,255,0.9)');
      ctx.beginPath();
      ctx.arc(pc.x, pc.y, head ? dot + 0.8 : dot, 0, Math.PI * 2);
      ctx.fill();
    }

    // 玩家位置
    var seats = Object.keys(this.players).map(Number);
    for (var j = 0; j < seats.length; j++) {
      var pl = this.players[seats[j]];
      var pos = toMini(path[Math.max(0, Math.min(path.length - 1, pl.index))]);
      ctx.fillStyle = pl.color;
      ctx.beginPath(); ctx.arc(pos.x, pos.y, 3.2, 0, Math.PI * 2); ctx.fill();
      if (pl.seat === state.mySeat) {
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(pos.x, pos.y, 5.5, 0, Math.PI * 2); ctx.stroke();
      }
    }

    // 底部计数：我的进度 / 总格数
    draw.fillRoundRect(ctx, m.x, m.y + m.side - footH, m.side, footH, 0, 'rgba(255,255,255,0.10)');
    var me = this.players[state.mySeat];
    var myPos = me ? (me.finished ? path.length : (me.index + 1)) : 0;
    draw.text(ctx, '第 ' + myPos + ' / ' + path.length + ' 格', m.x + m.side / 2, m.y + m.side - footH / 2 + 1, 10, '#ffffff', 'center');
  };

  /** 底部蓄力按钮：蓄力进度以环形显示，并在中心显示步数。 */
  scene.renderChargeButton = function (ctx) {
    var L = this.layout, b = L.btn;
    if (!b) return;
    var now = Date.now();

    var n = this.myAllowed || 0;
    var safe = (this.path && this.path.length) ? pathUtil.segmentSafe(this.path, this.myIndex) : 0;
    var current = (this.charging && n > 0) ? charge.stepsForMs(now - this.startT, n) : 0;
    var danger = this.charging && current > safe;
    var enabled = this.live && this.canCharge && !this.myFinished;

    var ringColor = '#4a7dff';
    if (this.myFinished) ringColor = '#2f9e44';
    else if (this.charging) ringColor = danger ? '#ff6b6b' : (current >= 3 ? '#ff9f43' : '#6ee7a8');
    else if (!enabled) ringColor = '#5a6070';

    // 底盘
    ctx.fillStyle = 'rgba(0,0,0,0.36)';
    ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2); ctx.fill();

    // 蓄力进度环
    if (this.charging && n > 0) {
      var frac = Math.min(1, current / n);
      ctx.strokeStyle = ringColor;
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r - 5, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac);
      ctx.stroke();
    }

    // 内圆
    ctx.fillStyle = 'rgba(255,255,255,0.07)';
    ctx.beginPath(); ctx.arc(b.x, b.y, b.r - 10, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = ringColor;
    ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(b.x, b.y, b.r - 10, 0, Math.PI * 2); ctx.stroke();

    // 文案
    var main, sub = '';
    if (this.myFinished) { main = '已到终点'; sub = '第 ' + this.myRank + ' 名'; }
    else if (this.charging) { main = current + ' 步'; sub = danger ? '危险！上划取消' : ('最多 ' + n + ' 步'); }
    else if (!this.live) { main = '准备中'; }
    else if (!enabled) { main = '恢复中'; }
    else { main = '长按蓄力'; sub = '上划取消'; }
    draw.text(ctx, main, b.x, b.y - (sub ? 7 : 0), this.charging ? 22 : 17, '#ffffff', 'center', true);
    if (sub) draw.text(ctx, sub, b.x, b.y + 15, 11, danger ? '#ffb4b4' : 'rgba(255,255,255,0.7)', 'center');
  };

  scene.renderBanners = function (ctx) {
    var w = this.w;
    var y0 = this.layout.boardTop + 24;
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
