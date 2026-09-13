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
        avatarChar: p.avatarChar || '',
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
    // 蓄力按钮上方的横向进度条（布局时预留位置，避免压住棋盘）
    var barH = 12;
    var barW = Math.min(w * 0.72, 260);
    var barY = h - padB - btnR * 2 - 10 - 14 - barH;
    var bar = { x: (w - barW) / 2, y: barY, w: barW, h: barH };
    var miniSide = Math.min(w * 0.32, 104);
    // 小地图同时避让刘海与右上角胶囊按钮
    var miniY = Math.max(pad + 10, (state.capsuleBottom || 0) + 8);
    // 顶部只剩左侧「名次面板」与右侧小地图，中间留空露出地图
    var rows = Math.max(1, Object.keys(this.players || {}).length);
    var listRowH = 26;                                   // 名次面板行高（头像 16px，上下各留 5px）
    // 面板从 pad+8 开始、内容上下各 10px，再留 6px 与棋盘分界
    var topBlockH = 8 + 10 + rows * listRowH + 10 + 6;
    var topH = Math.max(pad + topBlockH, miniY + miniSide + 6);
    var boardTop = topH;
    var boardBottom = bar.y - 10;
    // 格子：每个玩家一个 30px 宽的横向槽位（宽度随人数自动缩放，至少 2 个槽位），格高 34px 略大于头像
    // 纵向格距只需保证拐角处不与邻格重叠：tileW/2 + tileL/2 + 5px 缝隙。
    var slotW = 30;
    var tileL = 34;
    var tileW = slotW * Math.max(2, Math.max(1, this.seatCount()));
    var cellH = tileW / 2 + tileL / 2 + 5;
    var mini = { x: w - miniSide - 10, y: miniY, side: miniSide };
    return {
      topH: topH,
      pad: pad,
      listRowH: listRowH,
      cellH: cellH,
      tileW: tileW,
      tileL: tileL,
      boardTop: boardTop,
      boardBottom: boardBottom,
      anchorX: w / 2,
      anchorY: boardBottom - cellH * 0.9,
      mini: mini,
      bar: bar,
      btn: { x: w / 2, y: h - padB - btnR - 10, r: btnR }
    };
  };

  /** 世界向量 -> 屏幕向量（应用当前视角旋转）。 */
  scene.rotateVec = function (vx, vy) {
    return { x: vx * this.rotCos - vy * this.rotSin, y: vx * this.rotSin + vy * this.rotCos };
  };

  /** 第 j 格所属直线段的（世界系）单位方向：非末格取“到下一格”，末格沿用上一格。 */
  scene.dirAt = function (j) {
    var path = this.path;
    if (!path || path.length < 2) return { x: 1, y: 0 };
    var i = (j < path.length - 1) ? j : (j - 1);
    if (i < 0) i = 0;
    var dx = path[i + 1].x - path[i].x, dy = path[i + 1].y - path[i].y;
    var len = Math.sqrt(dx * dx + dy * dy) || 1;
    return { x: dx / len, y: dy / len };
  };

  /** 世界格坐标 -> 屏幕像素坐标（相机 + 视角旋转）。刚性变换：先旋转，再按统一步距 cellH 缩放。 */
  scene.world = function (p) {
    var L = this.layout;
    // 每格沿“自己的前进方向”的间距恒为 cellH；格子尺寸见 tileW/tileL（绘制时按本段方向旋转）。
    var v = this.rotateVec(p.x - this.cam.x, p.y - this.cam.y);
    return { x: L.anchorX + v.x * L.cellH, y: L.anchorY + v.y * L.cellH };
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
    this.renderTimeLeft(ctx);     // 左下角：剩余时间
    this.renderMinimap(ctx);      // 右上角：完整地图 + 当前位置
    this.renderChargeBar(ctx);    // 蓄力按钮上方：横向蓄力进度条（无极）
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

  /** 顶部：只有左上「名次面板」和右上小地图有底板，中间留空露出地图。 */
  scene.renderTopBar = function (ctx) {
    var L = this.layout;
    var rows = this.seatCount();
    var pw = Math.min(184, Math.max(140, L.mini.x - 24));
    var ph = 10 + rows * (L.listRowH || 26) + 10;
    this.topPanel = { x: 8, y: L.pad + 8, w: pw, h: ph };
    draw.fillRoundRect(ctx, this.topPanel.x, this.topPanel.y, pw, ph, 12, 'rgba(10,14,36,0.78)');
  };

  /** 左下角：剩余时间。 */
  scene.renderTimeLeft = function (ctx) {
    var now = Date.now();
    var color = '#ffffff';
    var left = this.duration - (now - this.startTs) / 1000;
    var txt = '剩余 ' + draw.fmtClock(left);
    if (left < 30) color = '#ff6b6b';
    var y = this.h - (state.safeBottom || 0) - 16;
    draw.fillRoundRect(ctx, 8, y - 13, 124, 26, 13, 'rgba(10,14,36,0.78)');
    draw.text(ctx, txt, 18, y, 15, color, 'left', true);
  };

  /** 左上角名次面板：所有玩家按当前进度排序（带名次序号，自己的那行高亮）。 */
  scene.renderStandings = function (ctx) {
    var seats = this.sortedSeats();
    var p = this.topPanel;
    if (!p) return;
    var rowH = (this.layout && this.layout.listRowH) || 26;
    for (var i = 0; i < seats.length; i++) {
      var pl = this.players[seats[i]];
      var py = p.y + 10 + rowH / 2 + i * rowH;
      var mine = pl.seat === state.mySeat;
      // 高亮条比行高矮 4px：头像（16px）在条内上下各留 3px，相邻两行条之间留 4px
      if (mine) draw.fillRoundRect(ctx, p.x + 5, py - rowH / 2 + 2, p.w - 10, rowH - 4, 11, 'rgba(120,160,255,0.22)');
      // 名次序号（前三名镀色）
      var rankColor = i === 0 ? '#ffd34d' : (i === 1 ? '#cfd8e6' : (i === 2 ? '#d29a5b' : 'rgba(255,255,255,0.65)'));
      draw.text(ctx, String(i + 1), p.x + 15, py, 12, rankColor, 'center', true);
      avatar.drawAvatar(ctx, p.x + 33, py, 8, pl.avatarUrl, pl.nickname, pl.color, pl.avatarChar);
      var posW = 46;
      draw.textAutoFit(ctx, (mine ? '▸' : '') + pl.nickname, p.x + 46, py, Math.max(30, p.w - 46 - posW - 12), 11,
        mine ? '#ffffff' : 'rgba(255,255,255,0.85)', 'left', mine);
      draw.text(ctx, pl.finished ? '终点' : ('第' + (pl.index + 1) + '格'), p.x + p.w - 9, py, 11,
        pl.finished ? '#6ee7a8' : 'rgba(255,255,255,0.6)', 'right');
    }
  };

  scene.renderBoard = function (ctx) {
    var path = this.path;
    if (!path || path.length === 0) return;
    var L = this.layout, cellH = L.cellH;
    var tileMin = Math.min(L.tileW, L.tileL);
    var pad = Math.max(L.tileW, L.tileL) * 2;
    var left = -pad, right = this.w + pad;
    var top = L.boardTop - pad, bottom = L.boardBottom + pad;
    var vis = function (s) { return s.x >= left && s.x <= right && s.y >= top && s.y <= bottom; };

    // 连线（只画可视段）
    ctx.strokeStyle = 'rgba(120,150,255,0.35)';
    ctx.lineWidth = Math.max(3, L.tileL * 0.75);   // 比格子窄一点，像轨道内的连接带
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
    var arrows = [];
    for (var j = 0; j < path.length; j++) {
      var p0 = this.world(path[j]);
      if (!vis(p0)) continue;
      var isStart = j === 0;
      var isEnd = j === path.length - 1;
      var col = isStart ? '#2f9e44' : (isEnd ? '#e8590c' : '#4a5a9e');
      // 格子按“本段前进方向”摆正：沿前进方向 tileL、垂直方向 tileW（宽:高 = 6:1）。
      // 所有格子尺寸一致；由尺寸约束保证拐角处与邻格不重叠。
      // 于是当前段呈横向扁条；拐弯后的那一段此时呈纵向长条，等玩家过去、视角转过 90° 后刚好转成横向。
      var d = this.dirAt(j);
      var sd = this.rotateVec(d.x, d.y);            // 屏幕系的前进方向
      var tileRot = Math.atan2(sd.x, -sd.y);        // 使格子局部 y 轴对齐前进方向
      // 所有格子尺寸完全一致；尺寸已保证与拐角邻格不重叠，所以只要填色 + 圆角即可。
      ctx.save();
      ctx.translate(p0.x, p0.y);
      ctx.rotate(tileRot);
      draw.fillRoundRect(ctx, -L.tileW / 2, -L.tileL / 2, L.tileW, L.tileL, L.tileL / 2, col);
      ctx.restore();
      var markSize = Math.max(8, Math.min(L.tileL * 0.85, cellH * 0.3));
      if (isStart) draw.text(ctx, '起', p0.x, p0.y + 1, markSize, '#ffffff', 'center', true);
      if (isEnd) draw.text(ctx, '终', p0.x, p0.y + 1, markSize, '#ffffff', 'center', true);
      // 拐弯箭头：先收集，所有格子画完后再画，避免被下一格的缝隙圈裁掉
      if (j < path.length - 1 && j > 0) {
        var prev = path[j - 1], cur = path[j], next = path[j + 1];
        var dInX = cur.x - prev.x, dInY = cur.y - prev.y;
        var dOutX = next.x - cur.x, dOutY = next.y - cur.y;
        if (dInX !== dOutX || dInY !== dOutY) {
          var rd = this.rotateVec(dOutX, dOutY);
          var rlen = Math.sqrt(rd.x * rd.x + rd.y * rd.y) || 1;
          var ux = rd.x / rlen, uy = rd.y / rlen;
          var off = cellH * 0.5;   // 箭头落在两格中间的缝隙里
          arrows.push({ x: p0.x + ux * off, y: p0.y + uy * off, ux: ux, uy: uy });
        }
      }
    }
    for (var ai = 0; ai < arrows.length; ai++) {
      this.drawArrow(ctx, arrows[ai].x, arrows[ai].y, arrows[ai].ux, arrows[ai].uy,
        Math.max(4, cellH * 0.16), 'rgba(255,255,255,0.85)');
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
    var boxW = L.tileW * 0.96;                    // 横向可用宽度（格子宽度内）
    var boxH = Math.max(12, L.cellH - 6);         // 纵向可用高度（不与相邻格的玩家撞上）
    var baseR = Math.min(12.5, (L.tileL - 4) / 2);   // 头像半径固定 12.5（直径 25px），不随格子变大
    var groups = this.buildCellGroups();
    var layout = {};
    for (var idx in groups) {
      var list = groups[idx];
      var count = list.length;
      // 一行或两行里挑“能画得更大”的排法（行方向始终是本格横向）
      var best = null;
      for (var rows = 1; rows <= 2; rows++) {
        var cols = Math.max(1, Math.ceil(count / rows));
        var rW = boxW / (2 * (1 + 0.94 * (cols - 1)));
        var rH = boxH / (2 * (1 + 0.9 * (rows - 1)));
        var rc = Math.min(baseR, rW, rH);
        if (!best || rc > best.r) best = { r: rc, rows: rows, cols: cols };
      }
      var pitchX = best.r * 2 * 0.94, pitchY = best.r * 2 * 0.9;
      for (var i = 0; i < count; i++) {
        var ri = Math.floor(i / best.cols), ci = i % best.cols;
        var rowCount = Math.min(best.cols, count - ri * best.cols);   // 末行可能不满，居中
        layout[list[i]] = {
          r: best.r,
          dx: (ci - (rowCount - 1) / 2) * pitchX,
          dy: (ri - (best.rows - 1) / 2) * pitchY,
          count: count
        };
      }
    }
    this.tokenLayout = layout;
  };

  scene.renderToken = function (ctx, seat) {
    var pl = this.players[seat];
    if (!pl) return;
    var L = this.layout;
    var pw = this.playerWorld(seat);
    var base = this.world({ x: pw.x, y: pw.y });
    var lay = (this.tokenLayout && this.tokenLayout[seat]) ||
      { r: Math.min(12.5, (L.tileL - 4) / 2), dx: 0, dy: 0, count: 1 };
    var r = lay.r;
    // 格内排布：dx 沿“本格横向”（自己所在段上即屏幕横向），dy 沿“本格前进方向”
    var dSelf = this.dirAt(Math.max(0, Math.min(this.path.length - 1, pl.index)));
    var lat = this.rotateVec(-dSelf.y, dSelf.x);
    var along = this.rotateVec(dSelf.x, dSelf.y);
    var off = {
      x: lay.dx * lat.x + (lay.dy || 0) * along.x,
      y: lay.dx * lat.y + (lay.dy || 0) * along.y
    };
    var jumpPx = pw.lift * L.cellH;
    var x = base.x + off.x;
    var y = base.y + off.y - jumpPx;
    var airborne = pw.lift > 0.02;

    // 影子：只画在格子内（跳起时缩小、变淡）
    var shr = Math.max(0.4, 1 - pw.lift * 0.45);
    ctx.fillStyle = 'rgba(0,0,0,' + (0.28 * (1 - Math.min(0.7, pw.lift * 0.5))) + ')';
    ctx.beginPath();
    ctx.arc(base.x + off.x, base.y + off.y + r * 0.3, r * 0.7 * shr, 0, Math.PI * 2);
    ctx.fill();

    // 角色头像：起跳时轻微上下拉伸；不再画向外扩 2px 的描边圈（那才是超出格子的元凶）
    var sy = airborne ? 1 + 0.1 * Math.sin(Math.PI * Math.min(1, Math.max(0, pw.t))) : 1;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(1 / Math.sqrt(sy), sy);
    avatar.drawAvatar(ctx, 0, 0, r, pl.avatarUrl, pl.nickname, pl.color, pl.avatarChar);
    ctx.strokeStyle = pl.finished ? '#ffd34d' : (pl.seat === state.mySeat ? '#ffffff' : 'rgba(255,255,255,0.55)');
    ctx.lineWidth = pl.seat === state.mySeat ? 2 : 1.5;   // 描边也收在格子内（r+1 ≤ 格高/2）
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
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

  /**
   * 蓄力按钮上方的横向进度条：填充是**连续（无极）**的，不按整格跳。
   * 进度条均分为 maxStep 段（每段一格，画刻度），格内按耗时线性插值。
   */
  scene.renderChargeBar = function (ctx) {
    var L = this.layout, bar = L.bar;
    if (!bar) return;
    var now = Date.now();
    var limit = charge.maxStep();
    var safe = (this.path && this.path.length) ? pathUtil.segmentSafe(this.path, this.myIndex) : 0;
    var charging = this.charging && limit > 0;
    var ms = charging ? (now - this.startT) : 0;
    var progress = charging ? charge.progressFor(ms, limit) : 0;
    var current = charging ? charge.stepsForMs(ms, limit) : 0;
    var danger = charging && current > safe;
    var r = bar.h / 2;

    // 轨道
    draw.fillRoundRect(ctx, bar.x, bar.y, bar.w, bar.h, r, 'rgba(255,255,255,0.13)');
    // 连续填充
    if (progress > 0) {
      var fillW = Math.max(bar.h, bar.w * progress);
      var col = danger ? '#ff6b6b' : (current >= 3 ? '#ff9f43' : '#6ee7a8');
      draw.fillRoundRect(ctx, bar.x, bar.y, fillW, bar.h, r, col);
    }
    // 每格刻度
    ctx.strokeStyle = 'rgba(0,0,0,0.22)';
    ctx.lineWidth = 1;
    for (var i = 1; i < limit; i++) {
      var gx = bar.x + bar.w * i / limit;
      ctx.beginPath();
      ctx.moveTo(gx, bar.y + 2);
      ctx.lineTo(gx, bar.y + bar.h - 2);
      ctx.stroke();
    }
    // 外框
    draw.strokeRoundRect(ctx, bar.x, bar.y, bar.w, bar.h, r,
      this.charging ? 'rgba(255,255,255,0.38)' : 'rgba(255,255,255,0.16)', 1);
  };

  /** 底部蓄力按钮：蓄力进度以环形显示，并在中心显示步数。 */
  scene.renderChargeButton = function (ctx) {
    var L = this.layout, b = L.btn;
    if (!b) return;
    var now = Date.now();

    var n = this.myAllowed || 0;
    var safe = (this.path && this.path.length) ? pathUtil.segmentSafe(this.path, this.myIndex) : 0;
    var current = (this.charging && n > 0) ? charge.stepsForMs(now - this.startT, n) : 0;
    // 环形进度同样用连续值，与进度条一致
    var progress = (this.charging && n > 0) ? charge.progressFor(now - this.startT, n) : 0;
    var danger = this.charging && current > safe;
    var enabled = this.live && this.canCharge && !this.myFinished;

    var ringColor = '#4a7dff';
    if (this.myFinished) ringColor = '#2f9e44';
    else if (this.charging) ringColor = danger ? '#ff6b6b' : (current >= 3 ? '#ff9f43' : '#6ee7a8');
    else if (!enabled) ringColor = '#5a6070';

    // 底盘
    ctx.fillStyle = 'rgba(0,0,0,0.36)';
    ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2); ctx.fill();

    // 蓄力进度环（无极）
    if (this.charging && n > 0) {
      var frac = progress;
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
