/**
 * 应用编排：画布、主循环、触摸分发、场景切换、服务端消息中央路由、登录与重连。
 */
var net = require('./net/net.js');
var state = require('./state.js');
var cfg = require('./config.js');

var sceneMain = require('./scenes/main.js');
var sceneRoom = require('./scenes/room.js');
var sceneGame = require('./scenes/game.js');
var sceneResult = require('./scenes/result.js');

var App = {
  canvas: null,
  ctx: null,
  w: 0,
  h: 0,
  scene: null,
  sceneFactories: {},
  lastFrame: 0
};

App.sceneFactories = {
  main: sceneMain,
  room: sceneRoom,
  game: sceneGame,
  result: sceneResult
};

/** 启动入口。 */
App.start = function () {
  var info = wx.getSystemInfoSync();
  this.w = info.windowWidth;
  this.h = info.windowHeight;
  var dpr = info.pixelRatio || 1;

  this.canvas = wx.createCanvas();
  this.canvas.width = this.w * dpr;
  this.canvas.height = this.h * dpr;
  this.ctx = this.canvas.getContext('2d');
  this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  this.computeSafeArea(info);

  this.registerTouch();
  this.loop = this.loop.bind(this);
  this.loop();

  this.bootstrapLogin();
};

/** 计算刘海屏/状态栏顶部留白与右上角胶囊按钮位置（各场景据此让顶部内容避让）。 */
App.computeSafeArea = function (info) {
  state.safeTop = 0;
  state.safeBottom = 0;
  state.capsuleBottom = 0;
  try {
    var sa = info && info.safeArea;
    if (sa && typeof sa.top === 'number') state.safeTop = sa.top;
    else if (info && info.statusBarHeight) state.safeTop = info.statusBarHeight;
    if (sa && typeof sa.bottom === 'number' && this.h) state.safeBottom = this.h - sa.bottom;
    if (typeof wx.getMenuButtonBoundingClientRect === 'function') {
      var mb = wx.getMenuButtonBoundingClientRect();
      if (mb && mb.bottom) state.capsuleBottom = mb.bottom;
    }
  } catch (e) { /* 取不到时按无刘海处理 */ }
  state.safeTop = Math.max(0, Math.min(80, state.safeTop || 0));
  state.safeBottom = Math.max(0, Math.min(60, state.safeBottom || 0));
  state.capsuleBottom = Math.max(0, Math.min(120, state.capsuleBottom || 0));
};

// ---------------- 登录与连接 ----------------
App.bootstrapLogin = function () {
  var self = this;
  var nickname = wx.getStorageSync('nickname');
  if (!nickname) {
    nickname = '跳友' + Math.floor(1000 + Math.random() * 9000);
    wx.setStorageSync('nickname', nickname);
  }
  var avatarUrl = wx.getStorageSync('avatarUrl') || '';

  // 启动参数（分享卡片直达房间）
  try {
    var query = wx.getLaunchOptionsSync().query || {};
    state.pendingRoomNo = query.room || '';
  } catch (e) { state.pendingRoomNo = ''; }

  net.wxLogin().then(function (code) {
    // authorized=false：这里带的是本地兜底昵称，服务端已有资料时不会被覆盖
    return net.post('/api/auth/login', {
      code: code, nickname: nickname, avatarUrl: avatarUrl, authorized: false
    });
  }).then(function (res) {
    state.token = res.token;
    state.user = res.user;
    self.syncProfileToStorage();  // 以数据库资料为准回写本地缓存
    self.loadMapList();
    // 已在本房间（杀进程后重进等）：先取回房间号，连上 WS 后自动回到房间继续
    self.loadMyRoom().then(function () { self.connectWs(); });
  }).catch(function (err) {
    wx.showModal({
      title: '登录失败',
      content: err.message || '请检查服务器地址与网络',
      showCancel: false,
      success: function () { self.bootstrapLogin(); }
    });
  });
};

/** 拉取地图列表（含路径，用于选图时的缩略图）。 */
App.loadMapList = function () {
  net.get('/api/maps', { token: state.token }).then(function (list) {
    state.mapList = list || [];
  }).catch(function () { /* 静默失败：选图时用本地元信息兜底 */ });
};

