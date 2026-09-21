# Script permissions — `Execute`, the `self` filter, Scheduler owners, async jobs

Read this when the role touches **Script**: granting `Execute` (any / own / one specific), the
`self` `Refer` filter's JSON shape, what a **Scheduler** owner must hold, or the async
external-API **job** ContentType split. For plain Content / Media scoping, stay in `SKILL.md`.

---

## `self` — pin a rule to one specific resource (`Refer`)

Separate from **`createdBy`**, the **`self`** filter scopes a rule to **exactly one named resource**,
by direct reference — regardless of who created it. Its value is a **`Refer`** to that entity
(`Refer<Entity>`): set `sys.id` to the resource's id and `sys.targetType` to its type.

```json
"self": {
  "sys": {
    "type": "Refer",
    "id": "<resourceId>",
    "targetType": "Script"
  }
}
```

- **Primary use — Script.** On the `script` map, `self` pins the action to **one specific Script**.
  e.g. `script.Execute.Allow = [ { "self": { "sys": { "id": "<scriptId>", "type": "Refer", "targetType": "Script" } } } ]`
  lets the caller **`Execute` that one Script and no other** — the least-privilege way to expose a
  single backend endpoint to a group of users without granting "execute any Script."
- **On the `contentType` map — pin to one ContentType.** To scope a `contentType`-map action (e.g.
  `Read`/`Edit` on ContentType definitions) to a **single** ContentType, use `self` (a `Refer` with
  `targetType: "ContentType"`). On the `contentType` map the **`contentType` *filter* is rejected** —
  `self` is the way to narrow it to one type.
- **Contrast with `createdBy`:** `createdBy :self` = "any resource **I created**" (dynamic, by
  author); `self` = "**this one resource**" (fixed, by id) — independent of author.
- **Contrast with `contentType`** (on Content): `contentType` scopes to a whole **type**; `self`
  scopes to a **single instance**.
- **Valid only on the `contentType` and `script` maps** — using `self` on `content` or `media` is
  rejected at save (`WGL400020`). On `script` it is one of the two meaningful filters (with `createdBy`);
  on `contentType` it pins the rule to one specific ContentType.

> Reminder: **`self`** (this filter, a `Refer` to an entity) ≠ **`:self`** (the reserved
> `createdBy.sys.id` value meaning the current caller). Same word, different mechanism.

---

## Recipe — Script `Execute` (let a caller run a Script)

Grant the caller the right to call a Script's `/execute`, without letting them author Scripts.

- On the caller's role (**`ServiceUserRole`** for ServiceLogin → ACMA execute; **`SpaceRole`** for
  Weegloo User / `DeliveryAccessToken`), add a **`script`** map granting **`Execute`**. Scope it:
  - `Allow: []` → may Execute **any** Script (broad);
  - `createdBy :self` → only Scripts the **caller created**;
  - **`self` → exactly one specific Script** (recommended for exposing a single endpoint).
  Do **not** grant `Create`/`Edit`/`Delete` unless the caller should author Scripts.

```json
"script": {
  "Execute": {
    "Allow": [
      { "self": { "sys": { "type": "Refer", "id": "<scriptId>", "targetType": "Script" } } }
    ]
  }
}
```

Use `"Execute": { "Allow": [] }` instead to allow executing **every** Script in the Space.

**`Execute` is also what a Scheduler owner needs.** Creating a **Scheduler** (`weegloo-scheduler`)
requires `script.Execute` covering the target Script — the `self` form above is the right scope — on
top of the `SETTING_SCHEDULER` entry in the role's `settings` array. Unlike an `/execute` call, this grant is
**re-checked before every scheduled run**: revoke it and the Scheduler is deactivated (and not
rescheduled when it comes back).

**Why this is powerful (privilege delegation):** because the Script's inner writes run with the
**author's** authority, granting a caller `Execute` (and nothing else) lets them perform **one
specific privileged operation** they otherwise can't. e.g. end users have **no** write on a `Log`
ContentType, but `Execute` on a `recordEvent` Script lets them **append** log entries through it —
without gaining `content.Create`/`Edit` on `Log` at all. Scope with `self` so it's exactly that one
Script. Full patterns: **`weegloo-script`**.

**Author Scripts as a broadly-permissioned admin; keep end users to `Execute` only.**

> **Deleted as duplicate:** the save-time *author gate* blockquote (the author's role needs an
> unconditional `Allow` per action, `WGL403015`, the Content-`Create` exception, `ResourceCount`)
> is owned by `plugins/weegloo/skills/weegloo-script/SKILL.md:291` (*Author gate*) and summarised
> by the always-loaded rule `plugins/weegloo/rules/weegloo-api-endpoints.mdc:45`.

---

## Recipe — async external-API job Content (Script-written)

When a **ContentType** carries async **request** + **response** for an external API (written by a
**`weegloo-script`**):

| Action | `createdBy` filter |
|--------|-------------------|
| **`Create`** | **Omit** — allow new job rows for the job **ContentType** |
| **`Read`**, **`Edit`**, **`Delete`**, … | **`":self"`** + job **ContentType** `Refer` |

End users submit jobs (**Create**); they may only **read / change / delete their own** job Content.
A **Script** (running with its author's delegated authority) writes **`response`** platform-side
after the external API succeeds — the user's own role never needs `Edit` on the `response` field, so
they cannot forge a completed job.
