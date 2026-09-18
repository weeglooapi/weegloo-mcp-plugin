---
name: weegloo-send-email
description: Make a product SEND EMAIL on Weegloo — notifications, receipts, verification codes, magic links, digests, contact-form forwarding, alerts from scheduled jobs. Covers the EmailAccount SMTP sender + a Script's EmailSend, which vendor to use when the user named none (Google/Gmail, and the App Password and Google address to ask for), Gmail / Naver / Resend / Brevo setup, custom SMTP by plan, and that creating an account really delivers a test message. Use when a product must send mail, when registering, picking, changing or rotating an SMTP sender, or before authoring a Script that sends mail. 메일 보내기, 이메일 발송, 알림 메일, 인증 코드, 문의 폼, SMTP 계정.
---

# Weegloo — sending email from a Space

## When to use

Anything in the product that **puts a message in someone's inbox**: a signup or order confirmation, a
notification, a verification code or magic link, a nightly digest, a contact form that must reach the
owner, an alert from a scheduled job.

Two pieces, always in this order:

1. **`EmailAccount`** — the SMTP sender registered in the Space (**CMA**,
   `/v1/spaces/{spaceId}/email-accounts`). It holds the server, the login, and the From identity.
2. **`EmailSend`** — the Script statement that actually sends one message through that account
   (**`weegloo-script`**). It carries recipient / subject / body and **never** a from-address.

The account must exist first, so vendor selection (below) is the **first** decision, not the last.

`EmailAccount` is a Weegloo-User plane resource, **not** an ACMA/ServiceUser one. A Weegloo User
Bearer or a Personal Access Token can manage it — a `SpaceAccessToken` cannot (see *Permission*).

## Which SMTP vendor — Google is the default, and it is NOT a question

**If the user already named an email service or SMTP vendor** — anywhere in the conversation, the repo,
or an env file (Gmail, Naver, Resend, Brevo, SendGrid, Mailgun, Amazon SES, their company's own
server, …) — **use that one.** Take its host / port / credentials from **that vendor's own
documentation**, and skip the rest of this section.

**If the user named nothing, do not ask "which email service should I use?"** — that is a scoping
question, and it is answered here: **send through Google (Gmail SMTP).** What you *do* ask for is the
one thing only the user can produce — the credential.

### Ask for exactly two values, together, at the step that needs them

- **A Google App Password** — created at **https://myaccount.google.com/apppasswords**. That page is
  where the user creates or manages App Passwords; the value is a **16-character** string Google shows
  **once**.
- **The Google email address that App Password belongs to** — their **real** Google account address.
  **Never an arbitrary, example, or invented address**, and never one you picked for them.

Say, in the user's language, roughly this — the three parts all matter:

> Since no email service was specified, mail will be sent through Google. Please create an App
> Password at https://myaccount.google.com/apppasswords and send it to me together with the Google
> address it belongs to. If you would rather send through a different SMTP service, tell me which one
> and I will use that instead.

- **Announce the default, don't hide it.** The user must know mail will go out through their own Google
  account, and that switching vendors is one sentence away.
- **This is a blocking input** (`weegloo-platform-integration`, step 4): unlike a payments key, there is
  no public default that works. Ask at the moment email becomes the next concrete step, then **stop and
  wait**. Do not ship an inert "email is wired, add the password later" feature and call it done.
- **Ask for an App Password, never the Google account password.** A normal account password will not
  authenticate to Gmail SMTP, and asking for one is wrong regardless.
- **Never put the App Password in the repo** — no `.env`, no config file, no commit. It goes straight
  into the `EmailAccount` create call, where Weegloo stores it write-only; nothing in the app ever reads
  it back.

### Two Google-side gotchas worth naming before they waste a turn

- **The App Password page needs 2-Step Verification.** If the user reports the page is missing or
  refuses to issue one, 2-Step Verification is off on that account (or, on a Workspace account, an admin
  has disabled App Passwords). Then either they enable 2-Step Verification, or you switch vendors — ask
  which.
- **Gmail forces the From address to the authenticated account.** Whatever `fromAddress` you register,
  Gmail rewrites the actual send to the address that authenticated. That is exactly why the address must
  be the user's real Google address: a made-up `fromAddress` does not fail loudly, it silently sends as
  someone else's — the user's own account. Set `fromAddress` = that same Google address and shape the
  visible identity with **`fromName`** instead.

