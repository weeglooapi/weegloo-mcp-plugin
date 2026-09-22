# LINE — ServiceLogin console setup

Read this **only when** the chosen provider is LINE (`line`). It assumes the spine
(`SKILL.md`): the wire protocol, the SDK, `callbackUrl`, `exchangeToken` and the ACMA/ACDA token
boundary are there, not here. What is here is the **LINE Developers** side: creating the **LINE Login
channel** and producing the `clientId` / `clientSecret` that `ServiceLogin` needs.

## LINE's Callback URL (deploy-independent — register it now)

In the LINE Login channel, the **Callback URL** (under the channel's **LINE Login** settings) is, with
the real `{spaceId}` substituted:

```diff
+ https://auth.weegloo.com/v1/spaces/{spaceId}/login/oauth2/code/line
```

The leading `+ ` is **not part of the URI** — LINE's **Callback URL** field takes the `https://…` text
only.

- The `/code/` segment is required — it is the **LINE → Weegloo** callback, **not** the browser entry
  URL (`…/login/oauth2/line`). Putting `/code/` in the entry URL, or the entry URL in this field,
  breaks sign-in (spine pitfall **A**).
- It depends only on `auth.weegloo.com` + your `spaceId` + `line`, so it is **fully known now** —
  register it before the app is deployed (spine pitfall **F**).

## Before you ask: build the consent screen and hand over its screenshot

LINE's email permission application **requires an uploaded screenshot** (see the email section below),
and that screenshot is of **your product's own screen**. The user cannot produce it if the screen does
not exist yet — they reach the application form, find nothing to upload, and the console trip is
wasted.

So **do this before the credentials ask**, not after:

1. Add the email notice and consent to the product's LINE sign-in area — what email is collected and
   what it is used for. LINE sets the bar for what the image must show; read it there rather than
   guessing: <https://developers.line.biz/en/docs/line-login/integrate-line-login/>
2. Capture that screen and hand the user the image file. With browser tooling, screenshot it
   yourself; without it, deploy and give the user the exact URL plus which part to capture.

Then the credentials ask below can carry the file with it, and the user finishes the whole console
visit in one go.

## Ask once, for everything the console trip produces

The `clientId` / `clientSecret` come from the user's **own LINE Login channel** and only the user can
produce them. So when you reach this step, **stop and ask** — and **don't ask bare**. Hand the user the
illustrated walkthrough, which carries a screenshot of every step:

```diff
+ https://docs.weegloo.com/getting-started/core-concepts/service-users/service-login/line
```

**Ask for the credentials and the email permission in the same message.** Both are done in the same
LINE console session, and the walkthrough above orders them that way — callback URL, then the email
permission application, then copying the two values. Splitting the ask sends the user back into the
console a second time.

**Send the link and the facts below — do not retype LINE's menu path.** The page has the clicks in
pictures and is kept current; LINE relocates console pages, so a path pasted from memory goes
stale. What the page cannot know is *your* values and *this* integration's constraints:

- **The Callback URL to register: the URL above, with the real `{spaceId}` filled in** — byte-exact,
  and without the `+ ` (spine pitfall **B**).
- **The channel is a LINE Login channel with the Web app type enabled** — the browser reaches LINE
  through `auth.weegloo.com`, so **no native/mobile app type is needed**, even for a mobile product.
- **Apply for the email permission in the same visit**, uploading the screenshot you prepared above.
  It is mandatory (see below) and **cannot be edited once submitted**.
- **The two values are named differently than everywhere else:** `clientId` = **Channel ID**,
  `clientSecret` = **Channel secret**. Say it in LINE's words or the user sends the wrong pair.
- **Send back: the Channel ID (`clientId`) and the Channel secret (`clientSecret`).**

**Do not** finish with only the `ServiceUserRole` created and the credentials written off as "add
later" — a role with no `ServiceLogin` is **blocked-pending-input**, so end the turn by *asking for the
credentials*, not by reporting LINE sign-in as done.

## LINE-specific note — LINE's "Provider" is not Weegloo's `registrationId`

In the LINE Developers console, a **Provider** is an owner/organization container, and under it you
create **Channels**. Weegloo's `registrationId` value is `line`; the thing you create in LINE's console
is a **LINE Login channel**. Don't conflate the two.

## LINE-specific note — email is mandatory and needs a separate permission application

**Weegloo requires a member email.** If the provider returns none, Weegloo **rejects the sign-in
server-side** (before any callback) and **no `ServiceUser` is created** — the same email-required
failure `references/github.md` documents as `WGL422056`. A member with no email is therefore a
**blocked sign-in, not a state to design around**: without an email the person simply **cannot use the
service**.

LINE makes this easy to hit: it does **not** return the member's email just because the channel exists.
The **email address permission** must be applied for separately in the channel's **OpenID Connect**
settings. Until LINE grants it, no email is returned and every sign-in is rejected.

Two things about that application change what **you** do, so they are here rather than left to the
walkthrough:

- It requires **a screenshot of the product's own screen** showing the email notice and consent. The
  user cannot produce it if you have not built that screen — which is why it comes before the
  credentials ask (see the section above).
- **Submit is final.** LINE documents only `Unapplied` → `Applied`; there is no edit or resubmit path,
  so a wrong screenshot means contacting LINE support or creating a new channel. `Cancel` before
  submitting is safe — the user can come back.

So treat email as **mandatory setup**, not optional:

- Apply for the LINE **email permission** early — it is a LINE-side approval, not a runtime toggle you
  can flip from code — and don't go live until it is granted.
- Even after approval, a user who **declines** the email consent cannot sign in; the abort is
  server-side and unrecoverable in code, so **tell end users up front** that a shared email is required
  (the same lever as the GitHub case in `references/github.md`).

Then create the `ServiceLogin`: the `providers` entry's **`registrationId`** is `line`, plus
`defaultRole` and `callbackUrl` per the spine.
