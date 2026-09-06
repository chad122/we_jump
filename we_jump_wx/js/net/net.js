/**
 * 网络层：HTTP 封装 + WebSocket 客户端 + 微信登录。
 * 通信信封统一为 JSON: {type, data}
 */
var cfg = require('../config.js');

/** wx.login 换取临时 code。 */
function wxLogin() {
  return new Promise(function (resolve, reject) {
    wx.login({
      success: function (res) { resolve(res.code); },
      fail: function () { reject(new Error('wx.login 失败')); }
    });
  });
}

/** POST JSON。 */
function post(path, data) {
  return new Promise(function (resolve, reject) {
    wx.request({
      url: cfg.HTTP_BASE + path,
      method: 'POST',
      data: data || {},
      header: { 'content-type': 'application/json' },
      success: function (res) {
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(res.data);
        else reject(new Error((res.data && res.data.msg) || ('HTTP ' + res.statusCode)));
      },
      fail: function () { reject(new Error('网络请求失败')); }
    });
  });
}

/** GET JSON（token 通过 query 传递）。 */
function get(path, query) {
  return new Promise(function (resolve, reject) {
    var qs = [];
    if (query) {
      for (var k in query) if (query.hasOwnProperty(k)) qs.push(k + '=' + encodeURIComponent(query[k]));
    }
    var url = cfg.HTTP_BASE + path + (qs.length ? ('?' + qs.join('&')) : '');
    wx.request({
      url: url,
      method: 'GET',
      success: function (res) {
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(res.data);
        else reject(new Error((res.data && res.data.msg) || ('HTTP ' + res.statusCode)));
      },
      fail: function () { reject(new Error('网络请求失败')); }
    });
  });
}

/**
 * WebSocket 客户端封装（含自动重连）。
 */
function WsClient() {
  this.task = null;
  this.url = '';
  this.autoReconnect = false;
  this.reconnectTimer = null;
  this.onOpen = null;      // () => void
  this.onClose = null;     // (res) => void  重连后关闭
  this.onError = null;     // (err) => void
  this.onMessage = null;   // (type, data) => void
}

WsClient.prototype.connect = function (url) {
  var self = this;
  self.url = url;
  self.close();

  self.task = wx.connectSocket({ url: url, header: {} });
  var task = self.task;

  task.onOpen(function () {
    self.onOpen && self.onOpen();
  });
  task.onClose(function (res) {
    self.task = null;
    if (self.autoReconnect) self.scheduleReconnect();
    self.onClose && self.onClose(res);
  });
  task.onError(function (err) {
    self.onError && self.onError(err);
  });
  task.onMessage(function (res) {
    var msg;
    try { msg = JSON.parse(res.data); } catch (e) { return; }
    if (msg && self.onMessage) self.onMessage(msg.type, msg.data);
  });
};

WsClient.prototype.scheduleReconnect = function () {
  var self = this;
  if (self.reconnectTimer) return;
  self.reconnectTimer = setTimeout(function () {
    self.reconnectTimer = null;
    if (self.autoReconnect) self.connect(self.url);
  }, 2000);
};

WsClient.prototype.send = function (type, data) {
  if (!this.task) return false;
  try {
    this.task.send({ data: JSON.stringify({ type: type, data: data || {} }) });
    return true;
  } catch (e) { return false; }
};

WsClient.prototype.close = function () {
  if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
  this.autoReconnect = false;
  if (this.task) {
    try { this.task.close({ code: 1000, reason: 'bye' }); } catch (e) { /* ignore */ }
    this.task = null;
  }
};

module.exports = {
  wxLogin: wxLogin,
  post: post,
  get: get,
  WsClient: WsClient
};
