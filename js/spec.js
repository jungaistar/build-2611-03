/* 경쟁사 제원 비교 — 판정·파싱·환산 엔진
 *
 * 화면(app.js)은 판정하지 않는다. 항목 인식·단위 환산·Standard/Option 구분·차이 계산·
 * 인양력 격자 정리는 전부 여기서 하고 test/logic.test.js 로 고정한다. 브라우저와 node 양쪽에서 읽힌다.
 *
 * 흐름
 *   카탈로그 글(붙여넣기·PDF 텍스트) → parseText  ┐
 *   엑셀 표(배열의 배열)              → parseTable ┴→ 모델 { name, items, features, unknown, issues }
 *   모델 여러 개                     → compareModels → 비교표(기준 대비 차이·최고값)
 *   인양력 표(글·엑셀)                → parseLift → 격자(높이 × 반경) → compareLift
 *
 * 모든 값은 표준 단위(kW·kg·kN·L/min·MPa·mm …)로 바꿔 저장하고, 원문과 원래 단위를 함께 남긴다.
 * 환산한 값·단위를 짐작한 값은 표시를 달리한다 — 문서에 적힌 값과 신뢰도가 다르다.
 */
(function (root) {
  'use strict';

  /* ---------- 단위 ---------- */
  // 차원마다 표준 단위(canon)와 영미 표시 단위(imp). units 의 값 = 표준 단위로 바꾸는 곱.
  // 늘릴 때는 코드가 아니라 이 표를 늘린다.
  var DIMS = {
    power: { canon: 'kW', imp: 'hp', dec: 1, units: { kw: 1, hp: 0.745699872, bhp: 0.745699872, ps: 0.73549875, '마력': 0.73549875 } },
    mass: { canon: 'kg', imp: 'lb', dec: 0, units: { kg: 1, t: 1000, ton: 1000, tonne: 1000, '톤': 1000, lb: 0.45359237, lbs: 0.45359237 } },
    force: { canon: 'kN', imp: 'lbf', dec: 1, units: { kn: 1, n: 0.001, kgf: 0.00980665, kg: 0.00980665, tf: 9.80665, lbf: 0.00444822162, lb: 0.00444822162, lbs: 0.00444822162 } },
    flow: { canon: 'L/min', imp: 'gpm', dec: 0, units: { 'l/min': 1, lpm: 1, 'liter/min': 1, gpm: 3.785411784, usgpm: 3.785411784 } },
    pressure: { canon: 'MPa', imp: 'psi', dec: 1, units: { mpa: 1, bar: 0.1, kpa: 0.001, 'kgf/cm2': 0.0980665, 'kg/cm2': 0.0980665, psi: 0.00689475729 } },
    speed: { canon: 'km/h', imp: 'mph', dec: 1, units: { 'km/h': 1, kph: 1, mph: 1.609344 } },
    rotation: { canon: 'rpm', imp: 'rpm', dec: 1, units: { rpm: 1, 'min-1': 1, 'r/min': 1 } },
    volume: { canon: 'm³', imp: 'yd³', dec: 3, units: { m3: 1, yd3: 0.764554858, ft3: 0.0283168466, l: 0.001 } },
    liquid: { canon: 'L', imp: 'gal', dec: 0, units: { l: 1, liter: 1, litre: 1, gal: 3.785411784, usgal: 3.785411784 } },
    length: { canon: 'mm', imp: 'in', dec: 0, units: { mm: 1, cm: 10, m: 1000, in: 25.4, inch: 25.4, ft: 304.8 } }
  };
  // 화면에 보이는 단위 이름(환산기 선택지)
  var UNIT_NAMES = { kw: 'kW', hp: 'hp', ps: 'PS', kg: 'kg', t: 't', lb: 'lb', kn: 'kN', kgf: 'kgf', tf: 'tf', lbf: 'lbf',
    'l/min': 'L/min', gpm: 'gpm(US)', mpa: 'MPa', bar: 'bar', 'kgf/cm2': 'kgf/cm²', psi: 'psi', 'km/h': 'km/h', mph: 'mph',
    m3: 'm³', yd3: 'yd³', l: 'L', gal: 'gal(US)', mm: 'mm', m: 'm', in: 'in', ft: 'ft', rpm: 'rpm' };
  var DIM_LABELS = { power: '출력', mass: '중량', force: '힘', flow: '유량', pressure: '압력', speed: '속도', volume: '용적', liquid: '용량', length: '길이' };

  // 모든 차원의 단위 낱말을 긴 것부터 — 'mm' 을 'm' 보다, 'min-1' 을 'm' 보다 먼저 맞춘다.
  var ALL_UNITS = (function () {
    var s = {};
    Object.keys(DIMS).forEach(function (d) { Object.keys(DIMS[d].units).forEach(function (u) { s[u] = 1; }); });
    return Object.keys(s).sort(function (a, b) { return b.length - a.length; });
  })();

  function prenorm(s) {
    return String(s == null ? '' : s)
      .replace(/³/g, '3').replace(/²/g, '2').replace(/ℓ/g, 'l').replace(/⁻¹/g, '-1').replace(/[−–]/g, '-')
      .replace(/㎥/g, 'm3').replace(/㎜/g, 'mm').replace(/㎏/g, 'kg').replace(/㎞\/h/g, 'km/h').replace(/×/g, 'x')
      .replace(/cu\.?\s*yd\.?/gi, 'yd3').replace(/cu\.?\s*ft\.?/gi, 'ft3').replace(/u\.?s\.?\s*gpm/gi, 'gpm')
      .replace(/u\.?s\.?\s*gal/gi, 'gal').replace(/liters?\b|litres?\b/gi, 'l').replace(/[′’]/g, "'").replace(/[″”]/g, '"');
  }
  function unitAt(s, i) {
    var rest = s.slice(i).toLowerCase();
    for (var k = 0; k < ALL_UNITS.length; k++) {
      var u = ALL_UNITS[k];
      if (rest.indexOf(u) !== 0) continue;
      var nx = rest.charAt(u.length);
      if (/[a-z가-힣]/.test(nx)) continue;                  // 'm' 이 'max' 의 앞글자로 잡히지 않게
      return u;
    }
    return '';
  }

  var NUM = /(?:^|[^\d.,])([-+]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?|[-+]?\.\d+)/g;
  function toNum(s) { return parseFloat(String(s).replace(/,/g, '')); }
  function parenDepth(s, i) { var d = 0; for (var k = 0; k < i; k++) { var c = s.charAt(k); if (c === '(' || c === '[') d++; else if ((c === ')' || c === ']') && d > 0) d--; } return d; }

  // 글 한 조각에서 「숫자 + 단위」를 모두 뽑는다.
  //   ft-in(18' 5")은 하나의 길이로, 2 x 60 L/min 은 곱으로, 2.6/4.5 km/h 는 앞 숫자가 뒤 단위를 물려받는다.
  function quantities(raw) {
    var s = prenorm(raw), out = [], m;
    NUM.lastIndex = 0;
    while ((m = NUM.exec(s))) {
      var txt = m[1], start = m.index + m[0].length - txt.length, end = start + txt.length;
      // 앞이 숫자인 '-' 는 부호가 아니라 범위 표시다(2.6-4.5)
      if (/^[-+]/.test(txt) && start > 0 && /\d/.test(s.charAt(start - 1))) { txt = txt.slice(1); start++; }
      var q = { num: toNum(txt), unit: '', index: start, end: end, inParen: parenDepth(s, start) > 0, note: '' };
      var j = end; while (s.charAt(j) === ' ') j++;
      // ft-in
      var fi = s.slice(j).match(/^(?:'|ft\b|feet\b)\s*(?:(\d+(?:\.\d+)?)\s*(?:"|in\b|inch(?:es)?\b)?)?/i);
      if (fi && fi[0]) {
        var inch = q.num * 12 + (fi[1] ? toNum(fi[1]) : 0);
        q.num = inch; q.unit = 'in'; q.end = j + fi[0].length;
        if (fi[1]) q.note = txt + "' " + fi[1] + '"';
        out.push(q); NUM.lastIndex = q.end; continue;
      }
      if (s.charAt(j) === '"') { q.unit = 'in'; q.end = j + 1; out.push(q); NUM.lastIndex = q.end; continue; }
      // 2 x 60 L/min
      var mul = s.slice(j).match(/^x\s*((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)/i);
      if (mul) {
        var k2 = j + mul[0].length; while (s.charAt(k2) === ' ') k2++;
        var u2 = unitAt(s, k2), b = toNum(mul[1]);
        q.note = q.num + ' × ' + b + ' = ' + round(q.num * b, 4);
        q.num = q.num * b; q.unit = u2; q.mult = true; q.end = k2 + u2.length;
        out.push(q); NUM.lastIndex = q.end; continue;
      }
      var u = unitAt(s, j);
      if (u) { q.unit = u; q.end = j + u.length; }
      out.push(q); NUM.lastIndex = q.end;
    }
    // 범위: 단위 없는 숫자 뒤에 / ~ - 로 이어진 숫자가 단위를 가지면 그 단위를 물려받는다
    for (var i = out.length - 2; i >= 0; i--) {
      if (out[i].unit || !out[i + 1].unit) continue;
      if (/^\s*[\/~\-]\s*$/.test(s.slice(out[i].end, out[i + 1].index))) { out[i].unit = out[i + 1].unit; out[i].range = true; out[i + 1].range = true; }
    }
    return out;
  }

  function factor(dim, unit) { var f = DIMS[dim] && DIMS[dim].units[unit]; return f == null ? null : f; }
  function convert(v, from, to, dim) {
    var a = factor(dim, from), b = factor(dim, to);
    if (a == null || b == null || !isFinite(v)) return NaN;
    return v * a / b;
  }
  function round(x, d) { var p = Math.pow(10, d == null ? 2 : d); return Math.round(x * p) / p; }

  /* ---------- 표준 항목 ---------- */
  // better: 'high' 클수록 유리 · 'low' 작을수록 유리 · null 크고 작음에 우열이 없다(치수 등)
  // pick: 'max' 이면 같은 줄의 여러 값 중 큰 값(주행 속도 저/고 → 고속)
  // range: 표준 단위로 보통 나오는 범위 — 벗어나면 단위를 잘못 읽었을 가능성이 크다(kgf 를 kN 으로 등)
  var FIELDS = [
    { key: 'operatingWeight', label: '운전중량', group: '중량·성능', dim: 'mass', better: null, range: [800, 120000] },
    { key: 'enginePower', label: '엔진 정격출력', group: '중량·성능', dim: 'power', better: 'high', range: [5, 600] },
    { key: 'bucketCapacity', label: '버킷 용량', group: '중량·성능', dim: 'volume', better: 'high', range: [0.01, 8] },
    { key: 'bucketForce', label: '버킷 굴삭력', group: '중량·성능', dim: 'force', better: 'high', range: [5, 500] },
    { key: 'armForce', label: '암 굴삭력', group: '중량·성능', dim: 'force', better: 'high', range: [3, 400] },
    { key: 'hydraulicFlow', label: '유압 유량(최대)', group: '중량·성능', dim: 'flow', better: 'high', range: [10, 1500] },
    { key: 'reliefPressure', label: '최고 사용압력', group: '중량·성능', dim: 'pressure', better: null, range: [10, 50] },
    { key: 'travelSpeed', label: '주행 속도(고속)', group: '중량·성능', dim: 'speed', better: 'high', pick: 'max', range: [1, 40] },
    { key: 'swingSpeed', label: '선회 속도', group: '중량·성능', dim: 'rotation', better: 'high', range: [3, 20] },
    { key: 'fuelTank', label: '연료 탱크', group: '중량·성능', dim: 'liquid', better: 'high', range: [5, 1500] },
    { key: 'overallLength', label: '전장', group: '치수', dim: 'length', better: null, range: [2000, 20000] },
    { key: 'overallWidth', label: '전폭', group: '치수', dim: 'length', better: null, range: [700, 5000] },
    { key: 'overallHeight', label: '전고', group: '치수', dim: 'length', better: null, range: [1500, 5000] },
    { key: 'tailSwing', label: '후방 선회반경', group: '치수', dim: 'length', better: 'low', range: [500, 5000] },
    { key: 'shoeWidth', label: '슈 폭', group: '치수', dim: 'length', better: null, range: [150, 1000] },
    { key: 'maxDigDepth', label: '최대 굴삭 깊이', group: '작업범위', dim: 'length', better: 'high', range: [1000, 12000] },
    { key: 'maxReach', label: '최대 굴삭 반경', group: '작업범위', dim: 'length', better: 'high', range: [2500, 16000] },
    { key: 'maxDigHeight', label: '최대 굴삭 높이', group: '작업범위', dim: 'length', better: 'high', range: [2500, 14000] },
    { key: 'maxDumpHeight', label: '최대 덤프 높이', group: '작업범위', dim: 'length', better: 'high', range: [1500, 10000] }
  ];
  var FIELD = {}; FIELDS.forEach(function (f) { FIELD[f.key] = f; });
  // 계산으로 만드는 항목 — 문서에 없는 값이다
  var DERIVED = [
    { key: 'powerToWeight', label: '출력 대 중량비', group: '계산 항목', unit: 'kW/t', dec: 2, better: 'high',
      from: ['enginePower', 'operatingWeight'], calc: function (p, w) { return p / (w / 1000); } }
  ];

  // 제조사마다 다른 항목 이름. 괄호 안 글자·띄어쓰기·마침표는 비교 전에 지운다.
  var ALIASES = {
    operatingWeight: ['운전중량', '작업중량', '장비중량', '운전질량', '기계중량', '중량', 'operating weight', 'operating mass', 'machine weight', 'operating weight with cab', 'weight'],
    enginePower: ['엔진 정격출력', '엔진출력', '정격출력', '엔진 정격 출력', '순출력', '엔진 순출력', '출력', 'engine power', 'net engine power', 'net power', 'rated power', 'gross power', 'engine output', 'power'],
    bucketCapacity: ['버킷 용량', '버킷 표준 용량', '버킷용량 산적', '표준 버킷 용량', 'bucket capacity', 'bucket volume', 'bucket capacity heaped'],
    bucketForce: ['버킷 굴삭력', '버킷 굴착력', '버킷 디깅포스', 'bucket digging force', 'bucket breakout force', 'bucket breakout', 'bucket force'],
    armForce: ['암 굴삭력', '암 굴착력', '아암 굴삭력', '디퍼 굴삭력', 'arm digging force', 'arm crowd force', 'arm breakout force', 'dipper arm force', 'arm force'],
    hydraulicFlow: ['유압 유량', '최대 유량', '펌프 유량', '펌프 토출량', '펌프 최대 토출량', '최대 토출량', '토출량', 'hydraulic flow', 'hydraulic pump flow', 'pump flow', 'max flow', 'maximum flow', 'pump capacity'],
    reliefPressure: ['최고 사용압력', '최고 사용 압력', '릴리프 압력', '설정 압력', '릴리프 설정압', '작동 압력', 'relief pressure', 'relief valve setting', 'system pressure', 'operating pressure', 'max pressure'],
    travelSpeed: ['주행 속도', '주행속도 고속', '주행 속도 고속', '최고 주행 속도', 'travel speed', 'travel speed high', 'max travel speed'],
    swingSpeed: ['선회 속도', '선회속도', 'swing speed', 'slew speed'],
    fuelTank: ['연료 탱크', '연료탱크 용량', '연료 탱크 용량', 'fuel tank', 'fuel tank capacity', 'fuel capacity'],
    overallLength: ['전장', '전체 길이', '수송 길이', 'overall length', 'transport length', 'shipping length', 'length'],
    overallWidth: ['전폭', '전체 폭', '전체 너비', 'overall width', 'width', 'transport width'],
    overallHeight: ['전고', '전체 높이', '수송 높이', 'overall height', 'transport height', 'height', 'shipping height'],
    tailSwing: ['후방 선회반경', '후방 선회 반경', '후단 선회 반경', '후방선회반경', '테일스윙 반경', 'tail swing radius', 'tail swing', 'rear swing radius', 'rear end swing radius'],
    shoeWidth: ['슈 폭', '슈폭', '트랙 슈 폭', '트랙폭', '트랙 폭', 'shoe width', 'track shoe width', 'track width'],
    maxDigDepth: ['최대 굴삭 깊이', '최대 굴착 깊이', '최대굴삭깊이', 'max digging depth', 'maximum digging depth', 'max dig depth', 'digging depth'],
    maxReach: ['최대 굴삭 반경', '최대 굴착 반경', '최대 굴삭 거리', '지면 최대 굴삭 반경', '최대 작업 반경', 'max digging reach', 'max reach', 'max reach at ground level', 'maximum reach at ground', 'max digging reach at ground', 'digging reach'],
    maxDigHeight: ['최대 굴삭 높이', '최대 굴착 높이', 'max digging height', 'max dig height', 'maximum cutting height', 'max cutting height', 'digging height'],
    maxDumpHeight: ['최대 덤프 높이', '최대 덤핑 높이', '최대 적재 높이', 'max dumping height', 'max dump height', 'maximum dump height', 'dump height', 'dumping height']
  };
  // 사양(장치) 이름 — Standard/Option 표에서 같은 장치를 같은 줄에 모은다
  var FEATURE_ALIASES = {
    '에어컨': ['에어컨', '캐빈 에어컨', '운전석 에어컨', '에어컨디셔너', 'air conditioner', 'air conditioning', 'a/c'],
    '퀵 커플러': ['퀵 커플러', '퀵커플러', '유압 퀵커플러', 'quick coupler', 'hydraulic quick coupler'],
    '유압 썸': ['유압 썸', '유압 집게', 'hydraulic thumb', 'thumb'],
    '도저 블레이드': ['도저 블레이드', '도저', '블레이드', 'dozer blade', 'blade'],
    '롱 암': ['롱 암', '롱암', 'long arm'],
    '캐노피': ['캐노피', 'canopy'],
    '후방 카메라': ['후방 카메라', 'rear camera', 'rearview camera', 'rear view camera']
  };

  function normLabel(s) {
    return prenorm(s).replace(/\([^)]*\)|\[[^\]]*\]/g, '').toLowerCase().replace(/[\s.,:;·_\-\/\\'"’*]+/g, '');
  }
  function aliasTable(extra) {
    var t = [];
    FIELDS.forEach(function (f) {
      var names = (ALIASES[f.key] || []).concat(f.label).concat((extra && extra[f.key]) || []);
      names.forEach(function (n) { var k = normLabel(n); if (k) t.push({ key: f.key, a: k }); });
    });
    return t.sort(function (x, y) { return y.a.length - x.a.length; });
  }
  // 정확히 같은 이름이 먼저, 없으면 「별칭 + 짧은 덧말」(작업중량캐빈 · 주행속도고속)까지 같은 항목으로 본다.
  function matchField(label, extra) {
    var k = normLabel(label); if (!k) return null;
    var t = aliasTable(extra), i;
    for (i = 0; i < t.length; i++) if (t[i].a === k) return FIELD[t[i].key];
    for (i = 0; i < t.length; i++) {
      var a = t[i].a;
      if (a.length >= 2 && k.indexOf(a) === 0 && (k.length - a.length) <= Math.max(4, k.length * 0.4)) return FIELD[t[i].key];
    }
    return null;
  }
  function featureKey(label) {
    var k = normLabel(label);
    for (var name in FEATURE_ALIASES) {
      if (FEATURE_ALIASES[name].some(function (a) { return normLabel(a) === k; })) return name;
    }
    return String(label).replace(/\([^)]*\)/g, '').trim();
  }

  /* ---------- Standard / Option ---------- */
  var STD_RE = /(^|[^a-z가-힣])(std\.?|standard|표준|기본사양|기본)(?![a-z])|●|◎/i;
  var OPT_RE = /(^|[^a-z가-힣])(opt\.?|option(al)?|옵션|선택사양|선택)(?![a-z])|○/i;
  function soOf(s) {
    var t = String(s == null ? '' : s);
    var a = STD_RE.test(t), b = OPT_RE.test(t);
    if (a && !b) return 'S'; if (b && !a) return 'O';
    return '';
  }
  var MARKERS = { 'S': ['표준', '기본', '기본사양', 'std', 'standard', 's', '●', '◎', 'yes', 'y'],
    'O': ['옵션', '선택', '선택사양', 'opt', 'option', 'optional', 'o', '○'],
    '-': ['-', '—', '없음', '미적용', 'na', 'n/a', 'x', '×', 'no'] };
  function markerOnly(v) {
    var k = String(v == null ? '' : v).trim().toLowerCase().replace(/[.()\s]/g, '');
    if (!k) return null;
    for (var m in MARKERS) if (MARKERS[m].indexOf(k) >= 0) return m;
    return null;
  }

  /* ---------- 값 한 칸 읽기 ---------- */
  // "5,450 kg (고무 슈) / 5,560 kg (철 슈)" 처럼 한 칸에 사양이 여럿이면 조각마다 읽고,
  // 표준(Std) 조각이 있으면 그것을, 없으면 첫 조각을 대표값으로 쓴다. 나머지는 variants 로 남긴다.
  function segments(v) {
    return prenorm(v).split(/\s[\/;|]\s|;|\||,\s(?=[\d(])/).map(function (x) { return x.trim(); }).filter(Boolean);
  }
  function parseValue(raw, field, ctx) {
    ctx = ctx || {};
    var dim = DIMS[field.dim], variants = [], notes = [];
    segments(raw).forEach(function (seg) {
      var qs = quantities(seg).filter(function (q) { return !q.unit || factor(field.dim, q.unit) != null; });
      if (!qs.length) return;
      var outer = qs.filter(function (q) { return !q.inParen; });
      var cand = outer.length ? outer : qs, main = cand[0];
      var unitOf = function (q) {
        if (q.unit) return { u: q.unit, how: '' };
        if (ctx.headerUnit && factor(field.dim, ctx.headerUnit) != null) return { u: ctx.headerUnit, how: '머리글' };
        if (ctx.sectionUnit && factor(field.dim, ctx.sectionUnit) != null) return { u: ctx.sectionUnit, how: '단위 표기' };
        return { u: null, how: '가정' };
      };
      var conv = function (q) {
        var r = unitOf(q), u = r.u || canonKey(field.dim);
        return { v: q.num * factor(field.dim, u), u: u, how: r.how, q: q };
      };
      var pickd = conv(main);
      if (field.pick === 'max') {
        cand.forEach(function (q) { var c = conv(q); if (c.v > pickd.v) pickd = c; });
        if (cand.length > 1) notes.push('값 ' + cand.length + '개 중 큰 값(고속)');
      }
      var vn = [];
      if (pickd.q.note) vn.push(pickd.q.note);
      if (pickd.how === '머리글') vn.push('단위는 항목 이름의 (' + unitName(pickd.u) + ')');
      if (pickd.how === '단위 표기') vn.push('단위는 위쪽 「단위: ' + unitName(pickd.u) + '」 표기');
      if (pickd.how === '가정') vn.push('단위 표기가 없어 ' + dim.canon + ' 로 봄');
      // 괄호 안에 다른 단위로 다시 적힌 값(36.2 kW (48.5 hp))은 서로 맞는지 대조한다
      qs.filter(function (q) { return q !== pickd.q && q.inParen && q.unit; }).forEach(function (q) {
        var c = conv(q);
        var gap = Math.abs(c.v - pickd.v) / Math.max(Math.abs(pickd.v), 1e-9);
        if (gap > 0.03) vn.push('괄호 안 ' + q.num + ' ' + unitName(q.unit) + ' 와 ' + round(gap * 100, 1) + '% 어긋남');
        else vn.push('괄호 안 ' + q.num + ' ' + unitName(q.unit) + ' 와 일치');
      });
      var tag = (seg.match(/\(([^)]*[^\d\s.,)][^)]*)\)/) || [])[1] || '';
      if (tag && quantities(tag).length) tag = '';
      variants.push({ value: pickd.v, srcUnit: pickd.u, so: soOf(seg), tag: tag.trim(), raw: seg, assumed: pickd.how === '가정',
        converted: factor(field.dim, pickd.u) !== 1, computed: !!pickd.q.mult, notes: vn });
    });
    if (!variants.length) return null;
    var main = variants.filter(function (x) { return x.so === 'S'; })[0] || variants[0];
    var so = main.so || ctx.so || '';
    if (!so && variants.some(function (x) { return x.so === 'O'; })) so = 'S';
    if (variants.length > 1) notes.push('다른 사양 ' + (variants.length - 1) + '개: ' + variants.filter(function (x) { return x !== main; }).map(function (x) {
      return fmtNum(x.value, dim.dec) + ' ' + dim.canon + (x.tag ? '(' + x.tag + ')' : '') + (x.so ? '[' + x.so + ']' : '');
    }).join(', '));
    return { value: round(main.value, 4), unit: dim.canon, srcUnit: main.srcUnit, raw: String(raw).trim(), so: so,
      converted: main.converted, computed: main.computed, assumed: main.assumed, tag: main.tag, variants: variants, notes: main.notes.concat(notes) };
  }
  function canonKey(dim) { var u = DIMS[dim].units; for (var k in u) if (u[k] === 1) return k; return ''; }
  function unitName(u) { return UNIT_NAMES[u] || u; }

  /* ---------- 줄 나누기 ---------- */
  // 「항목  값」 한 줄을 이름과 값으로 가른다. 탭·두 칸 이상 공백·콜론·세로줄이 우선이고,
  // 없으면 괄호 밖의 첫 숫자에서 자른다("Bucket breakout force (ISO 6015) 40 kN" 의 6015 는 이름이다).
  function splitLabel(line) {
    var parts = line.split(/\t|\s{2,}|\s*[:：]\s+|\s*\|\s*/).map(function (x) { return x.trim(); }).filter(Boolean);
    if (parts.length >= 2) return { label: parts[0], value: parts.slice(1).join('  ') };
    var d = 0;
    for (var i = 1; i < line.length; i++) {
      var c = line.charAt(i);
      if (c === '(') d++; else if (c === ')' && d > 0) d--;
      else if (!d && /\d/.test(c) && /[\s]/.test(line.charAt(i - 1))) return { label: line.slice(0, i).trim(), value: line.slice(i).trim() };
    }
    var mk = line.match(/^(.*\S)\s+(\S+)$/);
    if (mk && markerOnly(mk[2])) return { label: mk[1], value: mk[2] };
    return null;
  }
  function headerUnitOf(label, dim) {
    var m = prenorm(label).match(/\(([^)]*)\)/g) || [];
    for (var i = 0; i < m.length; i++) {
      var t = m[i].slice(1, -1).trim().toLowerCase().replace(/^단위\s*[:：]?\s*/, '');
      if (factor(dim, t) != null) return t;
    }
    return '';
  }
  var SECTION_UNIT = /^[\s(\[]*(?:단위|unit|units)\s*[:：]?\s*([a-z0-9\/³²ℓ]+)[\s)\]]*$/i;

  /* ---------- 모델 ---------- */
  function newModel(name, source) {
    return { name: String(name || '').trim() || '이름 없는 모델', source: source || '', items: {}, features: [], unknown: [], headings: [], issues: [], ai: false };
  }
  // 이름·값 한 쌍을 모델에 넣는다. 붙여넣기·엑셀이 같은 길을 쓴다.
  function addEntry(model, label, value, ctx, extra) {
    ctx = ctx || {};
    var f = matchField(label, extra);
    if (f) {
      var pv = parseValue(value, f, { headerUnit: ctx.headerUnit || headerUnitOf(label, f.dim), sectionUnit: ctx.sectionUnit, so: ctx.so });
      if (!pv) { model.unknown.push({ label: label, value: String(value), why: f.label + ' 값을 숫자로 읽지 못했습니다' }); return 'bad'; }
      pv.label = String(label).trim();
      var lt = (String(label).match(/\(([^)]*)\)/) || [])[1];
      if (lt && !headerUnitOf(label, f.dim) && quantities(lt).length === 0) pv.tag = pv.tag || lt.trim();
      var cur = model.items[f.key];
      if (cur) {
        cur.variants.push({ value: pv.value, srcUnit: pv.srcUnit, so: pv.so, tag: pv.tag || pv.label, raw: pv.raw, notes: [] });
        cur.notes.push('같은 항목이 다시 나옴: ' + pv.label + ' ' + fmtNum(pv.value, DIMS[f.dim].dec) + ' ' + pv.unit);
      } else {
        model.items[f.key] = pv;
        var rg = f.range;
        if (rg && (pv.value < rg[0] || pv.value > rg[1])) model.issues.push(f.label + ' ' + fmtNum(pv.value, DIMS[f.dim].dec) + ' ' + pv.unit + ' — 보통 범위(' + rg[0] + '~' + rg[1] + ' ' + pv.unit + ')를 벗어납니다. 단위를 확인하세요');
        if (pv.assumed) model.issues.push(f.label + ': 단위 표기가 없어 ' + pv.unit + ' 로 보았습니다');
      }
      return 'ok';
    }
    var mk = markerOnly(value);
    if (mk) { model.features.push({ name: String(label).trim(), key: featureKey(label), so: mk }); return 'feature'; }
    model.unknown.push({ label: String(label).trim(), value: String(value).trim(), why: '표준 항목에 없는 이름' });
    return 'unknown';
  }

  // 카탈로그 글 → 모델 하나. 첫 줄이 숫자 없는 제목이면 모델 이름 후보(title)로 남긴다.
  function parseText(text, opts) {
    opts = opts || {};
    var model = newModel(opts.name, opts.source || '붙여넣기'), sectionUnit = '', title = '', seen = false;
    String(text || '').split(/\r?\n/).forEach(function (line0) {
      var line = line0.replace(/\u00a0/g, ' ').trim();
      if (!line || line.charAt(0) === '#') { if (/AI 초안/.test(line)) model.ai = true; return; }
      var first = !seen; seen = true;
      var su = line.match(SECTION_UNIT);
      if (su) { sectionUnit = prenorm(su[1]).toLowerCase(); return; }
      var sp = splitLabel(line);
      if (!sp) {
        // 첫 줄은 숫자가 있어도 제목(AX-55)으로 본다. 그 뒤 숫자 없는 줄은 소제목이다.
        if (first) { title = line; model.headings.push(line); }
        else if (!/\d/.test(line) && !markerOnly(line)) model.headings.push(line);
        else model.unknown.push({ label: line, value: '', why: '이름과 값을 가르지 못했습니다' });
        return;
      }
      addEntry(model, sp.label, sp.value, { sectionUnit: sectionUnit }, opts.aliases);
    });
    model.title = title;
    if (!opts.name && title) model.name = title;
    if (!Object.keys(model.items).length) model.issues.push('표준 항목을 하나도 찾지 못했습니다');
    return model;
  }

  /* ---------- 엑셀 표 ---------- */
  var COLS = {
    model: ['모델', '기종', '장비', '모델명', 'model', 'machine'],
    item: ['항목', '제원', '제원항목', '사양', 'item', 'spec', 'specification', 'specifications'],
    value: ['값', '제원값', '수치', 'value'],
    unit: ['단위', 'unit', 'units'],
    so: ['구분', 's/o', 'so', 'std/opt', 'standard/option', '사양구분', '표준/옵션', '적용']
  };
  function colOf(cell) {
    var k = normLabel(cell); if (!k) return '';
    for (var c in COLS) if (COLS[c].some(function (a) { return normLabel(a) === k; })) return c;
    return '';
  }
  // 두 가지 모양을 읽는다
  //   세로(긴) 표: 모델 | 항목 | 값 | 단위 | 구분      — 한 줄이 값 하나
  //   가로(넓은) 표: 항목 | (단위) | (구분) | 모델1 | 모델2 …  — 열이 모델
  function parseTable(aoa, opts) {
    opts = opts || {};
    var rows = (aoa || []).map(function (r) { return (r || []).map(function (c) { return c == null ? '' : String(c).trim(); }); });
    var h = -1;
    for (var i = 0; i < rows.length; i++) { if (rows[i].filter(Boolean).length >= 2) { h = i; break; } }
    if (h < 0) return { models: [], issues: ['표에서 머리글 줄을 찾지 못했습니다'] };
    var head = rows[h], cols = {};
    head.forEach(function (c, j) { var k = colOf(c); if (k && cols[k] == null) cols[k] = j; });
    var src = opts.source || '엑셀', models = [], byName = {};
    function get(name) { if (!byName[name]) { byName[name] = newModel(name, src); models.push(byName[name]); } return byName[name]; }
    if (cols.model != null && cols.item != null && cols.value != null) {
      rows.slice(h + 1).forEach(function (r) {
        var nm = r[cols.model], it = r[cols.item], v = r[cols.value];
        if (!nm || !it) return;
        if (v === '' && cols.so == null) return;
        var so = cols.so != null ? markerOnly(r[cols.so]) : null;
        var unit = cols.unit != null ? prenorm(r[cols.unit]).toLowerCase().replace(/\s/g, '') : '';
        var m = get(nm);
        if (v === '' && so) { m.features.push({ name: it, key: featureKey(it), so: so }); return; }
        addEntry(m, it, v, { headerUnit: unit, so: so === '-' ? '' : so }, opts.aliases);
      });
    } else {
      var itemCol = cols.item != null ? cols.item : 0;
      var skip = [itemCol, cols.unit, cols.so];
      var mcols = [];
      head.forEach(function (c, j) { if (c && skip.indexOf(j) < 0) mcols.push(j); });
      if (!mcols.length) return { models: [], issues: ['모델 열을 찾지 못했습니다'] };
      rows.slice(h + 1).forEach(function (r) {
        var it = r[itemCol]; if (!it) return;
        var unit = cols.unit != null ? prenorm(r[cols.unit]).toLowerCase().replace(/\s/g, '') : '';
        var so = cols.so != null ? markerOnly(r[cols.so]) : null;
        mcols.forEach(function (j) {
          var v = r[j]; if (v === '') return;
          addEntry(get(head[j]), it, v, { headerUnit: unit, so: so === '-' ? '' : so }, opts.aliases);
        });
      });
    }
    models.forEach(function (m) { if (!Object.keys(m.items).length) m.issues.push('표준 항목을 하나도 찾지 못했습니다'); });
    return { models: models, issues: [] };
  }

  /* ---------- PDF 글자 → 줄 ---------- */
  // pdf.js 의 글자 조각(str, transform[4]=x, transform[5]=y, width)을 y 로 묶어 줄로 만든다.
  // 조각 사이가 넓으면 두 칸 공백으로 이어 붙인다 — splitLabel·인양력 칸 나누기가 그것을 칸 경계로 본다.
  function pdfLines(items) {
    var lines = [];
    (items || []).forEach(function (it) {
      if (!it.str || !it.str.trim()) return;
      var y = it.transform[5], line = null;
      for (var i = 0; i < lines.length; i++) if (Math.abs(lines[i].y - y) <= 2) { line = lines[i]; break; }
      if (!line) { line = { y: y, items: [] }; lines.push(line); }
      line.items.push({ x: it.transform[4], w: it.width || 0, s: it.str });
    });
    lines.sort(function (a, b) { return b.y - a.y; });
    return lines.map(function (l) {
      l.items.sort(function (a, b) { return a.x - b.x; });
      var out = '', endX = null;
      l.items.forEach(function (it) {
        if (endX == null) out = it.s.trim();
        else out += (it.x - endX > 6 ? '  ' : (/\s$/.test(out) || /^\s/.test(it.s) ? '' : ' ')) + it.s.trim();
        endX = it.x + it.w;
      });
      return out.trim();
    });
  }

  /* ---------- 인양력 ---------- */
  var LIFT_UNITS = { kg: 1, kgf: 1, t: 1000, ton: 1000, '톤': 1000, lb: 0.45359237, lbs: 0.45359237 };
  function liftUnit(text) {
    var s = prenorm(text);
    var m = s.match(/단위\s*[:：]?\s*(kgf|kg|lbs?|ton|t|톤)(?![a-z])/i) || s.match(/\(\s*(kgf|kg|lbs?|ton|t)\s*\)/i) || s.match(/\b(lbs?)\b/i);
    if (m) { var u = m[1].toLowerCase(); return { unit: u, factor: LIFT_UNITS[u], note: '' }; }
    return { unit: 'kg', factor: 1, note: '인양력 단위 표기를 찾지 못해 kg 으로 보았습니다' };
  }
  function directionOf(text) {
    var s = String(text).toLowerCase();
    var f = /정면|전방|over\s*front|front/.test(s), d = /측면|360|over\s*side|side/.test(s);
    if (f && !d) return 'front'; if (d && !f) return 'side';
    return null;
  }
  var DIR_NAMES = { front: '정면', side: '측면(360°)', any: '방향 미지정' };
  function cellsOf(line) {
    var c = line.split(/\t|\s{2,}|\|/).map(function (x) { return x.trim(); }).filter(function (x, i) { return x || i === 0; });
    if (c.length > 1) return c;
    var tk = line.trim().split(/\s+/), out = [];
    tk.forEach(function (t) {
      if (out.length && /^(m|mm|ft|kg|lb|lbs|'|")$/i.test(t)) out[out.length - 1] += ' ' + t; else out.push(t);
    });
    return out;
  }
  function lengthOf(cell, defUnit) {
    var t = String(cell).trim();
    if (/^(gl|g\.l\.?|지면|지상|ground(\s*level|\s*line)?|0)$/i.test(t)) return 0;
    var q = quantities(t).filter(function (x) { return !x.unit || factor('length', x.unit) != null; })[0];
    if (!q) return null;
    return round(q.num * factor('length', q.unit || defUnit || 'm'), 0);
  }
  var HEAD_RE = /반경|radius|높이|height|load\s*point|하중\s*점|reach/i;
  var MAX_RE = /최대|max/i;
  // 인양력 표 → { unit, grids:[{direction, radii[mm], heights[mm], cells[[{value(kg), limited}|null]]}], issues }
  // 별표(*)는 유압 한계로 정해진 값이다. 「최대 반경」 칸은 모델마다 반경이 달라 격자에서 뺀다.
  function parseLift(input, opts) {
    opts = opts || {};
    var lines = Array.isArray(input) ? input.map(function (r) { return (r || []).map(function (c) { return c == null ? '' : String(c); }); })
      : String(input || '').split(/\r?\n/).map(function (l) { return l.replace(/\u00a0/g, ' '); }).filter(function (l) { return l.trim() && l.trim().charAt(0) !== '#'; }).map(cellsOf);
    var all = lines.map(function (r) { return r.join(' '); }).join('\n');
    var lu = liftUnit(all), issues = lu.note ? [lu.note] : [];
    var defLen = /(\d\s*ft\b)|(\d\s*')/i.test(prenorm(all)) ? 'ft' : 'm';
    var grids = [], cur = null, dir = null, dropped = false, limited = 0;
    lines.forEach(function (r) {
      var row = r.map(function (c) { return String(c).trim(); });
      while (row.length && row[row.length - 1] === '') row.pop();
      var joined = row.join(' ').trim(); if (!joined) return;
      var nums = row.slice(1).filter(function (c) { return /\d/.test(c); }).length;
      var d = directionOf(joined);
      if (d && joined.length <= 24 && !nums && !HEAD_RE.test(row[0] || '')) { dir = d; cur = null; return; }
      if (HEAD_RE.test(row[0] || '') || (row[0] === '' && nums >= 2)) {
        if (d) dir = d;
        var radii = [], keep = [];
        row.slice(1).forEach(function (c, j) {
          if (MAX_RE.test(c)) { dropped = true; return; }
          var v = lengthOf(c, defLen); if (v == null) return;
          radii.push(v); keep.push(j + 1);
        });
        if (radii.length) { cur = { direction: dir || 'any', radii: radii, keep: keep, heights: [], cells: [] }; grids.push(cur); }
        return;
      }
      if (!cur) return;
      var hgt = lengthOf(row[0], defLen); if (hgt == null) return;
      var cells = cur.keep.map(function (j) {
        var c = row[j] == null ? '' : row[j];
        var q = quantities(c)[0];
        if (!q || /^[-—]$/.test(c)) return null;
        var lim = /\*/.test(c); if (lim) limited++;
        return { value: round(q.num * lu.factor, 0), limited: lim };
      });
      cur.heights.push(hgt); cur.cells.push(cells);
    });
    grids = grids.filter(function (g) { return g.heights.length; });
    grids.forEach(function (g) { delete g.keep; });
    if (dropped) issues.push('「최대 반경」 칸은 모델마다 반경이 달라 격자 비교에서 뺐습니다');
    if (!grids.length) issues.push('인양력 격자(높이 × 반경)를 찾지 못했습니다');
    return { unit: lu.unit, factor: lu.factor, grids: grids, limited: limited, issues: issues, ai: /AI 초안/.test(Array.isArray(input) ? '' : String(input || '')) };
  }
  function gridOf(lift, direction) {
    if (!lift) return null;
    return lift.grids.filter(function (g) { return g.direction === direction; })[0] ||
      (direction === 'any' ? lift.grids[0] : lift.grids.filter(function (g) { return g.direction === 'any'; })[0]) || null;
  }
  // 두 격자의 같은 점(높이·반경이 tol mm 안)만 비교한다. 없는 점을 보간으로 만들지 않는다 — 문서에 없는 값이다.
  function compareLift(ga, gb, tol) {
    tol = tol == null ? 100 : tol;
    function pair(xs, ys) {
      var out = [];
      xs.forEach(function (x, i) {
        var best = -1, bd = Infinity;
        ys.forEach(function (y, j) { var dd = Math.abs(x - y); if (dd <= tol && dd < bd) { bd = dd; best = j; } });
        if (best >= 0) out.push({ a: i, b: best, off: bd });
      });
      return out;
    }
    var pr = pair(ga.radii, gb.radii), ph = pair(ga.heights, gb.heights), maxOff = 0, common = 0;
    pr.concat(ph).forEach(function (p) { if (p.off > maxOff) maxOff = p.off; });
    var cells = ph.map(function (h) {
      return pr.map(function (r) {
        var a = ga.cells[h.a][r.a], b = gb.cells[h.b][r.b];
        if (!a || !b) return { a: a, b: b, delta: null, pct: null };
        common++;
        return { a: a, b: b, delta: b.value - a.value, pct: a.value ? round((b.value - a.value) / a.value * 100, 1) : null };
      });
    });
    function count(g) { var n = 0; g.cells.forEach(function (r) { r.forEach(function (c) { if (c) n++; }); }); return n; }
    var deltas = []; cells.forEach(function (r) { r.forEach(function (c) { if (c.pct != null) deltas.push(c.pct); }); });
    var avg = deltas.length ? round(deltas.reduce(function (s, x) { return s + x; }, 0) / deltas.length, 1) : null;
    return { heights: ph.map(function (h) { return ga.heights[h.a]; }), radii: pr.map(function (r) { return ga.radii[r.a]; }),
      cells: cells, common: common, onlyA: count(ga) - common, onlyB: count(gb) - common, maxOffset: maxOff, avgPct: avg };
  }

  /* ---------- 비교 ---------- */
  // 기준 모델 대비 차이(%)와 항목별 최고값. threshold(%) 이상 차이 나는 칸만 강조 표시(flag)한다.
  function compareModels(models, baseIdx, opts) {
    opts = opts || {};
    var thr = opts.threshold == null ? 5 : +opts.threshold;
    baseIdx = baseIdx >= 0 && baseIdx < models.length ? baseIdx : 0;
    var rows = [];
    function build(meta, vals, origin) {
      var base = vals[baseIdx];
      var present = vals.filter(function (v) { return v != null; });
      if (!present.length) return;
      var best = null;
      if (meta.better && present.length > 1) best = meta.better === 'high' ? Math.max.apply(null, present) : Math.min.apply(null, present);
      rows.push({ key: meta.key, label: meta.label, group: meta.group, dim: meta.dim || null, unit: meta.unit || DIMS[meta.dim].canon,
        better: meta.better, origin: origin,
        cells: models.map(function (m, i) {
          var v = vals[i], it = origin === '계산' ? null : m.items[meta.key];
          var c = { value: v, item: it || null };
          if (v == null) return c;
          if (base != null && i !== baseIdx) {
            c.delta = round(v - base, 4);
            c.pct = base ? round((v - base) / Math.abs(base) * 100, 1) : null;
            if (c.pct != null && Math.abs(c.pct) >= thr) {
              c.flag = !meta.better ? 'diff' : ((meta.better === 'high') === (c.pct > 0) ? 'adv' : 'dis');
            }
          }
          c.best = best != null && v === best && present.filter(function (x) { return x === best; }).length < present.length;
          return c;
        }) });
    }
    FIELDS.forEach(function (f) { build(f, models.map(function (m) { return m.items[f.key] ? m.items[f.key].value : null; }), '문서'); });
    DERIVED.forEach(function (d) {
      build(d, models.map(function (m) {
        var xs = d.from.map(function (k) { return m.items[k] ? m.items[k].value : null; });
        return xs.some(function (x) { return x == null; }) ? null : round(d.calc.apply(null, xs), d.dec + 2);
      }), '계산');
    });
    // Standard / Option 표 — 같은 장치는 같은 줄
    var fkeys = [];
    models.forEach(function (m) { m.features.forEach(function (f) { if (fkeys.indexOf(f.key) < 0) fkeys.push(f.key); }); });
    var features = fkeys.map(function (k) {
      return { key: k, cells: models.map(function (m) { var f = m.features.filter(function (x) { return x.key === k; })[0]; return f ? f.so : ''; }) };
    });
    var flagged = 0; rows.forEach(function (r) { r.cells.forEach(function (c) { if (c.flag) flagged++; }); });
    return { base: baseIdx, threshold: thr, rows: rows, features: features, flagged: flagged };
  }

  /* ---------- 표시 ---------- */
  function fmtNum(v, dec) {
    if (v == null || !isFinite(v)) return '—';
    var s = (+v).toFixed(dec == null ? 1 : dec);
    var p = s.split('.'); p[0] = p[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return p.join('.');
  }
  // 표준 단위 값 → 보기 단위('si' | 'imp'). 영미 길이는 ft-in 으로 쓴다.
  function display(v, dim, system) {
    if (v == null) return { text: '—', unit: '' };
    if (!dim) return { text: fmtNum(v, 2), unit: '' };
    var D = DIMS[dim];
    if (system !== 'imp' || D.imp === D.canon) return { text: fmtNum(v, D.dec), unit: D.canon };
    if (dim === 'length') {
      var inch = v / 25.4;
      if (Math.abs(inch) < 36) return { text: fmtNum(inch, 1), unit: 'in' };
      var sign = inch < 0 ? '-' : ''; inch = Math.abs(inch);
      var ft = Math.floor(inch / 12), rest = Math.round(inch - ft * 12);
      if (rest === 12) { ft++; rest = 0; }
      return { text: sign + ft + "' " + rest + '"', unit: 'ft-in' };
    }
    var key = { power: 'hp', mass: 'lb', force: 'lbf', flow: 'gpm', pressure: 'psi', speed: 'mph', volume: 'yd3', liquid: 'gal' }[dim];
    var dec = { power: 1, mass: 0, force: 0, flow: 1, pressure: 0, speed: 1, volume: 2, liquid: 1 }[dim];
    return { text: fmtNum(v / D.units[key], dec), unit: D.imp };
  }
  function liftDisplay(kg, system) { return system === 'imp' ? fmtNum(kg / 0.45359237, 0) : fmtNum(kg, 0); }
  function lenLabel(mm, system) { return system === 'imp' ? display(mm, 'length', 'imp').text : fmtNum(mm / 1000, 1) + ' m'; }

  /* ---------- 엑셀용 표 ---------- */
  function soName(s) { return s === 'S' ? '표준' : s === 'O' ? '옵션' : s === '-' ? '없음' : ''; }
  function exportTables(models, cmp, lifts, system) {
    var out = {};
    var names = models.map(function (m) { return m.name; });
    var head = ['구분', '항목', '단위'].concat(names).concat(names.map(function (n, i) { return i === cmp.base ? null : n + ' 차이(%)'; }).filter(Boolean)).concat(['출처']);
    var t = [head];
    cmp.rows.forEach(function (r) {
      var unit = r.dim ? display(1, r.dim, system).unit : r.unit;
      t.push([r.group, r.label, unit].concat(r.cells.map(function (c) {
        if (c.value == null) return '';
        if (!r.dim) return round(c.value, 2);
        var d = display(c.value, r.dim, system);
        return d.unit === 'ft-in' ? d.text : +d.text.replace(/,/g, '');
      })).concat(r.cells.map(function (c, i) { return i === cmp.base ? null : (c.pct == null ? '' : c.pct); }).filter(function (x) { return x !== null; }))
        .concat([r.origin === '계산' ? '계산(문서 값으로 산출)' : '문서']));
    });
    out['비교표'] = t;
    var src = [['모델', '항목', '원문 이름', '원문 값', '원래 단위', '표준 값', '표준 단위', '환산', '단위 가정', '구분(S/O)', '메모']];
    models.forEach(function (m) {
      FIELDS.forEach(function (f) {
        var it = m.items[f.key]; if (!it) return;
        src.push([m.name, f.label, it.label || '', it.raw, unitName(it.srcUnit), round(it.value, DIMS[f.dim].dec + 2), it.unit,
          it.converted ? '환산' : it.computed ? '계산' : '', it.assumed ? '가정' : '', soName(it.so), it.notes.join(' / ')]);
      });
    });
    out['원문대조'] = src;
    var so = [['사양'].concat(names)];
    cmp.features.forEach(function (f) { so.push([f.key].concat(f.cells.map(soName))); });
    out['표준_옵션'] = so;
    var unk = [['모델', '원문 이름', '원문 값', '사유']];
    models.forEach(function (m) { m.unknown.forEach(function (u) { unk.push([m.name, u.label, u.value, u.why]); }); m.issues.forEach(function (s) { unk.push([m.name, '', '', s]); }); });
    out['미인식_확인'] = unk;
    var lf = [['모델', '방향', '높이(mm)'].concat(['반경(mm) →'])];
    Object.keys(lifts || {}).forEach(function (name) {
      var L = lifts[name];
      L.grids.forEach(function (g) {
        lf.push([name, DIR_NAMES[g.direction], '높이 \\ 반경'].concat(g.radii));
        g.heights.forEach(function (h, i) {
          lf.push([name, DIR_NAMES[g.direction], h].concat(g.cells[i].map(function (c) { return c ? c.value + (c.limited ? '*' : '') : ''; })));
        });
        lf.push([]);
      });
    });
    lf.push(['값은 kg, * 는 유압 한계']);
    out['인양력'] = lf;
    return out;
  }
  function liftCompareTable(nameA, nameB, dirName, lc) {
    var t = [[nameA + ' 대비 ' + nameB + ' — ' + dirName + ' (kg, 차이 %)'], ['높이 \\ 반경(mm)'].concat(lc.radii)];
    lc.heights.forEach(function (h, i) {
      t.push([h].concat(lc.cells[i].map(function (c) { return c.pct == null ? '' : c.a.value + ' → ' + c.b.value + ' (' + (c.pct > 0 ? '+' : '') + c.pct + '%)'; })));
    });
    t.push([]); t.push(['공통 점', lc.common, '한쪽에만 있는 점', lc.onlyA + ' / ' + lc.onlyB, '평균 차이(%)', lc.avgPct == null ? '' : lc.avgPct]);
    return t;
  }

  /* ---------- AI(선택) ---------- */
  // 이미지형 표를 글로 옮기는 지시문. 결과는 사람이 원본과 대조해야 하는 초안이다.
  var AI_PROMPTS = {
    spec: '이 이미지는 건설기계 카탈로그의 제원표입니다. 표에 보이는 항목과 값만 한 줄에 하나씩 「항목<TAB>값 단위」 형식으로 옮겨 주세요. ' +
      '단위는 이미지에 적힌 그대로 쓰고 바꾸지 마세요. 표준/옵션 표시가 있으면 값 뒤에 (Std) 또는 (Opt) 를 붙이세요. ' +
      '읽을 수 없는 칸은 건너뛰고, 이미지에 없는 값을 짐작해 채우지 마세요. 설명 문장 없이 표 내용만 출력하세요.',
    lift: '이 이미지는 굴착기 인양력(Lifting capacity) 표입니다. 방향(정면/측면)마다 아래 형식의 탭 구분 표로 옮겨 주세요.\n' +
      '첫 줄: 단위: <이미지의 하중 단위 kg 또는 lb>\n방향 줄: 정면 또는 측면\n머리글 줄: 높이 \\ 반경<TAB>반경1<TAB>반경2 …(길이 단위 포함, 예 3.0 m 또는 10 ft)\n' +
      '값 줄: 높이<TAB>값<TAB>값 …  유압 한계 표시(*)는 값 뒤에 그대로 붙이세요. 빈 칸은 - 로 쓰세요.\n' +
      '이미지에 없는 값을 만들지 말고, 설명 문장 없이 표만 출력하세요.'
  };

  /* ---------- 예제 ---------- */
  // 실제 제조사·실제 제원이 아니다. 5~6톤급 소형 굴착기처럼 보이게 만든 가짜 카탈로그 세 장이다.
  // 일부러 형식을 다르게 했다 — A사는 한글·SI, B사는 영문·영미 단위(hp·lb·ft-in·gpm), C사는 PS·kgf·tf·단위 표기 줄.
  function sample() {
    var A = [
      'A사 AX-55 소형 굴착기 주요 제원',
      '운전중량\t5,450 kg (고무 슈) / 5,560 kg (철 슈)',
      '엔진 정격출력\t36.2 kW (48.5 hp) / 2,200 rpm',
      '버킷 용량(SAE 산적)\t0.18 m³ (표준) / 0.20 m³ (옵션)',
      '버킷 굴삭력(ISO)\t41.2 kN',
      '암 굴삭력(ISO)\t27.5 kN',
      '최대 유량\t2 x 60 L/min',
      '최고 사용압력\t24.5 MPa',
      '주행 속도(저/고)\t2.6/4.5 km/h',
      '선회 속도\t9.5 rpm',
      '연료 탱크\t75 L',
      '전장\t5,560 mm',
      '전폭\t1,920 mm',
      '전고\t2,540 mm',
      '후방 선회반경\t980 mm',
      '슈 폭\t400 mm',
      '최대 굴삭 깊이\t3,820 mm',
      '최대 굴삭 반경\t6,080 mm',
      '최대 굴삭 높이\t5,710 mm',
      '최대 덤프 높이\t4,060 mm',
      '캐빈 에어컨\t표준',
      '퀵 커플러\t옵션',
      '도저 블레이드\t표준'
    ].join('\n');
    var B = [
      'B사 B57 Compact Excavator Specifications',
      'Operating weight (canopy)  12,100 lb',
      'Operating weight (cab)  12,450 lb',
      'Net engine power  47.6 hp @ 2,400 rpm',
      'Bucket capacity  0.25 yd3 (Std.) ; 0.31 yd3 (Opt.)',
      'Bucket breakout force (ISO 6015)  9,050 lbf',
      'Arm digging force (ISO 6015)  6,160 lbf',
      'Hydraulic pump flow  31.7 gpm',
      'Relief valve setting  3,555 psi',
      'Travel speed  1.7/2.9 mph',
      'Swing speed  9.2 rpm',
      'Fuel tank capacity  21.1 gal',
      'Overall length  18\' 5"',
      'Overall width  6\' 5"',
      'Overall height (cab)  8\' 4"',
      'Tail swing radius  3\' 4"',
      'Track shoe width  15.7 in',
      'Max. digging depth  12\' 9"',
      'Max. reach at ground level  20\' 3"',
      'Max. dig height  18\' 10"',
      'Max. dump height  13\' 5"',
      'Air conditioner  Opt.',
      'Quick coupler  Std.',
      'Hydraulic thumb  Opt.',
      'Dozer blade  Std.'
    ].join('\n');
    var C = [
      'C사 CX-5.5 제원표',
      '장비중량\t5.6 ton',
      '엔진 출력\t50 PS / 2,300 min-1',
      '버킷 표준 용량\t0.2 m3',
      '버킷 굴삭력\t4,300 kgf',
      '암 굴삭력\t2.9 tf',
      '펌프 최대 토출량 (ℓ/min)\t118',
      '릴리프 압력\t250 kgf/cm²',
      '주행속도 고속\t4.4 km/h',
      '선회속도\t10 rpm',
      '연료탱크 용량\t70 ℓ',
      '단위: mm',
      '전장\t5,620',
      '전폭\t1,960',
      '전고\t2,560',
      '후방 선회 반경\t1.05 m',
      '트랙 슈 폭\t400',
      '최대 굴삭 깊이\t3,900',
      '최대 굴삭 반경\t6,150',
      '최대 굴삭 높이\t5,800',
      '최대 덤프 높이\t4,150',
      '작업등\tLED 4개',
      '운전석 에어컨\t●',
      '퀵커플러\t○',
      '후방 카메라\t○',
      '(●표준 ○옵션)'
    ].join('\n');
    var LA = [
      'A사 AX-55 인양력 (단위: kg)   * 표시는 유압 한계',
      '정면',
      '높이 \\ 반경\t3.0 m\t4.0 m\t5.0 m',
      '3.0 m\t1,180*\t910*\t720',
      '2.0 m\t1,420*\t980\t700',
      '0 m\t1,650*\t940\t660',
      '-1.0 m\t1,600*\t930\t650',
      '측면',
      '높이 \\ 반경\t3.0 m\t4.0 m\t5.0 m',
      '3.0 m\t1,180*\t860\t610',
      '2.0 m\t1,300\t820\t590',
      '0 m\t1,250\t780\t560',
      '-1.0 m\t1,240\t770\t550'
    ].join('\n');
    var LB = [
      'B사 B57 Lifting capacity (lb)   *Hydraulic limit',
      'Over front',
      'Load point height\t9.8 ft\t13.1 ft\t16.4 ft',
      '9.8 ft\t2,560*\t2,050*\t1,650',
      '6.6 ft\t3,180*\t2,240\t1,580',
      'Ground\t3,700*\t2,130\t1,490',
      '-3.3 ft\t3,590*\t2,110\t1,470',
      'Over side',
      'Load point height\t9.8 ft\t13.1 ft\t16.4 ft',
      '9.8 ft\t2,560*\t1,960\t1,400',
      '6.6 ft\t2,950\t1,870\t1,350',
      'Ground\t2,830\t1,780\t1,280',
      '-3.3 ft\t2,800\t1,750\t1,260'
    ].join('\n');
    var LC = [
      'C사 CX-5.5 인양력 단위: kg',
      '정면',
      '하중점 높이 \\ 반경\t3 m\t4 m\t4.5 m\t최대',
      '3 m\t1,210*\t930*\t830\t700',
      '1.5 m\t1,500*\t990\t880\t690',
      'GL\t1,700*\t960\t850\t660',
      '-1.5 m\t1,560*\t940\t840\t-'
    ].join('\n');
    return {
      models: [{ name: 'A사 AX-55', text: A }, { name: 'B사 B57', text: B }, { name: 'C사 CX-5.5', text: C }],
      lifts: { 'A사 AX-55': LA, 'B사 B57': LB, 'C사 CX-5.5': LC }
    };
  }

  var api = {
    DIMS: DIMS, FIELDS: FIELDS, FIELD: FIELD, DERIVED: DERIVED, ALIASES: ALIASES, FEATURE_ALIASES: FEATURE_ALIASES,
    UNIT_NAMES: UNIT_NAMES, DIM_LABELS: DIM_LABELS, DIR_NAMES: DIR_NAMES, AI_PROMPTS: AI_PROMPTS,
    quantities: quantities, convert: convert, round: round, normLabel: normLabel, matchField: matchField, featureKey: featureKey,
    soOf: soOf, markerOnly: markerOnly, parseValue: parseValue, splitLabel: splitLabel, parseText: parseText, parseTable: parseTable,
    pdfLines: pdfLines, parseLift: parseLift, gridOf: gridOf, compareLift: compareLift, compareModels: compareModels,
    fmtNum: fmtNum, display: display, liftDisplay: liftDisplay, lenLabel: lenLabel, soName: soName, unitName: unitName,
    exportTables: exportTables, liftCompareTable: liftCompareTable, sample: sample
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Spec = api;
})(this);
