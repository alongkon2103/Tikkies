// รัน Overlay server เดี่ยวๆ โดยไม่ต้องเปิด Electron (สำหรับทดสอบ widget ในเบราว์เซอร์)
//   node server-standalone.js [port]
// แล้วเปิด http://localhost:21213 พร้อมยิง event จำลองอัตโนมัติทุก 3 วินาที (--demo)
const settings = require('./src/core/settings');
const stats = require('./src/core/stats');
const overlayServer = require('./src/core/overlayServer');
const simulator = require('./src/core/simulator');
const actions = require('./src/core/actions');
const tts = require('./src/core/tts');

const port = Number(process.argv[2]) || settings.get().serverPort;
const demo = process.argv.includes('--demo');

settings.load();
stats.init();
actions.init();
tts.init();

overlayServer.start(port).then(p => {
  console.log(`✅ Tikkies overlay server: http://localhost:${p}`);
  console.log('   ทดสอบ: curl -X POST -H "Content-Type: application/json" -d \'{"type":"gift"}\' ' +
    `http://localhost:${p}/api/simulate`);
  if (demo) {
    const types = ['chat', 'chat', 'like', 'gift', 'chat', 'follow', 'share', 'member', 'roomStats'];
    let i = 0;
    setInterval(() => simulator.fire(types[i++ % types.length]), 3000);
    console.log('   โหมดเดโม่: ยิง event จำลองทุก 3 วินาที');
  }
}).catch(err => {
  console.error('เปิดเซิร์ฟเวอร์ไม่สำเร็จ:', err.message);
  process.exit(1);
});
