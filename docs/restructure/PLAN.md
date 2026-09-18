# skill/rule 재구조화 계획

브랜치: `refactor/skill-rule-tree` (develop @ 3809087 기준)

## 요구사항 (변경 불가)

1. **기존보다 안정적이어야 한다. AI 의 실수가 늘어나서는 절대 안 된다.**
2. **문서 관계는 거미줄이 아니라 Tree 여야 한다** — 목차를 보고 필요한 페이지로 이동하듯이.
3. **Claude Code · Codex · Antigravity 전부 필수.**

요구사항 1이 나머지 둘을 지배한다. 구조가 아무리 아름다워도 에이전트가 전보다 틀리면 실패다.
그래서 이 계획의 1단계는 구조 변경이 아니라 **계측**이다.

---

## 현황 (실측)

| | 크기 | 로딩 |
|---|---|---|
| `rules/*.mdc` 9개 | **115,213 B** (~34,900 tok) | 매 세션 **항상** |
| skill frontmatter 30개 | **31,241 B** (~9,500 tok) | 매 세션 **항상** |
| **항상-로딩 합계** | **146,454 B ≈ 41,850 tok** | 사용자가 한 글자 치기 전에 |
| `SKILL.md` 본문 30개 | 495,792 B | invoke 시 통째로 |

집중도: `weegloo-global-rules` 44,208 B + `weegloo-api-endpoints` 34,514 B = **전체 rules 의 68%**.
churn(최근 200커밋): global-rules **42회**, platform-integration **33회**, script **28회** — 가장 크고,
가장 자주 바뀌고, 가장 중복이 많은 파일이 정확히 일치한다.

중복: rules 의 **~70%(81,600 B)** 가 전담 skill 이나 다른 rule 을 재진술한다.
최근 문서 커밋 58건 중 **33건(57%)이 2개 이상 파일**을 고쳤다(최악 16개 파일).

**이미 발생한 drift 2건** — 가설이 아니라는 증거:
- `rules/weegloo-api-endpoints.mdc:47` 은 406 주장을 **철회**했는데 `skills/weegloo-user-login/SKILL.md:70,138` 은 **아직 주장 중**.
- `rules/weegloo-global-rules.mdc:159` "**모든** 리소스에 `x-weegloo-version` 필수" vs `skills/weegloo-scheduler/SKILL.md:61-62` "Scheduler 는 버전 헤더를 **받지 않는다**". **항상 로딩되는 rule 쪽이 틀렸다.**

---

## Tree 아키텍처

### 지금은 Tree 가 아니라 거미줄이다

상호참조 **815개**, 명시적 "자세한 건 skill X" 포인터 33개. rule 4개는 스스로를
*"a safety-net summary, not a substitute"* 라고 써놓고 그 skill 을 또 재진술한다.
`.claude/skills/spec-sync/SKILL.md:422` 에는 이미 **"정본부터 고치고 나머지는 참조하게 한다"** 는
정책이 문서로 존재하는데도 70% 재진술이 됐다. **빠진 건 링크도 정책도 아니고 강제와 삭제다.**

### 목표 구조 (깊이 3, 단일 부모)

```
[L0] rules/  — 항상 로딩. 목차 + 조용히 실패하는 불변식만.
      weegloo-global-rules      목차 표 + 하드 게이트
      weegloo-api-endpoints     좌표계 (base URL, identity 경계)
      weegloo-terms-consent     법적 게이트          (손대지 않음)
      weegloo-version           업데이트 채널
      weegloo-default-locale    (손대지 않음, class A 91%)
      weegloo-web-hosting-rules (손대지 않음)
      weegloo-minimal-load / media-lifecycle / resource-deletion
         │
         ▼ 목차의 각 행이 정확히 하나의 skill 을 가리킨다
[L1] skills/<id>/SKILL.md  — spine. invoke 시 로딩.
         │
         ▼ spine 이 자기 references 만 가리킨다
[L2] skills/<id>/references/*.md  — page. 필요할 때만.
```

### Tree 규칙 4개 (CI 로 강제)

1. **단일 소유 (Single owner).** 하나의 사실은 정확히 하나의 노드에 산다.
   `FACT-OWNERS.md` 에 `{사실, 소유 파일, 고유 문구}` 를 적고
   `grep -rF <고유문구> plugins/weegloo/ | wc -l == 1` 을 CI 가 강제한다.
   → **지금 존재하는 drift 2건을 둘 다 잡았을 유일한 장치다. 링크 그래프도 표도 이걸 못 한다.**

2. **부모 → 자식 링크만. 형제 링크 금지.**
   skill A 가 skill B 를 링크하면 안 된다. 관계는 **부모(목차/라우터)** 가 소유한다.
   형제의 사실이 필요하면 **링크 대신 Verdict 한 줄을 인라인**한다
   (예: script 는 `"작성자 역할에 무조건 Allow 필요 (WGL403015)"` 를 적되 space-role 을 링크하지 않는다).

