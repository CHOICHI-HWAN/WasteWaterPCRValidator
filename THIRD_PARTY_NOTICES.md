# 서드파티 고지 (Third-Party Notices)

이 프로젝트(하수 PCR 검증기)는 **GPL v3**(`LICENSE`)으로 배포됩니다.
아래 구성요소는 각자의 라이선스를 따르며, 모두 GPL-3.0과 호환됩니다.

| 구성요소 | 버전 | 용도 | 라이선스 | 제공 방식 |
|---|---|---|---|---|
| [JSZip](https://stuk.github.io/jszip/) | 3.10.1 | HWPX(zip)·엑셀 읽기/쓰기 | MIT 또는 GPL-3.0 (이중 라이선스, 본 프로젝트는 MIT로 사용). 내부 라이브러리 pako: MIT | **사이트에 포함**(`public/vendor/jszip/`) |
| [Jspreadsheet CE](https://github.com/jspreadsheet/ce) | 5.0.4 | 표준곡선 Ct 입력 스프레드시트 | MIT (Copyright (c) 2024 Jspreadsheet Ltd) | **사이트에 포함**(`public/vendor/jspreadsheet/`, 외부 CDN 호출 없음) |
| [jsuites](https://github.com/jsuites/jsuites) | 5.13.5 | Jspreadsheet CE 의존 라이브러리(UI 컴포넌트) | MIT (Copyright (c) Jspreadsheet) | **사이트에 포함**(`public/vendor/jspreadsheet/`) |
| [html2canvas](https://html2canvas.hertzen.com/) | 1.4.1 | 미리보기를 이미지로 캡처(PDF·PNG 다운로드용, 필요할 때만 로드) | MIT | **사이트에 포함**(`public/vendor/html2canvas/`) |
| [jsPDF](https://github.com/parallax/jsPDF) | 2.5.1 | PDF 파일 생성(PDF 다운로드용, 필요할 때만 로드) | MIT | **사이트에 포함**(`public/vendor/jspdf/`) |
| [Firebase JS SDK](https://github.com/firebase/firebase-js-sdk) (`firebase-app`, `firebase-analytics`) | 10.14.1 | 앱 초기화, 접속 통계 (웹 사이트에서만 사용, exe·로컬 실행에서는 사용 안 함) | Apache License 2.0 | gstatic CDN |
| [Go](https://go.dev/) 런타임·표준 라이브러리 | 1.27.3 | Windows 실행 파일(exe)의 실행기 | BSD-3-Clause (Copyright 2009 The Go Authors) — 전문: `desktop/GO_LICENSE.txt` | exe에만 포함 |
| [Firebase Hosting](https://firebase.google.com/) | — | 정적 사이트 호스팅 | Google 서비스 약관 | 서비스 |
| Google Analytics (Firebase) | — | 접속 통계 | Google 서비스 약관 | 서비스 |

## 참고
- Jspreadsheet CE와 jsuites의 라이선스 전문은 `public/vendor/jspreadsheet/LICENSE-*.txt`에 있습니다. (Jspreadsheet CE가 선택적으로 쓰는 수식 엔진 `@jspreadsheet/formula`는 라이선스 표기가 없어 포함하지 않았습니다. 따라서 셀에 `=수식`을 입력해도 계산되지 않고, 값만 입력해 사용합니다.)
- 글꼴은 별도 파일을 포함하지 않고 사용자 시스템 글꼴을 사용합니다.
- HWPX 파일 형식의 명칭과 서식 구조는 (주)한글과컴퓨터의 개방형 문서 표준(KS X 6101 / OWPML)을 따릅니다. 본 프로젝트는 한글과컴퓨터와 무관합니다.
- 표준서식(`template.hwpx`)은 제공받은 숙련도 평가 결과서 서식을 바탕으로, 입력 칸을 비우고 개인정보·이미지를 제거해 만들었습니다. 서식의 원 저작권은 해당 서식 제공 기관에 있습니다.
- PRNT 플라크 세기 탭의 검출 정확도를 가늠해 보려고, **VACVPlaque** 공개 데이터셋(백시니아 바이러스, 6웰, 크리스탈 바이올렛, 폰 사진 + 사람이 표시한 웰·플라크 마스크; CC BY 4.0; Hornung et al., DOI: 10.14278/rodare.4439, https://rodare.hzdr.de/record/4439)의 test 세트를 **개발 중 평가용으로만** 내려받아 썼습니다. 이 데이터는 사이트·저장소에 포함되지 않고 로컬 임시 폴더에서만 썼습니다.
