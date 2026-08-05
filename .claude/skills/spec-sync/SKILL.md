---
name: spec-sync
description: >
  weegloo-server의 스펙 변경(엔드포인트·MCP 툴·에러코드 추가/삭제/수정)을 이 레포의
  스킬·룰에 반영한다. Swagger URL + 서버 레포 경로 + git range를 입력으로 받아
  무엇이 바뀌었는지 기계적으로 추출하고, 영향받는 스킬/룰 파일을 근거와 함께
  리포트한 뒤, 사람의 승인을 받고 편집한다. "스펙 반영", "서버 변경 반영",
  "스킬/룰 갱신", "spec sync" 요청에 사용.
---

# 서버 스펙 → 스킬·룰 동기화

이 레포는 **규범 배포 레포**다. MCP 서버 구현은 여기 없고(원격 `ai.weegloo.com/mcp`),
여기 있는 건 에이전트에게 weegloo를 가르치는 스킬 23개 + 룰 7개다. 서버가 바뀌면
사람이 손으로 옮겨 적어야 하는데, 그 "어디를 보고 무엇을 고칠지"를 이 스킬이 담당한다.

> **먼저 맨 아래 "기록된 실패"를 읽어라.** 아래 5건은 전부 이 스킬의 첫 실행에서 실제로
> 터진 것이다. 전부 **조용히** 틀린 답을 냈다 — 에러가 나지 않았다.

## 대원칙 (양보 불가)

1. **Swagger = 정본, 서버 레포 = 해설.**
   "무엇이 존재하는가"는 **배포된 Swagger로만** 판정한다. 서버 레포에는 미배포 기능이
   섞여 있고(feature 브랜치뿐 아니라 develop에도), 그걸 룰에 반영하면 **사용자
   에이전트가 존재하지 않는 기능을 안내한다.** 서버 레포는 "왜/어떻게 동작하는가"를
   캐는 용도로만 쓴다. → Swagger에 없으면 **문서화하지 않는다.**

2. **추측 금지 · 승인 없이 편집 금지.**

3. **에이전트의 행동을 바꾸는 변경만 대상이다.**
   이 레포의 독자는 사람이 아니라 **weegloo를 다루는 에이전트**다. 따라서 판정선은
   "**이 변경 때문에 에이전트가 다르게 행동해야 하는가**"이다. 아니라면 서버에서
   아무리 큰 변경이어도 **여기서는 대상이 아니다.** 내부 리팩터링·성능·인프라·
   마이그레이션·로깅을 스킬에 옮겨 적으면 룰만 비대해지고 신호가 묻힌다.
   → 감지(Step 1)와 반영(Step 5)은 다르다. **그 사이에 Step 1e 트리아지가 있다.**

---

## Step 0 — 입력 확정 (STOP GATE)

**세 입력이 사용자 확인으로 확정되기 전에는 Step 1 이후를 실행하지 않는다.**

| 입력 | 역할 | 없을 때 |
|---|---|---|
| `SERVER` — weegloo-server 로컬 경로 | 해설 | 형제 디렉터리를 **후보로 제안**하고 확인받는다 |
| `BASE`..`HEAD` — 서버 레포 git range | 변경 감지 범위 | **반드시 물어본다** |
| `SWAGGER` — plane별 OpenAPI JSON URL **목록** | **정본.** 배포 여부 판정 | 사용자에게 요청. 호스트를 지어내지 말 것 |

### 🔴 이 게이트를 우회하는 변명 (전부 금지)

첫 실행에서 이 게이트는 **"질문을 구체화하기 위한 사전조사"** 라는 자기합리화로
뚫렸다. 후보를 그럴듯하게 만들려다 Step 1·2·5를 다 돌려버렸고, 결과적으로
**임의로 고른 범위**의 리포트가 나왔다. 아래는 전부 게이트 위반이다:

- "프리뷰만 돌려서 범위 규모를 보여주면 질문이 구체적이 된다"
- "읽기 전용이니까 괜찮다"
- "어차피 이 경로가 맞을 게 뻔하다"
- "사용자가 `/spec-sync`를 호출했으니 실행을 원한다"

