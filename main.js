// Tikkies Tools — Electron main process
const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');

const bus = require('./src/core/eventBus');
const settings = require('./src/core/settings');
const stats = require('./src/core/stats');
const overlayServer = require('./src/core/overlayServer');
const tiktok = require('./src/core/tiktok');
const simulator = require('./src/core/simulator');
const actions = require('./src/core/actions');
const tts = require('./src/core/tts');
const ttsPlayer = require('./src/core/ttsPlayer');
const obs = require('./src/core/obs');
const giftCatalog = require('./src/core/giftCatalog');
const wheel = require('./src/core/wheel');
const hotkeys = require('./src/core/hotkeys');
const sessionLog = require('./src/core/sessionLog');

let win = null;

// อัปเดตอัตโนมัติ (เฉพาะตัวที่ build แล้ว) — ดึง release ใหม่จาก GitHub มาติดตั้งเอง
function setupAutoUpdate() {
  if (!app.isPackaged) return; // ตอน dev ไม่เช็คอัปเดต
  let autoUpdater;
  try { ({ autoUpdater } = require('electron-updater')); } catch (_) { return; }
  autoUpdater.autoDownload = true;
  autoUpdater.on('update-available', (info) => bus.emit('log', { level: 'info', msg: 'พบเวอร์ชันใหม่ ' + (info && info.version) + ' — กำลังดาวน์โหลด...' }));
  autoUpdater.on('update-downloaded', (info) => {
    bus.emit('log', { level: 'info', msg: 'ดาวน์โหลดเวอร์ชัน ' + (info && info.version) + ' แล้ว จะติดตั้งเมื่อปิดโปรแกรม' });
    if (win && !win.isDestroyed()) {
      dialog.showMessageBox(win, {
        type: 'info', buttons: ['รีสตาร์ทเลย', 'ไว้ทีหลัง'], defaultId: 0,
        title: 'มีอัปเดตใหม่', message: 'ดาวน์โหลดเวอร์ชัน ' + (info && info.version) + ' เสร็จแล้ว', detail: 'รีสตาร์ทโปรแกรมเพื่อติดตั้ง'
      }).then((r) => { if (r.response === 0) autoUpdater.quitAndInstall(); });
    }
  });
  autoUpdater.on('error', (err) => bus.emit('log', { level: 'warn', msg: 'เช็คอัปเดตไม่สำเร็จ: ' + (err && err.message || err) }));
  autoUpdater.checkForUpdates().catch(() => {});
}

// event ที่ส่งต่อให้หน้า Dashboard แบบ realtime
const FORWARD_EVENTS = [
  'chat', 'gift', 'like', 'follow', 'share', 'subscribe', 'member',
  'roomStats', 'connected', 'disconnected', 'streamEnd', 'connectionState',
  'alert', 'tts', 'goals', 'leaderboard', 'stats', 'timer', 'action',
  'sound', 'log', 'obsState', 'wheelSpin', 'wheelResult'
];

function createWindow() {
  win = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1000,
    minHeight: 640,
    title: 'Tikkies Tools',
    backgroundColor: '#121216',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // ให้ new Audio().play() เล่นได้โดยไม่ต้องคลิกก่อน (เสียง Action/Alert)
      autoplayPolicy: 'no-user-gesture-required'
    }
  });
  win.loadFile(path.join(__dirname, 'src', 'ui', 'index.html'));
  win.on('closed', () => { win = null; });

  // ดักจับปัญหาฝั่งหน้า Dashboard เพื่อช่วยดีบั๊ก (พิมพ์ออก terminal)
  win.webContents.on('did-fail-load', (_e, code, desc) => {
    console.error('[renderer] โหลดหน้าไม่สำเร็จ:', code, desc);
  });
  win.webContents.on('render-process-gone', (_e, details) => {
    console.error('[renderer] กระบวนการหน้าเว็บหยุด:', details.reason);
  });
  win.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    if (level >= 2) console.error('[renderer:console]', message, '(' + (sourceId || '') + ':' + line + ')');
  });
  if (process.env.TIKKIES_OPEN_DEVTOOLS) win.webContents.openDevTools({ mode: 'detach' });
}

