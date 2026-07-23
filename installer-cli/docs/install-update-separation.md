# 설치/업데이트 분리 설계 (`--update`)

`npx weegloo`의 **설치와 업데이트를 분리**하고, 업데이트가 **사용자의 브랜치·스킬/룰 선택을 보존**하면서
**에이전트별로 정확하게** 최신 상태를 추적하도록 하는 설계.

> 줄 번호는 작성 시점(2026-07-23) 기준. 코드 변경 시 함께 갱신.

---

## 1. 배경 — 고치는 버그 3개

| # | 버그 | 원인 | 결과 |
|---|---|---|---|
| B1 | **업데이트가 전체 재설치** | 안내 커맨드가 install 폼 + `--yes` → 비대화 모드는 무조건 전체 설치 (`index.js:446-447,458-459`), 이전 선택을 복원하는 경로 없음 | 부분 선택 사용자의 선택이 파괴되고 `installed.json`이 전체 목록으로 덮어써져 **선택 정보 영구 소실** |
| B2 | **버전 추적이 브랜치 무시** | 스탬프에 쓰는 버전이 브랜치 매니페스트(`resources.version`)가 아니라 전역 latest(`loadCurrentVersion()`, `index.js:489`) · 룰의 체크 GET도 `?branch=` 없음 | 비-latest 브랜치 사용자에게 무의미한 알림 → 재설치해도 콘텐츠 변화 0(churn). 브랜치는 룰에 구운 커맨드 문자열(`--branch <ref>`)에만 존재하고 구조화 저장 안 됨 |
| B3 | **에이전트 간 추적 간섭** | stamp/record가 **scope 공유**(`~/.weegloo/version-check.json` 등, agent 구분 없음 — `self-update.js:56,137`) | (a) B 설치가 공유 스탬프를 최신으로 덮어써 **A의 stale 감지가 죽음** (A/B 문제) (b) 설치 순서에 따라 **남의 룰 삭제** — antigravity 5개 설치 후 codex 3개 설치 시 공유 기록 diff가 D,E를 stale로 판단해 공유 `AGENTS.md`에서 제거 |

## 2. 목표 — 사용자 스토리

> 에이전트에서 weegloo를 쓰다가 새 버전이 나오면 → 세션의 첫 weegloo 요청 때 노티 한 줄 + 커맨드 →
> 복붙 실행 → **그 에이전트만, 쓰던 브랜치 그대로, 골랐던 스킬/룰 그대로** 갱신.
> 신규 항목은 자동 추가, upstream에서 없어진 항목은 정리, 필수 룰은 항상 유지. **질문 없이 완주.**
> 다른 에이전트는 각자 쓰일 때 각자 알아서 노티.

노출 커맨드 (룰에 구움 — **`--yes` 없음**, TTY 감지가 사람/기계 구분):

```
npx weegloo@latest --agent <agent> --branch <ref> --location <scope> --update
```

## 3. 핵심 결정과 근거