**확정 전에 실행해도 되는 명령은 아래 화이트리스트가 전부다.** 여기 없는 건 하지 않는다.

```bash
# 1) SERVER 후보가 실재하는 git 레포인지
git -C "$CAND" rev-parse --is-inside-work-tree
# 2) BASE 후보를 제안하기 위한 브랜치·날짜 목록
git -C "$CAND" branch -a --format='%(refname:short)  %(committerdate:short)'
# 3) 이 레포의 마지막 서버기준 정정 시점 (BASE 후보 힌트)
git log --oneline --all -i --grep="weegloo-server" -- plugins/weegloo
```

**금지:** `operationId` 추출, ref 간 diff, 에러코드 diff, 플러그인 파일 grep 대조.
전부 Step 1 이후다. 규모를 미리 보여주려 하지 마라 — 사용자는 범위를 정할 때
규모를 몰라도 된다.

### 확정 후 기록

```bash
git -C "$SERVER" rev-parse --short "$BASE" "$HEAD"
git -C "$SERVER" log --oneline "$BASE".."$HEAD" | head -40
```

- **체크아웃된 브랜치는 기준이 아니다.** 판단 기준은 오직 사용자가 준 `BASE`/`HEAD`.
- 확정된 `SERVER` / `BASE`(sha) / `HEAD`(sha) / `SWAGGER` 목록을 **리포트 머리에 박는다.**

---

## Step 1 — 변경 감지 (기계적)

MCP 툴 표면은 컨트롤러의 `@Operation`에서 파생된다:

```
@Operation(operationId = "CreateContentType", description = "[ContentType] ...")
      ├──→ Swagger operationId
      └──→ MCP 툴명  cma_CreateContentType
              └─ ai/src/main/kotlin/com/weegloo/ai/mcp/ToolGroup.kt 가 [Tag]로 그룹 분류
```

### 1a. 스캔 모듈을 **동적으로** 구한다 (하드코딩 금지)

모듈은 이동한다. 실제로 `cma` → `cma-community`로 옮겨간 걸 고정 목록이 못 따라가서
**멀쩡한 엔드포인트 9개를 "삭제됨"으로 오판**한 적이 있다. 목록을 손으로 적지 마라.

```bash
mods_at() {  # $1=ref → 그 ref에서 @Operation 을 가진 모듈 (admin* 제외)
  git -C "$SERVER" grep -l 'operationId = ' "$1" 2>/dev/null \
    | sed "s#^$1:##" | cut -d/ -f1 | sort -u | grep -v '^admin'
}
# base·head 양쪽의 합집합 — 구간 중 생기거나 사라진 모듈도 포착
cat <(mods_at "$BASE") <(mods_at "$HEAD") | sort -u > /tmp/spec-sync-mods.txt
cat /tmp/spec-sync-mods.txt   # 사용자에게 보여준다
```

- `admin` / `admin-community` 만 범위 밖(콘솔 스태프 plane)이다. **그 외에는 낯선
  모듈이 나와도 임의로 빼지 마라** — 뺄 이유가 있으면 리포트 ③에 올려 확인받는다.
- `pay-community`(`[Plan]`, `[ScheduledPlanChange]`)처럼 MCP 비노출이어도 룰 본문에
  영향을 주는 모듈이 있다.

### 1b. operationId + 태그 집합 diff

```bash
ops_at() {  # $1=ref → "module<TAB>operationId<TAB>[Tag]"
  while read -r M; do
    git -C "$SERVER" grep -h -oE 'operationId = "[A-Za-z0-9_]+", description = "\[[^]]*\]' "$1" -- "$M/src" 2>/dev/null \
      | sed -E "s/operationId = \"([A-Za-z0-9_]+)\", description = \"(\[[^]]*\])/$M\t\1\t\2/"
  done < /tmp/spec-sync-mods.txt | sort -u
}
ops_at "$BASE" > /tmp/spec-sync-a.txt
ops_at "$HEAD" > /tmp/spec-sync-b.txt

# 🔴 정상성 단언 — 비었으면 발견이 아니라 버그다. 경고만 찍고 넘어가면 안 된다 (아래 zsh 함정)
if [ ! -s /tmp/spec-sync-a.txt ] || [ ! -s /tmp/spec-sync-b.txt ]; then
  echo "ABORT: operationId 추출 실패 — 루프/경로/ref를 의심하라"; return 1 2>/dev/null || exit 1
fi
# 추가로 규모가 급감하면(예: 직전 실행의 절반 이하) 손으로 확인한다 — 고정 임계값은 쓰지 않는다
wc -l /tmp/spec-sync-a.txt /tmp/spec-sync-b.txt

diff /tmp/spec-sync-a.txt /tmp/spec-sync-b.txt
```

