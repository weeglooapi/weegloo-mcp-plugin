# CLAUDE.md

이 저장소는 **Weegloo 플러그인**이다. 코딩 에이전트의 컨텍스트에 설치되는 skill·rule 본문과,
그것을 설치하는 `npx` installer로 이루어져 있다.

> **산출물은 코드가 아니라, 다른 에이전트가 그대로 따를 지시문이다.**
> 여기서 한 줄이 틀리면 크래시가 아니라 — 남의 세션에서 **그럴듯하고 자신 있는 오답**이 나오고,
> 어디에도 에러가 남지 않는다.

그래서 모든 변경의 판정 기준은 "문장이 좋아졌는가"가 아니라 **"에이전트가 전과 같거나 더 낫게
행동하는가"**이고, 그것은 주장하는 것이 아니라 **측정한다**(§5).

이 문서는 사전처럼 쓴다. §0에서 하려는 일을 찾아 해당 절로 내려가면, 그 절 안에 규격·절차·검증이
모두 있다.

---

## §0 라우팅 — 무엇을 하려는가

| 하려는 일 | 절 | 빠뜨리면 안 되는 것 |
|---|---|---|
| **skill·rule을 만들거나 고친다 (전부 해당)** | [§3.0](#30-착수-전-확인--하드-게이트) | **편집 전에 "어느 파일에 무엇을" 을 사용자에게 확인받는다** |
| 문장을 어디에 둘지 모르겠다 | [§1.2](#12-배치-결정--이-저장소의-유일한-분기) | 게이트 판정 질문 하나 |
| 스킬을 새로 만든다 | [§3.1](#31-스킬-신규-추가) | `description` ≤ 700 B + 한국어 트리거 |
| 스킬 본문을 고친다 | [§3.2](#32-스킬-본문-수정) | 매니페스트 재생성 |
| spine이 길어 `references/`로 쪼갠다 | [§3.3](#33-spine--references-분리) | spine 단독으로 최빈 경로가 끝나야 함 |
| 스킬을 지우거나 합친다 | [§3.4](#34-스킬-삭제--통합) | 설치측 prune은 **스킬 id 단위** |
| 룰을 새로 만든다 | [§3.5](#35-룰-신규-추가) | `budgets.test.js` 캡 테이블 등록 |
| 룰을 고치거나 압축한다 | [§3.6](#36-룰-수정--압축) | GATE-INVENTORY + **룰 변경은 단건 측정** |
| 같은 사실이 두 파일에 생긴다 | [§3.7](#37-사실fact-이동과-중복) | FACT-OWNERS 등록 |
| 파일명·경로를 정한다 | [§2.7](#27-파일명--경로-하드-제약-installer가-강제) | installer 정규식이 빌드에서 막는다 |
| 테스트·측정을 돌린다 | [§5](#5-가드레일과-측정) | "측정 못 함"을 "이상 없음"으로 바꾸지 말 것 |
| 배포·릴리스한다 | [§6](#6-배포-파이프라인) | 매니페스트 → 테스트 → 측정 → 커밋 순서, **커밋은 사용자 승인 후** |

**불변 원칙 세 줄** (`docs/restructure/PLAN.md`의 요구사항):
1. 기존보다 안정적이어야 한다. 에이전트의 실수가 늘면 그 변경은 실패다.
2. 문서 관계는 거미줄이 아니라 **트리**여야 한다. 목차 보고 페이지로 내려가듯이.
3. Claude Code · Codex · Antigravity 전부 대상이다. 한 harness에서만 되는 구조는 안 된다.

---

## §1 코퍼스 사전

### 1.1 계층 정의

| 계층 | 경로 | 로딩 시점 | 예산 | 강제 수단 |
|---|---|---|---|---|
| **L0 rule** | `plugins/weegloo/rules/*.mdc` | **매 세션, 전문, 항상** | 파일 전체가 비용 | `budgets.test.js` 파일별 바이트 캡 |
| **L1 skill `description`** | `skills/*/SKILL.md` frontmatter | **매 세션 (전 스킬 것 모두)** | **≤ 700 B** | `budgets.test.js` |
| **L2 skill 본문** | `SKILL.md`의 frontmatter 이후 | 그 스킬이 호출될 때만 | 쉴 때는 공짜 | 분할 기준 §2.3 |
| **L3 reference** | `skills/*/references/*.md` | spine이 가리킬 때만 | 쉴 때는 공짜 | — |

L0 + L1이 **항상 로딩 예산**이다. 룰에 한 문장을 더하면 Weegloo를 쓰지 않는 세션까지 포함해
모든 사용자의 모든 세션이 그 비용을 낸다. `references/`에 한 문단을 더하는 비용은 누가 그것을
실제로 필요로 할 때까지 0이다.

**깊이는 3단계에서 끝난다:** `rule` → `SKILL.md` → `references/`. 4단계는 없다.
(installer는 더 깊은 경로도 쓸 수 있지만 — §6.2 — 정책상 만들지 않는다.)

### 1.2 배치 결정 — 이 저장소의 유일한 분기

질문 하나로 결정한다:

> **"이 문장이 없으면, 에이전트가 그럴듯해 보이는 틀린 결과를 내고 그 사실을 모르는가?"**

- **예 → 게이트다. 항상 로딩되어야 한다** (룰 본문, 또는 스킬 `description`).
  모르는 것을 찾아볼 수는 없으므로, 링크는 절대 따라가지 않는다.
  → `plugins/weegloo/GATE-INVENTORY.md`에 등록한다(§4.1).
- **아니오 → 디테일이다. 스킬 본문이나 `references/`로 간다.**
  에이전트는 "이게 필요하다"는 것을 알고 도착하므로 포인터가 작동한다.

예시: *"CDA는 published 리소스만 서빙한다"* 는 **게이트** — 없으면 빈 목록을 읽고 "데이터가
없다"고 보고한다. *"`mimeGroups` enum 값 전체"* 는 **디테일** — 목록이 필요한 줄 알고 찾아 읽는다.

### 1.3 트리 제약 4가지

1. **단일 소유자.** 하나의 사실에 하나의 권위 파일. 다른 곳의 언급은 그것에 **동의하고 가리키는**
   한 줄(Verdict)이어야 한다.
2. **부모 → 자식 링크만. 형제 링크 금지.** 스킬이 다른 스킬의 `references/`를 가리키면 안 된다 —
   없애려던 결합보다 더 깊은 결합이다. 두 스킬이 같은 표를 필요로 하면, 둘 다 읽는 부모에 두거나
   의도적으로 복제하고 `FACT-OWNERS.md`에 등록한다.
3. **깊이 ≤ 3** (§1.1).
4. **Verdict 우선.** 표의 한 행이나 링크를 단 한 줄은 **링크를 열지 않고도 행동 가능**해야 한다.
   링크는 정밀도를 사지, 정확성을 사지 않는다.

> 4번이 비싸게 배운 것이다. 한 단계에서 구체적인 삭제 순서 목록을 *"코드와 순서: …룰 참조"*로
> 바꿨다. 디테일은 **다른 항상-로딩 룰**에 그대로 있었는데도 그 질문의 행동 점수가 100% → 40%로
> 떨어졌다. `Content → Media → ContentType → Space` 네 단어를 되살리자 복구됐다.

### 1.4 룰은 **삭제**로만 싸진다. 구조로는 안 싸진다

정리한다는 이유로 룰을 여러 파일로 쪼개지 말 것.

- **Codex**는 모든 룰을 `AGENTS.md` 하나로 이어 붙인다 — 절감 정확히 0.
- **Claude Code**는 주입 바이트가 그대로다.

항상-로딩 룰을 줄이는 방법은 단어를 지우거나, 게이트가 아닌 문장을 스킬로 내리는 것뿐이다.

**목차용 진입점을 새로 만들지 말 것.** 항상 로딩되는 인덱스가 이미 셋 있다(스킬 `description`
전체, `weegloo-platform-integration` 라우터, `weegloo-global-rules`의 라우팅 절). 네 번째를
만들어도 앞의 셋은 여전히 로딩된다 — 바이트만 **늘어난다**.

---

## §2 파일 규격

### 2.1 스킬 디렉터리

```
plugins/weegloo/skills/<skill-id>/
├── SKILL.md            # frontmatter(name, description) + spine
├── metadata.json       # {name, version, author, license}
└── references/         # 선택. spine이 타지 않는 분기 하나당 파일 하나
    └── <topic>.md
```

- `<skill-id>`는 `weegloo-` 접두사 + kebab-case. installer의 디스크 탐지가 이 접두사를 본다.
- **빈 스킬 디렉터리는 빌드 에러**다(매니페스트 빌더가 거부). 파일이 최소 하나 있어야 한다.
- 이 세 가지 외의 파일 종류는 현재 없다. 새 종류를 도입하려면 §2.7의 경로 제약을 먼저 확인한다.

### 2.2 `SKILL.md` frontmatter — `description`은 요약이 아니라 **라우팅 트리거**

```markdown
---
name: weegloo-space-role
description: <트리거 문장> … 권한, 역할, 접근 제어, 관리자 권한, 내 것만 보이게.
---
```

항상 로딩되므로 모든 바이트가 다른 스킬의 바이트와 경쟁한다. **사용자가 실제로 칠 말**로 쓰고,
파일 설명으로 쓰지 않는다.

- **≤ 700 B.** `installer-cli/test/budgets.test.js`가 강제한다.
- **한국어 트리거를 반드시 넣는다.** 이 저장소의 사용자는 한국어로 쓴다. 영어에서만 발화하는
  트리거는 발화하지 않는 게이트다. 끝을 쉼표로 이은 한국어 열거로 닫는다: `결제, 카드결제,
  체크아웃, 환불`.
- **구별되는 것**을 적는다. 두 스킬의 description이 서로 바꿔 써도 말이 되면 라우터는 엉뚱한
  쪽을 열고, 아무 에러도 나지 않는다.
- 이웃 스킬이 있으면 **무엇이 아닌지**를 적는다.

### 2.3 spine(`SKILL.md` 본문)

- **최빈 경로 하나는 spine만 읽고 끝나야 한다.** `SKILL.md`만 읽는 harness도 평범한 작업을
  완주할 수 있어야 한다. `references/`를 가린 채 spine을 따라 읽어 확인한다.
- **분할 기준:** spine이 대략 **18 KB**를 넘거나, 큰 절이 대부분의 독자가 타지 않는 분기를
  담당할 때(네이티브 앱 경로, 콜백 수신자, provider별 콘솔 절차).
  현재 상위 4개는 이 선을 넘어 있다(`weegloo-script` 28 KB, `weegloo-payment` 26 KB,
  `weegloo-platform-integration` 22 KB, `weegloo-service-login-client` 22 KB) — 18 KB는 **분할을
  검토하라는 신호**이지 자동 실패선이 아니다. 넘긴 채 두려면 "최빈 경로가 spine 안에서 끝나는가"에
  답할 수 있어야 한다.
- **references 포인터 문구**는 *언제 읽는지*를 함께 적는다. 좋은 예(현행):
  `**Read `references/maps-embed.md`** before building anything beyond a single `place` pin:` —
  조건이 있으니 읽지 않아도 되는 경우를 에이전트가 판단할 수 있다.
  나쁜 예: `자세한 내용은 references/x.md 참조` — 언제 열어야 하는지가 없다.
- 제약 4번(§1.3)에 따라, 포인터를 단 줄 자체가 **링크 없이도 행동 가능**해야 한다.

### 2.4 `references/*.md`

- frontmatter 없음. `# Title` 다음 줄에 **언제 이 파일을 읽는지** 한두 문장.
  현행 예: *"Read this **only when** the chosen provider is Google… It assumes the spine
  (`SKILL.md`): the wire protocol, the SDK … are there, not here."*
- 부모(spine)가 이미 말한 것을 반복하지 않는다. 대신 **무엇을 전제하는지** 명시한다.
- 형제 스킬의 `references/`를 가리키지 않는다(§1.3-2).

### 2.5 `metadata.json`

```json
{ "name": "<skill-id>", "version": "1.0.0", "author": "weegloo", "license": "MIT" }
```
`name`은 디렉터리명과 같게 유지한다.

### 2.6 `rules/*.mdc`

- 확장자는 **`.mdc`** 고정. 빈 파일은 빌드 에러.
- 룰 한 줄은 **결론과 결과**를 말한다. 근거는 스킬에 둔다.
- 새 룰은 `budgets.test.js`의 `RULE_CAPS`에 **캡을 등록해야 한다** — 등록하지 않으면
  `no rule file is missing from the cap table` 테스트가 실패한다. 현재 캡(바이트, LF 기준):

  | rule | cap | | rule | cap |
  |---|---|---|---|---|
  | `weegloo-global-rules` | 27,700 | | `weegloo-terms-consent` | 6,800 |
  | `weegloo-api-endpoints` | 16,900 | | `weegloo-minimal-load` | 6,300 |
  | `weegloo-resource-deletion` | 4,100 | | `weegloo-version` | 3,600 |
  | `weegloo-web-hosting-rules` | 3,300 | | `weegloo-default-locale` | 3,200 |
  | `weegloo-media-lifecycle` | 3,000 | | | |

  캡을 **올리는 것은 허용된다** — 그것은 결정이고, 결정은 diff에 보여야 한다.

- **룰 id는 절대 바꾸거나 지우지 않는다.**
  - `installer-cli/src/self-update.js`의 `CORE_RULE_IDS = [weegloo-version, weegloo-terms-consent]`는
    사용자가 해제해도 **강제 재설치**된다.
  - `weegloo-version.mdc`는 installer가 치환하는 플레이스홀더 4개를 본문에 갖는다:
    `{{WEEGLOO_VERSION_URL}}`, `{{WEEGLOO_STAMP_PATH}}`, `{{WEEGLOO_UPDATE_COMMAND}}`,
    `{{WEEGLOO_CHECK_INTERVAL_HOURS}}`. 이 본문을 링크 뒤로 옮기면 치환이 **조용히 no-op**이 되고,
    이미 설치된 모든 사용자의 업데이트 경로가 끊긴다 — 이 작업이 배포되는 바로 그 채널이다.

### 2.7 파일명 · 경로 하드 제약 (installer가 강제)

매니페스트의 스킬 파일 키는 `installer-cli/src/io.js`의 `SAFE_REL_PATH`를 통과해야 한다:

```
^[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)?(\/[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)?)*$
```

세그먼트 = `[A-Za-z0-9_-]+` + 점 확장자 **최대 하나**. 실측 판정:

| 파일명 | 판정 |
|---|---|
| `references/master-detail.md`, `references/UPPER_Case-1.md` | 통과 |
| `references/sub/deep.md` (깊이 4) | installer는 통과 — 다만 **정책상 만들지 않는다**(§1.1) |
| `references/two.dots.md` | **거부** (점 2개) |
| `references/with space.md` | **거부** (공백) |
| `references/한글.md` | **거부** (비 ASCII) |
| `../../.bashrc`, `/abs.md`, 역슬래시 경로 | **거부** (경로 이탈 방지) |

거부는 **빌드 시점**에 `scripts/build-installer-manifest.mjs`가 던진다 — 커밋 전에 크게 실패하는
쪽이라 안전하다. 설치 시점에도 `assertSafeRelPath`가 다시 검사한다.

→ **reference 파일명은 ASCII 소문자 kebab-case + `.md` 하나**로 쓴다.

---

## §3 작업 절차

모든 절차의 **첫** 단계는 §3.0의 착수 전 확인이고, **마지막** 단계는 §6.3의 릴리스 체크리스트다.

### 3.0 착수 전 확인 — 하드 게이트

**skill·rule을 새로 만들거나 고치기 전에, 어느 파일을 어떻게 할 것인지 사용자에게 먼저 제시하고
확인을 받는다.** 예외는 없다 — 한 줄 추가, 오타 수정, "명백해 보이는" 배치도 포함이다.
사용자가 고르기 전에는 대상 파일을 열어 읽되 **쓰지 않는다.**

제시할 때 이 네 가지를 담는다. 길게 쓰지 말고, 사용자가 **고를 수 있게** 쓴다:

1. **대상 파일의 정확한 경로**와 그 계층(§1.1의 L0 rule / L1 `description` / L2 spine / L3 reference).
2. **넣을 내용의 요지 한두 줄** — 전문이 아니라, 무엇을 주장하게 되는지.
3. **그 자리인 이유** — §1.2의 게이트 판정 질문에 대한 답. 한 사실이 두 파일에 생긴다면 그 사실도
   함께(§3.7).
4. **대안 배치와 그 비용** — 룰이면 항상-로딩 예산과 `RULE_CAPS` 상향, 스킬이면 발화 경로,
   references면 spine 단독 완주 여부. 비용이 다른 선택지를 같은 무게로 늘어놓지 말고 **권장안을
   먼저** 쓴다.

**왜 이것이 게이트인가.** 이 저장소의 유일한 분기는 "문장을 어디에 두는가"(§1.2)이고, 그 판단이
틀리면 테스트는 전부 초록인 채로 **남의 세션에서 조용히 잘못 발화한다** — 게이트를 링크 뒤로
보내면 아무도 따라가지 않고(§1.3-4), 디테일을 룰에 올리면 Weegloo를 쓰지 않는 세션까지 그 비용을
낸다(§1.4). 둘 다 diff만 봐서는 똑같이 "문서 한 줄 추가"로 보인다. 그래서 배치는 저자가 혼자
정하는 것이 아니라 **확인받는 결정**이다.

작업 중 배치를 바꿔야 할 근거가 나오면(더 나은 소유자 파일을 찾았다, 룰 캡을 넘게 됐다) **바꾸기
전에 다시 확인받는다.** 확인 없이 옮긴 문장은, 사용자가 승인한 적 없는 자리에 있는 문장이다.

### 3.1 스킬 신규 추가

1. 정말 새 스킬인가? 기존 스킬의 한 절이나 `references/` 한 장이면 그쪽이 맞다 — 새 스킬은
   모든 세션에 `description` 바이트를 영구히 더한다.
2. `skills/<weegloo-xxx>/SKILL.md` + `metadata.json` 생성 (§2.1–2.5).
3. `description` 작성 — ≤ 700 B, 한국어 트리거 포함, 이웃 스킬과 구별(§2.2).
4. 라우팅에 연결: `weegloo-platform-integration`(라우터) 또는 `weegloo-global-rules`의 라우팅 절에
   **언제 이 스킬로 가는지** 한 줄. 이 줄이 없으면 스킬은 사실상 존재하지 않는다.
5. 게이트 문장이 있으면 `GATE-INVENTORY.md`(§4.1), 중복 사실이 있으면 `FACT-OWNERS.md`(§4.2).
6. 라우팅이 실제로 발화하는지 볼 fixture를 `tests/fixtures/routing/`에 추가할지 판단(§5.2).
7. §6.3.

### 3.2 스킬 본문 수정

1. 그 사실의 **소유자**가 이 파일이 맞는지 `FACT-OWNERS.md`로 확인(§1.3-1).
2. 수정. 게이트 문장을 건드렸다면 GATE-INVENTORY의 해당 조각이 **축자로** 남아 있어야 한다.
3. §6.3. (스킬 본문·references만 바뀌었다면 측정은 묶어서 한 번 — §5.5.)

### 3.3 spine → `references/` 분리

**이것은 이동이지 재작성이 아니다.**

1. 옮길 블록을 그대로 `references/<topic>.md`로 **잘라 붙인다**. 의미를 나르는 표현 —
   콘솔 메뉴명, 필드명, URL, 강조 — 을 보존한다.
2. 목적지의 **부모가 이미 말하는** 문장만 지운다. 그것은 가정하지 말고 부모를 열어 확인한다.
3. spine에는 **언제 읽는지**가 붙은 포인터를 남긴다(§2.3).
4. spine 단독으로 최빈 경로가 끝나는지 `references/`를 가린 채 확인한다.
5. **원본을 지우기 전에 대조 읽기(read-back)를 통과시킨다.** 작성자가 아닌 다른 쪽이 원본을
   띄워 놓고 대조해야 한다.

> 실측 비용: 한 정리 작업이 Google 콘솔 단계 두 개를 *"아래의 client-type 주석 참조"*라는 전방
> 포인터로 대체했다 — 그것도 **사용자에게 그대로 붙여 주라고 지시하는 블록 안에서**. "아래"는
> 아무 데도 닿지 않았다. Android 앱을 만드는 사용자는 Google의 *Android* 클라이언트 타입을
> 골랐을 것이고(클라이언트 시크릿이 발급되지 않는다), 원본이 이미 답해 놓았던 입력에서 연동이
> 멈췄을 것이다. 같은 작업이 원본이 일부러 뺀 실행 조언을 지어내기도 했다.
> **원본을 열어 둔 검증자만이 이것을 잡았다.**

### 3.4 스킬 삭제 / 통합

- 디렉터리를 지우거나 다른 스킬의 `references/`로 접는다.
- 라우터·룰·다른 스킬에 남은 **모든 언급을 함께 지운다**. `grep -rn "<skill-id>" plugins/`.
- `FACT-OWNERS.md`의 `mentions` 목록에서도 뺀다(테스트가 파일 집합을 검사한다).
- **사용자 디스크에서의 제거는 자동이다:** installer는 설치 기록(`installed.json`)과 새 카탈로그를
  비교해 사라진 **스킬 id 디렉터리**를 통째로 지운다(§6.2). 이번 브랜치에서 provider 스킬 7개
  (`weegloo-service-login-{google,kakao,naver,line,github,gitlab,facebook}`)가 이 경로로 제거된다.
- **주의:** 같은 스킬을 유지하면서 그 안의 **파일 하나만** 없앤 경우는 최신 CLI에서만 깨끗이
  지워진다(§6.2의 clean-sync). 배포 전 CLI 릴리스를 §6.3에서 확인한다.

### 3.5 룰 신규 추가

룰은 문장을 두기에 가장 비싼 자리다. 추가 전에:

1. **게이트인가?**(§1.2) 아니면 스킬로 간다.
2. **이미 어딘가에 있는가?** 먼저 검색한다. 다른 파일이 말하고 있으면 그 파일을 가리키거나
   `FACT-OWNERS.md`에 중복을 등록한다 — 등록 안 된 사본 둘을 남기면 반드시 어긋난다.
3. **Verdict인가?** 결론과 결과만. 근거는 스킬에.
4. `RULE_CAPS`에 캡을 등록한다(§2.6) — 안 하면 테스트가 실패한다.
5. 게이트 문장을 `GATE-INVENTORY.md`에 등록한다.
6. §6.3. **룰 변경은 단건으로 측정한다**(§5.5).

### 3.6 룰 수정 / 압축

- 압축의 합격 기준은 바이트가 아니라 `GATE-INVENTORY.md`다. 인벤토리의 모든 조각이 소유 룰에
  **축자로** 남아 있어야 한다(공백 정규화만 허용). 테스트가 검사한다.
- 인벤토리에서 한 줄을 지우는 것은 결정이고, **diff에 보여야 한다**.
- 캡을 내리려고 게이트를 강등하지 않는다. 캡의 숫자는 계획이 아니라 실측이다.
- **단건 측정**(§5.5).

### 3.7 사실(fact)의 이동과 중복

- 한 사실은 한 소유자(§1.3-1). 옮기면 소유자 줄을 함께 옮긴다.
- 둘 이상이 말해야 한다면 `FACT-OWNERS.md`에 행을 추가하고 세 축을 채운다(§4.2).
- `forbidden` 패턴을 추가했다면 `tests/fact-owners-control.mjs`로 **그 패턴이 실제 결함에서
  매치하는지** 확인한다. 매치하지 않는 패턴은 영원히 통과하며, 삭제된 행과 구별되지 않는다.

### 3.8 이름을 바꾸면 안 되는 것

| 대상 | 이유 |
|---|---|
| `weegloo-version`, `weegloo-terms-consent` 룰 id | `self-update.js`가 강제 설치한다 |
| `weegloo-version.mdc` 본문의 `{{WEEGLOO_*}}` 4개 | installer 치환 대상 (§2.6) |
| 스킬 `description`의 한국어 트리거 열거 | 사용자 발화가 그 언어다 |
| `GATE-INVENTORY.md` / `FACT-OWNERS.md`의 파일명·헤딩 형식 | 테스트가 파싱한다 |

---

## §4 레지스트리

### 4.1 `plugins/weegloo/GATE-INVENTORY.md`

없으면 **그럴듯한 오답**이 나오는 문장들의 목록. 링크 뒤로 보내거나 스킬로 강등할 수 없는 것들
(§1.2). 형식: `## <rule-id>` 헤딩 아래, 각 항목의 **첫 백틱 구간**이 게이트 조각이고 그 뒤에 —
없으면 무엇이 깨지는지. `budgets.test.js`가 조각의 존재를 검사하므로, **이 파일에서 줄을 지우는
것은 결정이며 diff에 남는다.**

### 4.2 `plugins/weegloo/FACT-OWNERS.md` — 한 사실, 한 소유자

여러 곳에 적힌 load-bearing 사실마다 소유자와 세 축을 적는다:

| 축 | 잡는 것 | 못 잡는 것 |
|---|---|---|
| `canary` — 정확히 **한 번**만 나와야 하는 문구 | 복붙 후 갈라짐 | 다른 말로 다시 쓴 진술 |
| `mentions` — 그 사실을 말해도 되는 파일 집합 | **새 파일**이 대화에 끼어드는 것 | 등록된 두 파일 간의 모순 |
| `forbidden` — 틀린 것으로 확인된 표현 | 그 오류의 재발, 영구히 | **새로운** 방식의 오류 |

**`forbidden`이 값을 하는 행이다.** 고친 드리프트 하나가 영구 가드가 된다.
`tests/fact-owners-control.mjs`가 모든 패턴을 **결함이 살아 있던 고정 커밋(sha)**에 재생해 침묵하는
행을 실패시킨다. `DEFECT_AT`에는 브랜치명이 아니라 **sha**를 적는다 — 브랜치를 적으면 수정을 따라가
모든 행이 INERT로 보고된다.

> 이 통제는 즉시 하나를 찾아냈다: `scheduler-version-header`의 패턴은 두 부분의 순서가 실제 문장과
> 반대였고, 어느 커밋에서도 매치하지 않은 채 두 단계 동안 초록색 스위트에 앉아 있었다.

---

## §5 가드레일과 측정

### 5.1 `installer-cli/test/` — `cd installer-cli && npm test` (현재 242 tests)

| 파일 | 잡는 것 | 못 잡는 것 |
|---|---|---|
| `budgets.test.js` | 룰 파일별 바이트 캡, `description` ≤ 700 B, 캡 미등록 룰, GATE-INVENTORY 조각 존재 | 그 문장이 여전히 옳은 뜻인지 |
| `fact-owners.test.js` | §4.2의 세 축 | 등록된 두 파일 사이의 모순 |
| `manifest.test.js` | 스킬 하위 디렉터리가 **중첩 키**로 매니페스트에 실리는지, 결정성 | — |
| `io.test.js` | 중첩 파일 설치·clean-sync·삭제, 경로 이탈 거부 (§6.2) | — |
| `tests/fixtures/routing/` | **행동** — 유일하게 그것을 잡는 것(§5.2) | 아무 fixture도 묻지 않는 것 |

### 5.2 fixtures — 모든 코퍼스 변경이 통과해야 하는 관문

바이트를 세는 검사는 "중복을 지웠다"와 "게이트를 지웠다"를 **똑같이 만족**시킨다. 구분하는 것은
`tests/run-fixtures.mjs`뿐이다. 현재 **23 fixture / 69 assert** (한국어 17, 영어 6),
`tests/baseline.develop.json` 기준으로 **assert 단위** 비교한다.

fixtures는 저장소가 아니라 `~/.claude/`에 **설치된** 코퍼스를 측정한다. 파일을 고쳐도 installer를
돌리기 전에는 아무것도 바뀌지 않는다.

```bash
npx weegloo@latest --agent claude --location global --branch <your-branch> --update
node tests/run-fixtures.mjs --out tests/run.<name>.json --compare tests/baseline.develop.json --concurrency 8
npx weegloo@latest --agent claude --location global --branch develop --update   # 끝나면 복구
```

### 5.3 "측정 못 함"을 "이상 없음"으로 바꾸지 말 것

세 번 각각 틀린 결론을 낳은 자리다. 에러 난 재시도, 잘린 응답, 애초에 돌지 않은 fixture — 전부 한
번씩 증거로 채점된 적이 있다.

| 함정 | 실제로 일어나는 일 | 할 일 |
|---|---|---|
| 러너를 파이프로 넘김 | `… \| tail -60`은 `tail`의 종료코드를 준다. 러너의 유일한 신호가 버려지고 셸은 성공을 보고한다 | 그대로 실행하거나 `set -o pipefail` |
| 세션 한도 | 모든 fixture가 ~55자 거부 응답. `MIN_RESPONSE_CHARS`(200)가 ERROR로 잡는다 | 리셋 시각 확인 후 **스코어카드를 지운다** — 아무것도 측정하지 않은 `run.<name>.json`은 나중에 측정했다는 증거로 읽힌다 |
| origins 매핑 | `--update`는 설치 시 기록된 매핑을 재적용한다. 개발 환경 설치본은 호스트를 전부 바꾸고 룰 하나를 빼므로 **제3의 코퍼스**를 재게 된다 | `~/.weegloo/claude/installed.json`의 `origins`가 null인지 확인 |
| 버전 교차 병합 | 서로 다른 `installedVersion`의 `--merge`는 어떤 단일 코퍼스도 설명하지 않는다 | 전체 재실행 |
| 판정자의 확률성 | 실패 한 번은 회귀가 아니다 | 러너가 재실행하고(`--confirm-retries`, 기본 4) 갈리면 FLAKY로 보고한다 |

### 5.4 통과하는 테스트는 실패하는 것을 본 적 있어야 의미가 있다

CI에 없는 통제 둘(각각 CI가 갖지 못한 비용을 치른다):

- `tests/negative-control.mjs` — **judge assert**가 틀린 답을 여전히 거부하는가? **실패 유형당
  한 표본.** 한 재작성이 바로 그 assert가 잡으려던 결함을 통과시키고도 통제를 통과했는데, 그
  통제의 오답이 *다른 방식으로* 틀렸기 때문이었다.
- `tests/fact-owners-control.mjs` — **`forbidden` 패턴**이 자기 결함에 여전히 매치하는가(§4.2).

### 5.5 묶음 측정 규칙

- **항상-로딩 룰을 건드린 변경은 단건으로 측정한다.** 이 프로젝트의 유일한 실제 회귀가 거기서
  나왔고, 묶음에서 이분 탐색하는 비용이 실행 비용보다 훨씬 크다.
- 스킬 본문·`references/` 편집은 묶어서 한 번 측정해도 된다.

---

## §6 배포 파이프라인

### 6.1 코퍼스가 사용자에게 닿는 경로

```
plugins/weegloo/{skills,rules}          ← 편집
        ↓  scripts/build-installer-manifest.mjs   (로컬 실행 또는 CI)
plugins/weegloo/installer-manifest.json ← 전 파일 본문을 그대로 임베드 + content version
        ↓  raw.githubusercontent.com/<repo>/<branch>/…  (단일 요청, GitHub API 미사용)
npx weegloo (installer-cli)             ← 매니페스트만 읽고 디스크에 씀
        ↓
~/.claude/skills/<id>/…  ·  ~/.claude/rules/<id>.md  ·  ~/.weegloo/claude/{installed.json,version-check.json}
```

- 매니페스트는 **저장소 내용의 순수 함수**다(타임스탬프·sha 없음). 그래서 재생성 멱등 가드
  (`git diff --quiet`)가 성립한다.
- CI 자동 재생성은 **배포 브랜치에서만** 돈다: `latest`, `develop`, `숫자.숫자.숫자`.
  경로 필터는 `plugins/weegloo/skills/**`이라 `references/`도 포함된다.
  **feature 브랜치는 자동 재생성되지 않는다** — 로컬에서 빌더를 돌려 커밋하거나 workflow_dispatch.
- 설치 기록은 **id 단위**다(`skills: [...]`, `rules: [...]`, `availableSkills/Rules`). 파일 목록은
  기록하지 않는다 — 그래서 깊이가 늘어나도 기록 포맷은 영향받지 않는다.

### 6.2 depth(`references/`)에 대한 설치·업데이트·삭제 동작 — 실측 확인됨

| 단계 | 처리 | 근거 |
|---|---|---|
| 매니페스트 빌드 | 스킬 디렉터리를 **재귀** 순회, POSIX 키(`references/x.md`)로 임베드 | `listSkillFilesSorted`; `manifest.test.js`가 중첩 키를 검사 |
| 키 검증 | `SAFE_REL_PATH`로 빌드·설치 양쪽에서 검사(§2.7) | `io.assertSafeRelPath` |
| 설치 (claude/cursor/codex/antigravity/androidstudio 전부) | 공통 `io.writeSkillFiles` — 디렉터리를 **먼저 통째로 지우고**(clean-sync) 다시 씀. 부모 디렉터리는 자동 생성 | 5개 파일 모두 같은 함수 호출 |
| 업데이트 | 같은 clean-sync + 기록 대비 사라진 **스킬 id 디렉터리** prune | `update.js` → `writeSkillFiles`, `syncInstalledRecord` |
| origins 매핑 | 중첩 파일 본문까지 치환됨 | `applyOriginsToResources` 실측 |
| 삭제(uninstall) | `removeSkillDirs`가 `rm -rf`, 이후 빈 부모만 `rmdir`로 정리 | `pruneEmptyDirs`는 비어 있지 않으면 멈춘다 |

실측(임시 디렉터리 왕복): 깊이 4까지 설치됨 → 상류에서 `references/b.md`와 `references/sub/`를
없앤 뒤 재설치하니 **남은 것 없이 정확히 동기화** → uninstall 후 잔여물 0.
현재 사용자 머신의 실제 설치본에도 `references/`가 7개 스킬 모두 존재한다.

**남은 두 가지(릴리스로 해소):**
1. 현재 npm에 게시된 CLI는 `1.8.1`(2026-09-04)로, **중첩 키 자체는 잘 처리하지만**
   (`writeContentFile`가 부모 디렉터리를 만든다) `SAFE_REL_PATH` 검증과 **설치 경로의
   clean-sync가 없다**. 스킬을 **유지하면서 그 안의 파일만 제거**하는 변경이 `latest`에 나가기
   전에 CLI를 릴리스하는 것이 안전하다(`weegloo-npm-publish` 스킬). 스킬 **전체 삭제**는
   1.8.1도 기록 기반으로 prune하므로 문제없다.
2. installer가 `references/`를 **쓰는** 것은 전 agent 공통이지만, **읽는** 것은 harness의 몫이다.
   Claude Code는 따라가는 것이 측정됐고, **Codex·Antigravity는 이 장비에서 측정되지 않았다.**
   모름은 통과가 아니다 — 그래서 §2.3의 "spine 단독 완주" 제약이 있다.

### 6.3 릴리스 체크리스트 (모든 코퍼스 변경 공통)

1. §1.2로 **어디에 둘지** 결정한다.
2. 쓴다. 대조 읽기를 통과할 때까지 원본을 남긴다(§3.3).
3. `node scripts/build-installer-manifest.mjs` — **매니페스트는 본문을 그대로 복사해 담는다.**
   이 단계를 건너뛴 변경은 모든 `npx` 사용자에게 **옛 텍스트**를 배포한다.
4. `cd installer-cli && npm test`.
5. 브랜치를 설치하고 fixtures를 돌려 비교한 뒤 `develop`으로 복구한다(§5.2).
6. **커밋은 사용자에게 확인받고 한다.** 무엇을 커밋할지(파일 목록)와 메시지를 먼저 보여 주고,
   승인받은 뒤에 `git commit`한다 — 사용자가 "커밋해"라고 말하기 전에는 편집만 하고 멈춘다.
   푸시·PR도 같다(§6.4). 측정이 실제로 막혔다면 **통과한 것처럼 쓰지 말고 막혔다고 커밋 메시지에
   적는다.**

### 6.4 Git

- **PR은 항상 `develop`을 타겟으로.** `latest`/`main` 금지. `gh pr create --base develop`.
  (`.claude/rules/git-workflow.md`)
- 커밋 메시지는 한국어로, **왜**를 적는다 — 무엇을 측정했고 무엇을 측정하지 못했는지 포함.

---

## §7 환경 함정

- **`perl -i`는 Windows에서 `.bak`을 남긴다.** 그 파일이 스킬 파일로 잡혀 매니페스트 빌더가
  거부한다(`skill file key is not a safe relative path`). Edit 도구나 Node 스크립트를 쓴다.
- **이 셸의 heredoc은 역슬래시를 먹는다.** 정규식을 인라인하지 말고 스크립트 파일로 쓴다.
- 러너·테스트를 파이프로 넘기지 않는다(§5.3).

---

## §8 상태 문서 위치

| 문서 | 내용 |
|---|---|
| `docs/restructure/PLAN.md` | 이 구조가 나온 설계와 요구사항, 단계별 계획 |
| `plugins/weegloo/GATE-INVENTORY.md` | 항상 로딩되어야 하는 게이트 문장 목록 (§4.1) |
| `plugins/weegloo/FACT-OWNERS.md` | 한 사실의 소유자와 드리프트 가드 (§4.2) |
| `tests/README.md` | 두 계측기(fixtures / 통제)의 사용법 |
| `tests/baseline.develop.json`, `tests/run.*.json` | 스코어카드 — 프로비넌스(ref·sha·dirty·코퍼스 바이트) 포함 |
| `installer-cli/README.md` | CLI 사용법·플래그·설치 레이아웃 |
