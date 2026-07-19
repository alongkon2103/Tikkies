// ตัวเล่นเสียง TTS ในแอป (main process) — macOS ใช้ `say`, Windows ใช้ System.Speech (SAPI) ผ่าน PowerShell
// (Electron renderer speechSynthesis คืน voices ว่าง เล่นไม่ได้จริง จึงย้ายมาที่นี่)
// ฟัง event 'tts' → ถ้า settings.tts.playInApp เล่นตามคิว (ทีละข้อความ)
const { execFile } = require('child_process');
const bus = require('./eventBus');
const settings = require('./settings');

function isMac() { return process.platform === 'darwin'; }
function isWin() { return process.platform === 'win32'; }
function isSupported() { return isMac() || isWin(); }

let queue = [];
let speaking = false;
let currentProc = null;
let voicesCache = null;

// ---------- parse รายชื่อเสียง (pure) ----------
function parseMacVoices(stdout) {
  const voices = [];
  String(stdout).split('\n').forEach((line) => {
    // "Name              en_US    # ตัวอย่าง"
    const m = line.match(/^(.+?)\s{2,}([a-z]{2}[_-][A-Za-z]{2,})\s*(#.*)?$/);
    if (m) voices.push({ name: m[1].trim(), lang: m[2].replace('-', '_') });
  });
  return voices;
}
function parseWinVoices(stdout) {
  const voices = [];
  String(stdout).split(/\r?\n/).forEach((line) => {
    // "Microsoft Pattara|th-TH"
    const m = line.match(/^(.+?)\|([a-z]{2}[-_][A-Za-z]{2,})\s*$/i);
    if (m) voices.push({ name: m[1].trim(), lang: m[2].replace('-', '_') });
  });
  return voices;
}

const WIN_LIST_VOICES_SCRIPT =
  "Add-Type -AssemblyName System.Speech;" +
  "(New-Object System.Speech.Synthesis.SpeechSynthesizer).GetInstalledVoices()|" +
  "%{$_.VoiceInfo.Name+'|'+$_.VoiceInfo.Culture}";

function listVoicesRaw() {
  return new Promise((resolve) => {
    if (isMac()) {
      execFile('say', ['-v', '?'], { timeout: 6000 }, (err, stdout) => resolve(err ? [] : parseMacVoices(stdout)));
    } else if (isWin()) {
      execFile('powershell', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', WIN_LIST_VOICES_SCRIPT],
        { timeout: 9000, windowsHide: true }, (err, stdout) => resolve(err ? [] : parseWinVoices(stdout)));
    } else {
      resolve([]);
    }
  });
}

// ---------- คะแนน/เลือกเสียงไทย ----------
function thaiVoiceScore(name) {
  const n = String(name).toLowerCase();
  let s = 0;
  if (/premium/.test(n)) s += 4;
  if (/siri/.test(n)) s += 3;
  if (/enhanced|neural/.test(n)) s += 2;
  return s;
}
function thaiVoices(voices) {
  return voices.filter((x) => /^th[_-]/i.test(x.lang)).sort((a, b) => thaiVoiceScore(b.name) - thaiVoiceScore(a.name));
}
async function getVoices() {
  if (!voicesCache) {
    const raw = await listVoicesRaw();
    const th = thaiVoices(raw);
    const rest = raw.filter((v) => !/^th[_-]/i.test(v.lang)).sort((a, b) => a.name.localeCompare(b.name));
    voicesCache = th.concat(rest); // เสียงไทย (ดีสุดก่อน) ขึ้นก่อน
  }
  return voicesCache;
}
async function pickVoice(requested) {
  const voices = await getVoices();
  if (requested) {
    const v = voices.find((x) => x.name.toLowerCase() === String(requested).toLowerCase());
    if (v) return v.name;
  }
  const th = thaiVoices(voices)[0];
  return th ? th.name : null; // null = เสียง default ระบบ
}

// ---------- ตัวสร้างคำสั่งพูด (pure — เทสต์ได้) ----------
// macOS: คืน args ของ `say`
function buildSayArgs(d, s, voiceName) {
  const args = [];
  if (voiceName) args.push('-v', voiceName);
  const rate = Number(d.rate != null ? d.rate : s.rate) || 1;
  args.push('-r', String(Math.max(80, Math.min(400, Math.round(175 * rate)))));
  let prefix = '';
  const vol = Number(d.volume != null ? d.volume : (s.volume != null ? s.volume : 1));
  if (Number.isFinite(vol) && vol < 1) prefix += `[[volm ${Math.max(0, vol).toFixed(2)}]] `;
  const pitch = Number(d.pitch != null ? d.pitch : s.pitch);
  if (Number.isFinite(pitch) && pitch !== 1) prefix += `[[pbas ${Math.max(10, Math.min(90, Math.round(50 * pitch)))}]] `;
  args.push(prefix + (d.text || ''));
  return args;
}
// Windows: คืนสคริปต์ PowerShell (ข้อความ/เสียงส่งแบบ base64 กัน injection)
function buildWinSpeakScript(text, voiceName, rateMult, volMult) {
  const rate = Math.max(-10, Math.min(10, Math.round(((Number(rateMult) || 1) - 1) * 10)));
  const vol = Math.max(0, Math.min(100, Math.round((volMult != null && isFinite(volMult) ? Number(volMult) : 1) * 100)));
  const tb64 = Buffer.from(String(text || ''), 'utf16le').toString('base64');
  let sel = '';
  if (voiceName) {
    const vb64 = Buffer.from(String(voiceName), 'utf16le').toString('base64');
    sel = "try{$s.SelectVoice([Text.Encoding]::Unicode.GetString([Convert]::FromBase64String('" + vb64 + "')))}catch{};";
  }
  return 'Add-Type -AssemblyName System.Speech;' +
    '$s=New-Object System.Speech.Synthesis.SpeechSynthesizer;' +
    '$s.Rate=' + rate + ';$s.Volume=' + vol + ';' +
    sel +
    "$s.Speak([Text.Encoding]::Unicode.GetString([Convert]::FromBase64String('" + tb64 + "')))";
}

function drain() {
  if (speaking || !queue.length) return;
  const d = queue.shift();
  speaking = true;
  const s = settings.get().tts || {};
  pickVoice(d.voice || s.voice).then((voiceName) => {
    const onDone = (err) => {
      if (err && err.killed !== true) bus.emit('log', { level: 'warn', msg: 'อ่านเสียงไม่สำเร็จ: ' + (err.message || err) });
      currentProc = null; speaking = false; drain();
    };
    try {
      if (isWin()) {
        const rateMult = Number(d.rate != null ? d.rate : s.rate) || 1;
        const volMult = d.volume != null ? d.volume : (s.volume != null ? s.volume : 1);
        const script = buildWinSpeakScript(d.text || '', voiceName, rateMult, volMult);
        currentProc = execFile('powershell', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], { timeout: 30000, windowsHide: true }, onDone);
      } else {
        currentProc = execFile('say', buildSayArgs(d, s, voiceName), { timeout: 30000 }, onDone);
      }
    } catch (e) {
      bus.emit('log', { level: 'error', msg: 'เรียกตัวอ่านเสียงไม่สำเร็จ: ' + e.message });
      speaking = false; drain();
    }
  }).catch(() => { speaking = false; drain(); });
}

function init() {
  if (!isSupported()) {
    bus.emit('log', { level: 'warn', msg: 'อ่านเสียงในแอปรองรับ macOS และ Windows — ระบบอื่นให้เปิด widget tts.html ในเบราว์เซอร์' });
  }
  bus.on('tts', (d) => {
    const s = settings.get().tts || {};
    if (!s.playInApp || !isSupported()) return; // ผู้ใช้เลือกให้ widget อ่าน หรือ OS ไม่รองรับ
    if (queue.length > 15) queue.shift(); // กันคิวยาวเกินตอนสตรีมคึกคัก
    queue.push(d);
    drain();
  });
  bus.on('connected', () => { queue = []; }); // เริ่ม session ใหม่ = ล้างคิวค้าง
}

function stopAll() {
  queue = [];
  if (currentProc) { try { currentProc.kill(); } catch (_) {} }
  speaking = false;
}

module.exports = { init, getVoices, stopAll, buildSayArgs, buildWinSpeakScript, parseWinVoices, parseMacVoices };
