// จำลองเหตุการณ์ TikTok LIVE สำหรับทดสอบ (ปุ่ม "ทดสอบ" ใน Dashboard / POST /api/simulate)
// payload ที่ปล่อยออกมาต้องมีรูปร่างเหมือนของจริงจาก tiktok.js ทุกประการ
const bus = require('./eventBus');
const giftCatalog = require('./giftCatalog');

const NAMES = [
  ['user_somchai', 'สมชายใจดี'], ['kaimook_z', 'ไข่มุก'], ['beam_gamer', 'บีมเกมเมอร์'],
  ['nong_fern', 'น้องเฟิร์น'], ['tle_555', 'เต๋อห้าห้าห้า'], ['praewa.p', 'แพรวา'],
  ['golf_zaa', 'กอล์ฟซ่า'], ['mint_chan', 'มิ้นท์จัง']
];

const GIFTS = [
  { giftId: 5655, giftName: 'Rose', diamondCount: 1, streakable: true,
    giftPictureUrl: 'https://p16-webcast.tiktokcdn.com/img/maliva/webcast-va/eba3a9bb85c33e017f3648eaf88d7189~tplv-obj.png' },
  { giftId: 5827, giftName: 'Finger Heart', diamondCount: 5, streakable: true,
    giftPictureUrl: 'https://p16-webcast.tiktokcdn.com/img/maliva/webcast-va/a4c4dc437fd3a6632aba149769491f49.png~tplv-obj.png' },
  { giftId: 6064, giftName: 'GG', diamondCount: 1, streakable: true, giftPictureUrl: '' },
  { giftId: 5269, giftName: 'Doughnut', diamondCount: 30, streakable: false, giftPictureUrl: '' },
  { giftId: 7934, giftName: 'Galaxy', diamondCount: 1000, streakable: false, giftPictureUrl: '' },
  { giftId: 8916, giftName: 'Universe', diamondCount: 34999, streakable: false, giftPictureUrl: '' }
];

const COMMENTS = [
  'สวัสดีครับบบ 🔥', 'ไลฟ์สนุกมากก', 'มาจากหน้าฟีดด', 'ขอเพลงหน่อยครับ',
  '!point', 'เก่งมากกก 👍', 'สู้ๆนะคะ', 'ตามมาจาก TikTok เลย'
];

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function rand(n) { return Math.floor(Math.random() * n); }

// เลือกของขวัญ: ระบุชื่อ → หาในแคตตาล็อกจริงก่อน แล้วค่อย fallback; สุ่ม → 70% เป็นของถูก (สมจริง)
function pickGift(giftName) {
  if (giftName) {
    const found = giftCatalog.findByName(giftName);
    if (found) return catalogToGift(found);
    return GIFTS.find(g => g.giftName.toLowerCase() === String(giftName).toLowerCase()) || pick(GIFTS);
  }
  const all = giftCatalog.all();
  if (!all.length) return pick(GIFTS);
  const cheap = all.filter(g => g.coins <= 99);
  const pool = (Math.random() < 0.7 && cheap.length) ? cheap : all;
  return catalogToGift(pick(pool));
}

function catalogToGift(item) {
  return {
    giftId: item.id,
    giftName: item.name,
    giftPictureUrl: item.image,
    diamondCount: item.coins,
    streakable: item.coins === 1 // ของ 1 เพชรส่วนใหญ่กดรัวได้
  };
}

let simTotalLikes = 0;

function baseUser(overrides = {}) {
  const [uniqueId, nickname] = pick(NAMES);
  return {
    userId: String(100000 + rand(900000)),
    uniqueId,
    nickname,
    profilePictureUrl: '',
    followRole: rand(2), // 0=ไม่ติดตาม 1=ติดตาม 2=เพื่อน
    isModerator: false,
    isSubscriber: Math.random() < 0.15,
    ...overrides
  };
}

// สร้าง event จำลองแล้วปล่อยเข้า bus — คืน payload ที่ปล่อยไป
function fire(type, overrides = {}) {
  let data;
  switch (type) {
    case 'chat':
      data = { ...baseUser(), comment: overrides.comment || pick(COMMENTS), simulated: true, ...overrides };
      break;
    case 'gift': {
      const gift = pickGift(overrides.giftName);
      const repeatCount = overrides.repeatCount || (gift.streakable ? 1 + rand(5) : 1);
      data = {
        ...baseUser(), ...gift, repeatCount,
        repeatEnd: true,
        diamondTotal: gift.diamondCount * repeatCount,
        simulated: true, ...overrides
      };
      break;
    }
    case 'like': {
      const likeCount = overrides.likeCount || (5 + rand(26)); // 5–30 ต่อ batch (สมจริงขึ้น เห็นยอดขยับชัด)
      simTotalLikes += likeCount;
      data = { ...baseUser(), likeCount, totalLikeCount: simTotalLikes, simulated: true, ...overrides };
      break;
    }
    case 'follow':
    case 'share':
    case 'member':
      data = { ...baseUser(), simulated: true, ...overrides };
      break;
    case 'subscribe':
      data = { ...baseUser({ isSubscriber: true }), subMonth: 1, simulated: true, ...overrides };
      break;
    case 'roomStats':
      data = { viewerCount: overrides.viewerCount || (50 + rand(500)), simulated: true };
      break;
    default:
      throw new Error('ไม่รู้จักประเภท event จำลอง: ' + type);
  }
  bus.emit(type, data);
  return data;
}

module.exports = { fire, GIFTS };
