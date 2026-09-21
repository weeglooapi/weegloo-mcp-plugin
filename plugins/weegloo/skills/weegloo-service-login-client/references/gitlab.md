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

**Tell the user this URI up front, before you build** (`weegloo-service-login` → *Tell the user the
provider Redirect URI UP FRONT*), not only when you ask for the credentials.

- The `/code/` segment is required — it is the **GitLab → Weegloo** callback, **not** the browser
  entry URL (`…/login/oauth2/gitlab`). Putting `/code/` in the entry URL, or the entry URL in this
  field, breaks sign-in (spine pitfall **A**).
- GitLab's **Redirect URI** field accepts multiple lines, but the value above is the only line that
  belongs there. Do not also list your product's `callbackUrl` in it.

## Walk the user through it — `clientId` / `clientSecret` are blocking inputs

The `clientId` / `clientSecret` come from the user's **own GitLab application** and only the user can
produce them. So when you reach this step, **stop and ask** — and **don't ask bare**. Hand the user
the illustrated walkthrough, which carries a screenshot of every step below:

```diff
+ https://docs.weegloo.com/getting-started/core-concepts/service-users/service-login/gitlab
```

Then summarize it inline, with the real `{spaceId}` already filled into the Redirect URI above:

1. Sign in to GitLab, go to **User settings → Applications**, and click **Add new application**. Give
   the user **this menu path** — it is the durable anchor. If you also want to hand them a clickable
   link, **find the current one at that moment rather than pasting a hardcoded/memorized URL**. On a
   self-hosted GitLab the same path applies on that instance.
2. **Name** — the name the end user sees while signing in.
3. **Redirect URI** — paste **exactly** the URI above.
4. **Confidential** is on by default. **Leave it on.** The token exchange happens on Weegloo's server
   holding the secret, so this app really is a confidential client.
5. **Scopes** — tick `read_user`, and **only** that one. See the note below.
6. Click **Save application**.
7. On the screen that opens, copy the **Application ID** (`clientId`) and the **Secret**
   (`clientSecret`). **GitLab shows the Secret only at this moment** — have them copy it right away.
   If it is lost, **Renew secret** on the same screen issues a new one and the `ServiceLogin` has to
   be updated with it. The **Application ID** stays on that screen.
8. Send back the **Application ID** and the **Secret**.

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
