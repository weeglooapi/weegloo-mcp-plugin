# GATE-INVENTORY

The sentences below must stay in the **always-loaded** rules. Each one exists because its
absence produces **a result that looks correct and is wrong** — an empty list instead of an
error, an `undefined`, data exposed to the wrong people, a token that works perfectly and is
over-privileged, a gate that silently does not fire. The agent does not know it does not know,
so it would never think to look these up: they cannot be demoted to a skill or behind a link.

**This file is the acceptance criterion for any rules-compression change.** Byte caps cannot
tell "we deleted a duplicate" from "we deleted a gate" — both satisfy a cap equally. The test
`installer-cli/test/budgets.test.js` asserts every fragment below is still found, verbatim
(whitespace-normalized), in the rule that owns it. Removing a line from this file is a
deliberate decision and must appear in a diff as one.

Generated during Phase 4 (see `docs/restructure/PLAN.md`) by classifying every section of every
rule with one question: *if this sentence were absent, would the agent produce a plausible but
wrong result?*

## weegloo-api-endpoints

- `The agent reaches Weegloo through MCP tools, never by calling these URLs directly` — The agent calls CMA/CDA over raw HTTP, gets a correct-looking 200, and reports the work done while bypassing the MCP-only policy — no error ever surfaces.
- `Tokens do not cross identity boundaries.` — Without it the agent designs a flow that hands a ServiceUser token to CDA or a PAT to a member feature; some calls succeed, so the wrong identity model ships and only shows up as a leak or a 401 much later.
- `the Media create that follows goes on the plane matching the identity that uploaded` — Upload accepts both Bearers, so the upload half succeeds; creating the Media on the wrong plane (CMA for a Service User) produces a member-contributed asset owned by nobody the role can scope.
- `Wrong pattern that appears in some tool descriptions: https://cda-weegloo.com (hyphen instead of dot)` — The hyphen host is printed in the weegloo MCP server's own instructions; copied into app code it is a plausible-looking base URL that silently never resolves to Weegloo.
- `Script runs on script.weegloo.com and nothing else` — Agents author a Script on CMA and then call /execute on the CMA host; the 404 reads as "the Script was not created", sending the agent to re-create or re-author instead of changing the host.
- `Never wire a product to that MCP, and never call the REST endpoints "via MCP"` — The two upload paths look interchangeable; a product wired to the agent-only MCP works in the chat session and has no runtime upload at all in production.
- `must first be registered in ServiceLogin.allowedCallbackUrls, or the login entry rejects the request` — A native app's OAuth wiring looks complete and correct; the deep link is simply never accepted, and nothing in the app code points at the missing ServiceLogin update.
- `an empty Deny: [] is NOT its mirror — it denies everything of that kind` — `Allow: []` means no filter, so `Deny: []` reads as no denial; the role saves fine and silently blocks the action entirely — an inverted permission with no error.
- `the reserved :self, which resolves to the currently authenticated caller` — Treated as a literal id, the filter matches no one and the role quietly returns empty sets, or is replaced with a hardcoded directory id that scopes every caller to one user.
- `confusing them saves a role that silently scopes something else` — `self` and `:self` both save without validation error, so a role meant to expose one Script instead scopes by creator (or vice versa) — a permission that looks configured and grants the wrong set.
- `A Script runs its inner Content/Media ops with its AUTHOR's authority, not the caller's` — Assuming caller authority, the agent grants end users write permissions they do not need, or authors a Script as a low-privilege user; the delegation silently over- or under-grants with no runtime error.
- `a 403 there is never fixed by widening content / media` — The instinctive repair after a settings 403 is to broaden the role's content/media maps; that changes nothing and leaves a needlessly over-privileged role behind.
- `The settings action alone is not enough — that axis is TOKEN-gated.` — A SpaceAccessToken carrying SETTING_* in its bound role looks correctly provisioned and is refused on every settings row; the agent keeps adding actions to a role that can never work instead of switching to a console session or PAT.
- `Never fetch a .md URL whose path you cannot trace to one of those two sources` — The docs site is a SPA, so a guessed path returns HTTP 200 with the app shell — a successful-looking fetch that contains none of the documentation the agent then reasons from.
- `do not switch fetch tools on the same guessed path` — The wrong instinct after a shell/403 is to blame WebFetch and retry with curl or a path variant, burning turns while the path stays wrong.
- `in a browser it works perfectly while leaking management rights` — A Weegloo User Bearer authorizes CDA, so the page renders and every test passes; the only symptom is that full management credentials shipped to every visitor.
- `absent or stale on CDA: an empty/old read, not an error.` — Skipping Publish yields an empty list or the previous snapshot with a 200, so the agent debugs the query, the token or the locale instead of publishing.
- `Create automatically publishes — do not add a separate Publish call` — Carrying the CMA publish ritual to ACMA produces failing publish/unpublish calls in an otherwise working flow, and a ServiceUserRole that cannot even hold those actions.
- `Caller identity — the boundary is one-directional, NOT symmetric.` — Assuming symmetry, the agent concludes a PAT cannot reach ACMA/ACDA and builds a redundant ServiceLogin path, or expects a ServiceUser token to reach CMA; both read as correct architecture.
- `GET .../v1/spaces/{spaceId}/me is not an ACMA endpoint` — auth.weegloo.com really does use the space-prefixed form, so the wrong URL looks right; its 404 is read as "no member profile" rather than a wrong path.
- `a 404 there means the path is wrong, not that the Content is missing` — The flat /contents path is valid on CMA/CDA, so on ACMA the agent reads the 404 as a deleted or unpublished row and starts debugging data instead of the URL shape.
- `ACDA exposes BOTH forms` — Generalizing the ACMA restriction to ACDA makes the agent resolve a contentTypeId it does not need, or believe a by-id delivery read is impossible.
- `⚠️ There is no platform-level "own resources only" default.` — Every CMS the agent knows scopes members to their own rows by default; assuming Weegloo does too produces a role that reads and deletes across all members with no error anywhere.
- `is the only thing that limits a member to their own rows` — Omitting the filter yields a working members area where each member silently reaches every other member's content — a data-exposure bug that no test or status code reveals.
- `Moderators are a role WITHOUT the createdBy filter, attached per person via ServiceUser.roleOverride` — Implementing moderation by loosening the default role turns every member into a moderator while the feature appears to work for the intended person.
- `ServiceUser.roleOverride (if set) wins over ServiceLogin.sys.defaultRole` — Believing the two layer together, the agent grants a permission in the default role and expects overridden members to keep it; they silently lose it.
- `Do not ship a Personal Access Token to a browser — it works, which is the problem` — A PAT in client code makes every call succeed; nothing fails, and full account-level credentials are public.
- `never bind Administrator and never the first role in the list` — cma_GetListSpaceRoles returns Administrator first, so binding item[0] produces a token that works flawlessly and hands full write access to every browser visitor.
- `a server-only env read is silently undefined in the browser` — The build succeeds and the page loads; the CDA token is simply undefined at runtime, surfacing as an empty site rather than a configuration error.
- `must send Content-Type: application/json-patch+json` — A JSON Patch body sent as application/json is rejected or misinterpreted per operation, and the agent's instinct is to abandon PATCH for a full PUT that overwrites unrelated fields.
- `The {locale} segment must match that space's fields.file locale key` — A wrong or missing locale segment is not an error — the filter is ignored or matches nothing, returning an empty Media list that reads as "no images in this Space".

