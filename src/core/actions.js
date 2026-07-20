// Actions engine — หัวใจของระบบ trigger (แนว TikFinity)
// ฟัง event จาก TikTok ผ่าน bus แล้ว match กับ settings.get().actions
// ดูโครงสร้าง action และเงื่อนไข trigger ใน docs/CONTRACT.md
const bus = require('./eventBus');
const settings = require('./settings');

// event ที่ engine นี้ฟังเพื่อ match trigger
// ('hotkey' ไม่อยู่ในนี้ — คีย์ลัดถูก register/ยิงโดย src/core/hotkeys.js โดยตรง)
const TRIGGER_EVENTS = ['chat', 'gift', 'like', 'follow', 'share', 'subscribe', 'member', 'wheelResult'];

// placeholder ที่อนุญาตใน template (ตาม CONTRACT.md)
const TEMPLATE_RE = /\{(nickname|uniqueId|comment|giftName|repeatCount|diamondCount|diamondTotal|likeCount|totalLikes|prize)\}/g;

let initialized = false;

// สถานะ runtime ต่อ action (ไม่ persist)
const lastFired = new Map(); // actionId -> timestamp (ms) ที่ยิงล่าสุด (สำหรับ cooldown)
const likeState = new Map(); // actionId -> { lastMilestone: หลักยอดรวมล่าสุดที่ยิงแล้ว }
let latestTotalLikes = 0;    // ยอดไลค์รวมจริงล่าสุดของห้อง (จาก event/seed)

// เติมค่า placeholder ลงใน template string; ค่าที่ไม่มีใน data จะกลายเป็นสตริงว่าง
function fillTemplate(str, data) {
  if (typeof str !== 'string' || str === '') return str || '';
  return str.replace(TEMPLATE_RE, (_m, key) => {
    const v = data ? data[key] : undefined;
    return v === undefined || v === null ? '' : String(v);
  });
}

// ตรวจ cooldown ของ action; คืน true ถ้ายิงได้
function cooldownOk(action, now) {
  const cd = Number(action.cooldownSec) || 0;
  if (cd <= 0) return true;
  const last = lastFired.get(action.id) || 0;
  return now - last >= cd * 1000;
}

// ตรวจเงื่อนไข trigger ของ action กับ event ที่เข้ามา (ไม่รวม like ที่มี logic สะสมแยก)
function matchTrigger(trigger, eventType, data) {
  if (!trigger || trigger.type !== eventType) return false;
  switch (eventType) {
    case 'gift': {
      // นับเฉพาะตอนจบ streak เท่านั้น (กันยิงซ้ำระหว่าง combo)
      if (data.repeatEnd !== true) return false;
      const wantName = (trigger.giftName || '').trim();
      if (wantName && String(data.giftName || '').toLowerCase() !== wantName.toLowerCase()) return false;
      if ((Number(data.diamondTotal) || 0) < (Number(trigger.minDiamonds) || 0)) return false;
      return true;
    }
    case 'chat': {
      const keyword = (trigger.keyword || '').trim();
      if (!keyword) return true; // ว่าง = ทุกข้อความ
      return String(data.comment || '').toLowerCase().includes(keyword.toLowerCase());
    }
    case 'wheelResult': {
      // สุ่มรางวัลออก — trigger.prize ว่าง = รางวัลอะไรก็ได้, ไม่งั้นต้องตรงชื่อ
      const want = (trigger.prize || '').trim();
      if (!want) return true;
      return String(data.prize || '').trim().toLowerCase() === want.toLowerCase();
    }
    case 'follow':
    case 'share':
    case 'subscribe':
    case 'member':
      return true; // ยิงทุกครั้ง
    default:
      return false;
  }
}

