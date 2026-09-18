---
name: weegloo-service-login-facebook
description: Facebook (Facebook Login) OAuth 2.0 setup for a Weegloo ServiceLogin: the Meta app console steps that produce `clientId`/`clientSecret` (Facebook's App ID / App secret), the Facebook Redirect URI to register on auth.weegloo.com, the opt-in `email` permission, the App Review gate that blocks everyone but the creator's account, and the walkthrough to hand the user when asking for those blocking credentials. Use ONLY when the chosen provider is Facebook — never for Google, GitHub, GitLab, LINE, Kakao or Naver. Spine: `weegloo-service-login-client`. 페이스북 로그인, 메타 앱.
---

# Weegloo ServiceLogin — Facebook provider setup

This is the **Facebook instance** of the provider-agnostic ServiceLogin setup. It covers only the
**Meta app console** side: creating the app and producing the `clientId` / `clientSecret` that
`ServiceLogin` needs. Everything else (the `auth.weegloo.com` wire protocol, the SDK, `callbackUrl`,
`exchangeToken`, ACMA/ACDA scope) is provider-agnostic and lives in the spine.

> **Prerequisite gate.** Use this **only after** you have a ServiceLogin design from
> **`weegloo-service-login`** (the conceptual model) and the wire-protocol/SDK flow from
> **`weegloo-service-login-client`** (the spine). This skill does **not** decide whether to use
> Facebook — the provider must already be chosen from the product's actual need. **Do not use this for
> a non-Facebook provider** (other providers follow the same *shape*, but their console steps differ —
> Google, GitHub, GitLab, Kakao, Naver, and LINE have their own dedicated skills).

## Facebook's Redirect URI (deploy-independent — register it now)

In the Meta app console the field is **Valid OAuth Redirect URIs**, under the Facebook Login use
case's **Settings**. Its value, with the real `{spaceId}` substituted:

```diff
+ https://auth.weegloo.com/v1/spaces/{spaceId}/login/oauth2/code/facebook
```

The leading **`+ `** renders the line green (`weegloo-global-rules` → *Highlight what the user
must act on or must know*) and is **not part of the URI** — the **Valid OAuth Redirect URIs** field
takes the `https://…` text only. **Tell the user this URI up front, before you build**, not only when
you ask for the credentials (`weegloo-service-login` → *Tell the user the provider Redirect URI UP
FRONT*).

- The `/code/` segment is required — it is the **Facebook → Weegloo** callback, **not** the browser
  entry URL (`…/login/oauth2/facebook`). Putting `/code/` in the entry URL, or the entry URL in this
  field, breaks sign-in (spine pitfall **A**).
- It depends only on `auth.weegloo.com` + your `spaceId` + `facebook`, so it is **fully known now** —
  register it before the app is deployed (spine pitfall **G**). `callbackUrl` is the deploy-dependent
  one; this is not.

## Walk the user through it — `clientId` / `clientSecret` are blocking inputs

The `clientId` / `clientSecret` come from the user's **own Facebook app** and only the user can
produce them. So when you reach this step, **stop and ask** — and **don't ask bare**. Hand the user
the illustrated walkthrough, which carries a screenshot of every step below:

```diff
+ https://docs.weegloo.com/getting-started/core-concepts/service-users/service-login/facebook
```

Then summarize it inline, with the real `{spaceId}` already filled into the Redirect URI above:

1. Go to the Meta app console (**developers.facebook.com → My Apps**) and click **Create App**. The
   wizard runs **App details → Use cases → Business → Requirements → Overview**. Give the user **this
   menu path** — it is the durable anchor. If you also want to hand them a clickable link, **find the
   current one at that moment rather than pasting a hardcoded/memorized URL**.
2. On **Use cases**, pick **Authenticate and request data from users with Facebook Login**. The other
   entries are for ads and messaging and do not configure sign-in.
3. On **Business**, a business portfolio is not needed to obtain the credentials — the screen itself
   says it can be added later.
4. **Add the `email` permission:** **Use cases → Facebook Login → Customize → Permissions and
   features**, then click **+ Add** on the `email` row. See the note below — this one is easy to skip
   and Facebook will not do it for you.
5. **Register the Redirect URI:** in the same **Customize** screen open **Settings**, paste
   **exactly** the URI above into **Valid OAuth Redirect URIs**, then click **Save Changes**.
6. **Copy the credentials:** **App settings → Basic**. **App ID** is `clientId`; for `clientSecret`,
   click **Show** next to **App secret**. Unlike GitHub or GitLab, Facebook shows the secret again on
   demand, so a lost copy does not force a regeneration.
7. Send back the **App ID** and the **App secret**.

A red **Currently ineligible for submission** banner on that screen (missing app icon, privacy policy
URL, category) is about **App Review**, not about sign-in — the credentials work without it.

Then create the `ServiceLogin` with those values (provider `facebook`), plus `defaultRole` and
`callbackUrl` per the spine. **Do not** finish with only the `ServiceUserRole` created and the
credentials written off as "add later" — a role with no `ServiceLogin` is **blocked-pending-input**, so
end the turn by *asking for the credentials*, not by reporting Facebook sign-in as done.

## Facebook-specific note — `email` is a permission you have to add

A new Facebook app ships with `public_profile` only. `email` sits in the same list with an empty
**Status** and a lone **+ Add** button, and **nothing adds it for you** — so an app that looks
configured can still be one where Facebook never sends an email.

**Weegloo stores a member email on the `ServiceUser`, and a Space admits one account per email.** So
the **+ Add** in step 4 is mandatory setup, not a refinement. Confirm with the user that `email`
shows **Ready for testing** alongside `public_profile` before you treat the provider side as done.

Facebook also allows accounts registered with a phone number rather than an email, and a signing-in
user may decline the email permission. If the product cannot serve a member who arrives without an
email, say so to end users up front — that is a product decision, not something the console settles.

## App Review gates who else can sign in

Until the app passes **App Review**, **only the account that created it can sign in.** This is not a
Weegloo restriction and not something the `ServiceLogin` payload can affect.

- **Weegloo does not wait for the review.** Once the two credentials are in, sign-in works for the
  developer account immediately, so build and test normally.
- To test as a visitor, have the user create a throwaway account under **App roles → Test users →
  Create test users**.
- Opening to real users is submitted at **Review → App Review**, where `email` and `public_profile`
  sit as **Not submitted** until then. Requirements are Meta's and they change — have the user read
  Meta's current App Review documentation rather than working from a remembered checklist.

## Related

- **Provider-agnostic spine (wire protocol, SDK, `callbackUrl`, pitfalls):** **`weegloo-service-login-client`**.
- **Conceptual model (ServiceLogin / ServiceUserRole / ServiceUser):** **`weegloo-service-login`**.
- **Other dedicated provider skills:** **`weegloo-service-login-google`** (Google), **`weegloo-service-login-github`** (GitHub), **`weegloo-service-login-kakao`** (Kakao), **`weegloo-service-login-naver`** (Naver), **`weegloo-service-login-line`** (LINE).
- **Picking the API combo per service type:** **`weegloo-service-architecture`**.