## weegloo-global-rules

- `do not decide the task is impossible, and do not quietly build a local-only app instead` — The agent builds a complete-looking local app and reports success while zero Weegloo resources exist; the missing MCP is read as "impossible" rather than "not signed in yet".
- `and edit the config file yourself` — On a weegloo-upload credential failure the agent tells the user to go fix a config file it could have fixed, and the task stalls looking like a user problem.
- `Read a tool's schema BEFORE its first use in a session` — A deferred tool arrives as a name with no parameter list, so a call from memory omits arguments the client cannot check and the server answers with a permission or data error; the agent then debugs credentials or content instead of its own call. Observed as the CreateUpload/spaceId incident below.
- `CreateUpload (weegloo-upload MCP) needs BOTH spaceId AND an absolute filePath` — The schema marks neither required, so an omitted spaceId is not refused locally: it fails the server's permission check and returns 403, which reads as a token problem. Observed: the agent asserted whose account the token was, had the user reissue it in the console, and only then read the schema.
- `silently scatters the work into an arbitrary workspace with no error` — Every create succeeds in the wrong Space. No error is ever raised; the user finds their content in a workspace they did not choose.
- `never a default, never the first item of a list` — Auto-picking the first Organization/Space returns 200s the whole way; the work is simply in the wrong place.
- `if a later request implies a different Space, stop and confirm the switch` — A mid-session Space switch splits one product across two workspaces with no failure signal.
- `do not retry variants or swap fetch tools` — A guessed docs path returns the SPA shell with HTTP 200; the agent then thrashes through path variants and fetch tools, or reads the app shell as if it were documentation.
- `and a request naming no feature is the strongest case for the router, not an exemption` — The agent reads a featureless "build it with Weegloo" as too vague for the router, skips it, and scaffolds a frontend against an architecture nobody chose.
- `do not approximate a schedule with a Webhook or a frontend timer` — A frontend timer or event Webhook demos convincingly and then never fires when nobody has the page open.
- `Never wire a product to the MCP, and never call the raw REST endpoints "via MCP"` — Product code written against the agent-only upload MCP compiles and reviews fine and can never run in production.
- `never emit a YOURAPIKEY placeholder or env-var read — a static build cannot inject one` — The deployed map iframe renders a Google error panel; the page otherwise looks finished, and a static build has no way to fill the placeholder.
- `a length you cannot verify or predict is never a ShortText` — 64 is far below the 255 most CMSes allow, so the agent never thinks to check: a provider id or URL modelled as ShortText creates cleanly, and the write is first rejected on a real value, in production.
- `never ask for the provider's keys` — The agent blocks on a credential that is not a blocking input, or ships an inert checkout that looks wired up.
- `do not generate, draw, download or upload filler` — Generated or scraped filler images look like real content and get published as the user's assets.
- `never emit a YOURAPPKEY placeholder or env-var read` — The address widget needs no key; a placeholder key path ships a lookup button that silently never opens.
- `The password alone is not enough` — On the Gmail default the agent asks for the App Password and never the Google address, so it has no `username`/`fromAddress`: it either stalls a turn asking again, or invents an address and the account silently sends as the authenticated one.
- `Weegloo delivers a real test message before storing anything` — Creating an EmailAccount actually sends mail from the user's account; the agent otherwise treats the call as inert configuration.
- `switching to Administrator after WGL422001` — The token creates successfully and works perfectly while being massively over-privileged in a browser.
- `allowedReferrers (DeliveryAccessToken / SpaceAccessToken) is off by default` — A referrer list set unasked keeps the token looking valid while every call from a new custom domain is refused.
- `resend the existing list` — An unrelated token update silently clears allowedReferrers, widening the token with no error.
- `Anti-escalation — do NOT work around WGL422001` — The instinctive repair (bind a broader role) makes the create succeed and the security posture worse.
- `Space settings are token-gated, not role-gated` — The instinctive repair for the 403 — adding SETTING_* to the bound role — changes nothing, so the agent loops on a role edit that can never work.
- `do not switch Organization/Space to dodge it` — Creating in another workspace makes the quota error disappear and scatters the product across Organizations.
- `never guess a tier` — An invented plan name ("the free plan") reads as verified fact and misdirects a billing decision.
- `Never put a value the user must copy on a red line` — Red reads as removed and the `- ` marker corrupts the pasted value; the block still looks correct.
- `a pasted + produces a mismatch error with no clue why` — The rendering marker rides into a pasted Redirect URI and the provider rejects it for no visible reason.
- `Nothing else may be called over raw HTTP by the agent` — Raw HTTP calls succeed and bypass the MCP-mediated gates; without the closed exception list the agent invents more exceptions.
- `Reading the flat item.space.sys.id yields undefined` — The membership gate compiles and runs, and rejects every genuine member — undefined never matches.
- `the flat /contents paths do not exist there (404)` — The instinctive repair after the 404 is to conclude ACMA is broken or to retry the CMA-shaped path, instead of resolving the ContentType.
- `References are NEVER embedded.` — `fields.image` holds a stub, so the rendered src is undefined — a broken image with no error anywhere.
- `A bare GetListContents returns whole documents` — The call succeeds; every locale bucket of every field lands in the context window and displaces the task, with nothing truncating it.
- `returns an empty list rather than an error` — A substring search without the Advanced Search header answers 200 with zero rows, which reads as "no matches".
- `there is no index for fields., so that part degrades into a scan` — The query passes against seed data and times out in production as the Space fills up.
- `fall back to filtering in memory` — Filtering the loaded page returns plausible results while silently missing every row not yet fetched.
- `both silently return nothing when wrong` — A missing locale segment or ContentType scope yields an empty list, not a malformed-filter error.
- `The header is an HTTP-only lever — the MCP tools cannot send it` — An empty MCP list result is read as "the data is absent", and the same call hangs or times out on a real Space.
- `A list you did not page is not the dataset` — One 15-row page is counted, searched or rendered as the complete set with no error.
- `Changing PART of a Content / ContentType / Media → PATCH (cma_PatchOne*), not PUT` — The full-replacement warning alone teaches "resend everything", so a one-field edit becomes a whole-document PUT that wipes whatever the agent failed to re-read — locale buckets it never projected, metadata, displayField — on a 200, while the per-resource PATCH tools are never reached.
- `Updates are FULL REPLACEMENT: resend ALL fields, not just the changed ones — anything omitted is wiped, with no error` — A partial PUT returns 200 and silently erases every field left out.
- `NOT version or xWeeglooVersion` — A guessed parameter name leaves the version stale, so the agent loops re-reading and retrying a conflict it cannot resolve.
- `must run in the BROWSER` — SSR or a server-side Weegloo client builds and deploys cleanly to WebHosting and then never executes.
- `omitting it does not fail quietly` — The error blames the field type while the path is what is malformed, so the instinctive conclusion is "Refer isn't filterable" and a fallback to id strings.
- `advanced on ResourceFind / ResourceForEach / ResourceCount, defaulting to true. Leave it there.` — Setting `advanced: false` to see a just-written row turns every fields.* query into an unindexed scan that passes on test data and times out in production.

