# Tikkies Tools — สัญญากลางระหว่างโมดูล (Internal Contract)

ทุกโมดูลสื่อสารผ่าน `src/core/eventBus.js` (Node EventEmitter singleton)
Widget/Dashboard รับ event ผ่าน WebSocket `ws://localhost:21213` เป็น JSON `{event, data}`

## Event จาก TikTok (normalize แล้วโดย src/core/tiktok.js และ src/core/simulator.js)

ฟิลด์ user ที่มีใน **ทุก** event ที่เกิดจากผู้ชม:

```js
{ userId, uniqueId, nickname, profilePictureUrl, followRole, isModerator, isSubscriber }
// followRole: 0=ไม่ติดตาม, 1=ติดตาม, 2=เพื่อน; event จำลองมี simulated: true เพิ่ม
```

| event | ฟิลด์เพิ่มเติม |
|---|---|
| `chat` | `comment` |
| `gift` | `giftId, giftName, giftPictureUrl, diamondCount, repeatCount, streakable, repeatEnd, diamondTotal` — **นับยอดเฉพาะเมื่อ `repeatEnd === true`** |
| `like` | `likeCount, totalLikeCount` |
| `follow`, `share`, `member` | (เฉพาะ user) |
| `subscribe` | `subMonth` |
| `roomStats` | `viewerCount, topViewers[]` |
| `connected` | `roomId, username` |
| `disconnected`, `streamEnd` | `username` |
| `connectionState` | `status ('disconnected'\|'connecting'\|'connected'), username, roomId, error` |

## Event ที่ระบบสร้าง (โมดูลภายใน → bus → broadcast)

| event | data | ผู้สร้าง | ผู้ใช้ |
|---|---|---|---|
| `alert` | `{ text, subText, imageUrl, soundUrl, durationSec, accentColor }` | actions.js | widget alerts.html (เล่นเสียง `soundUrl` ที่นี่ที่เดียว) |
| `tts` | `{ id, text, voice, rate, pitch, volume }` | tts.js | Dashboard อ่านเสียงเมื่อ `settings.tts.playInApp === true` (ค่าเริ่มต้น); widget tts.html อ่านเมื่อเปิดใน "เบราว์เซอร์จริง" เท่านั้น (OBS ไม่รองรับ speechSynthesis) และแสดง caption |
| `sound` | `{ url, volume }` | actions.js | Dashboard เป็นคนเล่น |
| `goals` | `{ likes: {enabled,target,label,current}, diamonds: {...}, followers: {...} }` | stats.js | widget goal.html, Dashboard |
| `leaderboard` | `{ top: [{uniqueId, nickname, profilePictureUrl, diamonds, gifts}] }` | stats.js | widget leaderboard.html, Dashboard |
| `stats` | `{ viewerCount, totalLikes, sessionLikes, totalDiamonds, totalChats, follows, shares, joins, subscribes, giftCount, startedAt }` | stats.js | Dashboard |
| `timer` | `{ running, remainingSec, totalAddedSec, label, enabled, lastAdd? }` | stats.js | widget timer.html, Dashboard |
| `action` | `{ actionId, name, triggeredBy }` | actions.js | Dashboard (log) |
| `log` | `{ level: 'info'\|'warn'\|'error', msg }` | ทุกโมดูล | Dashboard |
| `obsState` | `{ connected, error? }` | obs.js | Dashboard |
| `wheelSpin` | `{ spinId, winnerIndex, label, durationSec, resultHoldSec, title, segments:[{label, color, image}] }` | wheel.js (main สุ่มผล — ทุก overlay เห็นตรงกัน) | widget wheel.html (roulette แนวนอน) |
| `wheelResult` | `{ label, prize, image }` | wheel.js (หลังหมุนจบ + TTS ประกาศถ้าเปิด announceTts) | actions.js (trigger `wheelResult` — `trigger.prize` ว่าง = ทุกช่อง; template `{prize}`) |

