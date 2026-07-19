// Tikkies Tools — ตัวแก้ไข Action (modal) — window.ActionsEditor.open(action, onSave)
window.ActionsEditor = (function () {
  var el, invoke, toast, modal;

  var TRIGGER_TYPES = [
    { v: 'gift', t: 'ได้รับของขวัญ' },
    { v: 'chat', t: 'มีข้อความแชท' },
    { v: 'like', t: 'ยอดไลค์ถึงเป้า' },
    { v: 'follow', t: 'มีผู้ติดตามใหม่' },
    { v: 'share', t: 'มีคนแชร์ไลฟ์' },
    { v: 'subscribe', t: 'มีสมาชิกใหม่' },
    { v: 'member', t: 'มีคนเข้าห้อง' }
  ];
  var RESP_TYPES = [
    { v: 'alert', t: 'แจ้งเตือน (Alert)' },
    { v: 'tts', t: 'อ่านออกเสียง (TTS)' },
    { v: 'sound', t: 'เล่นเสียง' },
    { v: 'keypress', t: 'กดปุ่ม (เกม/แอป)' },
    { v: 'obs', t: 'สั่ง OBS' },
    { v: 'webhook', t: 'ยิง Webhook' }
  ];
  var KEYS = ['a','b','c','d','e','f','g','h','i','j','k','l','m','n','o','p','q','r','s','t','u','v','w','x','y','z',
    '0','1','2','3','4','5','6','7','8','9','space','enter','tab','escape','delete','up','down','left','right',
    'f1','f2','f3','f4','f5','f6','f7','f8','f9','f10','f11','f12'];
  var MODS = ['cmd', 'ctrl', 'alt', 'shift'];

  var TEMPLATE_HINT = 'ตัวแปรที่ใช้ได้: {nickname} {uniqueId} {comment} {giftName} {repeatCount} {diamondCount} {diamondTotal} {likeCount} {totalLikes}';

  // ---- แปลง KeyboardEvent → whitelist ของ keypress.js ----
  var KEYCODE_MAP = { Space: 'space', Enter: 'enter', NumpadEnter: 'enter', Tab: 'tab', Backspace: 'delete', Delete: 'delete', ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
  function browserKeyToWhitelist(e) {
    var code = e.code || '';
    var m;
    if ((m = /^Key([A-Z])$/.exec(code))) return m[1].toLowerCase();
    if ((m = /^Digit([0-9])$/.exec(code))) return m[1];
    if ((m = /^Numpad([0-9])$/.exec(code))) return m[1];
    if (/^F([1-9]|1[0-2])$/.test(code)) return code.toLowerCase();
    return KEYCODE_MAP[code] || null;
  }
  function modsFromEvent(e) {
    var m = [];
    if (e.metaKey) m.push('cmd');
    if (e.ctrlKey) m.push('ctrl');
    if (e.altKey) m.push('alt');
    if (e.shiftKey) m.push('shift');
    return m;
  }
  var KEY_LABEL = { space: 'Space', enter: 'Enter', tab: 'Tab', delete: 'Delete', up: '↑', down: '↓', left: '←', right: '→' };
  var MOD_SYM = { cmd: '⌘', ctrl: '⌃', alt: '⌥', shift: '⇧' };
  function bindingLabel(key, mods) {
    if (!key) return 'ยังไม่ได้ตั้ง — คลิกแล้วกดปุ่ม';
    var parts = (mods || []).map(function (x) { return MOD_SYM[x] || x; });
    var kl = KEY_LABEL[key] || key.toUpperCase();
    return parts.join(' ') + (parts.length ? ' ' : '') + kl;
  }

  // ช่องกดบันทึกปุ่มเอง (แทน dropdown)
  function keyCaptureField(r) {
    r.modifiers = Array.isArray(r.modifiers) ? r.modifiers : [];
    var ACCESS_HINT = 'macOS: อนุญาต Accessibility ให้แอปก่อน · Windows: ปุ่มจะถูกส่งไปหน้าต่างที่กำลังโฟกัส (เปิดเกม/แอปให้อยู่หน้า)';
    var display = el('button', { type: 'button', class: 'btn keycap' });
    var hint = el('div', { class: 'hint', text: ACCESS_HINT });
    var capturing = false;
    function refresh() { display.textContent = bindingLabel(r.key, r.modifiers); }
    function onKey(e) {
      if (!capturing) return;
      e.preventDefault(); e.stopPropagation();
      if (e.key === 'Escape') { stop(); return; }
      if (['Shift', 'Control', 'Alt', 'Meta'].indexOf(e.key) >= 0) return; // ปุ่ม modifier ล้วน → รอปุ่มจริง
      var k = browserKeyToWhitelist(e);
      if (!k) {
        hint.textContent = 'ปุ่มนี้ยังไม่รองรับ — ใช้ได้: a-z, 0-9, Space, Enter, Tab, Delete, ลูกศร, F1-F12';
        hint.style.color = 'var(--err)';
        return;
      }
      r.key = k; r.modifiers = modsFromEvent(e);
      hint.textContent = ACCESS_HINT; hint.style.color = '';
      stop();
    }
    function start() {
      if (capturing) return;
      capturing = true;
      display.classList.add('capturing');
      display.textContent = 'กดปุ่มที่ต้องการ...  (Esc = ยกเลิก)';
      window.addEventListener('keydown', onKey, true);
    }
    function stop() {
      capturing = false;
      display.classList.remove('capturing');
      window.removeEventListener('keydown', onKey, true);
      refresh();
    }
    display.addEventListener('click', start);
    refresh();
    var clearBtn = el('button', { type: 'button', class: 'btn btn-ghost btn-sm', text: 'ล้าง', onclick: function () { r.key = ''; r.modifiers = []; refresh(); } });
    return field('ปุ่มที่จะกด', el('div', {}, [el('div', { class: 'keycap-row' }, [display, clearBtn]), hint]));
  }

  var giftCache = null;

  function opt(list, selected) {
    return list.map(function (o) {
      var v = o.v != null ? o.v : o;
      var t = o.t != null ? o.t : o;
      return el('option', { value: v, text: t, selected: v === selected ? 'selected' : null });
    });
  }

  function field(labelText, inputEl, hint) {
    return el('div', { class: 'field' }, [
      el('label', { text: labelText }),
      inputEl,
      hint ? el('div', { class: 'hint', text: hint }) : null
    ]);
  }

  // ---- Trigger config UI ตามชนิด ----
  function renderTriggerFields(container, trigger) {
    container.innerHTML = '';
    if (trigger.type === 'gift') {
      var giftInput = el('input', { type: 'text', list: 'giftDatalist', value: trigger.giftName || '', placeholder: 'เว้นว่าง = ของขวัญทุกชนิด' });
      var dl = el('datalist', { id: 'giftDatalist' });
      var preview = el('div', { class: 'gift-preview' });
      // แสดงรูป+ราคาของขวัญที่ตรงชื่อ
      function updatePreview() {
        preview.innerHTML = '';
        var name = giftInput.value.trim();
        if (!name) { preview.textContent = 'จะทำงานกับของขวัญทุกชนิด'; return; }
        var g = (giftCache || []).filter(function (x) { return x.name.toLowerCase() === name.toLowerCase(); })[0];
        if (g) {
          if (g.image) preview.appendChild(el('img', { src: g.image, alt: '' }));
          preview.appendChild(el('span', { text: g.name + ' · ' + g.coins + ' เพชร' }));
        } else {
          preview.textContent = 'ไม่พบชื่อนี้ในรายการ (จะเทียบชื่อแบบตรงตัว)';
        }
      }
      giftInput.addEventListener('input', function () { trigger.giftName = giftInput.value; updatePreview(); });
      loadGifts(dl).then(updatePreview);
      var minD = el('input', { type: 'number', min: '0', value: trigger.minDiamonds || 0 });
      minD.addEventListener('input', function () { trigger.minDiamonds = Number(minD.value) || 0; });
      container.appendChild(field('ชื่อของขวัญ', el('div', {}, [giftInput, dl, preview]), 'พิมพ์เพื่อค้นหาจากรายชื่อของขวัญจริง 405 ชนิด'));
      container.appendChild(field('เพชรขั้นต่ำ (diamondTotal)', minD, 'เช่น 100 = เฉพาะของขวัญที่รวมแล้ว ≥ 100 เพชร'));
    } else if (trigger.type === 'chat') {
      var kw = el('input', { type: 'text', value: trigger.keyword || '', placeholder: 'เช่น !hello (เว้นว่าง = ทุกข้อความ)' });
      kw.addEventListener('input', function () { trigger.keyword = kw.value; });
      container.appendChild(field('คำ/คำสั่งในแชท', kw, 'จับแบบมีคำนี้อยู่ในข้อความ (ไม่สนตัวพิมพ์เล็ก-ใหญ่)'));
    } else if (trigger.type === 'like') {
      var th = el('input', { type: 'number', min: '1', value: trigger.likeThreshold || 1000 });
      th.addEventListener('input', function () { trigger.likeThreshold = Number(th.value) || 0; });
      container.appendChild(field('ยิงทุกๆ กี่ไลค์ (อิงยอดรวมจริงของห้อง)', th, 'เช่น 1000 = ยิงเมื่อยอดรวมแตะ 1000, 2000, 3000 ... (เชื่อมกลางไลฟ์จะเริ่มนับจากหลักปัจจุบัน)'));
    } else {
      container.appendChild(el('p', { class: 'hint', text: 'เหตุการณ์นี้จะทำงานทุกครั้งที่เกิดขึ้น' }));
    }
  }

  async function loadGifts(datalist) {
    try {
      if (!giftCache) giftCache = await invoke('gifts:list', {}, { toast: false });
      datalist.innerHTML = '';
      (giftCache || []).slice(0, 500).forEach(function (g) {
        datalist.appendChild(el('option', { value: g.name, text: g.coins + ' เพชร' }));
      });
    } catch (e) { /* ปล่อยว่าง */ }
  }

  // ---- Response config UI ตามชนิด ----
  function renderRespFields(container, r) {
    container.innerHTML = '';
    function bind(inp, key, num) {
      inp.addEventListener('input', function () { r[key] = num ? (Number(inp.value) || 0) : inp.value; });
      return inp;
    }
    if (r.type === 'alert') {
      container.appendChild(field('ข้อความหลัก', bind(el('input', { type: 'text', value: r.text || '' }), 'text'), TEMPLATE_HINT));
      container.appendChild(field('ข้อความรอง', bind(el('input', { type: 'text', value: r.subText || '' }), 'subText')));
      container.appendChild(mediaPicker('รูป/GIF (ไม่บังคับ)', r, 'imageUrl', [{ name: 'รูป', extensions: ['png','jpg','jpeg','gif','webp'] }]));
      container.appendChild(mediaPicker('เสียง (ไม่บังคับ)', r, 'soundUrl', [{ name: 'เสียง', extensions: ['mp3','wav','ogg'] }]));
      container.appendChild(field('ระยะเวลาแสดง (วินาที)', bind(el('input', { type: 'number', min: '1', value: r.durationSec || 6 }), 'durationSec', true)));
    } else if (r.type === 'tts') {
      container.appendChild(field('ข้อความที่จะอ่าน', bind(el('input', { type: 'text', value: r.text || '' }), 'text'), TEMPLATE_HINT));
    } else if (r.type === 'sound') {
      container.appendChild(mediaPicker('ไฟล์เสียง', r, 'url', [{ name: 'เสียง', extensions: ['mp3','wav','ogg'] }]));
      container.appendChild(field('ความดัง (0-1)', bind(el('input', { type: 'number', min: '0', max: '1', step: '0.1', value: r.volume != null ? r.volume : 1 }), 'volume', true)));
    } else if (r.type === 'keypress') {
      container.appendChild(keyCaptureField(r)); // คลิกแล้วกดปุ่มจริงเพื่อบันทึก (พร้อม modifier อัตโนมัติ)
      container.appendChild(field('กดค้าง (มิลลิวินาที, 0 = แตะ)', bind(el('input', { type: 'number', min: '0', value: r.holdMs || 0 }), 'holdMs', true)));
    } else if (r.type === 'obs') {
      var actSel = el('select', {}, opt([{ v: 'setScene', t: 'เปลี่ยน Scene' }, { v: 'toggleSource', t: 'ซ่อน/แสดง Source' }], r.obsAction || 'setScene'));
      r.obsAction = r.obsAction || 'setScene';
      actSel.addEventListener('change', function () { r.obsAction = actSel.value; renderRespFields(container, r); });
      container.appendChild(field('คำสั่ง OBS', actSel));
      container.appendChild(field('ชื่อ Scene', bind(el('input', { type: 'text', value: r.scene || '' }), 'scene')));
      if (r.obsAction === 'toggleSource') {
        container.appendChild(field('ชื่อ Source', bind(el('input', { type: 'text', value: r.source || '' }), 'source')));
        var visSel = el('select', {}, opt([{ v: 'true', t: 'แสดง' }, { v: 'false', t: 'ซ่อน' }], String(r.visible !== false)));
        visSel.addEventListener('change', function () { r.visible = visSel.value === 'true'; });
        container.appendChild(field('สถานะ', visSel));
      }
    } else if (r.type === 'webhook') {
      container.appendChild(field('URL', bind(el('input', { type: 'text', value: r.url || '', placeholder: 'https://...' }), 'url')));
      var methodSel = el('select', {}, opt(['POST', 'GET', 'PUT'], r.method || 'POST'));
      methodSel.addEventListener('change', function () { r.method = methodSel.value; });
      container.appendChild(field('Method', methodSel));
      container.appendChild(field('Body (JSON, ไม่บังคับ)', bind(el('textarea', { rows: '2', value: r.body || '' }), 'body'), TEMPLATE_HINT));
    }
  }

  function mediaPicker(label, obj, key, filters) {
    var inp = el('input', { type: 'text', value: obj[key] || '', placeholder: 'วาง URL หรือกดเลือกไฟล์' });
    inp.addEventListener('input', function () { obj[key] = inp.value; });
    var btn = el('button', { class: 'btn btn-ghost btn-sm', text: 'เลือกไฟล์', type: 'button', onclick: async function () {
      var p = await invoke('app:pickFile', { filters: filters });
      if (p) { obj[key] = toFileUrl(p); inp.value = obj[key]; }
    } });
    return field(label, el('div', { class: 'url-row' }, [inp, btn]));
  }

  function toFileUrl(p) {
    if (/^https?:|^file:/.test(p)) return p;
    return 'file://' + p.split('/').map(encodeURIComponent).join('/');
  }

  // ---- Response list ----
  function renderResponses(listEl, action) {
    listEl.innerHTML = '';
    action.responses.forEach(function (r, idx) {
      var fieldsWrap = el('div', {});
      var typeSel = el('select', {}, opt(RESP_TYPES, r.type));
      typeSel.addEventListener('change', function () {
        // เปลี่ยนชนิด → เคลียร์ค่าเดิม เหลือแต่ type
        for (var k in r) if (k !== 'type') delete r[k];
        r.type = typeSel.value;
        renderRespFields(fieldsWrap, r);
      });
      var item = el('div', { class: 'resp-item' }, [
        el('div', { class: 'resp-head' }, [
          typeSel,
          el('button', { class: 'btn btn-danger btn-sm', text: 'ลบ', type: 'button', onclick: function () {
            action.responses.splice(idx, 1);
            renderResponses(listEl, action);
          } })
        ]),
        fieldsWrap
      ]);
      renderRespFields(fieldsWrap, r);
      listEl.appendChild(item);
    });
  }

  function open(existing, onSave) {
    var Tk = window.Tk;
    el = Tk.el; invoke = Tk.invoke; toast = Tk.toast; modal = Tk.modal;

    // clone เพื่อไม่แก้ของเดิมจนกว่าจะกดบันทึก
    var action = existing ? JSON.parse(JSON.stringify(existing)) : {
      id: 'a_' + Date.now().toString(36),
      name: '', enabled: true, cooldownSec: 0,
      trigger: { type: 'gift', giftName: '', minDiamonds: 0 },
      responses: [{ type: 'alert', text: '{nickname} ส่ง {giftName} x{repeatCount}!', durationSec: 6 }]
    };
    if (!Array.isArray(action.responses)) action.responses = [];

    var nameInput = el('input', { type: 'text', value: action.name || '', placeholder: 'เช่น ขอบคุณคนให้กุหลาบ' });
    var typeSel = el('select', {}, opt(TRIGGER_TYPES, action.trigger.type));
    var triggerFields = el('div', {});
    typeSel.addEventListener('change', function () {
      action.trigger = { type: typeSel.value };
      renderTriggerFields(triggerFields, action.trigger);
    });
    renderTriggerFields(triggerFields, action.trigger);

    var cooldown = el('input', { type: 'number', min: '0', value: action.cooldownSec || 0 });
    var respList = el('div', {});
    renderResponses(respList, action);

    var m;
    var body = el('div', {}, [
      el('h2', { text: existing ? 'แก้ไข Action' : 'สร้าง Action ใหม่' }),
      field('ชื่อ Action', nameInput),
      field('เมื่อเกิดเหตุการณ์', typeSel),
      triggerFields,
      field('หน่วงเวลา (คูลดาวน์ วินาที)', cooldown, 'กันการยิงถี่เกินไป'),
      el('div', { class: 'card-title', text: 'สิ่งที่จะทำ (Responses)' }),
      respList,
      el('button', { class: 'btn btn-ghost btn-sm', text: '+ เพิ่มการกระทำ', type: 'button', onclick: function () {
        action.responses.push({ type: 'alert', text: '', durationSec: 6 });
        renderResponses(respList, action);
      } }),
      el('div', { class: 'modal-foot' }, [
        el('button', { class: 'btn btn-ghost', text: 'ยกเลิก', type: 'button', onclick: function () { m.close(); } }),
        el('button', { class: 'btn btn-primary', text: 'บันทึก', type: 'button', onclick: function () {
          action.name = nameInput.value.trim() || 'Action ไม่มีชื่อ';
          action.cooldownSec = Number(cooldown.value) || 0;
          if (!action.responses.length) { toast('ต้องมีอย่างน้อย 1 การกระทำ', 'err'); return; }
          m.close();
          onSave(action);
        } })
      ])
    ]);
    m = modal(body);
  }

  return { open: open };
})();
