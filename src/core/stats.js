// สถิติของ session, เป้าหมาย (goals), อันดับผู้ให้ของขวัญ (leaderboard) และ Subathon timer
// ฟัง event ดิบจาก bus แล้วปล่อย event สรุป: stats, goals, leaderboard, timer
const bus = require('./eventBus');
const settings = require('./settings');

const stats = {
  viewerCount: 0,
  totalLikes: 0,
  sessionLikes: 0,
  totalDiamonds: 0,
  totalChats: 0,
  follows: 0,
  shares: 0,
  joins: 0,
  subscribes: 0,
  giftCount: 0,
  startedAt: null
};

// uniqueId -> { uniqueId, nickname, profilePictureUrl, diamonds, gifts }
let gifters = new Map();
let baselineLikes = null; // totalLikeCount ตอนเริ่ม session เพื่อคิดไลค์เฉพาะ session

const timer = {
  running: false,
  remainingSec: 0,
  totalAddedSec: 0
};
let timerInterval = null;

let emitScheduled = false;
function scheduleEmit() {
  // รวมการอัปเดตถี่ๆ (เช่นฝนไลค์) เป็นรอบละ ~400ms
  if (emitScheduled) return;
  emitScheduled = true;
  setTimeout(() => {
    emitScheduled = false;
    emitAll();
  }, 400);
}

function emitAll() {
  bus.emit('stats', getStats());
  bus.emit('goals', getGoals());
  bus.emit('leaderboard', getLeaderboard());
}

function getStats() {
  return { ...stats };
}

function getGoals() {
  const g = settings.get().goals || {};
  return {
    // ไลค์ = ยอดรวมจริงของห้อง (ไม่ใช่ตัวนับตั้งแต่เชื่อม)
    likes: { ...(g.likes || {}), current: stats.totalLikes },
    diamonds: { ...(g.diamonds || {}), current: stats.totalDiamonds },
    followers: { ...(g.followers || {}), current: stats.follows }
  };
}

function getLeaderboard(limit = 10) {
  const top = [...gifters.values()]
    .sort((a, b) => b.diamonds - a.diamonds)
    .slice(0, limit);
  return { top };
}

function getTimer() {
  const t = settings.get().timer || {};
  return { ...timer, label: t.label || 'Timer', enabled: !!t.enabled };
}

function addTimerSeconds(sec, reason) {
  if (!settings.get().timer.enabled || sec <= 0) return;
  timer.remainingSec += sec;
  timer.totalAddedSec += sec;
  bus.emit('timer', { ...getTimer(), lastAdd: { sec, reason } });
}

function timerControl(cmd, payload = {}) {
  const conf = settings.get().timer;
  switch (cmd) {
    case 'start':
      if (timer.remainingSec <= 0) timer.remainingSec = (conf.initialMinutes || 60) * 60;
      timer.running = true;
      clearInterval(timerInterval);
      timerInterval = setInterval(() => {
        if (!timer.running) return;
        timer.remainingSec = Math.max(0, timer.remainingSec - 1);
        if (timer.remainingSec === 0) {
          timer.running = false;
          clearInterval(timerInterval);
        }
        bus.emit('timer', getTimer());
      }, 1000);
      break;
    case 'pause':
      timer.running = false;
      break;
    case 'reset':
      timer.running = false;
      timer.remainingSec = (conf.initialMinutes || 60) * 60;
      timer.totalAddedSec = 0;
      clearInterval(timerInterval);
      break;
    case 'add':
      // ติดลบได้ (เช่น action หักเวลา) แต่ไม่ให้ต่ำกว่า 0
      timer.remainingSec = Math.max(0, timer.remainingSec + (Number(payload.seconds) || 60));
      break;
    default:
      throw new Error('ไม่รู้จักคำสั่ง timer: ' + cmd);
  }
  bus.emit('timer', getTimer());
  return getTimer();
}

function resetSession() {
  Object.assign(stats, {
    viewerCount: 0, totalLikes: 0, sessionLikes: 0, totalDiamonds: 0, totalChats: 0,
    follows: 0, shares: 0, joins: 0, subscribes: 0, giftCount: 0, startedAt: Date.now()
  });
  gifters = new Map();
  baselineLikes = null;
  emitAll();
}

function trackGifter(d) {
  const key = d.uniqueId;
  const g = gifters.get(key) || {
    uniqueId: d.uniqueId, nickname: d.nickname, profilePictureUrl: d.profilePictureUrl,
    diamonds: 0, gifts: 0
  };
  g.diamonds += d.diamondTotal;
  g.gifts += d.repeatCount;
  g.nickname = d.nickname;
  gifters.set(key, g);
}

function init() {
  bus.on('connected', () => resetSession());

  bus.on('chat', () => { stats.totalChats += 1; scheduleEmit(); });

  // seed ยอดไลค์รวมจากข้อมูลห้องตอนเชื่อม (มาก่อน like event แรก)
  bus.on('likeSeed', d => {
    const total = Number(d.total) || 0;
    if (total > 0) {
      stats.totalLikes = total;
      baselineLikes = total; // เริ่มนับ sessionLikes จากจุดนี้
      scheduleEmit();
    }
  });

  bus.on('like', d => {
    const total = Number(d.totalLikeCount) || 0;
    if (total > 0) {
      // ยอดรวมจริงของห้อง (monotonic — กันค่าเพี้ยนลดลง)
      stats.totalLikes = Math.max(stats.totalLikes, total);
      if (baselineLikes === null) baselineLikes = total - (Number(d.likeCount) || 0);
    } else if (d.likeCount) {
      stats.totalLikes += Number(d.likeCount) || 0; // event ไม่มี total → สะสมเอา
    }
    stats.sessionLikes = baselineLikes === null ? 0 : Math.max(0, stats.totalLikes - baselineLikes);
    scheduleEmit();
  });

  bus.on('gift', d => {
    // นับเฉพาะตอนจบ streak เพื่อไม่ให้นับซ้ำ
    if (!d.repeatEnd) return;
    stats.totalDiamonds += d.diamondTotal;
    stats.giftCount += d.repeatCount;
    trackGifter(d);
    const conf = settings.get().timer;
    if (conf.enabled && conf.secondsPerDiamond > 0) {
      addTimerSeconds(Math.round(d.diamondTotal * conf.secondsPerDiamond), 'gift');
    }
    scheduleEmit();
  });

  bus.on('follow', () => {
    stats.follows += 1;
    const conf = settings.get().timer;
    if (conf.enabled && conf.secondsPerFollow > 0) addTimerSeconds(conf.secondsPerFollow, 'follow');
    scheduleEmit();
  });

  bus.on('share', () => {
    stats.shares += 1;
    const conf = settings.get().timer;
    if (conf.enabled && conf.secondsPerShare > 0) addTimerSeconds(conf.secondsPerShare, 'share');
    scheduleEmit();
  });

  bus.on('member', () => { stats.joins += 1; scheduleEmit(); });
  bus.on('subscribe', () => { stats.subscribes += 1; scheduleEmit(); });
  bus.on('roomStats', d => { stats.viewerCount = d.viewerCount; scheduleEmit(); });
  bus.on('settings:changed', () => scheduleEmit());
}

module.exports = { init, getStats, getGoals, getLeaderboard, getTimer, timerControl, resetSession };
