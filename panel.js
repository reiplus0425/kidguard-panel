// KidGuard 설정 화면 - 화면 그리기와 텔레그램 연결. 순수 함수는 core.js (KGCore).
// 화면 글은 모두 textContent 로 넣는다 (innerHTML 쓰지 않음).
"use strict";

(function () {
  var C = window.KGCore;
  // 텔레그램이 나중에 # 뒤를 바꿀 수 있으므로 처음 값을 바로 저장해 둔다.
  var RAW_HASH = String(window.location.hash || "");

  // kind: "kg1"(예전 노트북, 구역 하나) | "kg2"(탭). top = 받은 값 전체. secs = [{sec, d (v1 모양 구역 값), base}].
  // base·cur 는 모든 구역의 키를 한 곳에 (구역끼리 키가 겹치지 않음), keySec = 키 → 구역.
  var S = {
    kind: null, top: null, secs: [], bySec: {}, base: {}, cur: {}, keySec: {}, regs: {}, sent: false, closingGuard: false,
    tab: null, tabs: {}, panels: {}, fresh: null, rfArmed: false, rep: null, repn: null,
    // 저장·보내기 실패 글 {text, where: "bar"|"fresh"}: 다음 편집이나 다시 누를 때까지 남긴다 (15초 다시 계산이 지우지 않게)
    actionErr: null, problems: []
  };

  // 구역 값 (없으면 빈 객체)
  function D(sec) { return S.bySec[sec] ? S.bySec[sec].d : {}; }

  // ---------- 텔레그램 연결 (공식 web events) ----------

  function hasProxy() {
    try { return !!(window.TelegramWebviewProxy && typeof window.TelegramWebviewProxy.postEvent === "function"); } catch (e) { return false; }
  }
  function hasExternalNotify() {
    try { return !!(window.external && "notify" in window.external); } catch (e) { return false; }
  }
  function isFramed() {
    try { return window.parent !== window; } catch (e) { return true; }
  }

  function inTelegram() {
    if (hasProxy() || hasExternalNotify()) return true;
    return isFramed() && (C.hashParam(RAW_HASH, "tgWebAppData") !== null || C.hashParam(RAW_HASH, "tgWebAppVersion") !== null);
  }

  // 보냈으면 true.
  function postEvent(type, data) {
    var payload = data === undefined ? null : data;
    try {
      if (hasProxy()) {
        window.TelegramWebviewProxy.postEvent(type, JSON.stringify(payload));
        return true;
      }
      if (hasExternalNotify()) {
        window.external.notify(JSON.stringify({ eventType: type, eventData: payload }));
        return true;
      }
      if (isFramed()) {
        window.parent.postMessage(JSON.stringify({ eventType: type, eventData: payload }), "https://web.telegram.org");
        return true;
      }
    } catch (e) { /* 아래에서 false */ }
    return false;
  }

  function setClosingGuard(on) {
    if (S.closingGuard === on) return;
    S.closingGuard = on;
    postEvent("web_app_setup_closing_behavior", { need_confirmation: on });
  }

  // ---------- 색 ----------

  function applyTheme() {
    var p = C.parseThemeParams(RAW_HASH);
    if (!p) return;
    var st = document.documentElement.style;
    var page = p.secondary_bg_color || p.bg_color;
    var card = p.section_bg_color || p.bg_color;
    if (page) st.setProperty("--bg", page);
    if (card) st.setProperty("--card", card);
    if (p.text_color) st.setProperty("--text", p.text_color);
    if (p.hint_color) st.setProperty("--hint", p.hint_color);
    if (p.subtitle_text_color && !p.hint_color) st.setProperty("--hint", p.subtitle_text_color);
    if (p.link_color) st.setProperty("--link", p.link_color);
    if (p.button_color) st.setProperty("--btn", p.button_color);
    if (p.button_text_color) st.setProperty("--btn-text", p.button_text_color);
    if (p.section_separator_color) st.setProperty("--line", p.section_separator_color);
    var ref = p.bg_color || page;
    if (ref) document.documentElement.setAttribute("data-theme", C.luminance(ref) < 0.5 ? "dark" : "light");
  }

  // ---------- DOM 도우미 ----------

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = String(text);
    return e;
  }
  function add(parent) { for (var i = 1; i < arguments.length; i++) if (arguments[i]) parent.appendChild(arguments[i]); return parent; }
  function clear(e) { while (e.firstChild) e.removeChild(e.firstChild); }

  var uid = 0;
  function nextId() { uid++; return "f" + uid; }

  function select(options, current, onChange, label) {
    var s = el("select", "sel");
    if (label) s.setAttribute("aria-label", label);
    options.forEach(function (o) {
      var op = el("option", null, o[1]);
      op.value = String(o[0]);
      s.appendChild(op);
    });
    // 받은 값이 목록에 없으면 (범위 밖 등) 빈칸으로 보이지 않게 그 값을 그대로 넣어 둔다
    if (!options.some(function (o) { return String(o[0]) === String(current); })) {
      var extra = el("option", null, String(current));
      extra.value = String(current);
      s.appendChild(extra);
    }
    s.value = String(current);
    s.addEventListener("change", function () { onChange(s.value); });
    return s;
  }

  // 켜기/끄기 줄 (줄 전체를 눌러도 됨)
  function toggle(labelText, checked, onChange, sub) {
    var lab = el("label", "toggle");
    var txt = el("span", "toggle-text");
    add(txt, el("span", "toggle-label", labelText), sub ? el("span", "sub", sub) : null);
    var inp = el("input");
    inp.type = "checkbox";
    inp.setAttribute("role", "switch");
    inp.checked = !!checked;
    inp.addEventListener("change", function () { onChange(inp.checked); });
    add(lab, txt, inp, el("span", "switch"));
    lab.input = inp;
    return lab;
  }

  function button(text, cls, onClick) {
    var b = el("button", cls, text);
    b.type = "button";
    b.addEventListener("click", onClick);
    return b;
  }

  function fieldRow(labelText, control) {
    var r = el("div", "row");
    add(r, el("span", "row-label", labelText), control);
    return r;
  }

  // 분 고르기 (0,5,…,55 + 지금 값)
  function fillMinutes(sel, cur, forceZero, clock) {
    clear(sel);
    var vals = [];
    if (forceZero) vals = [0];
    else {
      for (var m = 0; m < 60; m += 5) vals.push(m);
      if (vals.indexOf(cur) < 0) { vals.push(cur); vals.sort(function (a, b) { return a - b; }); }
    }
    vals.forEach(function (m) { var o = el("option", null, clock ? C.pad2(m) : m + "분"); o.value = String(m); sel.appendChild(o); });
    sel.value = String(forceZero ? 0 : cur);
  }

  // 시각 고르기 ("HH:mm"). allow24 면 24:00 도 고를 수 있다.
  function timePicker(value, allow24, onChange, label) {
    var w = el("span", "timepick clock");
    var mins = C.parseMinute(value);
    if (mins === null) mins = 0;
    if (!allow24 && mins >= 1440) mins = 0; // 24:00 은 00:00 으로 보여 준다
    var h = el("select", "sel sel-small");
    var m = el("select", "sel sel-small");
    h.setAttribute("aria-label", (label || "") + " 시");
    m.setAttribute("aria-label", (label || "") + " 분");
    for (var i = 0; i <= (allow24 ? 24 : 23); i++) { var o = el("option", null, C.pad2(i)); o.value = String(i); h.appendChild(o); }
    h.value = String(Math.floor(mins / 60));
    fillMinutes(m, mins % 60, Math.floor(mins / 60) === 24, true);
    function changed() {
      var hh = +h.value;
      var mm = hh === 24 ? 0 : +m.value;
      fillMinutes(m, mm, hh === 24, true);
      onChange(C.pad2(hh) + ":" + C.pad2(mm));
    }
    h.addEventListener("change", changed);
    m.addEventListener("change", changed);
    add(w, h, el("span", "colon", ":"), m);
    return w;
  }

  // 시간 길이 고르기. opt: {value, nullable, nullLabel, zeroLabel, maxTotal, minTotal, def, label}
  function durationPicker(opt, onChange) {
    var w = el("div", "dur");
    var modes = [];
    if (opt.nullable) modes.push(["none", opt.nullLabel || "제한 없음"]);
    if (opt.zeroLabel) modes.push(["zero", opt.zeroLabel]);
    modes.push(["set", "시간 정하기"]);
    var cur = opt.value;
    function modeOf(v) { return v === null ? "none" : (v === 0 && opt.zeroLabel ? "zero" : "set"); }
    var hs = el("select", "sel sel-small");
    var ms = el("select", "sel sel-small");
    hs.setAttribute("aria-label", (opt.label || "") + " 시간");
    ms.setAttribute("aria-label", (opt.label || "") + " 분");
    var maxH = Math.floor(opt.maxTotal / 60);
    for (var i = 0; i <= maxH; i++) { var o = el("option", null, i + "시간"); o.value = String(i); hs.appendChild(o); }
    var hm = el("span", "timepick");
    add(hm, hs, ms);
    var modeSel = modes.length > 1 ? select(modes, modeOf(cur), function (v) {
      if (v === "none") cur = null;
      else if (v === "zero") cur = 0;
      else cur = (cur === null || (cur === 0 && opt.zeroLabel)) ? opt.def : cur;
      sync();
      onChange(cur);
    }, opt.label) : null;
    function sync() {
      var set = cur !== null && !(cur === 0 && opt.zeroLabel);
      hm.hidden = !set;
      if (set) {
        hs.value = String(Math.floor(cur / 60));
        fillMinutes(ms, cur % 60, cur >= opt.maxTotal && opt.maxTotal % 60 === 0);
      }
    }
    function hmChanged() {
      var t = (+hs.value) * 60 + (+ms.value);
      if (t > opt.maxTotal) t = opt.maxTotal;
      if (t < (opt.minTotal || 0)) t = opt.minTotal || 0;
      cur = t;
      if (modeSel) modeSel.value = modeOf(cur);
      sync();
      onChange(cur);
    }
    hs.addEventListener("change", hmChanged);
    ms.addEventListener("change", hmChanged);
    sync();
    add(w, modeSel, hm);
    return w;
  }

  // ---------- 바뀐 것 표시 ----------

  // key 의 바뀜·경고·오류를 보여 줄 곳을 등록한다.
  function register(key, box) {
    var warn = el("div", "warn");
    var err = el("div", "err");
    warn.hidden = true;
    err.hidden = true;
    add(box, warn, err);
    box.classList.add("field");
    S.regs[key] = { box: box, warn: warn, err: err };
  }

  // 앱이 속한 카테고리의 지금 값 ({m, l}) 또는 null.
  function catOfApp(id) {
    var apps = Array.isArray(D("apps").apps) ? D("apps").apps : [];
    for (var i = 0; i < apps.length; i++) {
      if (apps[i] && apps[i].id === id) return S.cur["cat:" + apps[i].c] || null;
    }
    return null;
  }
  function catModeOfApp(id) { var c = catOfApp(id); return c ? c.m : "t"; }
  function catLimitOfApp(id) { var c = catOfApp(id); return c && typeof c.l === "number" ? c.l : null; }

  function update(key, value) {
    S.cur[key] = value;
    S.actionErr = null;
    refresh();
  }

  function setActionErr(text, where) {
    S.actionErr = { text: text, where: where || "bar" };
    refresh();
  }

  var bar = {};
  var fresh = {};

  var SEC_SHORT = { time: "시간", apps: "앱", sites: "사이트", opts: "알림" };

  // 구역별 바뀐 것과 오류: [{sec, d, ch, errs}] (SECTIONS 순서)
  function changesBySec() {
    var all = C.diff(S.base, S.cur);
    return S.secs.map(function (x) {
      var ch = {};
      Object.keys(all).forEach(function (k) { if (S.keySec[k] === x.sec) ch[k] = all[k]; });
      return { sec: x.sec, d: x.d, ch: ch, errs: C.validate(ch, x.d) };
    });
  }

  function canSaveNow() { return !S.fresh || S.fresh.canSave; }

  function refresh() {
    var list = changesBySec();
    var ch = {}, errs = {}, n = 0, changedSecs = [];
    list.forEach(function (x) {
      var c = Object.keys(x.ch).length, ne = Object.keys(x.errs).length;
      Object.keys(x.ch).forEach(function (k) { ch[k] = x.ch[k]; });
      Object.keys(x.errs).forEach(function (k) { errs[k] = x.errs[k]; });
      n += c;
      if (c) changedSecs.push(x.sec);
      var t = S.tabs[x.sec];
      if (t) {
        t.btn.classList.toggle("dirty", c > 0);
        t.btn.classList.toggle("bad", ne > 0);
        t.btn.setAttribute("aria-label", t.label + (ne ? " (고칠 곳 있음)" : c ? " (바뀜)" : ""));
      }
    });
    var ctx = { catMode: catModeOfApp, catLimit: catLimitOfApp };
    Object.keys(S.regs).forEach(function (k) {
      var r = S.regs[k];
      var changed = k in ch;
      r.box.classList.toggle("changed", changed);
      var why = changed ? C.weakens(k, S.base[k], S.cur[k], ctx) : null;
      r.warn.hidden = !why;
      r.warn.textContent = why ? "⚠️ 보호가 약해집니다: " + why : "";
      var e = errs[k];
      r.err.hidden = !e;
      r.err.textContent = e ? "❗ " + e : "";
    });
    var ok = canSaveNow();
    bar.count.textContent = S.sent ? "보냈습니다" : (n ? "바뀐 항목 " + n + "개" +
      (changedSecs.length > 1 ? " (" + changedSecs.map(function (x) { return SEC_SHORT[x]; }).join("·") + ")" : "") : "바뀐 항목 없음");
    bar.save.disabled = S.sent || n === 0 || !ok;
    if (!S.sent) {
      var nerr = Object.keys(errs).length;
      var ae = S.actionErr && S.actionErr.where === "bar" ? S.actionErr.text : null;
      if (!ok) showBarMsg("이 버튼은 시간이 지나 저장할 수 없습니다. 맨 위의 [🔄 최신 값 받기]로 새 버튼을 받아 주세요.", "bad");
      else if (ae) showBarMsg(ae, "bad");
      else if (nerr) showBarMsg("고칠 곳이 " + nerr + "개 있습니다.", "bad");
      else showBarMsg("", "");
    }
    if (!n) S.rfArmed = false;
    if (fresh.msg && !S.sent) {
      if (S.actionErr && S.actionErr.where === "fresh") showFreshMsg(S.actionErr.text, "bad");
      else if (!S.rfArmed) fresh.msg.hidden = true;
    }
    setClosingGuard(!S.sent && n > 0);
    S.changed = n;
  }

  function showBarMsg(text, kind) {
    bar.msg.textContent = text;
    bar.msg.hidden = !text;
    bar.msg.className = "bar-msg" + (kind ? " " + kind : "");
  }

  function onSave() {
    if (S.sent) return;
    S.actionErr = null;
    if (!canSaveNow()) { refresh(); return; }
    var list = changesBySec();
    for (var i = 0; i < list.length; i++) {
      var keys = Object.keys(list[i].errs);
      if (!keys.length) continue;
      showTab(list[i].sec);
      setActionErr(list[i].errs[keys[0]], "bar");
      var r = S.regs[keys[0]];
      if (r && r.box.scrollIntoView) r.box.scrollIntoView({ block: "center", behavior: "smooth" });
      return;
    }
    var p = S.kind === "kg2" ? C.buildPayload2(list) : C.buildPayload(list[0].d, list[0].ch);
    if (p.error) { setActionErr(p.error, "bar"); return; }
    setClosingGuard(false);
    if (!postEvent("web_app_data_send", { data: p.text })) {
      setActionErr("텔레그램에 보내지 못했습니다. 텔레그램의 /settings 버튼으로 다시 열어 주세요.", "bar");
      return;
    }
    S.sent = true;
    refresh();
    if (fresh.btn) fresh.btn.disabled = true;
    var many = p.secs && p.secs.length > 1 ? " (" + p.secs.map(function (x) { return SEC_SHORT[x]; }).join("·") + " 한꺼번에)" : "";
    showBarMsg("보냈습니다" + many + ". 텔레그램 대화에서 '이렇게 바꿀까요?' 메시지의 [✅ 적용]을 눌러 주세요.", "good");
  }

  // ---------- 최신 값 알리기 (§7.5) ----------

  function showFreshMsg(text, kind) {
    fresh.msg.textContent = text;
    fresh.msg.hidden = !text;
    fresh.msg.className = "fresh-msg" + (kind ? " " + kind : "");
  }

  function updateFresh() {
    if (!fresh.box) return;
    S.fresh = C.freshness(S.top.at, S.kind === "kg2" ? S.top.ts : null, S.top.life, Date.now() / 1000);
    fresh.box.className = "fresh fresh-" + S.fresh.state;
    fresh.text.textContent = S.fresh.text;
    if (fresh.btn) fresh.btn.classList.toggle("small", S.fresh.state === "green" || S.fresh.state === "none");
    if (bar.count) refresh();
  }

  // 텔레그램 앱이 보내는 이벤트(window.Telegram.WebView.receiveEvent) 중 visibility_changed 만 본다.
  // telegram-web-app.js 는 쓰지 않는다. 이미 받는 함수가 있으면 그대로 이어서 부른다.
  function hookTelegramEvents() {
    function chain(prev) {
      return function (type) {
        try { if (type === "visibility_changed") updateFresh(); } catch (e) { /* 무시 */ }
        if (typeof prev === "function") return prev.apply(this, arguments);
      };
    }
    try {
      var T = window.Telegram;
      if (!T || typeof T !== "object") { T = {}; window.Telegram = T; }
      var W = T.WebView;
      if (!W || typeof W !== "object") { W = {}; T.WebView = W; }
      W.receiveEvent = chain(W.receiveEvent);
      // 예전 앱이 쓰는 이름
      window.TelegramGameProxy_receiveEvent = chain(window.TelegramGameProxy_receiveEvent);
    } catch (e) { /* 텔레그램 쪽 객체를 바꿀 수 없으면 15초 다시 계산만 */ }
  }

  // [🔄 최신 값 받기]: 노트북이 새 버튼을 보낸다. 저장 안 한 변경이 있으면 한 번 더 눌러야 한다.
  function onRefresh() {
    if (S.sent) return;
    S.actionErr = null;
    if (S.changed > 0 && !S.rfArmed) {
      S.rfArmed = true;
      showFreshMsg("바꾼 것은 저장되지 않습니다. 한 번 더 누르면 새로 받습니다", "warn-msg");
      return;
    }
    setClosingGuard(false);
    if (!postEvent("web_app_data_send", { data: C.REFRESH_TEXT })) {
      S.rfArmed = false;
      setActionErr("텔레그램에 보내지 못했습니다. 텔레그램에서 /settings 를 다시 보내 주세요.", "fresh");
      return;
    }
    S.sent = true;
    fresh.btn.disabled = true;
    refresh();
    showFreshMsg("새 값을 요청했습니다. 텔레그램 대화에 오는 새 버튼을 눌러 주세요.", "good");
    showBarMsg("", "");
  }

  // ---------- 구역별 화면 ----------

  function card(title, hint) {
    var c = el("section", "card");
    if (title) c.appendChild(el("h2", null, title));
    if (hint) c.appendChild(el("p", "hint", hint));
    return c;
  }

  // 사용 시간대 목록 편집
  function windowsEditor(key, box) {
    var list = el("div", "wlist");
    var addBtn = button("+ 시간대 추가", "btn-light", function () {
      var v = S.cur[key];
      if (v.w.length >= 6) return;
      var w = v.w.slice();
      w.push(v.w.length ? "19:00-21:00" : "15:00-21:00");
      update(key, { l: v.l, w: w });
      draw();
    });
    function draw() {
      clear(list);
      var v = S.cur[key];
      if (!v.w.length) list.appendChild(el("p", "hint", "시간대가 없으면 하루 종일 쓸 수 있습니다 (잠자는 시간 빼고)."));
      v.w.forEach(function (text, i) {
        var pw = C.parseWindow(text) || { s: 0, e: 0 };
        var row = el("div", "wrow");
        function set(part, hhmm) {
          var cv = S.cur[key];
          var w = cv.w.slice();
          var old = String(w[i]).split("-");
          var s = part === "s" ? hhmm : (old[0] || C.fmtMinute(pw.s));
          var e = part === "e" ? hhmm : (old[1] || C.fmtMinute(pw.e));
          w[i] = s + "-" + e;
          update(key, { l: cv.l, w: w });
        }
        // 잘못된 구간도 그대로 보여 준다 (검사 오류로 알림)
        var parts = text.split("-");
        var del = button("✕", "btn-x btn-x-small", function () {
          var cv = S.cur[key];
          var w = cv.w.slice();
          w.splice(i, 1);
          update(key, { l: cv.l, w: w });
          draw();
        });
        del.setAttribute("aria-label", "이 시간대 삭제");
        add(row,
          timePicker(parts[0] || C.fmtMinute(pw.s), false, function (t) { set("s", t); }, "시작"),
          el("span", "tilde", "~"),
          timePicker(parts[1] || C.fmtMinute(pw.e), true, function (t) { set("e", t); }, "끝"),
          del);
        list.appendChild(row);
      });
      addBtn.disabled = v.w.length >= 6;
    }
    draw();
    add(box, el("div", "sub-title", "사용 시간대"), list, addBtn);
  }

  function renderTime(main) {
    var daysCard = card("요일별 시간", "하루에 쓸 수 있는 시간과 쓸 수 있는 시간대를 정합니다.");
    main.appendChild(daysCard);
    for (var i = 1; i <= 7; i++) {
      (function (i) {
        var key = "d" + i;
        var box = el("div", "day");
        box.appendChild(el("h3", null, C.DAY_NAMES[i]));
        box.appendChild(fieldRow("하루 시간", durationPicker({
          value: S.cur[key].l, nullable: true, nullLabel: "제한 없음", zeroLabel: "사용 불가",
          maxTotal: 1440, def: 120, label: C.DAY_NAMES[i] + " 하루 시간"
        }, function (l) { update(key, { l: l, w: S.cur[key].w.slice() }); })));
        windowsEditor(key, box);
        register(key, box);
        daysCard.appendChild(box);
      })(i);
    }

    // 잠자는 시간
    var bed = card("잠자는 시간", "이 시간에는 노트북을 쓸 수 없습니다. 자정을 넘겨도 됩니다.");
    var bedRows = el("div", "subrows");
    function bedSet(part, v) { var b = C.clone(S.cur.bed); b[part] = v; update("bed", b); bedRows.classList.toggle("off", !S.cur.bed.e); }
    add(bed, toggle("잠자는 시간 켜기", S.cur.bed.e, function (on) { bedSet("e", on); }));
    add(bedRows,
      fieldRow("시작", timePicker(S.cur.bed.s, false, function (t) { bedSet("s", t); }, "잠자는 시간 시작")),
      fieldRow("끝", timePicker(S.cur.bed.t, false, function (t) { bedSet("t", t); }, "잠자는 시간 끝")));
    bedRows.classList.toggle("off", !S.cur.bed.e);
    bed.appendChild(bedRows);
    register("bed", bed);
    main.appendChild(bed);

    // 휴식
    var brk = card("휴식", "오래 쓰면 잠깐 쉬게 합니다.");
    var brkRows = el("div", "subrows");
    function brkSet(part, v) { var b = C.clone(S.cur.brk); b[part] = v; update("brk", b); brkRows.classList.toggle("off", !S.cur.brk.e); }
    var evOpts = [], lenOpts = [];
    // 범위는 부모 관리 앱과 같다: 간격 5분~10시간, 쉬는 시간 1분~2시간.
    for (var ev = 5; ev <= 600; ev += ev < 60 ? 5 : ev < 240 ? 10 : 30) evOpts.push([ev, C.fmtDuration(ev) + "마다"]);
    if (evOpts.every(function (o) { return o[0] !== S.cur.brk.ev; })) { evOpts.push([S.cur.brk.ev, C.fmtDuration(S.cur.brk.ev) + "마다"]); evOpts.sort(function (a, b) { return a[0] - b[0]; }); }
    for (var ln = 1; ln <= 120; ln += ln < 30 ? 1 : 5) lenOpts.push([ln, C.fmtDuration(ln)]);
    if (lenOpts.every(function (o) { return o[0] !== S.cur.brk.len; })) { lenOpts.push([S.cur.brk.len, C.fmtDuration(S.cur.brk.len)]); lenOpts.sort(function (a, b) { return a[0] - b[0]; }); }
    add(brk, toggle("휴식 켜기", S.cur.brk.e, function (on) { brkSet("e", on); }));
    add(brkRows,
      fieldRow("쉬는 간격", select(evOpts, S.cur.brk.ev, function (v) { brkSet("ev", +v); }, "쉬는 간격")),
      fieldRow("쉬는 시간", select(lenOpts, S.cur.brk.len, function (v) { brkSet("len", +v); }, "쉬는 시간")),
      toggle("강제 잠금", S.cur.brk.f, function (on) { brkSet("f", on); }, "쉬는 동안 화면을 잠급니다"));
    brkRows.classList.toggle("off", !S.cur.brk.e);
    brk.appendChild(brkRows);
    register("brk", brk);
    main.appendChild(brk);

    // 주간·넘기기·요청
    var more = card("한도와 요청");
    var wk = el("div", "item");
    add(wk, fieldRow("주간 한도", durationPicker({ value: S.cur.wk, nullable: true, maxTotal: 10080, def: 600, label: "주간 한도" },
      function (v) { update("wk", v); })), el("p", "hint", "일주일 동안 쓸 수 있는 전체 시간"));
    register("wk", wk);
    var co = el("div", "item");
    co.appendChild(toggle("주말로 넘기기", S.cur.co, function (on) { update("co", on); }, "평일에 남은 시간을 주말에 씁니다"));
    register("co", co);
    var mco = el("div", "item");
    mco.appendChild(fieldRow("넘기기 최대", durationPicker({ value: S.cur.mco, nullable: false, maxTotal: 1440, def: 60, label: "주말로 넘기기 최대" },
      function (v) { update("mco", v); })));
    register("mco", mco);
    var mrOpts = [["", "제한 없음"]];
    for (var r = 0; r <= 100; r++) mrOpts.push([r, r === 0 ? "0번 (요청 못 함)" : r + "번"]);
    var mr = el("div", "item");
    mr.appendChild(fieldRow("하루 요청 횟수", select(mrOpts, S.cur.mr === null ? "" : S.cur.mr,
      function (v) { update("mr", v === "" ? null : +v); }, "하루 요청 횟수")));
    register("mr", mr);
    var mx = el("div", "item");
    add(mx, fieldRow("하루 연장 최대", durationPicker({ value: S.cur.mx, nullable: true, maxTotal: 1440, def: 60, label: "하루 연장 최대" },
      function (v) { update("mx", v); })), el("p", "hint", "아이 요청으로 하루에 더 줄 수 있는 시간"));
    register("mx", mx);
    var aa = el("div", "item");
    aa.appendChild(toggle("시간이 끝난 뒤 항상 허용 앱 쓰기", S.cur.aa, function (on) { update("aa", on); }, "예: 학습 앱"));
    register("aa", aa);
    add(more, wk, co, mco, mr, mx, aa);
    main.appendChild(more);
  }

  var CAT_MODES = [["t", "시간 제한"], ["a", "항상 허용"], ["b", "사용 불가"]];
  var MODE_TEXT = { t: "시간 제한", a: "항상 허용", b: "사용 불가" };

  function limitPicker(key, labelText) {
    var wrap = el("div", "limit");
    add(wrap, fieldRow("하루 한도", durationPicker({ value: S.cur[key].l, nullable: true, nullLabel: "한도 없음", maxTotal: 1440, minTotal: 1, def: 60, label: labelText + " 하루 한도" },
      function (l) { update(key, { m: S.cur[key].m, l: l }); })));
    return wrap;
  }

  function renderApps(main) {
    var cats = card("카테고리", "앱 종류별로 정합니다. 시간 제한 = 하루 시간 안에서만 쓸 수 있음.");
    (Array.isArray(D("apps").cats) ? D("apps").cats : []).forEach(function (c) {
      var key = "cat:" + c.c;
      if (!(key in S.cur)) return;
      var row = el("div", "item");
      var cname = C.safeText(c.c);
      var lim = limitPicker(key, cname);
      lim.hidden = S.cur[key].m !== "t";
      add(row, fieldRow(cname, select(CAT_MODES, S.cur[key].m, function (m) {
        update(key, { m: m, l: S.cur[key].l });
        lim.hidden = m !== "t";
        refreshFollowLabels();
      }, cname + " 방식")), lim);
      register(key, row);
      cats.appendChild(row);
    });
    main.appendChild(cats);

    var appsCard = card("앱", null);
    var apps = Array.isArray(D("apps").apps) ? D("apps").apps : [];
    var followOpts = [];
    if (apps.length > 8) {
      var search = el("input", "search");
      search.type = "search";
      search.placeholder = "앱 이름 찾기";
      search.setAttribute("aria-label", "앱 이름 찾기");
      appsCard.appendChild(search);
      search.addEventListener("input", function () {
        var q = search.value.trim().toLowerCase();
        appRows.forEach(function (r) { r.box.hidden = !!q && r.name.toLowerCase().indexOf(q) < 0; });
      });
    }
    var appRows = [];
    apps.forEach(function (a) {
      if (!a || typeof a.id !== "string") return;
      var name = C.safeText(a.n || a.id);
      var row = el("div", "item app");
      var head = el("div", "app-head");
      add(head, el("span", "app-name", name), el("span", "app-cat", C.safeText(a.c || "")));
      row.appendChild(head);
      appRows.push({ box: row, name: name });
      if (a.ro === true) {
        var dis = select([[a.m || "f", a.m === "f" ? "카테고리 따름" : (Object.prototype.hasOwnProperty.call(MODE_TEXT, a.m) ? MODE_TEXT[a.m] : C.safeText(a.m))]], a.m || "f", function () {}, name + " 방식");
        dis.disabled = true;
        add(row, fieldRow("방식", dis), el("p", "hint ro", "보안 기본 규칙이라 부모 관리 앱에서만 바꿀 수 있습니다"));
        appsCard.appendChild(row);
        return;
      }
      var key = "app:" + a.id;
      var lim = limitPicker(key, name);
      lim.hidden = S.cur[key].m === "a" || S.cur[key].m === "b";
      var opts = [["f", followText(a.c)], ["t", "시간 제한"], ["a", "항상 허용"], ["b", "사용 불가"]];
      var sel = select(opts, S.cur[key].m, function (m) {
        update(key, { m: m, l: S.cur[key].l });
        lim.hidden = m === "a" || m === "b";
      }, name + " 방식");
      followOpts.push({ opt: sel.options[0], cat: a.c });
      add(row, fieldRow("방식", sel), lim);
      register(key, row);
      appsCard.appendChild(row);
    });
    if (!apps.length) appsCard.appendChild(el("p", "hint", "아직 관리하는 앱이 없습니다."));
    var more = C.intOrNull(D("apps").more);
    if (more !== null && more > 0) {
      appsCard.appendChild(el("p", "note", "앱이 많아 이름순 " + apps.length + "개만 보여 줍니다. 나머지 " + more + "개는 부모 관리 앱에서 바꿔 주세요."));
    }
    main.appendChild(appsCard);

    function followText(cat) {
      var c = S.cur["cat:" + cat];
      return "카테고리 따름" + (c ? " (" + MODE_TEXT[c.m] + ")" : "");
    }
    function refreshFollowLabels() { followOpts.forEach(function (f) { f.opt.textContent = followText(f.cat); }); }

    var newCard = card("새 프로그램");
    var na = el("div", "item");
    na.appendChild(fieldRow("새 프로그램 처리", select([["Ask", "부모에게 물어보기"], ["AllowAndNotify", "허용하고 알림만"], ["Block", "무조건 차단"]],
      S.cur.na, function (v) { update("na", v); }, "새 프로그램 처리")));
    register("na", na);
    var st = el("div", "item");
    st.appendChild(toggle("새 시작 앱 자동 끄기", S.cur.st, function (on) { update("st", on); }, "컴퓨터를 켤 때 저절로 시작되는 새 앱을 끕니다"));
    register("st", st);
    add(newCard, na, st);
    main.appendChild(newCard);
  }

  // 사이트 목록 편집 (한 줄에 하나)
  function siteListEditor(key, title, hint, placeholder) {
    var c = card(title, hint);
    var list = el("ul", "slist");
    var inp = el("input", "text");
    inp.type = "text";
    inp.placeholder = placeholder;
    inp.setAttribute("autocapitalize", "none");
    inp.setAttribute("autocorrect", "off");
    inp.setAttribute("spellcheck", "false");
    inp.setAttribute("inputmode", "url");
    inp.setAttribute("aria-label", title + " 추가");
    var msg = el("p", "err");
    msg.hidden = true;
    function addSites() {
      var parts = inp.value.split(/[\s,]+/).map(C.cleanNewSite).filter(function (s) { return s; });
      if (!parts.length) return;
      for (var i = 0; i < parts.length; i++) {
        var p = C.siteProblem(parts[i]);
        if (p) { msg.textContent = "❗ '" + parts[i] + "': " + p; msg.hidden = false; return; }
      }
      msg.hidden = true;
      var cur = S.cur[key].slice();
      parts.forEach(function (s) { if (cur.indexOf(s) < 0) cur.push(s); });
      inp.value = "";
      update(key, cur);
      draw();
    }
    inp.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); addSites(); } });
    var addRow = el("div", "addrow");
    add(addRow, inp, button("추가", "btn-light", addSites));
    function draw() {
      clear(list);
      var cur = S.cur[key];
      if (!cur.length) list.appendChild(el("li", "hint", "없음"));
      cur.forEach(function (s, i) {
        var li = el("li", "srow");
        add(li, el("span", "site", C.safeText(s)), button("삭제", "btn-x", function () {
          var v = S.cur[key].slice();
          v.splice(i, 1);
          update(key, v);
          draw();
        }));
        list.appendChild(li);
      });
    }
    draw();
    add(c, list, addRow, msg);
    register(key, c);
    return c;
  }

  function renderSites(main) {
    var prot = card("보호");
    [["ss", "세이프서치", "검색 결과에서 성인물을 가립니다"],
     ["pb", "시크릿 창 막기", "기록이 남지 않는 창을 못 열게 합니다"],
     ["ad", "성인·불법 웹툰 막기", null]].forEach(function (x) {
      var it = el("div", "item");
      it.appendChild(toggle(x[1], S.cur[x[0]], function (on) { update(x[0], on); }, x[2]));
      register(x[0], it);
      prot.appendChild(it);
    });
    main.appendChild(prot);
    main.appendChild(siteListEditor("bl", "차단 사이트", "이 사이트는 열 수 없습니다.", "예: youtube.com"));
    main.appendChild(siteListEditor("al", "허용 사이트", "다른 차단보다 먼저 허용합니다.", "예: school.go.kr"));

    // 텔레그램·자동으로 막은 사이트: 개수만 (사이트 이름은 방문 기록이라 화면에 보내지 않는다, 설계 §1.8). 읽기 전용.
    var exn = C.intOrNull(D("sites").exn);
    if (exn !== null && exn > 0) {
      main.appendChild(el("p", "note exn", "텔레그램·자동으로 막은 사이트 " + exn + "곳 – 풀려면 막힌 사이트 알림의 [풀기] 버튼이나 부모 관리 앱을 쓰세요."));
    }
  }

  function renderOpts(main) {
    if (S.kind === "kg2" && (S.bySec.time || S.bySec.apps || S.bySec.sites)) {
      main.appendChild(el("p", "note", "⚙️ 알림·DNS 는 노트북 전체 설정이라 모든 아이에게 똑같이 적용됩니다."));
    }
    var dnsCard = card("가족용 DNS", "노트북 전체에서 성인·위험 사이트를 한 번 더 막습니다.");
    var dns = el("div", "item");
    dns.appendChild(fieldRow("DNS", select([["None", "쓰지 않음"], ["Cloudflare", "Cloudflare 가족용"], ["CleanBrowsing", "CleanBrowsing 가족용"]],
      S.cur.dns, function (v) { update("dns", v); }, "가족용 DNS")));
    register("dns", dns);
    dnsCard.appendChild(dns);
    main.appendChild(dnsCard);

    var rep = card("리포트");
    var rt = el("div", "item");
    var rtTime = el("div", "subrows");
    var lastRt = S.cur.rt || "21:00";
    rtTime.appendChild(fieldRow("보낼 시각", timePicker(lastRt, false, function (t) { lastRt = t; update("rt", t); }, "매일 리포트 시각")));
    rtTime.hidden = S.cur.rt === "";
    rt.appendChild(toggle("매일 리포트 보내기", S.cur.rt !== "", function (on) {
      rtTime.hidden = !on;
      update("rt", on ? lastRt : "");
    }));
    rt.appendChild(rtTime);
    register("rt", rt);
    var wdOpts = [["", "끔"]];
    for (var i = 0; i < 7; i++) wdOpts.push([i, C.WEEKDAY_NAMES[i]]);
    var wd = el("div", "item");
    wd.appendChild(fieldRow("주간 리포트 요일", select(wdOpts, S.cur.wd === null ? "" : S.cur.wd, function (v) { update("wd", v === "" ? null : +v); }, "주간 리포트 요일")));
    register("wd", wd);
    add(rep, rt, wd);
    main.appendChild(rep);

    var al = card("알림");
    [["nt", "우회 시도 알림", "아이가 보호를 피하려 하면 알립니다"],
     ["no", "인터넷 끊김 알림", "노트북이 오래 연결되지 않으면 알립니다"],
     ["nl", "부모 앱 로그인 알림", "부모 관리 앱에 누가 들어가면 알립니다"]].forEach(function (x) {
      var it = el("div", "item");
      it.appendChild(toggle(x[1], S.cur[x[0]], function (on) { update(x[0], on); }, x[2]));
      register(x[0], it);
      al.appendChild(it);
    });
    main.appendChild(al);
  }

  // ---------- 📊 기록 탭 (§7.6) ----------

  // 카테고리 색 (부모 앱 ReportColors 와 같게)
  var CAT_COLORS = { "게임": "#2a78d6", "학습·문서": "#eb6834", "브라우저": "#1baf7a", "동영상·음악": "#eda100", "소셜·메신저": "#e87ba4", "도구·창작": "#008300", "기타": "#9a9893" };
  var DOW_SHORT = ["", "월", "화", "수", "목", "금", "토", "일"];
  var MORE_TEXT = function (n) { return "외 " + n + "개 – 부모 앱 [사용 기록]에서"; };

  function catColor(name) { return Object.prototype.hasOwnProperty.call(CAT_COLORS, name) ? CAT_COLORS[name] : CAT_COLORS["기타"]; }

  // 막대 위 짧은 글: "45분" / "1.5시간"
  function shortDur(sec) {
    if (sec < 60) return sec > 0 ? "1분 미만" : "";
    if (sec < 3600) return Math.floor(sec / 60) + "분";
    return (Math.round(sec / 360) / 10) + "시간";
  }
  function pct(part, whole) { return whole > 0 ? Math.max(0, Math.min(100, part / whole * 100)) : 0; }

  function tile(title, value, sub, kind) {
    var t = el("div", "tile" + (kind ? " " + kind : ""));
    add(t, el("div", "tile-title", title), el("div", "tile-value", value), sub ? el("div", "tile-sub", sub) : null);
    return t;
  }

  function moreLine(parent, n) { if (n > 0) parent.appendChild(el("p", "hint more", MORE_TEXT(n))); }

  function repSummary(p) {
    var c = card("요약");
    var g = el("div", "tiles");
    add(g, tile("화면 사용", C.fmtSeconds(p.sc), p.chg !== null ? p.pn + "보다 " + C.fmtChange(p.chg) : p.pn + " 기록 없음"));
    if (p.k === "w" && p.avg > 0) add(g, tile("하루 평균", C.fmtSeconds(p.avg), p.days.length ? p.days.length + "일 기준" : null));
    add(g, tile("하루 한도에 들어간 시간", C.fmtSeconds(p.ct), p.ov > 0 ? "한도 넘긴 날 " + p.ov + "일" : "한도 넘긴 날 없음", p.ov > 0 ? "bad" : null));
    if (p.fr + p.pa >= 60) add(g, tile("한도 밖 사용", C.fmtSeconds(p.fr + p.pa), "항상 허용·공부 " + C.fmtSeconds(p.fr) + " · 일시 해제 " + C.fmtSeconds(p.pa)));
    if (p.e !== null && p.la !== null) add(g, tile("가장 이른 · 늦은 사용", C.fmtClock(p.e) + " · " + C.fmtClock(p.la), "첫 사용 · 마지막 사용"));
    if (p.ls >= 60) add(g, tile("가장 긴 연속 사용", C.fmtSeconds(p.ls), "2분 넘게 쉬면 끊김"));
    add(g, tile("연장", p.ex > 0 ? C.fmtDuration(p.ex) : "없음", "요청 " + p.rq + "번"));
    add(g, tile("취침 시간 사용", p.bd > 0 ? C.fmtSeconds(p.bd) : "없음", "잠자는 시간에 쓴 시간", p.bd > 0 ? "bad" : null));
    c.appendChild(g);
    return c;
  }

  function repInsights(p) {
    var any = p.ins.some(function (x) { return x.imp; });
    var c = card("확인이 필요한 일");
    if (any) c.classList.add("alert");
    var ul = el("ul", "ins");
    if (!p.ins.length) ul.appendChild(el("li", "hint", "이 기간에 특별히 확인할 일은 없습니다."));
    p.ins.forEach(function (x) { ul.appendChild(el("li", x.imp ? "imp" : null, (x.imp ? "● " : "· ") + x.t)); });
    c.appendChild(ul);
    return c;
  }

  // 일별 사용 막대 (7일): 아래 = 하루 한도에 들어간 시간, 위 = 한도 밖. 빨간 선 = 그날의 하루 한도. 넘은 날은 빨강.
  function repDays(p) {
    var c = card("일별 사용", "빨간 선은 그날의 하루 한도입니다. 한도를 넘긴 날은 빨간 막대입니다.");
    var max = 3600;
    p.days.forEach(function (d) { max = Math.max(max, d.sc, d.ct, d.lim !== null ? d.lim * 60 : 0); });
    max *= 1.18; // 막대 위 글자 자리
    var chart = el("div", "bars");
    p.days.forEach(function (d) {
      var col = el("div", "bcol");
      var area = el("div", "barea");
      var counted = Math.min(d.ct, d.sc || d.ct);
      var stack = el("div", "bstack");
      stack.style.height = pct(Math.max(d.sc, d.ct), max) + "%";
      var free = el("div", "bfree");
      free.style.height = pct(Math.max(0, d.sc - counted), Math.max(d.sc, d.ct)) + "%";
      var cnt = el("div", "bcnt" + (d.over ? " over" : ""));
      cnt.style.height = pct(counted, Math.max(d.sc, d.ct)) + "%";
      add(stack, free, cnt);
      var val = el("div", "bval", shortDur(d.sc));
      val.style.bottom = pct(Math.max(d.sc, d.ct), max) + "%";
      add(area, stack, val);
      if (d.lim !== null) {
        var line = el("div", "blim");
        line.style.bottom = pct(d.lim * 60, max) + "%";
        area.appendChild(line);
      }
      col.title = d.date + " " + (DOW_SHORT[d.dow] || "") + ": 화면 " + C.fmtSeconds(d.sc) + " · 한도에 들어간 시간 " + C.fmtSeconds(d.ct) +
        (d.lim !== null ? " / 한도 " + C.fmtDuration(d.lim) : "") + (d.over ? " (한도 넘김)" : "");
      add(col, area, el("div", "bday" + (d.over ? " over" : ""), DOW_SHORT[d.dow] || "?"), el("div", "bdate", d.date));
      chart.appendChild(col);
    });
    c.appendChild(chart);
    var lg = el("div", "legend");
    add(lg, el("span", "lg lg-cnt", "한도에 들어간 시간"), el("span", "lg lg-free", "한도 밖"), el("span", "lg lg-lim", "하루 한도"));
    c.appendChild(lg);
    return c;
  }

  // 시간대별 색칸: 진할수록 많이. 잠자는 시간 칸은 빨간 테두리 (⏰ 탭의 잠자는 시간).
  function repHeat(p) {
    var c = card("시간대별 사용", "진할수록 많이 썼습니다. 빨간 테두리는 잠자는 시간입니다.");
    var bed = C.bedHours(S.bySec.time ? S.base.bed : null);
    var week = p.heat.length > 1;
    var max = 1;
    p.heat.forEach(function (row) { row.forEach(function (v) { max = Math.max(max, v); }); });
    var grid = el("div", "heat" + (week ? " week" : ""));
    p.heat.forEach(function (row, r) {
      var label = week ? (DOW_SHORT[r + 1] || "") : "";
      grid.appendChild(el("div", "hlabel", label));
      row.forEach(function (v, h) {
        var cell = el("div", "hcell" + (bed[h] ? " bed" : ""));
        if (v > 0) cell.style.backgroundColor = "rgba(42, 120, 214, " + (0.18 + 0.82 * Math.min(1, v / max)).toFixed(3) + ")";
        cell.title = (label ? label + "요일 " : "") + C.pad2(h) + ":00~" + C.pad2(h + 1) + ":00 · " + C.fmtDuration(v) + (bed[h] ? " · 취침 시간" : "");
        grid.appendChild(cell);
      });
    });
    grid.appendChild(el("div", "hlabel"));
    for (var h = 0; h < 24; h++) grid.appendChild(el("div", "haxis", h % 6 === 0 ? h + "시" : ""));
    c.appendChild(grid);
    var lg = el("div", "legend");
    add(lg, el("span", "lg lg-heat", "많이 씀"), el("span", "lg lg-bed", "잠자는 시간"));
    c.appendChild(lg);
    return c;
  }

  function repCats(p) {
    var c = card("카테고리별");
    var total = 0;
    p.cat.forEach(function (x) { total += x.s; });
    if (!p.cat.length) c.appendChild(el("p", "hint", "기록 없음"));
    p.cat.forEach(function (x) {
      var row = el("div", "share");
      var head = el("div", "share-head");
      var dot = el("span", "dot");
      dot.style.backgroundColor = catColor(x.n);
      add(head, dot, el("span", "share-name", x.n), el("span", "share-val", C.fmtSeconds(x.s) + " · " + Math.round(pct(x.s, total)) + "%"));
      var track = el("div", "track");
      var fill = el("div", "fill");
      fill.style.width = pct(x.s, total) + "%";
      fill.style.backgroundColor = catColor(x.n);
      track.appendChild(fill);
      add(row, head, track);
      c.appendChild(row);
    });
    return c;
  }

  // 많이 쓴 앱·많이 본 사이트 (지난 기간 대비)
  function repTop(title, hint, list, more, p, mono) {
    var c = card(title, hint);
    var top = list.length ? list[0].s : 0;
    list.forEach(function (x) { top = Math.max(top, x.s); });
    if (!list.length) c.appendChild(el("p", "hint", "기록 없음"));
    list.forEach(function (x) {
      var row = el("div", "share");
      var head = el("div", "share-head");
      add(head, el("span", "share-name" + (mono ? " site" : ""), x.n), el("span", "share-val", C.fmtSeconds(x.s)));
      var track = el("div", "track");
      var fill = el("div", "fill");
      fill.style.width = pct(x.s, top) + "%";
      track.appendChild(fill);
      var chg;
      if (x.p > 0) {
        var pc = Math.round((x.s - x.p) / x.p * 100);
        chg = el("div", "share-chg", p.pn + " " + C.fmtSeconds(x.p) + " → " + C.fmtChange(pc));
      } else chg = el("div", "share-chg", p.pn + " 기록 없음");
      add(row, head, track, chg);
      c.appendChild(row);
    });
    moreLine(c, more);
    return c;
  }

  function repVisits(p) {
    var nNew = 0, nBlocked = 0, anySeen = p.vis.some(function (v) { return (v.f & 4) !== 0; });
    p.vis.forEach(function (v) { if (v.f & 1) nNew++; if (v.f & 2) nBlocked++; });
    var total = p.vis.length + p.vm;
    var title = total ? "방문한 사이트 " + total + "곳" + (nNew ? " · 처음 " + nNew + "곳" : "") + (nBlocked ? " · 막힘 " + nBlocked + "곳" : "") : "방문한 사이트";
    var c = card(title, "사이트 이름만 기록합니다 (주소·검색어·제목은 남기지 않음).");
    if (!p.vis.length) c.appendChild(el("p", "hint", "기록 없음"));
    var ul = el("ul", "vlist");
    p.vis.forEach(function (v) {
      var li = el("li", "vrow");
      var badges = el("span", "badges");
      C.visitMarks(v.f, anySeen).forEach(function (m) { badges.appendChild(el("span", "badge" + (m === "막힘" ? " b-block" : m === "처음" ? " b-new" : " b-dim"), m)); });
      add(li, el("span", "site vsite", v.s), badges, p.k === "w" ? el("span", "vdays", v.d + "일") : null);
      ul.appendChild(li);
    });
    if (p.vis.length) c.appendChild(ul);
    moreLine(c, p.vm);
    return c;
  }

  function drawPeriod(box, p) {
    clear(box);
    var range = p.f && p.to ? (p.f === p.to ? p.f : p.f + " ~ " + p.to) : "";
    box.appendChild(el("p", "rep-range", p.nm + (range ? " (" + range + ")" : "")));
    add(box, repSummary(p), repInsights(p));
    if (p.k === "w" && p.days.length) box.appendChild(repDays(p));
    if (p.heat.length) box.appendChild(repHeat(p));
    add(box, repCats(p),
      repTop("많이 쓴 앱", null, p.app, p.am, p, false),
      repTop("많이 본 사이트 (브라우저)", null, p.site, p.sm, p, true),
      repVisits(p));
  }

  function renderReport(main) {
    if (!S.rep) {
      var c = card("📊 기록");
      c.appendChild(el("p", null, S.repn || "기록을 받지 못했습니다."));
      c.appendChild(el("p", "hint", "자세한 기록은 텔레그램의 📊 오늘 리포트 버튼이나 부모 앱 [사용 기록]에서 볼 수 있습니다."));
      main.appendChild(c);
      return;
    }
    var seg = el("div", "seg");
    seg.setAttribute("role", "group");
    seg.setAttribute("aria-label", "기간");
    var box = el("div", "rep-body");
    var btns = [];
    S.rep.p.forEach(function (p, i) {
      var b = button(p.nm, "seg-btn", function () {
        btns.forEach(function (x, j) { x.classList.toggle("on", j === i); x.setAttribute("aria-pressed", j === i ? "true" : "false"); });
        drawPeriod(box, p);
      });
      btns.push(b);
      seg.appendChild(b);
    });
    if (btns.length > 1) main.appendChild(seg);
    main.appendChild(box);
    btns[0].click();
    if (S.repn) main.appendChild(el("p", "note", S.repn));
  }

  // ---------- 시작 ----------

  var SEC_TITLE = { time: "⏰ 시간", apps: "📱 앱", sites: "🌐 사이트", opts: "⚙️ 알림·DNS" };
  var TAB_ORDER = ["time", "apps", "sites", "rep", "opts"];
  var TAB_INFO = { time: ["⏰", "시간"], apps: ["📱", "앱"], sites: ["🌐", "사이트"], rep: ["📊", "기록"], opts: ["⚙️", "알림"] };

  function showFatal(title, text) {
    var app = document.getElementById("app");
    clear(app);
    var box = el("div", "fatal");
    add(box, el("div", "fatal-icon", "🔒"), el("h1", null, title), el("p", null, text));
    app.appendChild(box);
    var b = document.getElementById("bar");
    if (b) b.hidden = true;
  }

  function showTab(name) {
    if (!S.panels[name]) return;
    var changed = S.tab !== name;
    S.tab = name;
    Object.keys(S.panels).forEach(function (k) { S.panels[k].hidden = k !== name; });
    Object.keys(S.tabs).forEach(function (k) {
      S.tabs[k].btn.classList.toggle("on", k === name);
      S.tabs[k].btn.setAttribute("aria-selected", k === name ? "true" : "false");
    });
    if (changed && window.scrollTo) window.scrollTo(0, 0);
  }

  function renderSection(sec, main) {
    if (sec === "time") renderTime(main);
    else if (sec === "apps") renderApps(main);
    else if (sec === "sites") renderSites(main);
    else if (sec === "rep") renderReport(main);
    else renderOpts(main);
  }

  function render() {
    var top = S.top;
    var app = document.getElementById("app");
    clear(app);
    var head = el("header", "top");
    var child = !!(S.bySec.time || S.bySec.apps || S.bySec.sites);
    if (S.kind === "kg1") {
      var d = S.secs[0].d;
      var who = d.sec === "opts" ? "전체 설정" : C.safeText(d.n || d.u);
      head.appendChild(el("h1", null, who + " · " + SEC_TITLE[d.sec]));
      head.appendChild(el("p", "meta", "기준: " + C.safeText(d.at || "?") + " · " + C.safeText(d.pc || "?")));
      if (d.sec === "time" && typeof d.today === "string" && d.today) head.appendChild(el("p", "today", C.safeText(d.today)));
    } else {
      head.appendChild(el("h1", null, child ? C.safeText(top.n || top.u) : "전체 설정"));
      head.appendChild(el("p", "meta", "노트북: " + C.safeText(top.pc || "?")));
      if (S.problems.length) {
        var pt = S.problems.slice(0, 4).join(" / ") + (S.problems.length > 4 ? " 외 " + (S.problems.length - 4) + "개" : "");
        head.appendChild(el("p", "note bad-note", "일부 설정을 읽지 못했습니다: " + C.safeText(pt).slice(0, 400)));
      }
      if (child && C.intOrNull(top.kids) !== null && top.kids > 1) {
        head.appendChild(el("p", "note kids", "다른 아이를 보려면 이 화면을 닫고(✕) 아래 버튼을 누르세요."));
      }
    }
    app.appendChild(head);

    // 맨 위에 늘 보이는 줄: 받은 값의 나이 + 탭
    var stick = el("div", "stick");
    fresh.box = el("div", "fresh");
    fresh.text = el("span", "fresh-text");
    fresh.btn = S.kind === "kg2" ? button("🔄 최신 값 받기", "btn-rf", onRefresh) : null;
    var frow = el("div", "fresh-row");
    add(frow, fresh.text, fresh.btn);
    fresh.msg = el("p", "fresh-msg");
    fresh.msg.hidden = true;
    add(fresh.box, frow, fresh.msg);
    stick.appendChild(fresh.box);

    var names = S.secs.map(function (x) { return x.sec; });
    if (S.kind === "kg2" && (S.rep || S.repn)) names.push("rep");
    names = TAB_ORDER.filter(function (n) { return names.indexOf(n) >= 0; });
    if (S.kind === "kg2" && names.length > 1) {
      var tabs = el("nav", "tabs");
      tabs.setAttribute("role", "tablist");
      names.forEach(function (n) {
        var b = button("", "tab", function () { showTab(n); });
        b.setAttribute("role", "tab");
        add(b, el("span", "tab-icon", TAB_INFO[n][0]), el("span", "tab-label", TAB_INFO[n][1]), el("span", "tab-dot"));
        S.tabs[n] = { btn: b, label: TAB_INFO[n][0] + " " + TAB_INFO[n][1] };
        b.setAttribute("aria-label", S.tabs[n].label);
        tabs.appendChild(b);
      });
      stick.appendChild(tabs);
    }
    app.appendChild(stick);

    names.forEach(function (n) {
      var main = el("main", "main");
      main.setAttribute("data-tab", n);
      if (S.kind === "kg2" && n === "time" && typeof top.today === "string" && top.today) main.appendChild(el("p", "today", C.safeText(top.today)));
      renderSection(n, main);
      S.panels[n] = main;
      app.appendChild(main);
    });
    showTab(names[0]);

    var b = document.getElementById("bar");
    b.hidden = false;
    bar.count = document.getElementById("bar-count");
    bar.save = document.getElementById("bar-save");
    bar.msg = document.getElementById("bar-msg");
    bar.save.addEventListener("click", onSave);
    updateFresh();
    refresh();
    // 15초마다 다시 계산 (텔레그램을 내렸다 다시 열 때도)
    window.setInterval(updateFresh, 15000);
    document.addEventListener("visibilitychange", function () { if (!document.hidden) updateFresh(); });
    window.addEventListener("pageshow", updateFresh);
    window.addEventListener("focus", updateFresh);
    hookTelegramEvents();
  }

  // 구역 값들을 상태에 넣는다 (키는 구역끼리 겹치지 않는다. 겹치면 앞 구역 것만).
  function load(kind, top, secs) {
    S.kind = kind;
    S.top = top;
    secs.forEach(function (d) {
      var b = C.baseValues(d);
      var x = { sec: d.sec, d: d, base: b };
      S.secs.push(x);
      S.bySec[d.sec] = x;
      Object.keys(b).forEach(function (k) {
        if (Object.prototype.hasOwnProperty.call(S.keySec, k)) return;
        S.keySec[k] = d.sec;
        S.base[k] = b[k];
      });
    });
    S.cur = C.clone(S.base);
    if (kind === "kg2") {
      S.rep = C.normReport(top.rep);
      S.repn = typeof top.repn === "string" && top.repn ? C.safeText(top.repn).slice(0, 300) : null;
    }
  }

  function start() {
    applyTheme();
    var tg = inTelegram();
    if (tg) { postEvent("web_app_ready"); postEvent("web_app_expand"); }
    var launch = C.extractLaunch(RAW_HASH);
    if (!tg || !launch) {
      showFatal("텔레그램에서 열어 주세요", "텔레그램의 /settings 버튼으로 열어 주세요. 이 화면은 KidGuard 봇이 보낸 버튼으로만 쓸 수 있습니다.");
      return;
    }
    if (!C.hasDecompression()) {
      showFatal("업데이트가 필요합니다", "아이폰을 iOS 16.4 이상으로 업데이트해 주세요. (안드로이드·PC는 텔레그램 앱을 최신으로 바꿔 주세요.)");
      return;
    }
    C.decodeLaunch(launch.body).then(function (d) {
      var problem;
      if (launch.kind === "kg2") {
        problem = C.checkLaunch2(d);
        if (problem) { showFatal("열 수 없습니다", problem); return; }
        var sp = C.splitLaunch2(d);
        if (!sp.secs.length) { showFatal("열 수 없습니다", sp.problems[0] || "설정 값을 읽지 못했습니다. 텔레그램에서 /settings 를 다시 보내 주세요."); return; }
        load("kg2", d, sp.secs);
        S.problems = sp.problems;
      } else {
        problem = C.checkLaunch(d);
        if (problem) { showFatal("열 수 없습니다", problem); return; }
        load("kg1", d, [d]);
      }
      render();
    }, function (e) {
      if (e && e.message === "nodecomp") showFatal("업데이트가 필요합니다", "아이폰을 iOS 16.4 이상으로 업데이트해 주세요.");
      else showFatal("열 수 없습니다", "설정 값을 읽지 못했습니다. 텔레그램에서 /settings 를 다시 보내 주세요.");
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
