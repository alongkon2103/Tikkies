// ตัวเชื่อม TikTok LIVE — ห่อ tiktok-live-connector v2 (ESM) แล้ว normalize ทุก event
// ให้เป็นรูปแบบกลางของ Tikkies ก่อนปล่อยเข้า eventBus
//
// ความทน (เฟส 1):
//  - auto-retry เมื่อ sign server/เน็ตล้มชั่วคราว (backoff 1.5→3→6s สูงสุด 3 ครั้ง)
//  - รอจนไลฟ์ (waitForLive): poll ทุก 30s จนสตรีมเมอร์เปิดไลฟ์แล้วเชื่อมอัตโนมัติ
//  - สถานะละเอียด: disconnected | connecting | waiting | retrying | connected (+ attempt, nextRetryMs, errorKind)
const fs = require('fs');
const path = require('path');
const bus = require('./eventBus');
const settings = require('./settings');
const giftCatalog = require('./giftCatalog');

// ---------- DEBUG: บันทึก raw event ตัวจริงตัวแรกของแต่ละชนิดลงไฟล์ ----------
// เพื่อดูโครงสร้างข้อมูลจริงจาก TikTok (แก้ปัญหา field ที่ normalize ไม่เจอ)
// เขียนที่ data/debug-events.json — รีเซ็ตทุกครั้งที่เชื่อมใหม่
let debugCaptured = {};
function debugCapture(type, raw) {
  if (!process.env.TIKKIES_DEBUG) return; // ปิดใน production — เปิดด้วย TIKKIES_DEBUG=1 ตอนดีบั๊ก
  if (debugCaptured[type]) return;
  debugCaptured[type] = true;
  try {
    const dir = path.join(__dirname, '..', '..', 'data');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'debug-events.json');
    let all = {};
    try { all = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) {}
    all[type] = JSON.parse(JSON.stringify(raw, (k, v) => (typeof v === 'bigint' ? v.toString() : v)));
    fs.writeFileSync(file, JSON.stringify(all, null, 2), 'utf8');
    bus.emit('log', { level: 'info', msg: `[debug] บันทึกโครงสร้าง ${type} จริง → data/debug-events.json` });
  } catch (_) { /* เพิกเฉย */ }
}

// ดึงข้อความแชทแบบทน — เผื่อ field ต่างจาก d.comment
function pickComment(d) {
  return String(firstOf(
    d.comment, d.content, d.text, d.chatText,
    d.chatMessage && d.chatMessage.comment,
    d.data && d.data.comment,
    ''
  ) || '').trim();
}

let libPromise = null;
function loadLib() {
  // v2 เป็น ESM-only ต้องใช้ dynamic import (รันบน Node 20+ ใน Electron)
  if (!libPromise) libPromise = import('tiktok-live-connector');
  return libPromise;
}

const RETRY_BACKOFF = [3000, 8000]; // ms — retry แค่เคสที่ไม่กินโควต้า sign (network/roomid)

const state = {
  status: 'disconnected', // disconnected | connecting | waiting | retrying | connected
  username: '',
  roomId: null,
  error: null,
  errorKind: null,       // offline | notfound | sign | network | other
  attempt: 0,            // ครั้งที่กำลัง retry (0 = ครั้งแรก)
  nextRetryMs: 0,        // เวลาที่จะรอก่อน retry (ms) — ให้ UI นับถอยหลัง
  connectedAt: null
};

let conn = null;
let wantConnected = false;
let attemptAbort = null;   // ยกเลิกการรอ/หน่วงระหว่างพยายามเชื่อม
let reconnectTimer = null;
let reconnectAttempts = 0;

function emitState() { bus.emit('connectionState', { ...state }); }
function setStatus(s, patch) {
  state.status = s;
  if (patch) Object.assign(state, patch);
  emitState();
}

function firstOf(...vals) {
  for (const v of vals) if (v !== undefined && v !== null && v !== '') return v;
  return undefined;
}

