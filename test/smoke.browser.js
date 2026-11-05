/* 브라우저에 실제로 띄워 화면이 그려지는지 본다 — node test/smoke.browser.js
 * 규칙 테스트가 다 통과해도 app.js 오타 하나면 빈 화면이 된다. playwright 가 없으면 건너뛴다. */
'use strict';
var http = require('http'), fs = require('fs'), path = require('path'), os = require('os');
var chromium;
try { chromium = require('playwright').chromium; }
catch (e) { console.log('playwright 가 없어 화면 연기 테스트를 건너뜁니다.'); process.exit(0); }
var ROOT = path.join(__dirname, '..');
var MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.bcmap': 'application/octet-stream' };
var srv = http.createServer(function (q, s) {
  var p = path.join(ROOT, decodeURIComponent(q.url.split('?')[0]).replace(/\/$/, '/index.html'));
  fs.readFile(p, function (e, b) { if (e) { s.writeHead(404); return s.end(); } s.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' }); s.end(b); });
});

// 글자가 있는 PDF 한 장을 직접 만든다(가짜 카탈로그). 이름과 값을 다른 x 에 따로 찍어 칸 사이가 벌어지게 한다.
function makePdf(lines) {
  var pe = function (s) { return s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)'); };
  var body = 'BT /F1 11 Tf\n';
  lines.forEach(function (l, i) {
    var y = 760 - i * 18;
    body += '1 0 0 1 50 ' + y + ' Tm (' + pe(l[0]) + ') Tj\n';
    if (l[1]) body += '1 0 0 1 280 ' + y + ' Tm (' + pe(l[1]) + ') Tj\n';
  });
  body += 'ET';
  var objs = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    '<< /Length ' + Buffer.byteLength(body) + ' >>\nstream\n' + body + '\nendstream', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  var out = '%PDF-1.4\n', offs = [];
  objs.forEach(function (o, i) { offs.push(Buffer.byteLength(out)); out += (i + 1) + ' 0 obj\n' + o + '\nendobj\n'; });
  var x = Buffer.byteLength(out);
  out += 'xref\n0 ' + (objs.length + 1) + '\n0000000000 65535 f \n' + offs.map(function (o) { return String(o).padStart(10, '0') + ' 00000 n \n'; }).join('');
  out += 'trailer\n<< /Size ' + (objs.length + 1) + ' /Root 1 0 R >>\nstartxref\n' + x + '\n%%EOF\n';
  return Buffer.from(out, 'latin1');
}

var passed = 0, failed = 0;
function ok(c, label, d) { if (c) passed++; else { failed++; console.log('  X ' + label + (d ? '  ' + d : '')); } }
srv.listen(0, async function () {
  var base = 'http://127.0.0.1:' + srv.address().port + '/';
  var br = await chromium.launch(); var pg = await br.newPage({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  var errs = []; pg.on('pageerror', function (e) { errs.push(e.message); });
  try {
    await pg.goto(base);
    ok(await pg.isHidden('#s-compare'), '처음엔 비교표가 숨어 있다');
    await pg.click('#btn-sample');
    await pg.waitForSelector('#cmp td.v', { timeout: 5000 });
    ok(await pg.isVisible('#s-compare'), '비교표 영역이 열린다');
    ok(await pg.$$eval('.model', function (t) { return t.length; }) === 3, '모델 카드 3장');
    var rows = await pg.$$eval('#cmp tbody tr:not(.grp)', function (t) { return t.length; });
    ok(rows >= 19, '비교 항목 줄', rows);
    ok(await pg.$$eval('#cmp .t-conv', function (t) { return t.length; }) > 10, '환산 꼬리표가 붙는다');
    ok(await pg.$$eval('#cmp .t-calc', function (t) { return t.length; }) >= 3, '계산 꼬리표(출력 대 중량비·2 × 60)');
    ok(await pg.$$eval('#cmp td.dis, #cmp td.adv, #cmp td.diff', function (t) { return t.length; }) > 0, '차이 강조 칸');
    await pg.click('#cmp td.v.dis');
    ok(/원문 값/.test(await pg.textContent('#cell-why')), '칸을 누르면 원문과 환산 과정이 나온다');
    ok(/표준/.test(await pg.textContent('#feat')) && /옵션/.test(await pg.textContent('#feat')), 'Standard / Option 표');
    ok(await pg.$$eval('#bars rect', function (t) { return t.length; }) === 3, '막대 3개');
    ok(await pg.$$eval('#diffbars rect', function (t) { return t.length; }) >= 15, '기준 대비 차이 막대');
    await pg.selectOption('#sys', 'imp');
    ok(/hp/.test(await pg.textContent('#cmp')) && /'/.test(await pg.textContent('#cmp')), '영미 단위로 보기(hp · ft-in)');
    await pg.selectOption('#sys', 'si');
    // 인양력
    ok(await pg.$$eval('#lift-out table', function (t) { return t.length; }) === 3, '인양력 A · B · 비교 표');
    ok(/공통 점/.test(await pg.textContent('#lift-out')), '공통 점 수');
    ok(await pg.$$eval('#lift-out td.diff', function (t) { return t.length; }) === 12, 'A사·B사 정면 공통 점 12개');
    await pg.selectOption('#lb', 'C사 CX-5.5');
    ok(await pg.$$eval('#lift-out td.diff', function (t) { return t.length; }) === 4, 'A사·C사 는 공통 점 4개만');
    // 별칭 기억 — C사 「작업등」을 아무 항목에나 짝지어 보면 읽지 못한 줄이 줄어든다
    var unk0 = await pg.$$eval('.model .unk', function (t) { return t.length; });
    await pg.selectOption('.model .unk select', 'shoeWidth');
    await pg.click('.model .unk button');
    var unk1 = await pg.$$eval('.model .unk', function (t) { return t.length; });
    ok(unk0 === 1 && unk1 === 0, '별칭을 기억하면 다시 읽는다', unk0 + '→' + unk1);
    await pg.evaluate(function () { localStorage.clear(); });
    // 엑셀 내보내기
    var dl = pg.waitForEvent('download', { timeout: 5000 });
    await pg.click('#btn-export');
    var d = await dl;
    ok(/\.xlsx$/.test(d.suggestedFilename()), '엑셀 파일이 내려받아진다', d.suggestedFilename());
    // PDF 올리기 — pdf.js 가 동봉 파일로 도는지
    var pdfPath = path.join(os.tmpdir(), 'b2611-03-smoke-catalog.pdf');
    fs.writeFileSync(pdfPath, makePdf([['D사 DX-60 Specifications', ''], ['Operating weight', '13,200 lb'], ['Net engine power', '52 hp'],
      ['Bucket breakout force', '10,100 lbf'], ['Overall length', "19' 2\""], ['Swing speed', '9.6 rpm']]));
    await pg.setInputFiles('#file', pdfPath);
    await pg.waitForFunction(function () { return document.querySelectorAll('.model').length === 4; }, null, { timeout: 8000 });
    var card = await pg.textContent('.model:last-child');
    ok(/b2611-03-smoke-catalog/.test(card) && /5 \/ 19/.test(card), 'PDF 에서 표준 항목 5개를 읽는다', card.slice(0, 120));
    fs.unlinkSync(pdfPath);
    // 좁은 화면 가로 넘침
    await pg.setViewportSize({ width: 360, height: 800 });
    var over = await pg.evaluate(function () {
      var W = document.documentElement.clientWidth, bad = [];
      document.querySelectorAll('body *').forEach(function (el) {
        var r = el.getBoundingClientRect(); if (!r.width || r.right <= W + 1) return;
        for (var p = el.parentElement; p; p = p.parentElement) { var o = getComputedStyle(p).overflowX; if (o === 'auto' || o === 'scroll' || o === 'hidden') return; }
        bad.push(el.tagName + '.' + el.className);
      });
      return bad.slice(0, 5);
    });
    ok(!over.length, '360px 에서 가로 넘침 없음', over.join(', '));
    await pg.goto(base + 'guide.html');
    ok(/별칭/.test(await pg.textContent('main')), '사용법 페이지');
  } catch (e) { failed++; console.log('  X 예외: ' + e.message); }
  ok(!errs.length, '페이지 오류 없음', errs.join(' | '));
  await br.close(); srv.close();
  console.log('\n화면 통과 ' + passed + ' · 실패 ' + failed);
  process.exit(failed ? 1 : 0);
});