// รัน responses ของ action ตามลำดับ — แต่ละ response ห่อ try/catch แยกกัน
async function run(action, eventData) {
  const data = eventData || {};
  const responses = Array.isArray(action.responses) ? action.responses : [];
  for (const r of responses) {
    if (!r || !r.type) continue;
    try {
      switch (r.type) {
        case 'alert': {
          const overlay = settings.get().overlay || {};
          bus.emit('alert', {
            text: fillTemplate(r.text || '', data),
            subText: fillTemplate(r.subText || '', data),
            imageUrl: r.imageUrl || '',
            soundUrl: r.soundUrl || '',
            durationSec: r.durationSec || overlay.alertDurationSec || 6,
            accentColor: overlay.accentColor || '#fe2c55'
          });
          break;
        }
        case 'tts': {
          const tts = require('./tts');
          await tts.speak(fillTemplate(r.text || '', data));
          break;
        }
        case 'sound': {
          bus.emit('sound', { url: r.url || '', volume: r.volume ?? 1 });
          break;
        }
        case 'keypress': {
          const keypress = require('./keypress');
          await keypress.press(r.key, r.modifiers, r.holdMs);
          break;
        }
        case 'obs': {
          const obs = require('./obs');
          if (r.obsAction === 'setScene') {
            await obs.setScene(r.scene);
          } else if (r.obsAction === 'toggleSource') {
            await obs.toggleSource(r.scene, r.source, r.visible);
          } else {
            throw new Error('ไม่รู้จักคำสั่ง OBS: ' + r.obsAction);
          }
          break;
        }
        case 'wheel': {
          require('./wheel').spin('action:' + (action.name || action.id));
          break;
        }
        case 'timer': {
          // สั่ง Subathon Timer: add (เพิ่ม/ลดวินาที — ติดลบได้), start, pause, reset
          const stats = require('./stats');
          const cmd = r.timerCmd || 'add';
          stats.timerControl(cmd, cmd === 'add' ? { seconds: Number(r.seconds) || 60 } : {});
          break;
        }
        case 'webhook': {
          if (!r.url) throw new Error('ไม่ได้ระบุ URL ของ webhook');
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 5000);
          try {
            const body = r.body ? fillTemplate(r.body, data) : undefined;
            const opts = {
              method: r.method || 'POST',
              signal: controller.signal
            };
            if (body !== undefined) {
              opts.headers = { 'Content-Type': 'application/json' };
              opts.body = body;
            }
            const res = await fetch(r.url, opts);
            if (!res.ok) throw new Error('เซิร์ฟเวอร์ตอบกลับสถานะ ' + res.status);
          } finally {
            clearTimeout(timer);
          }
          break;
        }
        default:
          throw new Error('ไม่รู้จักชนิด response: ' + r.type);
      }
    } catch (err) {
      bus.emit('log', {
        level: 'error',
        msg: 'แอคชั่น "' + (action.name || action.id || '?') + '" ทำงานส่วน ' + r.type + ' ไม่สำเร็จ: ' + (err && err.message ? err.message : String(err))
      });
    }
  }
}

// ยิง action หนึ่งตัว: บันทึกเวลา, แจ้ง bus แล้ว run (error ภายใน run ถูกจับต่อ response แล้ว)
function fire(action, eventType, data) {
  lastFired.set(action.id, Date.now());
  bus.emit('action', { actionId: action.id, name: action.name, triggeredBy: eventType });
  run(action, data).catch((err) => {
    bus.emit('log', { level: 'error', msg: 'รันแอคชั่น "' + (action.name || '?') + '" ล้มเหลว: ' + err.message });
  });
}

