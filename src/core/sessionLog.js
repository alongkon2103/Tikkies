// บันทึกสถิติแต่ละ session ไลฟ์ลงไฟล์ sessions.json — ดูย้อนหลังในแท็บ "ประวัติไลฟ์" + export CSV
// เริ่มบันทึกเมื่อ 'connected', flush ทุก 60 วิ (กันแอปเด้งข้อมูลหาย), ปิดยอดเมื่อ 'disconnected'
const fs = require('fs');
const path = require('path');
const bus = require('./eventBus');

const MAX_SESSIONS = 200; // เก็บล่าสุดไม่เกินนี้ (กันไฟล์บวม)

let filePath = null;
let sessions = null;  // array ใหม่สุดอยู่หน้า
let cur = null;       // session ที่กำลังไลฟ์อยู่
let flushTimer = null;

function resolveFile() {
  if (filePath) return filePath;
  let base;
  try {
    const { app } = require('electron');
    base = app && app.getPath ? app.getPath('userData') : null;
  } catch (_) { base = null; }
  if (!base) base = path.join(__dirname, '..', '..', 'data');
  fs.mkdirSync(base, { recursive: true });
  filePath = path.join(base, 'sessions.json');
  return filePath;
}

function loadAll() {
  if (sessions) return sessions;
  try {
    sessions = JSON.parse(fs.readFileSync(resolveFile(), 'utf8'));
    if (!Array.isArray(sessions)) sessions = [];
  } catch (_) { sessions = []; }
  return sessions;
}

function save() {
  try {
    fs.writeFileSync(resolveFile(), JSON.stringify(loadAll(), null, 1), 'utf8');
  } catch (err) {
    bus.emit('log', { level: 'warn', msg: 'บันทึกประวัติไลฟ์ไม่สำเร็จ: ' + err.message });
  }
}

// อัปเดตข้อมูล session ปัจจุบันจาก stats จริง แล้ว upsert ลงลิสต์
function snapshotCurrent() {
  if (!cur) return;
  const stats = require('./stats');
  const st = stats.getStats();
  const lb = stats.getLeaderboard(20);
  cur.endedAt = Date.now();
  cur.durationSec = Math.round((cur.endedAt - cur.startedAt) / 1000);
  cur.totalDiamonds = st.totalDiamonds;
  cur.sessionLikes = st.sessionLikes;
  cur.totalLikes = st.totalLikes;
  cur.follows = st.follows;
  cur.shares = st.shares;
  cur.totalChats = st.totalChats;
  cur.joins = st.joins;
  cur.subscribes = st.subscribes;
  cur.giftCount = st.giftCount;
  cur.topGifters = (lb.top || []).map(g => ({
    uniqueId: g.uniqueId, nickname: g.nickname, diamonds: g.diamonds, gifts: g.gifts
  }));
  const all = loadAll();
  const idx = all.findIndex(s => s && s.id === cur.id);
  if (idx >= 0) all[idx] = cur; else all.unshift(cur);
  while (all.length > MAX_SESSIONS) all.pop();
  save();
}

function finalize() {
  if (!cur) return;
  clearInterval(flushTimer);
  flushTimer = null;
  snapshotCurrent();
  // session สั้นมากและไม่มีอะไรเกิดขึ้น → ไม่เก็บ (กันขยะจากการลองเชื่อม)
  if (cur.durationSec < 30 && !cur.totalDiamonds && !cur.totalChats && !cur.follows) {
    const all = loadAll();
    const idx = all.findIndex(s => s && s.id === cur.id);
    if (idx >= 0) { all.splice(idx, 1); save(); }
  } else {
    bus.emit('log', { level: 'info', msg: `บันทึกประวัติไลฟ์แล้ว (${Math.round(cur.durationSec / 60)} นาที, ${cur.totalDiamonds} เพชร)` });
  }
  cur = null;
}

function init() {
  loadAll();
  bus.on('connected', d => {
    finalize(); // เผื่อ session เก่ายังไม่ปิด (reconnect)
    cur = {
      id: 's_' + Date.now().toString(36),
      username: (d && d.username) || '',
      startedAt: Date.now(),
      peakViewers: 0
    };
    clearInterval(flushTimer);
    flushTimer = setInterval(snapshotCurrent, 60000);
  });
  bus.on('roomStats', d => {
    if (cur && d && Number(d.viewerCount) > cur.peakViewers) cur.peakViewers = Number(d.viewerCount);
  });
  bus.on('disconnected', () => finalize());
  bus.on('streamEnd', () => finalize());
}

function list() { return loadAll().slice(); }

function remove(id) {
  const all = loadAll();
  const idx = all.findIndex(s => s && s.id === id);
  if (idx >= 0) { all.splice(idx, 1); save(); }
  return { ok: true };
}

// ---------- CSV (มี BOM ให้ Excel อ่านไทยถูก) ----------
function csvCell(v) {
  const s = String(v == null ? '' : v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function toCsv(rows) {
  return '﻿' + rows.map(r => r.map(csvCell).join(',')).join('\n');
}

// CSV สรุปทุก session
function sessionsCsv() {
  const rows = [['วันที่', 'เวลาเริ่ม', 'ช่อง', 'นาที', 'เพชร', 'ไลค์ (session)', 'ผู้ติดตามใหม่', 'แชร์', 'แชท', 'คนเข้าห้อง', 'สมาชิกใหม่', 'ของขวัญ (ชิ้น)', 'ผู้ชมสูงสุด', 'ท็อปผู้ให้']];
  for (const s of loadAll()) {
    const d = new Date(s.startedAt);
    rows.push([
      d.toLocaleDateString('th-TH'), d.toLocaleTimeString('th-TH'),
      '@' + (s.username || ''), Math.round((s.durationSec || 0) / 60),
      s.totalDiamonds || 0, s.sessionLikes || 0, s.follows || 0, s.shares || 0,
      s.totalChats || 0, s.joins || 0, s.subscribes || 0, s.giftCount || 0, s.peakViewers || 0,
      (s.topGifters || []).slice(0, 3).map(g => g.nickname + ' (' + g.diamonds + ')').join(' | ')
    ]);
  }
  return toCsv(rows);
}

// CSV ผู้ให้ของขวัญรวมทุก session — ไว้ดูว่าใครสนับสนุนประจำ (VIP)
function giftersCsv() {
  const agg = new Map(); // uniqueId -> {nickname, diamonds, gifts, sessions}
  for (const s of loadAll()) {
    for (const g of s.topGifters || []) {
      const a = agg.get(g.uniqueId) || { nickname: g.nickname, diamonds: 0, gifts: 0, sessions: 0 };
      a.diamonds += g.diamonds || 0;
      a.gifts += g.gifts || 0;
      a.sessions += 1;
      a.nickname = g.nickname || a.nickname;
      agg.set(g.uniqueId, a);
    }
  }
  const rows = [['@username', 'ชื่อ', 'เพชรรวมทุกไลฟ์', 'ของขวัญ (ชิ้น)', 'มากี่ไลฟ์']];
  [...agg.entries()]
    .sort((a, b) => b[1].diamonds - a[1].diamonds)
    .forEach(([id, a]) => rows.push(['@' + id, a.nickname, a.diamonds, a.gifts, a.sessions]));
  return toCsv(rows);
}

module.exports = { init, finalize, list, remove, sessionsCsv, giftersCsv };