| 결정 | 내용 | 왜 (기각한 대안 포함) |
|---|---|---|
| 업데이트 진입 | **`--update` 플래그**로 install과 분리 | install+`--yes` 겸용이 B1의 근원. 설치는 "없는 걸 깖", 업데이트는 "있는 걸 갱신" — 의미가 다름 |
| 업데이트 모델 | **agent-specific** (`--agent` 필수) | fan-out(스코프 일괄) 기각 — 탐지/순회/부분실패/`--branch` 오버라이드 애매함이 늘고, per-agent 추적이 있으면 correctness는 동일. 각 에이전트의 룰이 자기 커맨드를 안내하므로 다른 에이전트도 쓰일 때 알아서 따라옴 |
| 추적 단위 | **per-agent** (stamp/record/catalog 모두) | B3의 유일한 해법. ground truth(설치 파일)가 per-agent인데 버전 신호가 공유 스칼라 하나면 **어떤 업데이트 모델로도** 정합 불가 |
| 브랜치 | **설치한 브랜치 유지** (latest 강제 기각) | 버전 엔드포인트가 `?branch=` 지원 → 브랜치별 정확한 비교 가능. latest 강제는 사용자의 의도적 pin을 조용히 깨뜨림 |
| 버전 소스 | 스탬프 = **브랜치 매니페스트 `resources.version`** · 체크 = **`VERSION_URL?branch=<ref>`** | B2 픽스. 비교가 같은 소스(그 브랜치의 버전) 간 apples-to-apples가 됨 |
| 선택 보존 | `selected` = **디스크에서 복원** (기록이 아니라) | 디스크가 "무엇이 설치돼 있는가"의 사실 그 자체. 기록 유실/pre-record 설치에도 동작 |
| 신규 판별 | 기록에 **카탈로그(`available*`) 스냅샷** 추가 | "선택한 것"만으로는 (a) 진짜 신규 vs (b) 사용자가 뺀 것을 **구분 불가** — 매니페스트에 항목별 추가시점 메타데이터 없음(항목=id+content뿐), 버전은 불투명 해시라 순서 비교 불가. "그때 제공됐던 목록"이 유일한 판별 키 |
| 설치 동작 | **불변** (비대화=전체, 대화형=체크박스) | 신규 설치 UX 유지. 단 기록만 확장(`available*`, `ref`) |
| MCP | **안 건드림** (`--update`는 skills/rules만) | 원격 `weegloo` MCP는 항상 최신(재설치 무의미), `weegloo-upload`는 npx라 실행 시 최신 → 토큰 불필요, 완전 무인 가능 |
| 코어 룰 | **`weegloo-version` + `weegloo-terms-consent` 강제** (선행 태스크) | `weegloo-version`: 자기참조 — 빠지면 업데이트 노티 자체가 사라져 복구 경로가 구조적으로 죽음. `weegloo-terms-consent`: 약관 게이트가 클라이언트(룰) 측 집행이라 빠지면 게이트 소멸 — 운영 결정. `weegloo-global-rules`는 구조적 필연이 없어(품질 선호일 뿐) **강제하지 않음** |
| 마이그레이션 | 기존 사용자 **전체설치 1회 감수** | 기존 룰에 박힌 옛 커맨드(install 폼)가 새 인스톨러로 1회 전체 설치 → 선택 리셋. 이를 막으려면 비대화 install 경로도 수정해야 하나 범위 대비 이득이 작아 기각 |

## 4. 데이터 모델 — per-agent 분리

```
global :  ~/.weegloo/<agent>/version-check.json , ~/.weegloo/<agent>/installed.json
project:  <project>/.weegloo/<agent>/version-check.json , …/installed.json
```

```jsonc
// version-check.json (스탬프 — 룰이 매 체크마다 재작성)
{
  "version": "<브랜치 매니페스트 버전>",   // B2 픽스: latest 아님
  "ref": "<설치 브랜치>",                 // 신규 — 업데이트가 브랜치를 알 유일한 구조화 저장소
  "last_check": "<ISO-8601 local>"
}

// installed.json (기록 — 인스톨러만 씀)
{
  "skills": ["...선택된 것..."],
  "rules": ["...선택된 것..."],
  "availableSkills": ["...설치 시점 카탈로그 전체..."],   // 신규 — 신규 판별 키
  "availableRules": ["..."]
}
```

- **레거시 공유 경로**(`~/.weegloo/*.json`)에는 **더 이상 쓰지 않음**(읽지도 않음 — 파일은 방치).
  이유: 새 설치가 레거시 스탬프를 계속 갱신하면 **미마이그레이션 에이전트의 옛 룰이 그걸 읽고
  "최신"으로 오판**해 영영 노티를 못 받음. 쓰기를 끊으면 옛 룰이 stale 스탬프를 보고 정상적으로
  업데이트를 촉구 → 자연 마이그레이션.
- 룰의 스탬프 재작성 지시 변경 필수: **`version`·`last_check`만 갱신, 나머지 필드(특히 `ref`)는
  전부 보존** — 빠지면 룰이 첫 체크 때 `ref`를 유실해 이후 `--update`가 브랜치를 모르게 됨.

