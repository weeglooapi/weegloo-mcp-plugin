# 국가 필터 설계 (국가별 skill·rule 설치)

skill·rule 에 **국가 태그**(`country:`)를 달고, 설치할 때 클라이언트의 국가를 알아내
**그 나라에서 통용되는 것만** 설치하는 설계. 두 방향:

- **특정 국가 전용**: 그 나라에서만 성립하는 하네스(예: 한국 우편번호 위젯) — `country: KR`.
- **특정 국가 제외**: 그 나라에서는 통용되지 않는 하네스 — `country: -KR`.

> 작성 시점(2026-09-23) 기준. 코드 변경 시 함께 갱신.
> 선행 문서: `origins-mapping.md` — "설치의 속성을 기록하고 `--update` 가 재사용한다"와
> "공유 스토어 충돌"을 이 설계가 그대로 따른다.
> 저자용 규격(태그 다는 법): 저장소 루트 `CLAUDE.md` §2.8.

---

## 1. 배경 — 왜 설치 시점에 거르는가

지금까지는 모든 설치가 카탈로그 **전부**를 받았다. 한 나라에서만 성립하는 스킬이 다른 나라
사용자에게 깔리면 두 가지 비용이 생긴다:

| 비용 | 내용 |
|---|---|
| 항상-로딩 예산 | 스킬 `description` 은 **매 세션** 로딩된다(CLAUDE.md §1.1 L1). 그 나라 사용자가 아니면 영원히 쓰지 않을 바이트를 모든 세션이 낸다 |
| 오발화 | 트리거가 맞으면 발화한다 — 한국 주소가 아닌 폼에 한국 전용 위젯을 붙이는 식의 **그럴듯한 오답**. 에러는 어디에도 없다 |

그래서 **디스크에 아예 쓰지 않는다**. 국가를 모르면 오늘과 똑같이 전부 설치한다(§5.3).

## 2. 핵심 결정

| 결정 | 내용 | 왜 (기각한 대안 포함) |
|---|---|---|
| 태그 위치 | `SKILL.md` / 룰 `.mdc` frontmatter 의 **전용 최상위 키 `country:`** | **`description` 접두(`[KR] …`) 기각** — YAML 파싱이 깨져 harness가 스킬을 조용히 잃는다(§3.2 실측). `metadata.json` 기각(§11) |
| 문법 | `KR` · `KR, US, CA` · `-KR` · `"*"`, **생략 = 전체** | 전용 키라 대괄호가 필요 없다 — 값은 평범한 YAML 문자열. 모두 유효한 YAML(§3.3) — 원본 파일을 직접 읽는 경로(마켓플레이스)가 깨지지 않게. 예전 대괄호 표기(`[KR, US]`)는 거부해 표기를 하나로 유지 |
| 파싱 위치 | **빌더가** 검증·제거하고 매니페스트의 구조 필드 `country` 로 옮김 | installer 는 frontmatter 를 파싱하지 않는다 — 검증이 빌드 시점 한 번(크게 실패), 소비자 쪽 정규식 사본 없음 |
| 필터 위치 | 매니페스트 로드 직후 **카탈로그 단계** (`applyTermsExclusion` 바로 뒤) | origins ⇒ terms 제외와 같은 자리. 피커·코어 강제·기록·update prune 이 조건문 추가 없이 따라온다 |
| 국가 조회 | `GET https://ai.weegloo.com/v1/country` → `{ "country": "KR" }` | `/v1/version` 과 같은 `ai` origin — origins 매핑 하나로 함께 움직인다 |
| 조회 실패 | **fail-open** — 필터 없음(현행) + 노란 경고 | 국가를 모르는 필터가 필터 없음보다 나쁜 설치를 만들면 안 된다. fail-closed 기각(§11) |
| `--update` | **기록된 국가 재사용**, `--country` 로만 변경. 기록이 없으면 1회 조회 후 기록 | origins 와 같은 원리(설치의 속성). 매 업데이트 재조회 기각(§11) |
| 코어 룰 | `weegloo-version`, `weegloo-terms-consent` 는 **태그 금지(빌더) + 필터 예외(installer)** | 강제 설치 대상이다 — 국가 필터가 그것을 잃는 경로가 되면 안 된다. 이중 잠금 |
| 스키마 | `schemaVersion` **1 유지** — 추가·선택 필드 | 구 CLI 는 필드를 무시하고 전부 설치(§9) — breaking 없음 |

