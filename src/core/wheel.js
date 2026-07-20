// กงล้อเสี่ยงโชค — main เป็นคนสุ่มผู้ชนะ (weighted) แล้ว broadcast ให้ทุก overlay เห็นผลเดียวกัน
// event: 'wheelSpin' { spinId, winnerIndex, label, durationSec, segments } → widget หมุนไปหยุดที่ผล
//        'wheelResult' { label } — หลังหมุนจบ (ใช้ต่อยอด TTS/log)
const bus = require('./eventBus');
const settings = require('./settings');

let spinning = false; // กันสั่งหมุนซ้อนระหว่างที่ยังหมุนอยู่

// เลือก index แบบถ่วงน้ำหนัก — weight <= 0 ถือว่า 1
function pickWeighted(segments) {
  const weights = segments.map(s => Math.max(0.0001, Number(s.weight) || 1));
  const total = weights.reduce((a, b) => a + b, 0);
  let roll = Math.random() * total;
  for (let i = 0; i < weights.length; i++) {
    roll -= weights[i];
    if (roll <= 0) return i;
  }
  return weights.length - 1;
}

// สั่งหมุน — source ไว้บอกที่มา (action/hotkey/test) สำหรับ log
function spin(source) {
  const conf = settings.get().wheel || {};
  const segments = Array.isArray(conf.segments)
    ? conf.segments.filter(s => s && String(s.label || '').trim())
    : [];
  if (segments.length < 2) throw new Error('ต้องมีรางวัลอย่างน้อย 2 ช่อง — ตั้งค่าได้ในแท็บ "สุ่มรางวัล"');
  if (spinning) return { ok: false, busy: true }; // หมุนอยู่ — เมิน ไม่ถือเป็น error

  spinning = true;
  const winnerIndex = pickWeighted(segments);
  const label = segments[winnerIndex].label;
  const durationSec = Math.min(30, Math.max(2, Number(conf.durationSec) || 8));
  const payload = {
    spinId: 's_' + Date.now().toString(36),
    winnerIndex,
    label,
    durationSec,
    resultHoldSec: Math.max(2, Number(conf.resultHoldSec) || 6),
    title: conf.title || 'กงล้อเสี่ยงโชค',
    segments: segments.map(s => ({ label: s.label, color: s.color || '', image: s.image || '' }))
  };
  bus.emit('wheelSpin', payload);
  bus.emit('log', { level: 'info', msg: `กำลังสุ่มรางวัล (${source || '?'}) ...` });

  setTimeout(() => {
    spinning = false;
    // prize = ชื่อรางวัลที่ได้ — ใช้ match trigger 'wheelResult' ใน actions + template {prize}
    bus.emit('wheelResult', { label, prize: label, image: segments[winnerIndex].image || '' });
    bus.emit('log', { level: 'info', msg: `สุ่มได้: ${label}` });
    if (conf.announceTts) {
      try { require('./tts').speak('สุ่มได้ ' + label); } catch (_) { /* TTS ปิดอยู่ */ }
    }
  }, durationSec * 1000);

  return { ok: true, label, winnerIndex };
}

module.exports = { spin };
