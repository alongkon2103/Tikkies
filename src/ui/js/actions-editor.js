// Tikkies Tools — ตัวแก้ไข Action (modal) — window.ActionsEditor.open(action, onSave)
window.ActionsEditor = (function () {
  var el, invoke, toast, modal;

  var TRIGGER_TYPES = [
    { v: 'gift', t: 'ของขวัญ', icon: 'gift', desc: 'ได้รับของขวัญ' },
    { v: 'chat', t: 'แชท', icon: 'chat', desc: 'มีข้อความแชท' },
    { v: 'like', t: 'ไลค์', icon: 'heart', desc: 'ยอดไลค์ถึงเป้า' },
    { v: 'follow', t: 'ติดตาม', icon: 'follow', desc: 'มีผู้ติดตามใหม่' },
    { v: 'share', t: 'แชร์', icon: 'share', desc: 'มีคนแชร์ไลฟ์' },
    { v: 'subscribe', t: 'สมาชิก', icon: 'star', desc: 'มีสมาชิกใหม่' },
    { v: 'member', t: 'เข้าห้อง', icon: 'member', desc: 'มีคนเข้าห้อง' },
    { v: 'hotkey', t: 'คีย์ลัด', icon: 'keyboard', desc: 'กดคีย์จากคีย์บอร์ด' },
    { v: 'wheelResult', t: 'สุ่มรางวัลออก', icon: 'sparkles', desc: 'Roulette ได้ผล' }
  ];
  var RESP_TYPES = [
    { v: 'alert', t: 'แจ้งเตือน', icon: 'bell', desc: 'ป๊อปอัปบน overlay' },
    { v: 'tts', t: 'อ่านออกเสียง', icon: 'tts', desc: 'TTS พูดข้อความ' },
    { v: 'sound', t: 'เล่นเสียง', icon: 'music', desc: 'เปิดไฟล์เสียง' },
    { v: 'keypress', t: 'กดปุ่ม', icon: 'keyboard', desc: 'ส่งปุ่มเข้าเกม/แอป' },
    { v: 'obs', t: 'สั่ง OBS', icon: 'video', desc: 'เปลี่ยนซีน/ซ่อนแหล่ง' },
    { v: 'webhook', t: 'Webhook', icon: 'webhook', desc: 'ยิง HTTP request' },
    { v: 'wheel', t: 'สุ่มรางวัล', icon: 'sparkles', desc: 'Roulette บน widget' },
    { v: 'timer', t: 'Subathon Timer', icon: 'timer', desc: 'เพิ่ม/ลดเวลา หรือสั่งจับเวลา' }
  ];
  function respMeta(type) {
    return RESP_TYPES.filter(function (x) { return x.v === type; })[0] || { t: type, icon: 'info', desc: '' };
  }
  var KEYS = ['a','b','c','d','e','f','g','h','i','j','k','l','m','n','o','p','q','r','s','t','u','v','w','x','y','z',
    '0','1','2','3','4','5','6','7','8','9','space','enter','tab','escape','delete','up','down','left','right',
    'f1','f2','f3','f4','f5','f6','f7','f8','f9','f10','f11','f12'];
  var MODS = ['cmd', 'ctrl', 'alt', 'shift'];

  // ---- ตัวแปร template แบบชิปคลิกแทรก (แทน hint ยาวๆ ที่ผู้ใช้ต้องพิมพ์เอง) ----
  // each: v = ชื่อตัวแปร, t = ป้ายไทยที่ผู้ใช้เข้าใจ, for = จำกัดเฉพาะเหตุการณ์ (ไม่มี = ใช้ได้ทุกเหตุการณ์)
  var TEMPLATE_VARS = [
    // not = ไม่โชว์กับเหตุการณ์เหล่านี้ (เหตุการณ์ระบบ ไม่มีข้อมูลผู้ชม)
    { v: 'nickname', t: 'ชื่อผู้ชม', not: ['hotkey', 'wheelResult'] },
    { v: 'uniqueId', t: '@username', not: ['hotkey', 'wheelResult'] },
    { v: 'comment', t: 'ข้อความแชท', for: ['chat'] },
    { v: 'giftName', t: 'ชื่อของขวัญ', for: ['gift'] },
    { v: 'repeatCount', t: 'จำนวนคอมโบ', for: ['gift'] },
    { v: 'diamondCount', t: 'เพชร/ชิ้น', for: ['gift'] },
    { v: 'diamondTotal', t: 'เพชรรวม', for: ['gift'] },
    { v: 'likeCount', t: 'ไลค์หลักที่ถึง', for: ['like'] },
    { v: 'totalLikes', t: 'ไลค์รวมทั้งห้อง', for: ['like'] },
    { v: 'prize', t: 'รางวัลที่สุ่มได้', for: ['wheelResult'] }
  ];
  var curTriggerType = ''; // ชนิด trigger ปัจจุบันของ modal ที่เปิดอยู่ — ใช้กรองชิปตัวแปร

  // แถวชิปตัวแปร: คลิก = แทรกที่ตำแหน่ง cursor ของ input แล้วยิง event 'input' ให้ binding อัปเดตเอง
  function varChips(inputEl) {
    var vars = TEMPLATE_VARS.filter(function (x) {
      if (x.not && x.not.indexOf(curTriggerType) >= 0) return false;
      return !x.for || x.for.indexOf(curTriggerType) >= 0;
    });
    if (!vars.length) return el('div', {}); // เหตุการณ์นี้ไม่มีตัวแปรให้แทรก
    var row = el('div', { class: 'var-chips' },
      [el('span', { class: 'var-chips-label', text: 'แทรก:' })].concat(vars.map(function (x) {
        return el('button', { type: 'button', class: 'var-chip', title: '{' + x.v + '} — ' + x.t, onclick: function () {
          var token = '{' + x.v + '}';
          var start = inputEl.selectionStart != null ? inputEl.selectionStart : inputEl.value.length;
          var end = inputEl.selectionEnd != null ? inputEl.selectionEnd : start;
          inputEl.value = inputEl.value.slice(0, start) + token + inputEl.value.slice(end);
          var pos = start + token.length;
          inputEl.focus();
          try { inputEl.setSelectionRange(pos, pos); } catch (_) {}
          inputEl.dispatchEvent(new Event('input', { bubbles: true }));
        } }, [el('span', { class: 'var-chip-t', text: x.t })]);
      })));
    return row;
  }

  // field ข้อความ + ชิปตัวแปรใต้ช่อง
  function templateField(label, inputEl) {
    return el('div', { class: 'field' }, [
      el('label', { text: label }),
      inputEl,
      varChips(inputEl)
    ]);
  }

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

  // ---- ช่องจับคีย์ลัด global (Electron accelerator เช่น 'F6', 'Control+Shift+A') ----
  var IS_MAC = /Mac/i.test(navigator.platform || '');
  function eventToAccelerator(e) {
    var mods = [];
    // ปุ่ม meta: macOS = Command, Windows = ปุ่ม Win (Electron เรียก 'Super')
    if (e.metaKey) mods.push(IS_MAC ? 'Command' : 'Super');
    if (e.ctrlKey) mods.push('Control');
    if (e.altKey) mods.push('Alt');
    if (e.shiftKey) mods.push('Shift');
    var code = e.code || '', key = null, m;
    if ((m = /^Key([A-Z])$/.exec(code))) key = m[1];
    else if ((m = /^Digit([0-9])$/.exec(code))) key = m[1];
    else if ((m = /^Numpad([0-9])$/.exec(code))) key = 'num' + m[1];
    else if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) key = code;
    else {
      var MAP = { Space: 'Space', Enter: 'Enter', Tab: 'Tab', Backspace: 'Backspace', Delete: 'Delete',
        ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
        Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown',
        Minus: '-', Equal: '=', Comma: ',', Period: '.', Slash: '/', Backquote: '`',
        BracketLeft: '[', BracketRight: ']', Semicolon: ';', Quote: "'" };
      key = MAP[code] || null;
    }
    if (!key) return null;
    return mods.concat([key]).join('+');
  }

  function acceleratorField(trigger) {
    var capBtn = el('button', { type: 'button', class: 'btn keycap', text: trigger.accelerator || 'คลิกแล้วกดคีย์ที่ต้องการ' });
    var capturing = false;
    function onKey(e) {
      if (!capturing) return;
      e.preventDefault(); e.stopPropagation();
      if (e.key === 'Escape') { stop(); return; }
      if (['Shift', 'Control', 'Alt', 'Meta'].indexOf(e.key) >= 0) return; // รอปุ่มจริง
      var acc = eventToAccelerator(e);
      if (!acc) return;
      trigger.accelerator = acc;
      stop();
    }
    function stop() {
      capturing = false;
      capBtn.classList.remove('capturing');
      capBtn.textContent = trigger.accelerator || 'คลิกแล้วกดคีย์ที่ต้องการ';
      window.removeEventListener('keydown', onKey, true);
    }
    capBtn.addEventListener('click', function () {
      if (capturing) return;
      capturing = true;
      capBtn.classList.add('capturing');
      capBtn.textContent = 'กดคีย์ที่ต้องการ... (Esc = ยกเลิก)';
      window.addEventListener('keydown', onKey, true);
    });
    return field('คีย์ลัด (ทำงานแบบ global — กดจากโปรแกรมไหนก็ได้)', el('div', {}, [capBtn]),
      'แนะนำ F-key (F6, F7, ...) หรือคีย์ร่วมกับ Ctrl/Cmd/Alt — คีย์เดี่ยวธรรมดา (เช่น A) จะไปบล็อคการพิมพ์ทั้งเครื่อง');
  }

  // ---- เลือกรางวัลสำหรับ trigger 'wheelResult' — dropdown จากรายการรางวัลจริง ----
  function prizeField(trigger) {
    var sel = el('select', {}, [el('option', { value: '', text: 'รางวัลอะไรก็ได้ (ทุกช่อง)' })]);
    sel.addEventListener('change', function () { trigger.prize = sel.value; });
    invoke('settings:get', {}, { toast: false }).then(function (s) {
      var segs = (s && s.wheel && s.wheel.segments) || [];
      segs.forEach(function (seg) {
        if (!seg || !seg.label) return;
        sel.appendChild(el('option', { value: seg.label, text: seg.label, selected: seg.label === trigger.prize ? 'selected' : null }));
      });
      // รางวัลที่ตั้งไว้แต่ถูกลบออกจากรายการแล้ว — ยังโชว์ให้เห็น
      if (trigger.prize && !segs.some(function (x) { return x && x.label === trigger.prize; })) {
        sel.appendChild(el('option', { value: trigger.prize, text: trigger.prize + ' (ไม่อยู่ในรายการแล้ว)', selected: 'selected' }));
      }
    });
    return field('เมื่อสุ่มได้รางวัล', sel, 'ตั้งรายการรางวัลได้ในแท็บ "สุ่มรางวัล" — ใช้ตัวแปร {prize} ในข้อความได้');
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
      container.appendChild(giftAutocomplete(trigger));
      var minD = el('input', { type: 'number', min: '0', value: trigger.minDiamonds || 0 });
      minD.addEventListener('input', function () { trigger.minDiamonds = Number(minD.value) || 0; });
      container.appendChild(field('เพชรขั้นต่ำ (diamondTotal)', minD, 'เช่น 100 = เฉพาะของขวัญที่รวมแล้ว ≥ 100 เพชร'));
    } else if (trigger.type === 'chat') {
      var kw = el('input', { type: 'text', value: trigger.keyword || '', placeholder: 'เช่น !hello (เว้นว่าง = ทุกข้อความ)' });
      kw.addEventListener('input', function () { trigger.keyword = kw.value; });
      container.appendChild(field('คำ/คำสั่งในแชท', kw, 'จับแบบมีคำนี้อยู่ในข้อความ (ไม่สนตัวพิมพ์เล็ก-ใหญ่)'));
    } else if (trigger.type === 'like') {
      var th = el('input', { type: 'number', min: '1', value: trigger.likeThreshold || 1000 });
      th.addEventListener('input', function () { trigger.likeThreshold = Number(th.value) || 0; });
      container.appendChild(field('ยิงทุกๆ กี่ไลค์ (อิงยอดรวมจริงของห้อง)', th, 'เช่น 1000 = ยิงเมื่อยอดรวมแตะ 1000, 2000, 3000 ... (เชื่อมกลางไลฟ์จะเริ่มนับจากหลักปัจจุบัน)'));
    } else if (trigger.type === 'hotkey') {
      container.appendChild(acceleratorField(trigger));
    } else if (trigger.type === 'wheelResult') {
      container.appendChild(prizeField(trigger));
    } else {
      container.appendChild(el('p', { class: 'hint', text: 'เหตุการณ์นี้จะทำงานทุกครั้งที่เกิดขึ้น' }));
    }
  }

  async function loadGifts() {
    try {
      if (!giftCache) giftCache = await invoke('gifts:list', {}, { toast: false });
    } catch (e) { /* ปล่อยว่าง */ }
    return giftCache || [];
  }

  // ---- ตัวเลือกของขวัญแบบ modal เต็มจอ — ครบทุกชิ้น + ช่องค้นหา กดเลือกได้เลย ----
  // (แยกชั้นจาก Tk.modal เพราะ modalHost มีช่องเดียว เปิดซ้อนจะทับตัว editor)
  function openGiftPicker(currentName, onPick) {
    var overlay = el('div', { class: 'gift-pick-overlay' });
    function close() {
      window.removeEventListener('keydown', onEsc, true);
      overlay.remove();
    }
    function onEsc(e) { if (e.key === 'Escape') { e.stopPropagation(); close(); } }
    window.addEventListener('keydown', onEsc, true);
    overlay.addEventListener('mousedown', function (e) { if (e.target === overlay) close(); });

    var search = el('input', { type: 'text', placeholder: 'ค้นหาของขวัญ... เช่น rose', autocomplete: 'off' });
    var grid = el('div', { class: 'gift-grid' });
    var count = el('span', { class: 'gift-pick-count' });

    function pick(name) { close(); onPick(name); }

    function renderGrid() {
      var q = search.value.trim().toLowerCase();
      var gifts = (giftCache || []).filter(function (g) { return !q || g.name.toLowerCase().indexOf(q) >= 0; });
      gifts = gifts.slice().sort(function (a, b) { return a.coins - b.coins; });
      grid.innerHTML = '';
      count.textContent = gifts.length + ' ชิ้น';

      // ตัวเลือก "ทุกชนิด" อยู่หัวเสมอ (ตอนไม่ได้ค้นหา)
      if (!q) {
        var anyCell = el('button', { type: 'button', class: 'gift-cell any' + (!currentName ? ' active' : '') }, [
          el('div', { class: 'gift-cell-img', text: '🎁' }),
          el('div', { class: 'gift-cell-name', text: 'ทุกชนิด' }),
          el('div', { class: 'gift-cell-coins', text: 'ของขวัญอะไรก็ได้' })
        ]);
        anyCell.addEventListener('click', function () { pick(''); });
        grid.appendChild(anyCell);
      }
      if (!gifts.length && q) {
        grid.appendChild(el('div', { class: 'gift-grid-empty', text: 'ไม่พบของขวัญชื่อ "' + q + '"' }));
      }
      gifts.forEach(function (g) {
        var cell = el('button', { type: 'button', class: 'gift-cell' + (g.name === currentName ? ' active' : '') }, [
          g.image
            ? el('img', { class: 'gift-cell-img', src: g.image, alt: '', loading: 'lazy' })
            : el('div', { class: 'gift-cell-img', text: '🎁' }),
          el('div', { class: 'gift-cell-name', text: g.name }),
          el('div', { class: 'gift-cell-coins', text: g.coins + ' 💎' })
        ]);
        cell.addEventListener('click', function () { pick(g.name); });
        grid.appendChild(cell);
      });
    }
    search.addEventListener('input', renderGrid);

    overlay.appendChild(el('div', { class: 'gift-pick-modal' }, [
      el('div', { class: 'gift-pick-head' }, [
        el('h2', { text: 'เลือกของขวัญ' }),
        count,
        el('button', { type: 'button', class: 'btn btn-ghost btn-sm', text: '✕ ปิด', onclick: close })
      ]),
      search,
      grid
    ]));
    document.body.appendChild(overlay);
    search.focus();
    loadGifts().then(renderGrid);
  }

  // field ของ trigger gift: โชว์ของขวัญที่เลือกอยู่ + ปุ่มเปิด modal เลือก
  function giftAutocomplete(trigger) {
    var display = el('button', { type: 'button', class: 'gift-select' });
    function refresh() {
      display.innerHTML = '';
      var name = (trigger.giftName || '').trim();
      var g = name ? (giftCache || []).filter(function (x) { return x.name.toLowerCase() === name.toLowerCase(); })[0] : null;
      if (!name) {
        display.appendChild(el('span', { class: 'gift-select-emoji', text: '🎁' }));
        display.appendChild(el('span', { class: 'gift-select-name', text: 'ของขวัญทุกชนิด' }));
      } else {
        if (g && g.image) display.appendChild(el('img', { src: g.image, alt: '' }));
        else display.appendChild(el('span', { class: 'gift-select-emoji', text: '🎁' }));
        display.appendChild(el('span', { class: 'gift-select-name', text: name }));
        if (g) display.appendChild(el('span', { class: 'gift-select-coins', text: g.coins + ' 💎' }));
      }
      display.appendChild(el('span', { class: 'gift-select-cta', text: 'เปลี่ยน' }));
    }
    display.addEventListener('click', function () {
      openGiftPicker((trigger.giftName || '').trim(), function (name) {
        trigger.giftName = name;
        refresh();
      });
    });
    loadGifts().then(refresh);
    refresh();
    return field('ของขวัญที่จะจับ', display, 'กดเพื่อเปิดหน้าเลือกของขวัญทั้งหมด 405 ชนิด (มีรูป+ราคา ค้นหาได้)');
  }

  // ---- Response config UI ตามชนิด ----
  function renderRespFields(container, r) {
    container.innerHTML = '';
    function bind(inp, key, num) {
      inp.addEventListener('input', function () { r[key] = num ? (Number(inp.value) || 0) : inp.value; });
      return inp;
    }
    if (r.type === 'alert') {
      container.appendChild(templateField('ข้อความหลัก', bind(el('input', { type: 'text', value: r.text || '' }), 'text')));
      container.appendChild(templateField('ข้อความรอง', bind(el('input', { type: 'text', value: r.subText || '' }), 'subText')));
      container.appendChild(mediaPicker('รูป/GIF (ไม่บังคับ)', r, 'imageUrl', [{ name: 'รูป', extensions: ['png','jpg','jpeg','gif','webp'] }]));
      container.appendChild(mediaPicker('เสียง (ไม่บังคับ)', r, 'soundUrl', [{ name: 'เสียง', extensions: ['mp3','wav','ogg'] }]));
      container.appendChild(field('ระยะเวลาแสดง (วินาที)', bind(el('input', { type: 'number', min: '1', value: r.durationSec || 6 }), 'durationSec', true)));
    } else if (r.type === 'tts') {
      container.appendChild(templateField('ข้อความที่จะอ่าน', bind(el('input', { type: 'text', value: r.text || '' }), 'text')));
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
    } else if (r.type === 'timer') {
      var tcSel = el('select', {}, opt([
        { v: 'add', t: 'เพิ่ม/ลดเวลา (วินาที)' },
        { v: 'start', t: 'เริ่มจับเวลา' },
        { v: 'pause', t: 'พักจับเวลา' },
        { v: 'reset', t: 'รีเซ็ตกลับเวลาเริ่มต้น' }
      ], r.timerCmd || 'add'));
      r.timerCmd = r.timerCmd || 'add';
      tcSel.addEventListener('change', function () { r.timerCmd = tcSel.value; renderRespFields(container, r); });
      container.appendChild(field('คำสั่ง Timer', tcSel, 'ตั้งค่า Subathon Timer ได้ในแท็บ "เป้าหมาย & Timer"'));
      if ((r.timerCmd || 'add') === 'add') {
        container.appendChild(field('วินาที (ติดลบ = หักเวลา)',
          bind(el('input', { type: 'number', step: '1', value: r.seconds != null ? r.seconds : 60 }), 'seconds', true),
          'เช่น 30 = +30 วิ · -60 = หัก 1 นาที'));
      }
    } else if (r.type === 'wheel') {
      container.appendChild(el('p', { class: 'hint', text: 'จะสุ่มรางวัลตามรายการที่ตั้งไว้ในแท็บ "สุ่มรางวัล" — ผลแสดงบน widget Roulette ใน OBS' }));
    } else if (r.type === 'webhook') {
      container.appendChild(field('URL', bind(el('input', { type: 'text', value: r.url || '', placeholder: 'https://...' }), 'url')));
      var methodSel = el('select', {}, opt(['POST', 'GET', 'PUT'], r.method || 'POST'));
      methodSel.addEventListener('change', function () { r.method = methodSel.value; });
      container.appendChild(field('Method', methodSel));
      container.appendChild(templateField('Body (JSON, ไม่บังคับ)', bind(el('textarea', { rows: '2', value: r.body || '' }), 'body')));
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

  // ---- ค่าเริ่มต้นของ response แต่ละชนิดตอนเพิ่มใหม่ ----
  // ข้อความตัวอย่างตามเหตุการณ์ — ให้ default สมเหตุสมผลกับ trigger ที่เลือกอยู่
  function sampleText(kind) {
    switch (curTriggerType) {
      case 'gift': return kind === 'alert' ? '{nickname} ส่ง {giftName} x{repeatCount}!' : 'ขอบคุณ {nickname} สำหรับ {giftName}';
      case 'chat': return kind === 'alert' ? '{nickname}: {comment}' : '{nickname} บอกว่า {comment}';
      case 'like': return kind === 'alert' ? 'ไลค์ทะลุ {likeCount} แล้ว!' : 'ไลค์ครบ {likeCount} แล้วจ้า';
      case 'follow': return kind === 'alert' ? '{nickname} กดติดตามแล้ว!' : 'ขอบคุณ {nickname} ที่ติดตาม';
      case 'share': return kind === 'alert' ? '{nickname} แชร์ไลฟ์!' : 'ขอบคุณ {nickname} ที่ช่วยแชร์';
      case 'subscribe': return kind === 'alert' ? '{nickname} สมัครสมาชิก!' : 'ขอบคุณสมาชิกใหม่ {nickname}';
      case 'member': return kind === 'alert' ? 'ต้อนรับ {nickname} เข้าห้อง' : 'สวัสดี {nickname}';
      case 'hotkey': return kind === 'alert' ? 'ทำงานแล้ว!' : 'ทำงานแล้ว';
      case 'wheelResult': return kind === 'alert' ? 'ได้รางวัล: {prize}!' : 'สุ่มได้ {prize}';
      default: return 'ขอบคุณ {nickname}';
    }
  }

  function newResponse(type) {
    switch (type) {
      case 'alert': return { type: 'alert', text: sampleText('alert'), durationSec: 6 };
      case 'tts': return { type: 'tts', text: sampleText('tts') };
      case 'sound': return { type: 'sound', url: '', volume: 1 };
      case 'keypress': return { type: 'keypress', key: '', modifiers: [], holdMs: 0 };
      case 'obs': return { type: 'obs', obsAction: 'setScene', scene: '' };
      case 'wheel': return { type: 'wheel' };
      case 'timer': return { type: 'timer', timerCmd: 'add', seconds: 60 };
      case 'webhook': return { type: 'webhook', url: '', method: 'POST' };
      default: return { type: type };
    }
  }

  // ---- Response list — การ์ดหัวไอคอน+ชื่อชนิด (เลือกชนิดตอนกดเพิ่ม ไม่ใช่ dropdown) ----
  function renderResponses(listEl, action) {
    listEl.innerHTML = '';
    if (!action.responses.length) {
      listEl.appendChild(el('div', { class: 'resp-empty', text: 'ยังไม่มีการกระทำ — เลือกจากปุ่มด้านล่างได้เลย' }));
    }
    action.responses.forEach(function (r, idx) {
      var meta = respMeta(r.type);
      var fieldsWrap = el('div', {});
      var item = el('div', { class: 'resp-item' }, [
        el('div', { class: 'resp-head' }, [
          el('div', { class: 'resp-title' }, [
            el('span', { class: 'resp-ico' }, [window.Icon.el(meta.icon, 14)]),
            el('span', { text: meta.t }),
            el('span', { class: 'resp-desc', text: meta.desc })
          ]),
          el('button', { class: 'btn btn-danger btn-sm icon-btn', type: 'button', title: 'ลบการกระทำนี้', onclick: function () {
            action.responses.splice(idx, 1);
            renderResponses(listEl, action);
          } }, [window.Icon.el('trash', 13)])
        ]),
        fieldsWrap
      ]);
      renderRespFields(fieldsWrap, r);
      listEl.appendChild(item);
    });
  }

  // แถวปุ่ม "เพิ่มการกระทำ" แยกตามชนิด — เห็นตัวเลือกทั้งหมดในคลิกเดียว
  function addRespBar(action, respList) {
    return el('div', { class: 'resp-add-bar' }, RESP_TYPES.map(function (t) {
      return el('button', { class: 'resp-add-chip', type: 'button', title: t.desc, onclick: function () {
        action.responses.push(newResponse(t.v));
        renderResponses(respList, action);
        // เลื่อนให้เห็นการ์ดใหม่ทันที
        var items = respList.querySelectorAll('.resp-item');
        if (items.length) items[items.length - 1].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      } }, [window.Icon.el(t.icon, 14), el('span', { text: t.t })]);
    }));
  }

  // ตัวเลือกเหตุการณ์แบบการ์ด (แทน dropdown) — เห็นครบ เลือกไว
  function triggerPicker(action, triggerFields, onPick) {
    var wrap = el('div', { class: 'trig-grid' });
    function refresh() {
      wrap.querySelectorAll('.trig-chip').forEach(function (c) {
        c.classList.toggle('active', c.dataset.v === action.trigger.type);
      });
    }
    TRIGGER_TYPES.forEach(function (t) {
      var chip = el('button', { class: 'trig-chip', type: 'button' }, [
        window.Icon.el(t.icon, 16),
        el('span', { class: 'trig-t', text: t.t }),
        el('span', { class: 'trig-d', text: t.desc })
      ]);
      chip.dataset.v = t.v;
      chip.addEventListener('click', function () {
        if (action.trigger.type === t.v) return;
        action.trigger = { type: t.v };
        refresh();
        renderTriggerFields(triggerFields, action.trigger);
        if (onPick) onPick(t);
      });
      wrap.appendChild(chip);
    });
    refresh();
    return wrap;
  }

  function sectionHead(num, title, hint) {
    return el('div', { class: 'ed-section-head' }, [
      el('span', { class: 'ed-step', text: num }),
      el('span', { class: 'ed-title', text: title }),
      hint ? el('span', { class: 'ed-hint', text: hint }) : null
    ]);
  }

  function open(existing, onSave) {
    var Tk = window.Tk;
    el = Tk.el; invoke = Tk.invoke; toast = Tk.toast; modal = Tk.modal;

    // clone เพื่อไม่แก้ของเดิมจนกว่าจะกดบันทึก
    var action = existing ? JSON.parse(JSON.stringify(existing)) : {
      id: 'a_' + Date.now().toString(36),
      name: '', enabled: true, cooldownSec: 0,
      trigger: { type: 'gift', giftName: '', minDiamonds: 0 },
      responses: [] // เริ่มว่าง — ให้ผู้ใช้เลือกการกระทำเองจากปุ่มด้านล่าง (ไม่ auto ใส่แจ้งเตือน)
    };
    if (!Array.isArray(action.responses)) action.responses = [];
    curTriggerType = action.trigger.type; // ให้ชิปตัวแปรกรองตามเหตุการณ์ปัจจุบัน

    var nameInput = el('input', { type: 'text', value: action.name || '', placeholder: 'ตั้งชื่อให้จำง่าย เช่น ขอบคุณคนให้กุหลาบ' });
    var triggerFields = el('div', { class: 'trig-fields' });
    renderTriggerFields(triggerFields, action.trigger);

    var cooldown = el('input', { type: 'number', min: '0', value: action.cooldownSec || 0 });
    var respList = el('div', {});
    renderResponses(respList, action);

    var m;
    var body = el('div', { class: 'action-editor' }, [
      el('div', { class: 'ed-head' }, [
        el('h2', { text: existing ? 'แก้ไข Action' : 'สร้าง Action ใหม่' }),
        nameInput
      ]),

      sectionHead('1', 'เมื่อเกิดเหตุการณ์', 'เลือกว่าให้ทำงานตอนไหน'),
      triggerPicker(action, triggerFields, function (t) {
        // ยังไม่ได้ตั้งชื่อเอง → เติมชื่ออัตโนมัติตามเหตุการณ์
        if (!nameInput.value.trim()) nameInput.placeholder = t.desc;
        // เปลี่ยนเหตุการณ์ → ชิปตัวแปรที่ใช้ได้เปลี่ยนตาม ต้อง render responses ใหม่
        curTriggerType = t.v;
        renderResponses(respList, action);
      }),
      triggerFields,

      sectionHead('2', 'สิ่งที่จะทำ', 'เพิ่มได้หลายอย่าง ทำตามลำดับ'),
      respList,
      el('div', { class: 'resp-add-label', text: '+ เพิ่มการกระทำ' }),
      addRespBar(action, respList),

      el('div', { class: 'ed-options' }, [
        el('span', { class: 'ed-opt-label', text: 'คูลดาวน์' }),
        cooldown,
        el('span', { class: 'ed-opt-unit', text: 'วินาที (0 = ไม่จำกัด) — กันการยิงถี่เกินไป' })
      ]),

      el('div', { class: 'modal-foot' }, [
        el('button', { class: 'btn btn-ghost', text: 'ยกเลิก', type: 'button', onclick: function () { m.close(); } }),
        el('button', { class: 'btn btn-primary', text: existing ? 'บันทึกการแก้ไข' : 'สร้าง Action', type: 'button', onclick: function () {
          action.name = nameInput.value.trim() || 'Action ไม่มีชื่อ';
          action.cooldownSec = Number(cooldown.value) || 0;
          if (!action.responses.length) { toast('ต้องมีอย่างน้อย 1 การกระทำ — กดปุ่มเพิ่มด้านล่างก่อน', 'err'); return; }
          m.close();
          onSave(action);
        } })
      ])
    ]);
    m = modal(body);
  }

  return { open: open };
})();
