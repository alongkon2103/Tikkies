// Event bus กลางของ Tikkies Tools — ทุกโมดูลสื่อสารกันผ่านตัวนี้
// เหตุการณ์จาก TikTok (normalize แล้ว): chat, gift, like, follow, share,
//   subscribe, member, roomStats, connected, disconnected, streamEnd
// เหตุการณ์ที่ระบบสร้างเอง: alert, tts, goals, leaderboard, stats, timer, action, log
const { EventEmitter } = require('events');

const bus = new EventEmitter();
bus.setMaxListeners(200);

module.exports = bus;
