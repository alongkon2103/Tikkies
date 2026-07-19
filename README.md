# 🎁 Tikkies Tools

เครื่องมือสำหรับสตรีมเมอร์ **TikTok LIVE** (แนวเดียวกับ TikFinity) — เชื่อมต่อไลฟ์ด้วยชื่อผู้ใช้เพียงอย่างเดียว
แล้วทำ Alert แจ้งเตือนของขวัญ, อ่านแชทด้วยเสียง (TTS), ตั้งกฎ Actions, โชว์ Overlay/Widget บน OBS,
ตั้งเป้าหมายไลก์/เพชร, อันดับผู้สนับสนุน และ Subathon timer — UI ภาษาไทยทั้งหมด

> ⚠️ ใช้ไลบรารี `tiktok-live-connector` (ไม่เป็นทางการ, reverse-engineering) — **ไม่เกี่ยวข้องกับ TikTok อย่างเป็นทางการ**

---

## ✨ ฟีเจอร์

| หมวด | รายละเอียด |
|---|---|
| 🔌 เชื่อม TikTok LIVE | เชื่อมด้วย `@username` ที่กำลังไลฟ์ ไม่ต้องล็อกอิน; reconnect อัตโนมัติเมื่อหลุด |
| 🔔 Alerts | แจ้งเตือนของขวัญ/ติดตาม/สมาชิก/แชร์ กลางจอ พร้อมเอฟเฟกต์และเสียง |
| 🔊 TTS | อ่านแชท/ของขวัญ/ผู้ติดตามด้วยเสียง; กรองคำต้องห้าม, จำกัดตามบทบาท, เลือกเสียงไทยได้ |
| 🎬 Actions | ตั้งกฎ "เมื่อเกิด X → ทำ Y": Alert, TTS, เล่นเสียง, **กดปุ่มในเกม**, สั่ง OBS, ยิง Webhook |
| 🖥️ Widgets (OBS) | 6 ตัว: Alert, Chat, Goal, Leaderboard, Timer, TTS caption — พื้นหลังโปร่งใส |
| 🎯 เป้าหมาย | หลอดเป้าหมาย หัวใจ/เพชร/ผู้ติดตามใหม่ พร้อม animation |
| 🏆 Leaderboard | อันดับผู้ให้ของขวัญสูงสุดแบบเรียลไทม์ |
| ⏱️ Subathon Timer | นับถอยหลัง +เวลาอัตโนมัติตามเพชร/ติดตาม/แชร์ |
| 🎥 เชื่อม OBS | เปลี่ยน Scene / ซ่อน-แสดง Source ผ่าน obs-websocket (OBS 28+) |
| 🎁 แคตตาล็อกของขวัญ | ฐานข้อมูลของขวัญ 405 ชิ้น — เติมชื่อ/รูป/ราคาเพชรให้ event อัตโนมัติ |

---

## 📦 ความต้องการระบบ

- **macOS** หรือ **Windows**
- **Node.js 18+** (สำหรับติดตั้ง; ตัวแอปรันบน Node 20 ที่มากับ Electron)
- **OBS Studio 28+** (ถ้าจะใช้ฟีเจอร์สั่ง OBS — ไม่บังคับ)

## 🚀 ติดตั้งและรัน

```bash
# 1) ติดตั้ง dependencies (ครั้งแรกครั้งเดียว)
npm install

# 2) เปิดโปรแกรม
npm start
```

### คำสั่งอื่น

```bash
npm run smoke              # ทดสอบว่าทุกโมดูลทำงานร่วมกันถูกต้อง
npm run server -- --demo   # รันเฉพาะ overlay server + ยิง event จำลอง (ทดสอบ widget ในเบราว์เซอร์)
npm run server -- 21215    # รัน overlay server บนพอร์ตที่กำหนด
```

> 💡 ถ้าพอร์ต 21213 ถูกใช้อยู่ (เช่นมี TikFinity เปิดอยู่) โปรแกรมจะ**หาพอร์ตว่างถัดไปให้อัตโนมัติ** ไม่แครช

---

## 🎬 เริ่มใช้งานเร็ว