// ---------- Normalize ----------
function normUser(u = {}) {
  const pic = firstOf(
    u.profilePictureUrl,
    u.profilePicture && (u.profilePicture.url && u.profilePicture.url[0]),
    u.profilePicture && (u.profilePicture.urls && u.profilePicture.urls[0]),
    u.avatarThumb && (u.avatarThumb.urlList && u.avatarThumb.urlList[0]),
    ''
  );
  return {
    userId: String(firstOf(u.userId, u.id, '')),
    uniqueId: firstOf(u.uniqueId, u.displayId, 'unknown'),
    nickname: firstOf(u.nickname, u.nickName, u.uniqueId, 'ไม่ทราบชื่อ'),
    profilePictureUrl: pic || '',
    followRole: Number(firstOf(u.followInfo && u.followInfo.followStatus, u.followRole, 0)) || 0,
    isModerator: !!firstOf(u.isModerator, false),
    isSubscriber: !!firstOf(u.isSubscriber, false)
  };
}

// ดึง URL รูปจาก Image ของ v2 (proto: url:string[]) หรือของ gift-list API (image.url_list)
function imgUrl(img) {
  if (!img) return '';
  if (Array.isArray(img.url) && img.url[0]) return img.url[0];
  if (Array.isArray(img.urlList) && img.urlList[0]) return img.urlList[0];
  if (Array.isArray(img.url_list) && img.url_list[0]) return img.url_list[0];
  if (typeof img.url === 'string' && img.url) return img.url;
  return '';
}

function normGift(data = {}) {
  const gd = data.giftDetails || {};      // proto Gift struct (อาจว่างสำหรับบาง gift)
  const ext = data.extendedGiftInfo || {}; // จาก enableExtendedGiftInfo (ครบทุกชนิด)
  const giftType = Number(firstOf(gd.giftType, ext.type, data.giftType)) || 0;
  const streakable = giftType === 1;
  const repeatCount = Number(data.repeatCount || 1) || 1;
  // ใช้ || เพื่อข้ามค่า 0 (giftDetails ว่างจะได้ตกไป extendedGiftInfo)
  const diamondCount = Number(gd.diamondCount) || Number(ext.diamond_count) || Number(ext.diamondCount) || 0;
  const giftId = firstOf(data.giftId, gd.id, ext.id, 0);
  return giftCatalog.enrich({
    ...normUser(data.user || data),
    giftId,
    giftName: firstOf(gd.giftName, ext.name, 'Gift #' + firstOf(giftId, '?')),
    giftPictureUrl: firstOf(imgUrl(gd.giftImage), imgUrl(ext.image), imgUrl(ext.icon), ''),
    diamondCount,
    repeatCount,
    streakable,
    // ของขวัญแบบ streak จะยิง event ซ้ำระหว่างกด — นับยอดจริงเฉพาะตอน repeatEnd (v2 เป็น 0/1)
    repeatEnd: streakable ? !!Number(data.repeatEnd) : true,
    diamondTotal: diamondCount * repeatCount
  });
}