## 5. 업데이트의 집합 연산

```
selected = 디스크 ∩ upstream카탈로그          # 선택 복원 — 디스크가 진실 (기록 아님)
new      = upstream \ prevAvailable           # 진짜 신규만 (제안된 적 없던 것)
add      = (selected ∩ upstream) ∪ new ∪ CORE # 이번에 설치
remove   = (디스크 ∩ prevAvailable) \ upstream # 카탈로그로 검증된 것만 삭제
```

- `prevAvailable` 부재(마이그레이션 첫 사이클): **new도 remove도 ∅** — selected만 재동기화하고
  카탈로그 스냅샷만 기록 → 다음 사이클부터 정확. (카탈로그 없이 add/remove하면 "사용자가 뺀 것"이
  전부 신규로 오인되거나, 사용자 자체 파일을 지울 위험)
- 사용자 자체 제작 파일(`weegloo-foo` 등)은 카탈로그에 없으므로 어느 집합에도 안 들어감 →
  **절대 건드리지 않음** (기존 `SAFE_ID` 가드도 그대로 재사용).
- 순환 의존 해소(2단계): ① 설치 여부 감지는 카탈로그 없이 `weegloo-` prefix 휴리스틱으로(값쌈),
  ② 파괴적 연산(add/remove)은 매니페스트 로드 **후** 카탈로그 교집합으로만.

## 6. 업데이트 플로우

1. **agent/scope/ref 확정** — ref 우선순위: `--branch` 플래그(커맨드에 구워짐) > per-agent 스탬프의
   `ref` > `latest` (fallback).
2. **`loadResources(ref)`** → 카탈로그 + 목표 버전(`resources.version`). fetch 실패 →
   **아무것도 안 건드리고 중단** (반쪽 업데이트 금지).
3. **설치 여부 감지** — 에이전트 skills 디렉터리의 `weegloo-*` 존재. 없으면 **no-op + 설치 안내**
   (install로 폴백 금지 — 그게 B1의 원인).
4. §5 집합 연산 → `add` 쓰기 / `remove` 제거 (기존 `removeSkillDirs` / `removeRuleFiles` /
   마커 제거 재사용).
5. **공유 파일 충돌 체크** (§7).
6. per-agent 기록(`selected`+`available`) / 스탬프(`version`, `ref`, `last_check`) 갱신 —
   **성공 시에만**.
7. 결과 보고(유지/추가/삭제 건수). MCP 무변경. **멱등** — 이미 최신이어도 재동기화(수동 삭제
   드리프트 복구).

### TTY 매트릭스

| 실행 방식 | 동작 |
|---|---|
| 사용자가 복붙 (TTY) | 질문 없이 완주. 충돌(§7) 때만 질문 1개 |
| 에이전트/CI (비-TTY, `cli.js:123`의 `!isTTY` 감지) | 완전 무인. 충돌 시 경고 + 기본값 진행 |

update 모드는 물어볼 게 원래 없음(브랜치·에이전트·스코프=플래그, 선택=디스크, 토큰=불필요) →
`--yes` 불필요. 오히려 넣으면 사람이 복붙했을 때 충돌 질문까지 막아버려서 **뺌**.

## 7. 공유 `AGENTS.md` 충돌 (project 스코프)

**구조**: project 스코프에서 codex / antigravity / androidstudio는 `<cwd>/AGENTS.md` **한 파일**에
룰을 저장하고, 마커(`<!-- weegloo:<ruleId> -->`)에 **에이전트 구분이 없음** (`codex.js:227`).
per-agent 분리는 **추적(메타데이터)** 이지 **룰 본체가 아님** — 본체 공유는 구조적으로 불가피.
(global은 codex=`~/.codex/AGENTS.md`, antigravity=`~/.gemini/GEMINI.md`로 파일이 달라 무관.)

