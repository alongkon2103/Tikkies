// จำลองการกดปุ่มระดับ OS — macOS (osascript/System Events) และ Windows (PowerShell SendKeys)
// ความปลอดภัย: ห้ามส่ง string ผู้ใช้เข้า shell ตรงๆ — ทุกอย่างผ่าน whitelist + ค่าที่ validate แล้ว
//   (macOS: key code ตัวเลข; Windows: token จาก whitelist ส่งแบบ base64)
const { execFile } = require('child_process');
const bus = require('./eventBus');

// ---------- ตาราง key → key code ของ macOS (ANSI layout) ----------
const KEY_CODES = {
  a: 0, s: 1, d: 2, f: 3, h: 4, g: 5, z: 6, x: 7, c: 8, v: 9,
  b: 11, q: 12, w: 13, e: 14, r: 15, y: 16, t: 17,
  '1': 18, '2': 19, '3': 20, '4': 21, '6': 22, '5': 23,
  '9': 25, '7': 26, '8': 28, '0': 29,
  o: 31, u: 32, i: 34, p: 35, l: 37, j: 38, k: 40, n: 45, m: 46,
  space: 49, enter: 36, return: 36, tab: 48, escape: 53, delete: 51,
  up: 126, down: 125, left: 123, right: 124,
  f1: 122, f2: 120, f3: 99, f4: 118, f5: 96, f6: 97,
  f7: 98, f8: 100, f9: 101, f10: 109, f11: 103, f12: 111
};
const HOLDABLE_CHARS = /^[a-z0-9]$/;
const MODIFIERS = { cmd: 'command down', command: 'command down', ctrl: 'control down', control: 'control down', alt: 'option down', option: 'option down', shift: 'shift down' };
const MODIFIER_KEYS = { cmd: 'command', command: 'command', ctrl: 'control', control: 'control', alt: 'option', option: 'option', shift: 'shift' };

// ---------- ตาราง key → SendKeys token ของ Windows ----------
// อ้างอิง: https://learn.microsoft.com/dotnet/api/system.windows.forms.sendkeys
const WIN_KEYS = {
  space: ' ', enter: '{ENTER}', return: '{ENTER}', tab: '{TAB}', escape: '{ESC}', delete: '{BACKSPACE}',
  up: '{UP}', down: '{DOWN}', left: '{LEFT}', right: '{RIGHT}',
  f1: '{F1}', f2: '{F2}', f3: '{F3}', f4: '{F4}', f5: '{F5}', f6: '{F6}',
  f7: '{F7}', f8: '{F8}', f9: '{F9}', f10: '{F10}', f11: '{F11}', f12: '{F12}'
};
// modifier → สัญลักษณ์ SendKeys (cmd/win = null เพราะ SendKeys ส่งปุ่ม Win ไม่ได้)
const WIN_MOD = { cmd: null, command: null, win: null, windows: null, ctrl: '^', control: '^', alt: '%', option: '%', shift: '+' };

const UNSUPPORTED_KEY_MSG = 'ไม่รองรับปุ่ม "%K" — ใช้ได้เฉพาะ a-z, 0-9, space, enter, tab, escape, delete, ลูกศร (up/down/left/right) และ f1-f12';

function normKey(key) { return String(key || '').trim().toLowerCase(); }
function normMods(modifiers) { return (Array.isArray(modifiers) ? modifiers : []).map((m) => String(m || '').trim().toLowerCase()).filter(Boolean); }
function clampHold(holdMs) { let h = Number(holdMs) || 0; if (!isFinite(h) || h < 0) h = 0; return Math.min(10000, h); }

// ---------- ตัวสร้างสคริปต์ (pure — เทสต์ได้โดยไม่ต้องรัน OS) ----------
// macOS: คืน AppleScript
function buildAppleScript(key, modifiers, holdMs) {
  const keyName = normKey(key);
  if (!(keyName in KEY_CODES)) throw new Error(UNSUPPORTED_KEY_MSG.replace('%K', keyName));
  const keyCode = KEY_CODES[keyName];
  const modPhrases = [], modKeys = [];
  for (const name of normMods(modifiers)) {
    if (!(name in MODIFIERS)) throw new Error('ไม่รองรับ modifier "' + name + '" — ใช้ได้เฉพาะ cmd, ctrl, alt, shift');
    if (!modKeys.includes(MODIFIER_KEYS[name])) { modPhrases.push(MODIFIERS[name]); modKeys.push(MODIFIER_KEYS[name]); }
  }
  const hold = clampHold(holdMs);
  const lines = ['tell application "System Events"'];
  if (hold > 0) {
    const delaySec = (hold / 1000).toFixed(3);
    for (const mk of modKeys) lines.push('key down ' + mk);
    if (HOLDABLE_CHARS.test(keyName)) {
      lines.push('key down "' + keyName + '"'); lines.push('delay ' + delaySec); lines.push('key up "' + keyName + '"');
    } else {
      lines.push('key code ' + keyCode); lines.push('delay ' + delaySec);
    }
    for (const mk of modKeys.slice().reverse()) lines.push('key up ' + mk);
  } else {
    lines.push(modPhrases.length ? 'key code ' + keyCode + ' using {' + modPhrases.join(', ') + '}' : 'key code ' + keyCode);
  }
  lines.push('end tell');
  return lines.join('\n');
}

