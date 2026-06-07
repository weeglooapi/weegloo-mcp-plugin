# ADR 0001 — Skills/Rules 배포 방식: 브랜치-네이티브 manifest + git `info/refs`

- 상태: **Accepted** (2026-06-06)
- 영향 범위: `installer-cli` (`npx weegloo`), 배포 워크플로
- 대체 관계: 이전에 검토·구현되었던 **Design D**(Releases + GitHub Pages, PR #16)를 **채택하지 않기로** 함. 그 배경과 이유는 아래 "기각된 대안" 참조.

---

## 1. 문제 (Context)

`npx weegloo` 인스톨러는 사용자가 고른 브랜치(`latest` / 버전 브랜치)에서 skills/rules를
받아 IDE 설정에 깔아준다. 기존 구현은 두 군데서 **`api.github.com` REST API**를 쓴다:

1. **버전 picker** — `GET api.github.com/repos/.../branches` (1회)
2. **skill/rule 목록** — `GET api.github.com/repos/.../contents/...` (2~4회)

이 둘은 모두 **무인증 60 req/hour "core" 버킷**을 공유한다. 한도 소진 시 코드가
조용히 기본값(`DEFAULT_SKILL_IDS` 등)으로 폴백 → picker가 빈 목록이 되거나 일부
skill만 노출되는 **silent degradation** 버그가 발생한다.

### 근거 — 실측 (2026-06-06)

`/branches` 응답 헤더를 직접 확인:

```
x-ratelimit-limit: 60
x-ratelimit-remaining: 59      # 호출 전 60 → 후 59
x-ratelimit-resource: core
```

`/rate_limit`(차감 없는 엔드포인트)도 `core {limit:60, remaining:59}` → branches
호출이 공유 core 버킷을 깎는 것이 그대로 관측됨. GitHub REST 문서
("Rate limits for the REST API")의 "무인증 IP당 60/hour, REST 전체가 primary 버킷
공유"와 일치. **즉 추측이 아니라 응답 헤더에 박혀 나오는 확정 사실.**

설치 1회 = core 3~5 소모 → 같은 IP에서 시간당 ~12~20설치면 소진.

---

## 2. 제약 (Forces)

사용자가 명시한 결정 기준:

- **R1 안정 계약**: 의존하는 엔드포인트가 안정적인 contract여야 함.
- **R2 rate limit 없음**: 한도가 없거나, 있어도 실질적으로 무시 가능한 수준.
- **R3 검증된 패턴 가산점**: 유명 서비스가 채택한 방식이면 더 신뢰.
- **R4 현재 동작 유지**: develop 제외, 버전 브랜치 최신 N + `latest` 선택,
  `-a`면 develop 포함 전체.
- **R5 관리/릴리즈 포인트 최소화**: 새 아티팩트·릴리즈 의식을 늘리지 않기.
- **R6 (사용자 추가 목표)**: **태그/릴리즈를 쓰지 않고 브랜치 모델 유지**, 그리고
  **브랜치에 push하면 그 브랜치 사용자가 갱신본을 바로 받을 수 있게** (연속 갱신).

---

## 3. 결정 (Decision)

문제를 두 하위 문제로 분리하고 각각 `api.github.com` 밖의 면으로 옮긴다.
**기본 경로에서 `api.github.com` 호출 0건**, 그리고 코드 전체에서 제거.

### D1. 소스 오브 트루스 = 브랜치 (태그/릴리즈 안 씀)
`latest` + 버전 브랜치(`1.0.10`, `1.0.11`, …) + `develop`(숨김). R6대로 릴리즈/태그
컷 없이 브랜치 push만으로 동작. → R5, R6.

### D2. 콘텐츠 = 브랜치 안 committed manifest JSON, 전부 임베드
- 위치(stable): `plugins/weegloo/installer-manifest.json` (nested),
  레거시 폴백 `installer-manifest.json`(루트). 기존 nested/legacy 감지 로직 재사용.
- skill 15 × (`SKILL.md` + `metadata.json`) + rule 5 × `.mdc` = **텍스트 35개를 전부
  inline**. (저장소에 바이너리 자산 0개 확인 → base64 불필요. 추후 바이너리가 생기면
  그 항목만 base64 폴백.)
- CLI는 `raw.githubusercontent.com/<repo>/<branch>/<path>`에서 **1요청**으로 받아
  파싱 → 체크박스 목록 + 선택분 디스크 기록 모두 처리. (raw = core 버킷 밖,
  설치 규모에선 무해.) → R2, R5.
- **스키마(결정론적)** — manifest는 **콘텐츠의 순수 함수**여야 한다. `generatedAt`/`commit`
  같은 **휘발성 필드는 넣지 않는다**: 넣으면 매 빌드마다 값이 바뀌어 D4의
  `git diff --cached --quiet` 멱등 가드가 **영영 성립하지 않고** push마다 빈 갱신 커밋이
  쌓인다. 파일 키 순서도 정렬해 플랫폼/런 간 동일 출력 보장. provenance(언제·어느 커밋)는
  필요하면 git 히스토리에서 유도(파일에 박지 않음).
  ```json
  {
    "schemaVersion": 1,
    "repoContentPrefix": "plugins/weegloo",
    "mcp": { "weeglooUrl": "https://ai.weegloo.com/mcp", "uploadApiUrl": "https://upload.weegloo.com/v1" },
    "skills": [{ "id": "weegloo-web-hosting",
                 "files": { "SKILL.md": "<text>", "metadata.json": "<text>" } }],
    "rules":  [{ "id": "weegloo-web-hosting-rules", "content": "<mdc text>" }]
  }
  ```
- **`.mcp.json` 흡수** — MCP 서버 URL(`weeglooUrl`/`uploadApiUrl`)을 manifest `mcp` 블록에 포함한다.
  그러면 **ref 스코프 데이터(콘텐츠 + MCP 설정)가 한 파일·1 raw 요청으로 통합**되어 별도 `.mcp.json`
  fetch가 사라진다. manifest가 없으면 기존 기본 URL로 폴백. → 호출 합치기는 여기까지가 한계(이유는 D5).
- **바이너리 가드** — 빌드 스크립트는 UTF-8 디코드 불가 파일을 만나면 **실패**(또는 그 항목만
  base64). "바이너리 없음"은 현재 관측이지 영구 보장이 아니므로 **추측에 기대지 않고 빌드 시 강제 검사**.

### D3. 버전 picker = git smart-HTTP `info/refs`
- `GET https://github.com/<repo>.git/info/refs?service=git-upload-pack`.
- 응답(pkt-line)에서 `refs/heads/<name>`만 파싱. **첫 ref 줄 뒤에 붙는 git capability
  문자열을 잘라내야 함**(공백/`\0`에서 stop). 권장 패턴: `/[0-9a-f]{40} refs\/heads\/([^\s\0]+)/g`.
- 받은 전체 브랜치를 기존 필터 로직(develop 숨김 / 버전정렬 / 최신 N / `-a`=전체)에
  그대로 통과. `-a`도 info/refs가 develop까지 주므로 **api 불필요** → api.github.com 완전 제거.
- **폴백은 간단하게** (사용자 결정 b): `info/refs` 실패 시 → `['latest']`. (api/branches로
  되돌리지 않음 — 한도 있는 면으로 폴백하면 의미가 약해지고 복잡도만 늘어남.)

### D4. 갱신 = push 시 Action이 manifest 재생성 후 같은 브랜치에 커밋백
- 트리거: `on: push: paths: ['**/skills/**','**/rules/**']`.
- **PR 강제·브랜치 보호 bypass 안 씀** (사용자 결정). 봇이 직접 push. 필요한 최소 가드 floor:

  | 가드 | 이유 |
  |---|---|
  | `permissions: contents: write` | 봇 push 권한 |
  | 기본 `GITHUB_TOKEN`으로 커밋 | **이 토큰 커밋은 `on:push` 재트리거 안 됨** → 무한루프 1차 차단 |
  | `paths: skills/**,rules/**` | manifest-only 커밋은 트리거 제외 → 루프 2차 차단 |
  | `git diff --cached --quiet && exit 0` | 변화 없으면 no-op(멱등) |
  | `concurrency: {group: manifest-<ref>, cancel-in-progress:false}` + push 전 `pull --rebase` | 연속 push 직렬화 |

- 전제: 배포 브랜치들에 "Restrict who can push"/필수 status check가 **없어야** 봇 push 가능.
- 부가(선택): 커밋 작성자 `github-actions[bot]`, 메시지 `chore(manifest): regenerate`.

### D5. 호출 합치기의 한계 — picker는 왜 분리 유지하나

데이터가 두 종류라 **단일 호출로 못 합친다**:
- **(A) "어떤 버전이 있나"** = 레포 레벨. 유저가 ref를 **고르기 전**에 답해야 함(picker).
- **(B) "이 버전 안에 뭐가 있나"** = ref 스코프. ref를 **고른 뒤** 답함(manifest).

(A)↔(B)는 **닭과 달걀**: ref 스코프 파일을 읽으려면 ref를 먼저 알아야 하는데, ref 목록 발견이 곧 (A)다.
(A)를 단일 정적 파일로 만들려면 **중앙 `versions.json` 인덱스**가 필요 → 크로스 브랜치 유지보수
부활(§5에서 기각) + raw(조여지는 면)에 얹힘 → **회복력 악화**. 따라서:
- **(B) 안은 합친다**: 콘텐츠 + MCP 설정(`.mcp.json`)을 manifest 1파일로 → **ref당 1 raw 요청**.
- **(A)는 분리 유지**: `info/refs`(별도 버킷, 깃이 ref를 공짜로 광고, 유지보수 0).

결과 호출 수 — **인터랙티브: `info/refs`(1) + manifest(1) = 2** (서로 **다른 버킷**이라 한도 공유 안 함 →
오히려 회복력↑) / **CI(`--ref`/`WEEGLOO_REF`): manifest(1) = 1**(picker 스킵). "1 call/1 bucket"보다
"2 calls/2 buckets"가 더 안전하므로 이 2개를 무리해서 합치지 않는다.

### D6. 추상화 — 교체 가능한 소스(전략 체인)

엔드포인트/구현이 바뀌어도 **한 곳만 갈아끼우도록** "소스 = async 함수, 순서대로 시도하는 체인"으로 둔다.
**과설계 금지**: 클래스 계층/DI 프레임워크가 아니라 **함수 + 작은 콤비네이터** 수준.

- **콤비네이터** `firstUsable([s1, s2, …], isUsable)` — 앞에서부터 시도, 첫 "쓸 만한" 결과 반환(에러/빈 결과는 다음 전략으로).
- **VersionSource**(브랜치 목록) 체인 — 새 전략을 **한 줄**로 끼움:
  ```js
  listBranches() = firstUsable([
    // gitLsRemote(),     // ← 미래: git CLI 설치돼 있으면 1순위 (사용자 당부)
    infoRefs(),           // 현재 1순위 (D3)
    () => ['latest'],     // 폴백 (결정 b)
  ], (arr) => arr?.length)
  ```
- **ResourceSource**(콘텐츠+MCP) 체인 — `manifest(ref)` → `rawDefault(ref)`(폴백). **둘 다 동일한 정규화 형태** 반환.
- **정규화 형태 = 설치 측 계약**: 설치 모듈은 `{ skills:[{id,files}], rules:[{id,content}], mcp:{…} }` 만 알고 **출처를 모른다**(fetch ↔ install 디커플). 소스가 바뀌어도 설치 모듈/`index.js` picker는 불변.
- **transport seam**: 모든 HTTP는 주입 가능한 `httpGet(url, {retry})` 한 곳을 통과 → 429/5xx 백오프(§8)와 테스트용 fetch 목킹을 **한 군데**서.

효과: "git client 1순위 + info/refs 폴백" 확장 = **VersionSource 체인 한 줄 추가**. manifest를 CDN/Pages로 이전 = **ResourceSource 전략 1개 교체**. 둘 다 picker/설치 모듈 **무변경**.

---

## 4. 근거 — `info/refs` 실측 (2026-06-06)

`https://github.com/weeglooapi/weegloo-mcp-plugin.git/info/refs?service=git-upload-pack`:

| 관측 | 결과 | 의미 |
|---|---|---|
| 응답 헤더 `x-ratelimit-*` | **없음** | REST core 버킷 밖 (R2) |
| content-type | `application/x-git-upload-pack-advertisement` | git 와이어 프로토콜 (R1 안정) |
| core 버킷 (40+회 호출 후) | 60 → **60** (차감 0) | REST 한도 안 먹음 (R2) |
| 40회 연타 HTTP | **40/40 = 200**, 429 zero | 실사용 한도 무해 (R2) |
| 파싱 결과 | `1.0.10, 1.0.11, 1.0.12, develop, latest` | 현재 picker 모델 그대로 (R4) |
| `cache-control` | `no-cache` | raw와 달리 CDN 캐시 없음 → **브랜치 목록 항상 최신** |

R3(검증된 패턴): `info/refs`는 모든 `git clone`이 때리는 면이라 GitHub이 대규모로
서빙. git 와이어 프로토콜은 REST API보다 더 오래 안정적.

---

## 5. 기각된 대안 (Alternatives & why not)

| 대안 | 기각 이유 |
|---|---|
| **Design D — Releases + Pages `versions.json`** (PR #16, 이미 구현/검증됨) | 계약은 최강(R1/R3 우수)이나 **태그/릴리즈로 소스 이동 + gh-pages·Pages 설정·릴리즈 컷 의식**이 R5/R6에 역행. 결정적으로 **"push 즉시 반영"(R6)을 못 줌** — 콘텐츠가 릴리즈에 핀됨. 사용자가 명시적으로 브랜치+연속갱신을 원해 비채택. |
| **api.github.com + GITHUB_TOKEN** (PR #15, 임시방편) | 60→5000/hr이지만 엔드유저는 토큰이 없음. 토큰 동봉=유출, 입력 요구=UX 파탄. R2 미충족. |
| **`releases.atom` / `tags.atom` 피드** | rate limit은 없으나 **비공식·니치 contract**(포맷 보장 X, draft 조기 노출). R1 약한 고리. |
| **`codeload.../tar.gz/<ref>`** | api 밖이고 브랜치 그대로 쓰지만 **전체 트리 다운로드(낭비)** + 클라 파싱. manifest가 더 깔끔. (rate-limit 실측 미검증이라 의존 보류.) |
| **npm 패키지에 콘텐츠 번들** | 네트워크 0이지만 **콘텐츠↔CLI 버전 결합** — 사용자가 명시적으로 거부했던 하드 요구. |
| **중앙 `branches.json` 인덱스(한 브랜치에 커밋)** | picker용 인덱스를 별도 유지 = **크로스 브랜치 쓰기/삭제 미반영** 등 fragile. `info/refs`가 git이 이미 광고하는 ref를 쓰므로 인덱스 자체가 불필요. |

---

## 6. 결과 (Consequences)

**좋아지는 것**
- 기본/`-a` 모든 경로에서 `api.github.com` 0건 → rate-limit silent degradation 제거.
- 브랜치 모델·picker 동작 100% 유지(R4), 릴리즈 의식 0(R5/R6).
- push → (raw 캐시 한도 내) 갱신본 반영(R6). picker 목록은 info/refs `no-cache`라 즉시 최신.
- 콘텐츠 fetch가 N요청 → **1요청**.

**받아들이는 트레이드오프**
- 생성물(manifest)을 브랜치에 커밋 → **히스토리에 봇 커밋 노이즈**.
- `raw`는 ~5분 CDN 캐시 + 고부하 시 429 가능(별도 느슨한 버킷). 설치 규모에선 무해하나
  Pages-Fastly(Design D)보단 약간 덜 단단함 — 브랜치 기반 받는 대가로 수용.
- **워크플로 YAML이 모든 배포 브랜치에 존재해야** push 트리거 동작(`latest`에서 분기한
  새 버전 브랜치는 상속). 워크플로 수정 시 활성 브랜치 전파 필요.
- `info/refs` pkt-line 파서(capability 문자열 절단) 한 조각 추가.

---

## 7. 구현 항목 (Open / PoC)

1. `installer-cli/src/github.js`
   - **transport** `httpGet(url, {retry})` 한 곳 — 429/5xx 백오프(§8 raw 행) + 테스트 fetch 목킹 지점.
   - **`firstUsable(strategies, isUsable)`** 콤비네이터(첫 "쓸 만한" 결과 반환).
   - **VersionSource** `listBranches()` = `firstUsable([infoRefs, () => ['latest']])` — info/refs 파서(capability 절단). 구 `fetchBranches`/`api.github.com` 상수/`fetchContentsJson` 제거.
   - **ResourceSource** `loadResources(ref)` = `firstUsable([manifest(ref), rawDefault(ref)])` → 정규화 `{skills,rules,mcp}` 반환. 구 `fetchResourceLists`/per-file `downloadFile`/`fetchMcpConfig` 흡수.
   - 파일 분리(`src/sources/`)는 **구현 재량** — D6 seam(콤비네이터·두 소스·정규화 형태·transport)만 지키면 됨.
2. `installer-cli/src/index.js` 및 `claude.js`/`cursor.js`/`codex.js`/`antigravity.js`
   - `listBranches()`/`loadResources()`의 **정규화 형태만 소비**(선택분 content 디스크 기록, MCP는 `mcp`). **출처 비의존** → 소스 전략 교체 시 picker·설치 모듈 무변경.
3. 빌드 스크립트 `scripts/build-installer-manifest.mjs` — skills/rules(+브랜치 `.mcp.json` → `mcp` 블록) → manifest JSON.
4. 워크플로 `.github/workflows/installer-manifest.yml` — D4 가드 floor 포함, 모든 배포 브랜치에 배치.
5. 테스트 — info/refs 파서(capability/`\0` 케이스), manifest 생성/소비.
6. 기존 활성 브랜치에 manifest 1회 백필.

---

## 8. 의존성 계약 & 리스크 레지스터

각 외부 의존이 **어디까지 안전한지**를 등급으로 명시한다. 핵심은 *"문서로 보장된 것(A/B)"* 과
*"관측으로만 확인했고 정책 변경에 취약한 것(C/D)"* 을 섞어 쓰지 않는 것.

**등급**
- **A. 명시적 계약(문서/스펙)** — 공식 문서·표준 스펙이 동작을 보장.
- **B. 우리 계약** — 우리가 정의·버전 관리. 외부 의존 0 (최강).
- **C. 사실상 안정(de-facto)** — 광범위 사용으로 안정적이나 공식 SLA/스펙 없음.
- **D. 관측 기반 가정** — 실측으로 확인했으나 문서 보장 아님. **정책 변경에 취약.**

| 의존 | 우리가 기대는 것 | 등급 | rate-limit 상태 | 틀리면(리스크) | 완화/폴백 |
|---|---|---|---|---|---|
| `info/refs?service=git-upload-pack` | 응답에서 `refs/heads/*` 추출 | **포맷 A** (git http/pack-protocol 스펙) · **한도 D** | 헤더 없음·80/80 200·core 불변 *관측*(2026-06-06). "git smart-HTTP 무인증 무한도"는 **GitHub 문서 보장 아님** | ① 기본이 protocol **v2 광고**로 바뀌면 형식 달라져 파서 0개 ② abuse/2차 한도로 throttle ③ 특이 ref명 | 폴백 `['latest']`(결정 b) · 0개면 폴백 · 정규식은 관대하게 |
| `raw.githubusercontent.com/<repo>/<ref>/<path>` | manifest 1요청, `.mcp.json`, (폴백 시) DEFAULT 파일 | **C** (사실상 안정, 공식 SLA 없음) · **한도 D** | core 버킷 밖은 검증됨. 자체 한도 **문서 미공개**, **2025-05 강화 후 실제 429 전례**(아래 증거). ~5분 캐시 TTL도 관측치 | 고부하/공유 IP에서 429 → 콘텐츠 설치 실패. **raw는 토큰으로 한도 못 올림** | 설치당 1요청(노출 최소) · 429 시 짧은 백오프 재시도(권장) · 최후엔 CDN 미러(jsDelivr/statically) 또는 자체 호스팅 |
| manifest 파일·스키마 | `{schemaVersion, repoContentPrefix, skills, rules}` | **B** (우리 계약, `schemaVersion`) | 해당 없음 | 생성기↔CLI 스키마 드리프트 | 동일 repo + `schemaVersion` 게이트 |
| Actions: 기본 `GITHUB_TOKEN` 커밋이 워크플로 **재트리거 안 함** | D4 무한루프 1차 차단 | **A** (Actions 공식 문서) | 해당 없음 | **PAT로 바꾸면 보장 깨짐 → 루프** | 기본 토큰 고수(문서화된 가드) |
| Actions: `on:push paths` / `concurrency` / checkout push | D4 트리거·직렬화·push | **A** (모두 문서화) | 해당 없음 | 낮음 | — |
| skills/rules에 **바이너리 없음** | 텍스트 임베드 안전 | **D→빌드 강제검사로 격상** | 해당 없음 | 미래 바이너리 자산 → JSON 임베드 깨짐 | 빌드 스크립트가 비-UTF8 감지 시 **실패/그 항목 base64** |
| 워크플로 YAML이 **모든 배포 브랜치 존재** | push 트리거 동작 | **A** (push는 해당 브랜치 YAML 사용) | 해당 없음 | 전파 누락 시 그 브랜치 갱신 안 됨 | 런북에 전파 절차 명시 |

### 실세계 증거 — bazarr #3057 (2025-10-24, CLOSED)

`raw.githubusercontent.com`이 **2025-05-08 무인증 한도 강화**([changelog](https://github.blog/changelog/2025-05-08-updated-rate-limits-for-unauthenticated-requests/)) 이후
실제로 **HTTP 429**를 반환한 사례(<https://github.com/morpheus65535/bazarr/issues/3057>). 확정된 사실:
- raw는 **인증 헤더로 한도 상향 불가**(공개 콘텐츠는 토큰 무시) — 올리려면 `api.github.com/contents`(=다시 60/hr core).
- 한도는 **공개 IP당** → NAT/CI 공유 IP에서 증폭.
- bazarr 해결책: jsDelivr/`statically.io` CDN 또는 자체 캐시 미러. **단 브랜치-포인팅 URL은 CDN 캐시 지연**(우리 "push→fresh" 목표와 상충).

### api 대비 실제 한도 수치 (확정 vs 미공개)

| 면 | 무인증 한도 | 출처/신뢰도 | 인증으로 상향? |
|---|---|---|---|
| `api.github.com` (REST core) | **60/hr · IP당** | **문서화 + 실측 확정** | ✅ 5,000/hr (PAT) |
| `raw.githubusercontent.com` | **공개 숫자 없음**. 평상시 60보다 훨씬 높지만(파일 CDN) **유한·공격적·IP당** | 2025-05 changelog가 강화는 명시하되 **수치 미발표** · 성공 응답에 `x-ratelimit-*` 없음(실측) · `cache-control: max-age=300`(=5분, 실측) · Fastly 서빙 | **❌ — raw는 인증을 API처럼 인정 안 함. CI 토큰 워크플로도 429 다수 보고**(Sublime Package Control 등) |
| `info/refs` (clone over HTTPS) | **공개 숫자 없음** | changelog 강화 대상에 "cloning over HTTPS" **명시 포함** · 실측 80/80=200(우리 볼륨에선 여유) | 해당 없음(우리는 무인증) |

요지: **"api 60/hr"만 확정 수치**다. raw/`info/refs`는 GitHub이 **숫자를 공개하지 않으며**, raw는 별도 버킷이라 평상시엔 60보다 훨씬 관대하지만 **(a) 유한하고 (b) 인증으로 못 올리고 (c) IP당이라 공유 IP에서 증폭**한다. 그래서 "raw가 넉넉하니 안전"은 *추측*으로만 두고, 표 §8의 폴백/백오프로 방어한다.

**인접 면의 알려진 수치(경계 가늠용 — raw의 직접 수치는 아님):**

| 면 | 수치 | 성격 |
|---|---|---|
| REST core 무인증 | 60/hr | 문서 (하한 가족) |
| github.com **blob/tree** HTML 뷰 | **~4/min** | 커뮤니티 실측, 가장 빡셈([community #158213](https://github.com/orgs/community/discussions/158213)). raw 아님(스크래핑 표적 면) |
| REST 2차("content-generating") | 80/min · 500/hr | 문서화된 secondary limit (raw 아님) |
| Git LFS | 무인증 300/min · 인증 3,000/min | 문서, 별도 버킷 |

→ 가장 빡센 추정치(4/min)를 raw에 갖다 대도 **설치당 1요청**이면 한참 아래. 500/hr 가정 시 한 IP에서
~250설치/hr까지 여유. raw는 **고정 쿼터가 아니라 적응형 anti-scraping** 한도라 깔끔한 수치가 없는 것.
(우리는 raw 임계를 **abuse 트래픽으로 직접 측정하지 않는다** — 그게 GitHub이 조이는 행위이고 작업 IP를 태움.)

**우리 노출이 bazarr보다 낮은 이유**(그러나 0은 아님):
- bazarr = **상주 데몬 주기 폴링 + 한 IP의 여러 툴**. 우리 = **1회성 CLI, 설치당 raw ~1요청**(manifest; `.mcp.json` 흡수).
- 새 설계는 picker를 raw 아닌 `info/refs`로, 콘텐츠를 per-file N → **manifest 1요청**으로 줄여 **기존 대비 raw 노출 감소**.
- **잔존 리스크 = 공유 IP 대량 설치(사내 NAT/CI)**. → 위 표의 백오프 재시도 + (필요 시) CDN 미러 escape hatch로 방어. 설계 변경 불요, 단 **알고 수용**.

---

## 9. 가정·미확인 — "나중에 틀릴 수 있는 것" (재검토 트리거)

아래는 **문서 보장이 아니라 관측/추측**에 기댄 항목. 트리거 발생 시 즉시 재검토:

- **info/refs 무인증 비-throttle** = 관측(2026-06-06), 비문서. 2025-05 강화는 "무인증 github.com 전반" 대상이라 **git smart-HTTP가 면제라는 보장 없음**. → **재검토 트리거**: 설치 중 picker 단계 429/타임아웃 보고, 또는 GitHub이 git-over-HTTP 한도 공지.
- **info/refs가 plain GET에 v0/v1 광고 반환** = 오늘 관측. → **재검토 트리거**: 파서가 0 브랜치 반환(= v2 전환 의심) → pkt-line v2 `ls-refs` 파싱 추가.
- **raw ~5분 캐시 TTL** = 관측치. → 사용자에게 "즉시 반영"이라 **약속 금지**("최대 수분" 표현).
- **raw 비폐기 + 우리 규모에서 비-429** = de-facto + 빈도 논리. → **재검토 트리거**: 설치 중 raw 429 보고 누적 → 백오프 재시도 기본 활성 → 임계 초과 시 CDN 미러/자체 호스팅 검토(= Design D의 Pages 회귀도 옵션).
- **측정 원칙**: raw/`info/refs` 임계는 **abuse 트래픽으로 직접 재지 않는다**(그게 GitHub이 조이는 스크래핑 행위 + 작업 IP를 태움). 인접 면 수치(§8)로 경계만 추정하고, 실제 방어는 폴백/백오프/모니터링으로.
- **원칙**: 표의 **A/B 등급만 "안전하다"고 단정**한다. **C/D 등급은 "폴백으로 방어 + 모니터링"** 전제로만 의존하고, 단독 신뢰하지 않는다.

### 검증 로그
- 2026-06-06 `api.github.com/branches`: `x-ratelimit-resource: core`, 60→59 (core 버킷 확정).
- 2026-06-06 `info/refs` ×80: 80/80 → 200, `x-ratelimit-*` 없음, core 불변, 파싱 결과 `1.0.10/1.0.11/1.0.12/develop/latest`.
- 2025-10 (외부) bazarr #3057: raw 429 실사례 — raw는 C/D 등급임을 재확인.