## 3. 태그 문법

frontmatter 안, **열 0 의 최상위 키 `country:`** 한 줄. 본문의 `country:` 는 산문이라 무시한다.

| 표기 | 의미 | 매니페스트 필드 |
|---|---|---|
| (키 생략) | 모든 국가 | 없음 |
| `country:` — 코드 없음(빈 값, `""`, 주석뿐) | 모든 국가 — 생략과 같다 | 없음 (줄만 제거) |
| `country: "*"` | 모든 국가 — **따옴표 필수** | 없음 (줄만 제거) |
| `country: KR` · `KR, US, CA` | 이 나라들**에서만** | `{ "include": ["CA","KR","US"] }` |
| `country: -KR` · `-KR, -JP` | 이 나라들**만 빼고** | `{ "exclude": ["JP","KR"] }` |

### 3.1 빌드 에러가 되는 것 (관대한 모드 없음)

잘못 읽힌 태그는 **엉뚱한 나라에 설치되고 에러가 없다** — 그래서 문서화된 형태가 아니면 전부 던진다.

| 입력 | 이유 |
|---|---|
| `*` (따옴표 없음) | `*` 는 YAML alias 표시자 — 무효 YAML(§3.3) |
| `kr` | 대문자만 (메시지가 `use upper case` 를 안내) |
| `KOR`, `K1`, `KR,`, `KR,,US` | ISO 3166-1 alpha-2 두 글자가 아님 (빈 항목 포함) |
| `KR US` | 쉼표 없음 (메시지가 `separate codes with commas` 를 안내) |
| `- KR` | `-` 뒤 공백 — YAML 블록 목록 표시자라 무효 YAML (메시지가 `write -KR` 을 안내) |
| `KR, -US` | 포함·제외 혼용 |
| `KR, KR` | 중복 |
| `[KR, US]`, `[-KR]`, `"[*]"` | **예전 대괄호 표기** — 유효 YAML 이라 다른 데서 걸리지 않으므로 여기서 거부한다(메시지가 쓸 형태를 안내) |
| `*, KR` | `*` 와 다른 코드 조합 |
| 다음 줄로 이어 쓴 값 — 블록 목록(`country:` 다음 줄 `  - KR`, 열 0 의 `- KR`), 줄바꿈한 값(`country: KR,` 다음 줄 `  US`) | 빌더는 키의 **그 한 줄만** 읽는다. YAML 은 다음 줄의 코드를 보지만 빌더에게는 빈 값 = 전체라, 막지 않으면 조용히 전 국가에 설치된다 (메시지가 `write the codes on the same line` 을 안내). 들여쓴 주석 줄은 이어 쓴 값이 아니다 |
| `Country:`, `countries:`, `metadata:` 아래 들여쓴 `country:` | **유사 키** — 무시하면 저자는 제한했다고 믿는데 전 국가에 설치된다 |
| 한 frontmatter 에 `country:` 두 줄 | 모호함 |

허용: 뒤 YAML 주석(`country: KR  # Kakao 전용`), 값 전체를 감싼 따옴표(`"KR, US"`), 쉼표 앞뒤 공백,
코드 없는 키(`country:` · `country: ""` · `country: # 나중에` → 전체).
코드 순서는 무관 — 빌더가 바이트 순으로 정렬해 기록한다(`US, KR` → `["KR","US"]`).