## weegloo-media-lifecycle

- `only Published is served by CDA` — Referencing a Draft/unpublished/Archived Media looks fine in CMA and returns nothing on CDA — no error, just a missing asset in delivery.
- `keeps serving the OLD copy until you publish again` — A `Changed` Media reads back as edited in CMA while delivery keeps the stale published snapshot; nothing errors, so the agent reports the edit as shipped.
- `absent file / locale bucket is NOT the same as` — An absent bucket looks like 'nothing pending = ready'; it is equally the shape of 'no file was ever uploaded for this locale', so the agent declares a non-existent asset deliverable.
- `is not the normal post-upload step` — The instinctive post-upload move is to call cma_PublishOneMedia; the platform already auto-publishes on processing success, so the agent fights the platform or treats its own publish call as proof of readiness instead of polling.
- `wait until sys.status === Published` — A Refer → Media created before processing finishes is accepted with no error; the Content looks correct and the image never loads.
- `is not unlinked from Content` — The delete succeeds with no error while other Content keeps a Refer stub aimed at a row that no longer exists — a reference that expands to nothing.

## weegloo-minimal-load

- `it searches only the rows you happen to hold` — Without it the agent filters a paginated/unknown-size list in memory: the UI shows a plausible, non-empty but INCOMPLETE result set and nothing errors.
- `a data-exposure bug when the rows carry anything the caller must not see` — Read alone, 'compute on the client' licenses pulling a whole collection locally; the screen renders correctly while rows the caller must not see have already been shipped to the browser.
- `This binds the agent's own mcpweegloo reads too` — Read as applying only to generated code, the agent issues unprojected GetList* calls; whole documents land in its context with no error and no truncation.
- `and nothing errors or truncates` — An unprojected list GET returns every locale bucket of every field of every row and looks like a successful read - the cost is invisible at the call site.
- `Never page to count or aggregate` — Walking pages to count produces the CORRECT number, so nothing signals that totalCount was already in the first response.
- `a management-plane read works perfectly while bypassing the delivery cache` — Browser/app reads on CMA/ACMA return correct data with a 200; the missing cache and wrong plane only surface as production load and latency.
- `never on a timer and never per keystroke` — A setInterval/per-keystroke refetch renders a perfectly correct UI while multiplying request volume - there is no failure mode to notice.
- `is a second source of truth and extra write load` — A summary/stats/total Content looks authoritative and renders fine, but silently drifts stale from the rows it was derived from.
- `every Script and Scheduler in the Organization stops` — A Script that merely rearranges client-held data runs successfully every time until the Organization-wide monthly allowance is spent, at which point unrelated Scripts and Schedulers stop - cause far from symptom.
- `an input to be verified, never the truth` — Client-computed amounts/permissions/signatures produce a working, correct-looking flow that is trivially forged; no error is ever raised.
- `the minimum-data rule wins over the client-compute rule, never the other way round` — Without the tiebreak the two halves of this rule appear to authorize over-fetching in order to compute locally - the result renders correctly and leaks or unbounded-loads.
- `poll that one resource by sys.id, projected, with backoff` — An unbounded polling loop works (it eventually sees the result) while burning quota; the carve-out also stops the agent generalizing the ban and blocking legitimate job-await.
- `an unindexed scan that passes on seed data and times out as the Space fills up` — Without the header a fields.* filter returns an empty list rather than an error, and the unindexed path passes every test against seed data, failing only in production.

