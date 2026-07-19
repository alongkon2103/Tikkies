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

  function connect(handlers) {
    let retry = 0;
    let ws;
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
