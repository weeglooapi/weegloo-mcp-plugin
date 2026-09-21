# Facebook — ServiceLogin console setup

Read this **only when** the chosen provider is Facebook (`facebook`). It assumes the spine
(`SKILL.md`): the wire protocol, the SDK, `callbackUrl`, `exchangeToken` and the ACMA/ACDA token
boundary are there, not here.

## Facebook's Valid OAuth Redirect URIs (deploy-independent — register it now)

In the Meta app console the field is **Valid OAuth Redirect URIs**, under the Facebook Login use
case's **Settings**. Its value, with the real `{spaceId}` substituted:

```diff
+ https://auth.weegloo.com/v1/spaces/{spaceId}/login/oauth2/code/facebook
```

The leading `+ ` is **not part of the URI** — Facebook's **Valid OAuth Redirect URIs** field takes
the `https://…` text only.

- The `/code/` segment is required — it is the **Facebook → Weegloo** callback, **not** the browser
  entry URL (`…/login/oauth2/facebook`). Putting `/code/` in the entry URL, or the entry URL in this
  field, breaks sign-in (spine pitfall **A**).
- It depends only on `auth.weegloo.com` + your `spaceId` + `facebook`, so it is **fully known now** —
  register it before the app is deployed (spine pitfall **G**). `callbackUrl` is the deploy-dependent
  one; this is not.

## Walk the user through it — `clientId` / `clientSecret` are blocking inputs

The `clientId` / `clientSecret` come from the user's **own Facebook app** and only the user can
produce them. So when you reach this step, **stop and ask** — and **don't ask bare**. Hand the user
the illustrated walkthrough, which carries a screenshot of every step:

```diff
+ https://docs.weegloo.com/getting-started/core-concepts/service-users/service-login/facebook
```

**Send the link and the facts below — do not retype Meta's wizard.** The page has the clicks in
pictures and is kept current; Meta reshapes that wizard often enough that a path pasted from memory
misleads. What the page cannot know is *your* values and *this* integration's constraints:

- **The Valid OAuth Redirect URI to register: the URI above, with the real `{spaceId}` filled in** —
  byte-exact, and without the `+ ` (spine pitfall **B**).
- **Pick the Facebook Login use case** (*authenticate and request data from users*) — the other use
  cases are ads and messaging and configure no sign-in at all.
- **`email` is a permission you have to add by hand** — Facebook will not include it for you, and
  Weegloo needs it. Easy to skip, and it fails only later, at first sign-in.
- **A business portfolio is not needed** to obtain the credentials, whatever the screen suggests.
- **Send back: the App ID (`clientId`) and the App secret (`clientSecret`).** Unlike GitHub or
  GitLab, Facebook shows the secret again on demand, so a lost copy is not a regeneration.

A red **Currently ineligible for submission** banner on that screen (missing app icon, privacy policy
URL, category) is about **App Review**, not about sign-in — the credentials work without it.

**Do not** finish with only the `ServiceUserRole` created and the credentials written off as "add
later" — a role with no `ServiceLogin` is **blocked-pending-input**, so end the turn by *asking for
the credentials*, not by reporting Facebook sign-in as done.

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

## Facebook-specific note — App Review gates who else can sign in

Until the app passes **App Review**, **only the account that created it can sign in.** This is not a
Weegloo restriction and not something the `ServiceLogin` payload can affect.

- **Weegloo does not wait for the review.** Once the two credentials are in, sign-in works for the
  developer account immediately, so build and test normally.
- To test as a visitor, have the user create a throwaway account under **App roles → Test users →
  Create test users**.
- Opening to real users is submitted at **Review → App Review**, where `email` and `public_profile`
  sit as **Not submitted** until then. Requirements are Meta's and they change — have the user read
  Meta's current App Review documentation rather than working from a remembered checklist.

Then create the `ServiceLogin`: the `providers` entry's **`registrationId`** is `facebook`, plus
`defaultRole` and `callbackUrl` per the spine.
