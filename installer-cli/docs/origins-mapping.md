# Origins 매핑 설계 (환경 분리 · 엔터프라이즈 도메인)

룰/스킬 본문과 MCP 설정에 박힌 weegloo URL들을 **origin 치환 테이블(origins 매핑)** 로
환경/고객별 도메인에 맞게 바꿔 설치·업데이트하는 설계. 두 용도:

- **환경 분리**: 스테이징 등 비프로덕션 스택을 같은 인스톨러로 사용.
- **엔터프라이즈 납품**: 고객 전용 스택(자체 도메인)으로 서비스가 배포되는 경우.

> 줄 번호·수치는 작성 시점(2026-07-23) 기준. 코드 변경 시 함께 갱신.
> 선행 문서: `install-update-separation.md` (per-agent 추적 · `--update` — 이 설계의 기반).

---

## 1. 배경 — 이미 있는 레버와 빠진 조각

| 레버 | 메커니즘 | 상태 |
|---|---|---|
| 매니페스트 소스 레포 | `WEEGLOO_REPO` env (`github.js:11`) | ✅ |
| 버전 체크 엔드포인트 | `WEEGLOO_VERSION_URL` env (인스톨러용) | ✅ |
| MCP 서버 URL | 매니페스트 `mcp.weeglooUrl` / `mcp.uploadApiUrl` (브랜치별 상이 가능) | ✅ |
| 콘텐츠 브랜치 | `--branch` + per-agent `ref` + `?branch=` 체크 | ✅ |
| 룰 텍스트 치환 인프라 | `applySelfUpdateTemplate` (placeholder 치환, 현재 weegloo-version 1개 룰) | ✅ |
| **룰/스킬 본문의 URL** | **하드코딩 (18개 파일, ~70곳)** | ❌ 이 설계가 채움 |

## 2. 핵심 결정

| 결정 | 내용 | 왜 (기각한 대안 포함) |
|---|---|---|
| 치환 방식 | **origin 문자열 치환** (설치/업데이트 시 콘텐츠에 적용) | **placeholder 전면화 기각** — 18개 파일 ~70곳을 `{{…}}`로 뜯으면 소스 가독성 훼손 + 향후 모든 스킬 작성 규칙이 바뀜. origin 치환은 소스 무변경, 신규 스킬 자동 커버, 오답 예시(`cda-weegloo.com`)는 문자열이 달라 자연히 안전 |
| 적용 위치 | **인스톨러 측** (install + `--update` 공용 함수) | **콘텐츠 측 엔터프라이즈 브랜치(CI 생성) 기각** — 릴리스마다 N개 브랜치 재생성 운영비 + 백엔드가 브랜치를 알아야 함. 단, 완전 격리 납품 모델에서는 이 방식(origins 파일을 CI에서 적용해 브랜치 생성)을 **이 구현 위에** 얹을 수 있음 — 상호 배타가 아님 |
| 매핑 단위 | 키는 **서비스명 9개**(cma/cda/acma/acda/upload/script/auth/console/ai — 전체 origin 키도 정규화 수용), 값은 대상 origin — 치환은 **호스트 문자열 + 문자 경계 검사** | 경로 단위 매핑은 과설계. **호스트 단위 치환의 근거(실측)**: 본문에 scheme 없는 bare 호스트 언급이 52곳(auth 29·cma 17·cda 4·upload 2) — origin 단위로만 치환하면 산문 언급이 프로덕션 호스트로 남아 안내가 뒤섞임. ⚠️ 단 호스트들은 상호 비중첩이 **아님**(`acma`⊃`cma`, `acda`⊃`cda` — 구현 중 테스트로 발견) → 단순 replaceAll이면 cma 매핑이 acma를 오염. **앞뒤가 호스트 문자([A-Za-z0-9-])가 아닐 때만 매칭**하는 경계 정규식으로 치환(순서 무관·오답 예시 `cda-weegloo.com`은 dash 경계라 불변) |
| 기본값 | 매핑 없음 = **현행과 바이트 동일** | breaking 없음이 최우선 |
| 버전 체크 | **매핑 대상** (`ai.weegloo.com` 통째로) | 초안은 "공용 유지"였으나 사용자 결정으로 전환 — 고객 스택이 `/v1/version?branch=`를 제공. `/mcp`(MCP 서버)와 같은 origin이라 별도 `mcp` 키 없이 origin 매핑 하나로 둘 다 커버(단순화) |
| 약관 게이트 | **origins 매핑이 하나라도 있으면 `weegloo-terms-consent` 룰 자동 제외** | origins 사용 = 사실상 B2B 납품/스테이징뿐(사용자 판단) — weegloo 운영 스택의 약관 게이트가 성립하지 않는 환경. **초안(cma 키 조건부 제외)은 단순화를 위해 기각** — 조건부가 설명 비용만 늘리고, cda-only 스테이징에서 게이트를 잃는 비용은 실질 0(내부 사용자). 링크(`weegloo.com/terms`)는 이 룰에만 존재(3곳)해 룰 제외와 함께 자연 소멸 |
| docs | **공용 고정** (매핑 제외) | 고객이 docs 미러를 둘 가능성 낮음. 폐쇄망 요구가 실제로 오면 그때 매핑 키 추가(순수 추가) |
| 콘텐츠 소스 | **공용 레포 단일** — 룰/스킬의 사설 레포(포크) 납품은 **비지원** | 엔터프라이즈도 콘텐츠는 공용, 도메인만 origins 로 교체하는 모델. 덕분에 update 커맨드가 환경 무관하게 최소형으로 유지됨(repo 를 기록에 영속할 필요 없음). `WEEGLOO_REPO` env 는 개발/테스트용 오버라이드일 뿐 납품 경로 아님 |
| 플래그 네이밍 | **`--origins`** (env `WEEGLOO_ORIGINS`, 기록 키 `origins`) | 초안 `--hosts`는 기존 `--host`(Xcode GUI 호스트)와 한 글자 차이라 오타/혼동 위험 — 사용자 지적으로 리네임. 후보: `--domains`(직관적), `--origins`(기술적으로 정확 — 키가 origin), `--endpoints`(경로 포함 연상이라 부적합) 중 **origins 채택**(사용자 결정) |
| 브라우저 SDK | **다운로드 경로 공용 고정** (`weegloo-media.com/static/libs/service-login/…`) | 스킬 내 `weegloo-media.com` 4곳 전부 이 경로 → 도메인 통째로 매핑 테이블에서 제외. ⚠️ SDK가 auth base URL을 설정으로 받는지 별도 확인 필요(§8) |

