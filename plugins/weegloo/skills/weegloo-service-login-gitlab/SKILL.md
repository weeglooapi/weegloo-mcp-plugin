---
name: weegloo-service-login-gitlab
description: GitLab OAuth 2.0 setup for a Weegloo ServiceLogin (self-hosted GitLab too): the steps to register an application and get `clientId`/`clientSecret` (GitLab's Application ID / Secret), the GitLab Redirect URI to register on auth.weegloo.com, scopes being mandatory while `read_user` alone suffices, keeping Confidential on, the Secret shown only once, and the walkthrough to hand the user when asking for those blocking credentials. Use ONLY when the chosen provider is GitLab — never for Google, GitHub, Facebook, LINE, Kakao or Naver. Spine: `weegloo-service-login-client`. 깃랩 로그인.
---

# Weegloo ServiceLogin — GitLab provider setup

This is the **GitLab instance** of the provider-agnostic ServiceLogin setup. It covers only the
**GitLab** side: registering the application and producing the `clientId` / `clientSecret` that
`ServiceLogin` needs. Everything else (the `auth.weegloo.com` wire protocol, the SDK, `callbackUrl`,
`exchangeToken`, ACMA/ACDA scope) is provider-agnostic and lives in the spine.

> **Prerequisite gate.** Use this **only after** you have a ServiceLogin design from
> **`weegloo-service-login`** (the conceptual model) and the wire-protocol/SDK flow from
> **`weegloo-service-login-client`** (the spine). This skill does **not** decide whether to use GitLab —
> the provider must already be chosen from the product's actual need. **Do not use this for a
> non-GitLab provider** (other providers follow the same *shape*, but their console steps differ —
> Google, GitHub, Facebook, Kakao, Naver, and LINE have their own dedicated skills).

## GitLab's Redirect URI (deploy-independent — register it now)

In the GitLab application form the field is **Redirect URI**. Its value, with the real `{spaceId}`
substituted:

```diff
+ https://auth.weegloo.com/v1/spaces/{spaceId}/login/oauth2/code/gitlab
```

The leading **`+ `** renders the line green (`weegloo-global-rules` → *Highlight what the user
must act on or must know*) and is **not part of the URI** — the **Redirect URI** field takes the
`https://…` text only. **Tell the user this URI up front, before you build**, not only when you
ask for the credentials (`weegloo-service-login` → *Tell the user the provider Redirect URI UP
FRONT*).

- The `/code/` segment is required — it is the **GitLab → Weegloo** callback, **not** the browser entry
  URL (`…/login/oauth2/gitlab`). Putting `/code/` in the entry URL, or the entry URL in this field,
  breaks sign-in (spine pitfall **A**).
- It depends only on `auth.weegloo.com` + your `spaceId` + `gitlab`, so it is **fully known now** —
  register it before the app is deployed (spine pitfall **G**). `callbackUrl` is the deploy-dependent
  one; this is not.
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

Then create the `ServiceLogin` with those values (provider `gitlab`), plus `defaultRole` and
`callbackUrl` per the spine. **Do not** finish with only the `ServiceUserRole` created and the
credentials written off as "add later" — a role with no `ServiceLogin` is **blocked-pending-input**, so
end the turn by *asking for the credentials*, not by reporting GitLab sign-in as done.

## GitLab-specific note — `read_user` is the whole scope list

GitLab has the user pick the application's allowed scopes, and **refuses to save when none is
ticked** — so this field cannot be skipped.

**`read_user` is all Weegloo needs.** It reads the member's email there and stores it on the
`ServiceUser`, and a Space admits one account per email.

`api` and `read_api` in the same list reach GitLab data at large, repositories and issues included.
Sign-in never uses them, so **leave them off** — ticking them overshoots least privilege and widens
the blast radius of a leaked secret.

## Related

- **Provider-agnostic spine (wire protocol, SDK, `callbackUrl`, pitfalls):** **`weegloo-service-login-client`**.
- **Conceptual model (ServiceLogin / ServiceUserRole / ServiceUser):** **`weegloo-service-login`**.
- **Other dedicated provider skills:** **`weegloo-service-login-google`** (Google), **`weegloo-service-login-github`** (GitHub), **`weegloo-service-login-facebook`** (Facebook), **`weegloo-service-login-kakao`** (Kakao), **`weegloo-service-login-naver`** (Naver), **`weegloo-service-login-line`** (LINE).
- **Picking the API combo per service type:** **`weegloo-service-architecture`**.