/** 拉取我当前所在房间（用于启动后自动回到房间继续游戏）。 */
App.loadMyRoom = function () {
  return net.get('/api/room/mine', { token: state.token }).then(function (res) {
    if (res && res.roomNo) state.lastRoomNo = res.roomNo;
  }).catch(function () { /* 静默失败：按不在房间处理 */ });
};

/** 以服务端（数据库）返回的资料为准回写本地缓存，避免下次启动用兜底昵称覆盖库内资料。 */
App.syncProfileToStorage = function () {
  var u = state.user || {};
  if (u.nickname) wx.setStorageSync('nickname', u.nickname);
  if (u.avatarUrl) wx.setStorageSync('avatarUrl', u.avatarUrl);
};

/** 微信授权成功后写入头像昵称，并重新登录同步到服务端。 */
App.applyWechatProfile = function (nickName, avatarUrl) {
  var changed = false;
  if (nickName && nickName !== '微信用户') {
    state.user = state.user || {};
    state.user.nickname = nickName;
    wx.setStorageSync('nickname', nickName);
    changed = true;
  }
  if (avatarUrl) {
    state.user = state.user || {};
    state.user.avatarUrl = avatarUrl;
    wx.setStorageSync('avatarUrl', avatarUrl);
    changed = true;
  }
  if (!changed) {
    this.toast('未获取到微信头像昵称');
    return;
  }
  this.relogin(true);   // 已是微信授权资料：服务端落库并标记授权
};

/** 用当前本地的头像昵称重新登录（服务端会更新 user 资料）并重连 WebSocket。 */
App.relogin = function (authorized) {
  var self = this;
  state.wsReady = false;
  net.wxLogin().then(function (code) {
    return net.post('/api/auth/login', {
      code: code,
      nickname: (state.user && state.user.nickname) || '',
      avatarUrl: (state.user && state.user.avatarUrl) || '',
      authorized: !!authorized
    });
  }).then(function (res) {
    state.token = res.token;
    state.user = res.user;
    self.syncProfileToStorage();
    if (state.ws) state.ws.close();
    self.connectWs(); // 连接成功后会自动回到主菜单
    self.toast(authorized ? '头像昵称已保存' : '资料已更新');
  }).catch(function (err) {
    self.toast(err.message || '更新失败');
  });
};

App.connectWs = function () {
  var self = this;
  state.ws = new net.WsClient();
  state.ws.autoReconnect = true;
  state.ws.url = cfg.WS_BASE + '?token=' + state.token;

  state.ws.onOpen = function () {
    state.wsReady = true;
    self.send('ping', {});
    // 断线重连：回到上次房间；首次启动若有分享房间号也在此加入
    var joinNo = state.pendingRoomNo || state.lastRoomNo;
    if (joinNo) {
      state.pendingRoomNo = '';
      self.send('join_room', { roomNo: joinNo });
    } else {
      self.showScene('main');
    }
  };

  state.ws.onMessage = function (type, data) {
    self.onServerMessage(type, data);
  };

  state.ws.onError = function () {
    state.wsReady = false;
  };

  state.ws.connect(state.ws.url);
  this.heartbeat();
};

App.heartbeat = function () {
  if (this._hbTimer) return; // 重连时避免重复开启
  var self = this;
  this._hbTimer = setInterval(function () {
    if (state.wsReady) self.send('ping', {});
  }, 20000);
};

// ---------------- 发送 ----------------
App.send = function (type, data) {
  if (!state.wsReady || !state.ws) {
    this.toast('连接中，请稍候…');
    return false;
  }
  state.ws.send(type, data);
  return true;
};

App.toast = function (msg) {
  wx.showToast({ title: msg, icon: 'none', duration: 1800 });
};

/**
 * 上报本局成绩到微信开放数据域（好友排行榜占位能力，MVP 后置完善）。
 * score 越高越好：抵达终点 +10w，名次越靠前越高。
 */
App.recordResult = function (rank, finished) {
  try {
    if (typeof wx.setUserCloudStorage !== 'function') return;
    var score = (finished ? 100000 : 0) + Math.max(1, 101 - rank);
    wx.setUserCloudStorage({
      KVDataList: [
        { key: 'score', value: String(score) },
        { key: 'rank', value: String(rank) },
        { key: 'finished', value: finished ? '1' : '0' }
      ]
    });
  } catch (e) { /* 上报失败不影响对局 */ }
};