### 3.2 왜 `description` 접두가 아닌가 (실측)

따옴표 없는 YAML 값이 `[` 로 시작하면 flow sequence 다. `description: [KR] Wire …` 는 파싱에 실패한다:

- js-yaml: `bad indentation of a mapping entry`
- yaml: `Unexpected scalar …` (이 장비의 yaml 1.10.2 재확인: `All collection items must start at the same column`)

frontmatter 블록 전체가 버려지므로 harness 는 스킬의 **name 과 description 을 함께 잃는다** — 스킬이
발화하지 않고, 에러는 어디에도 없다. "description 은 항상 따옴표로 감싼다"는 규칙을 더하는 방법도
있지만, 잊는 한 번이 같은 조용한 실패이고 ≤ 700 B 예산(CLAUDE.md §2.2)의 트리거 문장 앞에 잡음을
얹는다.

### 3.3 bare `*` 를 거부하는 이유

`country: *` 는 무효 YAML 이다(js-yaml: `name of an alias node must contain at least one character`,
yaml: `Alias cannot be an empty string`). 빌더가 줄을 지우니 상관없어 보이지만, **Claude Code / Cursor
플러그인 마켓플레이스는 원본 파일을 직접 읽는다**(§10) — 거기에는 빌더가 없다. 나머지 형태는 js-yaml·yaml
두 파서에서 유효한 문자열로 확인했다: `KR` → `"KR"`, `KR, US, CA` → `"KR, US, CA"`, `-KR, -JP` →
`"-KR, -JP"`, `"*"` → `"*"`. `country: NO`(노르웨이)도 두 파서 모두 문자열 `"NO"` 로 읽는다(YAML 1.2).

## 4. 빌드 처리 (저장소 루트 `scripts/build-installer-manifest.mjs`)

1. **스킬**: `SKILL.md` 에서 `extractCountryTag` → `country:` 줄을 **지운** 본문을 임베드하고, 값을
   엔트리의 `country` 로 옮긴다. 설치본에는 그 줄이 없다.
2. **스킬의 다른 파일**(`references/*.md`, `metadata.json` …)에 태그가 있으면 **빌드 에러**
   (`'country:' belongs in SKILL.md frontmatter`) — 그 자리의 태그는 읽히지 않아, 저자는 제한했다고
   믿는데 전 국가에 설치된다. 무효·유사 태그도, no-op 인 `"*"` 도 같은 에러다(줄이 틀린 파일에 있다).
3. **룰**: `.mdc` 에서 같은 추출·제거.
4. **코어 룰 태그 금지**: `CORE_RULE_IDS`(`self-update.js`)에 태그가 있으면 빌드 에러
   (`core rule '<id>' is force-installed and cannot be country-restricted`).
5. **엔트리 형태**: 키 순서 `id, country?, files|content`. `country` 는 **제한할 때만** 존재 —
   미태그와 `"*"` 는 키가 없다. 그래서 태그가 하나도 없는 코퍼스는 **오늘과 바이트 동일한**
   매니페스트를 만든다.
6. **빈 파일 검사**는 제거 **후** 본문 기준 — `country:` 한 줄뿐인 룰은 빈 룰이다.
7. **`version`**: 해시가 `{ mcp, skills, rules }` 전체에 걸리므로 **태그만 바꿔도 `version` 이 바뀐다**
   (본문은 같아도 구조 필드가 다르다) → 설치된 `weegloo-version` 룰이 업데이트를 안내한다.
