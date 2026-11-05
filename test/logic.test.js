/* 판정 규칙 고정 — node test/logic.test.js
 * 화면이 아니라 숫자가 틀리면 안 되는 도구다. 단위 환산·항목 인식·S/O 구분·차이·인양력 격자를
 * 손으로 계산한 값과 대조한다. */
'use strict';
var S = require('../js/spec.js');
var passed = 0, failed = 0;
function ok(c, label, detail) { if (c) passed++; else { failed++; console.log('  X ' + label + (detail ? '\n      ' + detail : '')); } }
function eq(g, w, label) { ok(JSON.stringify(g) === JSON.stringify(w), label, '기대: ' + JSON.stringify(w) + '  실제: ' + JSON.stringify(g)); }
function near(g, w, tol, label) { ok(Math.abs(g - w) <= tol, label, '기대: ' + w + ' ± ' + tol + '  실제: ' + g); }
function val(text, key) { var f = S.FIELD[key]; var p = S.parseValue(text, f); return p ? p.value : null; }

// ---------- 단위 환산 ----------
near(S.convert(100, 'hp', 'kw', 'power'), 74.57, 0.01, '100 hp = 74.57 kW');
near(S.convert(100, 'ps', 'kw', 'power'), 73.55, 0.01, '100 PS = 73.55 kW');
near(S.convert(1000, 'kgf', 'kn', 'force'), 9.807, 0.001, '1,000 kgf = 9.807 kN');
near(S.convert(1, 'tf', 'kn', 'force'), 9.807, 0.001, '1 tf = 9.807 kN');
near(S.convert(1000, 'lbf', 'kn', 'force'), 4.448, 0.001, '1,000 lbf = 4.448 kN');
near(S.convert(1000, 'lb', 'kg', 'mass'), 453.6, 0.1, '1,000 lb = 453.6 kg');
near(S.convert(10, 'gpm', 'l/min', 'flow'), 37.85, 0.01, '10 gpm = 37.85 L/min');
near(S.convert(250, 'kgf/cm2', 'mpa', 'pressure'), 24.52, 0.01, '250 kgf/cm² = 24.52 MPa');
near(S.convert(1, 'ft', 'mm', 'length'), 304.8, 1e-9, '1 ft = 304.8 mm');
near(S.convert(1, 'yd3', 'm3', 'volume'), 0.7646, 0.0001, '1 yd³ = 0.7646 m³');
ok(isNaN(S.convert(1, 'kg', 'mm', 'length')), '차원이 다른 단위는 환산하지 않는다');

// ---------- 값 읽기 ----------
eq(val('5,450 kg', 'operatingWeight'), 5450, '천 단위 쉼표');
eq(val('5.6 ton', 'operatingWeight'), 5600, 'ton → kg');
near(val('12,100 lb', 'operatingWeight'), 5488.5, 0.1, 'lb → kg');
near(val('4,300 kgf', 'bucketForce'), 42.17, 0.01, 'kgf → kN');
near(val('4,300 kg', 'bucketForce'), 42.17, 0.01, '굴삭력 칸의 kg 은 kgf 로 본다');
near(val("18' 5\"", 'overallLength'), 5613.4, 0.1, "ft-in 18' 5\" → mm");
near(val('20 ft 3 in', 'maxReach'), 6172.2, 0.1, 'ft·in 낱말');
eq(val('1.05 m', 'tailSwing'), 1050, 'm → mm');
eq(val('2 x 60 L/min', 'hydraulicFlow'), 120, '펌프 2 × 60 = 120');
eq(val('2.6/4.5 km/h', 'travelSpeed'), 4.5, '주행 저/고 중 고속');
near(val('36.2 kW (48.5 hp) / 2,200 rpm', 'enginePower'), 36.2, 1e-9, '출력 줄의 rpm 은 무시');
var pp = S.parseValue('36.2 kW (60 hp)', S.FIELD.enginePower);
ok(pp.notes.some(function (n) { return /어긋남/.test(n); }), '괄호 안 다른 단위 값이 어긋나면 알린다', pp.notes.join(' | '));
var pa = S.parseValue('5,620', S.FIELD.overallLength);
ok(pa.assumed && pa.value === 5620, '단위가 없으면 표준 단위로 보고 「가정」 표시');
var ph = S.parseValue('118', S.FIELD.hydraulicFlow, { headerUnit: 'gpm' });
near(ph.value, 446.7, 0.1, '머리글 단위(gpm)를 따른다');
ok(!ph.assumed, '머리글 단위를 쓰면 가정이 아니다');
eq(val('-1.0 m', 'maxDigDepth'), -1000, '음수 부호');
eq(val('2.6-4.5 km/h', 'travelSpeed'), 4.5, '숫자 사이 - 는 범위(부호 아님)');