- 쓰기는 룰 id별 마커 upsert(합집합)라 파일 전체를 갈아엎지 않음. 겹치는 룰의 **내용**은
  last-writer-wins.
- B3-(b)의 "남의 룰 삭제"는 per-agent 기록 분리로 해소 — 각 에이전트의 remove diff가 **자기
  기록만** 보게 됨.
- 남는 건 **브랜치가 다른 두 에이전트**가 같은 마커 내용을 두고 겨루는 경우뿐:

| 상황 | 처리 |
|---|---|
| 공유 에이전트들의 ref 동일 | 충돌 아님 — 그냥 진행 (같은 브랜치의 더 새 버전은 양쪽 모두 이득) |
| ref 다름 / 상대 ref 불명 + TTY | 질문: **내 브랜치로 덮어쓰기 / 공유 룰만 건너뛰기 / 중단** |
| ref 다름 / 불명 + 비-TTY | **경고 + 실행 중인 에이전트의 브랜치로 진행** (last-writer-wins — 현행 설치 의미 유지) + "브랜치 통일 권장" 문구 |

- 감지: 마커 쓰기 전에 같은 파일을 쓰는 **다른 에이전트의 per-agent 스탬프**에서 ref 확인.
  상대가 마이그레이션 전(스탬프 없음)이면 skills 디렉터리로 존재만 감지 → "ref 불명" 충돌 취급.
- 한계(정직하게): 두 에이전트가 번갈아 업데이트하면 공유 파일이 브랜치 사이를 핑퐁함.
  "파일 하나, 브랜치 둘" 구조상 근본 해결은 사용자가 브랜치를 맞추는 것뿐 → 경고로 안내.

## 8. 마이그레이션 (전체설치 1회 감수)

1. 기존 사용자의 룰에는 **옛 커맨드**(install 폼 + `--yes`)가 박혀 있음.
2. 노티를 받고 그걸 실행 → `npx weegloo@latest`가 **새 인스톨러**를 받아 비대화 install →
   **전체 설치 1회** (부분 선택 사용자는 이 시점에 선택이 "전체"로 리셋 — 감수).
3. 이 설치가 새 룰(`--update` 커맨드), per-agent 스탬프(`ref` 포함), 카탈로그를 깔아줌.
4. 이후 `--update`는 정확 동작. 첫 update 사이클은 카탈로그 부재 시 신규/삭제 0건 + 스냅샷,
   다음부터 완전.
5. 미마이그레이션 에이전트는 레거시 스탬프(더 이상 갱신 안 됨)가 stale해지며 자연히 노티 →
   각자 마이그레이션.

## 9. 기본값으로 정한 것들 (이견 있을 때만 재논의)

- **비-TTY 충돌**: 실행 중인 에이전트의 브랜치로 덮어쓰기 + 경고 (현행 last-writer-wins 유지).
- **ref 불명 스탬프**: `latest`로 간주 — 첫 업데이트를 거치면 정확한 값이 기록됨.
- **레거시 공유 stamp/record**: 삭제하지 않고 방치, 쓰기만 중단.
- **weegloo 파일 판별**: `weegloo-` prefix로 감지, 파괴적 연산은 카탈로그 검증 후에만.
- **이미 최신이어도 `--update`**: 멱등 재동기화 (수동 삭제 복구).
- **`--ignore-rule`**: 코어 룰 포함 전부 스킵 유지 — "룰 관리 자체를 안 한다"는 명시적
  opt-out(MCP-only 설치 등)의 의미를 깨지 않음.
- **`--update` + `--mcp`**: 에러 (update는 skills/rules 전용).

## 10. 작업 분할

### PR-0 (선행) — 코어 룰 강제

- `CORE_RULE_IDS = ['weegloo-version', 'weegloo-terms-consent']` 상수 (self-update.js) —
  PR-2의 `add ∪ CORE`에서 재사용.
- 대화형 설치: 룰 체크박스(`index.js:461`)에서 코어를 **선택지에서 제외 + 항상 설치 목록에 합류**
  ("필수 룰 2개는 항상 설치됩니다" 안내 1줄). inquirer `disabled`는 선택 불가=제외 방향이라 부적합.