## 3. 매핑 스키마

```jsonc
// origins.json — 값은 환경/고객별. 키는 아래 서비스명 9개만 유효(모르는 키 → 에러). 부분 매핑 허용.
// 키가 전체 origin("https://cma.weegloo.com")으로 와도 서비스명으로 정규화 수용(복붙 관용) —
// 소스 origin은 고정 9개라 전체 URL 키는 중복 타이핑일 뿐이라 짧은 키를 표준으로 채택(사용자 결정).
{
  "cma":     "https://cma.acme.com",
  "cda":     "https://cda.acme.com",
  "acma":    "https://acma.acme.com",
  "acda":    "https://acda.acme.com",
  "upload":  "https://upload.acme.com",  // manifest.mcp.uploadApiUrl 에도 적용
  "script":  "https://script.acme.com",  // Script /execute 전용 호스트(작성은 cma)
  "auth":    "https://auth.acme.com",    // 최대 표면(~50곳, provider redirect URI 포함)
  "console": "https://console.acme.com", // PAT 페이지 + FE 로그인 팝업 origin
  "ai":      "https://ai.acme.com"       // /v1/version(버전체크) + /mcp(MCP 서버)
}
```

**공용 고정(매핑 불가)**: `docs.weegloo.com`, `weegloo-media.com`(SDK 번들),
`weegloo.com/terms`(룰 제외로 소멸), 외부 스펙/콘솔(RFC·npm·provider 콘솔),
예시 URL(`api.llm.com` 등), 오답 예시 `cda-weegloo.com`(절대 치환 금지 — 문자열이 달라 자연 안전).

**입력**: `--origins <file>` 플래그 (또는 `WEEGLOO_ORIGINS` env에 JSON/파일경로).
값 검증: `https://` origin 형태(경로/쿼리 금지), trailing slash 정규화.

## 4. 적용 지점

치환은 **디스크 파일이 아니라 메모리 위 문자열**에 일어난다: 레포 소스와 매니페스트는 불변,
`loadResources()` 가 받아온 콘텐츠 문자열을 **디스크에 쓰기 직전** 치환. 멱등 — 매번 원본
매니페스트에서 새로 치환하므로 이중 치환 없음.

1. **콘텐츠 재작성**: `loadResources()` 결과의 skill 파일들 + 룰 content에
   `applyOriginMapping(content, hosts)` (호스트 문자열 단위 replaceAll — §2 매핑 단위 참조) —
   install(`index.js`)과 `--update`(`update.js`) **공용 함수 1개**.
