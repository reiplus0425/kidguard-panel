// KidGuard 설정 화면 - 순수 함수 모음 (화면 그리기 없음, node 테스트에서도 그대로 씀).
// 값 형식은 docs/텔레그램-미니앱-설계.md §3·§4 를 따른다. 마지막 검사는 노트북이 다시 한다.
"use strict";

(function (root) {
  var MAX_BYTES = 4096;
  var MAX_KEYS = 60;
  // 풀어낸 값의 최대 크기 (압축 폭탄 막기). 노트북 주소는 4000자 이하라 보통 수십 KB.
  var MAX_JSON_BYTES = 512 * 1024;
  var DAY_NAMES = ["", "월요일", "화요일", "수요일", "목요일", "금요일", "토요일", "일요일"];
  var WEEKDAY_NAMES = ["일요일", "월요일", "화요일", "수요일", "목요일", "금요일", "토요일"];
  var SECTIONS = ["time", "apps", "sites", "opts"];

  // ---------- 주소(#) 읽기 ----------

  // # 뒤 글에서 "kg1." 로 시작하는 조각을 & 또는 ? 앞까지 꺼낸다 ("kg1." 은 뺀다). 없으면 null.
  function extractKg1(hash) {
    if (typeof hash !== "string") return null;
    var s = hash.charAt(0) === "#" ? hash.slice(1) : hash;
    var pieces = s.split(/[&?]/);
    for (var i = 0; i < pieces.length; i++) {
      if (pieces[i].indexOf("kg1.") === 0) {
        var body = pieces[i].slice(4);
        return /^[A-Za-z0-9_-]+$/.test(body) ? body : null;
      }
    }
    return null;
  }

  // # 뒤 글의 key=value 값 하나 (URL 인코딩 풀어서). 없으면 null.
  function hashParam(hash, name) {
    if (typeof hash !== "string") return null;
    var s = hash.charAt(0) === "#" ? hash.slice(1) : hash;
    var pieces = s.split(/[&?]/);
    for (var i = 0; i < pieces.length; i++) {
      var eq = pieces[i].indexOf("=");
      if (eq <= 0) continue;
      if (pieces[i].slice(0, eq) !== name) continue;
      try { return decodeURIComponent(pieces[i].slice(eq + 1).replace(/\+/g, "%20")); } catch (e) { return null; }
    }
    return null;
  }

  // 텔레그램 색 (tgWebAppThemeParams). 올바른 #rrggbb 색만 돌려준다.
  function parseThemeParams(hash) {
    var raw = hashParam(hash, "tgWebAppThemeParams");
    if (!raw) return null;
    var obj;
    try { obj = JSON.parse(raw); } catch (e) { return null; }
    if (!obj || typeof obj !== "object") return null;
    var out = {};
    var n = 0;
    Object.keys(obj).forEach(function (k) {
      if (/^[a-z_]{1,40}$/.test(k) && typeof obj[k] === "string" && /^#[0-9a-fA-F]{6}$/.test(obj[k])) {
        out[k] = obj[k].toLowerCase();
        n++;
      }
    });
    return n ? out : null;
  }

  // 밝기(0~1). 색이 어두운지 보는 데 쓴다.
  function luminance(hex) {
    var r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  }

  function base64UrlToBytes(s) {
    if (typeof s !== "string" || !/^[A-Za-z0-9_-]*$/.test(s) || s.length % 4 === 1) throw new Error("base64url");
    var b64 = s.replace(/-/g, "+").replace(/_/g, "/");
    while (b64.length % 4) b64 += "=";
    var bin = atob(b64);
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function hasDecompression() {
    if (typeof DecompressionStream === "undefined") return false;
    try { new DecompressionStream("deflate-raw"); return true; } catch (e) { return false; }
  }

  // kg1 조각 → JSON 객체. 실패하면 Error (message: "nodecomp" | "decode" | "json").
  function decodeLaunch(body) {
    if (!hasDecompression()) return Promise.reject(new Error("nodecomp"));
    var bytes;
    try { bytes = base64UrlToBytes(body); } catch (e) { return Promise.reject(new Error("decode")); }
    var stream;
    try {
      stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    } catch (e) { return Promise.reject(new Error("decode")); }
    return readCapped(stream, MAX_JSON_BYTES).then(function (buf) {
      var text;
      try { text = new TextDecoder("utf-8", { fatal: true }).decode(buf); } catch (e) { throw new Error("decode"); }
      var obj;
      try { obj = JSON.parse(text); } catch (e) { throw new Error("json"); }
      if (!obj || typeof obj !== "object" || Array.isArray(obj)) throw new Error("json");
      return obj;
    }, function () { throw new Error("decode"); });
  }

  // 스트림을 끝까지 읽되 cap 바이트를 넘으면 멈추고 실패 (Uint8Array).
  function readCapped(stream, cap) {
    var reader = stream.getReader();
    var chunks = [], total = 0;
    function pump() {
      return reader.read().then(function (r) {
        if (r.done) {
          var out = new Uint8Array(total), at = 0;
          chunks.forEach(function (c) { out.set(c, at); at += c.length; });
          return out;
        }
        total += r.value.length;
        if (total > cap) {
          try { reader.cancel(); } catch (e) { /* 무시 */ }
          throw new Error("big");
        }
        chunks.push(r.value);
        return pump();
      });
    }
    return pump();
  }

  // 받은 값의 공통 부분 검사. 문제가 있으면 부모에게 보여 줄 글, 없으면 null.
  function checkLaunch(d) {
    if (!d || typeof d !== "object") return "설정 값을 읽지 못했습니다. 텔레그램에서 /settings 를 다시 보내 주세요.";
    if (d.v !== 1) return "노트북 프로그램과 설정 화면의 버전이 맞지 않습니다. 노트북의 KidGuard 를 최신으로 바꾼 뒤 /settings 를 다시 보내 주세요.";
    if (SECTIONS.indexOf(d.sec) < 0) return "알 수 없는 설정 구역입니다. 텔레그램에서 /settings 를 다시 보내 주세요.";
    if (typeof d.sid !== "string" || !/^[0-9a-f]{16}$/.test(d.sid)) return "설정 값을 읽지 못했습니다. 텔레그램에서 /settings 를 다시 보내 주세요.";
    if (d.sec !== "opts" && (typeof d.u !== "string" || !d.u)) return "아이 정보가 없습니다. 텔레그램에서 /settings 를 다시 보내 주세요.";
    return null;
  }

  // ---------- 작은 도우미 ----------

  function pad2(n) { return (n < 10 ? "0" : "") + n; }
  function fmtMinute(m) { return pad2(Math.floor(m / 60)) + ":" + pad2(m % 60); }
  function isInt(v) { return typeof v === "number" && isFinite(v) && Math.floor(v) === v; }
  function intOr(v, def) { return isInt(v) ? v : def; }
  function intOrNull(v) { return isInt(v) ? v : null; }
  function boolOr(v, def) { return typeof v === "boolean" ? v : def; }
  function strOr(v, def) { return typeof v === "string" ? v : def; }

  // "HH:mm" → 분 (0~1440, 24:00 허용). 틀리면 null.
  function parseMinute(text) {
    if (typeof text !== "string") return null;
    var m = /^(\d{1,2}):(\d{2})$/.exec(text.trim());
    if (!m) return null;
    var h = +m[1], mi = +m[2];
    if (h > 24 || mi > 59 || (h === 24 && mi !== 0)) return null;
    return h * 60 + mi;
  }

  function isHHmm(text) { return typeof text === "string" && /^\d{2}:\d{2}$/.test(text) && parseMinute(text) !== null; }
  // 시각 (00:00~23:59). 잠자는 시간·리포트 시각은 노트북이 24:00 을 받지 않는다.
  function isClock(text) { return isHHmm(text) && parseMinute(text) < 1440; }

  // "HH:mm-HH:mm" → {s,e} (s<e). 틀리면 null.
  function parseWindow(text) {
    if (typeof text !== "string") return null;
    var p = text.split(/[-~]/);
    if (p.length !== 2) return null;
    var s = parseMinute(p[0]), e = parseMinute(p[1]);
    if (s === null || e === null || s >= e) return null;
    return { s: s, e: e };
  }

  function fmtWindow(w) { return fmtMinute(w.s) + "-" + fmtMinute(w.e); }

  // 받은 시간대 글을 같은 모양(HH:mm-HH:mm)으로. 읽을 수 없는 것은 그대로 둔다.
  function normWindowText(text) { var w = parseWindow(text); return w ? fmtWindow(w) : String(text); }

  // 분 → "1시간 30분"
  function fmtDuration(min) {
    if (min === null || min === undefined) return "제한 없음";
    var h = Math.floor(min / 60), m = min % 60;
    if (!h) return m + "분";
    return m ? h + "시간 " + m + "분" : h + "시간";
  }

  // 사이트 주소 정리 (노트북 PanelData.NormSite·부모 관리 앱과 같은 규칙): 앞뒤 공백 제거 → 소문자 → 앞의 http(s):// 떼기 → 끝의 / 떼기.
  // 경로가 붙은 항목(예: youtube.com/shorts)은 그 경로만 막는 것이므로 경로는 그대로 둔다.
  function normalizeSite(text) {
    return String(text || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/+$/, "");
  }

  // 부모가 새로 적은 주소: 목록의 항목과 같은 규칙.
  var cleanNewSite = normalizeSite;

  // 보이지 않는 서식 글자 (노트북은 Unicode 'Format' 글자를 받지 않는다)
  var FORMAT_CHAR = (function () {
    try { return new RegExp("\\p{Cf}", "u"); } catch (e) { return /[\u00ad\u0600-\u0605\u061c\u06dd\u070f\u180e\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u206f\ufeff\ufff9-\ufffb]/; }
  })();

  // 사이트 하나 검사. 문제가 있으면 글, 없으면 null.
  function siteProblem(s) {
    if (!s) return "빈 주소";
    if (s.length > 253) return "주소가 너무 깁니다";
    if (/[\s\u0000-\u001f\u007f-\u009f]/.test(s)) return "주소에 공백이 있습니다";
    if (FORMAT_CHAR.test(s)) return "주소에 보이지 않는 글자가 있습니다";
    if (s.indexOf(".") < 0) return "주소에 점(.)이 없습니다 (예: youtube.com)";
    return null;
  }

  // 목록 정리: 소문자·공백 제거·빈 것과 중복 빼기 (순서 유지).
  function normalizeSiteList(list) {
    var out = [], seen = {};
    (list || []).forEach(function (x) {
      var s = normalizeSite(x);
      if (!s || seen["$" + s]) return;
      seen["$" + s] = true;
      out.push(s);
    });
    return out;
  }

  // ---------- 처음 값 (키 → 값) ----------

  // 받은 값에서 화면이 바꿀 수 있는 키와 그 처음 값을 만든다 (§4 모양 그대로).
  function baseValues(d) {
    var b = {};
    if (d.sec === "time") {
      var days = Array.isArray(d.days) ? d.days : [];
      for (var i = 1; i <= 7; i++) {
        var day = null;
        for (var j = 0; j < days.length; j++) if (days[j] && days[j].d === i) day = days[j];
        b["d" + i] = {
          l: day ? intOrNull(day.l) : null,
          w: day && Array.isArray(day.w) ? uniq(day.w.filter(function (x) { return typeof x === "string"; }).map(normWindowText)) : []
        };
      }
      var bed = d.bed || {};
      b.bed = { e: boolOr(bed.e, false), s: isHHmm(bed.s) ? bed.s : "21:30", t: isHHmm(bed.t) ? bed.t : "07:00" };
      var brk = d.brk || {};
      b.brk = { e: boolOr(brk.e, false), ev: intOr(brk.ev, 50), len: intOr(brk.len, 10), f: boolOr(brk.f, false) };
      b.wk = intOrNull(d.wk);
      b.co = boolOr(d.co, false);
      b.mco = intOr(d.mco, 60);
      b.mr = intOrNull(d.mr);
      b.mx = intOrNull(d.mx);
      b.aa = boolOr(d.aa, true);
    } else if (d.sec === "apps") {
      (Array.isArray(d.cats) ? d.cats : []).forEach(function (c) {
        if (!c || typeof c.c !== "string" || Object.prototype.hasOwnProperty.call(b, "cat:" + c.c)) return;
        b["cat:" + c.c] = { m: ["t", "a", "b"].indexOf(c.m) >= 0 ? c.m : "t", l: intOrNull(c.l) };
      });
      (Array.isArray(d.apps) ? d.apps : []).forEach(function (a) {
        if (!a || typeof a.id !== "string" || a.ro === true || Object.prototype.hasOwnProperty.call(b, "app:" + a.id)) return;
        b["app:" + a.id] = { m: ["f", "t", "a", "b"].indexOf(a.m) >= 0 ? a.m : "f", l: intOrNull(a.l) };
      });
      b.na = ["Ask", "AllowAndNotify", "Block"].indexOf(d.na) >= 0 ? d.na : "Ask";
      b.st = boolOr(d.st, true);
    } else if (d.sec === "sites") {
      b.ss = boolOr(d.ss, false);
      b.pb = boolOr(d.pb, false);
      b.ad = boolOr(d.ad, false);
      b.bl = normalizeSiteList(Array.isArray(d.bl) ? d.bl : []);
      b.al = normalizeSiteList(Array.isArray(d.al) ? d.al : []);
      // 텔레그램·자동으로 막은 사이트는 개수(exn)만 받는다 (§1.8). 풀기는 화면에서 하지 않는다.
    } else if (d.sec === "opts") {
      b.dns = ["None", "Cloudflare", "CleanBrowsing"].indexOf(d.dns) >= 0 ? d.dns : "None";
      b.rt = isHHmm(d.rt) ? d.rt : "";
      b.wd = isInt(d.wd) && d.wd >= 0 && d.wd <= 6 ? d.wd : null;
      b.nt = boolOr(d.nt, true);
      b.no = boolOr(d.no, true);
      b.nl = boolOr(d.nl, true);
    }
    return b;
  }

  // 같은 글 빼기 (순서 유지). 노트북도 같은 시간대는 하나만 둔다.
  function uniq(list) {
    var out = [];
    list.forEach(function (x) { if (out.indexOf(x) < 0) out.push(x); });
    return out;
  }

  function clone(v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }

  // 비교용 모양: 사이트 목록은 순서 무시.
  function canon(key, v) {
    if ((key === "bl" || key === "al") && Array.isArray(v)) return JSON.stringify(normalizeSiteList(v).slice().sort());
    return JSON.stringify(v);
  }

  // 바뀐 키만 (보낼 모양으로).
  function diff(base, cur) {
    var ch = {};
    Object.keys(cur).forEach(function (k) {
      if (!(k in base)) return;
      if (canon(k, base[k]) !== canon(k, cur[k])) ch[k] = outValue(k, cur[k]);
    });
    return ch;
  }

  function outValue(k, v) {
    if (k === "bl" || k === "al") return normalizeSiteList(v);
    if (/^d[1-7]$/.test(k)) return { l: v.l, w: uniq(v.w.map(normWindowText)) };
    return clone(v);
  }

  // ---------- 검사 (§4) ----------

  function rangeOk(v, lo, hi) { return isInt(v) && v >= lo && v <= hi; }
  function rangeOrNull(v, lo, hi) { return v === null || rangeOk(v, lo, hi); }

  // 바뀐 키 하나 검사. 문제가 있으면 한국어 글, 없으면 null. d = 받은 값 (카테고리·앱 이름에 씀).
  function validateKey(k, v, d) {
    var m;
    if ((m = /^d([1-7])$/.exec(k))) {
      var day = DAY_NAMES[+m[1]];
      if (!v || typeof v !== "object") return day + ": 형식이 잘못되었습니다.";
      if (!rangeOrNull(v.l, 0, 1440)) return day + ": 하루 시간은 0분~24시간이어야 합니다.";
      if (!Array.isArray(v.w)) return day + ": 시간대 형식이 잘못되었습니다.";
      if (v.w.length > 6) return day + ": 사용 시간대는 6개까지 넣을 수 있습니다.";
      for (var i = 0; i < v.w.length; i++) {
        if (!parseWindow(v.w[i])) return day + ": 사용 시간대 '" + v.w[i] + "' 가 잘못되었습니다. 끝 시각이 시작보다 늦어야 합니다 (자정을 넘으면 잠자는 시간으로 정해 주세요).";
      }
      return null;
    }
    switch (k) {
      case "bed":
        if (!v || typeof v !== "object" || typeof v.e !== "boolean" || !isClock(v.s) || !isClock(v.t)) return "잠자는 시간: 시각이 잘못되었습니다.";
        if (v.e && v.s === v.t) return "잠자는 시간: 시작과 끝이 같습니다.";
        return null;
      case "brk":
        if (!v || typeof v !== "object" || typeof v.e !== "boolean" || typeof v.f !== "boolean") return "휴식: 형식이 잘못되었습니다.";
        // 범위는 부모 관리 앱 입력 칸·노트북 검사와 같다.
        if (!rangeOk(v.ev, 5, 600)) return "휴식: 쉬는 간격은 5분~10시간이어야 합니다.";
        if (!rangeOk(v.len, 1, 120)) return "휴식: 쉬는 시간은 1분~2시간이어야 합니다.";
        return null;
      case "wk": return rangeOrNull(v, 0, 10080) ? null : "주간 한도는 0분~168시간이어야 합니다.";
      case "mco": return rangeOk(v, 0, 1440) ? null : "주말로 넘기기 최대는 0분~24시간이어야 합니다.";
      case "mr": return rangeOrNull(v, 0, 100) ? null : "하루 요청 횟수는 0~100번이어야 합니다.";
      case "mx": return rangeOrNull(v, 0, 1440) ? null : "하루 연장 최대는 0분~24시간이어야 합니다.";
      case "co": case "aa": case "st": case "ss": case "pb": case "ad": case "nt": case "no": case "nl":
        return typeof v === "boolean" ? null : "형식이 잘못되었습니다.";
      case "na": return ["Ask", "AllowAndNotify", "Block"].indexOf(v) >= 0 ? null : "새 프로그램 처리 값이 잘못되었습니다.";
      case "dns": return ["None", "Cloudflare", "CleanBrowsing"].indexOf(v) >= 0 ? null : "가족용 DNS 값이 잘못되었습니다.";
      case "rt": return v === "" || isClock(v) ? null : "매일 리포트 시각이 잘못되었습니다.";
      case "wd": return v === null || rangeOk(v, 0, 6) ? null : "주간 리포트 요일이 잘못되었습니다.";
      case "bl": case "al":
        var name = k === "bl" ? "차단 사이트" : "허용 사이트";
        if (!Array.isArray(v)) return name + ": 형식이 잘못되었습니다.";
        if (v.length > 300) return name + "는 300개까지 넣을 수 있습니다.";
        for (var j = 0; j < v.length; j++) {
          var p = siteProblem(v[j]);
          if (p) return name + " '" + v[j] + "': " + p + ".";
        }
        return null;
    }
    if (k.indexOf("cat:") === 0) {
      if (!v || ["t", "a", "b"].indexOf(v.m) < 0) return k.slice(4) + ": 방식이 잘못되었습니다.";
      if (!rangeOrNull(v.l, 1, 1440)) return k.slice(4) + ": 하루 한도는 1분~24시간이어야 합니다.";
      return null;
    }
    if (k.indexOf("app:") === 0) {
      var an = appName(d, k.slice(4));
      if (!v || ["f", "t", "a", "b"].indexOf(v.m) < 0) return an + ": 방식이 잘못되었습니다.";
      if (!rangeOrNull(v.l, 1, 1440)) return an + ": 하루 한도는 1분~24시간이어야 합니다.";
      return null;
    }
    return "알 수 없는 항목입니다: " + k;
  }

  function appName(d, id) {
    var apps = d && Array.isArray(d.apps) ? d.apps : [];
    for (var i = 0; i < apps.length; i++) if (apps[i] && apps[i].id === id) return String(apps[i].n || id);
    return id;
  }

  // 바뀐 것 전체 검사 → {키: 글} (문제 없으면 빈 객체).
  function validate(ch, d) {
    var errs = {};
    Object.keys(ch).forEach(function (k) {
      var e = validateKey(k, ch[k], d);
      if (e) errs[k] = e;
    });
    return errs;
  }

  // ---------- 보호가 약해지는지 (§4 ⚠️, 대략. 노트북이 최종 판단) ----------

  function windowSet(list) {
    // 시간대가 없으면 하루 종일 허용
    var set = new Uint8Array(1440);
    var ws = (list || []).map(parseWindow).filter(Boolean);
    if (!ws.length) { set.fill(1); return set; }
    ws.forEach(function (w) { for (var i = w.s; i < w.e && i < 1440; i++) set[i] = 1; });
    return set;
  }

  function bedSet(b) {
    var set = new Uint8Array(1440);
    if (!b || !b.e) return set;
    var s = parseMinute(b.s), t = parseMinute(b.t);
    if (s === null || t === null) return set;
    s %= 1440; t %= 1440;
    for (var i = s; i !== t; i = (i + 1) % 1440) set[i] = 1;
    return set;
  }

  function hasExtra(a, b) { for (var i = 0; i < 1440; i++) if (a[i] && !b[i]) return true; return false; }

  // 두 한도 중 작은 것 (null = 제한 없음)
  function minLimit(a, b) { return a === null || a === undefined ? (b === undefined ? null : b) : (b === null || b === undefined ? a : Math.min(a, b)); }

  // 숫자 한도가 늘거나 없어졌는지 (null = 제한 없음)
  function limitLoosened(oldV, newV) {
    if (newV === null) return oldV !== null;
    if (oldV === null) return false;
    return newV > oldV;
  }

  var MODE_RANK = { b: 0, t: 1, a: 2 };

  // 약해지는 까닭 (짧은 글) 또는 null.
  function weakens(k, oldV, newV, ctx) {
    if (/^d[1-7]$/.test(k)) {
      if (newV.l === 0) return null; // 이 요일 사용 불가면 시간대와 상관없이 약해지지 않음 (노트북과 같은 규칙)
      if (limitLoosened(oldV.l, newV.l)) return newV.l === null ? "하루 시간 제한을 없앱니다" : "하루 시간이 늘어납니다";
      if (hasExtra(windowSet(newV.w), windowSet(oldV.w))) return newV.w.length ? "사용 시간대가 넓어집니다" : "사용 시간대를 없애 하루 종일 쓸 수 있습니다";
      return null;
    }
    switch (k) {
      case "bed":
        if (oldV.e && !newV.e) return "잠자는 시간을 끕니다";
        if (hasExtra(bedSet(oldV), bedSet(newV))) return "잠자는 시간이 줄어듭니다";
        return null;
      case "brk":
        if (!oldV.e) return null;
        if (!newV.e) return "휴식을 끕니다";
        if (newV.ev > oldV.ev || newV.len < oldV.len || (oldV.f && !newV.f)) return "휴식이 느슨해집니다";
        return null;
      case "wk": return limitLoosened(oldV, newV) ? (newV === null ? "주간 한도를 없앱니다" : "주간 한도가 늘어납니다") : null;
      case "co": return !oldV && newV ? "남은 시간을 주말로 넘깁니다" : null;
      case "mco": return newV > oldV ? "주말로 넘기는 시간이 늘어납니다" : null;
      case "mr": return limitLoosened(oldV, newV) ? (newV === null ? "요청 횟수 제한을 없앱니다" : "요청 횟수가 늘어납니다") : null;
      case "mx": return limitLoosened(oldV, newV) ? (newV === null ? "연장 제한을 없앱니다" : "연장 시간이 늘어납니다") : null;
      case "aa": return !oldV && newV ? "시간이 끝나도 항상 허용 앱을 씁니다" : null;
      case "na":
        var r = { Block: 0, Ask: 1, AllowAndNotify: 2 };
        return r[newV] > r[oldV] ? (newV === "AllowAndNotify" ? "새 프로그램을 묻지 않고 허용합니다" : "새 프로그램을 막지 않습니다") : null;
      case "st": return oldV && !newV ? "새 시작 앱 자동 끄기를 끕니다" : null;
      case "ss": return oldV && !newV ? "세이프서치를 끕니다" : null;
      case "pb": return oldV && !newV ? "시크릿 창 막기를 끕니다" : null;
      case "ad": return oldV && !newV ? "성인·불법 웹툰 막기를 끕니다" : null;
      case "bl":
        var nb = normalizeSiteList(newV);
        return normalizeSiteList(oldV).some(function (s) { return nb.indexOf(s) < 0; }) ? "차단 사이트를 뺍니다" : null;
      case "al":
        var ob = normalizeSiteList(oldV);
        return normalizeSiteList(newV).some(function (s) { return ob.indexOf(s) < 0; }) ? "허용 사이트를 더합니다" : null;
      case "rt": return oldV !== "" && newV === "" ? "매일 리포트를 끕니다" : null;
      case "wd": return oldV !== null && newV === null ? "주간 리포트를 끕니다" : null;
      case "dns": return oldV !== "None" && newV === "None" ? "가족용 DNS 를 끕니다" : null;
      case "nt": case "no": case "nl": return oldV && !newV ? "알림을 끕니다" : null;
    }
    if (k.indexOf("cat:") === 0 || k.indexOf("app:") === 0) {
      var catOf = function (v) {
        // 앱이 '카테고리 따름' 이면 그 카테고리의 지금 방식으로 본다
        if (v.m !== "f") return v.m;
        var cm = ctx && ctx.catMode ? ctx.catMode(k.slice(4)) : "t";
        return cm || "t";
      };
      var om = catOf(oldV), nm = catOf(newV);
      if (MODE_RANK[nm] > MODE_RANK[om]) return nm === "a" ? "항상 허용으로 바꿉니다" : "사용 불가를 풉니다";
      if (nm !== "t" || om !== "t") return null;
      // 시간 제한끼리 (노트북과 같은 규칙): '카테고리 따름'이어도 앱 자체 한도가 함께 적용되므로 앱 한도가 늘거나 없어지면 약해짐.
      // 실제 한도 = 앱 한도와 카테고리 한도 중 작은 것.
      if (limitLoosened(oldV.l, newV.l)) return newV.l === null ? "앱 한도를 없앱니다" : "앱 한도가 늘어납니다";
      if (k.indexOf("app:") === 0) {
        var cl = ctx && ctx.catLimit ? ctx.catLimit(k.slice(4)) : null;
        var ol = minLimit(oldV.l, cl), nl = minLimit(newV.l, cl);
        if (limitLoosened(ol, nl)) return nl === null ? "앱 한도를 없앱니다" : "앱 한도가 늘어납니다";
      }
      return null;
    }
    return null;
  }

  // ---------- 보낼 글 ----------

  function utf8Length(s) {
    if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(s).length;
    return unescape(encodeURIComponent(s)).length;
  }

  // 보낼 글을 만든다. {text, bytes, error}. error 가 있으면 보내지 않는다.
  function buildPayload(d, ch) {
    var keys = Object.keys(ch);
    if (!keys.length) return { text: "", bytes: 0, error: "바뀐 것이 없습니다." };
    var obj = { v: 1, sid: d.sid, sec: d.sec, u: d.sec === "opts" ? "" : String(d.u || ""), ch: ch };
    var text = JSON.stringify(obj);
    var bytes = utf8Length(text);
    if (keys.length > MAX_KEYS || bytes > MAX_BYTES) {
      return { text: text, bytes: bytes, error: "한 번에 바꾼 것이 너무 많습니다. 일부만 먼저 저장하고, /settings 로 다시 열어 나머지를 바꿔 주세요." };
    }
    return { text: text, bytes: bytes, error: null };
  }

  var api = {
    MAX_BYTES: MAX_BYTES, MAX_KEYS: MAX_KEYS, DAY_NAMES: DAY_NAMES, WEEKDAY_NAMES: WEEKDAY_NAMES,
    extractKg1: extractKg1, hashParam: hashParam, parseThemeParams: parseThemeParams, luminance: luminance,
    base64UrlToBytes: base64UrlToBytes, hasDecompression: hasDecompression, decodeLaunch: decodeLaunch, checkLaunch: checkLaunch,
    pad2: pad2, fmtMinute: fmtMinute, parseMinute: parseMinute, isHHmm: isHHmm, parseWindow: parseWindow, fmtWindow: fmtWindow,
    fmtDuration: fmtDuration, normalizeSite: normalizeSite, cleanNewSite: cleanNewSite, siteProblem: siteProblem, normalizeSiteList: normalizeSiteList,
    MAX_JSON_BYTES: MAX_JSON_BYTES, isClock: isClock, uniq: uniq, minLimit: minLimit, intOrNull: intOrNull,
    baseValues: baseValues, clone: clone, canon: canon, diff: diff, validateKey: validateKey, validate: validate,
    weakens: weakens, utf8Length: utf8Length, buildPayload: buildPayload
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.KGCore = api;
})(typeof window !== "undefined" ? window : this);