**Trigger `like`** — `trigger.likeMode`: `'total'` (ค่าเริ่มต้น/ไม่ระบุ = ยอดรวมทั้งห้อง ข้ามหลัก likeThreshold) หรือ `'perUser'` (นับไลค์สะสมรายคนจาก uniqueId ยิงเมื่อคนหนึ่งกดครบทุกๆ likeThreshold; แต่ละคนมีตัวนับ+คูลดาวน์แยก; `{likeCount}`=หมุดที่คนนั้นถึง, `{nickname}`=คนที่กด). likeState ต่อ action: total = `{lastMilestone}`, perUser = `{users: Map<uid,{count,lastMilestone,lastFired}>}` — ล้างเมื่อ connected.

**Trigger `hotkey`** — `trigger: { type:'hotkey', accelerator:'F6'|'Control+Shift+A'|... }` ไม่ผ่าน bus: src/core/hotkeys.js register Electron globalShortcut จาก actions โดยตรง (re-apply เมื่อ settings:changed) กดแล้วรัน responses ของ action นั้นด้วยข้อมูลตัวอย่าง

**`/media`** — ไฟล์ที่ผู้ใช้อัพโหลด (IPC `media:import` copy เข้า userData/media ตั้งชื่อตาม hash) เสิร์ฟโดย overlayServer; เก็บใน settings เป็น URL relative `/media/<name>` (origin เดียวกับ widget — OBS โหลดได้)
| `likeSeed` | `{ total }` | tiktok.js (หลัง connect ดึงจาก roomInfo) | stats + actions (seed ยอดไลค์รวมจริง — ไม่ broadcast) |
| `snapshot` | `{ connection, stats, goals, leaderboard, timer, settings }` | overlayServer (ส่งให้ WS client ใหม่ทันที) | ทุก widget ใช้ตั้งค่าเริ่มต้น |
| `settings:changed` | settings ทั้งก้อน | settings.js | โมดูลภายใน (ไม่ broadcast) |

## WebSocket (widget → server)

Widget ส่งกลับได้: `{cmd: 'simulate', type: 'gift', overrides: {...}}`

## REST

- `GET /api/state` → snapshot เดียวกับ event `snapshot`
- `POST /api/simulate` body `{type, ...overrides}`
- `GET /api/gifts` (`?q=` ค้นหา) → แคตตาล็อกของขวัญ `[{id, name, image, coins}]` จาก `data/tiktok_gifts.json` (405 รายการ)

## Gift Catalog (`src/core/giftCatalog.js`)

- โหลดจาก `data/tiktok_gifts.json`; `tiktok.js` เรียก `enrich()` ให้อัตโนมัติ — gift event ที่ออกจาก bus จะมีชื่อ/รูป/ราคาเพชรครบเสมอเมื่อ id อยู่ในแคตตาล็อก
- IPC: `gifts:list` payload `{q?}` → รายการของขวัญ (ใช้ทำ dropdown เลือกของขวัญใน Actions editor)

## Widget helper (`/widgets/common/widget.js`)

```js
TikkiesWidget.connect({ onEvent(event, data), onOpen(), onClose() }) // → {send(obj)}
TikkiesWidget.escapeHtml(s); TikkiesWidget.formatNumber(n);
TikkiesWidget.fillTemplate('สวัสดี {nickname}', data); TikkiesWidget.params // URLSearchParams
```

## IPC (Dashboard ↔ main) — ผ่าน `window.tikkies` (preload.js)

```js
await window.tikkies.invoke(cmd, payload);
window.tikkies.onEvent(({event, data}) => {}); // event เดียวกับตาราง broadcast ข้างบน + log/sound/obsState
```

