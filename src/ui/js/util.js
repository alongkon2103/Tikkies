// Tikkies Tools Dashboard — utilities (โหลดก่อน app.js)
// เปิดผ่าน file:// จึงใช้ตัวแปร global แทน ES modules
window.Tk = (function () {
  var tikkies = window.tikkies; // จาก preload.js

  // เรียกคำสั่งไปยัง main process พร้อมจัดการ error เป็น toast อัตโนมัติ
  async function invoke(cmd, payload, opts) {
    try {
      return await tikkies.invoke(cmd, payload);
    } catch (err) {
      var msg = (err && err.message) ? err.message : String(err);
      if (!opts || opts.toast !== false) toast(msg, 'err');
      throw err;
    }
  }

  function onEvent(cb) { return tikkies.onEvent(cb); }

  // ---- DOM helpers ----
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function el(tag, attrs, children) {
    var e = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'class') e.className = attrs[k];
      else if (k === 'text') e.textContent = attrs[k];
      else if (k === 'html') e.innerHTML = attrs[k];
      else if (k.indexOf('on') === 0 && typeof attrs[k] === 'function') e.addEventListener(k.slice(2).toLowerCase(), attrs[k]);
      else if (attrs[k] != null) e.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) { if (c != null) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return e;
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

  function fillTemplate(tpl, data) {
    return String(tpl || '').replace(/\{(\w+)\}/g, function (_, k) { return data && data[k] != null ? data[k] : ''; });
  }

  // สีวงกลม fallback จาก id (ใช้ตอนไม่มีรูปโปรไฟล์)
  function colorFor(id) {
    var h = 0, s = String(id || '?');
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
    return 'hsl(' + h + ', 55%, 45%)';
  }

  // สร้าง element avatar (รูป หรือ วงกลมสี+อักษรแรก)
  function avatar(cls, user) {
    var a = el('div', { class: cls });
    if (user && user.profilePictureUrl) {
      a.style.backgroundImage = 'url(' + JSON.stringify(user.profilePictureUrl) + ')';
    } else {
      a.style.backgroundColor = colorFor(user && user.uniqueId);
      a.textContent = ((user && (user.nickname || user.uniqueId) || '?').trim().charAt(0) || '?');
    }
    return a;
  }

  function timeStr(ts) {
    var d = ts ? new Date(ts) : new Date();
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
  }

  // ---- Toast ----
  function toast(msg, kind, ms) {
    var host = $('#toastHost');
    var t = el('div', { class: 'toast ' + (kind || ''), text: msg });
    host.appendChild(t);
    setTimeout(function () {
      t.style.transition = 'opacity 0.3s';
      t.style.opacity = '0';
      setTimeout(function () { t.remove(); }, 300);
    }, ms || 2600);
  }

  // ---- Modal ----
  function modal(node) {
    var host = $('#modalHost');
    host.innerHTML = '';
    host.classList.remove('has-iframe'); // กันคลาสจากหน้าแต่งธีมค้างมาถึง modal ปกติ
    var box = el('div', { class: 'modal' });
    box.appendChild(node);
    host.appendChild(box);
    host.hidden = false;
    function onBg(e) { if (e.target === host) close(); }
    host.addEventListener('mousedown', onBg);
    function close() { host.hidden = true; host.innerHTML = ''; host.removeEventListener('mousedown', onBg); }
    return { close: close, box: box };
  }

  // confirm แบบ custom (แทน window.confirm ที่ Electron ไม่แนะนำ)
  function confirmDialog(message, okText) {
    return new Promise(function (resolve) {
      var m;
      var body = el('div', {}, [
        el('h2', { text: 'ยืนยัน' }),
        el('p', { class: 'muted', text: message }),
        el('div', { class: 'modal-foot' }, [
          el('button', { class: 'btn btn-ghost', text: 'ยกเลิก', onclick: function () { m.close(); resolve(false); } }),
          el('button', { class: 'btn btn-primary', text: okText || 'ตกลง', onclick: function () { m.close(); resolve(true); } })
        ])
      ]);
      m = modal(body);
    });
  }

  return {
    invoke: invoke, onEvent: onEvent,
    $: $, $$: $$, el: el, escapeHtml: escapeHtml, formatNumber: formatNumber,
    fillTemplate: fillTemplate, colorFor: colorFor, avatar: avatar, timeStr: timeStr,
    toast: toast, modal: modal, confirmDialog: confirmDialog
  };
})();
