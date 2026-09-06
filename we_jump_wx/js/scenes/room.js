/**
 * 房间场景：展示成员、房主选图/开局/分享、退出。
 */
var draw = require('../render/draw.js');
var Button = require('../ui/button.js');
var state = require('../state.js');
var mapMeta = require('../logic/mapMeta.js');

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
    this.rebuild();
  };

  scene.isHost = function () {
    return !!(state.room && state.room.hostSeat === state.mySeat);
  };

  scene.rebuild = function () {
    var w = this.w, h = this.h;
    var buttons = [];
    var isHost = this.isHost();
    var bw = Math.min(w * 0.7, 280);
    var bh = 46;
    var cx = w / 2;
    var y = h - 60 - bh * 2;

    if (isHost) {
      buttons.push(new Button(cx - bw / 2, y, bw, bh, '开始游戏', function () {
        scene.app.send('start_game', {});
      }, { bg: '#12b76a' }));

      buttons.push(new Button(cx - bw / 2, y + bh + 14, bw, bh, '选择地图', function () {
        scene.pickMap();
      }, { bg: '#4a7dff' }));

      buttons.push(new Button(cx - bw / 2, y + (bh + 14) * 2, bw, bh, '分享房间', function () {
        scene.shareRoom();
      }, { bg: '#8b5cf6' }));

      buttons.push(new Button(cx - bw / 2, y + (bh + 14) * 3, bw, bh, '离开房间', function () {
        scene.app.leaveRoom();
      }, { bg: '#e5484d' }));
    } else {
      buttons.push(new Button(cx - bw / 2, y + bh + 14, bw, bh, '离开房间', function () {
        scene.app.leaveRoom();
      }, { bg: '#e5484d' }));
    }
    this.buttons = buttons;
  };

  scene.pickMap = function () {
    var names = mapMeta.map(function (m) { return m.name + '（' + m.difficulty + '）'; });
    wx.showActionSheet({
      itemList: names,
      success: function (res) {
        var m = mapMeta[res.tapIndex];
        if (m) scene.app.send('select_map', { mapId: m.id });
      }
    });
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
    for (var i = 0; i < this.buttons.length; i++) {
      var b = this.buttons[i];
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

    draw.text(ctx, '房间号 ' + state.room.roomNo, w / 2, 56, 28, '#ffffff', 'center', true);

    var mapName = '新手草原';
    var dm = state.room.mapId;
    for (var i = 0; i < mapMeta.length; i++) if (mapMeta[i].id === dm) mapName = mapMeta[i].name;
    draw.text(ctx, '当前地图：' + mapName + '（房主可更换）', w / 2, 96, 14, 'rgba(255,255,255,0.75)');

    // 成员列表
    var players = state.room.players || [];
    var ly = 132;
    draw.text(ctx, '成员 ' + players.length + '/6', w / 2, ly, 13, 'rgba(255,255,255,0.6)');
    for (var j = 0; j < players.length; j++) {
      var p = players[j];
      var py = ly + 24 + j * 30;
      var isHostSeat = p.seat === state.room.hostSeat;
      draw.fillRoundRect(ctx, w * 0.08, py - 11, w * 0.84, 26, 13, 'rgba(255,255,255,0.08)');
      // 头像圆点
      var cx0 = w * 0.14;
      ctx.fillStyle = state.seatColor(p.seat);
      ctx.beginPath();
      ctx.arc(cx0, py, 8, 0, Math.PI * 2);
      ctx.fill();
      var meMark = p.seat === state.mySeat ? '（我）' : '';
      var hostMark = isHostSeat ? '★ ' : '';
      draw.text(ctx, hostMark + p.nickname + meMark, w * 0.14 + 16, py, 14, '#ffffff', 'left');
      draw.text(ctx, p.online ? '在线' : '离线', w * 0.88, py, 12, p.online ? '#6ee7a8' : '#f0a3a3', 'right');
    }

    var hint = this.isHost()
      ? '至少 2 名在线玩家即可开始'
      : '等待房主选择地图并开始游戏…';
    draw.text(ctx, hint, w / 2, h - 20, 12, 'rgba(255,255,255,0.6)');

    for (var b = 0; b < this.buttons.length; b++) this.buttons[b].render(ctx);
  };

  return scene;
}

module.exports = { create: create };