8. **보고(stderr, 빌드는 실패하지 않음)**: 제한 엔트리가 있으면
   `country-restricted: N skill(s), M rule(s)`, 그리고 **참조 공백** 목록(예시 — 현재 태그된 파일은 없다):

   ```
   WARNING: 1 reference(s) to a country-restricted skill/rule from where it is not installed:
     rule weegloo-global-rules names skill weegloo-address-search, but is installed where skill weegloo-address-search is not (* ⊄ KR)
     Each referencing line must stay actionable without its target in those countries (CLAUDE.md §1.3-4).
   ```

   국가 필터는 스킬을 통째로 빼지만, 그 스킬을 **이름으로 부르는 다른 줄**(라우터, `weegloo-global-rules`)은
   남는다(§10). 그 줄이 대상 없이도 행동 가능한지는 테스트가 판정할 수 없어 저자에게 보고만 한다.
   매칭은 id 경계 기준 — `weegloo-address-search-v2` 는 `weegloo-address-search` 의 언급이 아니다.
   스킬과 룰이 같은 id 를 가지면(`weegloo-default-locale`) 한 언급이 둘 다로 세어진다 — 과보고, 누락 없음.

## 5. 설치 흐름 (`src/index.js`)

### 5.1 국가 결정

- **skill·rule 을 설치할 때만** 결정한다. MCP-only 설치는 조회하지 않고 아무것도 기록하지 않는다.
- 순서: **`--country` > `WEEGLOO_COUNTRY` > 조회**. 플래그·env 값은 대소문자 무관(`kr` → `KR`),
  두 글자가 아니거나 `XX`/`ZZ` 면 CLI 에러 — 오타(`KOR`)를 조회 결과로 조용히 바꾸면 사용자가 요청한 것과
  다른 집합이 설치된다. (`--uninstall` 에서는 거를 것이 없어 경고만.)
- 조회는 매니페스트 fetch 와 **동시에**(`Promise.all`) 돈다 — 추가 대기는 둘 중 느린 쪽뿐.

### 5.2 조회 엔드포인트

| 항목 | 값 |
|---|---|
| 요청 | `GET https://ai.weegloo.com/v1/country` — 무인증, **요청 헤더 없음**(`Accept` 도 보내지 않는다 — api-endpoints 룰) |
| 응답 | `{ "country": "KR" }` — 서버가 요청 네트워크(IP)로 추정 |
| 타임아웃 | 시도당 5초, 네트워크 오류·429·5xx 에 1회 재시도 (`fetchCountry`, `src/github.js`) |
| 정규화 | trim + 대문자, `^[A-Z]{2}$`, `XX`(Cloudflare 의 "모름")·`ZZ` → 모름 |
| origins | `ai` 키로 매핑된다: `{ "ai": "https://dev-ai.weegloo.com" }` → `https://dev-ai.weegloo.com/v1/country` |
| env | `WEEGLOO_COUNTRY_URL` 이 기본 URL 을 **통째로** 바꾼다. 매핑은 그 결과에 걸리므로 weegloo 호스트가 아닌 URL 에는 영향이 없다 |

`fetchCountry` 는 **절대 던지지 않는다**: 오프라인·타임아웃·비 2xx·비 JSON·필드 없음·`XX` 는 전부 `null`(모름).

### 5.3 fail-open

모름 = **필터 없음**. 이 기능 이전과 똑같이 전부 설치하고 경고 한 줄:

```
  ⚠  Could not determine your country — installing every skill/rule (no country filter). Pin one with --country <code>.
```

`XX` 를 나라로 취급하면 아무도 없는 위치로 필터링하게 된다(`-…` 태그와 미태그만 남는다) — 그래서
"모름" 코드도 조회 실패와 같게 다룬다.

### 5.4 카탈로그 단계 필터

`applyTermsExclusion(...)` 직후 `filterResourcesByCountry(resources, country, { exemptRuleIds: CORE_RULE_IDS })`
가 그 나라에서 통용되지 않는 스킬·룰을 **카탈로그에서** 뺀다. 이후 전부가 필터된 카탈로그를 본다:

| 소비자 | 결과 |
|---|---|
| 대화형 피커 | 제외된 항목은 **선택지에 없다** |
| 비대화형(`-y`, CI, 에이전트) "전부" | 제외된 항목은 "전부"에 없다 |
| 코어 강제 | 코어 룰은 필터 예외 — 태그가 있어도 남는다(빌더가 이미 막는 두 번째 잠금) |
| 기록 `availableSkills/Rules` | **필터된** 카탈로그 — 제외된 항목은 "제시된 적 없음"으로 기록된다(§6.2) |
| installer 5종 | 필터된 선택만 쓴다 |

피커 앞에 한 줄씩 출력한다:

```
  Country: KR (detected)                         ← --country 면 (--country)
  - Not offered in KR: 1 skill(s) (weegloo-foo), 1 rule(s) (weegloo-bar)   ← 0인 쪽은 생략
```

## 6. 업데이트 (`src/update.js`)

### 6.1 국가 결정 — 기록 재사용

순서: **`--country` / `WEEGLOO_COUNTRY` > 기록의 `country` > 조회 > 모름**.

- 국가를 기록한 설치의 업데이트는 **네트워크 조회 0회** — 국가는 그 설치의 속성이다(origins 와 같다).
- 기록에 `country` 가 없으면(기능 이전 설치, 또는 설치 때 조회가 실패) **1회 조회하고 기록한다**.
- 조회는 "nothing installed" early return **뒤**에만 — no-op 업데이트는 요청하지 않는다. 필요할 때는
  install 과 같이 매니페스트 fetch 와 동시에 돈다.
- 출력 라벨: `(recorded at install)` / `(--country)` / `(detected)`, 모름이면
  `… updating every skill/rule (no country filter) …`.

**`--update --country` 는 허용한다** — `--update --origins` 가 거부되는 것과 다르다. origins 를 update
에서 막는 이유는 update 가 MCP 설정을 건드리지 않아 룰·스킬만 새 환경이 되는 **혼합 상태**였다
(`origins-mapping.md` §5). 국가는 skill·rule 집합만 바꾸고 MCP 설정과 무관하므로 그 함정이 없다.
`--update --country US` 는 기록을 덮어쓰고 US 를 다시 기록한다 — 오판된 국가를 고치는 경로다.

### 6.2 필터 → 기존 집합 연산이 처리

필터는 `applyTermsExclusion` 직후, `catalog*Ids` 계산 **전**에 걸린다. 그래서 `planUpdate` 의 add-set,
`newIds`, prune, 다시 쓰는 `availableSkills/Rules` 가 전부 필터된 카탈로그 기준이고, 추가 코드가 없다:

| 상황 | 결과 |
|---|---|
| 설치돼 있던 스킬이 이 나라에서 제외됨(상류 태그 추가, 또는 `--country` 변경) | **prune** — 상류 삭제와 같은 경로 |
| 이전 카탈로그(`availableSkills`)에 없던 스킬이 이 나라에 허용됨 | **new → 자동 추가** (국가 변경으로 풀린 스킬 포함) |
| 이 나라에서 제외된 스킬 | 추가되지 않는다 — 카탈로그에 없다 |
| 코어 룰 | 항상 (필터 예외) |
| 조회 실패, 기록 없음 | 필터 없음 → 국가 때문에 prune 되는 것 없음, 기록에 `country` 없음 → 다음 업데이트가 다시 1회 조회 |

## 7. 기록 형식

```jsonc
// .weegloo/<agent>/installed.json 에 추가
{ "skills": [...], "rules": [...], "availableSkills": [...], "availableRules": [...],
  "origins": { ... }, "country": "KR" }
```

- 의미: 이 설치가 **필터링에 쓴** 국가. 모름(fail-open)으로 돈 실행은 **키를 지운다** — 다음 업데이트가 조회한다.
- 모든 기록 쓰기에서 명시적으로 설정 또는 삭제(origins 와 같다) — 이전 실행의 값이 남지 않는다.
- 읽을 때 `normalizeCountryCode` — 손상·부재 → `null`.
- 기록은 여전히 **id 단위**다 — 파일 목록 포맷 변화 없음.