// จัดการ event หนึ่งตัวจาก bus — ไล่เช็คทุก action ใน settings
function handleEvent(eventType, data) {
  let actions;
  try {
    actions = settings.get().actions;
  } catch (err) {
    bus.emit('log', { level: 'error', msg: 'อ่านรายการแอคชั่นไม่สำเร็จ: ' + err.message });
    return;
  }
  // อัปเดตยอดไลค์รวมจริงก่อนไล่ action (ใช้ค่าจริงถ้ามี ไม่งั้นสะสมจาก batch)
  if (eventType === 'like') {
    const total = Number(data.totalLikeCount) || 0;
    latestTotalLikes = total > 0 ? Math.max(latestTotalLikes, total) : latestTotalLikes + (Number(data.likeCount) || 0);
  }

  if (!Array.isArray(actions) || actions.length === 0) return;
  const now = Date.now();

  for (const action of actions) {
    if (!action || action.enabled === false) continue;
    const trigger = action.trigger;
    if (!trigger || trigger.type !== eventType) continue;

    if (eventType === 'like') {
      // ยิงเมื่อ "ยอดไลค์รวมจริงของห้อง" ข้ามหลักใหม่ของ likeThreshold (เช่นทุก 1,000 → 1000, 2000, ...)
      const threshold = Number(trigger.likeThreshold) || 0;
      if (threshold <= 0) continue;
      const total = latestTotalLikes; // อัปเดตไว้แล้วก่อนเข้าลูป (ดู handleEvent)
      let st = likeState.get(action.id);
      if (!st) {
        // init เป็นหลักปัจจุบัน กันยิงย้อนหลังตอนเชื่อมกลางไลฟ์
        st = { lastMilestone: Math.floor(total / threshold) };
        likeState.set(action.id, st);
      }
      const milestone = Math.floor(total / threshold);
      if (milestone > st.lastMilestone && cooldownOk(action, now)) {
        st.lastMilestone = milestone;
        const milestoneValue = milestone * threshold; // เลขหมุดกลม เช่น 2000
        fire(action, eventType, Object.assign({}, data, { likeCount: milestoneValue, totalLikes: total }));
      }
      continue;
    }

    if (!matchTrigger(trigger, eventType, data)) continue;
    if (!cooldownOk(action, now)) continue;
    fire(action, eventType, data);
  }
}

// เริ่มฟัง bus events (เรียกครั้งเดียวจาก main.js)
function init() {
  if (initialized) return;
  initialized = true;
  for (const ev of TRIGGER_EVENTS) {
    bus.on(ev, (data) => {
      try {
        handleEvent(ev, data || {});
      } catch (err) {
        bus.emit('log', { level: 'error', msg: 'ประมวลผลแอคชั่นสำหรับ event ' + ev + ' ล้มเหลว: ' + err.message });
      }
    });
  }
  // เชื่อมต่อใหม่ = เริ่ม session ใหม่ → ล้างสถานะ milestone ของทุก action
  bus.on('connected', () => {
    likeState.clear();
    latestTotalLikes = 0;
  });
  // seed ยอดไลค์รวมจากข้อมูลห้อง — ให้ combo trigger เริ่มนับจากหลักปัจจุบัน (ไม่ยิงย้อนหลัง)
  bus.on('likeSeed', d => { latestTotalLikes = Number(d.total) || 0; });
}

// ทดสอบ action ด้วยข้อมูลตัวอย่าง (ปุ่ม "ทดสอบ" ใน Dashboard → IPC actions:test)
async function test(id) {
  const actions = settings.get().actions || [];
  const action = actions.find((a) => a && a.id === id);
  if (!action) throw new Error('ไม่พบแอคชั่นรหัส ' + id);
  const sample = {
    userId: '0',
    uniqueId: 'tester',
    nickname: 'ผู้ทดสอบ',
    profilePictureUrl: '',
    followRole: 1,
    isModerator: false,
    isSubscriber: false,
    simulated: true,
    comment: 'ข้อความทดสอบจากปุ่มทดสอบ',
    giftId: 5655,
    giftName: 'Rose',
    giftPictureUrl: '',
    diamondCount: 1,
    repeatCount: 3,
    streakable: true,
    repeatEnd: true,
    diamondTotal: 3,
    likeCount: 1000,
    totalLikeCount: 1000,
    totalLikes: 1000,
    prize: 'รางวัลทดสอบ'
  };
  bus.emit('action', { actionId: action.id, name: action.name, triggeredBy: 'test' });
  await run(action, sample);
  return { ok: true };
}

module.exports = { init, test, run };
