---
name: weegloo-scheduler
description: Weegloo Scheduler — a cron entry stored in a Space that runs ONE Script on a schedule, with no caller and no request body. Covers the five-field cron expression read in UTC (no seconds field, no @macros, an expression that can never fire is rejected at save), the immutable `script` reference, `activated` semantics (turning it on schedules from that moment — missed occurrences are never caught up), at-most-once runs, the two grants the creator needs (`SETTING_SCHEDULER` on the role's settings axis PLUS `script.Execute` on that one Script — re-checked before every single run, and losing it deactivates the Scheduler), running as the Scheduler's CREATOR (attribution and `:self` resolve to them), each run spending one unit of the Organization's monthly Script-execution allowance (exhausted ⇒ the Scheduler is deactivated and NOT rescheduled), the async timeout budget, per-plan Scheduler counts, and the short-lived SchedulerExecution run history. Use when a product needs recurring or time-based server-side work — a nightly aggregation, a cleanup or expiry sweep, a periodic sync with a third-party API, a digest email, polling an external queue — or when choosing between the clock (this), a Space event (`weegloo-webhook`), and a caller (`weegloo-script` /execute).
---

# Weegloo — Scheduler (cron → Script)

A **Scheduler** is a cron entry that lives in a Space. When its time comes it runs **one Script** —
that is the only thing it can do. It has no body of its own, calls no URL, and takes no payload.

A Script can be started three ways. Pick by **what starts it**:

| What starts it | Resource | Skill |
|---|---|---|
| A caller — frontend, server, third party | `POST …/scripts/{id}/execute` | `weegloo-script` |
| A Space event — content created / published / deleted | **Webhook** | `weegloo-webhook` |
| **The clock** | **Scheduler** | this skill |

> The Script does all the work. This skill only covers *when* it runs and *whose* authority it runs
> with. Statements, `Http`, `EmailSend`, limits, `Return`: **`weegloo-script`**.

## When to use

- **Recurring maintenance** — nightly aggregation, a cleanup or expiry sweep, recomputing a counter.
- **Periodic pull from a third party** — fetch an exchange rate / feed / inventory every hour and
  write it into Content (`Http` + `ResourceCreate` / `ResourcePatch`).
- **Time-based notification** — a daily digest or reminder email (`EmailSend`).
- **Draining a queue the product cannot push from** — poll an external job list every N minutes.

**When NOT to use**

- The work must happen **because content changed** → **`weegloo-webhook`** (an event fires
  immediately; a Scheduler would only poll for it).
- The work must happen **because a user did something** → the frontend calls **`/execute`**.
- **Sub-minute** work, or work that must land on an exact second → the cron floor is one minute and
  firing is approximate (below). Nothing here is a real-time timer.

## The resource

```jsonc
// POST /v1/spaces/{spaceId}/schedulers
{
  "name": "nightly-digest",                 // 1–64 chars
  "script": { "sys": { "id": "scr_abc", "type": "Refer", "targetType": "Script" } },
  "cronExpression": "0 21 * * *",           // five fields, UTC, ≤ 128 chars
  "activated": true
}
```

| Field | Notes |
|---|---|
| `name` | 1–64 chars. A label only; nothing keys off it |
| `script` | `Refer` → a Script **in this Space**. Stored under **`sys.script`** and **immutable** |
| `cronExpression` | five-field cron, **read in UTC**, 1–128 chars |
| `activated` | `false` = kept but never scheduled |

⚠️ **`script` cannot be changed.** It is a `sys` reference and update bodies do not carry it — an
update sends only `name`, `cronExpression`, `activated`. To run a **different** Script, **delete the
Scheduler and create a new one**.

**No version header.** A Scheduler is not versioned, so `UpdateOneScheduler` takes **no
`X-Weegloo-Version`** — unlike Content / Media / ContentType. `PUT` is still a **full replacement**:
send all three mutable fields, not only the one you are changing.

## Endpoints and MCP tools

Management is **CMA only** — there is no ACMA / CDA surface, and a `ServiceUser` can neither own nor
manage a Scheduler.

| Op | Method + path | MCP tool |
|---|---|---|
| List | `GET /v1/spaces/{spaceId}/schedulers` | `cma_GetListSchedulers` |
| Create | `POST /v1/spaces/{spaceId}/schedulers` | `cma_CreateScheduler` |
| Read | `GET …/schedulers/{schedulerId}` | `cma_GetOneScheduler` |
| Update (full replace) | `PUT …/schedulers/{schedulerId}` | `cma_UpdateOneScheduler` |
| Delete | `DELETE …/schedulers/{schedulerId}` | `cma_DeleteOneScheduler` |
| Patch (RFC-6902) | `PATCH …/schedulers/{schedulerId}` | — REST only |
| Run history | `GET …/schedulers/{schedulerId}/executions[/{executionId}]` | — REST only |

- The Scheduler tools ship in the MCP **default** tool group. Use them; do not hand-call CMA HTTP for
  Schedulers from the agent. If they are absent from the session, the Weegloo MCP needs
  re-authenticating / updating (`weegloo-global-rules`) — **do not** fall back to raw HTTP.
- **PATCH and the run history have no MCP tool.** An agent edits with `cma_UpdateOneScheduler` (full
  replacement); the run history is readable from **application code** over REST only.
- `include=1` expands `sys.createdBy` and `sys.script`. The expanded **Script** is filtered by the
  caller's `script` **`Read`** rule, so a caller holding only `SETTING_SCHEDULER` sees the Scheduler
  row but **no expanded Script** — grant `script.Read` too if an admin UI must show which Script each
  Scheduler runs. Project reads with `select` (`weegloo-api-query-optimization`) — an unprojected list
  returns whole documents.

## The cron expression — five fields, UTC

```
┌───────── minute        (0–59)
│ ┌─────── hour          (0–23)
│ │ ┌───── day-of-month  (1–31)
│ │ │ ┌─── month         (1–12 or JAN–DEC)
│ │ │ │ ┌─ day-of-week   (0–7 or MON–SUN; 0 and 7 are both Sunday)
│ │ │ │ │
0 21 * * *
```

- **Five fields — there is no seconds field**, so **one minute is the finest granularity**.
- **No macros.** `@daily`, `@hourly`, `@reboot` are **not** accepted. Write the fields out.
- **Every expression is read in UTC.** There is **no `timeZone` field** — convert from the user's zone
  before saving, and convert back when displaying it.
- **An expression that parses but can never fire is rejected at save** (e.g. `0 0 30 2 *` — February
  30th). Such a rejection is about the expression, not the request.
- **Firing is approximate.** A run starts at, or shortly after, the top of the due minute. Never build
  logic that assumes an exact second, and never assume two Schedulers on the same minute run in a
  defined order.

⚠️ **UTC conversion moves the day, not just the hour — the most common Scheduler bug.** For KST
(UTC+9), "every day 09:00" is `0 0 * * *`, but **"every Monday 09:00" is `0 0 * * SUN`** in UTC, and
"the 1st of the month at 09:00" falls on **the last day of the previous month**. Whenever a
day-of-week or day-of-month schedule crosses midnight in conversion, say so instead of silently
saving the shifted day.

| Intent (in UTC) | Expression |
|---|---|
| Every minute | `* * * * *` |
| Every 15 minutes | `*/15 * * * *` |
| Hourly, on the hour | `0 * * * *` |
| Daily at 03:30 | `30 3 * * *` |
| Weekdays at 09:00 | `0 9 * * MON-FRI` |
| 1st of the month, 00:00 | `0 0 1 * *` |

## Whose authority a run carries

A scheduled run has **no caller**, so identity comes from the Scheduler itself:

- **The run executes as the Scheduler's creator** (`sys.createdBy`). Inside the Script, resource writes
  get that user as `sys.createdBy` / `sys.updatedBy`, and a **`:self`** grant filter resolves to **that
  user**. Not the Script's author, and not whoever last edited the Scheduler.
- **What the Script may do is still fixed by the Script's author**, as on every other Script path:
  statements are not permission-checked one by one, so the **author's** role had to hold the
  Content / Media permissions the Script needs when it was saved (`weegloo-script`).

Design around this: a Script whose `:self` filters were written for an end-user caller behaves
differently on a schedule — `:self` becomes the Scheduler's creator, so it sees **that person's** rows.
For scheduled work prefer explicit filters over `:self`.

## Permissions — two grants, and one is re-checked forever

**1. `SETTING_SCHEDULER`** — every Scheduler and run-history endpoint is gated by this action on the
caller's `SpaceRole` **`settings`** list (`weegloo-space-role`). It is a **distinct action**: a role
that already holds `SETTING_WEBHOOK`, or full Content rights, does **not** have it — add it explicitly
(`SETTING_ALL` covers it, but prefer the specific action).

**2. `script.Execute` on the target Script** — creating a Scheduler additionally requires the caller's
role to permit **`Execute`** on **that Script**. Scope it least-privilege with the `self` filter (one
specific Script) instead of opening Execute on everything — `weegloo-space-role`.

⚠️ **The Execute grant is verified before every single run, not only at create.** Before each firing
Weegloo re-checks that the **creator** may still execute that Script. If the grant is gone — the role
was narrowed, the Script's Execute rule changed, membership removed — the Scheduler is **deactivated on
the spot and not rescheduled**. Restoring the permission does **not** restart it; someone must set
`activated: true` again. So **do not narrow a role's `script` map without checking which Schedulers its
members own.**

*(Update takes no Script reference, so there is nothing to re-check there — the immutable `script` plus
this per-run check is what guarantees a Scheduler never runs a Script its owner may not execute.)*

**Token type is a second gate.** Like every `SETTING_*` row, this axis is reachable only from a
**console login session or a Personal Access Token**. A `SpaceAccessToken`, a `DeliveryAccessToken`, a
Space-scoped console token, and a `ServiceUser` token are refused on **every** Scheduler endpoint
whatever their role says — adding `SETTING_SCHEDULER` to their role changes nothing
(`weegloo-space-access-token`).

## Quotas — a run spends a Script execution

- **How many Schedulers** a Space may hold is **plan-limited** (illustrative: Free **1** / Basic **3** /
  Pro **30** / Enterprise unlimited). On a limit error (`WGL429*`) do not retry in a loop — surface the
  upgrade path per `weegloo-global-rules`. Confirm current caps on the pricing page; never hardcode.
- **How often it may run is not a separate allowance.** Each firing spends **one unit of the
  Organization's monthly Script-execution allowance** — the same budget `/execute` calls draw on.
  `* * * * *` is roughly 43,200 executions a month; that is the real cost of a tight schedule, and it
  competes with the product's own `/execute` traffic.
- ⚠️ **When that allowance is spent, the Scheduler is switched off.** A due run that finds Script
  execution suspended for the Organization does **not** run: the reason is written to the run history,
  `activated` becomes `false`, and it is **not rescheduled**. A new month does not turn it back on —
  someone must. Size the cron to the plan, not to the finest interval that "works".

## What the Script receives — nothing

A scheduled run passes **no payload, no raw body, and no headers**. Inside the Script:

- `{ /payload/… }`, `{ /rawPayload }` and `{ /headers/… }` are **empty**. A Script written for
  `/execute` input, or one that depends on its `payloadSchema`, reads nulls on a schedule.
- What it does have is **`{ /now }`** (`seconds` | `millis` | `iso`), its own `{ /vars }`, and whatever
  it reads for itself (`ResourceFind` / `ResourceRead` / `Http`).

So a scheduled Script **finds its own work**: "every Content of type `job` whose `status` is
`pending`", "everything whose `expiresAt` is before `{ /now/iso }`". Write that `ResourceFind` first and
branch on an empty result.

**Timeout.** A scheduled run is bounded by the same run budget as any other execution — sized by the
`timeoutMs` values the Script declares on `Http` / `EmailSend`, up to the platform cap
(`weegloo-script`). Work that does not fit belongs in smaller resumable runs, not a longer cron.

**`directCallEnabled` does not block a Scheduler.** A Script with `directCallEnabled: false` still runs
on a schedule (and as a Webhook action); that flag only closes the `/execute` endpoints.
**Recommended:** for a Script that exists only to be scheduled, set `directCallEnabled: false` so
nothing outside can trigger it.

## Run history

Each finished run writes a **`SchedulerExecution`**: `startedAt`, `endedAt`, `success`, the Script's
`Return` value as `result`, or `error`. A `Return` with `isError: true` records **`success: false`**.
Long `result` / `error` values are truncated.

⚠️ **The history is short-lived — a record expires about a day after the run ends.** It is a debugging
trail, not an audit log and not a data store. If the product needs a durable record of what a scheduled
run did, have the **Script itself** write it into Content.

Deleting the Scheduler deletes its history with it. These endpoints have no MCP tool, so an agent
cannot read run history over MCP — application code reads it over REST.

## Lifecycle and failure semantics

- **`activated: false` → nothing is scheduled.** Turning it back on schedules it **from that moment**
  onward. **Missed occurrences are never caught up** — nothing is backfilled or replayed.
- **Runs are at-most-once.** When a run's outcome cannot be confirmed, the platform prefers **skipping
  that occurrence over repeating it**. Write scheduled Scripts so a skipped occurrence is harmless — do
  the work from current state, never from "this must be the Nth run".
- **A failing Script does not disable the Scheduler.** The failure is recorded and the next occurrence
  is scheduled as usual. The two things that *do* switch it off are losing the Execute grant and
  exhausting the Script-execution allowance — both above.
- **Deleting the Script is blocked while a Scheduler references it.** Delete the Scheduler first; the
  `script` reference is immutable, so there is no repointing it.

## Worked example — hourly sync into Content

**1. The Script** (`weegloo-script`) — not directly callable, finds its own work:

```jsonc
{
  "name": "sync-rates",
  "directCallEnabled": false,               // only the Scheduler starts it
  "definition": {
    "method": "Post",
    "statements": [
      { "type": "Http", "name": "rates", "method": "Get",
        "url": "https://api.example.com/rates", "timeoutMs": 10000 },
      { "type": "ResourceFind", "resource": "Content", "name": "row",
        "contentType": { "sys": { "id": "ct_rate" } },
        "where": { "fields.code": { "eq": "USD" } } },
      { "type": "If",
        "condition": { "==": [ "{ /row }", null ] },
        "then": [
          { "type": "ResourceCreate", "resource": "Content",
            "contentType": { "sys": { "id": "ct_rate" } },
            "fields": { "code":     { "en-US": "USD" },
                        "value":    { "en-US": "{ /rates/body/USD }" },
                        "syncedAt": { "en-US": "{ /now/iso }" } } } ],
        "else": [
          { "type": "ResourcePatch", "resource": "Content",
            "target": { "sys": { "id": "{ /row/sys/id }" } },
            "fields": { "value":    { "en-US": "{ /rates/body/USD }" },
                        "syncedAt": { "en-US": "{ /now/iso }" } } } ] },
      { "type": "Return", "value": { "ok": true } }
    ]
  }
}
```

**2. The role** — whoever will own the Scheduler needs both grants:

```jsonc
{ "name": "automation-owner",
  "script": { "Execute": { "Allow": [
    { "self": { "sys": { "id": "scr_sync_rates", "type": "Refer", "targetType": "Script" } } } ] } },
  "settings": [ "SETTING_SCHEDULER" ] }
```

**3. The Scheduler** — hourly, on the hour, UTC:

```jsonc
{ "name": "sync-rates-hourly",
  "script": { "sys": { "id": "scr_sync_rates", "type": "Refer", "targetType": "Script" } },
  "cronExpression": "0 * * * *",
  "activated": true }
```

**4. Verify** — after the first due minute, read the run history (`success`, `result`, `error`) or the
Content the Script writes. `sys.updatedAt` on the Scheduler is **not** evidence that a run happened;
the history and the written data are.

## Checklist before creating a Scheduler

1. Is the trigger really **time**, not an event (`weegloo-webhook`) or a caller (`/execute`)?
2. Does the Script work with **no payload** — does it find its own work and handle "nothing to do"?
3. Does the Script fit the run budget (`weegloo-script`), and is `directCallEnabled: false` set if only
   the Scheduler should start it?
4. Is the cron **converted to UTC**, with any day-of-week / day-of-month shift confirmed with the user?
5. Does the intended owner hold **`SETTING_SCHEDULER`** *and* **`script.Execute`** on that Script — from
   a **console session or PAT**, not a SpaceAccessToken?
6. Does the frequency fit the **monthly Script-execution allowance**, alongside the product's own
   `/execute` traffic?
7. Does the Script persist anything the product needs to keep, given the run history expires?

## Related

- **`weegloo-script`** — the Script that does the work: statements, `Http` / `EmailSend`, `/now`,
  limits, author-delegated authority.
- **`weegloo-webhook`** — the event-driven sibling; use it when the trigger is a content change.
- **`weegloo-space-role`** — `SETTING_SCHEDULER` on the settings axis, and the `script.Execute` grant
  with the `self` filter.
- **`weegloo-space-access-token`** — why a SpaceAccessToken cannot manage Schedulers.
- **`weegloo-create-content-type`** / **`weegloo-default-locale`** — the ContentType a scheduled Script
  reads and writes, and its locale buckets.
- **`weegloo-api-endpoints`** — base URLs, vendor JSON, OpenAPI discovery.
