# Resetting a Space (emptying it without deleting it)

Read this **only when the Space must survive** — "Space 초기화", "안에 있는 거 다 지워줘", clearing a
demo or test Space for reuse. Deleting the Space is the spine (`SKILL.md`); this is the opposite
problem, not a smaller version of it. It assumes the spine's preconditions (unpublish first, busy
files, the `WGL422…` codes) and does not repeat them.

## The inversion

`cma_DeleteOneSpace` pre-checks four counts — ContentType, Content, Media, WebHosting — and once it
is accepted **the platform deletes everything else itself**: roles, memberships, tokens, Locale, Tag,
Webhook, Scheduler, Script, ServiceLogin, ServiceUser, EmailAccount, comments, logs, search views,
the icon.

**Keep the Space and none of that runs.** Nothing cascades, because nothing above it was deleted.
Every row you do not delete yourself survives — and several of them are what makes the next delete
fail. The spine's *"everything else cascades — do not delete those first"* is therefore **inverted
here**: those are exactly what a reset must delete.

## Agree the scope first

A reset is many irreversible deletes. Two different things get called 초기화 — **ask which, in one
question**, and never widen it on your own:

- **데이터만** — ContentType / Content / Media / WebHosting. Configuration untouched.
- **전체** — the above **plus** Webhook, Scheduler, Script, ServiceLogin + ServiceUserRole, access
  tokens, EmailAccount, Tag, app installations, extra Locales, extra SpaceRoles.

**Kept either way:** the Space, its human members, the locked **Administrator** role (`WGL422025`),
and the **default Locale** — a default (`WGL422018`) and a last-remaining (`WGL422017`) Locale are
both undeletable.

## What forces an order

Only these six edges. Everything else may run in any sequence.

| Delete | only after | why |
|---|---|---|
| **ContentType** | every **Content** of that type | `WGL422010`, any status — `Draft` and `Archived` block it too |
| **Tag** | all **Content and Media** | `WGL422024` — a tag still carried by a row is refused |
| **Script** | the **Webhook / Scheduler** that runs it | `WGL422066` / `WGL422110` |
| **ServiceLogin** | every **ServiceUser** | a ServiceUser delete requires a ServiceLogin to exist (`WGL401003`) — delete the login first and its users become permanently undeletable |
| **ServiceUserRole** | **ServiceLogin** and **ServiceUser** | `WGL422029` — a `defaultRole` or a `roleOverride` still points at it |
| **SpaceRole** | the **DeliveryAccessToken / SpaceAccessToken** bound to it | `WGL422024` naming `SpaceMembership` — each token holds a hidden one |

**A Media does not block a ContentType** — a Media has no ContentType. It blocks only the Space and a
Tag, so it may go at any point.

## Working order

1. **WebHosting** — refused mid-deploy (`WGL422031`): wait, do not loop.
2. **Content → ContentType** — unpublish each `Published`/`Changed` one first; page the list with
   `links.next`. A published ContentType that still has Content cannot be unpublished either —
   `WGL422010` guards both doors (spine).
3. **Media** — unpublish, wait for `fields.file.{locale}.state` to settle, delete.
4. **Tag** — now that Content and Media are gone.
5. **Webhook**, **Scheduler**, then **Script**.
6. **ServiceUser**, then **ServiceLogin**, then **ServiceUserRole**.
7. **DeliveryAccessToken** / **SpaceAccessToken**, then the non-locked **SpaceRole**s.
8. **EmailAccount**, **AppInstallation** (refused while installing, `WGL422051`), extra **Locales**.

## What a reset cannot reach

CMA has a delete endpoint for every resource above, but **the MCP tool set does not** — check this
session's tool list. Commonly absent: **Tag**, **ServiceUser**, **AppInstallation**, saved
**search UIs / views**, **comments**. Those survive the reset: name them and point the user at the
console rather than reporting the Space as empty. Comments and snapshots need no action of their own
— they go with the Content, ContentType or Media they hang on.

**Deleting a SpaceMembership emails that person an eviction notice**, so members are never cleared
for tidiness — only when the user asked. A membership whose user is system-created is refused
(`WGL422022`): that is a token's synthetic user, so delete the token.

## Reporting

Give a count per type deleted, and list what stayed and why — Administrator, the default Locale,
members, and anything with no MCP tool. A reset reported as done while Tags and ServiceUsers are
still in the Space is the failure this page exists to prevent.