## 8. 공유 스토어 충돌

project scope 의 codex / antigravity / androidstudio 는 `.agents/skills` 와 `AGENTS.md` 를 **물리적으로
공유**한다. 서로 다른 나라로 기록된 두 agent 는 같은 파일에 서로 다른 스킬 집합을 쓰게 된다.

- **update**: sharer 감지(`detectSharerRefs`)가 sharer 기록의 `country` 도 읽는다. **양쪽 다 알려져 있고
  다르면** 충돌 — `why` 에 `different country` 가 붙고, 브랜치·origins 상이와 같은 질문
  (overwrite / skip / abort; 비대화형은 경고 후 덮어씀)으로 간다.
- 한쪽이라도 모름이면 충돌로 보지 않는다 — 모름은 필터 없이 설치됐다는 뜻이지 "다르다"의 증거가 아니다.
- **prune 은 sharer 가 기록으로 주장하는 id 를 지우지 않는다**(`withoutSharerClaims`). 공유 디렉터리에서는
  한 agent 의 국가 제외가 다른 agent 가 설치한 스킬을 지우지 않는다 — 대신 그 파일은 물리 공유라
  이 agent 에게도 보인다.
- install 경로에는 충돌 질문이 없다 — last-writer-wins, 브랜치·origins 와 같은 기존 동작.

## 9. 하위 호환

| 조합 | 결과 |
|---|---|
| **구 CLI + 새 매니페스트**(`country` 필드 있음) | `normalizeManifest` 가 `{ id, files }` / `{ id, content }` 만 옮기므로 필드를 **무시** → 전부 설치(현행). 본문에는 이미 `country:` 줄이 없다 |
| **새 CLI + 구 매니페스트**(필드 없음) | 거를 것이 없다 → 전부 설치. 국가는 결정·기록된다 |
| 기능 이전 설치의 `--update` | 기록에 `country` 없음 → 1회 조회 후 기록(§6.1) |
| 태그 없는 코퍼스 | 매니페스트 **바이트 동일**(§4-5) |
| 손상된 `country` 필드(`{include:[]}`, `{include:['kr']}`, `'KR'`) | 매니페스트 전체 거부 — `normalizeManifest` 의 다른 모양 에러와 같은 strict |

## 10. 한계

- **마켓플레이스 경로에는 필터가 없다.** `.claude-plugin/marketplace.json` · `.cursor-plugin/marketplace.json`
  은 `plugins/weegloo` 원본을 직접 읽는다 — 빌더도 installer 도 거치지 않으므로 태그된 스킬도 전 국가에
  설치되고, `country:` 줄도 원본 그대로 남는다. 문법을 유효 YAML 로 제한한 이유가 이것이다(§3.3).
  harness 가 모르는 frontmatter 키를 무시하는지는 **측정되지 않았다**.
- **IP 기반 추정이다.** VPN, 회사 프록시, 해외 출장, 해외 리전 CI 러너는 오판된다. `--country` 로 고정한다.
  업데이트는 기록을 재사용하므로 **오판도 고정된다** — `--update --country <cc>` 로 고친다.
- **통째로 빠지는 스킬을 가리키는 줄은 남는다.** 라우터(`weegloo-platform-integration`)나
  `weegloo-global-rules` 의 라우팅 절이 제외된 스킬을 이름으로 부르면, 그 나라 세션의 에이전트는 디스크에
  없는 스킬로 안내된다. 빌더 경고(§4-8)가 목록을 주지만 판정은 못 한다 — **그 줄이 링크 없이도 행동
  가능해야 한다**(CLAUDE.md §1.3-4 Verdict 우선). 좋은 예(현행 `weegloo-global-rules`): 주소 입력 줄이
  "**SOUTH KOREA only**; a form that will hold foreign addresses gets a plain free-text field" 를 스스로 말한다.
