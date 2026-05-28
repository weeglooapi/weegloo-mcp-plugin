# Eval Prompts (v1)

Eight prompts in **product-level Korean phrasing** — no Weegloo-internal jargon, no API names.
This is on purpose: agents should infer the right surface from intent.

For each prompt:
- **Prompt** — paste verbatim into a clean agent session
- **Intent** — what's actually being tested (don't tell the agent)
- **Expected trajectory** — the "right" answer a senior Weegloo dev would give
- **Anti-patterns to watch for** — concrete bad patterns to flag in the rubric

---

## P1 — 회원제 게시판

**Prompt:**
> Weegloo로 회원제 게시판 만들려고 해. 누구나 가입할 수 있고, 가입한 회원은 글을 쓰고 다른 사람 글도 읽을 수 있어야 해. 어떻게 설계하면 돼?

**Intent:** Service architecture decision — ServiceLogin + ACMA/ACDA, not Weegloo User + CMA/CDA.

**Expected trajectory:**
- Invoke `weegloo-service-architecture` skill (or equivalent)
- Recommend ServiceLogin for end-user sign-up
- ACMA for member writes (own resources)
- ACDA for member reads
- `ServiceUserRole` for default permissions
- Optionally mention `isAdmin` for moderators

**Anti-patterns:**
- Suggests Weegloo User accounts for every member
- Suggests CMA from the browser for member writes
- Suggests one shared DeliveryAccessToken for member-private content
- Skips ServiceLogin entirely

---

## P2 — 블로그 ContentType

**Prompt:**
> 블로그 포스트 ContentType 좀 만들어줘. 필드는 제목, 본문, 발행일, 카테고리 정도면 될 것 같아.

**Intent:** ContentType field type selection — RichText for `본문` (no full-text search planned), ShortText for title/category, Date for 발행일. Plus default-locale handling.

**Expected trajectory:**
- Invoke `weegloo-create-content-type` skill
- Title → ShortText
- 본문 → **RichText** (not LongText — no full-text search context given)
- 발행일 → Date
- 카테고리 → ShortText (or Refer to a Category ContentType, but ShortText acceptable for v1)
- Decide localized vs not (default: localized true unless user says otherwise)
- Note: ContentType create auto-publishes

**Anti-patterns:**
- Picks **LongText for 본문** "because it's long"
- Picks RichText for 카테고리 / 제목
- Adds `validations: []` everywhere without thought
- Forgets `localized` decision entirely

---

## P3 — 포트폴리오 사이트 ContentType

**Prompt:**
> 내 포트폴리오 사이트용 ContentType 만들고 싶어. 프로젝트 하나당 제목, 설명, 썸네일 이미지, 진행 기간, 사용 기술 스택, 외부 링크 정도가 들어가야 해.

**Intent:** Mixed field types — ShortText (title, external link, period), RichText (description), Refer→Media (thumbnail), Array (tech stack). Plus validations (URL on link, mime/size on thumbnail).

**Expected trajectory:**
- Invoke `weegloo-create-content-type`
- 제목 → ShortText
- 설명 → RichText (not LongText)
- 썸네일 → Refer (Media) with `mediaMimetypeGroup: [Image]`
- 진행 기간 → ShortText with regexp validation OR Date range
- 기술 스택 → Array of ShortText
- 외부 링크 → ShortText with URL-shaped regexp
- localized decision per field (thumbnail probably `localized: false`)

**Anti-patterns:**
- Thumbnail as ShortText URL instead of Refer→Media
- Tech stack as one comma-separated ShortText instead of Array
- No `mediaMimetypeGroup` on thumbnail Refer
- Period as RichText / LongText

---

## P4 — 공개 사이트용 토큰

**Prompt:**
> 공개 블로그 사이트에서 콘텐츠 읽으려고 해. 브라우저에서 쓸 수 있는 토큰 좀 발급해줘.

**Intent:** `DeliveryAccessToken` with least-privilege `SpaceRole`. Never Administrator. Never CMA.

**Expected trajectory:**
- Invoke `weegloo-delivery-access-token` skill
- Ask user which ContentTypes the token should read (or list SpaceRoles for them to pick)
- Pick / suggest a **least-privilege read-only role** for the relevant ContentTypes
- Never propose Administrator
- Mention browser distribution constraints (no Personal Access Token in client)

