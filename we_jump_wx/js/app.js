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

  this.registerTouch();
  this.loop = this.loop.bind(this);
  this.loop();

  this.bootstrapLogin();
};

// ---------------- 登录与连接 ----------------
App.bootstrapLogin = function () {
  var self = this;
  var nickname = wx.getStorageSync('nickname');
  if (!nickname) {
    nickname = '跳友' + Math.floor(1000 + Math.random() * 9000);
    wx.setStorageSync('nickname', nickname);
  }

  // 启动参数（分享卡片直达房间）
  try {
    var query = wx.getLaunchOptionsSync().query || {};
    state.pendingRoomNo = query.room || '';
  } catch (e) { state.pendingRoomNo = ''; }

  net.wxLogin().then(function (code) {
    return net.post('/api/auth/login', { code: code, nickname: nickname, avatarUrl: '' });
  }).then(function (res) {
    state.token = res.token;
    state.user = res.user;
    self.connectWs();
  }).catch(function (err) {
    wx.showModal({
      title: '登录失败',
      content: err.message || '请检查服务器地址与网络',
      showCancel: false,
      success: function () { self.bootstrapLogin(); }
    });
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
  var self = this;
  setInterval(function () {
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
      // 对局中重连：保持当前场景（game/result），等待服务端重新同步
      if ((this.currentSceneName() === 'game' || this.currentSceneName() === 'result') && data.room.phase === 1) return;
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
    case 'error':
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