// ---------------- 场景 ----------------
App.showScene = function (name, data) {
  var factory = this.sceneFactories[name];
  if (!factory) return;
  // 场景切走前先清理（如主菜单的原生授权按钮）
  if (this.scene && typeof this.scene.leave === 'function') {
    try { this.scene.leave(); } catch (e) { /* ignore */ }
  }
  var s = factory.create();
  s.enter(Object.assign({ app: this, w: this.w, h: this.h }, data || {}));
  this.scene = s;
};

App.currentSceneName = function () {
  return this.scene ? this.scene.name : '';
};

// ---------------- 动作 ----------------
App.actionCreate = function () {
  this.send('create_room', {});
};

App.promptJoin = function () {
  var self = this;
  wx.showModal({
    title: '加入房间',
    editable: true,
    placeholderText: '输入 6 位房间号',
    success: function (res) {
      if (!res.confirm) return;
      var no = (res.content || '').trim();
      if (!/^\d{4,8}$/.test(no)) { self.toast('房间号格式不正确'); return; }
      self.send('join_room', { roomNo: no });
    }
  });
};

App.leaveRoom = function () {
  this.send('leave_room', {});
  state.room = null;
  state.lastRoomNo = '';
  this.showScene('main');
};

// ---------------- 服务端消息中央路由 ----------------
App.onServerMessage = function (type, data) {
  var scene = this.scene;
  if (scene && typeof scene.handleServer === 'function') {
    if (scene.handleServer(type, data) === true) return;
  }

  switch (type) {
    case 'joined':
      state.room = data.room;
      state.mySeat = data.mySeat;
      state.lastRoomNo = data.room.roomNo;
      // 对局中（含启动后自动回到进行中的房间）：等 game_state 快照再进对局场景，避免闪一下房间页
      if (data.room.phase === 1) return;
      this.showScene('room');
      break;
    case 'room_state':
      state.room = data;
      if (this.currentSceneName() === 'result' && data.phase === 0) {
        this.showScene('room');
      }
      break;
    case 'game_start':
      this.showScene('game', { data: data });
      break;
    case 'game_state':
      // 对局中重连：若不在对局场景则进入（否则由 GameScene 自行同步）
      if (this.currentSceneName() !== 'game') this.showScene('game', { data: data, resume: true });
      break;
    case 'error':
      // 启动后自动回房失败（房间已不存在等）：回到主菜单，避免黑屏
      if (!this.scene) { state.lastRoomNo = ''; this.showScene('main'); }
      this.toast(data.msg || '操作失败');
      break;
  }
};

// ---------------- 触摸 ----------------
App.registerTouch = function () {
  var self = this;
  wx.onTouchStart(function (e) {
    if (!e.touches || e.touches.length === 0) return;
    var t = e.touches[0];
    var s = self.scene;
    if (s && s.onTouchStart) s.onTouchStart(t.clientX, t.clientY);
  });
  wx.onTouchMove(function (e) {
    if (!e.touches || e.touches.length === 0) return;
    var t = e.touches[0];
    var s = self.scene;
    if (s && s.onTouchMove) s.onTouchMove(t.clientX, t.clientY);
  });
  wx.onTouchEnd(function (e) {
    if (!e.changedTouches || e.changedTouches.length === 0) return;
    var t = e.changedTouches[0];
    var s = self.scene;
    if (s && s.onTouchEnd) s.onTouchEnd(t.clientX, t.clientY);
  });
};

// ---------------- 主循环 ----------------
App.loop = function () {
  var now = Date.now();
  var dt = Math.min(50, now - this.lastFrame || 16);
  this.lastFrame = now;
  if (this.scene && this.scene.update) this.scene.update(dt);
  if (this.scene && this.scene.render) this.scene.render(this.ctx);

  var self = this;
  if (typeof this.canvas.requestAnimationFrame === 'function') {
    this.canvas.requestAnimationFrame(function () { self.loop(); });
  } else {
    setTimeout(function () { self.loop(); }, 16);
  }
};

module.exports = App;
