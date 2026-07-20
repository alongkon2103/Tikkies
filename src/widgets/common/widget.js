// Helper กลางของทุก widget — เชื่อม WebSocket กลับไปหา Tikkies Tools พร้อม auto-reconnect
// ใช้งาน:
//   TikkiesWidget.connect({
//     onEvent(event, data) {},      // ทุก event: chat, gift, like, ..., snapshot
//     onOpen() {}, onClose() {}
//   });
(function () {
  const params = new URLSearchParams(location.search);

  function wsUrl() {
    // widget ถูกเสิร์ฟจากเซิร์ฟเวอร์เดียวกับ WS; รองรับ ?host= / ?port= เผื่อเปิดจากไฟล์ตรงๆ
    const host = params.get('host') || location.hostname || 'localhost';
    const port = params.get('port') || location.port || 21213;
    return `ws://${host}:${port}`;
  }

  // ---- โหมดตัวอย่าง (?preview=1) — หน้าแต่งธีมในแอปใช้ ----
  // ป้อน event จำลองให้ widget ตัวเองแบบ local ล้วนๆ (ไม่ยิงผ่าน server → ไม่เด้งบน OBS จริง)
  function startPreview(onEvent) {
    var AV = ''; // ไม่มีรูป — widget จะ fallback เป็นตัวอักษร/อิโมจิเอง
    var seedEvents = [
      ['goals', {
        likes: { enabled: true, target: 1000, label: 'เป้าหมายหัวใจ', current: 683 },
        diamonds: { enabled: true, target: 500, label: 'เป้าหมายเพชร', current: 214 },
        followers: { enabled: false, target: 50, label: 'ผู้ติดตามใหม่', current: 12 }
      }],
      ['leaderboard', { top: [
        { uniqueId: 'vip1', nickname: 'สายเปย์ตัวจริง', profilePictureUrl: AV, diamonds: 899, gifts: 25 },
        { uniqueId: 'vip2', nickname: 'NoBoss', profilePictureUrl: AV, diamonds: 350, gifts: 12 },
        { uniqueId: 'vip3', nickname: 'ใข่มุก', profilePictureUrl: AV, diamonds: 120, gifts: 6 }
      ] }],
      ['timer', { running: true, remainingSec: 5025, totalAddedSec: 340, label: 'Subathon Timer', enabled: true }],
      ['roomStats', { viewerCount: 156, topViewers: [] }]
    ];
    var loop = [
      ['chat', { nickname: 'สมชายใจดี', uniqueId: 'user_somchai', profilePictureUrl: AV, comment: 'สวัสดีครับ ทดสอบธีมอยู่ 🎉', followRole: 1, isModerator: false, isSubscriber: false }],
      ['gift', { nickname: 'สายเปย์ตัวจริง', uniqueId: 'vip1', profilePictureUrl: AV, giftName: 'Rose', giftPictureUrl: '', repeatCount: 3, diamondCount: 1, diamondTotal: 3, repeatEnd: true, streakable: true }],
      ['tts', { id: 'p1', text: 'ขอบคุณสมชายใจดีสำหรับกุหลาบครับ' }],
      ['chat', { nickname: 'แฟนคลับ', uniqueId: 'fan01', profilePictureUrl: AV, comment: 'สีสวยมากก 😍', followRole: 0, isModerator: false, isSubscriber: false }],
      ['follow', { nickname: 'แฟนคลับ', uniqueId: 'fan01', profilePictureUrl: AV }],
      ['gift', { nickname: 'NoBoss', uniqueId: 'vip2', profilePictureUrl: AV, giftName: 'Galaxy', giftPictureUrl: '', repeatCount: 1, diamondCount: 1000, diamondTotal: 1000, repeatEnd: true, streakable: false }],
      ['like', { nickname: 'ผู้ชม', uniqueId: 'viewer1', likeCount: 15, totalLikeCount: 683 }]
    ];
    var wheelSample = ['wheelSpin', {
      spinId: 'pv', winnerIndex: 1, label: 'รางวัลใหญ่!', durationSec: 5, resultHoldSec: 3,
      title: 'สุ่มรางวัล', segments: [{ label: '+5' }, { label: 'รางวัลใหญ่!' }, { label: '-5' }, { label: 'หมุนอีกครั้ง' }]
    }];
    function fire(ev) { try { onEvent(ev[0], JSON.parse(JSON.stringify(ev[1]))); } catch (_) {} }
    setTimeout(function () {
      seedEvents.forEach(fire);
      var i = 0;
      setInterval(function () { fire(loop[i % loop.length]); i += 1; }, 3200);
      fire(wheelSample);
      setInterval(function () { fire(wheelSample); }, 12000);
    }, 600);
  }

  function connect(handlers) {
    let retry = 0;
    let ws;
    if (params.get('preview') === '1' && handlers.onEvent) startPreview(handlers.onEvent);
    function open() {
      ws = new WebSocket(wsUrl());
      ws.onopen = () => {
        retry = 0;
        handlers.onOpen && handlers.onOpen();
      };
      ws.onmessage = e => {
        try {
          const { event, data } = JSON.parse(e.data);
          handlers.onEvent && handlers.onEvent(event, data);
        } catch (_) { /* ข้าม frame ที่ไม่ใช่ JSON */ }
      };
      ws.onclose = () => {
        handlers.onClose && handlers.onClose();
        retry += 1;
        setTimeout(open, Math.min(10000, 500 * retry));
      };
      ws.onerror = () => ws.close();
    }
    open();
    return {
      send(obj) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj)); }
    };
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function formatNumber(n) {
    n = Number(n) || 0;
    if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
    return String(n);
  }

  // template อย่างง่าย: แทนที่ {key} ด้วยค่าใน data
  function fillTemplate(tpl, data) {
    return String(tpl || '').replace(/\{(\w+)\}/g, (_, k) => (data && data[k] != null ? data[k] : ''));
  }

  window.TikkiesWidget = { connect, escapeHtml, formatNumber, fillTemplate, params };
})();
