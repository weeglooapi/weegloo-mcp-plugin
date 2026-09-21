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

**Tell the user this URI up front, before you build** (`weegloo-service-login` → *Tell the user the
provider Redirect URI UP FRONT*), not only when you ask for the credentials.

- The `/code/` segment is required — it is the **LINE → Weegloo** callback, **not** the browser entry
  URL (`…/login/oauth2/line`). Putting `/code/` in the entry URL, or the entry URL in this field,
  breaks sign-in (spine pitfall **A**).
- It depends only on `auth.weegloo.com` + your `spaceId` + `line`, so it is **fully known now** —
  register it before the app is deployed (spine pitfall **F**).

## Walk the user through it — `clientId` / `clientSecret` are blocking inputs

The `clientId` / `clientSecret` come from the user's **own LINE Login channel** and only the user can
produce them. So when you reach this step, **stop and ask** — and **don't ask bare**. Hand the user the
illustrated walkthrough, which carries a screenshot of every step below:

```diff
+ https://docs.weegloo.com/getting-started/core-concepts/service-users/service-login/line
```

Then summarize it inline, with the real `{spaceId}` already filled into the Callback URL above:

1. Go to **LINE Developers Console → (create or select a) Provider → Create a new channel → LINE Login**.
   Give the user **this menu path** — it is the durable anchor. If you also want to hand them a
   clickable link, **find the current one at that moment rather than pasting a hardcoded/memorized
   URL** — LINE relocates console pages, so a literal URL embedded here would go stale; look it up
   (e.g. LINE's official "LINE Login / Integrating LINE Login" docs).
2. Fill the channel form (channel name, region, etc.) and ensure the **Web app** app type is enabled —
   the browser reaches LINE via `auth.weegloo.com`, so no native/mobile app type is needed for this flow.
3. **Register the Callback URL:** on the channel's **LINE Login** tab, add **exactly** the Callback URL
   above (with the real `{spaceId}`).
4. **Get the credentials:**
   - **`clientId` = Channel ID** — on the channel's **Basic settings**.
   - **`clientSecret` = Channel secret** — also on **Basic settings** (issue/copy it there).
5. Send back the **Channel ID** (`clientId`) and the **Channel secret** (`clientSecret`).

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
settings (submit the requested form / screenshot and accept the terms). Until LINE grants it, no email
is returned and every sign-in is rejected.

So treat email as **mandatory setup**, not optional:

- Apply for the LINE **email permission** early — it is a LINE-side approval, not a runtime toggle you
  can flip from code — and don't go live until it is granted.
- Even after approval, a user who **declines** the email consent cannot sign in; the abort is
  server-side and unrecoverable in code, so **tell end users up front** that a shared email is required
  (the same lever as the GitHub case in `references/github.md`).

Then create the `ServiceLogin`: the `providers` entry's **`registrationId`** is `line`, plus
`defaultRole` and `callbackUrl` per the spine.
