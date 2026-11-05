# build-2611-03 · 경쟁사 제원 비교

생성형 AI 업무자동화 전문가과정 **2차수** 수강생 프로젝트 03 — 기획 조민규.

**바로 쓰기: https://build-2611-03.jobability.co.kr/**

경쟁사 카탈로그(붙여넣기 · 글자 PDF · 엑셀)의 제원을 표준 항목 · 표준 단위로 맞춰
모델별 비교표 · 차이 강조 · 막대 그래프 · Standard/Option 표 · 인양력(높이 × 반경) 격자 비교를 만들고 엑셀로 내보냅니다.
hp·PS·lb·lbf·kgf·tf·gpm·psi·ft-in 같은 단위는 자동 환산하고, 환산·계산·단위 가정 값은 표시를 달리합니다.
이미지로 된 표는 AI(선택, 본인 API 키)로 초안을 만든 뒤 사람이 대조합니다.
파일은 브라우저 안에서만 처리하며 서버로 올라가지 않습니다.

| 파일 | 역할 |
|---|---|
| `js/spec.js` | 엔진(항목 별칭·단위 환산·S/O·비교·인양력 격자) — 판정은 전부 여기 |
| `js/app.js` | 화면 |
| `lib/` | SheetJS · pdf.js(+cmaps) 동봉 |
| `test/logic.test.js` | 규칙 테스트 `node test/logic.test.js` |
| `test/smoke.browser.js` | 화면 연기 테스트(playwright) |
| `CLAUDE.md` | 작업 지시서 + 기획서 원문 |

예제 데이터(A사 · B사 · C사)는 실제 제조사 · 실제 제원이 아닙니다.

## 기획서 · 버전

- 사이트 「기획서」 페이지: https://build-2611-03.jobability.co.kr/plan.html — 워드 판 내려받기
- 워드 판: `docs/기획서/build-2611-03_조민규_경쟁사제원비교_기획서_v<버전>.docx` (버전마다 남김)
- 원본: `docs/plan.json` → 생성기 `build-2611-00/tools/plandoc/make_plan.py` 로 워드·그림·plan.html·CHANGELOG.md 를 다시 만든다
- 버전을 올릴 때: `plan.json` 의 `version` 을 바꾸고 `versions` 맨 앞에 바뀐 점을 적은 뒤 생성기를 다시 돌린다