// ---------- Standard / Option ----------
var so = S.parseValue('0.18 m³ (표준) / 0.20 m³ (옵션)', S.FIELD.bucketCapacity);
eq([so.value, so.so, so.variants.length], [0.18, 'S', 2], '표준 값이 대표값, 옵션은 다른 사양으로');
var so2 = S.parseValue('0.31 yd3 (Opt.) ; 0.25 yd3 (Std.)', S.FIELD.bucketCapacity);
near(so2.value, 0.1911, 0.0001, '옵션이 앞에 와도 Std 를 대표로');
eq([S.markerOnly('●'), S.markerOnly('Opt.'), S.markerOnly('선택'), S.markerOnly('-'), S.markerOnly('5 kN')], ['S', 'O', 'O', '-', null], '표시 기호 읽기');
eq(S.soOf('Standard bucket'), 'S', 'Standard 낱말');

// ---------- 항목 이름(별칭) ----------
eq(S.matchField('Bucket breakout force (ISO 6015)').key, 'bucketForce', '괄호 안 규격 번호는 이름에서 뺀다');
eq(S.matchField('Max. reach at ground level').key, 'maxReach', '영문 별칭');
eq(S.matchField('주행속도 고속').key, 'travelSpeed', '별칭 + 짧은 덧말');
eq(S.matchField('작업중량').key, 'operatingWeight', '한글 별칭');
eq(S.matchField('Max digging height').key, 'maxDigHeight', '깊이와 높이를 섞지 않는다');
eq(S.matchField('작업등'), null, '모르는 이름은 짝짓지 않는다');
eq(S.matchField('붐 실린더 행정', { maxReach: ['붐 실린더 행정'] }).key, 'maxReach', '사용자가 추가한 별칭');
eq(S.featureKey('Air conditioner'), S.featureKey('캐빈 에어컨'), '장치 이름도 한 줄로 모인다');

// ---------- 줄 나누기 ----------
eq(S.splitLabel('Bucket breakout force (ISO 6015) 40 kN'), { label: 'Bucket breakout force (ISO 6015)', value: '40 kN' }, '괄호 안 숫자에서 자르지 않는다');
eq(S.splitLabel('운전중량: 5,450 kg'), { label: '운전중량', value: '5,450 kg' }, '콜론 구분');

// ---------- 예제 세 장 ----------
var smp = S.sample();
var models = smp.models.map(function (m) { return S.parseText(m.text, { name: m.name }); });
models.forEach(function (m) {
  eq(Object.keys(m.items).length, S.FIELDS.length, m.name + ': 표준 항목 ' + S.FIELDS.length + '개를 모두 찾는다');
  eq(m.issues, [], m.name + ': 경고 없음');
});
eq(models[2].unknown.map(function (u) { return u.label; }), ['작업등'], '읽지 못한 줄은 버리지 않고 남긴다');
ok(models[1].items.operatingWeight.notes.some(function (n) { return /다시 나옴/.test(n); }), '같은 항목 두 번(캐노피·캐빈)은 메모로');
eq(models[2].items.overallLength.notes[0], '단위는 위쪽 「단위: mm」 표기', '「단위: mm」 줄이 아래 값에 적용된다');
ok(models[1].items.enginePower.converted && !models[0].items.enginePower.converted, '환산 여부 표시');
ok(models[0].items.hydraulicFlow.computed && !models[0].items.hydraulicFlow.converted, '곱으로 만든 값은 환산이 아니라 계산');

