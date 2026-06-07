# 인스톨러 네트워크 엔드포인트 인벤토리

`npx weegloo`(installer-cli)가 **무엇을 받기 위해 어떤 엔드포인트를 호출하는지**의 인벤토리.
각 엔드포인트의 **계약 안정성·rate-limit·리스크** 요약은 §4 참조.

- as-is = 기존 코드 (`api.github.com` 사용, rate-limit 문제 있음)
- to-be = 변경 적용 후 (branch-native manifest + git `info/refs`)

> 줄 번호는 작성 시점(2026-06-06) 기준. 코드 변경 시 함께 갱신.

---

## 요약 — 기존 대비 무엇이 바뀌나 & 왜 이 엔드포인트인가

| 받는 것 | 기존 (as-is) | 변경 (to-be) | **왜 바꿨나 (기존 메서드/엔드포인트 대비)** |
|---|---|---|---|
| 버전 목록(picker) | `GET api.github.com/.../branches` (REST, **core 60/hr**) | `GET github.com/<repo>.git/info/refs?service=git-upload-pack` (git smart-HTTP) | 기존은 **60/hr 하드캡** → 소진 시 picker 빈 목록(silent degradation, 최초 버그). 신규는 **core 버킷 밖**(실측 80/80=200, `x-ratelimit-*` 없음) + **git 와이어 프로토콜 = 문서화 스펙(안정)** + **유지보수 0**(깃이 ref를 자동 광고 → 중앙 인덱스·태그 불필요) |
| skill/rule **목록** | `GET api.github.com/.../contents` (REST, **core 60/hr**, 2~4회) | manifest 1요청에 목록 포함 (raw) | 기존은 같은 **60/hr 버킷을 호출 2~4개**로 더 빨리 소진. 신규는 **api 0 + 목록을 1요청에 통합** |
| skill/rule **콘텐츠** | `raw` per-file **N개** 개별 다운로드 | manifest 1요청에 콘텐츠 임베드 (raw) | **N요청 → 1요청**, raw 노출↓, **원자적 스냅샷**(파일별 부분 실패 없음) |
| MCP 설정 | `GET raw .../.mcp.json` 별도 1요청 | manifest `mcp` 블록에 흡수 | ref 스코프 데이터를 한 파일로 → 공통 플로우 **raw 2→1** |

**순효과:** `api.github.com` **3~5 → 0** (60/hr 하드캡·silent degradation 제거) · 총 네트워크 호출 **`N+4~6` → 2**(인터랙티브: info/refs + manifest, **서로 다른 버킷**) / **1**(CI, picker 스킵).

**왜 더 합치지 않았나 / 무엇을 안 골랐나:**
- picker(레포 레벨)와 manifest(ref 스코프)는 **닭-달걀**이라 1호출로 못 합침 — ref 스코프 파일을 읽으려면 ref를 먼저 알아야 하는데, 그 ref 목록을 발견하는 게 곧 picker다.
- 태그/릴리즈·`atom` 피드·`codeload tar.gz`·npm 번들·중앙 `branches.json`은 기각 — 각각 릴리즈 의식↑ / 비공식 계약 / 전체 트리 다운로드 / 콘텐츠↔CLI 버전 결합 / 크로스브랜치 유지보수 부담.
- 각 엔드포인트의 계약 안정성·rate-limit 등급은 §4 참조.

---

## 1. 현재 (as-is)

| # | 받는 것 | 메서드·엔드포인트 | 호스트 / rate-limit 버킷 | 호출 위치 | 설치 1회당 |
|---|---|---|---|---|---|
| 1 | 버전 목록(picker) | `GET /repos/{repo}/branches?per_page=100` | **api.github.com** (core 60/hr) | `github.js:66` ← `index.js:61` | 1 |
| 2 | skill/rule **목록** | `GET /repos/{repo}/contents/{path}?ref={ref}` | **api.github.com** (core 60/hr) | `github.js:36` ← `fetchResourceLists github.js:178` ← `index.js:213` | 2~4 |
| 3 | MCP 설정 | `GET /{repo}/{ref}/plugins/weegloo/.mcp.json` (→ 루트 `.mcp.json` 폴백) | raw.githubusercontent.com | `github.js:118` ← `claude:69 / cursor:84 / codex:186 / antigravity:76` | 0~1 |
| 4 | skill **파일** | `GET /{repo}/{ref}/{prefix}/skills/{id}/{SKILL.md, metadata.json}` | raw.githubusercontent.com | `downloadFile github.js:210` ← `claude:114 / cursor:129 / codex:223 / antigravity:120` | 선택 skill ×2 |
| 5 | rule **파일** | `GET /{repo}/{ref}/{prefix}/rules/{id}.mdc` | raw.githubusercontent.com | `downloadFile github.js:210` ← `claude:141 / cursor:156 / codex:248 / antigravity:150,164` | 선택 rule ×1 |

