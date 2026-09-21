# GitLab — ServiceLogin console setup

Read this **only when** the chosen provider is GitLab (`gitlab`). It assumes the spine (`SKILL.md`):
the wire protocol, the SDK, `callbackUrl`, `exchangeToken` and the ACMA/ACDA token boundary are
there, not here. It covers only the **GitLab** side — registering the application and producing the
`clientId` / `clientSecret` that `ServiceLogin` needs, on gitlab.com and on a self-hosted GitLab
alike.

## GitLab's Redirect URI (deploy-independent — register it now)

In the GitLab application form the field is **Redirect URI**. Its value, with the real `{spaceId}`
substituted:

```diff
+ https://auth.weegloo.com/v1/spaces/{spaceId}/login/oauth2/code/gitlab
```

The leading **`+ `** is **not part of the URI** — GitLab's **Redirect URI** field takes the
`https://…` text only.

- The `/code/` segment is required — it is the **GitLab → Weegloo** callback, **not** the browser
  entry URL (`…/login/oauth2/gitlab`). Putting `/code/` in the entry URL, or the entry URL in this
  field, breaks sign-in (spine pitfall **A**).
- GitLab's **Redirect URI** field accepts multiple lines, but the value above is the only line that
  belongs there. Do not also list your product's `callbackUrl` in it.

## Walk the user through it — `clientId` / `clientSecret` are blocking inputs

The `clientId` / `clientSecret` come from the user's **own GitLab application** and only the user can
produce them. So when you reach this step, **stop and ask** — and **don't ask bare**. Hand the user
the illustrated walkthrough, which carries a screenshot of every step:

```diff
+ https://docs.weegloo.com/getting-started/core-concepts/service-users/service-login/gitlab
```

**Send the link and the facts below — do not retype GitLab's menu path.** The page has the clicks in
pictures and is kept current; a path pasted from memory goes stale, and on a **self-hosted GitLab**
it is that instance's own UI anyway. What the page cannot know is *your* values and *this*
integration's constraints:

- **The Redirect URI to register: the URI above, with the real `{spaceId}` filled in** — byte-exact,
  and without the `+ ` (spine pitfall **B**).
- **Leave `Confidential` on** (it is the default). The token exchange runs on Weegloo's server
  holding the secret, so this genuinely is a confidential client.
- **Scopes: `read_user`, and only that one** — see the note below.
- **Send back: the Application ID (`clientId`) and the Secret (`clientSecret`).** **GitLab shows the
  Secret only once, right after the application is saved** — say so *before* they click save. If it
  is lost, **Renew secret** issues a new one and the `ServiceLogin` has to be updated with it.

## GitLab-specific note — `read_user` is the whole scope list

GitLab has the user pick the application's allowed scopes, and **refuses to save when none is
ticked** — so this field cannot be skipped.

**`read_user` is all Weegloo needs.** It reads the member's email there and stores it on the
`ServiceUser`, and a Space admits one account per email.

`api` and `read_api` in the same list reach GitLab data at large, repositories and issues included.
Sign-in never uses them, so **leave them off** — ticking them overshoots least privilege and widens
the blast radius of a leaked secret.

Then create the `ServiceLogin`: the `providers` entry's **`registrationId`** is `gitlab`, plus
`defaultRole` and `callbackUrl` per the spine. **Do not** finish with only the `ServiceUserRole`
created and the credentials written off as "add later" — a role with no `ServiceLogin` is
**blocked-pending-input**, so end the turn by *asking for the credentials*, not by reporting GitLab
sign-in as done.