// Windows: คืน { sendKeys, warnings } — sendKeys คือสตริงที่ SendKeys.SendWait จะส่ง
function buildSendKeys(key, modifiers, holdMs) {
  const keyName = normKey(key);
  let token = WIN_KEYS[keyName];
  if (token === undefined) {
    if (/^[a-z0-9]$/.test(keyName)) token = keyName; // ตัวอักษร/ตัวเลขส่งตรงๆ
    else throw new Error(UNSUPPORTED_KEY_MSG.replace('%K', keyName));
  }
  const warnings = [];
  let prefix = '';
  for (const name of normMods(modifiers)) {
    if (!(name in WIN_MOD)) throw new Error('ไม่รองรับ modifier "' + name + '" — ใช้ได้เฉพาะ ctrl, alt, shift');
    const sym = WIN_MOD[name];
    if (sym === null) { warnings.push('ปุ่ม Cmd/Win ส่งบน Windows ไม่ได้ (ข้าม)'); continue; }
    if (!prefix.includes(sym)) prefix += sym;
  }
  if (clampHold(holdMs) > 0) warnings.push('การกดค้างยังไม่รองรับบน Windows — จะกดครั้งเดียวแทน');
  return { sendKeys: prefix + token, warnings };
}

// ---------- ตัวรัน ----------
function runOsascript(script) {
  return new Promise((resolve, reject) => {
    execFile('osascript', ['-e', script], { timeout: 15000 }, (err, stdout, stderr) => {
      if (err) {
        const detail = (stderr || err.message || '').trim();
        bus.emit('log', { level: 'error', msg: 'กดปุ่มไม่สำเร็จ — ตรวจสอบสิทธิ์ Accessibility ใน System Settings > Privacy & Security > Accessibility: ' + detail });
        reject(new Error('กดปุ่มไม่สำเร็จ: ' + detail));
        return;
      }
      resolve(stdout);
    });
  });
}

function runPowershell(sendKeysStr) {
  return new Promise((resolve, reject) => {
    // ส่งสตริง SendKeys แบบ base64 (UTF-16LE = .NET Unicode) กัน injection/ปัญหา quoting
    const b64 = Buffer.from(sendKeysStr, 'utf16le').toString('base64');
    const script =
      "[void][Reflection.Assembly]::LoadWithPartialName('System.Windows.Forms');" +
      "$s=[Text.Encoding]::Unicode.GetString([Convert]::FromBase64String('" + b64 + "'));" +
      "[System.Windows.Forms.SendKeys]::SendWait($s)";
    execFile('powershell', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { timeout: 15000, windowsHide: true }, (err, stdout, stderr) => {
        if (err) {
          const detail = (stderr || err.message || '').trim();
          bus.emit('log', { level: 'error', msg: 'กดปุ่มไม่สำเร็จ (Windows) — เปิดโปรแกรม/หน้าต่างเกมให้อยู่โฟกัส แล้วลองใหม่: ' + detail });
          reject(new Error('กดปุ่มไม่สำเร็จ: ' + detail));
          return;
        }
        resolve(stdout);
      });
  });
}

// ---------- API ----------
async function press(key, modifiers = [], holdMs = 0) {
  if (process.platform === 'darwin') {
    return runOsascript(buildAppleScript(key, modifiers, holdMs));
  }
  if (process.platform === 'win32') {
    const { sendKeys, warnings } = buildSendKeys(key, modifiers, holdMs);
    warnings.forEach((w) => bus.emit('log', { level: 'warn', msg: w }));
    return runPowershell(sendKeys);
  }
  throw new Error('การจำลองปุ่มรองรับเฉพาะ macOS และ Windows');
}

module.exports = { press, buildAppleScript, buildSendKeys };