- 비대화형: 이미 전체 설치라 변경 없음. 기록에 코어 포함(자연히 됨).

### PR-1 — 데이터 모델 + 브랜치 버그픽스 (B2·B3 해소)

- **self-update.js**: `getVersionStampPath`/`getInstalledRecordPath`에 `agent` 인자 →
  `.weegloo/<agent>/…` · `buildStamp` → `{version, ref, last_check}` ·
  record에 `availableSkills/availableRules` · `applySelfUpdateTemplate`의
  `{{WEEGLOO_VERSION_URL}}` → `${VERSION_URL}?branch=${encodeURIComponent(ref)}`,
  스탬프 경로 → per-agent · `syncInstalledRecord` per-agent + `available*` + `ref`.
- **index.js**: 스탬프 버전 `loadCurrentVersion()` → `resources.version`(`index.js:489`) ·
  설치 시 `ref`·카탈로그 기록.
- **에이전트 모듈 5종**: `syncInstalledRecord` 호출부에 agent 전달.
- **weegloo-version.mdc**: 스탬프 재작성 지시 → "version·last_check만 갱신, **나머지 필드 보존**" ·
  "latest" 문구 → "설치한 브랜치의 최신" · version 부재 처리 확인.

### PR-2 — `--update` (B1 해소)

- **cli.js**: `update` boolean · update 모드 검증(`--agent` 필수 유지, 토큰 불요 —
  비대화 토큰 필수 체크(`cli.js:231`) 우회, `--mcp` 동시 사용 에러,
  `--ignore-skill`/`--ignore-rule` 허용).
- **update.js (신규)**: §6 플로우. 에이전트 모듈의 경로·쓰기·제거 로직 재사용(설치 함수에서 분리).
- **io.js**: 디스크 복원 헬퍼 — 카탈로그 id 대비 디스크 존재분 반환(skills=디렉터리,
  rules=파일/마커, SAFE_ID 가드).
- **self-update.js**: `buildUpdateCommand` →
  `npx weegloo@latest --agent ${agent} --branch ${ref} --location ${scope} --update`.

### 테스트

per-agent 경로/스키마 · `?branch=` URL 굽기 · 집합 연산(new/keep/remove, 카탈로그 부재 fallback,
CORE 강제) · 디스크 복원 · 공유 파일 충돌(TTY/비-TTY) · no-op(미설치) · 멱등성 ·
레거시 경로 미기록 · `buildUpdateCommand` 기대값 교체 · 코어 룰 체크박스 제외+항상 포함.

## 11. 백엔드 검증 결과 (2026-07-23 실측)

`GET https://ai.weegloo.com/v1/version?branch=<ref>`의 반환값이 **그 브랜치 매니페스트의
`version`과 동일 소스**인지 확인 — 버전이 서로 다른 세 브랜치로 교차 대조:

| branch | `?branch=` 엔드포인트 | raw 매니페스트 `version` | 일치 |
|---|---|---|---|
| 1.1.0 | `ae27cb39362e` | `ae27cb39362e` | ✅ |
| 1.1.1 | `813c17de995b` | `813c17de995b` | ✅ |
| 1.1.2 | `bd0ec46c9847` | `bd0ec46c9847` | ✅ |

- `?branch=` 파라미터는 **실제로 브랜치별로 해석됨** (무시 아님 — 없는 브랜치는 에러 반환).
- **주의**: 존재하지 않는 브랜치는 404가 아니라 **HTTP 500** (`WEB500007`,
  `details.type: NotFound`)을 반환. 룰의 기존 동작(fetch 실패 → 조용히 스킵)과
  update 플로우 2단계(fetch 실패 → 중단)가 이를 자연히 커버하므로 별도 처리 불요 —
  단, 룰/플로우에서 이 에러를 "업데이트 있음"으로 오해석하지 않도록 테스트에 포함할 것.
