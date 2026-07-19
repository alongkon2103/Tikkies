// ระบบอ่านข้อความ (TTS) ของ Tikkies Tools
// โมดูลนี้ "ไม่ได้อ่านเสียงเอง" — แค่กรอง/จัดรูปข้อความแล้วปล่อย event 'tts' ขึ้น bus
// คนอ่านเสียงจริงคือ:
//   - หน้า Dashboard เมื่อ settings.tts.playInApp === true (ค่าเริ่มต้น แนะนำ)
//   - widget tts.html เมื่อเปิดในเบราว์เซอร์จริง (OBS browser source ไม่รองรับ speechSynthesis)
const bus = require('./eventBus');
const settings = require('./settings');

let nextId = 0;
let initialized = false;

// แทนที่ {key} ใน template ด้วยค่าจาก data (เช่น {nickname} {giftName} {repeatCount})
function fillTemplate(tpl, data) {
  return String(tpl || '').replace(/\{(\w+)\}/g, (_, k) =>
    (data && data[k] != null ? String(data[k]) : ''));
}

// อิโมจิ + สัญลักษณ์รูปภาพ (ไม่อยากให้ TTS อ่าน) — ครอบคลุมทุก plane ของ emoji + dingbats + ลูกศร + ZWJ
const EMOJI_RE = /[\u{1F000}-\u{1FFFF}\u{2190}-\u{21FF}\u{2300}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE00}-\u{FE0F}\u{200D}\u{20E3}\u{2122}\u{2139}\u{00A9}\u{00AE}]/gu;

// ตัดอิโมจิ + อักขระควบคุม/อักขระล่องหน แล้วยุบช่องว่างซ้ำ
function sanitize(text) {
  return String(text == null ? '' : text)
    .replace(EMOJI_RE, ' ')
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ตรวจสิทธิ์ผู้ส่งตาม settings.tts.minRole (all | follower | subscriber | moderator)
function passMinRole(data, minRole) {
  if (minRole === 'follower') return (Number(data.followRole) || 0) >= 1;
  if (minRole === 'subscriber') return !!data.isSubscriber;
  if (minRole === 'moderator') return !!data.isModerator;
  return true; // 'all' หรือค่าที่ไม่รู้จัก = ไม่กรอง
}

// กรอง/ตัดข้อความตาม settings.tts แล้วปล่อย event 'tts'
// คืน true ถ้าปล่อย event สำเร็จ, false ถ้าข้อความถูกกรองทิ้ง
function speak(text, opts = {}) {
  const s = settings.get().tts || {};

  let msg = sanitize(text);
  if (!msg) return false;

  // เจอคำต้องห้ามคำเดียว → ข้ามทั้งข้อความ
  const banned = Array.isArray(s.bannedWords) ? s.bannedWords : [];
  const lower = msg.toLowerCase();
  for (const w of banned) {
    const word = sanitize(w).toLowerCase();
    if (word && lower.includes(word)) return false;
  }

  // ตัดความยาวตาม maxLength
  const maxLength = Number(s.maxLength) > 0 ? Math.floor(Number(s.maxLength)) : 120;
  if (msg.length > maxLength) msg = msg.slice(0, maxLength).trim();
  if (!msg) return false;

  nextId += 1;
  const rate = Number(s.rate);
  const pitch = Number(s.pitch);
  const volume = Number(s.volume);
  bus.emit('tts', {
    id: nextId,
    text: msg,
    voice: s.voice || '',
    rate: Number.isFinite(rate) ? rate : 1,
    pitch: Number.isFinite(pitch) ? pitch : 1,
    volume: Number.isFinite(volume) ? volume : 1,
    ...opts
  });
  return true;
}

function init() {
  if (initialized) return; // กัน subscribe ซ้ำ
  initialized = true;

  // แชท: อ่านเมื่อเปิด readChat, ผ่าน minRole และไม่ใช่คำสั่ง (!...)
  // รูปแบบการอ่านตั้งได้ผ่าน settings.tts.chatTemplate เช่น '{comment}' = อ่านแต่ข้อความไม่อ่านชื่อ
  bus.on('chat', (data) => {
    const s = settings.get().tts || {};
    if (!s.enabled || !s.readChat) return;
    if (!passMinRole(data || {}, s.minRole || 'all')) return;
    const comment = String((data && data.comment) || '').trim();
    if (!comment || comment.startsWith('!')) return;
    if (!sanitize(comment)) return; // เหลือแต่อิโมจิ (สะอาดแล้วว่าง) → ไม่อ่าน
    const nickname = (data && (data.nickname || data.uniqueId)) || 'ผู้ชม';
    speak(fillTemplate(s.chatTemplate || '{nickname} บอกว่า {comment}', {
      ...(data || {}), nickname, comment
    }));
  });

  // ของขวัญ: อ่านเฉพาะตอนจบ streak (repeatEnd) จะได้ไม่อ่านซ้ำระหว่างคอมโบ
  bus.on('gift', (data) => {
    const s = settings.get().tts || {};
    if (!s.enabled || !s.readGifts) return;
    if (!data || !data.repeatEnd) return;
    speak(fillTemplate(s.giftTemplate || '{nickname} ส่ง {giftName} จำนวน {repeatCount} ชิ้น', data));
  });

  // ผู้ติดตามใหม่
  bus.on('follow', (data) => {
    const s = settings.get().tts || {};
    if (!s.enabled || !s.readFollows) return;
    speak(fillTemplate(s.followTemplate || '{nickname} กดติดตามแล้ว', data || {}));
  });

  bus.emit('log', { level: 'info', msg: 'โมดูล TTS พร้อมทำงาน' });
}

module.exports = { init, speak };
