// แคตตาล็อกของขวัญ TikTok จาก data/tiktok_gifts.json — [{id, name, image, coins}]
// ใช้ enrich event ของขวัญ (เติมชื่อ/รูป/ราคาเพชรเมื่อ event สดไม่มีข้อมูลมา)
// และให้ Dashboard ใช้ทำ dropdown เลือกของขวัญในการตั้ง Actions
const fs = require('fs');
const path = require('path');
const bus = require('./eventBus');

const FILE = path.join(__dirname, '..', '..', 'data', 'tiktok_gifts.json');

let catalog = [];
const byId = new Map();
const byName = new Map(); // ชื่อ lowercase → รายการแรกที่เจอ (ชื่อซ้ำข้าม id มีได้)

function load() {
  catalog = [];
  byId.clear();
  byName.clear();
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    for (const g of raw) {
      if (!g || g.id == null || !g.name) continue;
      const item = {
        id: Number(g.id),
        name: String(g.name).trim(),
        image: g.image || '',
        coins: Number(g.coins) || 0
      };
      catalog.push(item);
      byId.set(item.id, item);
      const key = item.name.toLowerCase();
      if (!byName.has(key)) byName.set(key, item);
    }
    catalog.sort((a, b) => a.coins - b.coins || a.name.localeCompare(b.name));
    bus.emit('log', { level: 'info', msg: `โหลดแคตตาล็อกของขวัญ ${catalog.length} รายการ` });
  } catch (err) {
    bus.emit('log', { level: 'warn', msg: 'โหลด data/tiktok_gifts.json ไม่สำเร็จ: ' + err.message });
  }
  return catalog;
}

function all() {
  if (!catalog.length) load();
  return catalog;
}

function findById(id) {
  if (!catalog.length) load();
  return byId.get(Number(id)) || null;
}

function findByName(name) {
  if (!catalog.length) load();
  return byName.get(String(name || '').trim().toLowerCase()) || null;
}

function search(q, limit = 20) {
  const needle = String(q || '').trim().toLowerCase();
  if (!needle) return all().slice(0, limit);
  return all().filter(g => g.name.toLowerCase().includes(needle)).slice(0, limit);
}

// เติมข้อมูลที่ขาดให้ gift event ที่ normalize แล้ว (แก้ object เดิมและคืนกลับ)
function enrich(g) {
  const info = findById(g.giftId) || findByName(g.giftName);
  if (!info) return g;
  if (!g.giftName || /^Gift #/.test(g.giftName)) g.giftName = info.name;
  if (!g.giftPictureUrl) g.giftPictureUrl = info.image;
  if (!g.diamondCount) {
    g.diamondCount = info.coins;
    g.diamondTotal = info.coins * (g.repeatCount || 1);
  }
  return g;
}

module.exports = { load, all, findById, findByName, search, enrich };