**Anti-patterns:**
- **Binds token to Administrator SpaceRole** (most severe)
- Picks the **first role** from the list without thought
- Suggests a Personal Access Token instead
- Recovers from WGL422001 by switching to Administrator

---

## P5 — WebHosting 배포

**Prompt:**
> 빌드한 정적 사이트가 dist/ 안에 있어. Weegloo에 배포해줘. subdomain은 chanho-portfolio 로 해주고.

**Intent:** WebHosting deploy via MCP only, static-only, max 100 files, ZIP with index.html at root, CheckSubdomain before create.

**Expected trajectory:**
- Invoke `weegloo-web-hosting` skill
- Check `dist/` for index.html at root + file count ≤ 100
- ZIP up the directory
- `weegloo-upload` MCP for the ZIP → Upload resource
- `cma_CheckSubdomain` for chanho-portfolio
- `cma_CreateWebHosting` (or update if exists) with subdomain + Upload reference
- Poll status until COMPLETED

**Anti-patterns:**
- Uses a deploy script (`scripts/deploy-weegloo.mjs`) instead of MCP
- Skips CheckSubdomain
- Doesn't verify index.html at root / file count
- Asks user to bypass MCP for upload

---

## P6 — 다국어 콘텐츠 생성

**Prompt:**
> 블로그 글 하나 만들어줘. 한국어랑 영어 둘 다 있어야 해. 제목은 "Hello, World" / "안녕, 세상", 본문은 첫 글이라는 짧은 인사 정도로.

**Intent:** Default locale invariant — every field needs a default-locale value at create time. Per-locale buckets for localized fields.

**Expected trajectory:**
- Invoke `weegloo-default-locale` skill (or apply its semantics inline)
- Resolve the Space's default locale first
- Build the create payload with **default-locale value present for every populated field**
- Add the non-default locale as additional bucket
- Don't skip the default locale entry

**Anti-patterns:**
- Populates only `ko-KR` (or only `en-US`) when default is the other
- Creates with `localized: false` confusion — putting per-locale map on non-localized field
- Forgets to look up default locale and just picks one
- Creates content for an unpublished ContentType

---

## P7 — Media 안 보임 디버그

**Prompt:**
> 이미지 업로드한 다음에 콘텐츠에 연결했는데, 사이트에서 이미지가 안 보여. 뭐가 문제일 것 같아?

**Intent:** Media lifecycle — `sys.status` (Draft/Changed/Published/Archived) + `fields.file.{locale}.state` (PENDING/PROCESSING/FAILED). Wait until Published before referencing from Content.

**Expected trajectory:**
- Apply `weegloo-media-lifecycle` rule (rule-only, no companion skill exists; D1 scores rule-based response as 2)
- Check `sys.status` of the Media — likely not Published yet (processing in progress)
- Check `fields.file.{locale}.state` — PENDING/PROCESSING means not ready; FAILED means processing failed
- Suggest polling until `sys.status === Published` and file state is null/done
- If FAILED, suggest checking the upload itself

**Anti-patterns:**
- Tells user to manually publish (auto-publish exists after processing)
- Doesn't check `file.{locale}.state` at all
- Suggests re-uploading without diagnosing
- Ignores the lifecycle rule entirely (no diagnostic from media states)

---

## P8 — 회원 인증 (Google 로그인)

**Prompt:**
> 우리 서비스에 Google 로그인 붙이고 싶어. 일반 사용자가 가입하면 바로 쓸 수 있게.

**Intent:** ServiceLogin (Google OAuth) for **end-users (Service Users)**, not Weegloo User invitation. SDK or wire protocol.

**Expected trajectory:**
- Invoke `weegloo-service-login` or `weegloo-service-login-sdk` skill
- Clarify: this is **ServiceLogin** (end-user, open sign-up) — not Weegloo console login
- Recommend `weegloo-service-user` npm SDK for browser apps
- Mention `ServiceLogin.sys.defaultRole` setup
- Token usable against ACMA/ACDA/Upload — never CMA/CDA
- Optionally mention `auth.weegloo.com` wire protocol if SDK unavailable

**Anti-patterns:**
- Suggests inviting every user as a Weegloo User (invite-only platform account)
- Suggests Personal Access Token distribution
- Mixes up ServiceLogin with Weegloo console login
- Routes member API calls through CMA/CDA
