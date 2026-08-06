---
name: weegloo-email-account
description: Register an SMTP sender in a Space (EmailAccount, CMA) so a Script's EmailSend can deliver mail. Creating one is NOT inert — Weegloo verifies the settings by actually sending a test message through them before storing anything, so tell the user before you call it. The endpoint and credential are fixed at creation (no password rotation — recreate instead), the password is never readable, the plan limits which SMTP endpoints are allowed, and Update exists on REST but is NOT an MCP tool. Use when a product must send email, when picking or changing an SMTP sender, or before authoring a Script that sends mail. English only.
---

# Weegloo EmailAccount (SMTP sender for a Space)

## When to use

- The product must **send email** — notifications, receipts, verification, digests. A Script's
  **`EmailSend`** takes an `EmailAccount` reference, so the account must exist first
  (**`weegloo-script`**).
- The user wants to **change the SMTP server or rotate the credential** — read the immutability rule
  below before promising an edit.

Lives at **`/v1/spaces/{spaceId}/email-accounts`** on **CMA** — a Weegloo-User plane resource, **not**
an ACMA/ServiceUser one. A Weegloo User Bearer, a Personal Access Token, **or a `SpaceAccessToken`** can
manage it, in every case only if the caller's role carries the permission below
(**`weegloo-space-access-token`**).

## Creating one SENDS a real email — say so first

Weegloo does **not** just store what you give it. Before anything is persisted it **sends one message
through the account**: to `fromAddress`, and also to `username` when that is a different address. If
the server refuses, **nothing is created** and the failure carries the server's own reason.

- **Tell the user a test message will actually be delivered** before you call create. It reaches a real
  inbox.
- **Never loop retries on failure.** A refusal means the settings are wrong (or the provider is
  throttling) — surface the server's reason and let the user fix it.
- A create that fails leaves **no** resource behind, so there is nothing to clean up.

## Fixed at creation — plan for recreate, not edit

| Field | After create |
|---|---|
| `endpoint` (`host`, `port`, `security`) | **immutable** |
| `username` | **immutable** |
| `password` | **immutable and never readable** — no endpoint returns it, and Update does not accept it |
| `name` (console label), `fromAddress`, `fromName` | editable |

So **moving to another SMTP server, or rotating the password, means creating a new account and deleting
the old one.** Do not offer the user an in-place credential change. Repoint any Script's `EmailSend`
`account` at the new id before deleting the old account.

## Two more constraints that change what you can promise

- **The plan decides which SMTP endpoints are allowed.** A host outside the plan's provided set is
  rejected; connecting your own SMTP server requires a higher plan. Do not present an arbitrary host as
  guaranteed to work — and on rejection, follow the plan-limit guidance (explain, link pricing, ask —
  never auto-upgrade).
- **`Update` is REST-only.** Create / list / get / delete are MCP tools (in the **default** tool group,
  and in `all` — but **not** in `core` or `extra`); **updating is not exposed as a tool at all**. As an
  agent you can create and delete an account but cannot edit one over MCP — say that plainly instead of
  guessing a tool name.

## Fields

`name` (label, 1–64 — **not** the From display name) · `endpoint` = `{ host, port, security }` (presets
listen on **587 / STARTTLS** and **465 / implicit TLS**; a self-hosted server may differ) · `username`
(SMTP AUTH, provider-defined, often not an email address) · `password` (write-only) · `fromAddress`
(≤254; used as **both** the SMTP envelope sender and the `From` header) · `fromName?` (display name;
omit for the bare address).

**The sender identity lives here, not in the Script.** `EmailSend` never carries a from-address.

## Permission

Every operation requires the Space-settings permission **`SETTING_EMAIL_ACCOUNT`** — the same class of
right as webhook settings (`SETTING_WEBHOOK`), **not** a Content/Media action. A role that can write
Content does **not** implicitly manage email accounts.

It lives on the role's flat **`settings`** list — a different axis from the `contentType` / `content` /
`media` / `script` maps (**`weegloo-space-role`** → *`settings`*). On a `403` here, add the settings
action; do **not** widen a content permission.

**The settings action alone is not enough — the token type is a second gate.** Like every `SETTING_*`
action, `SETTING_EMAIL_ACCOUNT` is reachable **only from a console login session or a Personal Access
Token**. A **`SpaceAccessToken`** cannot manage email accounts at all, even with the action on its bound
role (**`weegloo-space-access-token`**), and neither can a `DeliveryAccessToken` or a `ServiceUser`
token. Create the `EmailAccount` as an admin; Scripts then send through it with their author's
delegated authority, so the Script's caller needs no email permission.

## Related

- **`weegloo-script`** — `EmailSend` (the only consumer), its recipient/HTML/CR-LF rules, and the
  member-address leak warning.
- **`weegloo-space-role`** — the role's `settings` axis, where `SETTING_EMAIL_ACCOUNT` is granted.
- **`weegloo-api-endpoints`** — CMA base URL and plane selection.
