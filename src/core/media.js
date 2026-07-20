// คลังไฟล์สื่อของผู้ใช้ (รูปช่องรางวัล ฯลฯ) — copy เข้าโฟลเดอร์ของแอปแล้วเสิร์ฟผ่าน /media
// เหตุผล: widget เปิดผ่าน http://localhost จะโหลด file:// ตรงๆ ไม่ได้ (เบราว์เซอร์/OBS บล็อค)
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function mediaDir() {
  let base;
  try {
    const { app } = require('electron');
    base = app && app.getPath ? app.getPath('userData') : null;
  } catch (_) { base = null; }
  if (!base) base = path.join(__dirname, '..', '..', 'data');
  const dir = path.join(base, 'media');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// copy ไฟล์เข้าคลัง — ตั้งชื่อจาก hash เนื้อไฟล์ (ไฟล์เดิมซ้ำ = ได้ชื่อเดิม ไม่เปลืองที่)
// คืน URL แบบ relative '/media/<name>' ให้ widget ใช้ได้ทันที (origin เดียวกับ server)
function importFile(srcPath) {
  const buf = fs.readFileSync(srcPath);
  const hash = crypto.createHash('sha1').update(buf).digest('hex').slice(0, 16);
  const ext = (path.extname(srcPath) || '').toLowerCase();
  const name = hash + ext;
  const dest = path.join(mediaDir(), name);
  if (!fs.existsSync(dest)) fs.writeFileSync(dest, buf);
  return '/media/' + name;
}

module.exports = { mediaDir, importFile };