3. **깊이 최대 3.** `references/` 안에 또 references 를 두지 않는다.

4. **Verdict 우선.** 부모의 표 행은 **단독으로 행동 가능**해야 한다.
   ```
   | Trigger | Verdict (이것만 읽고도 올바르게 행동 가능) | Read when | skill |
   ```
   **불변식: 에이전트가 행에서 멈추고 링크를 안 열어도 안전한 쪽으로 행동해야 한다.
   링크는 정밀도를 사는 것이지 정확성을 사는 게 아니다.**
   제목만 있는 행은 무조건 읽게 만들어서 오히려 비싸다.

---

## 핵심 제약 — "트리거만 rule 로" 가 안 되는 이유

목표를 그대로 실행하면 rules 가 115 KB → 22~31 KB 가 된다. **권하지 않는다.**
측정된 현실적 바닥은 **40~45 KB**, 목표는 **60 KB**.

### 산술

```
링크 뒤로 옮긴 내용 S 에 대해:
    문맥 절약  = (1 - P) × S
    게이트 미발동 = P
같은 P 다. "토큰도 줄고 게이트도 그대로" 는 동일 콘텐츠에 대해 성립할 수 없다.
이 트레이드에서 자유로운 건 오직 '삭제' 뿐이다.
```

### 조용히 실패하는 56.6%

rule 본문 114,578 B 중 **64,765 B (56.6%)** 가 *에러가 아니라 그럴듯하게 틀린 결과*를 만든다.
에이전트는 **자기가 모른다는 걸 모르기 때문에** 링크를 따라갈 트리거 자체가 없다.

| 빠지면 | 무슨 일이 | 에이전트가 찾아볼까? |
|---|---|---|
| `X-Weegloo-Advanced-Search` | **에러가 아니라 빈 배열** → "검색 결과 없음"이라 보고 | 아니오 |
| `createdBy :self` | 모든 회원이 **남의 글을 읽고 수정하고 삭제** | 아니오 |
| CDA 읽기 shape | `fields.title[locale]` → `undefined` | 아니오 |
| `Allow:[]`=필터없음 / `Deny:[]`=전부거부 | 정반대로 해석 | 아니오 |
| publish 누락 | CDA 빈 리스트 → 사이트 백지 | 아니오 |

파일별 class A 비율: default-locale **91%** · terms-consent 86% · minimal-load 85% ·
media-lifecycle 84% · global-rules 68% · **api-endpoints 33% ← 최고의 압축 대상** · version 8%.

### Codex 제약 (요구사항 3)

```
Codex/Antigravity 에게 skills 디렉터리를 읽으라고 지시하는 코드가 레포 어디에도 없다.
  antigravity.js:56-72 (RULE_LOADING_CONTENT) → .agents/rules/ 만 가리킨다. skills 언급 없음.
  codex.js:403                                → AGENTS.md 에 rule 마커만 upsert.
→ Codex 에서 rule 내용을 skill 로 옮기면 '이동'이 아니라 '삭제'일 수 있다.
```

또한 Codex 는 **모든 rule 을 하나의 `AGENTS.md` 에 마커로 이어붙인다**
(`upsertRuleInAgentsMd`). 따라서 **rule 을 여러 파일로 쪼개는 것은 Codex 에서 바이트 절감이 정확히 0** 이다.
방향은 rule 을 **늘리는** 게 아니라 **지우는** 것.

역설적으로 이건 목차 구조가 **옳다**는 근거다 — Codex 에서 skill 을 쓰게 하려면
*"세션 시작 시 목차를 읽어라"* 부트스트랩 룰이 **필수**다. 그 선례가 이미 레포 안에 있다
(`RULE_LOADING_CONTENT`). 다만 **`tests/harness-probe` 검증 전에는 아무 내용도 옮기지 않는다.**

참고: `antigravity.js:123-137` 은 rule frontmatter 에 `trigger: always_on` 을 **주입**하며,
주석에 *"model_decision could silently skip a gate"* 라고 적혀 있다.
**게이트는 lazy 로 두지 않는다는 판단이 이 레포에 이미 존재한다.**

---

## 단계별 계획

### Phase 0a — 계측 (콘텐츠 무변경) ✅ 구축 완료 / ⬜ 베이스라인 미기록

- ✅ `tests/run-fixtures.mjs` — 행동 회귀 러너 (per-assert 비교, 회귀 시 exit 1)
- ✅ `tests/fixtures/routing/*.mjs` — 20 픽스처 / 61 assert (한국어 13 · 영어 7)
- ✅ `tests/harness-probe/README.md` — Codex/Antigravity 능력 검증 프로토콜
- ⬜ **베이스라인 기록** — `node tests/run-fixtures.mjs --out tests/baseline.develop.json`
- ⬜ **하네스 프로브 실행** → `tests/harness-probe/RESULT.md`