// ---------- สร้าง connection + ผูก handler ----------
function buildConn(username, TikTokLiveConnection, WebcastEvent, ControlEvent) {
  const options = {
    // ปิด: การดึงรายการของขวัญเพิ่ม request ตอนเชื่อม = กินโควต้า EulerStream เร็วขึ้น
    //       (ทำให้เชื่อมยาก) — ให้ความสำคัญกับ "เชื่อมติด" ก่อน; ชื่อ/เพชรของขวัญ
    //       มาจาก giftDetails ใน event เอง (มีสำหรับของขวัญส่วนใหญ่) + catalog 405 ชิ้น
    //       ของขวัญหายากที่ไม่มีข้อมูลจะขึ้น #id (ยอมรับได้ แลกกับการเชื่อมที่เสถียร)
    enableExtendedGiftInfo: false,
    processInitialData: false,
    fetchRoomInfoOnConnect: true
  };
  const key = settings.get().signApiKey;
  if (key) options.signApiKey = key;

  const c = new TikTokLiveConnection(username, options);
  const on = (ev, handler) => { if (ev) c.on(ev, handler); };

  on(WebcastEvent.CHAT, d => { debugCapture('chat', d); bus.emit('chat', { ...normUser(d.user || d), comment: pickComment(d) }); });
  on(WebcastEvent.GIFT, d => { debugCapture('gift', d); bus.emit('gift', normGift(d)); });
  on(WebcastEvent.LIKE, d => {
    debugCapture('like', d);
    bus.emit('like', {
      ...normUser(d.user || d),
      likeCount: Number(d.likeCount || 1),
      totalLikeCount: Number(d.totalLikeCount || 0)
    });
  });
  on(WebcastEvent.FOLLOW, d => { debugCapture('follow', d); bus.emit('follow', normUser(d.user || d)); });
  on(WebcastEvent.SHARE, d => { debugCapture('share', d); bus.emit('share', normUser(d.user || d)); });
  // v2 ใช้ SUB_NOTIFY เป็นเหตุการณ์สมัครสมาชิก (SUBSCRIBE ไม่มีในบางเวอร์ชัน — guard ไว้ทั้งคู่)
  const onSubscribe = d => bus.emit('subscribe', { ...normUser(d.user || d), subMonth: d.subMonth || 1 });
  on(WebcastEvent.SUBSCRIBE, onSubscribe);
  on(WebcastEvent.SUB_NOTIFY, onSubscribe);
  on(WebcastEvent.MEMBER, d => { debugCapture('member', d); bus.emit('member', normUser(d.user || d)); });
  on(WebcastEvent.ROOM_USER, d => {
    const top = Array.isArray(d.topViewers)
      ? d.topViewers.filter(t => t && t.user).map(t => ({ ...normUser(t.user), coinCount: Number(t.coinCount || 0) }))
      : [];
    bus.emit('roomStats', { viewerCount: Number(d.viewerCount || 0), topViewers: top });
  });
  on(WebcastEvent.STREAM_END, () => {
    bus.emit('streamEnd', { username });
    wantConnected = false;
    disconnect().catch(() => {});
  });
  // ไม่ผูก CONNECTED (ใช้ค่าที่ conn.connect() คืนแทน กันยิง 'connected' ซ้ำ)
  on(ControlEvent.DISCONNECTED, () => handleDisconnect());
  on(ControlEvent.ERROR, err => {
    bus.emit('log', { level: 'error', msg: 'TikTok error: ' + errToString(err) });
  });
  return c;
}

// ---------- จัดหมวดหมู่ error ----------
function classifyError(err) {
  const name = (err && (err.name || (err.constructor && err.constructor.name))) || '';
  const msg = errToString(err);
  // ใช้ชื่อคลาส error ของไลบรารีก่อน (แม่นกว่าการ match ข้อความ)
  if (/UserOffline/i.test(name) || /offline|not.*online|isn.?t.?online|not.*live/i.test(msg)) return 'offline';
  if (/InvalidUniqueId/i.test(name) || /no such user|user.*not.*exist|not.*found/i.test(msg)) return 'notfound';
  if (/SignatureRateLimit/i.test(name) || /rate.?limit|too many|429|quota|exceeded/i.test(msg)) return 'ratelimit';
  if (/PremiumFeature/i.test(name) || /premium|api key required|requires.*key/i.test(msg)) return 'premium';
  if (/Sign|Signature/i.test(name) || /\bsign\b|euler|signature/i.test(msg)) return 'sign';
  if (/Timeout|Connect/i.test(name) || /timeout|ETIMEDOUT|ENOTFOUND|ECONNREFUSED|network|socket/i.test(msg)) return 'network';
  if (/room ?id|retrieve/i.test(msg)) return 'roomid'; // ดึงห้องไม่ได้ — อาจชั่วคราว
  return 'other';
}
// error ที่ retry แล้วอาจหาย — 'sign' ไม่ retry อัตโนมัติ เพราะการยิง sign ซ้ำยิ่งกินโควต้าฟรี
// (ให้ผู้ใช้กด "ลองใหม่" เองแบบเว้นจังหวะแทน — เปลืองน้อยกว่า); ratelimit/premium ก็ไม่ retry
function isRetryable(kind) { return kind === 'network' || kind === 'roomid'; }

function abortableSleep(ms, signal) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    if (signal) {
      if (signal.aborted) { clearTimeout(t); return reject(new Error('aborted')); }
      signal.addEventListener('abort', () => { clearTimeout(t); reject(new Error('aborted')); }, { once: true });
    }
  });
}