### What to create — only TWO values come from the user

Everything else you fill in yourself. The endpoint is **fixed**, and the two labels are **yours to
write** — never ask about a host, a port, a security mode, a console label, or a display name.

| Field | Value | Comes from |
|---|---|---|
| `endpoint.host` | `smtp.gmail.com` | **fixed — type it, don't deliberate** |
| `endpoint.port` | `587` | **fixed** |
| `endpoint.security` | `StartTls` | **fixed** (pairs with 587) |
| `username` | the Google address the user gave, **verbatim** | the user |
| `password` | the 16-character App Password, **verbatim** | the user |
| `fromAddress` | **byte-identical to `username`** | the same value again |
| `fromName` | the product-facing display name | **you** — derive it from the product |
| `name` | the console label that tells senders apart | **you** — derive it from the product |

```json
{
  "name": "Ocean Stay Gmail",
  "endpoint": { "host": "smtp.gmail.com", "port": 587, "security": "StartTls" },
  "username": "und3rs@gmail.com",
  "password": "<the 16-character App Password>",
  "fromAddress": "und3rs@gmail.com",
  "fromName": "Ocean Stay"
}
```

- **`username` and `fromAddress` are the same string** — copy the address the user gave into both. Do
  **not** compose a `noreply@…`, a `+tag` subaddress, or a domain variant: Gmail authenticates as that
  one account and rewrites the send to it anyway.
- **`fromName` is what the recipient sees** (`Ocean Stay`) — the product's name, not a description of
  the mail. **`name` is a console-only label** for telling multiple senders apart (`Ocean Stay Gmail`,
  or `<Product> order notices` when a Space has several); it is **not** the From display name and never
  reaches a recipient. Both are your call — asking the user for either is a wasted turn.
- Gmail also listens on `465` / `Tls`. Irrelevant here: use 587 / `StartTls` and move on.

## Creating one SENDS a real email — say so first

Weegloo does **not** just store what you give it. Before anything is persisted it **sends one message
through the account**: to `fromAddress`, and also to `username` when that is a different address. If
the server refuses, **nothing is created** (`WGL422067`) and the failure carries the server's own
reason. A host that is not publicly reachable — loopback, private, or otherwise blocked — is refused
outright (`WGL422069`).

- **Tell the user a test message will actually be delivered** before you call create. On the Google
  default `fromAddress` and `username` are the same address, so it is exactly one message, landing in
  the user's own inbox — worth mentioning, so an unexpected mail is not alarming.
- **Never loop retries on failure.** A refusal means the settings are wrong (a mistyped App Password is
  the common one) or the provider is throttling — surface the server's reason, ask for the corrected
  value, and note that **every attempt tries a real send**.
- A create that fails leaves **no** resource behind, so there is nothing to clean up.

## If the user named Naver, Resend, or Brevo

Google stays the default when nobody names a vendor — you are here only because the user named one of
the other three presets (all registrable on every plan). The division of labour is unchanged: **you type
the endpoint, the user produces the credentials.** Two things differ per vendor, and both are where this
goes wrong — what `username` actually is, and what has to be true on the vendor's side first. **Get the
prerequisite done before you call create**: create delivers a real message, so an unverified sending
identity fails the create itself, not some later send.

| Vendor | `endpoint` — you type it | `username` | `password` | `fromAddress` |
|---|---|---|---|---|
| **Gmail** | `smtp.gmail.com` / `587` / `StartTls` | the Google address | the 16-character App Password | the same address, verbatim |
| **Naver** | `smtp.naver.com` / `587` / `StartTls` | the Naver **ID alone** authenticates; the full address also works | the application password | the `@naver.com` address |
| **Resend** | `smtp.resend.com` / `587` / `StartTls` | the literal string **`resend`** — identical for every Resend user, not a credential | the API key | **any** address at the verified domain; no mailbox has to exist |
| **Brevo** | `smtp-relay.brevo.com` / `587` / `StartTls` | the Brevo-issued address ending **`@smtp-brevo.com`**, shown as `Login` under **Your SMTP Settings** | the **SMTP key** | a confirmed sender, or any address at an authenticated domain |

