// เว็บเซิร์ฟเวอร์สำหรับ Overlay/Widget (ใช้เป็น Browser Source ใน OBS)
// - เสิร์ฟไฟล์ widget ที่ /widgets/*
// - WebSocket ที่ ws://localhost:PORT ส่งทุก event เป็น {event, data}
//   (พอร์ตเริ่มต้น 21213 — โปรโตคอลเดียวกับที่เครื่องมือฝั่ง TikFinity นิยมใช้)
// - REST: GET /api/state, POST /api/simulate
const http = require('http');
const path = require('path');
const express = require('express');
const { WebSocketServer, WebSocket } = require('ws');
const bus = require('./eventBus');
const settings = require('./settings');
const stats = require('./stats');
const simulator = require('./simulator');
const tiktok = require('./tiktok');
const giftCatalog = require('./giftCatalog');

// event ทั้งหมดที่ broadcast ให้ widget
const BROADCAST_EVENTS = [
  'chat', 'gift', 'like', 'follow', 'share', 'subscribe', 'member',
  'roomStats', 'connected', 'disconnected', 'streamEnd', 'connectionState',
  'alert', 'tts', 'goals', 'leaderboard', 'stats', 'timer', 'action'
];

let server = null;
let wss = null;
let currentPort = null;

function broadcast(event, data) {
  if (!wss) return;
  const msg = JSON.stringify({ event, data });
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) client.send(msg);
  }
}

function snapshot() {
  return {
    connection: tiktok.getState(),
    stats: stats.getStats(),
    goals: stats.getGoals(),
    leaderboard: stats.getLeaderboard(),
    timer: stats.getTimer(),
    settings: settings.publicSettings()
  };
}

// โพรบว่าพอร์ต p ว่างไหมด้วย net server ชั่วคราว → คืน true/false
function probePort(p) {
  return new Promise(resolve => {
    const tester = http.createServer();
    tester.once('error', () => resolve(false));
    tester.listen(p, () => tester.close(() => resolve(true)));
  });
}

// หาพอร์ตว่างตัวแรกตั้งแต่ startPort ไล่ขึ้นไปสูงสุด maxTries พอร์ต
async function findFreePort(startPort, maxTries) {
  for (let i = 0; i < maxTries; i++) {
    const p = startPort + i;
    if (await probePort(p)) return p;
    bus.emit('log', { level: 'warn', msg: `พอร์ต ${p} ไม่ว่าง ลองพอร์ต ${p + 1}` });
  }
  throw new Error(`หาพอร์ตว่างไม่ได้ในช่วง ${startPort}–${startPort + maxTries - 1}`);
}

async function start(port) {
  const preferred = port || settings.get().serverPort || 21213;
  if (server && currentPort === preferred) return currentPort;
  await stop();
  const p = await findFreePort(preferred, 15);
  return new Promise((resolve, reject) => {
    const app = express();
    app.use(express.json());

    app.use('/widgets', express.static(path.join(__dirname, '..', 'widgets')));
    app.use('/assets', express.static(path.join(__dirname, '..', '..', 'assets')));

    app.get('/api/state', (_req, res) => res.json(snapshot()));

    // แคตตาล็อกของขวัญทั้งหมด (?q= เพื่อค้นหา)
    app.get('/api/gifts', (req, res) => {
      res.json(req.query.q ? giftCatalog.search(req.query.q, 50) : giftCatalog.all());
    });

    app.post('/api/simulate', (req, res) => {
      try {
        const { type, ...overrides } = req.body || {};
        res.json({ ok: true, data: simulator.fire(type || 'chat', overrides) });
      } catch (err) {
        res.status(400).json({ ok: false, error: err.message });
      }
    });

    app.get('/', (_req, res) => {
      res.type('html').send(
        '<meta charset="utf-8"><title>Tikkies Tools</title>' +
        '<body style="font-family:sans-serif;background:#111;color:#eee;padding:2rem">' +
        '<h2>🎁 Tikkies Tools — Overlay Server</h2>' +
        '<p>เพิ่ม Browser Source ใน OBS ด้วยลิงก์เหล่านี้:</p><ul>' +
        ['alerts', 'chat', 'goal', 'leaderboard', 'timer', 'tts']
          .map(w => `<li><a style="color:#7cf" href="/widgets/${w}.html">/widgets/${w}.html</a></li>`).join('') +
        '</ul></body>');
    });

    server = http.createServer(app);
    wss = new WebSocketServer({ server });

    wss.on('connection', ws => {
      // ส่งสถานะปัจจุบันให้ widget ที่เพิ่งเชื่อมต่อ
      const snap = snapshot();
      ws.send(JSON.stringify({ event: 'snapshot', data: snap }));
      ws.on('error', () => {});
      ws.on('message', raw => {
        // widget ส่งคำสั่งกลับได้ เช่น {cmd:'simulate', type:'gift'}
        try {
          const msg = JSON.parse(raw.toString());
          if (msg.cmd === 'simulate') simulator.fire(msg.type || 'chat', msg.overrides || {});
        } catch (_) { /* ข้อความไม่ใช่ JSON — เพิกเฉย */ }
      });
    });

    // error ก่อนเปิดสำเร็จ → reject; error หลังเปิดแล้ว → แค่ log ไม่ให้ล้มทั้งแอป
    let opened = false;
    const onEarlyError = err => {
      if (opened) return;
      bus.emit('log', { level: 'error', msg: 'Overlay server error: ' + err.message });
      server = null; wss = null;
      reject(err);
    };
    server.once('error', onEarlyError);

    server.listen(p, () => {
      opened = true;
      server.removeListener('error', onEarlyError);
      server.on('error', e => bus.emit('log', { level: 'error', msg: 'Overlay server error: ' + e.message }));
      currentPort = p;
      // ไม่บันทึกพอร์ต fallback ลง settings (กันพอร์ตดริฟต์) — Dashboard อ่านพอร์ตจริงจาก getPort()
      if (p !== preferred) {
        bus.emit('log', { level: 'warn', msg: `พอร์ตที่ตั้งไว้ (${preferred}) ไม่ว่าง ใช้พอร์ต ${p} แทนชั่วคราว` });
      }
      bus.emit('log', { level: 'info', msg: `Overlay server พร้อมใช้งานที่ http://localhost:${p}` });
      resolve(p);
    });
  });
}

function stop() {
  return new Promise(resolve => {
    if (!server) return resolve();
    try { wss && wss.clients.forEach(c => c.terminate()); } catch (_) {}
    server.close(() => {
      server = null; wss = null; currentPort = null;
      resolve();
    });
  });
}

function getPort() { return currentPort; }

// ต่อ bus → broadcast ครั้งเดียวพอ (module-level)
for (const ev of BROADCAST_EVENTS) {
  bus.on(ev, data => broadcast(ev, data));
}

module.exports = { start, stop, broadcast, getPort, snapshot };