## weegloo-resource-deletion

- `cascades with the Space — do not delete those first` — Without it the instinctive teardown is to delete the Space's children one by one. Roles, tokens, Webhook, Scheduler, ServiceLogin and EmailAccount have NO dependency check (skill:119-121), so each delete SUCCEEDS with no error — if the teardown is then aborted or only partly applied, the Space's configuration is irreversibly gone and the transcript looks like orderly progress. The four names that actually block are the only ones that need deleting.
- `the SAME check also blocks cmaUnpublishOneContentType` — WGL422010 on delete is readable, but the agent's instinctive repair — unpublish the ContentType so it becomes deletable — is refused by the identical check. Without this sentence the agent loops between two calls that can never both succeed, or concludes the ContentType is undeletable and works around it (duplicate type, orphaned schema) while reporting success.
- `DESTROYS all its Content — say so before proposing it` — "Just delete and recreate the ContentType to change that field" is the natural proposal and executes cleanly — every Content row is destroyed with no error and no warning. The user approves a schema change and loses their data.
- `An archived Content or Media is a live row that still blocks its Space` — Archive succeeds and the rows vanish from the working view, so the agent reports the Space cleaned up. The subsequent Space/ContentType delete is then refused for reasons that look unrelated, and — worse — the user believes data was removed when it is still live in CMA.
- `Emptying a Space you KEEP is the opposite — nothing cascades` — The same rule's cascade sentence is correct for a Space DELETE and exactly backwards for a reset. Without this the agent clears the four blockers, reports the Space initialized, and leaves its Webhooks, Scripts, tokens, ServiceLogin and Tags live — no error anywhere, and the "reset" Space still fires its automation.
- `leaving a dangling stub that expands to nothing on read` — The delete returns 200. Nothing anywhere errors. The breakage appears later and elsewhere: another Content's Refer field expands to nothing, so an image never loads or a relation renders blank. The agent has no signal at delete time that it broke anything.
- `answers the OPPOSITE question` — An agent checking for referrers reaches for `…/contents/{id}/references`, gets an empty or irrelevant answer, concludes nothing points at the target, and deletes — manufacturing exactly the dangling stub it just checked for. The endpoint name reads as the right one, which is why the agent never doubts it.
- `Delete the token, not memberships` — WGL422024 names `SpaceMembership`, so the instinctive repair is to delete memberships. The hidden synthetic one refuses (WGL422022), but the REAL human memberships delete fine — silently revoking live members' access while still not freeing the role.
- `widening a SpaceRole never fixes that refusal` — A refused Space delete reads as a permissions problem, and the instinctive repair is to widen the bound SpaceRole — which cannot help (the gate is token type) and leaves a permanently over-privileged token that works perfectly and is never noticed.
- `a PAT cannot delete an Organization` — A PAT CAN delete a Space, so the agent generalizes it to Organization and offers/attempts an automated teardown that can never complete; the load-bearing half is that the two gates differ, and collapsing them into one clause inverts it.
- `Never resolve a WGL422024 by deleting rows the user has not agreed to lose` — The blocker error names exactly what to delete, so clearing it is mechanical and looks like competent problem-solving. Every one of those deletes is irreversible and none of them errors; the user asked to delete one thing and loses the content behind it.