`fromName` and `name` stay yours to write on all four, exactly as on the Google default.

### Hand the user the walkthrough instead of narrating the vendor's console

Each page below is a click-by-click guide with screenshots. Give the link, name the prerequisite, and
ask only for the values in the table above.

- **Gmail** — 2-step verification on, then an App Password.
  https://docs.weegloo.com/getting-started/core-concepts/deployment-and-integration/email/gmail
- **Naver** — POP3/SMTP switched on **and** 2-step verification on, then an application password.
  https://docs.weegloo.com/getting-started/core-concepts/deployment-and-integration/email/naver
- **Resend** — a domain registered and **verified** by DNS records. Without one Resend sends nothing at
  all, so there is no "try it without a domain first" path to offer. Scope the key to **Sending access**
  rather than full access: it is stored in the Space and used indefinitely.
  https://docs.weegloo.com/getting-started/core-concepts/deployment-and-integration/email/resend
- **Brevo** — the sending identity confirmed (a domain authenticated, or that one address confirmed with
  the code Brevo mails to it) **and** a phone number verified on the account, which Brevo demands before
  it will issue any key at all.
  https://docs.weegloo.com/getting-started/core-concepts/deployment-and-integration/email/brevo

### Three traps that burn a create

- **Brevo issues an API key *and* an SMTP key, and only the SMTP key authenticates SMTP.** Putting the
  API key in `password` fails the create. Brevo keys also expire after **90 days of inactivity**, so a
  sender that has been quiet for a quarter stops working and has to be recreated.
- **Resend's `username` is the word `resend`.** Users read that field as "my account" and supply an
  address; the create then fails on authentication. Say plainly that this one value is the same for
  everyone.
- **Naver's `fromAddress` is the account's own address.** Naver is not a domain-sending vendor like
  Resend or Brevo — there is no "any address you like" here.

## Fixed at creation — plan for recreate, not edit

| Field | After create |
|---|---|
| `endpoint` (`host`, `port`, `security`) | **immutable** |
| `username` | **immutable** |
| `password` | **immutable and never readable** — no endpoint returns it, and Update does not accept it |
| `name` (console label), `fromAddress`, `fromName` | editable |

So **moving to another SMTP server, or rotating the App Password, means creating a new account and
deleting the old one.** Do not offer the user an in-place credential change. Repoint any Script's
`EmailSend` `account` at the new id before deleting the old account.

## Two more constraints that change what you can promise

- **The plan decides which SMTP endpoints are allowed.** The **preset vendors — Gmail, Naver, Resend,
  Brevo — are registrable on every plan**; an arbitrary host outside that set (a self-hosted or
  otherwise custom SMTP server) requires a paid plan with a registered payment method and is otherwise
  rejected. So the Google default is also the one that always works. Do not present an arbitrary host as
  guaranteed — and on rejection, follow the plan-limit guidance (explain, link pricing, ask — never
  auto-upgrade).
- **`Update` is REST-only.** Create / list / get / delete are MCP tools (in the **default** tool group,
  and in `all` — but **not** in `core` or `extra`); **updating is not exposed as a tool at all**. As an
  agent you can create and delete an account but cannot edit one over MCP — say that plainly instead of
  guessing a tool name.

## Fields

`name` (label, 1–64 — **not** the From display name) · `endpoint` = `{ host, port, security }` (every
preset listens on **587 / STARTTLS**, and all but **Naver** also on **465 / implicit TLS**; a self-hosted
server may differ) · `username` (SMTP AUTH, provider-defined, often not an email address — on Gmail it
**is** the address, on Resend it is the literal `resend`; see the per-vendor table above) · `password`
(write-only) · `fromAddress` (≤254; used as **both** the SMTP envelope sender and the `From` header) ·
`fromName?` (display name; omit for the bare address).

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
- **`weegloo-webhook`** — send on a content event (order created → confirmation mail).
- **`weegloo-scheduler`** — send on a clock (a nightly digest or reminder).
- **`weegloo-space-role`** — the role's `settings` axis, where `SETTING_EMAIL_ACCOUNT` is granted.
- **`weegloo-api-endpoints`** — CMA base URL and plane selection.