- `>` = 추가, `<` = 삭제. **같은 operationId가 양쪽에 나오면 태그 또는 모듈이 바뀐 것**
  (= MCP 노출 그룹 변경 또는 모듈 이동). 추가/삭제로 오독하지 마라.
- **zsh 함정:** `for M in $MODS` 는 zsh에서 단어분리가 안 돼 **조용히 0건**을 낸다.
  반드시 위처럼 `while read -r` 을 쓰고, 위 단언을 지워버리지 마라.

### 1c. 정합성 확인 — 페어 정규식이 놓친 것 (생략 금지)

1b의 정규식은 `operationId`와 `description`이 **한 줄에 있을 때만** 잡는다.

```bash
ids_at() { while read -r M; do
    git -C "$SERVER" grep -h -oE 'operationId = "[A-Za-z0-9_]+"' "$1" -- "$M/src" 2>/dev/null | sed -E 's/.*"(.*)"/\1/'
  done < /tmp/spec-sync-mods.txt | sort -u; }
comm -23 <(ids_at "$HEAD") <(cut -f2 /tmp/spec-sync-b.txt | sort -u)
```

뜬 건 개별 확인한다. 원인은 둘 중 하나:
- `description`에 `[Tag]`가 없다 → **MCP 비노출, REST 전용**
  (실례: `UnsubscribeEmail` — `description = "Unsubscribe Email."`)
- `@Operation`이 여러 줄로 쪼개져 있다 → 파일을 직접 읽어 태그 확인

### 1d. MCP 그룹 정의 · 에러코드 · 설계문서 diff

```bash
git -C "$SERVER" diff "$BASE".."$HEAD" -- ai/src/main/kotlin/com/weegloo/ai/mcp/ToolGroup.kt
git -C "$SERVER" diff "$BASE".."$HEAD" -- core/src/main/resources/i18n/error-codes.properties
git -C "$SERVER" diff --name-status "$BASE".."$HEAD" -- docs
```

룰이 `WGL422001`·`WGL429001`·`WGL403015` 등을 직접 인용하므로 에러코드도 반드시 본다.

### 1d-2. 스키마 내부 열거형 diff — operationId로는 안 잡히는 축

**엔드포인트가 그대로여도 그 안의 스키마가 바뀐다.** `POST /scripts` 하나로 모든 Script를
만들기 때문에, **statement 타입이 추가·삭제돼도 operationId·에러코드 diff에는 아무것도
뜨지 않는다.** 실제로 `ResourcePageRead` 제거를 이 스킬이 놓쳐 사용자가 지적했다.