2. **매니페스트 MCP URL**: `resources.mcp.weeglooUrl` / `uploadApiUrl` 에 동일 매핑
   (`ai.weegloo.com/mcp`, `upload.weegloo.com/v1` 이 호스트 매핑으로 커버됨) →
   에이전트별 MCP 설정 파일에 매핑된 값이 쓰임 (Claude 예: global `~/.claude.json`,
   project `<cwd>/.mcp.json` 의 `weegloo` 서버 `url` + `weegloo-upload` 의 `UPLOAD_API_URL`).
   MCP 설정은 **설치 시에만** 쓰이므로 환경 전환 시의 함정은 §5 참조.
3. **버전 룰 굽기 순서**: `applySelfUpdateTemplate` 이 `${VERSION_URL}?branch=` 를 치환한
   **뒤에** origin 매핑 적용 (또는 매핑된 URL로 치환) — 순서가 바뀌면 룰의 체크가
   프로덕션 엔드포인트를 봄. 치환 결과물 전체에 매핑을 마지막 단계로 거는 게 안전.
4. **토큰 검증 + PAT 안내 URL** (사용자 리포트로 발견된 구멍): PAT 검증(`cmaMeUrl` →
   `GET /v1/me`)은 origins가 있으면 **명시적으로** `origins.cma`(미매핑 시 프로덕션)를
   사용 — 매핑된 `uploadApiUrl` 에 기존 문자열 휴리스틱(`'upload.'`→`'cma.'`)을 돌리면
   `upload-weegloo.acme.ai` 류 호스트에서 매칭 실패 → **프로덕션 폴백**으로 새어 고객 PAT가
   엉뚱한 서버에서 거부됨. PAT 발급 안내 URL(console)도 매핑을 탐.

## 5. 영속성 — `--update` 가 같은 환경을 유지해야 함 (핵심)

매핑은 1회성 옵션이 아니라 **그 설치의 속성**이다. per-agent 기록에 저장:

```jsonc
// .weegloo/<agent>/installed.json 에 추가
{ "skills": [...], "rules": [...], "availableSkills": [...], "availableRules": [...],
  "origins": { "cma": "https://cma.acme.com", ... } }
```

- `--update` 는 기록의 `origins` 를 읽어 **자동 재적용** — 안 하면 업데이트가 콘텐츠를
  프로덕션 URL로 되돌리는 사고(이 설계에서 가장 위험한 실수 지점).
- **`--update` 는 `--origins` 를 받지 않는다(조합 시 에러)** — update의 origins 소스는
  per-agent 기록 **단 하나**. 이유: update 는 MCP 설정을 절대 안 건드리므로(설계 원칙)
  update 경로의 환경 전환을 허용하면 룰/스킬만 새 환경이 되고 MCP 설정(`.mcp.json` /
  `~/.claude.json` 의 서버 URL·`UPLOAD_API_URL`)은 옛 도메인에 남는 혼합 상태가 됨.
  오버라이드+경고로 함정을 알리는 초안을 기각하고 **조합 자체를 막아 함정을 구조적으로
  제거** — 환경 전환(매핑 추가/변경/제거)은 전부 **재설치**(`--origins` + 필요시 `--mcp`)가
  단일 경로. 에러 메시지가 이를 안내.
- 기록에 `origins` 없음(기존 설치) = 매핑 없음 = 현행 동작.
- 안내 커맨드는 최소형 유지 — 브랜치(`ref`)와 같은 원리로 기록이 단일 소스.

## 6. 특수 규칙 — origins 매핑 ⇒ terms-consent 룰 제외

- origins 매핑이 하나라도 있으면 `weegloo-terms-consent` 를
  **카탈로그에서 제거** (install 체크박스에도 안 나오고, update의 add에도 없음).
- **PR-0 상호작용**: terms-consent 는 코어 룰(강제 설치)이므로, 이 경우 **코어 강제도
  함께 해제** — `CORE_RULE_IDS` 적용 지점(install 체크박스 합류 + update 의 `add ∪ CORE`)이
  "origins 매핑 없음"을 조건으로 가짐. `weegloo-version` 코어 강제는 무관하게 유지.
- update 시 기존에 깔려 있던 terms-consent 룰은 upstream-삭제와 동일하게 **정리(prune)** 됨
  (카탈로그에서 빠졌으므로 기존 집합 연산이 자연히 처리 — 추가 코드 불필요).