- `{repo}` = `weeglooapi/weegloo-mcp-plugin`, `{prefix}` = `plugins/weegloo`(nested) 또는 `''`(legacy).
- #1·#2가 **rate-limit 주범** — 둘 다 무인증 60/hr core 버킷 공유. 소진 시 picker 빈 목록 + DEFAULT 폴백(silent degradation).
- #2 횟수: nested 레이아웃이면 skills+rules = 2회, legacy 폴백까지 타면 최대 4회(nested skills 1 probe + legacy skills + legacy rules 등).

**설치 1회당 합계 (default 경로):** api core **3~5** + raw `1 + (skill×2 + rule×1)`.

---

## 2. 변경 후 (to-be)

| # | 받는 것 | 메서드·엔드포인트 | 호스트 / 버킷 | 비고 |
|---|---|---|---|---|
| 1 | 버전 목록(picker) | `GET /{repo}.git/info/refs?service=git-upload-pack` | **github.com** git smart-HTTP (**core 버킷 밖**) | `-a`도 동일(develop 포함 전체를 받아 클라에서 필터). 실패 시 폴백 `['latest']` |
| 2 | skill/rule **목록 + 콘텐츠** | `GET /{repo}/{ref}/plugins/weegloo/installer-manifest.json` (→ 루트 폴백) | raw.githubusercontent.com | **1요청으로 목록+전체 콘텐츠 임베드** → #4·#5(per-file 다운로드) 제거 |
| 3 | MCP 설정 | manifest `mcp` 블록에 **흡수**(런타임 별도 fetch 없음) | — | 빌드 시 브랜치 `.mcp.json` → manifest. 없으면 기본 URL |
| 4 | manifest 못 받을 때 | **없음 — fail fast**(에러 + `exit 1`) | — | `loadResources`→null → 조용한 degradation 금지 |

**설치 1회당 합계 (default 경로):** api core **0** + info/refs **1** + raw **1**(manifest = 콘텐츠 + MCP 설정 통합). CI(`--ref`/`WEEGLOO_REF`)면 picker 스킵 → 총 raw **1**.

---

## 3. before / after 호출 요약

| 버킷 | as-is (설치 1회) | to-be (설치 1회) |
|---|---|---|
| `api.github.com` (core 60/hr, **하드**) | **3~5** | **0** |
| `info/refs` (git smart-HTTP, core 밖) | 0 | 1 |
| `raw` (별도·미공개 한도, core 밖) | 1 + N(파일들) | **1** (manifest; `.mcp.json` 흡수) |

→ rate-limit 하드캡(60/hr)을 먹던 호출을 **전부 제거**하고, raw도 N요청 → 1~2요청으로 축소.

---

## 4. 각 엔드포인트가 의존하는 응답 계약 (우리가 파싱하는 것)

> 등급: **A**=문서/스펙 계약, **B**=우리 계약, **C**=사실상 안정(SLA 없음), **D**=관측 기반(문서 보장 아님).

- **`/branches`** (as-is) — JSON 배열, `[].name`(브랜치명)만 사용. *(api core, REST 문서 계약)*
- **`/contents/{path}`** (as-is) — JSON 배열, `[].type`(`dir`/`file`) + `[].name`. *(api core, REST 문서 계약)*
- **`info/refs`** (to-be) — `application/x-git-upload-pack-advertisement` pkt-line 텍스트. 정규식 `[0-9a-f]{40} refs/heads/<name>`로 브랜치 추출(**첫 ref 줄의 capability 문자열은 `\0`/공백에서 절단**). *(포맷=git 프로토콜 스펙=A, 한도=관측=D)*
- **`installer-manifest.json`** (to-be) — **우리 스키마(B)**: `{ schemaVersion, repoContentPrefix, mcp:{weeglooUrl,uploadApiUrl}, skills:[{id, files:{name:content}}], rules:[{id, content}] }`. 휘발성 필드 없음(멱등성).
- **`.mcp.json`** — (as-is) 별도 raw fetch로 `mcpServers.weegloo.url` + `mcpServers['weegloo-upload'].env.UPLOAD_API_URL` 읽음. (to-be) **빌드 시 manifest `mcp` 블록으로 흡수** → 런타임 별도 fetch 제거. 없으면 기본 URL.
- **raw 파일 본문** — 텍스트 그대로 디스크 기록.

---

## 5. 참고

- 호출 그래프 진입점: `installer-cli/src/index.js` `main()` → 버전 선택(#1) → IDE 선택 → 설치 옵션 → (MCP면 #3) → (skills/rules면 #2, 이후 #4·#5).
- 코드: `installer-cli/src/github.js`(네트워크 전부) + `installer-cli/src/{claude,cursor,codex,antigravity}.js`(설치/쓰기).
- 결정 배경·대안·트레이드오프·리스크 레지스터: PR 설명 참조.
