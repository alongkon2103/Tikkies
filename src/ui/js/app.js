// Tikkies Tools Dashboard — main controller
(function () {
  var Tk = window.Tk;
  var $ = Tk.$, $$ = Tk.$$, el = Tk.el, invoke = Tk.invoke, toast = Tk.toast;
  var esc = Tk.escapeHtml, fmt = Tk.formatNumber;

  // สถานะรวมของหน้า
  var S = {
    settings: null,   // settingsFull
    serverPort: 21213,
    connection: { status: 'disconnected' },
    goals: null,
    timer: null,
    version: ''
  };

  // ---------- Init ----------
  async function init() {
    injectIcons();
    initTheme();
    setupTabs();
    setupStaticHandlers();
    Tk.onEvent(onBusEvent);

    try {
      var st = await invoke('state:get');
      S.settings = st.settingsFull;
      S.serverPort = st.serverPort || (st.settingsFull && st.settingsFull.serverPort) || 21213;
      S.connection = st.connection || S.connection;
      S.version = st.version || '';
      applyConnectionState(S.connection);
      applyStats(st.stats);
      applyGoals(st.goals);
      applyLeaderboard(st.leaderboard);
      applyTimer(st.timer);
      renderTemplates();
      renderActions();
      renderWidgets();
      bindWheelTab();
      bindSettingsForms();
      applyObsStatus(st.obs || {});
      $('#versionLabel').textContent = 'v' + S.version;
      $('#aboutVersion').textContent = 'v' + S.version;
      $('#serverStatus').textContent = 'เซิร์ฟเวอร์: :' + S.serverPort;
      loadVoices();
    } catch (e) {
      toast('โหลดสถานะเริ่มต้นไม่สำเร็จ: ' + (e.message || e), 'err');
    }
  }

  // ---------- Icons & Theme ----------
  function injectIcons() {
    $$('[data-icon]').forEach(function (elm) {
      if (elm.querySelector(':scope > .icon')) return;
      elm.insertBefore(window.Icon.el(elm.dataset.icon), elm.firstChild);
    });
  }
  function applyTheme(theme) {
    theme = theme === 'dark' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', theme);
    var btn = $('#themeToggle');
    if (btn) { btn.innerHTML = ''; btn.appendChild(window.Icon.el(theme === 'dark' ? 'sun' : 'moon', 16)); }
    localStorage.setItem('tk.theme', theme);
  }
  function initTheme() {
    applyTheme(localStorage.getItem('tk.theme') || 'dark');
    var btn = $('#themeToggle');
    if (btn) btn.addEventListener('click', function () {
      applyTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
    });
  }

  // ---------- Tabs ----------
  function setupTabs() {
    var last = localStorage.getItem('tk.tab') || 'overview';
    function show(name) {
      $$('.nav-item').forEach(function (b) { b.classList.toggle('active', b.dataset.tab === name); });
      $$('#main .tab').forEach(function (s) { s.hidden = s.dataset.tab !== name; });
      localStorage.setItem('tk.tab', name);
    }
    $$('.nav-item').forEach(function (b) {
      b.addEventListener('click', function () { show(b.dataset.tab); });
    });
    show(last);
  }

  // ---------- Static handlers ----------
  function setupStaticHandlers() {
    // เชื่อมต่อ / ตัดการเชื่อมต่อ
    $('#connectBtn').addEventListener('click', toggleConnect);
    $('#usernameInput').addEventListener('keydown', function (e) { if (e.key === 'Enter') toggleConnect(); });
    $('#autoConnectChk').addEventListener('change', function () {
      saveSettings({ autoConnect: $('#autoConnectChk').checked });
    });

    // ปุ่มทดสอบ event
    $$('[data-sim]').forEach(function (b) {
      b.addEventListener('click', function () { invoke('simulate', { type: b.dataset.sim }); });
    });

    // เหตุการณ์สด
    $('#clearEvents').addEventListener('click', function () { $('#eventFeed').innerHTML = ''; });

    // Actions — ส่งออก/นำเข้า
    $('#exportActionsBtn').addEventListener('click', exportActions);
    $('#importActionsBtn').addEventListener('click', importActions);

    // Actions
    $('#newActionBtn').addEventListener('click', function () {
      window.ActionsEditor.open(null, function (action) {
        S.settings.actions = S.settings.actions || [];
        S.settings.actions.push(action);
        persistActions();
      });
    });

    // TTS
    bindTtsForm();
    $('#ttsTestBtn').addEventListener('click', function () {
      invoke('tts:test', { text: $('#ttsTestText').value || 'ทดสอบเสียง' });
    });

    // Timer controls
    $$('[data-timer-cmd]').forEach(function (b) {
      b.addEventListener('click', function () {
        var cmd = b.dataset.timerCmd;
        var payload = b.dataset.add ? { seconds: Number(b.dataset.add) } : {};
        invoke('timer:control', { cmd: cmd, payload: payload });
      });
    });

    // OBS
    $('#obsConnectBtn').addEventListener('click', async function () {
      try { await invoke('obs:connect'); toast('กำลังเชื่อมต่อ OBS...', 'ok'); refreshScenes(); }
      catch (e) {}
    });
    $('#obsDisconnectBtn').addEventListener('click', function () { invoke('obs:disconnect'); });
  }

  // ---------- Connection ----------
  var BUSY = ['connecting', 'waiting', 'retrying'];
  function isBusy(s) { return BUSY.indexOf(s) >= 0; }

  async function doConnect(username, waitForLive) {
    $('#connectError').textContent = '';
    hideWaitBtn();
    applyConnectionState({ status: waitForLive ? 'waiting' : 'connecting', username: username });
    try {
      await invoke('tiktok:connect', { username: username, waitForLive: waitForLive }, { toast: false });
    } catch (e) {
      // error สุดท้าย (หลัง retry หมด) — สถานะจริงมาทาง event connectionState แล้ว
      $('#connectError').textContent = e.message || String(e);
    }
  }

  async function toggleConnect() {
    var status = S.connection.status;
    if (status === 'connected' || isBusy(status)) {
      await invoke('tiktok:disconnect'); // ยกเลิก/ตัดการเชื่อม (ยกเลิกการรอด้วย)
      return;
    }
    var username = $('#usernameInput').value.trim().replace(/^@/, '');
    if (!username) { $('#connectError').textContent = 'กรุณาใส่ชื่อผู้ใช้ TikTok'; return; }
    doConnect(username, false);
  }

  var retryCountdown = null;
  function applyConnectionState(c) {
    S.connection = c || {};
    var status = S.connection.status || 'disconnected';
    var dot = $('#connDot'), text = $('#connText'), meta = $('#connMeta');
    dot.className = 'dot ' + status;
    var labels = {
      disconnected: 'ยังไม่เชื่อมต่อ', connecting: 'กำลังเชื่อมต่อ...',
      waiting: 'กำลังรอไลฟ์...', retrying: 'กำลังลองใหม่...', connected: 'เชื่อมต่อแล้ว'
    };
    text.textContent = labels[status] || status;

    var uname = S.connection.username ? '@' + S.connection.username : '';
    var extra = '';
    if (status === 'connected' && S.connection.roomId) extra = '  ·  LIVE';
    else if (status === 'retrying' && S.connection.attempt) extra = '  •  ครั้งที่ ' + S.connection.attempt;
    meta.textContent = uname + extra;

    var btn = $('#connectBtn');
    btn.textContent = (status === 'connected') ? 'ตัดการเชื่อมต่อ'
      : isBusy(status) ? 'ยกเลิก' : 'เชื่อมต่อ';

    if (S.connection.username && !$('#usernameInput').value) $('#usernameInput').value = S.connection.username;
    if (status === 'connected' || isBusy(status)) { $('#connectError').textContent = ''; hideWaitBtn(); }

    // นับถอยเวลา retry ให้เห็นในกล่องเชื่อมต่อ
    clearInterval(retryCountdown);
    if (status === 'retrying' && S.connection.nextRetryMs > 0) {
      var remain = Math.ceil(S.connection.nextRetryMs / 1000);
      var elc = $('#connectError');
      var render = function () { elc.textContent = (S.connection.error || 'เชื่อมไม่สำเร็จ') + ' — ลองใหม่ใน ' + remain + ' วิ'; };
      render();
      retryCountdown = setInterval(function () {
        remain -= 1;
        if (remain <= 0 || S.connection.status !== 'retrying') { clearInterval(retryCountdown); return; }
        render();
      }, 1000);
    }

    // ถ้าตัดจบเพราะ "ยังไม่ไลฟ์" → เสนอปุ่ม "รอจนไลฟ์"
    if (status === 'disconnected' && S.connection.errorKind === 'offline') {
      $('#connectError').textContent = S.connection.error || 'ผู้ใช้นี้ยังไม่ได้ไลฟ์';
      showWaitBtn(S.connection.username);
    }
  }

  function showWaitBtn(username) {
    hideWaitBtn();
    var box = $('#connCardWait') || (function () {
      var b = el('button', { id: 'connCardWait', class: 'btn btn-ghost btn-sm', style: 'margin-top:8px' }, ['รอจนกว่าจะไลฟ์']);
      $('.connect-box').appendChild(b);
      return b;
    })();
    box.style.display = '';
    box.onclick = function () { doConnect(username || $('#usernameInput').value.trim().replace(/^@/, ''), true); };
  }
  function hideWaitBtn() { var b = $('#connCardWait'); if (b) b.style.display = 'none'; }

  // ---------- Stats ----------
  function applyStats(s) {
    if (!s) return;
    $$('[data-stat]').forEach(function (elm) {
      var v = s[elm.dataset.stat];
      elm.textContent = fmt(v || 0);
    });
  }

  // ---------- Leaderboard (mini) ----------
  function applyLeaderboard(lb) {
    var host = $('#miniLeaderboard');
    var top = (lb && lb.top) || [];
    if (!top.length) { host.innerHTML = '<div class="muted">ยังไม่มีข้อมูล</div>'; return; }
    host.innerHTML = '';
    top.slice(0, 3).forEach(function (u, i) {
      var row = el('div', { class: 'lb-row' }, [
        el('div', { class: 'rank', text: String(i + 1) }),
        Tk.avatar('av', u),
        el('div', { class: 'nm', text: u.nickname || u.uniqueId }),
        el('div', { class: 'dm' }, [window.Icon.el('diamond', 13), el('span', { text: fmt(u.diamonds) })])
      ]);
      host.appendChild(row);
    });
  }

  // ---------- Events feed ----------
  var feedFilters = { chat: 1, gift: 1, like: 1, follow: 1, share: 1, subscribe: 1, member: 1 };
  $$('#eventFilters input').forEach(function (cb) {
    cb.addEventListener('change', function () { feedFilters[cb.value] = cb.checked ? 1 : 0; });
  });

  var EV_ICON = { chat: 'chat', gift: 'gift', like: 'heart', follow: 'follow', share: 'share', subscribe: 'star', member: 'member' };
  function evDesc(type, d) {
    if (type === 'chat') return d.comment;
    if (type === 'gift') return 'ส่ง ' + (d.giftName || 'ของขวัญ') + ' ×' + (d.repeatCount || 1) + ' · ' + (d.diamondTotal || 0) + ' เพชร';
    if (type === 'like') return '+' + (d.likeCount || 0) + ' ไลค์';
    if (type === 'follow') return 'กดติดตาม';
    if (type === 'share') return 'แชร์ไลฟ์';
    if (type === 'subscribe') return 'สมัครสมาชิก';
    if (type === 'member') return 'เข้าห้อง';
    return '';
  }
  function buildEvRow(type, d) {
    var desc = evDesc(type, d);
    var children = [
      el('span', { class: 'time', text: Tk.timeStr() }),
      el('span', { class: 'ico', html: window.Icon.svg(EV_ICON[type] || 'info', 12) })
    ];
    if (type !== 'like') children.push(Tk.avatar('av', d));
    children.push(el('span', { class: 'nm', text: d.nickname || d.uniqueId || '' }));
    if (type === 'gift' && d.giftPictureUrl) {
      var wrap = el('span', { class: 'desc' });
      wrap.appendChild(el('img', { class: 'gimg', src: d.giftPictureUrl }));
      wrap.appendChild(document.createTextNode(' ' + desc));
      children.push(wrap);
    } else {
      children.push(el('span', { class: 'desc', text: desc }));
    }
    return el('div', { class: 'ev ' + type }, children);
  }

  function pushEvent(type, d) {
    if (type === 'chat' && !String(d.comment || '').trim()) return; // ข้ามแชทว่าง (สติกเกอร์/emote)

    // ฟีดกิจกรรมสดบนหน้าภาพรวม (ใหม่สุดอยู่บน, เก็บ 25 แถว) — ไม่ผูกกับตัวกรองของแท็บ
    var ov = $('#overviewFeed');
    if (ov) {
      var hint = $('#ovFeedHint'); if (hint) hint.style.display = 'none';
      ov.insertBefore(buildEvRow(type, d), ov.firstChild);
      while (ov.childNodes.length > 25) ov.removeChild(ov.lastChild);
    }

    // ฟีดเต็มในแท็บเหตุการณ์สด (มีตัวกรอง, ใหม่สุดอยู่ล่าง, auto-scroll)
    if (!feedFilters[type]) return;
    var feed = $('#eventFeed');
    if (feed.firstChild && feed.firstChild.classList && feed.firstChild.classList.contains('muted')) feed.innerHTML = '';
    var atBottom = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 40;
    feed.appendChild(buildEvRow(type, d));
    while (feed.childNodes.length > 200) feed.removeChild(feed.firstChild);
    if (atBottom) feed.scrollTop = feed.scrollHeight;
  }

  // ---------- Actions ----------
  function persistActions() {
    invoke('settings:set', { patch: { actions: S.settings.actions } })
      .then(function () { renderActions(); toast('บันทึกแล้ว', 'ok'); });
  }

  // ---------- Export / Import Actions ----------
  function exportActions() {
    if (!(S.settings.actions || []).length) { toast('ยังไม่มี Action ให้ส่งออก', 'err'); return; }
    invoke('actions:export').then(function (r) {
      if (r && r.ok) toast('ส่งออก ' + r.count + ' Actions เป็นไฟล์แล้ว', 'ok', 3200);
    }).catch(function () {});
  }
  function importActions() {
    invoke('actions:import').then(function (r) {
      if (!r || !r.ok) return; // ผู้ใช้ยกเลิก
      var incoming = r.actions || [];
      if (!incoming.length) return;
      askImportMode(incoming.length, function (mode) {
        if (!mode) return;
        var prepared = incoming.map(function (a) {
          return {
            id: 'a_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
            name: a.name || 'Action นำเข้า',
            enabled: a.enabled !== false,
            cooldownSec: Number(a.cooldownSec) || 0,
            trigger: a.trigger,
            responses: Array.isArray(a.responses) ? a.responses : []
          };
        });
        S.settings.actions = (mode === 'replace') ? prepared : (S.settings.actions || []).concat(prepared);
        persistActions();
        toast((mode === 'replace' ? 'แทนที่ด้วย ' : 'เพิ่ม ') + prepared.length + ' Actions แล้ว', 'ok', 3200);
      });
    }).catch(function () {});
  }
  function askImportMode(count, cb) {
    var m;
    var body = el('div', {}, [
      el('h2', { text: 'นำเข้า Actions' }),
      el('p', { class: 'muted', text: 'พบ ' + count + ' Action ในไฟล์ — ต้องการทำแบบไหน?' }),
      el('div', { class: 'modal-foot' }, [
        el('button', { class: 'btn btn-ghost', text: 'ยกเลิก', onclick: function () { m.close(); cb(null); } }),
        el('button', { class: 'btn', text: 'แทนที่ทั้งหมด', onclick: function () { m.close(); cb('replace'); } }),
        el('button', { class: 'btn btn-primary', text: 'เพิ่มต่อท้าย', onclick: function () { m.close(); cb('append'); } })
      ])
    ]);
    m = Tk.modal(body);
  }

  // เทมเพลตยอดฮิต — กดเดียวเพิ่ม action แล้วแก้ต่อได้
  var ACTION_TEMPLATES = [
    { icon: 'gift', label: 'ได้ Rose → เสียง + แจ้งเตือน',
      make: function () { return { name: 'ขอบคุณคนให้ Rose', trigger: { type: 'gift', giftName: 'Rose', minDiamonds: 0 }, responses: [{ type: 'alert', text: '{nickname} ส่ง Rose ให้!', durationSec: 6 }, { type: 'sound', url: '', volume: 1 }] }; } },
    { icon: 'heart', label: 'ครบทุก 1,000 ไลค์ → แจ้งเตือน',
      make: function () { return { name: 'ฉลองทุก 1,000 หัวใจ', trigger: { type: 'like', likeThreshold: 1000 }, responses: [{ type: 'alert', text: 'ยอดหัวใจแตะ {likeCount} แล้ว!', durationSec: 6 }] }; } },
    { icon: 'follow', label: 'ผู้ติดตามใหม่ → อ่านชื่อ',
      make: function () { return { name: 'ต้อนรับผู้ติดตามใหม่', trigger: { type: 'follow' }, responses: [{ type: 'tts', text: 'ขอบคุณ {nickname} ที่กดติดตามนะครับ' }] }; } },
    { icon: 'keyboard', label: 'แชท !jump → กด Space ในเกม',
      make: function () { return { name: 'สั่งกระโดดในเกม', trigger: { type: 'chat', keyword: '!jump' }, responses: [{ type: 'keypress', key: 'space', modifiers: [], holdMs: 0 }] }; } },
    { icon: 'gift', label: 'ของขวัญใหญ่ (≥100 เพชร) → แจ้งเตือน',
      make: function () { return { name: 'ของขวัญใหญ่', trigger: { type: 'gift', giftName: '', minDiamonds: 100 }, responses: [{ type: 'alert', text: '{nickname} ทุ่ม {giftName} {diamondTotal} เพชร!', durationSec: 8 }, { type: 'sound', url: '', volume: 1 }] }; } },
    { icon: 'share', label: 'มีคนแชร์ไลฟ์ → ขอบคุณ',
      make: function () { return { name: 'ขอบคุณคนแชร์', trigger: { type: 'share' }, responses: [{ type: 'tts', text: 'ขอบคุณ {nickname} ที่แชร์ไลฟ์' }] }; } }
  ];
  function renderTemplates() {
    var host = $('#actionTemplates');
    if (!host) return;
    host.innerHTML = '';
    ACTION_TEMPLATES.forEach(function (tpl) {
      var chip = el('button', { class: 'template-chip' }, [window.Icon.el(tpl.icon, 15), el('span', { text: tpl.label })]);
      chip.addEventListener('click', function () {
        var a = tpl.make();
        a.id = 'a_' + Date.now().toString(36);
        a.enabled = true;
        a.cooldownSec = a.cooldownSec || 0;
        S.settings.actions = S.settings.actions || [];
        S.settings.actions.push(a);
        persistActions();
        toast('เพิ่ม "' + a.name + '" แล้ว — กดแก้ไขเพื่อปรับ', 'ok', 3200);
      });
      host.appendChild(chip);
    });
  }

  function triggerSummary(a) {
    var t = a.trigger || {};
    switch (t.type) {
      case 'gift': return t.giftName ? ('เมื่อได้รับ ' + t.giftName + (t.minDiamonds ? ' (≥' + t.minDiamonds + '💎)' : '')) : 'เมื่อได้รับของขวัญใดๆ' + (t.minDiamonds ? ' (≥' + t.minDiamonds + '💎)' : '');
      case 'chat': return t.keyword ? ('เมื่อแชทมี "' + t.keyword + '"') : 'เมื่อมีข้อความแชท';
      case 'like': return 'เมื่อครบทุกๆ ' + (t.likeThreshold || 0) + ' ไลค์';
      case 'follow': return 'เมื่อมีผู้ติดตามใหม่';
      case 'share': return 'เมื่อมีคนแชร์';
      case 'subscribe': return 'เมื่อมีสมาชิกใหม่';
      case 'member': return 'เมื่อมีคนเข้าห้อง';
      case 'hotkey': return 'เมื่อกดคีย์ ' + (t.accelerator || '(ยังไม่ตั้ง)');
      case 'wheelResult': return t.prize ? ('เมื่อสุ่มได้ "' + t.prize + '"') : 'เมื่อสุ่มรางวัลออก (ทุกช่อง)';
      default: return t.type || '';
    }
  }
  var RESP_ICON = { alert: 'bell', tts: 'tts', sound: 'music', keypress: 'keyboard', obs: 'video', webhook: 'webhook', wheel: 'sparkles', timer: 'timer' };

  function renderActions() {
    var list = $('#actionsList');
    var actions = (S.settings && S.settings.actions) || [];
    list.innerHTML = '';
    if (!actions.length) {
      list.appendChild(el('div', { class: 'empty-state', html:
        'ยังไม่มี Action — เริ่มได้ใน 3 ขั้น<br>' +
        '<span class="empty-steps">1. กดเทมเพลตด้านบน หรือ "+ สร้าง Action"  ·  2. กด "ทดสอบ" ดูผลทันที  ·  3. เปิดไลฟ์แล้วทำงานอัตโนมัติ</span>' }));
      return;
    }
    actions.forEach(function (a, idx) {
      var toggle = el('label', { class: 'toggle' }, [
        el('input', { type: 'checkbox' }),
        el('span', { class: 'track' })
      ]);
      var cb = toggle.querySelector('input');
      cb.checked = a.enabled !== false;
      cb.addEventListener('change', function () {
        a.enabled = cb.checked;
        invoke('settings:set', { patch: { actions: S.settings.actions } });
        card.classList.toggle('disabled', !cb.checked);
      });
      var sum = el('div', { class: 'action-sum' }, [el('span', { text: triggerSummary(a) }), el('span', { text: '→' })]);
      (a.responses || []).forEach(function (r) {
        sum.appendChild(window.Icon.el(RESP_ICON[r.type] || 'info', 14));
      });
      var card = el('div', { class: 'action-card' + (a.enabled === false ? ' disabled' : '') }, [
        toggle,
        el('div', { class: 'action-main' }, [
          el('div', { class: 'action-name', text: a.name || 'Action' }),
          sum
        ]),
        el('div', { class: 'action-btns' }, [
          (function () {
            // ปุ่มทดสอบ: นับถอยหลัง 5 วิ ก่อนรันจริง — ให้มีเวลาสลับไปหน้าเกม/แอปเป้าหมาย
            // (จำเป็นกับ keypress ที่ส่งปุ่มไปหน้าต่างที่โฟกัสอยู่) · กดซ้ำระหว่างนับ = ยกเลิก
            var testBtn = el('button', { class: 'btn btn-ghost btn-sm', text: 'ทดสอบ' });
            var countdown = null, left = 0;
            function resetBtn() {
              clearInterval(countdown); countdown = null;
              testBtn.textContent = 'ทดสอบ';
              testBtn.classList.remove('counting');
            }
            testBtn.addEventListener('click', function () {
              if (countdown) { resetBtn(); toast('ยกเลิกการทดสอบ', ''); return; }
              left = 5;
              testBtn.textContent = 'รันใน ' + left + '...';
              testBtn.classList.add('counting');
              countdown = setInterval(function () {
                left -= 1;
                if (left > 0) { testBtn.textContent = 'รันใน ' + left + '...'; return; }
                resetBtn();
                invoke('actions:test', { id: a.id }).then(function () { toast('ทดสอบ "' + (a.name || '') + '" แล้ว', 'ok'); });
              }, 1000);
            });
            return testBtn;
          })(),
          el('button', { class: 'btn btn-ghost btn-sm', text: 'แก้ไข', onclick: function () {
            window.ActionsEditor.open(a, function (updated) {
              S.settings.actions[idx] = updated;
              persistActions();
            });
          } }),
          el('button', { class: 'btn btn-danger btn-sm', text: 'ลบ', onclick: async function () {
            if (await Tk.confirmDialog('ลบ Action "' + (a.name || '') + '" ?', 'ลบ')) {
              S.settings.actions.splice(idx, 1);
              persistActions();
            }
          } })
        ])
      ]);
      list.appendChild(card);
    });
  }

  // ---------- Widgets ----------
  var WIDGETS = [
    { file: 'alerts', icon: 'bell', name: 'Alert Box', desc: 'แจ้งเตือนของขวัญ/ติดตาม/สมาชิก กลางจอ', size: '500 x 300', params: '?gifts=1&follows=1&subs=1 (เปิด/ปิดแต่ละชนิด), ?sound=0 ปิดเสียง, ?debug=1 ปุ่มทดสอบ' },
    { file: 'chat', icon: 'chat', name: 'Chat Overlay', desc: 'แชทสดพร้อม badge Mod/Sub/Follow', size: '380 x 600', params: '?avatars=0 ซ่อนรูป, ?hidecmd=1 ซ่อนคำสั่ง, ?size=16 ฟอนต์, ?fade=30 จางใน 30 วิ' },
    { file: 'goal', icon: 'goals', name: 'Goal Bar', desc: 'หลอดเป้าหมาย หัวใจ/เพชร/ผู้ติดตาม', size: '460 x 260', params: '?goal=likes|diamonds|followers แสดงตัวเดียว' },
    { file: 'leaderboard', icon: 'trophy', name: 'Leaderboard', desc: 'อันดับผู้ให้ของขวัญสูงสุด', size: '340 x 400', params: '?top=5 จำนวนอันดับ, ?title=0 ซ่อนหัวข้อ' },
    { file: 'timer', icon: 'timer', name: 'Subathon Timer', desc: 'นาฬิกาถอยหลังบวกเวลาตามของขวัญ', size: '360 x 140', params: '?size=72 ขนาดตัวเลข' },
    { file: 'tts', icon: 'tts', name: 'TTS Caption', desc: 'คำบรรยายข้อความที่กำลังอ่าน', size: '600 x 120', params: '?caption=0 ปิดคำบรรยาย' },
    { file: 'wheel', icon: 'sparkles', name: 'Roulette สุ่มรางวัล', desc: 'แถบสุ่มรางวัลแนวนอน (สไตล์เปิดกล่อง) — ตั้งค่าในแท็บ "สุ่มรางวัล"', size: '900 x 260', params: '?idlehide=1 ซ่อนตอนไม่หมุน, ?card=120 ขนาดการ์ด, ?debug=1 ปุ่มทดสอบ' }
  ];
  function renderWidgets() {
    var list = $('#widgetsList');
    list.innerHTML = '';
    WIDGETS.forEach(function (w) {
      var url = 'http://localhost:' + S.serverPort + '/widgets/' + w.file + '.html';
      var urlInput = el('input', { type: 'text', value: url, readonly: 'readonly', title: url, onclick: function () { urlInput.select(); } });
      var openBtn = el('button', { class: 'btn btn-ghost btn-sm', title: 'เปิดดูในเบราว์เซอร์', onclick: function () { invoke('app:openExternal', { url: url }); } });
      openBtn.appendChild(window.Icon.el('external', 14));
      var row = el('div', { class: 'widget-card' }, [
        el('div', { class: 'w-ico' }, [window.Icon.el(w.icon, 17)]),
        el('div', { class: 'w-main' }, [
          el('div', { class: 'w-name' }, [el('span', { text: w.name }), el('span', { class: 'w-size', text: w.size })]),
          el('div', { class: 'wdesc', text: w.desc }),
          el('div', { class: 'wmeta', title: w.params, text: 'ตัวเลือก: ' + w.params })
        ]),
        el('div', { class: 'url-row' }, [
          urlInput,
          el('button', { class: 'btn btn-sm', text: 'คัดลอก', onclick: function () {
            navigator.clipboard.writeText(url).then(function () { toast('คัดลอก URL "' + w.name + '" แล้ว — วางใน OBS ได้เลย', 'ok'); });
          } }),
          openBtn
        ])
      ]);
      list.appendChild(row);
    });
  }

  // ---------- TTS form ----------
  function bindTtsForm() {
    $$('[data-tts]').forEach(function (inp) {
      var key = inp.dataset.tts;
      inp.addEventListener(inp.type === 'checkbox' ? 'change' : 'input', debounce(function () {
        var val;
        if (inp.type === 'checkbox') val = inp.checked;
        else if (inp.type === 'range' || inp.type === 'number') val = Number(inp.value);
        else if (key === 'bannedWords') val = inp.value.split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
        else val = inp.value;
        var patch = { tts: {} };
        patch.tts[key] = val;
        saveSettings(patch, true);
        if (inp.type === 'range') { var b = $('[data-slider-val="' + key + '"]'); if (b) b.textContent = Number(inp.value).toFixed(1); }
      }, 400));
    });
  }
  function fillTtsForm() {
    var t = (S.settings && S.settings.tts) || {};
    $$('[data-tts]').forEach(function (inp) {
      var key = inp.dataset.tts, v = t[key];
      if (inp.type === 'checkbox') inp.checked = !!v;
      else if (key === 'bannedWords') inp.value = (v || []).join('\n');
      else inp.value = v != null ? v : '';
      if (inp.type === 'range') { var b = $('[data-slider-val="' + key + '"]'); if (b) b.textContent = Number(v || 1).toFixed(1); }
    });
  }
  function loadVoices() {
    // เสียงจากระบบ macOS (say) ผ่าน main — เชื่อถือได้กว่า speechSynthesis ของ Electron ที่คืนว่าง
    invoke('tts:voices', {}, { toast: false }).then(function (voices) {
      voices = voices || [];
      var dl = $('#voiceList');
      dl.innerHTML = '';
      var thaiCount = 0;
      voices.forEach(function (v) {
        var isThai = /^th[_-]/i.test(v.lang);
        if (isThai) thaiCount++;
        dl.appendChild(el('option', { value: v.name, text: (isThai ? '🇹🇭 ' : '') + v.name + ' · ' + v.lang }));
      });
      var badge = $('#voiceCount');
      if (badge) badge.textContent = thaiCount ? '— มีเสียงไทย ' + thaiCount + ' เสียง' : '— ยังไม่มีเสียงไทย (ดูวิธีเพิ่มด้านล่าง)';
    }).catch(function () {});
  }

  // ---------- Goals & Timer forms ----------
  function renderGoalsForm() {
    var host = $('#goalsForm');
    var goals = (S.settings && S.settings.goals) || {};
    var defs = [['likes', 'หัวใจ', 'heart'], ['diamonds', 'เพชร', 'diamond'], ['followers', 'ผู้ติดตามใหม่', 'follow']];
    host.innerHTML = '';
    defs.forEach(function (d) {
      var key = d[0], g = goals[key] || {};
      var enable = el('input', { type: 'checkbox' }); enable.checked = !!g.enabled;
      var target = el('input', { type: 'number', min: '0', value: g.target || 0 });
      var label = el('input', { type: 'text', value: g.label || '' });
      function save() {
        var patch = { goals: {} };
        patch.goals[key] = { enabled: enable.checked, target: Number(target.value) || 0, label: label.value };
        saveSettings(patch, true);
      }
      enable.addEventListener('change', save);
      target.addEventListener('input', debounce(save, 400));
      label.addEventListener('input', debounce(save, 400));
      host.appendChild(el('div', { class: 'goal-cfg' }, [
        el('div', { class: 'goal-head' }, [el('b', { class: 'card-title', style: 'margin:0' }, [window.Icon.el(d[2], 15), el('span', { text: d[1] })]), el('label', { class: 'check-inline' }, [enable, ' เปิดใช้'])]),
        el('div', { class: 'grid2' }, [
          el('div', { class: 'field' }, [el('label', { text: 'เป้าหมาย' }), target]),
          el('div', { class: 'field' }, [el('label', { text: 'ป้ายกำกับ' }), label])
        ])
      ]));
    });
  }
  function bindTimerForm() {
    $$('[data-timer]').forEach(function (inp) {
      var key = inp.dataset.timer;
      inp.addEventListener(inp.type === 'checkbox' ? 'change' : 'input', debounce(function () {
        var val = inp.type === 'checkbox' ? inp.checked : (inp.type === 'number' ? Number(inp.value) : inp.value);
        var patch = { timer: {} }; patch.timer[key] = val;
        saveSettings(patch, true);
      }, 400));
    });
  }
  function fillTimerForm() {
    var t = (S.settings && S.settings.timer) || {};
    $$('[data-timer]').forEach(function (inp) {
      var v = t[inp.dataset.timer];
      if (inp.type === 'checkbox') inp.checked = !!v; else inp.value = v != null ? v : '';
    });
  }
  function applyGoals(g) {
    if (!g) return;
    S.goals = g;
    var host = $('#goalPreview');
    host.innerHTML = '';
    ['likes', 'diamonds', 'followers'].forEach(function (k) {
      var gg = g[k];
      if (!gg || !gg.enabled) return;
      var pct = gg.target > 0 ? Math.min(100, (gg.current / gg.target) * 100) : 0;
      host.appendChild(el('div', {}, [
        el('div', { class: 'gp-label' }, [el('span', { text: gg.label || k }), el('span', { text: fmt(gg.current || 0) + ' / ' + fmt(gg.target || 0) })]),
        el('div', { class: 'gp-bar' }, [el('div', { class: 'gp-fill', style: 'width:' + pct + '%' })])
      ]));
    });
  }
  function applyTimer(t) {
    if (!t) return;
    S.timer = t;
    var sec = Math.max(0, Math.floor(t.remainingSec || 0));
    var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    function p(n) { return (n < 10 ? '0' : '') + n; }
    $('#timerDisplay').textContent = (h > 0 ? p(h) + ':' : '') + p(m) + ':' + p(s);
  }

  // ---------- Settings forms ----------
  function bindSettingsForms() {
    fillTtsForm();
    renderGoalsForm();
    bindTimerForm();
    fillTimerForm();
    $('#autoConnectChk').checked = !!(S.settings && S.settings.autoConnect);

    $$('[data-setting]').forEach(function (inp) {
      var path = inp.dataset.setting;
      // เติมค่าเริ่มต้น
      var v = getPath(S.settings, path);
      if (inp.type === 'checkbox') inp.checked = !!v; else inp.value = v != null ? v : '';
      inp.addEventListener(inp.type === 'checkbox' ? 'change' : 'input', debounce(function () {
        var val = inp.type === 'checkbox' ? inp.checked : (inp.type === 'number' ? Number(inp.value) : inp.value);
        saveSettings(setPath({}, path, val), true);
      }, 500));
    });
  }

  // ---------- OBS ----------
  function applyObsStatus(o) {
    var connected = !!o.connected;
    var elS = $('#obsStatus');
    elS.innerHTML = '';
    elS.appendChild(el('span', { class: 'dot ' + (connected ? 'connected' : 'disconnected'), style: 'display:inline-block;margin-right:7px' }));
    elS.appendChild(document.createTextNode(connected ? 'เชื่อมต่อแล้ว' : (o.error ? o.error : 'ยังไม่เชื่อมต่อ')));
    $('#obsBar').textContent = 'OBS: ' + (connected ? 'เชื่อมต่อ' : '—');
    if (connected) refreshScenes();
    else $('#obsScenes').innerHTML = '';
  }
  async function refreshScenes() {
    try {
      var scenes = await invoke('obs:scenes', {}, { toast: false });
      var host = $('#obsScenes');
      host.innerHTML = '';
      (scenes || []).forEach(function (s) { host.appendChild(el('span', { class: 'scene-chip', text: s })); });
    } catch (e) { /* ยังไม่เชื่อม */ }
  }

  // ---------- Sound playback ----------
  // TTS เล่นที่ main process ด้วย macOS say (ttsPlayer) — renderer ไม่ต้องทำ
  function playSound(url, volume) {
    if (!url) return;
    try {
      var a = new Audio(url);
      a.volume = (volume != null && isFinite(volume)) ? Math.max(0, Math.min(1, volume)) : 1;
      a.play().catch(function (e) { logStatus({ level: 'warn', msg: 'เล่นเสียงไม่สำเร็จ: ' + (e && e.message || e) }); });
    } catch (e) { logStatus({ level: 'warn', msg: 'เล่นเสียงไม่สำเร็จ: ' + e.message }); }
  }

  // ---------- Statusbar ----------
  function logStatus(l) {
    var s = $('#statusLog');
    s.textContent = l.msg;
    s.className = 'status-log' + (l.level === 'error' ? ' err' : l.level === 'warn' ? ' warn' : '');
  }

  // ---------- Bus event router ----------
  function onBusEvent(msg) {
    var event = msg.event, data = msg.data;
    switch (event) {
      case 'chat': case 'gift': case 'like': case 'follow':
      case 'share': case 'subscribe': case 'member':
        pushEvent(event, data); break;
      case 'stats': applyStats(data); break;
      case 'goals': applyGoals(data); if ($('#goalsForm').children.length === 0) renderGoalsForm(); break;
      case 'leaderboard': applyLeaderboard(data); break;
      case 'timer': applyTimer(data); break;
      case 'connectionState': applyConnectionState(data); break;
      case 'connected': applyConnectionState({ status: 'connected', username: data.username, roomId: data.roomId }); toast('เชื่อมต่อ @' + data.username + ' แล้ว 🟢', 'ok'); break;
      case 'disconnected': applyConnectionState({ status: 'disconnected', username: data.username }); break;
      case 'streamEnd': toast('ไลฟ์จบแล้ว', 'warn'); break;
      case 'sound': playSound(data.url, data.volume); break;
      // 'tts' เล่นที่ main process (ttsPlayer) แล้ว — renderer ไม่ต้องทำอะไร
      case 'obsState': applyObsStatus(data); break;
      case 'action': logStatus({ level: 'info', msg: (data.name || 'Action') + ' ทำงาน' }); break;
      case 'log': logStatus(data); if (data.level === 'error') toast(data.msg, 'err', 4000); break;
    }
  }

  // ---------- กงล้อเสี่ยงโชค ----------
  function bindWheelTab() {
    var w = (S.settings && S.settings.wheel) || {};

    // ฟิลด์ทั่วไป — bind ผ่าน [data-wheel]
    $$('[data-wheel]').forEach(function (inp) {
      var key = inp.dataset.wheel;
      if (inp.type === 'checkbox') {
        inp.checked = w[key] !== false;
        inp.addEventListener('change', function () { saveWheel(key, inp.checked); });
      } else {
        inp.value = w[key] != null ? w[key] : '';
        inp.addEventListener('change', function () {
          saveWheel(key, inp.type === 'number' ? (Number(inp.value) || 0) : inp.value);
        });
      }
    });

    function saveWheel(key, val) {
      var patch = {}; patch[key] = val;
      S.settings.wheel = Object.assign({}, S.settings.wheel, patch);
      saveSettings({ wheel: S.settings.wheel }, true);
    }

    renderWheelSegments();
    $('#addSegmentBtn').addEventListener('click', function () {
      S.settings.wheel.segments = S.settings.wheel.segments || [];
      S.settings.wheel.segments.push({ label: '', weight: 1 });
      renderWheelSegments();
      // โฟกัสช่องใหม่ทันที
      var inputs = $$('#wheelSegments .seg-label');
      if (inputs.length) inputs[inputs.length - 1].focus();
    });
    $('#wheelSpinBtn').addEventListener('click', function () {
      invoke('wheel:spin').then(function (r) {
        if (r && r.busy) { toast('กำลังสุ่มอยู่ รอให้จบก่อน', ''); return; }
        if (r && r.ok) toast('สุ่มแล้ว! ดูผลบน widget Roulette', 'ok');
      });
    });
  }

  function persistWheelSegments() {
    saveSettings({ wheel: S.settings.wheel }, true);
  }

  function renderWheelSegments() {
    var host = $('#wheelSegments');
    var segs = (S.settings.wheel && S.settings.wheel.segments) || [];
    host.innerHTML = '';
    if (!segs.length) {
      host.appendChild(el('div', { class: 'resp-empty', text: 'ยังไม่มีช่องรางวัล — กดเพิ่มด้านล่าง (ต้องมีอย่างน้อย 2 ช่อง)' }));
    }
    segs.forEach(function (seg, idx) {
      var labelInp = el('input', { type: 'text', class: 'seg-label', value: seg.label || '', placeholder: 'ชื่อรางวัล เช่น ร้องเพลง 1 เพลง' });
      labelInp.addEventListener('change', function () { seg.label = labelInp.value; persistWheelSegments(); });
      var weightInp = el('input', { type: 'number', class: 'seg-weight', min: '1', value: seg.weight || 1, title: 'น้ำหนักโอกาสออก' });
      weightInp.addEventListener('change', function () { seg.weight = Number(weightInp.value) || 1; persistWheelSegments(); });
      // สีของช่อง — default ตาม palette; ผู้ใช้เปลี่ยนเองได้
      var colorInp = el('input', { type: 'color', class: 'seg-color', value: seg.color || WHEEL_COLORS[idx % WHEEL_COLORS.length], title: 'สีของช่องนี้บน widget' });
      colorInp.addEventListener('change', function () { seg.color = colorInp.value; persistWheelSegments(); });
      // รูปของช่อง — อัพโหลดเข้าคลังแอป (/media) แล้วโชว์บนการ์ดแทนตัวอักษร
      var imgBtn;
      function imgBtnContent() {
        imgBtn.innerHTML = '';
        if (seg.image) {
          imgBtn.appendChild(el('img', { class: 'seg-thumb', src: 'http://localhost:' + S.serverPort + seg.image, alt: '' }));
          imgBtn.title = 'คลิกเพื่อเปลี่ยนรูป · คลิกขวาเพื่อลบรูป';
        } else {
          imgBtn.appendChild(window.Icon.el('upload', 13));
          imgBtn.title = 'อัพโหลดรูปของช่องนี้ (โชว์บนการ์ดแทนตัวอักษร)';
        }
      }
      imgBtn = el('button', { class: 'btn btn-ghost btn-sm icon-btn seg-img-btn', onclick: async function () {
        var url = await invoke('media:import', {});
        if (url) { seg.image = url; imgBtnContent(); persistWheelSegments(); }
      } });
      imgBtn.addEventListener('contextmenu', function (e) {
        e.preventDefault();
        if (seg.image) { delete seg.image; imgBtnContent(); persistWheelSegments(); }
      });
      imgBtnContent();
      host.appendChild(el('div', { class: 'seg-row' }, [
        colorInp,
        imgBtn,
        labelInp,
        weightInp,
        el('button', { class: 'btn btn-danger btn-sm icon-btn', title: 'ลบช่องนี้', onclick: function () {
          segs.splice(idx, 1);
          persistWheelSegments();
          renderWheelSegments();
        } }, [window.Icon.el('trash', 13)])
      ]));
    });
  }
  var WHEEL_COLORS = ['#fe2c55', '#25c1c9', '#f0c060', '#7b5bd6', '#3ecf8e', '#e0904a', '#5b93cc', '#e0685f'];

  // ---------- Settings save helper ----------
  function saveSettings(patch, silent) {
    // อัปเดต local ทันที (optimistic) แล้วส่งไป main
    S.settings = deepMerge(S.settings || {}, patch);
    invoke('settings:set', { patch: patch }, { toast: false })
      .then(function () { if (!silent) toast('บันทึกแล้ว', 'ok'); else quietSaved(); })
      .catch(function (e) { toast('บันทึกไม่สำเร็จ: ' + e.message, 'err'); });
  }
  var savedTimer = null;
  function quietSaved() {
    clearTimeout(savedTimer);
    var s = $('#statusLog');
    s.textContent = '✓ บันทึกแล้ว';
    s.className = 'status-log';
    savedTimer = setTimeout(function () {}, 1500);
  }

  // ---------- utils ----------
  function debounce(fn, ms) {
    var t; return function () { var a = arguments, c = this; clearTimeout(t); t = setTimeout(function () { fn.apply(c, a); }, ms); };
  }
  function deepMerge(base, patch) {
    if (Array.isArray(patch) || typeof patch !== 'object' || patch === null) return patch;
    var out = Array.isArray(base) ? [] : Object.assign({}, base || {});
    Object.keys(patch).forEach(function (k) { out[k] = deepMerge(base ? base[k] : undefined, patch[k]); });
    return out;
  }
  function getPath(obj, path) {
    return path.split('.').reduce(function (o, k) { return o ? o[k] : undefined; }, obj);
  }
  function setPath(obj, path, val) {
    var parts = path.split('.'), cur = obj;
    for (var i = 0; i < parts.length - 1; i++) { cur[parts[i]] = cur[parts[i]] || {}; cur = cur[parts[i]]; }
    cur[parts[parts.length - 1]] = val;
    return obj;
  }

  document.addEventListener('DOMContentLoaded', init);
})();
