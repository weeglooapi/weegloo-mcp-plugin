# GitHub — ServiceLogin console setup

Read this **only when** the chosen provider is GitHub (`github`). It assumes the spine (`SKILL.md`):
the wire protocol, the SDK, `callbackUrl`, `exchangeToken` and the ACMA/ACDA token boundary are there,
not here.

## GitHub's Authorization callback URL (deploy-independent — register it now)

In the GitHub OAuth App, the **Authorization callback URL** is, with the real `{spaceId}` substituted:

```diff
+ https://auth.weegloo.com/v1/spaces/{spaceId}/login/oauth2/code/github
```

The leading `+ ` is **not part of the URI** — GitHub's **Authorization callback URL** field takes the
`https://…` text only.

**Tell the user this URI up front, before you build** (`weegloo-service-login` → *Tell the user the
provider Redirect URI UP FRONT*), not only when you ask for the credentials.

- The `/code/` segment is required — it is the **GitHub → Weegloo** callback, **not** the browser entry
  URL (`…/login/oauth2/github`). Putting `/code/` in the entry URL, or the entry URL in this field,
  breaks sign-in (spine pitfall **A**).
- **GitHub OAuth Apps allow exactly one callback URL** (unlike GitHub *Apps*). So this single value must
  be the `…/code/github` URL above — don't try to also list your app's `callbackUrl` here.

## Walk the user through it — `clientId` / `clientSecret` are blocking inputs

The `clientId` / `clientSecret` come from the user's **own GitHub OAuth App** and only the user can
produce them. So when you reach this step, **stop and ask** — and **don't ask bare**. Hand the user the
illustrated walkthrough, which carries a screenshot of every step:

```diff
+ https://docs.weegloo.com/getting-started/core-concepts/service-users/service-login/github
```

**Send the link and the facts below — do not retype GitHub's menu path.** The page has the clicks in
pictures and is kept current; a path pasted from memory goes stale the next time GitHub rearranges
its settings. What the page cannot know is *your* values and *this* integration's constraints:

- **The Authorization callback URL to register: the URL above, with the real `{spaceId}` filled in** —
  byte-exact, and without the `+ ` (spine pitfall **B**). It is the one field that decides whether
  sign-in works.
- **Personal account or organization** — the OAuth App can live under either; under an organization
  it survives the creator leaving. The user's call, but ask it now rather than after the app exists.
- **Homepage URL is not part of the handshake** — any placeholder (the eventual site URL) is fine.
- **There are no scopes to pick and no consent screen** — a GitHub OAuth App has no scope field
  (that is Google's model), and Weegloo requests `read:user` / `user:email` itself at sign-in.
- **Send back: the Client ID and a newly generated Client secret.** **GitHub shows a secret value
  only once** — say so *before* they generate it, or it is regenerate-and-update-`ServiceLogin`.

## GitHub-specific note — email retrieval can block first sign-in

Weegloo reads the member's email from `GET https://api.github.com/user` only; it does **not** fall back
to GitHub's `/user/emails`. So although Weegloo requests the `read:user` and `user:email` scopes, a
GitHub account whose email is **private** (GitHub's default) returns `email: null` from `/user`, and
Weegloo aborts the sign-in with `WGL422056`.

Where this surfaces matters: it happens server-side on the `…/login/oauth2/code/github` callback,
**before** any redirect to your `callbackUrl`. Weegloo responds with an HTTP 400 and a localized JSON
body on the `auth.weegloo.com` domain (the body carries a localized reason/suggestion, not the literal
`WGL422056` string). There is no `exchangeToken` and no return trip to the app, so the SDK's
`handleCallback()` never runs — the product **cannot intercept or recover from this case at runtime**.

Unlike Google (which always returns a verified email), this is a first-sign-in failure mode specific to
GitHub: the account must have a **public profile email** (GitHub → Settings → Public profile → Email).
Since it can't be handled in code, the only real lever is communicating it to users up front — apply
your own judgment on whether and where that belongs for the product you're building.

Then create the `ServiceLogin`: the `providers` entry's **`registrationId`** is `github`, plus
`defaultRole` and `callbackUrl` per the spine. **Do not** finish with only the `ServiceUserRole`
created and the credentials written off as "add later" — a role with no `ServiceLogin` is
**blocked-pending-input**, so end the turn by *asking for the credentials*, not by reporting GitHub
sign-in as done.
