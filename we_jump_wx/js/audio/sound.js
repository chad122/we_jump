/**
 * 音频：用 WebAudio（wx.createWebAudioContext）实时合成，不依赖任何音频资源文件。
 * - BGM：菜单/房间用舒缓循环（menu），对局中换成快节奏循环（game，带低音鼓点）制造紧迫感；
 * - 音效：每次跳跃 jump()、有人抵达终点 finish()。
 * 平台不支持 WebAudio 或尚未解锁时全部静默降级，绝不影响游戏逻辑。
 * 说明：微信要求音频在**首次用户手势**后才能出声，因此 App 在第一次触摸时调用 init()。
 */

var ctxA = null;        // WebAudioContext
var master = null;      // 总音量
var bgmGain = null;     // BGM 音量（比音效低，不抢音效）
var sfxGain = null;     // 音效音量
var timer = null;       // BGM 调度定时器
var cur = '';           // 当前 BGM 名（'' = 无）
var want = '';          // 未解锁/切后台时记住的目标 BGM
var step = 0;           // 已播放到第几步
var nextAt = 0;         // 下一步的绝对播放时间（秒）

// 音高用 MIDI 编号（0 = 休止）；menu 为 A 小调琶音，game 是同一和声的加速加密版
var TRACKS = {
  menu: {
    stepSec: 0.30, wave: 'triangle', leadGain: 0.15, bassGain: 0.10, drum: false,
    lead: [69, 76, 72, 76, 69, 76, 72, 76, 67, 74, 71, 74, 67, 74, 71, 74],
    bass: [45, 0, 0, 0, 45, 0, 0, 0, 43, 0, 0, 0, 43, 0, 0, 0]
  },
  game: {
    stepSec: 0.15, wave: 'square', leadGain: 0.12, bassGain: 0.11, drum: true,
    lead: [81, 76, 79, 76, 81, 84, 79, 76, 79, 74, 77, 74, 79, 83, 77, 74],
    bass: [45, 45, 52, 45, 45, 45, 52, 45, 43, 43, 50, 43, 43, 43, 50, 43]
  }
};

function midi(n) { return 440 * Math.pow(2, (n - 69) / 12); }

/** 首次用户手势后初始化音频上下文；返回是否可用。 */
function init() {
  if (ctxA) {
    if (ctxA.state === 'suspended' && ctxA.resume) { try { ctxA.resume(); } catch (e) { /* ignore */ } }
    return true;
  }
  if (typeof wx.createWebAudioContext !== 'function') return false;
  try {
    ctxA = wx.createWebAudioContext();
    master = ctxA.createGain(); master.gain.value = 0.9; master.connect(ctxA.destination);
    bgmGain = ctxA.createGain(); bgmGain.gain.value = 1; bgmGain.connect(master);
    sfxGain = ctxA.createGain(); sfxGain.gain.value = 1; sfxGain.connect(master);
    if (ctxA.state === 'suspended' && ctxA.resume) ctxA.resume();
  } catch (e) {
    ctxA = null;
    return false;
  }
  if (want) { var n = want; want = ''; bgm(n); }   // 之前请求过的 BGM 现在可以播了
  return true;
}

/** 音频是否已就绪且处于运行状态（未解锁/切后台挂起时不排音符，避免解锁瞬间“爆音”）。 */
function ready() {
  if (!init() || !ctxA) return false;
  return ctxA.state !== 'suspended';
}

/**
 * 播放一个音：freq 为数字（固定音高）或 [起始, 结束]（滑音），带指数衰减包络。
 */
function tone(dest, freq, at, dur, wave, gain) {
  var o = ctxA.createOscillator();
  var g = ctxA.createGain();
  o.type = wave;
  if (freq.length) {
    o.frequency.setValueAtTime(freq[0], at);
    o.frequency.exponentialRampToValueAtTime(freq[1], at + dur);
  } else {
    o.frequency.value = freq;
  }
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(gain, at + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  o.connect(g); g.connect(dest);
  o.start(at); o.stop(at + dur + 0.02);
}

function scheduleStep(i) {
  var t = TRACKS[cur];
  if (!t) return;
  var lead = t.lead[i % t.lead.length];
  var bass = t.bass[i % t.bass.length];
  if (lead) tone(bgmGain, midi(lead), nextAt, t.stepSec * 1.7, t.wave, t.leadGain);
  if (bass) tone(bgmGain, midi(bass), nextAt, t.stepSec * 1.9, 'sine', t.bassGain);
  if (t.drum && i % 4 === 0) tone(bgmGain, [150, 55], nextAt, 0.13, 'sine', 0.18);
}

/** 提前 0.3s 预约音符，避免 setInterval 抖动导致节奏不稳。 */
function pump() {
  if (!ready() || !cur) return;
  var t = TRACKS[cur];
  var now = ctxA.currentTime;
  if (nextAt < now) nextAt = now + 0.02;
  while (nextAt < now + 0.3) {
    scheduleStep(step);
    nextAt += t.stepSec;
    step++;
  }
}

function stopBgm() {
  if (timer) { clearInterval(timer); timer = null; }
  cur = '';
}

/** 切换 BGM：'menu' / 'game' / ''（停止）。同名不重启。 */
function bgm(name) {
  name = name || '';
  if (name === cur) return;
  stopBgm();
  if (!name) return;
  if (!init()) { want = name; return; }   // 还没解锁：等首次手势后自动补播
  cur = name;
  step = 0;
  nextAt = ctxA.currentTime + 0.08;
  pump();
  timer = setInterval(pump, 80);
}

/** 每次跳跃：短促上滑音（自己的响一些，别人的轻一些）。 */
function jump(mine) {
  if (!ready()) return;
  tone(sfxGain, [600, 1000], ctxA.currentTime + 0.005, 0.11, 'triangle', mine ? 0.22 : 0.11);
}

/** 有人抵达终点：上行三音小号 + 尾音。 */
function finish() {
  if (!ready()) return;
  var at = ctxA.currentTime + 0.01;
  var seq = [76, 81, 88];              // E5 A5 E6
  for (var i = 0; i < seq.length; i++) tone(sfxGain, midi(seq[i]), at + i * 0.11, 0.26, 'square', 0.18);
  tone(sfxGain, [1046, 1568], at + 0.33, 0.30, 'triangle', 0.14);
}

/** 切后台：停调度并挂起上下文（回前台由 resume() 续播）。 */
function pause() {
  var n = cur || want;
  stopBgm();
  want = n;
  if (ctxA && ctxA.suspend) { try { ctxA.suspend(); } catch (e) { /* ignore */ } }
}

/** 回前台：恢复上下文并续播之前的 BGM。 */
function resume() {
  if (ctxA && ctxA.resume) { try { ctxA.resume(); } catch (e) { /* ignore */ } }
  if (want) { var n = want; want = ''; bgm(n); }
}

module.exports = {
  init: init,
  bgm: bgm,
  jump: jump,
  finish: finish,
  pause: pause,
  resume: resume
};