## weegloo-version

- `however recent lastcheck looks` — Without it the agent reads a recent last_check written by a previous session, silently skips the check, and the user never learns an update exists — a correct-looking silence that is the exact failure the rule exists to prevent.
- `say nothing when the plugin is up to date` — Without it the agent narrates 'checking version… you are up to date' on every first Weegloo request. No error, plausible-looking output, but it turns a silent background check into recurring noise on unrelated work.
- `treat it as unknown and run the check` — A missing or unreadable stamp (fresh install, older installer) would otherwise be read as 'nothing to compare' and the agent skips silently — permanently, since the stamp never appears. Fail-open is the only behaviour that ever surfaces an update.
- `Never overwrite version with the value you just fetched` — The instinctive repair — 'I just fetched the current version, write it to the stamp' — makes every subsequent check compare equal and report 'up to date' while the installed files stay old. No error ever appears; the update path dies permanently.
- `Never drop ref` — Rewriting the stamp as `{last_check, version}` looks like a clean write. `ref` is the branch the agent installed from; losing it silently breaks the update flow for that user with nothing to read as a failure.
- `never read an error as "update available."` — A 500 / deleted-branch / offline response has no `version` field; treating that as a mismatch nags the user to run an update command on a check that never actually succeeded.
- `which counts as an update available, not as a skip` — A stamp with no `version` (install predating version tracking) is exactly the case that most needs updating; 'can't compare, so stay silent' is the plausible-and-wrong reading that leaves the oldest installs never prompted.
- `Do NOT auto-run it` — The helpful instinct is to just run the npx command. It rewrites the user's installed skills and rules without approval — a destructive side effect presented as a successful check.
- `take effect only in a NEW session` — Without it the agent tells the user the update is live; the current session still holds the old text, so the user tests against stale rules and concludes the update failed.
- `never on non-Weegloo work` — Nothing errors if the check runs during unrelated coding; it just injects a fetch and possibly an update nag into work that has no Weegloo involvement.
- `an ISO-8601 LOCAL timestamp` — Writing the stamp in UTC while comparing against local time (or vice versa) shifts the interval by the timezone offset — the throttle silently fires early or never, with a perfectly well-formed file.

## Untouched by design

weegloo-terms-consent, weegloo-web-hosting-rules and weegloo-default-locale were not compressed:
measured at 86% / high / 91% silent-failure content respectively, they are almost entirely gates
already. Their caps in budgets.test.js hold them at their current size.