> **Phase 0a 가 끝나기 전에는 어떤 파일도 지우지 않는다.** 베이스라인 없이 지우면
> "안정성이 유지됐다" 를 말로만 주장하게 된다.

### Phase 0b — installer 선행 작업 (단독 PR)

```
scripts/build-installer-manifest.mjs 의 buildSkills() 는 비재귀다:
    readdirSync(skillDir, {withFileTypes:true}).filter(e => e.isFile())
→ references/ 를 먼저 만들면 매니페스트에서 조용히 사라진다.
→ 바이트 동일 매니페스트 + CI 초록으로 통과하고, npx 사용자 전원이
   '존재하지 않는 파일을 가리키는 SKILL.md' 를 받는다.
```

- `buildSkills()` 재귀화 + 슬래시 키(`references/x.md`)
- `io.js` 에 `SAFE_REL_PATH` 추가 — 현재 `SAFE_ID` 는 `skill.id` 만 검증하고 **파일 키는 `path.join` 으로 직행**([claude.js:131](../../installer-cli/src/claude.js)). 중첩 키 허용 순간 `../../` 경로 탈출이 열린다.
- `manifest.test.js` 에 "하위 디렉터리가 있는 skill 은 중첩 키를 생성한다" assert — **없으면 평면 빌더가 바이트 동일 + CI 초록으로 조용히 통과한다**
- 덤: `metadata.json` 30개(3,328 B)는 어디서도 안 읽힌다 — 마켓플레이스 채널 확인 후 삭제

### Phase 1 — 순수 삭제 (행동 변화 0 · 픽스처의 음성 대조군)

| 대상 | 절감 |
|---|---|
| rule 중복 5쌍 — ACMA-no-flat(1,720+1,589) · MCP-tools-only(844+834) · Accept(473+1,118) · llms.txt 절차(1,552+2,979) · WebHosting 캡(919+1,386). **각 쌍에서 긴 쪽을 남긴다** | ~7,200 B |
| `platform-integration/SKILL.md:187-381` — 518-549행 표(6,067 B)의 재진술 (실측) | 16,216 B |
| global-rules 자기중복 (skip-cap 이 `:120` 과 `:155` 에 두 번) | — |
| **drift 2건 수정** + `SETTING_*` enum 15개로 통일 | — |

이 단계는 **행동 델타가 선험적으로 0인 유일한 변경**이므로 픽스처의 **음성 대조군**이다.
점수가 움직이면 → 픽스처가 노이즈이거나 그게 중복이 아니었다는 뜻.
점수가 유지되면 → 그게 다음 단계로 갈 면허.

### Phase 2 — frontmatter description 700 B 캡

상위 5개 11,113 B → 3,500 B (script 2,744 / payment 2,325 / platform-integration 2,228 /
api-query-optimization 1,975 / send-email 1,841).

**동시에 버그 수정이다**: Claude Code 가 1,536자에서 절단해서 6개 skill 의 라우팅 트리거
**3,336자가 이미 버려지는 중**이다(`send-email` 은 1,788자 중 1,535 offset 에서 단어 중간 절단).

필수 제약 2개:
- 700 B 중 **~150 B 를 비영어 트리거에 예약** — 현재 한국어 트리거는 최대 83자뿐인데 이 레포 사용자는 한국어로 쓴다.
- *"PG 를 묻지 마라" / "Maps 키를 묻지 마라"* 같은 **anti-question 정책은 rule 에 남긴다** — skill 이 열리기 **전에** 발동해야 한다.

### Phase 3 — skill spine + `references/` (18 KB 초과 10개만, PR 하나에 skill 하나)

**선행 조건: Phase 0b 머지 + 하네스 프로브 Q3 결과.**

순서: `platform-integration`(54,621 → ~12,000) → `script`(63,366 → spine ~9,000 + references 8개)
→ `payment` → 나머지.

규칙: (a) 한 작업이 형제 reference 를 3개 이상 필요로 하면 spine 에 남긴다 ·
(b) reference 는 3 KB 이상 + **분리된 사용 경로** · (c) **모든 spine 은 가장 흔한 단일 경로에
대해 자족적** — Q3 가 음성이면 분할은 토큰 트레이드가 아니라 무증상 콘텐츠 손실이다 ·
(d) **옮기지 말고 지울 것**을 별도 패스로(예: script 의 `Roles — grant Script Execute` 1,623 B 는
space-role 의 `Recipe` 2,875 B 중복 → references 로 옮기면 drift 표면이 그대로 산다. 한 줄로 삭제).

