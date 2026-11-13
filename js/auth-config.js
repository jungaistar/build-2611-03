// 로그인 설정 — 이 파일 한 곳만 바꾸면 된다(생성: build-2611-00/tools/kit/apply-kit.mjs, 대문 문구 출처 docs/plan.json).
// 내 Supabase 로 옮길 때: url · anonKey 를 내 프로젝트 값으로, 카카오를 설정하지 않았으면 kakao: false. 안내 = docs/내_깃허브로_옮기기.md
// prefix 는 supabase/auth.sql 의 표 이름 앞부분과 같아야 한다.
window.AUTH_CONFIG = {
  "url": "https://hcmgdztsgjvzcyxyayaj.supabase.co",
  "anonKey": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhjbWdkenRzZ2p2emN5eHlheWFqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE0MzU4ODcsImV4cCI6MjA4NzAxMTg4N30.gznaPzY1l8qDAPsEyYNR9KS7f7VqS3xaw-_2HTSwSZw",
  "prefix": "build261103",
  "kakao": true,
  "idleMinutes": 30,
  "localBypass": true,
  "board": true,
  "site": {
    "title": "경쟁사 제원 비교",
    "summary": "경쟁사 카탈로그(붙여넣기·글자 PDF·엑셀)의 제원을 표준 항목·표준 단위로 맞춰 모델별 비교표·차이 강조·막대 그래프·Standard/Option 표·인양력 격자 비교를 만들고 엑셀로 내보내는 도구입니다.",
    "course": "생성형 AI 업무자동화 전문가과정 · 2차수",
    "features": [
      {
        "name": "카탈로그 읽기",
        "desc": "붙여넣기·글자 PDF·엑셀을 읽어 모델 카드로 만듭니다. 읽지 못한 줄은 버리지 않고 남기며, 표준 항목에 짝지어 별칭으로 기억시킬 수 있습니다."
      },
      {
        "name": "단위 환산",
        "desc": "hp·PS·lb·ton·lbf·kgf·tf·gpm·psi·bar·kgf/cm²·mph·yd³·gal·in·ft·ft-in 을 표준 단위로 바꾸고 환산·계산·단위 가정 꼬리표를 붙입니다."
      },
      {
        "name": "제원 비교표",
        "desc": "기준 모델 대비 차이(%)와 최고값을 표시하고, 칸을 누르면 원문과 환산 과정을 보여 줍니다. SI·영미 단위로 바꿔 볼 수 있습니다."
      },
      {
        "name": "Standard / Option 표",
        "desc": "에어컨·퀵 커플러 같은 사양을 제조사 표기와 상관없이 같은 줄에 모읍니다."
      },
      {
        "name": "그래프",
        "desc": "항목별 모델 막대와 기준 대비 차이(%) 막대를 SVG 로 그립니다."
      },
      {
        "name": "인양력 비교",
        "desc": "높이 × 반경 격자로 정리하고 허용 오차 안의 공통 점만 비교합니다. 보간하지 않습니다."
      }
    ],
    "steps": [
      "카탈로그 넣기",
      "줄 나누기",
      "항목 인식",
      "단위 환산",
      "S/O 구분",
      "비교·강조"
    ],
    "flow": [
      {
        "step": "카탈로그 넣기",
        "desc": "붙여넣기·글자 PDF·엑셀을 브라우저에서 읽음"
      },
      {
        "step": "줄 나누기",
        "desc": "항목 이름과 값을 가르고 PDF 글자를 줄로 재구성"
      },
      {
        "step": "항목 인식",
        "desc": "별칭 표로 표준 항목 19개에 짝짓기, 못 읽은 줄은 남김"
      },
      {
        "step": "단위 환산",
        "desc": "값·머리글·단위 줄 순으로 단위를 정해 표준 단위로"
      },
      {
        "step": "S/O 구분",
        "desc": "표준 값을 대표로, 옵션은 다른 사양으로, 사양 줄은 S/O 표로"
      },
      {
        "step": "비교·강조",
        "desc": "기준 모델 대비 차이(%), 유리·불리, 최고값"
      }
    ],
    "goals": [
      "카탈로그를 붙여 넣거나 올리면 제원을 표준 항목 19개와 표준 단위로 맞춥니다.",
      "환산·계산·단위 가정 값을 문서 값과 구분해 보여 줍니다.",
      "기준 모델 대비 차이를 계산해 강조하고 그래프로 보여 줍니다."
    ],
    "screen": "docs/img/screen.png",
    "plan": "plan.html",
    "home": true,
    "guide": {
      "screens": [],
      "data": [
        {
          "name": "카탈로그 글",
          "fields": "한 줄에 항목 · 값 · 단위 (· 표준/옵션 표시)"
        },
        {
          "name": "엑셀 가로 표",
          "fields": "항목 · (단위) · (구분) · 모델1 · 모델2 …"
        },
        {
          "name": "엑셀 세로 표",
          "fields": "모델 · 항목 · 값 · 단위 · 구분"
        },
        {
          "name": "인양력 표",
          "fields": "방향 줄 · 반경 머리글 · 높이별 값(* 유압 한계)"
        },
        {
          "name": "내보내기",
          "fields": "비교표 · 원문대조 · 표준_옵션 · 미인식_확인 · 인양력 · 인양력비교 · 안내"
        }
      ],
      "rules": [
        "표준 단위는 kW · kg · kN · L/min · MPa · km/h · rpm · m³ · L · mm, 인양력은 kg · mm 입니다.",
        "단위는 값에 붙은 단위 → 항목 이름 괄호(머리글·단위 열) → 위쪽 「단위: …」 줄 순으로 정하고, 없으면 표준 단위로 가정해 경고합니다.",
        "굴삭력 칸의 kg 은 kgf, lb 는 lbf 로 봅니다(차원은 항목이 정합니다).",
        "한 칸에 여러 사양이 있으면 표준(Std) 값이 대표값입니다. 주행 속도는 저/고 중 큰 값입니다.",
        "차이 강조는 기준 대비 |차이| ≥ 문턱(기본 5%)인 칸입니다. 우열이 없는 치수는 「차이」로만 표시합니다.",
        "인양력은 높이·반경이 허용 오차(기본 100 mm) 안인 점끼리만 비교하고 보간하지 않습니다."
      ],
      "limits": [
        "목표 톤급의 경쟁 모델 자동 검색, 제조사 홈페이지 자동 수집은 하지 않습니다 — 카탈로그는 직접 올립니다.",
        "이미지형 인양력 표는 AI 초안만 만들고, 사람이 원본과 대조해 확정합니다.",
        "PDF 읽기는 웹 주소로 열었을 때만 됩니다. 스캔 이미지 PDF 는 AI 나 붙여넣기를 씁니다.",
        "소수점 쉼표 표기(0,18)는 읽지 않습니다."
      ],
      "users": [
        "소형굴착기 패키지 레이아웃 설계 담당자",
        "신기종 개발 기획·제원 검토 담당자"
      ],
      "flow": [
        {
          "step": "카탈로그 넣기",
          "desc": "붙여넣기·글자 PDF·엑셀을 브라우저에서 읽음"
        },
        {
          "step": "줄 나누기",
          "desc": "항목 이름과 값을 가르고 PDF 글자를 줄로 재구성"
        },
        {
          "step": "항목 인식",
          "desc": "별칭 표로 표준 항목 19개에 짝짓기, 못 읽은 줄은 남김"
        },
        {
          "step": "단위 환산",
          "desc": "값·머리글·단위 줄 순으로 단위를 정해 표준 단위로"
        },
        {
          "step": "S/O 구분",
          "desc": "표준 값을 대표로, 옵션은 다른 사양으로, 사양 줄은 S/O 표로"
        },
        {
          "step": "비교·강조",
          "desc": "기준 모델 대비 차이(%), 유리·불리, 최고값"
        },
        {
          "step": "인양력 격자",
          "desc": "높이 × 반경으로 정리해 공통 점끼리 비교"
        },
        {
          "step": "엑셀 보고",
          "desc": "비교표·원문대조·인양력 시트로 내보내기"
        }
      ]
    },
    "landing": {
      "slides": [
        {
          "image": "images/slide-1.jpg"
        },
        {
          "image": "images/slide-2.jpg"
        },
        {
          "image": "images/slide-3.jpg"
        }
      ],
      "heroMode": "slide"
    }
  }
};