판별자의 **실제 값**은 각 statement 클래스의 `const val TYPE = "…"` 다. 클래스명에서 접미사를 떼는
추측(`XxxAction` → `Xxx`)을 쓰지 마라 — 별칭이나 작명 예외에서 조용히 틀린다. **파일 경로도
하드코딩하지 마라**(모듈·패키지는 이동한다 — 실패 #2).

```bash
types_at() {  # $1=ref → Script statement 판별자 값
  git -C "$SERVER" grep -l 'const val TYPE' "$1" -- core 2>/dev/null \
    | sed "s#^$1:##" | grep '/script/' \
    | while read -r f; do
        P=$(printf '%s:%s' "$1" "$f")          # ← 콜론 경로는 printf 로 만든다 (아래 zsh 함정)
        git -C "$SERVER" show "$P" | grep -oE 'const val TYPE = "[A-Za-z]+"'
      done | sed -E 's/.*"(.*)"/\1/' | sort -u
}
types_at "$BASE" > /tmp/spec-sync-ta.txt; types_at "$HEAD" > /tmp/spec-sync-tb.txt

# 🔴 양쪽 모두 비어 있으면 "변화 없음"이 아니라 추출 실패다 — 여기서 멈춘다
if [ ! -s /tmp/spec-sync-ta.txt ] || [ ! -s /tmp/spec-sync-tb.txt ]; then
  echo "ABORT: statement 타입 추출 실패 — 경로/패키지 이동을 의심하라"; return 1 2>/dev/null || exit 1
fi
echo "--- 제거된 statement ---"; comm -23 /tmp/spec-sync-ta.txt /tmp/spec-sync-tb.txt
echo "--- 신규 statement ---";  comm -13 /tmp/spec-sync-ta.txt /tmp/spec-sync-tb.txt
```

> **zsh 함정 — `"$REF:path"` 를 직접 쓰지 마라.** zsh는 `$VAR:a`·`:c`·`:h` 등을 **수정자**로 해석해서
> `"$HEAD:ai/…"` 가 절대경로로, `"$HEAD:core/…"` 가 커맨드경로로 바뀐다(실제로 두 번 당했다).
> 위처럼 **`printf '%s:%s'` 로 조립**해서 넘겨라.

**같은 성격의 축을 항상 함께 본다** (전부 엔드포인트 불변인데 의미가 바뀌는 자리):

| 축 | 어디 | 왜 |
|---|---|---|
| Script statement 타입 | `core/.../script/IStatement.kt` `@JsonSubTypes` | 위 |
| Webhook topic 목록 | 토픽 enum / `hook-design.md` | 구독 가능한 이벤트가 바뀜 |
| 필드 타입·validation 종류 | ContentType 필드 enum | 모델링 지침이 바뀜 |
| `MimeGroup`, 권한 action/filter enum | 각 enum 정의 | 룰이 값을 직접 인용함 |
| 플랫폼 상한 기본값 | `core/.../CoreProperties.kt` | 스킬이 숫자를 박아둔 곳 |

`core/docs/script-definition-syntax.md`(+ `script-definition-samples.md`)는 이 축들의
**서술 정본**이다 — 코드에서 목록을 뽑고, 의미는 이 문서에서 읽는다.

### 1e. 관련성 트리아지 — 감지된 것을 전부 반영하지 않는다

Step 1은 **기계적으로 과다검출**한다(10일 구간에 커밋 126개·신규 에러코드 27개가 나온
적 있다). 대원칙 3에 따라 여기서 걸러낸다. 각 항목에 딱 하나만 물어라:

> **이 변경 때문에 에이전트가 다르게 행동해야 하는가?**

| 대상 (IN) | 대상 아님 (OUT) |
|---|---|
| 리소스·엔드포인트·MCP 툴 추가/삭제 | 내부 리팩터링, 클래스 분해, 패키지 이동 |
| 툴의 그룹 이동(`?group=` 가시성 변화) | 성능·캐시·인프라·배포 파이프라인 |
| 필드 추가/삭제, 검증 규칙, 불변 필드 | DB 마이그레이션, 백필 |
| 기본값·상한·쿼터가 관측 가능하게 바뀜 | 로깅·메트릭·모니터링 |
| **에이전트가 유발할 수 있는** 에러코드 | 내부 500류, 운영자만 보는 코드 |
| 권한/역할 축, 토큰 스코프 | `admin`/`admin-community` 전용 변경 |
| plane 이동(CMA↔ACMA 등), 폐기 예고 | 테스트·빌드·의존성 |

**에러코드 판정법:** 그 코드가 **에이전트나 제품 코드가 만들 수 있는 요청**에 대한
응답인가, 그리고 `suggestion` 문구가 **호출자의 행동 변경**을 요구하는가. 둘 다 예면 IN.

### 🔴 커밋 메시지의 접두사로 판정하지 마라

`refactor:`·`chore:` 라서 무관하다고 넘기면 안 된다. 판정은 **효과**로 한다.

- 실례: `fix: ES 정렬에서 LongText 필드 차단` — 내부 검색엔진 이야기처럼 보이지만
  **LongText 필드로 정렬이 안 된다**는 관측 가능한 제약이다. `weegloo-create-content-type`
  (필드 타입 선택)과 `weegloo-api-query-optimization`(`order` 사용)에 직접 영향한다. **IN.**
- 반대로 `feat:` 라도 admin 전용이거나 에이전트가 도달할 수 없으면 **OUT**이다.

**애매하면 OUT으로 단정하지 말고 리포트 ③(판단 필요)에 올린다.** 조용히 버리는 것이
조용히 넣는 것보다 낫다는 보장은 없다 — 둘 다 사람이 정한다.

---

## Step 2 — MCP 노출 판정 (3분기)

`ai/src/main/kotlin/com/weegloo/ai/reflection/McpAsyncServerHandlerPatcher.kt` 가
`tools/list` 를 `extractFirstBracket(description) in toolGroup` 으로 필터링한다.

| description 형태 | 판정 |
|---|---|
| `[Tag]` 이고 그룹 집합에 있음 | ✅ 그 그룹 URL에서 노출 |
| **`[-Tag]`** (하이픈 접두) | ❌ **숨김** — 어느 그룹에도 매칭 안 됨 |
| 대괄호 태그 없음 | ❌ 애초에 MCP 대상 아님 (REST 전용) |
| `[Tag]` 인데 `groups` 맵의 어느 집합에도 없음 | ❌ 어떤 `?group=` 으로도 안 보임 |

`[-]` 는 실재한다: CMA `EmailAccount`는 REST 5개 중 `UpdateOneEmailAccount`만
`[-EmailAccount]` 라 **MCP 툴은 4개**다. Swagger만 봐서는 안 보인다.

### 그룹 → URL 매핑은 코드에서 읽는다 (README를 믿지 말 것)

```bash
git -C "$SERVER" show "$HEAD:ai/src/main/kotlin/com/weegloo/ai/mcp/ToolGroup.kt" \
  | sed -n '/private val groups/,/^    )/p'
```

- `?group=` 이 **없으면 `basic`** 이다(README의 `{none}` 행).
- 주석 처리된 죽은 그룹(`app`, `ui`, `token`)이 있다. `groups` 맵에 없으면 없는 그룹이다.
- README의 group 설명은 드리프트된 적이 있다. 구성이 바뀌었으면 README도 영향 파일이다.

---

## Step 3 — 정본 게이트 (Swagger 대조)

추가분이 **실제 배포됐는지** 확인한다. 없으면 이번 반영 대상이 아니다.

Step 0에서 받은 **plane별 URL**을 각각 대조한다. plane마다 변수를 따로 두고, **Step 0에서 실제로
받은 plane만** 만든다(`SWAGGER_CMA`, `SWAGGER_CDA`, …).

```bash
# plane 하나당 한 번. 받지 못한 plane은 아예 실행하지 않는다.
curl -fsS "$SWAGGER_CMA" | jq -r '.paths[][].operationId' | sort -u > /tmp/spec-sync-swagger-cma.txt
[ -s /tmp/spec-sync-swagger-cma.txt ] \
  || { echo "ABORT: Swagger 응답이 비었다 — 이 plane은 '게이트 미적용'으로 처리하라"; }
```

- **plane별로 각각 대조한다.** Step 1a가 뱉은 모듈이 여러 plane에 걸쳐 있으면 CMA
  하나로는 게이트가 성립하지 않는다. **URL이 없는 plane의 항목은 "게이트 미적용"으로
  리포트에 명시하고 반영하지 않는다** — 조용히 통과시키지 마라.
- **빈 응답을 "미배포"로 읽지 마라.** fetch가 실패하면 추가분 전체가 미배포처럼 보인다. 위 단언으로
  구분하고, 실패한 plane은 통째로 "게이트 미적용"이다.
- `Accept: application/json` 을 붙이지 마라(벤더 미디어타입). `curl` 기본값 그대로.
- 삭제분은 반대 방향으로 확인 — Swagger에서 사라졌으면 문서에서도 제거 대상.

> **⚠️ 배포되는 룰과 충돌한다 — 임의로 curl 하지 마라.**
> `weegloo-global-rules` / `weegloo-api-endpoints`는 "에이전트는 MCP만, 직접 HTTP·Swagger 호출 금지"
> 이며 **예외를 정확히 두 개**(`policy/terms`, `ai.weegloo.com/v1/version`)로 못박아 뒀다. 그 룰이
> 로드된 세션에서 이 fetch는 위반이다. 순서대로:
> 1. **세션의 MCP 툴 목록**으로 1차 교차검증(아래 "보조 신호").
> 2. Swagger 본문이 필요하면 **사용자에게 받는다** — `! curl …` 로 직접 실행해 붙여넣게 하거나 파일
>    경로를 받는다. 룰과 충돌하지 않는다.
> 3. **사용자가 URL을 건네며 대조를 지시한 경우에만** 에이전트가 직접 fetch한다. 그때도 준 URL만.

### 보조 신호: 현재 세션의 MCP 툴 목록

이 세션에 보이는 `mcp__weegloo__cma_*` 이름은 **실제 배포·노출된 툴 표면**이다.
Swagger 대조의 교차검증으로 쓸 수 있다. 단 **부재는 미배포의 증거가 아니다** — 기본
접속은 `basic` 그룹이라 `collaboration`/`system` 그룹 툴은 배포됐어도 안 보인다.
**존재는 배포의 증거로 쓰되, 부재로 "미배포" 판정을 내리지 마라.**

---

## Step 4 — 해설 수집 (서버 레포)

| 알고 싶은 것 | 볼 곳 |
|---|---|
| 의도·설계 배경 | `docs/*.md` (`script-engine.md`, `hook-design.md`, `email-delivery-design.md` 등) |
| 제약·불변 필드·주의사항 | 해당 컨트롤러의 `@Operation(description=...)` **본문** — 서술이 상세하다 |
| 실패 코드와 문구 | `core/src/main/resources/i18n/error-codes.properties` |
| 요청/응답 형태 | 컨트롤러의 `...Dto` data class |
| 코딩·모델 컨벤션(`Sys` 배치 등) | 서버 레포 `CLAUDE.md` |

---

## Step 5 — 영향 파일 도출

### 5a. 커버리지 판정은 **개념 단위**로 (operationId 문자열 금지)

플러그인 문서는 operationId를 그대로 쓰지 않는다. `weegloo-script` 스킬은 Script를
완전히 다루지만 `CreateScript` 라는 문자열은 없다. operationId로 grep하면 **이미
커버된 것을 "미반영"으로 무더기 오검출**한다(실제로 35건 중 대부분이 그랬다).

```bash
# 태그(리소스) 단위로 묶어서 본다
cut -f3 /tmp/spec-sync-b.txt | sort -u          # 전체 태그
# 그 다음 리소스명·개념어로 대조
grep -rliE "Script|EmailAccount|MFA|SMTP" plugins/weegloo/skills plugins/weegloo/rules README.md
```

판정은 "이 **리소스/개념**을 설명하는 스킬·룰이 있는가"로 한다. 있으면 다음은
"세부(신규 필드·제약·에러코드)까지 최신인가"를 본다.

### 5b. 항상 검토하는 파일 (grep에 안 걸려도)

| 파일 | 왜 |
|---|---|
| `plugins/weegloo/rules/weegloo-api-endpoints.mdc` | plane·엔드포인트·Swagger URL **정본**. "Canonical URLs only here" 때문에 여기만 고치면 되는 경우가 많다 |
| `plugins/weegloo/rules/weegloo-global-rules.mdc` | 하드 게이트와 스킬 라우팅 |
| `plugins/weegloo/skills/weegloo-platform-integration/SKILL.md` | 스킬 **라우터**. 스킬 추가/삭제 시 필수 |
| `plugins/weegloo/skills/weegloo-service-architecture/SKILL.md` | plane·토큰·로그인 조합 선택표 |
| `plugins/weegloo/skills/weegloo-space-role/SKILL.md` | 권한 축이 늘거나 새 리소스에 권한이 붙으면 |
| `README.md` | MCP group 표 |

### 5c. 신규 스킬을 만들 때

- `SKILL.md` **와** `metadata.json` 을 둘 다 만든다:
  `{ "name": "<name>", "version": "1.0.0", "author": "weegloo", "license": "MIT" }`
- **배포되는 스킬·룰 본문은 영어로 쓴다.** 이 spec-sync 스킬과 리포트는 한국어로 좋다.
- 새 스킬은 `weegloo-platform-integration`(라우터)과 관련 스킬 상호참조에 등록해야
  실제로 발견된다. 파일만 만들면 아무도 호출하지 않는다.

---

## Step 6 — 영향 리포트 + 승인 게이트 (여기서 멈춘다)

머리에 `SERVER` / `BASE`(sha) / `HEAD`(sha) / `SWAGGER` 목록 / **스캔한 모듈 목록**을 박는다.

**① 감지된 변경 — 사실만.** operationId · 모듈 · 태그 · MCP 노출 · 그룹.
각 항목에 Swagger 대조 결과(**배포됨 / 미배포 / 게이트 미적용**)를 붙인다.

**①-b 트리아지 결과 — 제외한 것도 밝힌다.** `감지 N건 → 대상 M건 / 제외 (N−M)건`을
숫자로 적고, 제외분은 사유별로 묶어 한 줄씩 남긴다(예: "내부 리팩터링 12, admin 전용 5,
로깅/메트릭 3"). **조용히 버리지 마라** — 제외 목록이 없으면 승인자는 전수 검토된
것으로 오해한다. 제외가 애매했던 항목은 ③으로 올린다.

**② 영향 파일 — 근거와 함께.** `파일 | 왜 | 무엇을` 3열. "왜"는 그 파일이 무엇의
정본인지로 답한다. 추측이면 ③으로 내린다.

**③ 판단 필요 — 사람이 정할 것.** 미배포 여부, `[-]` 마커의 의도, 낯선 모듈의 범위
포함 여부, 독립 스킬 신설 여부 등. **여기가 비면 대개 ②에 추측을 섞은 것이다.**

→ 승인 없이 Step 7로 넘어가지 않는다.

---

## Step 7 — 편집

- 승인된 ② 목록만 고친다. 김에 다른 걸 정리하지 않는다.
- **추가**: 정본(`weegloo-api-endpoints.mdc`)부터 고치고 나머지는 참조하게 한다.
  같은 URL·스펙을 여러 파일에 복제하지 마라.
- **삭제**: `grep -rn` 으로 잔존 언급을 훑는다. 스킬 본문뿐 아니라 **다른 스킬의
  상호참조 목록**과 `weegloo-platform-integration` 라우터에 남기 쉽다.
- MCP 툴명을 적을 땐 Step 2의 3분기 판정을 반영한다. `[-]`거나 태그가 없으면
  "MCP 툴로는 못 쓴다"고 쓰거나 언급하지 않는다.

### 🔴 쓰는 방식 — 행동규범이지 서비스 문서가 아니다

- **에러코드 번호를 본문에 박지 마라.** `WGL400038` 같은 개별 코드는 서버가 재배치하면 그대로
  낡고, 유지보수 부담만 남는다. **규칙과 결과**를 써라 — "상한을 넘게 선언하면 저장이 거부된다"로
  충분하다. (기존에 이미 인용된 코드는 그 자리에 두고, 지시 범위 밖이면 건드리지 않는다.)
- **에이전트가 다르게 행동하게 만드는 문장만 남긴다.** 내부 구현 명칭(capability enum, 프로퍼티
  변수명)과 배경 설명은 빼라.
- **🔴 연혁을 쓰지 마라 — 현재 시점만 기술한다.** 스킬·룰은 "지금 어떻게 동작하는가"의 스냅샷이다.
  아래는 전부 금지: `X가 제거됐다` · `예전에는 금지였다` · `이제 허용된다` · `Y로 이름이 바뀌었다` ·
  `옛 문서는 Z라고 한다` · `전에는 이게 빠져 있었다`(스킬 자신의 연혁).
  - **삭제된 기능은 언급 자체를 지운다.** "제거됐다"고 적으면 없는 기능의 이름을 다시 가르치는
    셈이고, 룰 길이만 늘어난다.
  - 다만 **현재의 부재를 말하는 문장은 연혁이 아니다** — "커서 페이징 read statement는 없다",
    "`password`는 조회할 수 없다"는 지금의 사실이라 남긴다. 기준은 시제가 아니라
    **"이 문장이 지금의 행동을 규정하는가"** 다.
  - 옛 지침을 학습한 에이전트를 되돌릴 필요가 있어도, **현재 규칙을 단정적으로 쓰는 것**으로 족하다
    (`Loop body에 외부호출을 놓을 수 있다`). 무엇이 바뀌었는지는 커밋 메시지의 일이다.
- **한 항목은 몇 줄로 끝낸다.** 스펙을 전사하지 말고 압축한다. 서버 문서를 옮겨 적고 싶어지면
  그건 링크로 대신할 신호다.

---

## Step 8 — 마무리

- **`plugins/weegloo/installer-manifest.json` 은 손대지 않는다.** CI
  (`.github/workflows/installer-manifest.yml`)가 재생성·커밋한다. 수동 편집은 충돌만 만든다.
- **커밋·푸시는 사용자 승인 후에만.** PR은 `.claude/rules/git-workflow.md`에 따라 항상 `--base develop`.
- 공지는 별도 **`/announce`** 스킬. 이 스킬은 공지하지 않는다.
- 이번에 쓴 `HEAD` sha를 알려준다 — 다음 실행의 `BASE` 후보다.

---

## 기록된 실패 (첫 실행에서 실제로 터진 것 — 전부 조용히 틀렸다)

| # | 증상 | 원인 | 방어 |
|---|---|---|---|
| 1 | Step 0을 건너뛰고 임의 범위로 Step 1~5를 실행 | "질문 구체화를 위한 사전조사"라는 자기합리화 | Step 0 화이트리스트 + 금지 변명 목록 |
| 2 | 살아있는 엔드포인트 9개를 "삭제됨"으로 오판 | 모듈 목록 하드코딩. `cma`→`cma-community` 이동을 못 따라감 | 1a 동적 모듈 발견(합집합) |
| 3 | 추출 결과 0건인데 "변화 없음"으로 보고할 뻔 | zsh `for M in $MODS` 단어분리 실패 | `while read -r` + 1b 정상성 단언 |
| 4 | 이미 커버된 리소스 대부분을 "미반영"으로 오검출 | operationId 문자열로 커버리지 판정 | 5a 개념 단위 판정 |
| 5 | CMA Swagger 하나로 다중 plane 변경을 게이트하려 함 | `SWAGGER` 를 단수로 설계 | Step 3 plane별 목록 + "게이트 미적용" 표기 |
| 6 | `ResourcePageRead` statement **제거를 통째로 놓침**(사용자가 지적) | 탐지축이 operationId·에러코드뿐 — 엔드포인트가 그대로면 스키마 내부 변화가 안 보임 | 1d-2 스키마 내부 열거형 diff |

## 가드레일

- **Step 0 확정 전에는 화이트리스트 밖 명령을 실행하지 않는다.** 읽기 전용이어도 안 된다.
- **Swagger에 없는 것을 문서화하지 않는다.** 서버 레포에 코드가 있어도 마찬가지.
- **감지 ≠ 반영.** 에이전트 행동을 바꾸지 않는 변경은 Step 1e에서 걸러내되,
  **제외한 개수와 사유를 리포트에 남긴다.** 커밋 접두사(`refactor:`/`chore:`)로 판정 금지.
- **모듈 목록·경로·ref를 하드코딩하거나 추측하지 않는다.**
- **추출 결과가 0이면 발견이 아니라 버그다.**
- **부재로 미배포를 판정하지 않는다** (MCP 그룹 필터 때문).
- 리포트 승인 전에 이 레포의 파일을 편집하지 않는다.
