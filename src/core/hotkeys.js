// คีย์ลัด global (ทำงานแม้แอปไม่โฟกัส) — มาจาก Actions ที่ตั้ง trigger เป็น "คีย์ลัด"
// action.trigger = { type: 'hotkey', accelerator: 'F6' | 'Control+Shift+A' | ... }
// กดคีย์ → รัน responses ของ action นั้นทันที (ข้อมูลตัวอย่างเหมือนปุ่มทดสอบ แต่ไม่มีดีเลย์)
// ใช้ Electron globalShortcut — ต้อง init หลัง app ready เท่านั้น
const bus = require('./eventBus');
const settings = require('./settings');

let globalShortcut = null;
let registered = []; // accelerator ที่ลงทะเบียนไว้รอบล่าสุด (ไว้ unregister ก่อน apply ใหม่)

function runAction(action) {
  try {
    require('./actions').test(action.id);
  } catch (err) {
    bus.emit('log', { level: 'error', msg: `คีย์ลัด ${action.trigger.accelerator} ทำงานไม่สำเร็จ: ` + (err && err.message || err) });
  }
}

// ลงทะเบียนจาก actions ปัจจุบัน — เรียกซ้ำได้ (ล้างของเก่าก่อนเสมอ)
function apply() {
  if (!globalShortcut) return;
  for (const acc of registered) { try { globalShortcut.unregister(acc); } catch (_) {} }
  registered = [];

  const list = (settings.get().actions || []).filter(a =>
    a && a.enabled !== false && a.trigger && a.trigger.type === 'hotkey' && a.trigger.accelerator);
  for (const action of list) {
    const acc = action.trigger.accelerator;
    if (registered.includes(acc)) {
      bus.emit('log', { level: 'warn', msg: `คีย์ ${acc} ถูกใช้กับหลาย Action — ตัวแรกเท่านั้นที่ทำงาน` });
      continue;
    }
    try {
      const ok = globalShortcut.register(acc, () => runAction(action));
      if (ok) {
        registered.push(acc);
      } else {
        // มักเป็นเพราะโปรแกรมอื่น/ระบบจองคีย์นี้ไว้แล้ว
        bus.emit('log', { level: 'warn', msg: `ลงทะเบียนคีย์ลัด ${acc} ไม่สำเร็จ — คีย์นี้อาจถูกโปรแกรมอื่นใช้อยู่` });
      }
    } catch (err) {
      bus.emit('log', { level: 'warn', msg: `คีย์ลัด ${acc} ไม่ถูกต้อง: ` + (err && err.message || err) });
    }
  }
}

function init() {
  try {
    ({ globalShortcut } = require('electron'));
  } catch (_) { return; } // รันแบบ standalone (ไม่มี Electron) — ข้าม
  apply();
  bus.on('settings:changed', () => apply());
}

function dispose() {
  if (globalShortcut) { try { globalShortcut.unregisterAll(); } catch (_) {} }
  registered = [];
}

module.exports = { init, apply, dispose };