// 범위를 벗어나면 단위 실수로 알린다(kgf 를 kN 으로 적은 경우)
var wrong = S.parseText('버킷 굴삭력  4,300 kN', { name: 'X' });
ok(wrong.issues.some(function (s) { return /보통 범위/.test(s); }), '범위 밖 값 경고');

// ---------- 엑셀 표 ----------
var wide = S.parseTable([['항목', '단위', 'A사 X1', 'B사 Y2'], ['운전중량', 'kg', '5,500', '5,700'], ['엔진 출력', 'hp', '48', '50'], ['퀵 커플러', '', '●', '○']]);
eq(wide.models.map(function (m) { return m.name; }), ['A사 X1', 'B사 Y2'], '가로 표: 열이 모델');
near(wide.models[1].items.enginePower.value, 37.28, 0.01, '단위 열(hp)을 따른다');
eq(wide.models[1].features[0].so, 'O', '가로 표의 S/O 기호');
var long = S.parseTable([['모델', '항목', '값', '단위', '구분'], ['A사 X1', '버킷 용량', '0.2', 'm3', '표준'], ['A사 X1', '버킷 용량', '0.25', 'm3', '옵션'], ['A사 X1', '에어컨', '', '', '옵션']]);
eq([long.models.length, long.models[0].items.bucketCapacity.value, long.models[0].items.bucketCapacity.so], [1, 0.2, 'S'], '세로 표 · 구분 열');
eq(long.models[0].features[0], { name: '에어컨', key: '에어컨', so: 'O' }, '세로 표의 값 없는 사양 줄');

// ---------- 비교 ----------
var cmp = S.compareModels(models, 0, { threshold: 5 });
eq(cmp.rows.length, S.FIELDS.length + S.DERIVED.length, '비교표 줄 수 = 표준 항목 + 계산 항목');
var tail = cmp.rows.filter(function (r) { return r.key === 'tailSwing'; })[0];
eq([tail.cells[1].flag, tail.cells[2].flag], [undefined, 'dis'], '후방 선회반경 980 → 1,050(+7.1%)은 작을수록 유리라 열세');
near(tail.cells[2].pct, 7.1, 0.05, '차이(%)');
ok(tail.cells[0].best, '가장 작은 후방 선회반경이 최고값');
var pw = cmp.rows.filter(function (r) { return r.key === 'powerToWeight'; })[0];
eq(pw.origin, '계산', '출력 대 중량비는 계산 항목');
near(pw.cells[0].value, 36.2 / 5.45, 0.01, '출력 대 중량비 = kW / t');
var dims = cmp.rows.filter(function (r) { return r.key === 'overallWidth'; })[0];
eq(dims.cells[2].flag, undefined, '차이가 기준(5%) 미만이면 강조하지 않는다');
var cmp2 = S.compareModels(models, 0, { threshold: 1 });
eq(cmp2.rows.filter(function (r) { return r.key === 'overallWidth'; })[0].cells[2].flag, 'diff', '우열 없는 치수는 「차이」로만 표시');
var feat = cmp.features.filter(function (f) { return f.key === '에어컨'; })[0];
eq(feat.cells, ['S', 'O', 'S'], 'S/O 표: 에어컨 A 표준 · B 옵션 · C 표준');

// ---------- 표시 ----------
eq(S.display(5613.4, 'length', 'imp'), { text: "18' 5\"", unit: 'ft-in' }, '영미 길이는 ft-in');
eq(S.display(36.2, 'power', 'imp').text, '48.5', 'kW → hp 표시');
eq(S.display(5450, 'mass', 'si'), { text: '5,450', unit: 'kg' }, 'SI 표시');