// ---------- Connect (เฟส 1: retry + waitForLive) ----------
async function connect(usernameArg, opts = {}) {
  const waitForLive = !!opts.waitForLive;
  const username = String(usernameArg || settings.get().username || '').trim().replace(/^@/, '');
  if (!username) throw new Error('กรุณาระบุชื่อผู้ใช้ TikTok (@username)');

  await disconnect(); // ล้างการเชื่อมเดิม (ตั้ง wantConnected=false + abort)

  wantConnected = true;
  debugCaptured = {}; // เก็บ raw event ตัวอย่างชุดใหม่ทุกครั้งที่เชื่อม
  attemptAbort = new AbortController();
  Object.assign(state, { username, error: null, errorKind: null, attempt: 0, nextRetryMs: 0 });
  setStatus('connecting');

  const lib = await loadLib();
  try {
    return await runConnect(username, lib, waitForLive);
  } catch (err) {
    if (!wantConnected) { setStatus('disconnected'); return { ...state }; } // ถูกยกเลิก — ไม่ถือเป็น error
    state.error = friendlyError(err);
    state.errorKind = classifyError(err);
    wantConnected = false;
    conn = null;
    setStatus('disconnected');
    throw new Error(state.error);
  }
}

async function runConnect(username, lib, waitForLive) {
  const { TikTokLiveConnection, WebcastEvent, ControlEvent } = lib;
  const mkConn = () => buildConn(username, TikTokLiveConnection, WebcastEvent, ControlEvent);

  // ถ้าเลือกรอไลฟ์ และตอนนี้ยังไม่ไลฟ์ → poll รอก่อน
  if (waitForLive) {
    conn = mkConn();
    let live = null;
    try { live = await conn.fetchIsLive(); } catch (_) { /* เช็คไม่ได้ ปล่อยให้ connect ลองเอง */ }
    if (live === false) {
      setStatus('waiting');
      bus.emit('log', { level: 'info', msg: `รอ @${username} เปิดไลฟ์...` });
      await conn.waitUntilLive(30, attemptAbort.signal);
    }
  }

  let retryIdx = 0;
  for (;;) {
    if (!wantConnected) throw new Error('ยกเลิกการเชื่อมต่อ');
    if (conn) { try { await conn.disconnect(); } catch (_) {} }
    conn = mkConn(); // instance ใหม่ทุกครั้ง กัน state ค้าง
    if (retryIdx === 0 && state.status !== 'waiting') setStatus('connecting');

    try {
      const roomState = await conn.connect();
      reconnectAttempts = 0;
      Object.assign(state, {
        roomId: (roomState && roomState.roomId) || state.roomId,
        connectedAt: Date.now(),
        error: null, errorKind: null, attempt: 0, nextRetryMs: 0
      });
      setStatus('connected');
      bus.emit('connected', { roomId: state.roomId, username });
      seedLikes(conn); // ดึงยอดไลค์รวมจริงจากข้อมูลห้อง (ถ้ามี) หลัง resetSession
      return { ...state };
    } catch (err) {
      if (!wantConnected) throw err;
      const kind = classifyError(err);

      if (kind === 'offline' && waitForLive) {
        setStatus('waiting');
        await conn.waitUntilLive(30, attemptAbort.signal);
        retryIdx = 0;
        continue;
      }
      if (isRetryable(kind) && retryIdx < RETRY_BACKOFF.length) {
        const delay = RETRY_BACKOFF[retryIdx];
        retryIdx += 1;
        setStatus('retrying', { attempt: retryIdx, nextRetryMs: delay, error: friendlyError(err), errorKind: kind });
        bus.emit('log', { level: 'warn', msg: `เชื่อมต่อไม่สำเร็จ ลองใหม่ครั้งที่ ${retryIdx}/${RETRY_BACKOFF.length} ใน ${delay / 1000}s` });
        await abortableSleep(delay, attemptAbort.signal);
        continue;
      }
      throw err; // terminal → จัดการใน connect()
    }
  }
}

// ---------- Seed ยอดไลค์รวมจาก roomInfo ----------
// roomInfo เป็น any — ขุดหา like count ตามพาธที่พบได้บ่อย
function digLikeCount(ri) {
  if (!ri || typeof ri !== 'object') return 0;
  const s = ri.stats || (ri.data && ri.data.stats) || {};
  const candidates = [
    ri.like_count, ri.likeCount,
    s.like_count, s.likeCount, s.total_like, s.digg_count,
    ri.data && ri.data.like_count,
    ri.room && ri.room.like_count
  ];
  for (const v of candidates) { const n = Number(v); if (Number.isFinite(n) && n > 0) return n; }
  return 0;
}
function seedLikes(c) {
  try {
    const seed = digLikeCount(c && c.roomInfo);
    if (seed > 0) {
      bus.emit('likeSeed', { total: seed });
      bus.emit('log', { level: 'info', msg: `ดึงยอดไลค์รวมเริ่มต้น ${seed.toLocaleString()} จากข้อมูลห้อง` });
    }
  } catch (_) { /* roomInfo ไม่มี like count — ปล่อยให้ like event แรก seed แทน */ }
}

