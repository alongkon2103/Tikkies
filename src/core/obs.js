// ตัวเชื่อม OBS Studio ผ่าน obs-websocket-js v5 (obs-websocket protocol v5, OBS 28+)
// ใช้ settings.get().obs = { enabled, url, password }
// ปล่อยสถานะเข้า bus เป็น event 'obsState' { connected, error? } ให้ Dashboard แสดงผล
const bus = require('./eventBus');
const settings = require('./settings');

const CONNECT_FAIL_MSG =
  'เชื่อมต่อ OBS ไม่สำเร็จ — เปิด OBS แล้วเช็ค Tools > WebSocket Server Settings';
const NOT_CONNECTED_MSG = 'ยังไม่ได้เชื่อมต่อ OBS';
const MAX_RECONNECT = 5;

const state = {
  connected: false,
  url: '',
  error: null
};

let client = null;            // instance ของ OBSWebSocket (สร้างครั้งเดียว ใช้ซ้ำ)
let wantConnected = false;    // ผู้ใช้/ระบบตั้งใจให้เชื่อมต่ออยู่ (ใช้ตัดสินว่าจะ reconnect ไหม)
let reconnectTimer = null;
let reconnectAttempts = 0;

// lazy require กันกรณี require ล้มเหลวบน Node รุ่นเก่า — จะพังเฉพาะตอนใช้งานจริง
// ไม่พังตั้งแต่ require('src/core/obs.js')
function ensureClient() {
  if (client) return client;
  let OBSWebSocket;
  try {
    // v5 เป็น ESM แต่มี build CJS ให้ — export เป็น named key { OBSWebSocket }
    OBSWebSocket = require('obs-websocket-js').OBSWebSocket;
  } catch (err) {
    throw new Error('โหลดไลบรารี obs-websocket-js ไม่สำเร็จ: ' + err.message);
  }
  client = new OBSWebSocket();
  client.on('ConnectionClosed', onConnectionClosed);
  return client;
}

function clearReconnect() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

// สายหลุดหลังจากเคยเชื่อมต่อสำเร็จ (ตอน connect() ล้มเหลว state.connected ยังเป็น false
// เลยไม่เข้าเงื่อนไขนี้ — คนเรียก connect() รับ error ไปจัดการเองแล้ว)
function onConnectionClosed() {
  if (!state.connected) return;
  state.connected = false;
  bus.emit('obsState', { connected: false });
  const cfg = settings.get().obs || {};
  if (cfg.enabled && wantConnected) scheduleReconnect();
}

// reconnect อัตโนมัติแบบ backoff (1s, 2s, 4s, 8s, 16s) สูงสุด 5 ครั้ง
function scheduleReconnect() {
  if (reconnectTimer) return;
  if (reconnectAttempts >= MAX_RECONNECT) {
    bus.emit('log', { level: 'warn', msg: 'เชื่อมต่อ OBS ใหม่ไม่สำเร็จ — หยุดลองหลังครบ ' + MAX_RECONNECT + ' ครั้ง' });
    return;
  }
  reconnectAttempts += 1;
  const delayMs = Math.min(30000, 1000 * Math.pow(2, reconnectAttempts - 1));
  bus.emit('log', {
    level: 'warn',
    msg: 'หลุดการเชื่อมต่อ OBS — จะลองเชื่อมใหม่ครั้งที่ ' + reconnectAttempts + '/' + MAX_RECONNECT +
      ' ในอีก ' + Math.round(delayMs / 1000) + ' วินาที'
  });
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect().catch(() => {
      const cfg = settings.get().obs || {};
      if (cfg.enabled && wantConnected) scheduleReconnect();
    });
  }, delayMs);
}

function assertConnected() {
  if (!state.connected || !client) throw new Error(NOT_CONNECTED_MSG);
}

async function connect() {
  const cfg = settings.get().obs || {};
  const url = cfg.url || 'ws://127.0.0.1:4455';
  const obs = ensureClient();
  clearReconnect();
  state.url = url;
  wantConnected = true;
  try {
    await obs.connect(url, cfg.password || undefined, { rpcVersion: 1 });
    state.connected = true;
    state.error = null;
    reconnectAttempts = 0;
    bus.emit('obsState', { connected: true });
    bus.emit('log', { level: 'info', msg: 'เชื่อมต่อ OBS สำเร็จ (' + url + ')' });
    return getStatus();
  } catch (err) {
    state.connected = false;
    state.error = CONNECT_FAIL_MSG;
    bus.emit('obsState', { connected: false, error: state.error });
    bus.emit('log', { level: 'warn', msg: CONNECT_FAIL_MSG + ' (' + (err && err.message ? err.message : err) + ')' });
    throw new Error(CONNECT_FAIL_MSG);
  }
}

async function disconnect() {
  wantConnected = false;
  clearReconnect();
  reconnectAttempts = 0;
  const wasConnected = state.connected;
  state.connected = false; // ตั้งก่อน เพื่อให้ onConnectionClosed ไม่ยิงซ้ำ/ไม่ reconnect
  if (client) {
    try { await client.disconnect(); } catch (_) { /* ปิดอยู่แล้วก็ไม่เป็นไร */ }
  }
  if (wasConnected) bus.emit('obsState', { connected: false });
  return getStatus();
}

function getStatus() {
  const cfg = settings.get().obs || {};
  return {
    connected: state.connected,
    url: state.url || cfg.url || '',
    error: state.error
  };
}

// คืน array ชื่อ scene (string) เรียงตามลำดับที่ OBS ส่งมา
async function getScenes() {
  assertConnected();
  const res = await client.call('GetSceneList');
  return (res && res.scenes ? res.scenes : []).map((s) => s.sceneName);
}

async function setScene(name) {
  assertConnected();
  await client.call('SetCurrentProgramScene', { sceneName: name });
}

// เปิด/ปิดการมองเห็นของ source ใน scene ที่ระบุ
async function toggleSource(scene, source, visible) {
  assertConnected();
  const res = await client.call('GetSceneItemId', { sceneName: scene, sourceName: source });
  await client.call('SetSceneItemEnabled', {
    sceneName: scene,
    sceneItemId: res.sceneItemId,
    sceneItemEnabled: !!visible
  });
}

function init() {
  const cfg = settings.get().obs || {};
  if (cfg.enabled) {
    connect().catch((err) => {
      bus.emit('log', { level: 'warn', msg: err && err.message ? err.message : String(err) });
    });
  }
}

module.exports = { init, connect, disconnect, getStatus, getScenes, setScene, toggleSource };
