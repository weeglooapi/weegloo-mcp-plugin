---
name: weegloo-market-app
description: Preparing a Space for Weegloo MarketApp registration; the user creates the AppBundle and submits it in the console (no MCP tool). The rule for a value in a Script: a Weegloo resource id is rewritten on install (so are the Space id and access tokens, even in site files), so it never goes in a secret; any other id or key (a PG secret key, an API key) must be a secret, which becomes each installer's own input. Covers what else becomes an installer input, WebHosting files and the rejection codes. Not a WebHosting deploy. 마켓플레이스 앱 등록, 앱 번들, 앱 배포 준비, 앱 출시, 앱 심사.
---

# Weegloo MarketApp — preparing a Space for registration

A **MarketApp** ships as an **AppBundle**: resources picked from one source Space, packed by the
platform and rewritten for every Space that installs it. The bundle is created and submitted for
review **in the Weegloo console** — there is no MCP tool for it, so your part is getting the Space's
resources ready. Almost nothing needs preparing; one question settles most of it.

## The rule: is the value a Weegloo resource id?

- **Yes → leave it written where it is.** The id of every resource in the bundle is rewritten on
  install, so it never needs a secret. Moved into one, it breaks the app: the rewriter no longer sees
  it, the bundle stops checking that the resource is included, and the installer is asked to type an
  id they cannot know — most ids are created by the install itself. (A `ServiceUser` or user id is
  the exception: it cannot travel at all — see the codes below.)
- **No → make it a secret.** A PG secret key or merchant id, an LLM or other API key, a signing secret
  is not rewritten: left as a literal, it is copied verbatim into every installer's Space — they can
  read it, and every install runs on your account. In a Script, put it in `definition.secrets`, read
  it as `{ /secrets/<KEY> }` and give it a `description` saying what to paste (`weegloo-script`); in
  a Webhook header, set `secret: true`. A secret becomes each installer's own input.

## Rewritten on install

- **The Space id, and the id of every bundled resource**, wherever it appears: `Refer`s, ids written
  as plain strings in Script `statements` / `payloadSchema`, Webhook `filters` / `transformation`,
  Content `fields`, role rules, and the text files (HTML, JS, CSS, JSON, XML) of a bundled WebHosting.
- **DeliveryAccessToken / SpaceAccessToken**: a new token is issued, and the old token string in the
  site's files is replaced with it.
- **EmailAccount**: never copied — the installer picks one of their own, and every reference to the
  bundled one points at it.
- Bundled Media file URLs in the site's files, and the site's own URL in its pages' `<head>` tags.

## Already an installer input

Left out of the bundle (a secret is packed as `******`); each installer enters their own value:

- every Script `definition.secrets` value — one required input per key
- Webhook headers marked `secret: true` or named `Authorization`, and `basicAuth`
- ServiceLogin provider `clientId` / `clientSecret`, `contactEmail`, `callbackUrl`,
  `allowedCallbackUrls` (pre-filled with the installed site's URL when they point at the bundled site)
- the EmailAccount choice

## Where the rewrite does not reach

1. **A Webhook `url` is copied verbatim** and is never an installer input — a hook pointed at your own
   server sends every installer's events there. To vary it per installer, have the hook run a Script
   that reads the address from a secret.
2. **WebHosting files are not checked.** A token or id in the site is rewritten only when it is
   written verbatim and its resource is in the bundle; leave the resource out and the installed site
   keeps your Space's value, with no error. Bundle everything the site reads — its
   DeliveryAccessToken, ContentTypes, Media. The site's own address is rewritten only in `<head>`
   tags, so code derives it from `location.origin`. If the site keeps its fixed Weegloo values in one
   key/value file (recommended by `weegloo-frontend`), that file is the checklist.

## Rejection codes — none is fixed with a secret

The console reports these when the bundle is created or packed:

| code | cause | fix |
|---|---|---|
| `WGL400014` | a bundled resource references one that is not in the bundle — an id written as a string in a Script or Webhook counts | add that resource to the bundle |
| `WGL400097` | a reference to a `ServiceUser` — members never travel | remove it; a Script can take the id from the payload |
| `WGL400098` | a `createdBy` filter pinned to one user | `:self`, or drop the filter |
| `WGL400103` | a Script or Webhook names the id of a resource that installs after it | remove the literal id; take it from the payload |
| `WGL422021` | a Media file or a WebHosting deploy still processing | wait until it finishes |
| `WGL403017` | a resource that was itself installed from a MarketApp | it cannot be bundled again |

## Submitting for review

Only the `label` and `description` of each installer input (and the `default` of a required one) can
be edited at submit. **No input can be added then** — anything an installer must supply has to exist
as a secret in the Space before the bundle is created.