// ---------- PDF 줄 ----------
var items = [
  { str: 'Operating weight', transform: [1, 0, 0, 1, 50, 700], width: 80 },
  { str: '12,100 lb', transform: [1, 0, 0, 1, 250, 700.5], width: 40 },
  { str: 'Swing speed', transform: [1, 0, 0, 1, 50, 680], width: 60 },
  { str: '9.2 rpm', transform: [1, 0, 0, 1, 250, 680], width: 30 }
];
eq(S.pdfLines(items), ['Operating weight  12,100 lb', 'Swing speed  9.2 rpm'], 'PDF 글자 조각을 위→아래 줄로, 넓은 간격은 두 칸');

// ---------- 인양력 ----------
var LA = S.parseLift(smp.lifts['A사 AX-55']), LB = S.parseLift(smp.lifts['B사 B57']), LC = S.parseLift(smp.lifts['C사 CX-5.5']);
eq(LA.grids.map(function (g) { return g.direction; }), ['front', 'side'], '방향 두 개(정면·측면)');
eq([LA.grids[0].radii, LA.grids[0].heights], [[3000, 4000, 5000], [3000, 2000, 0, -1000]], '반경·높이 mm');
eq(LA.grids[0].cells[0][0], { value: 1180, limited: true }, '별표 = 유압 한계');
eq(LB.unit, 'lb', 'B사 인양력 단위 lb');
eq(LB.grids[0].cells[0][0].value, 1161, '2,560 lb → 1,161 kg');
eq(LB.grids[0].heights, [2987, 2012, 0, -1006], 'ft 높이 → mm, Ground = 0');
ok(LC.issues.some(function (s) { return /최대 반경/.test(s); }), '「최대」 칸은 빼고 알린다');
eq(LC.grids[0].radii, [3000, 4000, 4500], '최대 칸을 뺀 반경');
var lc = S.compareLift(S.gridOf(LA, 'front'), S.gridOf(LB, 'front'), 100);
eq([lc.common, lc.onlyA, lc.onlyB, lc.maxOffset], [12, 0, 0, 13], '9.8 ft ≈ 3.0 m 처럼 100 mm 안이면 같은 점');
eq(lc.cells[0][0].pct, -1.6, '점별 차이(%)');
var lc2 = S.compareLift(S.gridOf(LA, 'front'), S.gridOf(LC, 'front'), 100);
eq([lc2.radii, lc2.heights, lc2.common], [[3000, 4000], [3000, 0], 4], '공통 점만 비교 — 보간으로 만들지 않는다');
var lc3 = S.compareLift(S.gridOf(LA, 'front'), S.gridOf(LB, 'front'), 10);
eq([lc3.radii, lc3.heights, lc3.common], [[4000, 5000], [0, -1000], 4], '허용 오차 10 mm 면 13 mm 어긋난 점은 짝이 안 된다');
eq(S.parseLift('정면\n높이 \\ 반경  3 m  4 m\n2 m  1,000  800').issues, ['인양력 단위 표기를 찾지 못해 kg 으로 보았습니다'], '단위 없으면 kg 로 보고 알린다');
eq(S.parseLift('# AI 초안 — 검토 필요\n단위: kg\n정면\n높이 \\ 반경  3 m\n2 m  900').ai, true, 'AI 초안 표시가 이어진다');

// ---------- 엑셀 내보내기 표 ----------
var lifts = { 'A사 AX-55': LA, 'B사 B57': LB };
var ex = S.exportTables(models, cmp, lifts, 'si');
eq(Object.keys(ex), ['비교표', '원문대조', '표준_옵션', '미인식_확인', '인양력'], '시트 다섯 장');
eq(ex['비교표'].length, cmp.rows.length + 1, '비교표 = 머리글 + 줄');
eq(ex['원문대조'][1].slice(0, 4), ['A사 AX-55', '운전중량', '운전중량', '5,450 kg (고무 슈) / 5,560 kg (철 슈)'], '원문을 그대로 남긴다');
ok(ex['미인식_확인'].some(function (r) { return r[1] === '작업등'; }), '읽지 못한 줄이 엑셀에도 남는다');

console.log('\n통과 ' + passed + ' · 실패 ' + failed);
process.exit(failed ? 1 : 0);
