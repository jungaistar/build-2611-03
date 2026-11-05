/* 화면 — 판정·환산은 spec.js 가 한다. 여기서는 읽고, 그리고, 고른 값을 넘길 뿐이다. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var ALIAS_KEY = 'b2611_03_aliases', AI_KEY = 'b2611_03_ai';
  // sources 가 원본이다. 모델은 별칭이 바뀔 때마다 sources 에서 다시 만든다.
  var state = { sources: [], removed: {}, models: [], lifts: {}, cmp: null, aliases: loadAliases() };

  function loadAliases() { try { return JSON.parse(localStorage.getItem(ALIAS_KEY) || '{}'); } catch (e) { return {}; } }
  function saveAliases() { try { localStorage.setItem(ALIAS_KEY, JSON.stringify(state.aliases)); } catch (e) {} }

  /* ---------- 모델 만들기 ---------- */
  function rebuild() {
    var out = [];
    state.sources.forEach(function (src) {
      if (src.kind === 'text') out.push(Spec.parseText(src.text, { name: src.name, source: src.source, aliases: state.aliases }));
      else Spec.parseTable(src.aoa, { source: src.source, aliases: state.aliases }).models.forEach(function (m) { out.push(m); });
    });
    // 같은 이름이 다시 들어오면 나중 것이 이긴다
    var byName = {};
    out.forEach(function (m) { byName[m.name] = m; });
    state.models = Object.keys(byName).filter(function (n) { return !state.removed[n]; }).map(function (n) { return byName[n]; });
    renderModels(); renderCompare(); fillLiftSelects(); renderLift();
  }
  function addText(name, text, source) {
    name = String(name || '').trim();
    if (!name) { var t = Spec.parseText(text, {}); name = t.title || ('모델 ' + (state.sources.length + 1)); }
    state.sources = state.sources.filter(function (s) { return !(s.kind === 'text' && s.name === name); });
    delete state.removed[name];
    state.sources.push({ kind: 'text', name: name, text: text, source: source || '붙여넣기' });
  }

  /* ---------- 파일 읽기 ---------- */
  function readFiles(files) {
    var list = Array.prototype.slice.call(files || []), jobs = [];
    list.forEach(function (f) {
      var nm = f.name.replace(/\.[^.]+$/, '');
      if (/\.pdf$/i.test(f.name)) jobs.push(readPdf(f).then(function (text) {
        addText(nm, text, 'PDF ' + f.name);
        $('m-name').value = nm; $('m-text').value = text;
        return f.name + ' — PDF 글 ' + text.split('\n').length + '줄';
      }));
      else if (/\.txt$/i.test(f.name)) jobs.push(f.text().then(function (text) { addText(nm, text, '글 ' + f.name); return f.name; }));
      else jobs.push(f.arrayBuffer().then(function (buf) { return readWorkbook(buf, f.name); }));
    });
    Promise.all(jobs.map(function (j) { return j.catch(function (e) { return '읽지 못함: ' + e.message; }); })).then(function (msgs) {
      rebuild();
      $('in-status').innerHTML = '<div class="note">' + msgs.map(esc).join('<br>') + '</div>';
    });
  }
  function readWorkbook(buf, fname) {
    var wb = XLSX.read(new Uint8Array(buf), { type: 'array' }), got = [];
    wb.SheetNames.forEach(function (sn) {
      var aoa = XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, raw: false, defval: '' });
      if (/인양|lift/i.test(sn)) {
        // 시트 이름 「인양력_A사 AX-55」 → 그 모델의 인양력
        var model = sn.replace(/^(인양력|인양|lifting|lift)[\s_\-]*/i, '').trim() || $('l-model').value || sn;
        state.lifts[model] = { raw: aoa, parsed: Spec.parseLift(aoa) };
        got.push('인양력 「' + model + '」');
      } else if (!/작성법|guide/i.test(sn)) {
        state.sources.push({ kind: 'table', aoa: aoa, source: '엑셀 ' + fname + ' / ' + sn });
        got.push('시트 「' + sn + '」');
      }
    });
    return fname + ' — ' + got.join(', ');
  }
  // pdf.js 는 모듈이라 필요할 때만 불러온다. 파일을 더블클릭해 열면(file://) 브라우저가 막는다.
  var pdfjsP = null;
  function readPdf(f) {
    if (!pdfjsP) pdfjsP = import(new URL('lib/pdf.min.mjs', document.baseURI).href).then(function (m) {
      m.GlobalWorkerOptions.workerSrc = new URL('lib/pdf.worker.min.mjs', document.baseURI).href; return m;
    });
    return Promise.all([pdfjsP, f.arrayBuffer()]).then(function (r) {
      var pdfjs = r[0];
      return pdfjs.getDocument({ data: r[1], cMapUrl: new URL('lib/cmaps/', document.baseURI).href, cMapPacked: true }).promise.then(function (doc) {
        var jobs = [];
        for (var p = 1; p <= doc.numPages; p++) jobs.push(doc.getPage(p).then(function (pg) { return pg.getTextContent(); }));
        return Promise.all(jobs).then(function (pages) {
          var text = pages.map(function (tc) { return Spec.pdfLines(tc.items).join('\n'); }).join('\n');
          doc.destroy();
          if (!text.trim()) throw new Error('글자가 없는 PDF(스캔 이미지)입니다 — 4번 AI 추출이나 붙여넣기를 쓰세요');
          return text;
        });
      });
    }, function (e) { throw new Error('PDF 를 읽지 못했습니다. 웹 주소로 열었는지 확인하세요(' + e.message + ')'); });
  }

  /* ---------- 모델 목록 ---------- */
  function fieldOptions() {
    return '<option value="">표준 항목 고르기</option>' + Spec.FIELDS.map(function (f) { return '<option value="' + f.key + '">' + esc(f.label) + '</option>'; }).join('');
  }
  function renderModels() {
    var total = Spec.FIELDS.length;
    $('models').innerHTML = state.models.map(function (m, i) {
      var items = Object.keys(m.items).map(function (k) { return m.items[k]; });
      var conv = items.filter(function (x) { return x.converted || x.computed; }).length;
      var asm = items.filter(function (x) { return x.assumed; }).length;
      var h = '<div class="model" data-i="' + i + '"><h4>' + esc(m.name) + (m.ai ? '<span class="tag t-ai">AI 초안 — 검토 필요</span>' : '') + '</h4>' +
        '<div class="src">' + esc(m.source) + '</div><div class="stats">' +
        '<div class="stat"><b>' + items.length + ' / ' + total + '</b>표준 항목</div>' +
        '<div class="stat"><b>' + conv + '</b>환산·계산</div>' +
        '<div class="stat ' + (asm ? 'bad' : '') + '"><b>' + asm + '</b>단위 가정</div>' +
        '<div class="stat"><b>' + m.features.length + '</b>S/O 사양</div>' +
        '<div class="stat ' + (m.unknown.length ? 'bad' : '') + '"><b>' + m.unknown.length + '</b>읽지 못한 줄</div></div>';
      if (m.issues.length) h += '<ul class="issue">' + m.issues.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ul>';
      if (m.unknown.length) h += '<details open><summary>읽지 못한 줄 ' + m.unknown.length + '개 — 표준 항목에 짝지어 기억시키기</summary><ul>' +
        m.unknown.map(function (u, j) {
          return '<li class="unk"><span><b>' + esc(u.label) + '</b> ' + esc(u.value) + ' <span class="sub">(' + esc(u.why) + ')</span></span>' +
            '<select data-j="' + j + '" aria-label="짝지을 표준 항목">' + fieldOptions() + '</select>' +
            '<button class="btn sm" data-act="alias" data-j="' + j + '">이 이름 기억</button></li>';
        }).join('') + '</ul></details>';
      var miss = Spec.FIELDS.filter(function (f) { return !m.items[f.key]; });
      if (miss.length) h += '<details><summary>카탈로그에 없던 항목 ' + miss.length + '개</summary><p class="sub" style="margin-top:6px">' + miss.map(function (f) { return esc(f.label); }).join(' · ') + '</p></details>';
      h += '<div class="acts">' + (sourceOf(m) && sourceOf(m).kind === 'text' ? '<button class="btn sm" data-act="edit">원문 고치기</button>' : '') +
        '<button class="btn sm" data-act="del">빼기</button></div></div>';
      return h;
    }).join('');
    var on = state.models.length > 0;
    $('s-compare').hidden = !on; $('s-lift').hidden = !on;
  }
  function sourceOf(m) { return state.sources.filter(function (s) { return s.kind === 'text' && s.name === m.name; })[0]; }

  /* ---------- 비교표 ---------- */
  function sys() { return $('sys').value; }
  function cellView(r, c) {
    if (c.value == null) return { html: '—', cls: 'miss' };
    var d = r.dim ? Spec.display(c.value, r.dim, sys()) : { text: Spec.fmtNum(c.value, 2), unit: r.unit };
    var it = c.item, tags = '';
    if (r.origin === '계산') tags += '<span class="tag t-calc">계산</span>';
    if (it && it.converted) tags += '<span class="tag t-conv">환산</span>';
    if (it && it.computed) tags += '<span class="tag t-calc">계산</span>';
    if (it && it.assumed) tags += '<span class="tag t-assume">단위 가정</span>';
    if (it && it.so) tags += '<span class="tag t-so">' + it.so + '</span>';
    if (c.best) tags += '<span class="tag t-best">최고</span>';
    var pct = c.pct == null ? '' : '<span class="pct">' + (c.pct > 0 ? '+' : '') + c.pct + '%</span>';
    return { html: '<span class="num">' + esc(d.text) + '</span><span class="u">' + esc(d.unit === 'ft-in' ? '' : d.unit) + '</span>' + tags + pct,
      cls: 'v' + (c.flag ? ' ' + c.flag : '') + (c.best ? ' best' : '') };
  }
  function renderCompare() {
    var ms = state.models;
    if (!ms.length) { state.cmp = null; return; }
    // 기준·비교 모델은 이름으로 기억한다 — 모델을 빼면 순번이 바뀐다
    var names = ms.map(function (m) { return m.name; });
    var base = Math.max(0, names.indexOf(state.baseName));
    state.baseName = names[base];
    $('base').innerHTML = ms.map(function (m, i) { return '<option value="' + i + '">' + esc(m.name) + '</option>'; }).join('');
    $('base').value = base;
    var cmp = Spec.compareModels(ms, base, { threshold: +$('thr').value || 0 });
    state.cmp = cmp;
    var h = '<table><thead><tr><th>항목</th>' + ms.map(function (m, i) { return '<th class="' + (i === base ? 'base' : '') + '">' + esc(m.name) + (i === base ? ' <small>(기준)</small>' : '') + '</th>'; }).join('') + '</tr></thead><tbody>';
    var grp = '';
    cmp.rows.forEach(function (r, ri) {
      if (r.group !== grp) { grp = r.group; h += '<tr class="grp"><th colspan="' + (ms.length + 1) + '">' + esc(grp) + '</th></tr>'; }
      h += '<tr><th>' + esc(r.label) + '</th>' + r.cells.map(function (c, ci) {
        var v = cellView(r, c);
        return '<td class="' + v.cls + '" data-r="' + ri + '" data-c="' + ci + '">' + v.html + '</td>';
      }).join('') + '</tr>';
    });
    $('cmp').innerHTML = h + '</tbody></table>';
    var adv = 0, dis = 0;
    cmp.rows.forEach(function (r) { r.cells.forEach(function (c) { if (c.flag === 'adv') adv++; if (c.flag === 'dis') dis++; }); });
    $('cmp-sum').innerHTML = '<div class="stats"><div class="stat"><b>' + ms.length + '</b>모델</div><div class="stat"><b>' + cmp.rows.length + '</b>비교 항목</div>' +
      '<div class="stat"><b>' + cmp.flagged + '</b>' + cmp.threshold + '% 이상 차이 칸</div><div class="stat"><b>' + adv + ' / ' + dis + '</b>기준보다 유리 / 불리</div></div>';
    $('cell-why').innerHTML = '';
    // S/O 표
    $('feat').innerHTML = cmp.features.length ? '<table><thead><tr><th>사양</th>' + ms.map(function (m) { return '<th>' + esc(m.name) + '</th>'; }).join('') + '</tr></thead><tbody>' +
      cmp.features.map(function (f) { return '<tr><th>' + esc(f.key) + '</th>' + f.cells.map(function (s) { return '<td class="c">' + (s === 'S' ? '● 표준' : s === 'O' ? '○ 옵션' : s === '-' ? '없음' : '<span class="sub">표기 없음</span>') + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table>'
      : '<p class="sub" style="padding:10px">카탈로그에 표준/옵션 사양 줄이 없습니다.</p>';
    // 그래프 선택지
    var bf = $('bar-field').value, dm = names.indexOf(state.diffName);
    $('bar-field').innerHTML = cmp.rows.map(function (r) { return '<option value="' + r.key + '">' + esc(r.label) + '</option>'; }).join('');
    if (bf && cmp.rows.some(function (r) { return r.key === bf; })) $('bar-field').value = bf;
    $('diff-model').innerHTML = ms.map(function (m, i) { return i === base ? '' : '<option value="' + i + '">' + esc(m.name) + '</option>'; }).join('');
    if (dm >= 0 && dm !== base) $('diff-model').value = dm;
    renderBars(); renderDiff();
  }
  function showWhy(ri, ci) {
    var r = state.cmp.rows[ri], c = r.cells[ci], m = state.models[ci];
    if (c.value == null) { $('cell-why').innerHTML = '<div class="why"><b>' + esc(m.name) + ' · ' + esc(r.label) + '</b><p>카탈로그에 이 항목이 없습니다.</p></div>'; return; }
    var h = '<div class="why"><b>' + esc(m.name) + ' · ' + esc(r.label) + '</b>';
    if (r.origin === '계산') {
      h += '<p>문서 값으로 계산한 값입니다: 엔진 정격출력 ÷ (운전중량 ÷ 1,000) = ' + Spec.fmtNum(c.value, 2) + ' ' + esc(r.unit) + '</p>';
    } else {
      var it = c.item;
      h += '<p>원문 이름: <code>' + esc(it.label) + '</code> · 원문 값: <code>' + esc(it.raw) + '</code></p>' +
        '<p>원래 단위 ' + esc(Spec.unitName(it.srcUnit)) + ' → 표준 ' + Spec.fmtNum(it.value, Spec.DIMS[r.dim].dec + 2) + ' ' + esc(it.unit) +
        (it.converted ? ' (환산)' : '') + (it.computed ? ' (계산)' : '') + (it.assumed ? ' (단위 가정 — 원문 확인 필요)' : '') + '</p>';
      if (it.so) h += '<p>구분: ' + Spec.soName(it.so) + '</p>';
      if (it.notes.length) h += '<p class="sub">' + it.notes.map(esc).join('<br>') + '</p>';
    }
    if (c.pct != null) h += '<p>기준 모델 대비 ' + (c.pct > 0 ? '+' : '') + c.pct + '%</p>';
    $('cell-why').innerHTML = h + '</div>';
  }

  // 항목 하나를 모델별 가로 막대로
  function renderBars() {
    var cmp = state.cmp; if (!cmp) return;
    var r = cmp.rows.filter(function (x) { return x.key === $('bar-field').value; })[0] || cmp.rows[0];
    var ms = state.models, W = 1000, L = 190, R = 150, row = 34, T = 14, H = T + ms.length * row + 26;
    var vals = r.cells.map(function (c) { return c.value; });
    var max = Math.max.apply(null, vals.filter(function (v) { return v != null; }).map(Math.abs).concat([1e-9]));
    var g = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(r.label) + ' 모델별 막대">';
    ms.forEach(function (m, i) {
      var y = T + i * row, c = r.cells[i];
      g += '<text class="lb" x="' + (L - 10) + '" y="' + (y + 19) + '" text-anchor="end">' + esc(m.name) + '</text>';
      if (c.value == null) { g += '<text class="ax" x="' + L + '" y="' + (y + 19) + '">카탈로그에 없음</text>'; return; }
      var w = Math.max(2, (W - L - R) * Math.abs(c.value) / max);
      var d = r.dim ? Spec.display(c.value, r.dim, sys()) : { text: Spec.fmtNum(c.value, 2), unit: r.unit };
      g += '<rect class="bar ' + (i === cmp.base ? 'base' : c.best ? 'best' : '') + '" x="' + L + '" y="' + (y + 4) + '" width="' + w + '" height="' + (row - 12) + '" rx="3"><title>' + esc(m.name + ' ' + d.text + ' ' + d.unit) + '</title></rect>';
      g += '<text class="vl" x="' + (L + w + 8) + '" y="' + (y + 19) + '">' + esc(d.text + ' ' + (d.unit === 'ft-in' ? '' : d.unit)) + (c.pct != null ? ' (' + (c.pct > 0 ? '+' : '') + c.pct + '%)' : '') + '</text>';
    });
    g += '<text class="ax" x="' + L + '" y="' + (H - 8) + '">' + esc(r.label) + ' · 진한 막대 = 기준 모델' + (r.better ? ' · 초록 = 가장 유리한 값' : '') + '</text></svg>';
    $('bars').innerHTML = g;
  }
  // 비교 모델의 항목별 차이(%) — 0 을 가운데에 두고 좌우로
  function renderDiff() {
    var cmp = state.cmp; if (!cmp) return;
    var ci = +$('diff-model').value;
    if (isNaN(ci) || ci === cmp.base || ci >= state.models.length) { $('diffbars').innerHTML = '<p class="sub">비교할 모델이 하나 더 있어야 합니다.</p>'; return; }
    var rows = cmp.rows.filter(function (r) { return r.cells[ci].pct != null; });
    var W = 1000, L = 190, R = 20, row = 26, T = 24, H = T + rows.length * row + 30;
    var lim = Math.max(10, Math.max.apply(null, rows.map(function (r) { return Math.abs(r.cells[ci].pct); }).concat([0])));
    var mid = L + (W - L - R) / 2, sc = (W - L - R) / 2 / lim;
    var g = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="기준 대비 차이">';
    [-lim, -lim / 2, 0, lim / 2, lim].forEach(function (v) {
      var x = mid + v * sc;
      g += '<line class="' + (v ? 'grid' : 'zero') + '" x1="' + x + '" x2="' + x + '" y1="' + (T - 6) + '" y2="' + (H - 24) + '"/><text class="ax" x="' + x + '" y="' + (T - 10) + '" text-anchor="middle">' + (v > 0 ? '+' : '') + Spec.round(v, 1) + '%</text>';
    });
    rows.forEach(function (r, i) {
      var c = r.cells[ci], y = T + i * row, w = Math.abs(c.pct) * sc, x = c.pct < 0 ? mid - w : mid;
      g += '<text class="lb" x="' + (L - 10) + '" y="' + (y + 16) + '" text-anchor="end">' + esc(r.label) + '</text>';
      g += '<rect class="bar ' + (c.flag || 'small') + '" x="' + x + '" y="' + (y + 4) + '" width="' + Math.max(1, w) + '" height="' + (row - 9) + '" rx="2"><title>' + esc(r.label + ' ' + (c.pct > 0 ? '+' : '') + c.pct + '%') + '</title></rect>';
    });
    g += '<text class="ax" x="' + L + '" y="' + (H - 6) + '">' + esc(state.models[ci].name + ' − ' + state.models[cmp.base].name) + ' · 회색 = ' + cmp.threshold + '% 미만 · 초록 유리 · 빨강 불리 · 노랑 우열 없음</text></svg>';
    $('diffbars').innerHTML = g;
  }

  /* ---------- 인양력 ---------- */
  function fillLiftSelects() {
    var names = state.models.map(function (m) { return m.name; });
    Object.keys(state.lifts).forEach(function (n) { if (names.indexOf(n) < 0) names.push(n); });
    var keep = { 'l-model': $('l-model').value, la: $('la').value, lb: $('lb').value };
    var opts = names.map(function (n) { return '<option>' + esc(n) + '</option>'; }).join('');
    $('l-model').innerHTML = opts;
    var withLift = names.filter(function (n) { return state.lifts[n]; });
    var lo = withLift.map(function (n) { return '<option>' + esc(n) + '</option>'; }).join('');
    $('la').innerHTML = lo; $('lb').innerHTML = lo;
    if (keep['l-model'] && names.indexOf(keep['l-model']) >= 0) $('l-model').value = keep['l-model'];
    if (keep.la && withLift.indexOf(keep.la) >= 0) $('la').value = keep.la;
    if (keep.lb && withLift.indexOf(keep.lb) >= 0) $('lb').value = keep.lb; else if (withLift.length > 1) $('lb').value = withLift[1];
  }
  function gridTable(g, mark) {
    var s = sys();
    return '<div class="tablewrap"><table class="lgrid"><thead><tr><th>높이 \\ 반경</th>' + g.radii.map(function (r) { return '<th>' + esc(Spec.lenLabel(r, s)) + '</th>'; }).join('') + '</tr></thead><tbody>' +
      g.heights.map(function (h, i) {
        return '<tr><th>' + esc(Spec.lenLabel(h, s)) + '</th>' + g.cells[i].map(function (c, j) {
          if (!c) return '<td class="na">—</td>';
          var cls = (c.limited ? 'lim ' : '') + (mark ? mark(i, j) : '');
          return '<td class="' + cls + '">' + Spec.liftDisplay(c.value, s) + (c.limited ? '*' : '') + '</td>';
        }).join('') + '</tr>';
      }).join('') + '</tbody></table></div>';
  }
  function renderLift() {
    var names = Object.keys(state.lifts);
    $('lift-status').innerHTML = names.length ? '<div class="stats">' + names.map(function (n) {
      var L = state.lifts[n].parsed;
      return '<div class="stat ' + (L.grids.length ? '' : 'bad') + '"><b>' + esc(n) + (L.ai ? ' <span class="tag t-ai">AI 초안 — 검토 필요</span>' : '') + '</b>격자 ' + L.grids.length + '개 · ' +
        L.grids.map(function (g) { return Spec.DIR_NAMES[g.direction] + ' ' + g.heights.length + '×' + g.radii.length; }).join(', ') + ' · 원 단위 ' + esc(L.unit) +
        (L.issues.length ? '<br><span class="issue">' + L.issues.map(esc).join('<br>') + '</span>' : '') + '</div>';
    }).join('') + '</div>' : '';
    var a = state.lifts[$('la').value], b = state.lifts[$('lb').value], dir = $('ldir').value;
    if (!a) { $('lift-out').innerHTML = '<p class="sub">인양력 표를 하나 이상 읽으면 격자가 나옵니다.</p>'; return; }
    var ga = Spec.gridOf(a.parsed, dir), gb = b ? Spec.gridOf(b.parsed, dir) : null;
    var unit = sys() === 'imp' ? 'lb' : 'kg';
    var h = '<p class="sub">값 단위 ' + unit + ' · * 유압 한계 · 방향 ' + esc(Spec.DIR_NAMES[dir]) + '</p>';
    if (!ga) { $('lift-out').innerHTML = h + '<div class="warn">' + esc($('la').value) + ' 에 ' + esc(Spec.DIR_NAMES[dir]) + ' 표가 없습니다.</div>'; state.lc = null; return; }
    var same = $('la').value === $('lb').value;
    if (!gb || same) {
      state.lc = null;
      $('lift-out').innerHTML = h + '<div class="lift-grids"><div><h4>' + esc($('la').value) + '</h4>' + gridTable(ga) + '</div></div>' +
        (b && !same ? '<div class="warn">' + esc($('lb').value) + ' 에 ' + esc(Spec.DIR_NAMES[dir]) + ' 표가 없습니다.</div>' : '<p class="sub">B 에 다른 모델을 고르면 공통 점을 비교합니다.</p>');
      return;
    }
    var lc = Spec.compareLift(ga, gb, +$('ltol').value || 0);
    state.lc = { a: $('la').value, b: $('lb').value, dir: Spec.DIR_NAMES[dir], lc: lc };
    h += '<div class="lift-grids"><div><h4>A · ' + esc($('la').value) + '</h4>' + gridTable(ga) + '</div><div><h4>B · ' + esc($('lb').value) + '</h4>' + gridTable(gb) + '</div></div>';
    h += '<div class="stats"><div class="stat"><b>' + lc.common + '</b>공통 점</div><div class="stat"><b>' + lc.onlyA + ' / ' + lc.onlyB + '</b>한쪽에만 있는 점 (A / B)</div>' +
      '<div class="stat"><b>' + (lc.avgPct == null ? '—' : (lc.avgPct > 0 ? '+' : '') + lc.avgPct + '%') + '</b>평균 차이 (B − A)</div><div class="stat"><b>' + lc.maxOffset + ' mm</b>짝지은 점의 최대 위치 차이</div></div>';
    if (!lc.common) h += '<div class="warn">허용 오차 안에서 겹치는 높이·반경이 없습니다. 오차를 늘리거나 표를 확인하세요. 없는 점은 보간으로 만들지 않습니다.</div>';
    else {
      h += '<h3>공통 점 비교 (B − A, %)</h3><div class="tablewrap"><table class="lgrid"><thead><tr><th>높이 \\ 반경</th>' + lc.radii.map(function (r) { return '<th>' + esc(Spec.lenLabel(r, sys())) + '</th>'; }).join('') + '</tr></thead><tbody>' +
        lc.heights.map(function (hh, i) {
          return '<tr><th>' + esc(Spec.lenLabel(hh, sys())) + '</th>' + lc.cells[i].map(function (c) {
            if (c.pct == null) return '<td class="na">—</td>';
            return '<td class="diff ' + (c.pct >= 0 ? 'up' : 'down') + '" title="' + esc('A ' + c.a.value + ' kg → B ' + c.b.value + ' kg') + '">' + (c.pct > 0 ? '+' : '') + c.pct + '%<br><small>' +
              Spec.liftDisplay(c.a.value, sys()) + ' → ' + Spec.liftDisplay(c.b.value, sys()) + '</small></td>';
          }).join('') + '</tr>';
        }).join('') + '</tbody></table></div><p class="sub" style="margin-top:6px">위치는 A 기준으로 적었습니다. 초록 = B 가 더 큼, 빨강 = B 가 더 작음.</p>';
    }
    $('lift-out').innerHTML = h;
  }

  /* ---------- 엑셀 ---------- */
  function exportXlsx() {
    if (!state.cmp) return;
    var lifts = {}; Object.keys(state.lifts).forEach(function (n) { lifts[n] = state.lifts[n].parsed; });
    var t = Spec.exportTables(state.models, state.cmp, lifts, sys());
    var wb = XLSX.utils.book_new();
    Object.keys(t).forEach(function (n) { XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(t[n]), n); });
    if (state.lc) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(Spec.liftCompareTable(state.lc.a, state.lc.b, state.lc.dir, state.lc.lc)), '인양력비교');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['안내'], ['비교표 단위: ' + (sys() === 'imp' ? '영미' : 'SI') + ' · 차이(%)는 기준 모델 「' + state.models[state.cmp.base].name + '」 대비'],
      ['「원문대조」 시트에서 원문 값과 환산 값을 대조하세요. 「환산」「계산」「가정」 표시는 문서에 적힌 값과 신뢰도가 다릅니다.'], ['예제 데이터(A사·B사·C사)는 실제 제조사·실제 제원이 아닙니다.']]), '안내');
    XLSX.writeFile(wb, '경쟁사_제원비교_' + new Date().toISOString().slice(0, 10) + '.xlsx');
  }
  function template() {
    var wb = XLSX.utils.book_new();
    var head = [['항목', '단위', '구분', 'A사 모델', 'B사 모델']];
    Spec.FIELDS.forEach(function (f) { head.push([f.label, Spec.DIMS[f.dim].canon, '', '', '']); });
    head.push(['에어컨', '', '', '표준', '옵션']);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(head), '제원');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['단위: kg'], ['정면'], ['높이 \\ 반경', '3.0 m', '4.0 m', '5.0 m'], ['3.0 m', '', '', ''], ['0 m', '', '', ''], ['측면'], ['높이 \\ 반경', '3.0 m', '4.0 m', '5.0 m'], ['3.0 m', '', '', '']]), '인양력_A사 모델');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      ['시트', '쓰는 법'],
      ['제원', '열 하나가 모델 하나입니다. 단위 열이 비면 값 칸에 적힌 단위를 읽습니다(5,450 kg · 48.5 hp · 18\' 5").'],
      ['제원', '사양 줄은 값 칸에 표준/옵션(또는 ● ○ Std Opt)만 적습니다.'],
      ['인양력_<모델 이름>', '시트 이름 뒤쪽이 모델 이름입니다. 첫 줄 반경, 첫 칸 높이, 유압 한계는 값 뒤에 * 를 붙입니다.'],
      ['세로 표도 됩니다', '모델 | 항목 | 값 | 단위 | 구분 열이 있으면 한 줄에 값 하나로 읽습니다.']]), '작성법');
    XLSX.writeFile(wb, '경쟁사_제원_양식.xlsx');
  }

  /* ---------- AI(선택) ---------- */
  function aiConf() { try { return JSON.parse(localStorage.getItem(AI_KEY) || '{}'); } catch (e) { return {}; } }
  function aiStatus(html) { $('ai-status').innerHTML = html; }
  function runAi() {
    var key = $('ai-key').value.trim(), prov = $('ai-prov').value, f = $('ai-img').files[0], target = $('ai-target').value;
    if (!key) return aiStatus('<div class="warn">API 키를 넣어 주세요. 키 없이도 붙여넣기·PDF·엑셀은 그대로 됩니다.</div>');
    if (!f) return aiStatus('<div class="warn">표 이미지를 골라 주세요.</div>');
    if (!window.confirm('고른 이미지를 외부 AI(' + (prov === 'openai' ? 'OpenAI' : 'Anthropic') + ')로 보냅니다.\n사내 자료라면 반출 규정을 먼저 확인하세요. 보낼까요?')) return;
    aiStatus('<div class="note">AI 가 표를 옮기는 중입니다…</div>');
    var rd = new FileReader();
    rd.onload = function () {
      var url = rd.result, b64 = url.split(',')[1], mt = f.type || 'image/png', prompt = Spec.AI_PROMPTS[target];
      var req = prov === 'openai'
        ? fetch('https://api.openai.com/v1/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
          body: JSON.stringify({ model: 'gpt-4o-mini', temperature: 0, messages: [{ role: 'user', content: [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: url } }] }] }) })
          .then(function (r) { return r.json(); }).then(function (j) { if (j.error) throw new Error(j.error.message); return j.choices[0].message.content; })
        : fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
          body: JSON.stringify({ model: 'claude-haiku-5-5', max_tokens: 2000, messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: mt, data: b64 } }, { type: 'text', text: prompt }] }] }) })
          .then(function (r) { return r.json(); }).then(function (j) { if (j.error) throw new Error(j.error.message); return j.content.map(function (c) { return c.text || ''; }).join(''); });
      req.then(function (text) {
        var draft = '# AI 초안 — 검토 필요 (원본 이미지 ' + f.name + ' 와 한 칸씩 대조하세요)\n' + text.replace(/```[a-z]*\n?/g, '').trim();
        if (target === 'lift') { $('l-text').value = draft; location.hash = 's-lift'; }
        else { $('m-text').value = draft; if (!$('m-name').value) $('m-name').value = f.name.replace(/\.[^.]+$/, ''); location.hash = 's-input'; }
        aiStatus('<div class="ok"><span class="tag t-ai">AI 초안 — 검토 필요</span> ' + (target === 'lift' ? '3번' : '1번') + ' 칸에 넣었습니다. 원본과 대조해 고친 뒤 읽기 버튼을 누르세요.</div>');
      }).catch(function (e) { aiStatus('<div class="warn">AI 요청 실패: ' + esc(e.message) + '</div>'); });
    };
    rd.readAsDataURL(f);
  }

  /* ---------- 단위 환산기 ---------- */
  function convOpts() {
    var d = $('cv-dim').value, us = Object.keys(Spec.DIMS[d].units).filter(function (u) { return Spec.UNIT_NAMES[u]; });
    var o = us.map(function (u) { return '<option value="' + u + '">' + esc(Spec.UNIT_NAMES[u]) + '</option>'; }).join('');
    $('cv-from').innerHTML = o; $('cv-to').innerHTML = o;
    if (us.length > 1) $('cv-to').value = us[1];
    conv();
  }
  function conv() {
    var d = $('cv-dim').value, v = +$('cv-v').value, r = Spec.convert(v, $('cv-from').value, $('cv-to').value, d);
    $('cv-out').textContent = isFinite(r) ? Spec.fmtNum(v, 4).replace(/\.?0+$/, '') + ' ' + Spec.UNIT_NAMES[$('cv-from').value] + ' = ' + Spec.fmtNum(r, 4).replace(/\.?0+$/, '') + ' ' + Spec.UNIT_NAMES[$('cv-to').value] : '숫자를 넣어 주세요';
  }

  /* ---------- 연결 ---------- */
  $('file').addEventListener('change', function (e) { readFiles(e.target.files); e.target.value = ''; });
  var drop = $('drop');
  ['dragover', 'dragenter'].forEach(function (t) { drop.addEventListener(t, function (e) { e.preventDefault(); drop.classList.add('over'); }); });
  ['dragleave', 'drop'].forEach(function (t) { drop.addEventListener(t, function () { drop.classList.remove('over'); }); });
  drop.addEventListener('drop', function (e) { e.preventDefault(); readFiles(e.dataTransfer.files); });
  $('btn-read').addEventListener('click', function () {
    var text = $('m-text').value; if (!text.trim()) { $('in-status').innerHTML = '<div class="warn">카탈로그 글을 붙여 넣어 주세요.</div>'; return; }
    addText($('m-name').value, text, '붙여넣기'); rebuild();
    $('in-status').innerHTML = '<div class="ok">읽었습니다. 아래 모델 카드에서 읽지 못한 줄과 경고를 확인하세요.</div>';
  });
  $('btn-sample').addEventListener('click', function () {
    var s = Spec.sample();
    state.sources = []; state.removed = {}; state.lifts = {};
    s.models.forEach(function (m) { addText(m.name, m.text, '예제(가짜 카탈로그)'); });
    Object.keys(s.lifts).forEach(function (n) { state.lifts[n] = { raw: s.lifts[n], parsed: Spec.parseLift(s.lifts[n]) }; });
    $('m-name').value = s.models[0].name; $('m-text').value = s.models[0].text;
    rebuild();
    $('l-text').value = s.lifts[$('l-model').value] || '';
    $('in-status').innerHTML = '<div class="note">예제 카탈로그 3장을 읽었습니다(A사 한글·SI, B사 영문·영미 단위, C사 PS·kgf·단위 표기 줄). 예제 데이터는 실제 제조사·실제 제원이 아닙니다.</div>';
  });
  $('btn-template').addEventListener('click', template);
  $('models').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    var card = b.closest('.model'), m = state.models[+card.dataset.i];
    if (b.dataset.act === 'del') { state.removed[m.name] = 1; rebuild(); }
    if (b.dataset.act === 'edit') { var s = sourceOf(m); $('m-name').value = s.name; $('m-text').value = s.text; $('m-text').focus(); }
    if (b.dataset.act === 'alias') {
      var j = +b.dataset.j, sel = card.querySelector('select[data-j="' + j + '"]'), u = m.unknown[j];
      if (!sel.value) { sel.focus(); return; }
      (state.aliases[sel.value] = state.aliases[sel.value] || []).push(u.label.replace(/\([^)]*\)/g, '').trim());
      saveAliases(); rebuild();
      $('in-status').innerHTML = '<div class="ok">「' + esc(u.label) + '」 을 「' + esc(Spec.FIELD[sel.value].label) + '」 의 별칭으로 기억했습니다(이 브라우저).</div>';
    }
  });
  $('base').addEventListener('change', function () { state.baseName = state.models[+$('base').value].name; renderCompare(); });
  ['sys', 'thr'].forEach(function (id) { $(id).addEventListener('change', function () { renderCompare(); renderLift(); }); });
  $('cmp').addEventListener('click', function (e) { var td = e.target.closest('td[data-r]'); if (td) showWhy(+td.dataset.r, +td.dataset.c); });
  $('bar-field').addEventListener('change', renderBars);
  $('diff-model').addEventListener('change', function () { state.diffName = state.models[+$('diff-model').value].name; renderDiff(); });
  $('btn-export').addEventListener('click', exportXlsx);
  $('l-model').addEventListener('change', function () { var L = state.lifts[$('l-model').value]; $('l-text').value = L && typeof L.raw === 'string' ? L.raw : ''; });
  $('btn-lift').addEventListener('click', function () {
    var n = $('l-model').value, t = $('l-text').value; if (!n || !t.trim()) return;
    state.lifts[n] = { raw: t, parsed: Spec.parseLift(t) };
    fillLiftSelects(); $('la').value = $('la').value || n; renderLift();
  });
  ['la', 'lb', 'ldir', 'ltol'].forEach(function (id) { $(id).addEventListener('change', renderLift); });
  var ac = aiConf(); if (ac.key) $('ai-key').value = ac.key; if (ac.prov) $('ai-prov').value = ac.prov;
  $('ai-save').addEventListener('click', function () { try { localStorage.setItem(AI_KEY, JSON.stringify({ key: $('ai-key').value.trim(), prov: $('ai-prov').value })); } catch (e) {} aiStatus('<div class="ok">키를 이 브라우저에만 저장했습니다.</div>'); });
  $('ai-forget').addEventListener('click', function () { localStorage.removeItem(AI_KEY); $('ai-key').value = ''; aiStatus('<div class="note">저장된 키를 지웠습니다.</div>'); });
  $('ai-run').addEventListener('click', runAi);
  $('cv-dim').innerHTML = Object.keys(Spec.DIM_LABELS).map(function (d) { return '<option value="' + d + '">' + esc(Spec.DIM_LABELS[d]) + '</option>'; }).join('');
  $('cv-dim').addEventListener('change', convOpts);
  ['cv-v', 'cv-from', 'cv-to'].forEach(function (id) { $(id).addEventListener('input', conv); $(id).addEventListener('change', conv); });
  convOpts();
  window.__app = { state: state };       // 연기 테스트용
})();