- **단위는 스킬·룰 통째다.** 파일 하나, 문단 하나를 국가별로 가를 수 없다(`references/` 태그 금지, §4-2).
  나라마다 다른 문단이 필요하면 스킬을 나눈다.
- **제외 기간 동안 해제(deselect) 기억이 사라진다.** 제외된 스킬은 `availableSkills` 에서 빠지므로,
  나중에 다시 허용되면 "new" 로 자동 추가된다 — 그 전에 사용자가 일부러 해제했던 스킬이라도.
- **fixtures 는 설치된 코퍼스를 잰다**(CLAUDE.md §5.2). 태그가 있으면 측정 장비의 기록 국가 코퍼스를
  재게 된다 — 다른 나라의 행동을 재려면 그 나라로 설치(`--country`)해야 한다.

## 11. 기각한 대안 (기록)

- **`description` 접두 `[KR] …`**: YAML 파싱 실패로 스킬이 조용히 사라진다(§3.2). 따옴표 규칙은 잊는
  한 번이 같은 실패.
- **대괄호 표기 `country: [KR, US]`**(초안): 유효한 YAML 이지만 전용 키에는 필요 없는 문법이고, `[*]` 처럼
  따옴표를 잊기 쉬운 형태를 만든다. 평문 `country: KR, US` 로 교체했고, 예전 표기는 빌드 에러로 막아 코퍼스의
  표기를 하나로 유지한다.
- **`metadata.json` 에 `country`**: 룰에는 `metadata.json` 이 없다(`.mdc` 단일 파일) — 스킬·룰이 서로 다른
  메커니즘을 갖게 된다. 또 `SKILL.md` 를 고치는 저자의 눈에서 떨어진 파일이라 태그가 있는 줄 모른다.
- **매 업데이트 재조회**: VPN·출장으로 나라가 바뀔 때마다 스킬이 사라졌다 돌아오는 **진동**. 업데이트는
  `weegloo-version` 룰이 안내하는 무인 명령이라, 사용자가 모르는 사이 스킬이 prune 된다.
- **fail-closed**(모르면 태그된 항목 제외): 조회 한 번의 실패(오프라인·방화벽·서버 장애)가 한국 사용자에게서
  한국 전용 스킬을 빼앗는다. 필터가 모를 때 필터 없음보다 나쁘면 안 된다.
- **`--update --country` 금지**(origins 처럼): 혼합 상태 함정이 없으니(§6.1) 막을 이유가 없고, 막으면
  오판 교정 경로가 재설치뿐이 된다.
- **installer 가 frontmatter 를 파싱**: 소비자(CLI 버전)마다 파서 사본이 생기고, 잘못된 태그가 빌드가
  아니라 사용자 설치 시점에 조용히 오동작한다. 빌드 시점 한 번 검증이 "커밋 전에 크게 실패"하는 쪽이다.

## 12. 코드 지도

| 파일 | 역할 |
|---|---|
| `src/country.js` | 태그 문법(`parseCountryTag`, `extractCountryTag`), 필드 검증(`normalizeCountrySpec`), 필터(`countryAllows`, `filterResourcesByCountry`), 국가 결정(`resolveCountry`), 조회 URL(`countryCheckUrl`), 참조 공백(`findCountryReferenceGaps`) |
| `../scripts/build-installer-manifest.mjs` (저장소 루트) | 추출·제거·구조 필드·코어 룰 금지·보고(`countryReport`) |
| `src/github.js` | `normalizeManifest` 의 `country` 검증, `fetchCountry` |
| `src/cli.js` | `--country` / `WEEGLOO_COUNTRY` |
| `src/index.js` | install — 동시 조회, 필터, 출력 |
| `src/update.js` | update — 기록 재사용, 필터, sharer 의 `different country` |
| `src/self-update.js` | 기록의 `country` 읽기·쓰기 |
| `test/country.test.js` · `test/country-source.test.js` | 문법·필터·결정 / 조회·매니페스트 소비 |