### 1. เชื่อมต่อไลฟ์
เปิดแอป → แท็บ **ภาพรวม** → พิมพ์ `@username` ของคนที่**กำลังไลฟ์** → กด **เชื่อมต่อ**
(ถ้ายังไม่ไลฟ์จะขึ้นข้อความ "ผู้ใช้นี้ไม่ได้กำลังไลฟ์อยู่ตอนนี้")

### 2. เพิ่ม Widget ใน OBS
ไปแท็บ **Widgets (OBS)** → กด **คัดลอก** URL ของ widget ที่ต้องการ →
ใน OBS: **Sources → + → Browser** → วาง URL → ตั้งขนาดตามที่แนะนำ

| Widget | URL | ขนาดแนะนำ |
|---|---|---|
| 🔔 Alert Box | `/widgets/alerts.html` | 500 × 300 |
| 💬 Chat | `/widgets/chat.html` | 380 × 600 |
| 🎯 Goal Bar | `/widgets/goal.html` | 460 × 260 |
| 🏆 Leaderboard | `/widgets/leaderboard.html` | 340 × 400 |
| ⏱️ Timer | `/widgets/timer.html` | 360 × 140 |
| 🔊 TTS Caption | `/widgets/tts.html` | 600 × 120 |

(URL เต็มคือ `http://localhost:21213/widgets/...` — ดูพารามิเตอร์เพิ่มเติมใน [docs/WIDGETS.md](docs/WIDGETS.md))

### 3. ทดสอบโดยไม่ต้องรอไลฟ์จริง
แท็บ **ภาพรวม** → ปุ่ม **ทดสอบเหตุการณ์** (แชท/ของขวัญ/ไลค์/ติดตาม/แชร์) — จะยิง event จำลองเข้าทุก widget และ Action

---

## 🎬 ระบบ Actions (ตัวอย่าง)

ไปแท็บ **Actions → + สร้าง Action**

1. **ได้กุหลาบ → แจ้งเตือน + เสียง**
   เมื่อได้รับ `Rose` → Alert "{nickname} ส่งกุหลาบ!" + เล่นเสียง `ding.mp3`

2. **แชท `!สวัสดี` → อ่านออกเสียง**
   เมื่อแชทมี `!สวัสดี` → TTS "สวัสดีครับคุณ {nickname}"

3. **ครบ 100 ไลค์ → แจ้งเตือน**
   เมื่อครบทุกๆ `100` ไลค์ → Alert "ขอบคุณ 100 หัวใจ! ❤️"

ตัวแปรที่ใช้ใน template ได้: `{nickname} {uniqueId} {comment} {giftName} {repeatCount} {diamondCount} {diamondTotal} {likeCount}`

---

## 🔊 TTS (เสียงอ่าน)

- เปิด/ปิดการอ่านแชท ของขวัญ ผู้ติดตาม แยกกันได้
- **โหมด "อ่านในแอป" (playInApp)** — แนะนำให้เปิด เพราะ OBS Browser Source ส่วนใหญ่**ไม่รองรับ** `speechSynthesis`
  เสียงจะถูกอ่านจากตัวแอป Dashboard โดยตรง ส่วน widget `tts.html` ใช้แสดง**คำบรรยาย (caption)** บนจอ
- กรองคำต้องห้าม, จำกัดให้อ่านเฉพาะผู้ติดตาม/สมาชิก/แอดมิน

---

## ⌨️ การกดปุ่มจำลอง (Keypress) — สำหรับสั่งเกม

Action ชนิด **กดปุ่ม** ให้ TikTok LIVE คุมเกมได้ (เช่น ได้ของขวัญ → กด `space`)

> **macOS:** ต้องอนุญาตสิทธิ์ **Accessibility** ให้แอปก่อน
> `System Settings → Privacy & Security → Accessibility` → เปิดสิทธิ์ให้ Terminal/Electron/Tikkies Tools
> รองรับปุ่ม: `a-z`, `0-9`, `space`, `enter`, `tab`, `escape`, `delete`, ลูกศร, `f1-f12` + modifier `cmd/ctrl/alt/shift`

---