function fullState() {
  return {
    ...overlayServer.snapshot(),
    settingsFull: settings.get(),
    serverPort: overlayServer.getPort(),
    obs: obs.getStatus(),
    version: app.getVersion()
  };
}

const handlers = {
  'state:get': () => fullState(),

  'tiktok:connect': async ({ username, waitForLive }) => {
    if (username) settings.set({ username });
    return tiktok.connect(username, { waitForLive });
  },
  'tiktok:disconnect': () => tiktok.disconnect(),

  'settings:get': () => settings.get(),
  'settings:set': ({ patch }) => settings.set(patch),

  'simulate': ({ type, overrides }) => simulator.fire(type, overrides || {}),

  'gifts:list': ({ q } = {}) => (q ? giftCatalog.search(q, 50) : giftCatalog.all()),

  'actions:test': ({ id }) => actions.test(id),

  // ส่งออก Actions ทั้งหมดเป็นไฟล์ JSON (ผู้ใช้เลือกที่บันทึกเอง)
  'actions:export': async () => {
    const list = settings.get().actions || [];
    const res = await dialog.showSaveDialog(win, {
      title: 'ส่งออก Actions',
      defaultPath: 'tikkies-actions.json',
      filters: [{ name: 'Tikkies Actions', extensions: ['json'] }]
    });
    if (res.canceled || !res.filePath) return { ok: false, canceled: true };
    const payload = {
      app: 'tikkies-tools', type: 'actions', version: 1,
      exportedAt: new Date().toISOString(), count: list.length, actions: list
    };
    fs.writeFileSync(res.filePath, JSON.stringify(payload, null, 2), 'utf8');
    return { ok: true, count: list.length, path: res.filePath };
  },

  // นำเข้า: เปิดไฟล์ JSON, ตรวจสอบ, คืน actions (ยังไม่บันทึก — ให้ฝั่ง UI เลือก เพิ่ม/แทนที่)
  'actions:import': async () => {
    const res = await dialog.showOpenDialog(win, {
      title: 'นำเข้า Actions',
      properties: ['openFile'],
      filters: [{ name: 'Tikkies Actions', extensions: ['json'] }]
    });
    if (res.canceled || !res.filePaths || !res.filePaths[0]) return { ok: false, canceled: true };
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(res.filePaths[0], 'utf8'));
    } catch (e) {
      throw new Error('ไฟล์นี้ไม่ใช่ JSON ที่ถูกต้อง');
    }
    const incoming = Array.isArray(parsed) ? parsed : (parsed && parsed.actions);
    if (!Array.isArray(incoming)) throw new Error('ไม่พบข้อมูล Actions ในไฟล์นี้');
    // รับเฉพาะ action ที่มีโครงถูกต้อง
    const valid = incoming.filter(a =>
      a && typeof a === 'object' && a.trigger && a.trigger.type && Array.isArray(a.responses));
    if (!valid.length) throw new Error('ไฟล์นี้ไม่มี Action ที่ใช้งานได้');
    return { ok: true, actions: valid, total: incoming.length };
  },

  'wheel:spin': () => wheel.spin('test'),

  // ประวัติไลฟ์ (session report)
  'sessions:list': () => sessionLog.list(),
  'sessions:delete': ({ id }) => sessionLog.remove(id),
  'sessions:exportCsv': async ({ kind }) => {
    const isGifters = kind === 'gifters';
    const res = await dialog.showSaveDialog(win, {
      title: isGifters ? 'ส่งออกผู้สนับสนุน (CSV)' : 'ส่งออกประวัติไลฟ์ (CSV)',
      defaultPath: isGifters ? 'tikkies-supporters.csv' : 'tikkies-sessions.csv',
      filters: [{ name: 'CSV', extensions: ['csv'] }]
    });
    if (res.canceled || !res.filePath) return { ok: false, canceled: true };
    fs.writeFileSync(res.filePath, isGifters ? sessionLog.giftersCsv() : sessionLog.sessionsCsv(), 'utf8');
    return { ok: true, path: res.filePath };
  },

  // อัพโหลดไฟล์สื่อเข้าคลังแอป (copy เข้า userData/media) → คืน URL /media/... ใช้ใน widget ได้เลย
  'media:import': async ({ filters }) => {
    const res = await dialog.showOpenDialog(win, {
      properties: ['openFile'],
      filters: filters || [{ name: 'รูป', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] }]
    });
    if (res.canceled || !res.filePaths[0]) return null;
    return require('./src/core/media').importFile(res.filePaths[0]);
  },

  'tts:test': ({ text }) => tts.speak(text || 'ทดสอบเสียงอ่านจาก Tikkies Tools'),

  'tts:voices': () => ttsPlayer.getVoices(),

  'timer:control': ({ cmd, payload }) => stats.timerControl(cmd, payload),

  'obs:connect': () => obs.connect(),
  'obs:disconnect': () => obs.disconnect(),
  'obs:status': () => obs.getStatus(),
  'obs:scenes': () => obs.getScenes(),

  'app:openExternal': ({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return true;
  },
  'app:pickFile': async ({ filters }) => {
    const res = await dialog.showOpenDialog(win, {
      properties: ['openFile'],
      filters: filters || [
        { name: 'สื่อ', extensions: ['mp3', 'wav', 'ogg', 'gif', 'png', 'jpg', 'jpeg', 'webp', 'webm', 'mp4'] }
      ]
    });
    return res.canceled ? null : res.filePaths[0];
  }
};

