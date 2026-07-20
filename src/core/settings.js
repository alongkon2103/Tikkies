// จัดการการตั้งค่าแบบไฟล์ JSON (persist ลง userData ของ Electron หรือ ./data เมื่อรันแบบ standalone)
const fs = require('fs');
const path = require('path');
const bus = require('./eventBus');

const DEFAULTS = {
  username: '',
  autoConnect: false,
  signApiKey: '', // Euler Stream API key (ไม่บังคับ — ช่วยเพิ่ม rate limit ในการเชื่อมต่อ)
  serverPort: 21213,
  language: 'th',
  tts: {
    enabled: true,
    playInApp: true, // ให้หน้า Dashboard เป็นคนอ่านเสียง (OBS browser source มักไม่รองรับ speechSynthesis)
    readChat: true,
    readGifts: true,
    readFollows: true,
    chatTemplate: '{nickname} บอกว่า {comment}', // ใส่ {comment} เฉยๆ ถ้าไม่อยากอ่านชื่อ
    giftTemplate: '{nickname} ส่ง {giftName} จำนวน {repeatCount} ชิ้น',
    followTemplate: '{nickname} กดติดตามแล้ว',
    voice: '',
    rate: 1.0,
    pitch: 1.0,
    volume: 1.0,
    maxLength: 120,
    bannedWords: [],
    minRole: 'all' // all | follower | subscriber | moderator
  },
  actions: [
    // { id, name, enabled, cooldownSec, trigger: {type, giftName, keyword, likeThreshold, minDiamonds},
    //   responses: [ {type:'alert', text, imageUrl, soundUrl, durationSec},
    //                {type:'tts', text}, {type:'sound', url},
    //                {type:'keypress', key, modifiers, holdMs},
    //                {type:'obs', obsAction, scene, source, visible},
    //                {type:'webhook', url, method, body},
    //                {type:'wheel'},
    //                {type:'timer', timerCmd:'add'|'start'|'pause'|'reset', seconds} ] }
    // trigger เพิ่มเติม: {type:'hotkey', accelerator}, {type:'wheelResult', prize}
  ],
  goals: {
    likes:     { enabled: true,  target: 1000, label: 'เป้าหมายหัวใจ' },
    diamonds:  { enabled: true,  target: 500,  label: 'เป้าหมายเพชร' },
    followers: { enabled: false, target: 50,   label: 'ผู้ติดตามใหม่' }
  },
  timer: {
    enabled: false,
    initialMinutes: 60,
    secondsPerDiamond: 1,
    secondsPerFollow: 10,
    secondsPerShare: 5,
    label: 'Subathon Timer'
  },
  obs: { enabled: false, url: 'ws://127.0.0.1:4455', password: '' },
  wheel: {
    title: 'สุ่มรางวัล',
    durationSec: 8,       // เวลาหมุนก่อนหยุด
    announceTts: true,    // อ่านผลรางวัลด้วยเสียง
    resultHoldSec: 6,     // แสดงผลค้างไว้กี่วินาที
    segments: [
      // weight = น้ำหนักโอกาสออก (มากออกง่าย)
      { label: 'ร้องเพลง 1 เพลง', weight: 3 },
      { label: 'เต้น 10 วินาที', weight: 3 },
      { label: 'เล่าเรื่องตลก', weight: 3 },
      { label: 'ทำหน้าตลก', weight: 3 },
      { label: 'รางวัลใหญ่!', weight: 1 },
      { label: 'หมุนอีกครั้ง', weight: 2 }
    ]
  },
  overlay: {
    theme: 'dark',
    accentColor: '#fe2c55',
    font: 'Prompt, Kanit, sans-serif',
    chatShowAvatars: true,
    chatHideCommands: false,
    alertDurationSec: 6,
    alertMinDiamonds: 0
  }
};

let filePath = null;
let data = null;

function deepMerge(base, patch) {
  if (Array.isArray(patch) || typeof patch !== 'object' || patch === null) return patch;
  const out = Array.isArray(base) ? [] : { ...(base || {}) };
  for (const k of Object.keys(patch)) {
    out[k] = deepMerge(base ? base[k] : undefined, patch[k]);
  }
  return out;
}

function resolveDir() {
  try {
    // ใช้ userData เมื่อรันใน Electron
    const { app } = require('electron');
    if (app && app.getPath) return app.getPath('userData');
  } catch (_) { /* ไม่ได้รันใน Electron */ }
  return path.join(__dirname, '..', '..', 'data');
}

function load() {
  const dir = resolveDir();
  fs.mkdirSync(dir, { recursive: true });
  filePath = path.join(dir, 'settings.json');
  data = JSON.parse(JSON.stringify(DEFAULTS));
  try {
    if (fs.existsSync(filePath)) {
      const saved = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      data = deepMerge(data, saved);
    }
  } catch (err) {
    bus.emit('log', { level: 'warn', msg: 'อ่าน settings.json ไม่สำเร็จ ใช้ค่าเริ่มต้นแทน: ' + err.message });
  }
  return data;
}

function save() {
  if (!filePath) load();
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

function get() {
  if (!data) load();
  return data;
}

// patch แบบ deep merge; ถ้า key ไหนเป็น array จะแทนที่ทั้ง array
function set(patch) {
  if (!data) load();
  data = deepMerge(data, patch);
  save();
  bus.emit('settings:changed', data);
  return data;
}

// ค่าที่ปลอดภัยพอจะส่งให้ widget ฝั่งเบราว์เซอร์
function publicSettings() {
  const s = get();
  return { tts: s.tts, goals: s.goals, timer: s.timer, overlay: s.overlay, wheel: s.wheel, language: s.language };
}

module.exports = { load, get, set, save, publicSettings, DEFAULTS };