### Phase 4 — rules 제자리 압축 (**id 9개 전부 유지**)

**삭제 전에 `GATE-INVENTORY.md` 를 먼저 쓴다.** 판정 기준 한 줄:
> *"이 문장이 없으면 에이전트가 **맞아 보이는 틀린 결과**를 내는가?"*
> 예(빈 리스트 / undefined / 403의 잘못된 본능적 수리 / 데이터 노출) → **상주**.
> 아니오(에이전트가 읽을 에러가 뜬다) → 설명은 소유 skill 로, **잘못된 수리를 지목하는 한 줄만 상주**.

| 파일 | 현재 | 목표 |
|---|---|---|
| global-rules | 44,208 | ~22,000 (9,762 B 라우터 섹션 → Verdict 표 ~4,000 B) |
| api-endpoints | 34,514 | ~14,000 |
| minimal-load | 8,986 | ~4,500 |
| version | 5,687 | ~3,400 |
| resource-deletion | 5,480 | ~3,400 |
| media-lifecycle | 3,475 | ~3,100 |
| terms-consent / web-hosting-rules / default-locale | 15,563 | **손대지 않음** |

```
rule id 를 지우거나 개명하지 않는다.
  self-update.js:51  CORE_RULE_IDS (version + terms 강제 설치)
  weegloo-version.mdc 본문의 {{WEEGLOO_*}} 치환 4개 (self-update.js:418-434)
  origins.js:191     id 기반 terms 제외
특히 weegloo-version 본문을 링크 뒤로 옮기면 치환이 무음 no-op 이 되어
모든 설치 사용자의 업데이트 경로가 영구히 끊긴다 — 이 개선이 전달될 통로 자체다.
```

### Phase 5 — 보류/선택

provider skill 7개 통합(51,073 B, 보일러플레이트 54%, description 5,627 B → ~900 B).
**id 가 바뀌므로** `update.js:3-25` 의 `new = catalog \ prevAvailable` 때문에 일부러 해제한
사용자에게 후속 skill 이 조용히 설치된다 → `SUCCEEDED_BY` 맵을 먼저 넣거나 릴리스 노트에 명시.

---

## 가드레일 (CI)

| 가드레일 | 무엇을 막는가 |
|---|---|
| **행동 픽스처가 머지 게이트** | 무증상 게이트 강등. **바이트 CI 가 절대 못 잡는 유일한 리스크.** |
| **`FACT-OWNERS.md` + grep 유일성** | drift. 지금 있는 2건을 둘 다 잡았을 유일한 장치. |
| **`GATE-INVENTORY.md` 문장 존재 assert** | 게이트를 기억이 아니라 열거로 관리. 삭제 PR 의 수용 기준. |
| **바이트 캡은 파일별로, 합계 금지** | 한 파일이 다른 파일 몫을 먹고 자라는 것(global-rules 가 44 KB 가 된 방식). |
| **중첩 매니페스트 키 테스트** | 평면 빌더가 바이트 동일 + CI 초록으로 통과하는 것. |
| **`spec-sync` / `weegloo-announce` 경로 존재 assert** | `spec-sync/SKILL.md:380-384` 가 rule 파일명을 하드코딩. §5c(389행)는 아직 "SKILL.md + metadata.json 을 만들라"고 가르쳐서 새 skill 이 다시 모놀리스로 자란다. |

> `spec-sync/SKILL.md:14` 는 이미 "스킬 23개 + 룰 7개"로 실측 30/9 와 어긋나 있다 — 이 문서가 조용히 썩는다는 증거.

---

## 기대 효과

| | 현재 | 계획 후 |
|---|---|---|
| 항상-로딩 (매 세션) | 146,484 B ≈ **41,850 tok** | ~82,300 B ≈ **23,400 tok** (**−44%**) |
| 14-skill 규모 작업 | ≈121,600 tok | ≈53,700 tok (**−56%**) |
| Phase 1+2 만 (리스크 ~0) | | **−4,620 tok/세션** + 본문 −16,216 B |

---

## 하지 말 것

- ❌ rule 을 여러 파일로 쪼개기 — Codex 에서 절감 0, Claude Code 에서 주입량 동일
- ❌ rule 에 "표 + 링크" 도입 — 링크를 따라갈 주체가 없다. 표 바이트 + Read 왕복만 늘어난다
- ❌ rule id 삭제/개명 — installer 와 결합
- ❌ 새 진입점 파일 추가 — 이미 항상-로딩 색인이 셋 있다(30개 description 31,241 B ·
  platform-integration · global-rules:40-52). 넷째를 만들면 앞의 셋이 멈추지 않으므로 **바이트가 늘어난다**
- ❌ 베이스라인 없이 삭제 시작
