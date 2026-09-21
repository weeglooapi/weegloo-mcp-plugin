# `settings` — the Space-configuration axis (SpaceRole only)

Read this when the role must **configure the Space** rather than touch data: Webhook, Locale,
ServiceLogin, WebHosting, Tag, token issuance, SpaceMembership, EmailAccount, app install, usage
monitoring, Scheduler. For scoping Content / Media / Script, stay in `SKILL.md`.

## Shape — a flat list, not a map

A **`SpaceRole`** carries one more field beside the `contentType` / `content` / `media` / `script`
maps: **`settings`**. It is a **plain array of action names** — **no `Allow`/`Deny`, no filter
rules.** `contentType` / `createdBy` / `tag` / `self` do **not** apply. Listing an action grants it;
omitting it withholds it. A **`ServiceUserRole` has no `settings` field at all** — Space settings
always evaluate to `false` for a `ServiceUser`.

```jsonc
{ "name": "editor",
  "content":  { "…": { "Allow": [ … ] } },     // maps, with filters
  "settings": [ "SETTING_WEBHOOK", "SETTING_EMAIL_ACCOUNT" ] }   // flat list
```

## Action names (the complete set)

These are the things a role with full Content permissions still cannot touch:

| Action | Gates |
|---|---|
| `SETTING_GENERAL` | the **Space object** itself |
| `SETTING_LOCALE` | **Locale** |
| `SETTING_WEBHOOK` | **Webhook** (+ its calls / status) |
| `SETTING_APP` | **AppInstallation** — market app / bundle install |
| `SETTING_TAG` | **Tag** (create / update / delete) |
| `SETTING_DELIVERY_ACCESS_TOKEN` | **DeliveryAccessToken** |
| `SETTING_SPACE_ACCESS_TOKEN` | **SpaceAccessToken** |
| `SETTING_USER` | **SpaceMembership** |
| `SETTING_ROLE` | **SpaceRole** |
| `SETTING_WEB_HOSTING` | **WebHosting**, **CustomDomain** |
| `SETTING_SERVICE_LOGIN` | **ServiceLogin**, **ServiceUser**, **ServiceUserRole** |
| `SETTING_EMAIL_ACCOUNT` | **EmailAccount** (the SMTP sender — `weegloo-send-email`) |
| `SETTING_MONITORING` | **usage & metrics** — Space monthly reports, network / storage usage |
| `SETTING_SCHEDULER` | **Scheduler** (+ its run history) — the cron entries that run a Script (`weegloo-scheduler`) |
| `SETTING_ALL` | all of the above — **avoid**; grant only the specific actions the caller needs |

That table is the complete set. `settings` accepts these names only — anything else is rejected at save.

## Traps

- **A settings action is not a Content permission.** A `403` on creating a Webhook or an EmailAccount
  needs the **settings** action added — widening `content` / `media` will never fix it.
- ⚠️ **`SETTING_SCHEDULER` alone is not enough to create a Scheduler.** That endpoint checks a
  **second** grant on the same role: **`script`** → **`Execute`** covering the Script the Scheduler
  will run — scoped with a `self` `Refer` to that one Script (`script.Execute.Allow = [ { "self":
  { "sys": { "type": "Refer", "id": "<scriptId>", "targetType": "Script" } } } ]`). And it is not a create-time
  formality: the Scheduler's **creator** must keep that Execute grant, because it is re-checked
  before every run and a Scheduler whose creator has lost it is **deactivated**. So narrowing a
  role's `script` map can silently stop the Schedulers its members own — see **`weegloo-scheduler`**.
- **Grant `settings` on the roles held by *people* (Space members) and by PATs**, not on roles bound
  to tokens; scope token roles with the `content` / `media` / `contentType` / `script` maps instead.
  The whole axis is **token-gated as well as role-gated**, so a settings action on the wrong
  credential changes nothing.

> **Deleted as duplicate:** the token-type gate paragraph (which credentials are refused on every
> `SETTING_*` row, and why adding a settings action never unblocks one) is owned by the
> always-loaded rules `plugins/weegloo/rules/weegloo-global-rules.mdc:62` and
> `plugins/weegloo/rules/weegloo-api-endpoints.mdc:48` — full model:
> **`weegloo-space-access-token`**.