// ---------- Error → ข้อความไทย ----------
function errToString(err) {
  if (!err) return 'ไม่ทราบสาเหตุ';
  if (typeof err === 'string') return err;
  if (err.message) return err.message;
  if (err.reason) return String(err.reason);
  if (err.info) return String(err.info);
  try { return JSON.stringify(err); } catch (_) { return String(err); }
}

function friendlyError(err) {
  const kind = classifyError(err);
  switch (kind) {
    case 'offline': return 'ผู้ใช้นี้ไม่ได้กำลังไลฟ์อยู่ตอนนี้ — เปิดไลฟ์ก่อน หรือกด "รอจนไลฟ์"';
    case 'notfound': return 'ไม่พบผู้ใช้นี้ — ตรวจสอบชื่อ @username อีกครั้ง';
    case 'ratelimit': return 'โควต้าการเชื่อมต่อฟรี (EulerStream) หมดชั่วคราว — รอสัก 10–30 นาที หรือใส่ Sign API key ฟรีจาก eulerstream.com ในหน้าตั้งค่า (โควต้าจะสูงขึ้นมาก)';
    case 'premium': return 'ฟีเจอร์นี้ต้องใช้ Sign API key — สมัครฟรีที่ eulerstream.com แล้วใส่ในหน้าตั้งค่า';
    case 'sign': return 'เชื่อมไม่สำเร็จ — โควต้าฟรีของ EulerStream น่าจะเต็ม/สะดุด รอ 1–2 นาทีแล้วกด "เชื่อมต่อ" ใหม่ (อย่ากดรัว); ถ้าเป็นบ่อยแนะนำใส่ Sign API key ฟรีจาก eulerstream.com ในหน้าตั้งค่า จะเสถียรขึ้นมาก';
    case 'network': return 'เชื่อมต่ออินเทอร์เน็ตไม่สำเร็จ — ตรวจสอบเน็ตแล้วลองใหม่';
    case 'roomid': return 'ดึงข้อมูลห้องไลฟ์ไม่ได้ — ตรวจสอบชื่อ @username และว่ากำลังไลฟ์อยู่จริง';
    default: return errToString(err);
  }
}

// ---------- หลุดกลางไลฟ์ → reconnect ----------
function handleDisconnect() {
  const wasConnected = state.status === 'connected';
  if (state.status === 'connected') setStatus('disconnected');
  state.roomId = null;
  bus.emit('disconnected', { username: state.username });
  // หลุดโดยไม่ตั้งใจ → ลองต่อใหม่อัตโนมัติ (สูงสุด 5 ครั้ง, backoff)
  if (wantConnected && wasConnected && reconnectAttempts < 5) {
    reconnectAttempts += 1;
    const delay = Math.min(30000, 2000 * reconnectAttempts);
    setStatus('retrying', { attempt: reconnectAttempts, nextRetryMs: delay });
    bus.emit('log', { level: 'warn', msg: `หลุดจากไลฟ์ กำลังเชื่อมต่อใหม่ครั้งที่ ${reconnectAttempts} ใน ${delay / 1000}s` });
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(() => {
      connect(state.username).catch(err =>
        bus.emit('log', { level: 'error', msg: 'เชื่อมต่อใหม่ไม่สำเร็จ: ' + err.message }));
    }, delay);
  }
}

async function disconnect() {
  wantConnected = false;
  clearTimeout(reconnectTimer);
  if (attemptAbort) { try { attemptAbort.abort(); } catch (_) {} }
  if (conn) {
    try { await conn.disconnect(); } catch (_) { /* เพิกเฉย */ }
    conn = null;
  }
  reconnectAttempts = 0;
  if (state.status !== 'disconnected') {
    Object.assign(state, { roomId: null, attempt: 0, nextRetryMs: 0 });
    setStatus('disconnected');
    bus.emit('disconnected', { username: state.username });
  }
  return { ...state };
}

function getState() { return { ...state }; }

module.exports = { connect, disconnect, getState };