app.whenReady().then(async () => {
  settings.load();
  stats.init();
  actions.init();
  sessionLog.init();
  tts.init();
  ttsPlayer.init();
  obs.init();

  try {
    await overlayServer.start();
  } catch (err) {
    dialog.showErrorBox('Tikkies Tools',
      `เปิด Overlay server ไม่สำเร็จ (พอร์ต ${settings.get().serverPort}): ${err.message}\n` +
      'อาจมีโปรแกรมอื่น (เช่น TikFinity) ใช้พอร์ตนี้อยู่ — เปลี่ยนพอร์ตได้ในตั้งค่า');
  }

  ipcMain.handle('cmd', async (_event, { cmd, payload }) => {
    const handler = handlers[cmd];
    if (!handler) throw new Error('ไม่รู้จักคำสั่ง: ' + cmd);
    return handler(payload || {});
  });

  for (const ev of FORWARD_EVENTS) {
    bus.on(ev, data => {
      if (win && !win.isDestroyed()) win.webContents.send('bus-event', { event: ev, data });
    });
  }

  // หลุดจากไลฟ์โดยไม่ได้ตั้งใจ → แจ้งเตือนระบบ (เห็นแม้เล่นเกมเต็มจอ); เสียงดังเล่นที่ Dashboard
  bus.on('disconnected', (d) => {
    if (!d || !d.unexpected || !settings.get().disconnectAlarm) return;
    try {
      const { Notification } = require('electron');
      new Notification({ title: 'Tikkies Tools', body: '⚠️ หลุดจากไลฟ์! กำลังพยายามเชื่อมต่อใหม่...', urgency: 'critical' }).show();
    } catch (_) { /* ระบบไม่รองรับ notification — เสียงจาก Dashboard ยังทำงาน */ }
  });

  createWindow();
  setupAutoUpdate();
  hotkeys.init(); // globalShortcut ใช้ได้หลัง app ready เท่านั้น

  if (settings.get().autoConnect && settings.get().username) {
    tiktok.connect().catch(err =>
      bus.emit('log', { level: 'warn', msg: 'เชื่อมต่ออัตโนมัติไม่สำเร็จ: ' + err.message }));
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('will-quit', () => {
  hotkeys.dispose();
  sessionLog.finalize(); // ปิดยอด session ค้างก่อนออกจากแอป
});

app.on('window-all-closed', () => {
  // ปิดหน้าต่างแล้วปิดแอปเลย (รวมถึง macOS เพราะเซิร์ฟเวอร์/การเชื่อมต่อทำงานเบื้องหลัง)
  tiktok.disconnect().catch(() => {});
  overlayServer.stop().then(() => app.quit());
});