## 🎥 เชื่อมต่อ OBS

1. ใน OBS: **Tools → WebSocket Server Settings → Enable WebSocket server** → คัดลอกรหัสผ่าน
2. ในแอป: แท็บ **ตั้งค่า → OBS** → ใส่ `ws://127.0.0.1:4455` และรหัสผ่าน → **เชื่อมต่อ**
3. เมื่อเชื่อมแล้วจะเห็นรายชื่อ Scene และใช้ใน Action ชนิด "สั่ง OBS" ได้

---

## 🔑 Sign API Key (ไม่บังคับ)

การเชื่อม TikTok LIVE ต้องผ่าน sign server (EulerStream) ซึ่งมี rate limit สำหรับผู้ใช้ฟรี
ถ้าเชื่อมบ่อยแล้วติด limit สามารถขอ API key ฟรีที่ [eulerstream.com](https://www.eulerstream.com)
แล้วใส่ในแท็บ **ตั้งค่า → Sign API Key**

---

## 🗂️ โครงสร้างโปรเจกต์

```
Tikkies/
├── main.js                 # Electron main process
├── preload.js              # สะพาน IPC → หน้า Dashboard
├── server-standalone.js    # รัน overlay server เดี่ยว (ไม่ต้อง Electron)
├── smoke-test.js           # ทดสอบรวมโมดูล
├── data/
│   └── tiktok_gifts.json   # แคตตาล็อกของขวัญ 405 ชิ้น
├── src/
│   ├── core/               # eventBus, settings, tiktok, stats, actions, tts, obs, keypress, ...
│   ├── widgets/            # widget HTML สำหรับ OBS (+ common/widget.js)
│   └── ui/                 # หน้า Dashboard (index.html, css/, js/)
└── docs/
    ├── CONTRACT.md         # สัญญากลางระหว่างโมดูล (event/IPC/settings)
    └── WIDGETS.md          # เอกสาร widget + พารามิเตอร์
```

---

## 📦 Build & ปล่อยเวอร์ชัน (Windows .exe + auto-update)

โปรเจกต์ตั้ง **GitHub Actions** ให้ build ตัวติดตั้ง Windows แล้วขึ้น **Releases อัตโนมัติ** เมื่อ push tag เวอร์ชัน
และแอปมี **auto-update** (electron-updater) — ผู้ใช้ที่ติดตั้งไว้จะได้อัปเดตเองเมื่อมีเวอร์ชันใหม่

**ปล่อยเวอร์ชันใหม่ (ทำครั้งเดียวจบ):**
```bash
npm version patch        # bump version ใน package.json + commit + สร้าง tag ให้อัตโนมัติ (patch/minor/major)
git push --follow-tags   # ดัน commit + tag → GitHub Actions build .exe แล้วขึ้น Releases
```
เครื่องผู้ใช้ที่เปิดแอปอยู่จะเช็ค Release ใหม่ ดาวน์โหลด แล้วถามให้รีสตาร์ทเพื่อติดตั้ง

**Build เองในเครื่อง (ไม่ปล่อยขึ้น GitHub):**
```bash
npm run dist             # ได้ตัวติดตั้งใน dist/  (build Windows ต้องทำบนเครื่อง Windows หรือผ่าน CI)
```

> หมายเหตุ: ตัวติดตั้ง Windows **ไม่ได้เซ็นใบรับรอง (unsigned)** — ตอนติดตั้งครั้งแรก Windows SmartScreen อาจเตือน กด "More info → Run anyway" ได้ (auto-update ยังทำงานปกติ)

---

## 🛣️ Roadmap

- [ ] มินิเกมในแชท (สุ่มรางวัล, กงล้อเสี่ยงโชค)
- [ ] เชื่อมสั่งงาน Minecraft / เกมอื่น
- [ ] Media share / เล่นคลิปตามของขวัญ
- [ ] รองรับหลายภาษา (i18n)
- [x] แพ็กเป็นไฟล์ติดตั้ง .exe + auto-update (Windows)
- [ ] แพ็ก .dmg (macOS) + เซ็นแอป/notarize

---

## 📄 License

MIT