## 7. 엣지 케이스

- **치환 안전성**: 호스트 경계 정규식(§2 매핑 단위)이 담보 — `acma`⊃`cma` 중첩, 오답 예시
  `cda-weegloo.com`(dash 경계), `…weegloo.company` 같은 접미 유사 토큰 모두 테스트로 고정.
  치환값은 함수 삽입이라 `$` 등 정규식 치환 패턴 문자도 literal 처리.
- **멱등성**: 치환은 원본 콘텐츠(매니페스트)에 매번 새로 적용 — 이중 치환 없음.
  단, 매핑 값에 weegloo 원본 origin 이 포함되는 순환 매핑(A→B, B→A)은 검증에서 거부.
- **에이전트별 환경 상이**: `origins` 가 per-agent 기록이므로 claude=프로덕션,
  cursor=스테이징 공존 가능 — per-agent 설계가 그대로 수용.
- **공유 스토어(project의 codex/antigravity/androidstudio)**: 브랜치 충돌과 동일한
  문제가 origins 에도 존재(같은 AGENTS.md 에 서로 다른 도메인 콘텐츠) — 기존 충돌 감지를
  "ref **또는 hosts** 상이"로 확장.
- **버전 비교 정합**: 고객 스택의 `ai.<도메인>/v1/version?branch=` 반환값은 고객이
  설치에 쓰는 매니페스트 소스(`WEEGLOO_REPO` 포함)의 `version` 과 **동일 소스**여야 함
  (공용에서 실측 검증한 §11 조건이 고객 스택에도 요구됨 — 납품 체크리스트 §8).

## 8. 납품 체크리스트 (엔터프라이즈 전제조건)

- [ ] 9개 origin 중 매핑할 것들의 고객 스택 엔드포인트 가동 (특히 `ai.*/v1/version?branch=`,
      `ai.*/mcp`, `auth.*` OAuth 경로)
- [ ] provider 콘솔(구글 등)에 고객 auth 도메인의 redirect URI 등록
- [ ] `version?branch=` ↔ 매니페스트 `version` 동일 소스 확인
- [ ] 브라우저 SDK(`weegloo-service-user`)가 **auth base URL 을 설정으로 받는지** 확인 —
      내부에 `auth.weegloo.com` 하드코딩이면 공용 SDK가 고객 auth 와 통신 불가 (SDK 측 선행 수정)
- [ ] terms-consent 제외에 따른 약관 처리(계약/자체 게시) 확인

## 9. 작업 분할

### PR-A — 매핑 코어 (~1.5일)
- `origins.js` (신규): 스키마 검증(유효 키 9개 · origin 형태 · 순환 거부) +
  `applyOriginMapping(content, hosts)` + 매니페스트 mcp 적용 헬퍼.
- `cli.js`: `--origins <file>` (+ `WEEGLOO_ORIGINS` env) — **install 전용**, `--update` 와 조합 시 에러(§5).
- `index.js` / `update.js`: `loadResources` 후 콘텐츠·mcp 재작성 (룰은 템플릿 치환 **후**).
- 기록 스키마에 `origins` 추가 (`self-update.js` read/write) + update 의 자동 재적용.

### PR-B — 특수 규칙 + 충돌 확장 (~1일)
- origins 매핑 ⇒ terms-consent 카탈로그 제거 + 코어 강제 조건부 (install·update 공통).
- 공유 스토어 충돌 감지에 origins 상이 추가.

### 테스트
매핑 검증(잘못된 키/형태/순환) · 치환 결과(8 origin, 오답 예시 불변, 부분 매핑) ·
mcp URL 매핑 · 버전 룰 굽기 순서(`?branch=` + 매핑 동시) · 기록 영속 + update 재적용 ·
`--update --origins` 조합 에러 · origins⇒terms 제외(체크박스/코어/update prune) · 공유 스토어 origins 충돌 ·
매핑 없음 = 바이트 동일(회귀).

## 10. 기각한 대안 (기록)

- **placeholder 전면화**: §2 참조 — 소스 침습 과대.
- **엔터프라이즈 브랜치(콘텐츠 측 CI)**: 운영비·백엔드 결합 — 단 이 구현 위의 배포
  방식으로는 여전히 유효 (origins 파일을 CI 에서 적용해 고객 브랜치 생성).
- **버전 체크 공용 유지(초안 B-1)**: 사용자 결정으로 매핑 대상 전환 — MCP 와 같은
  origin 이라 오히려 스키마 단순화.
