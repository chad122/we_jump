/**
 * 主菜单场景：创建房间 / 输入房间号加入。
 */
var draw = require('../render/draw.js');
var Button = require('../ui/button.js');
var state = require('../state.js');
var avatar = require('../render/avatar.js');

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
    var gap = 20;
    var cx = this.w / 2;
    var y0 = this.h * 0.46;
    this.buttons = [
      new Button(cx - bw / 2, y0, bw, bh, '创建房间', function () {
        scene.app.actionCreate();
      }, { bg: '#ff9f43' }),
      new Button(cx - bw / 2, y0 + bh + gap, bw, bh, '输入房间号加入', function () {
        scene.app.promptJoin();
      }, { bg: '#4a7dff' })
    ];

    // 微信头像昵称授权按钮：wx.createUserInfoButton 是原生组件，字号/字体/圆角无法自定义，
    // 因此用「画布画外观 + 原生按钮透明覆盖」的方式，保证与上面两个按钮的样式完全一致。
    // 已授权过（数据库已记录）则不再显示。
    this.userBtn = null;
    if (!(state.user && state.user.wxAuthorized)) {
      var authY = y0 + (bh + gap) * 2;
      this.buttons.push(new Button(cx - bw / 2, authY, bw, bh, '使用微信头像昵称', function () {
        if (scene.userBtn) return;   // 原生按钮已接管点击
        scene.app.toast('当前环境不支持微信授权，已使用默认头像昵称');
      }, { bg: '#12b76a' }));

      if (typeof wx.createUserInfoButton === 'function') {
        try {
          this.userBtn = wx.createUserInfoButton({
            type: 'text',
            text: '使用微信头像昵称',
            style: {
              left: cx - bw / 2,
              top: authY,
              width: bw,
              height: bh,
              backgroundColor: 'rgba(0,0,0,0)',   // 透明：外观交给画布绘制
              borderColor: 'rgba(0,0,0,0)',
              borderWidth: 0,
              borderRadius: bh / 2,
              color: 'rgba(0,0,0,0)',
              textAlign: 'center',
              fontSize: 1
            }
          });
          this.userBtn.onTap(function (res) {
            var info = res && res.userInfo;
            if (info && (info.nickName || info.avatarUrl)) {
              scene.app.applyWechatProfile(info.nickName, info.avatarUrl);
            } else {
              scene.app.toast('未获取到微信头像昵称');
            }
          });
        } catch (e) {
          this.userBtn = null;
        }
      }
    }
  };

  /** 离开主菜单时销毁原生授权按钮。 */
  scene.leave = function () {
    if (this.userBtn) {
      try { this.userBtn.destroy(); } catch (e) { /* ignore */ }
      this.userBtn = null;
    }
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

    var pad = state.safeTop || 0;
    var titleY = Math.max(h * 0.18, pad + 60);   // 避开刘海/状态栏
    draw.text(ctx, '多人跳一跳', w / 2, titleY, 42, '#ffffff', 'center', true);
    draw.text(ctx, '棋盘版 · 实时竞速', w / 2, titleY + 40, 16, 'rgba(255,255,255,0.7)');

    // 当前玩家：头像 + 昵称
    var me = state.user || {};
    var midY = Math.max(h * 0.32, titleY + 82);
    avatar.drawAvatar(ctx, w / 2 - 54, midY, 16, me.avatarUrl, me.nickname, '#4a7dff');
    draw.textAutoFit(ctx, me.nickname || '', w / 2 - 32, midY, w * 0.55, 15, '#ffffff', 'left', true);

    for (var i = 0; i < this.buttons.length; i++) this.buttons[i].render(ctx);

    draw.text(ctx, '长按蓄力 · 上划取消 · 看谁先到终点', w / 2, h - 40, 13, 'rgba(255,255,255,0.6)');
  };

  return scene;
}

module.exports = { create: create };