| cmd | payload | ผลลัพธ์ |
|---|---|---|
| `state:get` | — | `{connection, stats, goals, leaderboard, timer, settings, settingsFull, serverPort, obs, version}` |
| `tiktok:connect` | `{username}` | state / throw ข้อความไทย |
| `tiktok:disconnect` | — | state |
| `settings:get` / `settings:set` | — / `{patch}` (deep merge, array แทนทั้งก้อน) | settings |
| `simulate` | `{type, overrides}` | payload ที่ยิง |
| `actions:test` | `{id}` | ผลการรัน |
| `tts:test` | `{text}` | — |
| `timer:control` | `{cmd: 'start'\|'pause'\|'reset'\|'add', payload}` | timer |
| `obs:connect` / `obs:disconnect` / `obs:status` / `obs:scenes` | — | สถานะ/รายชื่อ scene |
| `app:openExternal` | `{url}` | — |
| `app:pickFile` | `{filters?}` | path หรือ null |

## โครงสร้าง settings (src/core/settings.js — ดู DEFAULTS เป็นแหล่งความจริง)

action หนึ่งตัว:

```js
{
  id: 'a_' + สุ่ม, name: 'ชื่อ', enabled: true, cooldownSec: 0,
  trigger: {
    type: 'gift'|'chat'|'like'|'follow'|'share'|'subscribe'|'member',
    giftName: 'Rose',        // เฉพาะ gift; ว่าง = ของขวัญทุกชิ้น
    minDiamonds: 0,          // เฉพาะ gift
    keyword: '!cmd',         // เฉพาะ chat; ว่าง = ทุกข้อความ (match แบบ contains, case-insensitive)
    likeThreshold: 100       // เฉพาะ like; ยิงทุกครั้งที่ยอดสะสม session ข้ามผลคูณของค่านี้
  },
  responses: [
    { type: 'alert', text: '{nickname} ส่ง {giftName} x{repeatCount}!', subText: '', imageUrl: '', soundUrl: '', durationSec: 6 },
    { type: 'tts', text: 'ขอบคุณ {nickname}' },
    { type: 'sound', url: '/assets/sounds/ding.mp3', volume: 1 },
    { type: 'keypress', key: 'space', modifiers: ['cmd'], holdMs: 0 },
    { type: 'obs', obsAction: 'setScene'|'toggleSource', scene: '', source: '', visible: true },
    { type: 'webhook', url: '', method: 'POST', body: '' }
  ]
}
```

Template placeholder ที่ใช้ได้ใน text: `{nickname} {uniqueId} {comment} {giftName} {repeatCount} {diamondCount} {diamondTotal} {likeCount} {totalLikes}`

หมายเหตุ like trigger: ยิงเมื่อ **ยอดไลค์รวมจริงของห้อง** (`totalLikeCount`) ข้ามหลักใหม่ของ `likeThreshold` (เช่น 1000 → ยิงที่ 1000/2000/...); เชื่อมกลางไลฟ์ init เป็นหลักปัจจุบัน (ไม่ยิงย้อนหลัง); `{likeCount}` = เลขหมุดกลม, `{totalLikes}` = ยอดจริง

keypress ใน editor เป็นแบบ **กดบันทึก** (คลิกช่อง → กดปุ่มจริง → เก็บ key+modifiers อัตโนมัติ); เก็บใน action เหมือนเดิม `{key, modifiers[], holdMs}`

## โมดูลที่ main.js require (ต้อง export ตามนี้)

- `src/core/actions.js` → `{ init(), test(id), run(action, eventData) }`
- `src/core/tts.js` → `{ init(), speak(text, opts?) }`
- `src/core/obs.js` → `{ init(), connect(), disconnect(), getStatus(), getScenes(), setScene(name), toggleSource(scene, source, visible) }`
- `src/core/keypress.js` → `{ press(key, modifiers?, holdMs?) }` (macOS: osascript; อื่น: โยน error ข้อความไทย)

ข้อควรระวัง: ห้าม `require('tiktok-live-connector')` แบบ CJS (เป็น ESM-only) — มีเฉพาะใน tiktok.js ผ่าน dynamic import แล้ว
