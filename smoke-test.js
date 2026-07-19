// ทดสอบว่าโมดูลหลักโหลดและทำงานร่วมกันได้ (รันด้วย node ธรรมดา ไม่ต้องมี Electron)
//   npm run smoke
const assert = require('assert');

const bus = require('./src/core/eventBus');
const settings = require('./src/core/settings');
const stats = require('./src/core/stats');
const simulator = require('./src/core/simulator');
const actions = require('./src/core/actions');
const tts = require('./src/core/tts');
const obs = require('./src/core/obs');
const keypress = require('./src/core/keypress');

async function main() {
  const s = settings.load();
  assert(s.serverPort > 0, 'settings มี serverPort');
  assert(s.tts && s.goals && s.timer, 'settings มีโครงครบ');

  stats.init();
  actions.init();
  tts.init();
  assert(typeof obs.connect === 'function' && typeof keypress.press === 'function', 'export ครบตาม contract');

  // จำลอง event แล้วเช็คว่า stats นับถูก
  const received = {};
  for (const ev of ['chat', 'gift', 'like', 'follow', 'stats', 'goals', 'leaderboard']) {
    bus.on(ev, d => { received[ev] = d; });
  }

  simulator.fire('chat', { comment: 'ทดสอบ!' });
  simulator.fire('gift', { giftName: 'Rose', repeatCount: 3 });
  simulator.fire('like', { likeCount: 10 });
  simulator.fire('follow');

  await new Promise(r => setTimeout(r, 700)); // รอ scheduleEmit (400ms)

  assert(received.chat && received.chat.comment === 'ทดสอบ!', 'chat event ทำงาน');
  assert(received.gift && received.gift.diamondTotal === 3, 'gift Rose x3 = 3 เพชร');
  assert(received.stats && received.stats.totalDiamonds === 3, 'stats นับเพชรถูก');
  assert(received.stats.follows === 1, 'stats นับ follow ถูก');
  assert(received.goals.likes.current >= 10, 'goals นับไลค์ถูก');
  assert(received.leaderboard.top.length === 1, 'leaderboard มีผู้ให้ 1 คน');

  // ทดสอบ actions engine: chat keyword → alert
  settings.set({
    actions: [{
      id: 'a_test', name: 'ทดสอบ', enabled: true, cooldownSec: 0,
      trigger: { type: 'chat', keyword: '!alert' },
      responses: [{ type: 'alert', text: '{nickname} เรียก alert', durationSec: 3 }]
    }]
  });
  const alertPromise = new Promise(r => bus.once('alert', r));
  simulator.fire('chat', { comment: 'ขอ !alert หน่อย', nickname: 'ผู้ทดสอบ' });
  const alert = await Promise.race([alertPromise, new Promise((_, rej) => setTimeout(() => rej(new Error('ไม่ได้รับ alert ภายใน 2s')), 2000))]);
  assert(alert.text.includes('ผู้ทดสอบ'), 'template {nickname} ถูกแทนค่า');

  // ทดสอบ TTS pipeline
  const ttsPromise = new Promise(r => bus.once('tts', r));
  tts.speak('สวัสดี');
  const spoken = await Promise.race([ttsPromise, new Promise((_, rej) => setTimeout(() => rej(new Error('ไม่ได้รับ tts ภายใน 2s')), 2000))]);
  assert(spoken.text === 'สวัสดี', 'tts.speak ปล่อย event ถูก');

  // เคลียร์ actions ทดสอบออกจาก settings จริง
  settings.set({ actions: [] });

  console.log('✅ smoke test ผ่านทั้งหมด');
  process.exit(0);
}

main().catch(err => {
  console.error('❌ smoke test ล้มเหลว:', err.message);
  process.exit(1);
});
