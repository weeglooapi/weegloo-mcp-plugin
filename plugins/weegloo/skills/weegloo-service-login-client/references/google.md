# Google — ServiceLogin console setup

Read this **only when** the chosen provider is Google (`google`) — it covers the **Google Cloud
Console** side alone: creating the OAuth client and producing the `clientId` / `clientSecret` that
`ServiceLogin` needs. It assumes the spine (`SKILL.md`): the wire protocol, the SDK, `callbackUrl`,
`exchangeToken` and the ACMA/ACDA token boundary are there, not here.

## Google's Authorized redirect URI (deploy-independent — register it now)

In the Google Cloud Console OAuth client, the **Authorized redirect URI** is, with the real `{spaceId}`
substituted:

```diff
+ https://auth.weegloo.com/v1/spaces/{spaceId}/login/oauth2/code/google
```

The leading **`+ `** is **not part of the URI** — Google's **Authorized redirect URI** field takes the
`https://…` text only.

- The `/code/` segment is required — it is the **Google → Weegloo** callback, **not** the browser entry
  URL (`…/login/oauth2/google`). Putting `/code/` in the entry URL, or the entry URL in this field,
  breaks sign-in (spine pitfall **A**).
- It depends only on `auth.weegloo.com` + your `spaceId` + `google`, so it is **fully known now** —
  register it before the app is deployed.

## Walk the user through it — `clientId` / `clientSecret` are blocking inputs

The `clientId` / `clientSecret` come from the user's **own Google Cloud OAuth client** and only the user
can produce them. So when you reach this step, **stop and ask** — and **don't ask bare**. Hand the user
the illustrated walkthrough, which carries a screenshot of every step:

```diff
+ https://docs.weegloo.com/getting-started/core-concepts/service-users/service-login/google
```

**Send the link and the facts below — do not retype Google's menu path.** The page has the clicks in
pictures and is kept current; a console path pasted from memory sends the user hunting for a menu
Google has since moved (they relocate these pages periodically). What the page cannot know is *your*
values and *this* integration's constraints, so that is what you add:

- **The Authorized redirect URI to register: the URI above, with the real `{spaceId}` filled in** —
  byte-exact, and without the `+ ` (spine pitfall **B**). **No "Authorized JavaScript origins" are
  needed** — the browser navigates to `auth.weegloo.com`, never to Google directly.
- **Application type must be `Web application`** — **even when your product is an Android / iOS app**;
  do *not* pick the "Android" or "iOS" type. A native-type client issues **no client secret**, so the
  user gets stuck with nothing to send back.
- **First time in a project, the OAuth consent screen has to exist** before a client can be created,
  and while the app stays in *Testing* the signing-in Google account must be added under **Test
  users** — otherwise sign-in is blocked for them.
- **Send back: the Client ID and the Client Secret** shown when the client is created.

**Do not** finish with only the `ServiceUserRole` created and the credentials written off as "add
later" — a role with no `ServiceLogin` is **blocked-pending-input**, so end the turn by *asking for the
credentials*, not by reporting Google sign-in as done.

## Google-specific note — while the app is in *Testing*, only Test users can sign in

While the app stays in *Testing*, add the signing-in Google account under **Test users**, otherwise
sign-in is blocked.

## Google-specific note — the OAuth client type is `Web application`, even for a native app

**Choose `Web application` even when your product is an Android / iOS app**; do *not* pick the
"Android" or "iOS" type. Weegloo's redirect URI is `https://auth.weegloo.com/…` (a web URL), so from
Google's side the OAuth client is always a web app — a native app receives its token through its own
registered deep link, not a Google native client (see **`references/native-apps.md`**).

Then create the `ServiceLogin`: the `providers` entry's **`registrationId`** is `google`, plus
`defaultRole` and `callbackUrl` per the spine.
