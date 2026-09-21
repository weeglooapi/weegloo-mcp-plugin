# Naver — ServiceLogin console setup

Read this **only when** the chosen provider is Naver (`naver`). It assumes the spine (`SKILL.md`): the
wire protocol, the SDK, `callbackUrl`, `exchangeToken` and the ACMA/ACDA token boundary are there, not
here.

> **Console language.** Naver Developers has **no English localization** — its console and docs are
> Korean-only. The steps below name each field by its **English meaning**; the live console shows the
> Korean equivalent, so match by meaning/position and look up the current label if a screen has moved.

## Naver's Callback URL (deploy-independent — register it now)

In the Naver Developers console, the **Callback URL** (under the **Naver Login** API settings) is, with
the real `{spaceId}` substituted:

```diff
+ https://auth.weegloo.com/v1/spaces/{spaceId}/login/oauth2/code/naver
```

The leading `+ ` is **not part of the URI** — Naver's **Callback URL** field takes the `https://…` text
only.

- The `/code/` segment is required — it is the **Naver → Weegloo** callback, **not** the browser entry
  URL (`…/login/oauth2/naver`). Putting `/code/` in the entry URL, or the entry URL in this field,
  breaks sign-in (spine pitfall **A**).

## Walk the user through it — `clientId` / `clientSecret` are blocking inputs

The `clientId` / `clientSecret` come from the user's **own Naver Developers application** and only the
user can produce them. So when you reach this step, **stop and ask** — and **don't ask bare**. Hand the
user the illustrated walkthrough, which carries a screenshot of every step:

```diff
+ https://docs.weegloo.com/getting-started/core-concepts/service-users/service-login/naver
```

**Send the link and the facts below — do not retype Naver's menu path.** The page has the clicks in
pictures and is kept current; Naver relocates console pages, so a path pasted from memory goes
stale. What the page cannot know is *your* values and *this* integration's constraints:

- **The Callback URL to register: the URL above, with the real `{spaceId}` filled in** — byte-exact,
  and without the `+ ` (spine pitfall **B**). It is **the same whatever device the member uses**:
  the redirect always targets `auth.weegloo.com`, never your app. So the **environment** you pick
  (PC web, mobile web, or both) only tells Naver which platform the product runs on — pick the ones
  that match it, and register that same URL under each.
- **"API to use" must include Naver Login** — without it the application has no login capability at
  all.
- **Email is opt-in at registration.** Naver returns only the member fields selected under
  *information to collect*, so if the product needs the email address, mark **email required** there
  — retrofitting it later means re-consenting every member.
- **A service URL, if the form demands one, is not part of the handshake** — the app's base URL or a
  placeholder until deploy is fine. The Callback URL is the one that must be exact.
- **Send back: the Client ID (`clientId`) and the Client Secret (`clientSecret`)** from the
  registered application.

## Naver-specific note — development status limits who can sign in

A newly registered Naver Login application starts in **development status**: only the developer account
and explicitly **registered test members** can complete sign-in. Public users are blocked until the app
passes Naver's **review** and goes to production — analogous to Google's *Testing → Test users* gate.

- While building and demoing, add every account that must sign in as a **test member**, or sign in only
  with the developer account — otherwise sign-in fails for outside testers with no code-level fix.

## Naver-specific note — email is mandatory, and Naver returns it only if you asked for it

**Email is mandatory.** Weegloo **rejects the sign-in server-side** and creates **no `ServiceUser`**
when the provider returns no email (the same email-required failure `references/github.md` documents as
`WGL422056`) — so an email-less member is a **blocked sign-in, not a state to tolerate**. Naver returns
email only if **email** is selected **and marked required** in the information-to-collect step (step 3),
and only for accounts that actually have a usable email. Mark email **required** in the console, and
tell end users up front that an account without a shared email cannot sign in.

Then create the `ServiceLogin`: the `providers` entry's **`registrationId`** is `naver`, plus
`defaultRole` and `callbackUrl` per the spine. **Do not** finish with only the `ServiceUserRole`
created and the credentials written off as "add later" — a role with no `ServiceLogin` is
**blocked-pending-input**, so end the turn by *asking for the credentials*, not by reporting Naver
sign-in as done.
