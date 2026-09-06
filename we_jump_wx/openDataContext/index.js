/**
 * 开放数据域（好友排行榜）占位脚手架 —— MVP 后置能力。
 *
 * 接入步骤（后续迭代）：
 *  1. 在微信公众平台「小游戏-设置-开放数据域」把本目录登记为开放数据域；
 *  2. 主域在结算页调用 wx.getOpenDataContext().postMessage({type:'load_rank'})；
 *  3. 主域每局结束已通过 wx.setUserCloudStorage 写入 score/rank/finished（见 js/app.js recordResult）；
 *  4. 本文件读取好友 score 并排序绘制到 sharedCanvas。
 */
var sharedCanvas = wx.getSharedCanvas();
var ctx = sharedCanvas.getContext('2d');

wx.onMessage(function (msg) {
  if (!msg || msg.type !== 'load_rank') return;
  wx.getFriendCloudStorage({
    keyList: ['score', 'finished'],
    success: function (res) {
      render((res.data || []));
    },
    fail: function () {
      render([]);
    }
  });
});

function render(list) {
  ctx.clearRect(0, 0, sharedCanvas.width, sharedCanvas.height);
  ctx.fillStyle = '#ffffff';
  ctx.font = '14px sans-serif';
  ctx.textAlign = 'left';

  var items = (list || []).slice().sort(function (a, b) {
    var sa = scoreOf(a);
    var sb = scoreOf(b);
    return sb - sa;
  });

  items.forEach(function (it, i) {
    ctx.fillText((i + 1) + '. ' + (it.nickname || '好友'), 10, 24 + i * 26);
  });
}

function scoreOf(it) {
  try {
    var kv = it.KVDataList || [];
    for (var i = 0; i < kv.length; i++) {
      if (kv[i].key === 'score') return Number(kv[i].value) || 0;
    }
  } catch (e) { /* ignore */ }
  return 0;
}
