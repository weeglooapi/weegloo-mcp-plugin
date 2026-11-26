# Signing a JWT for an outbound call — the `JWT` statement

Read this when a Script calls an API that authenticates with a JWT you sign: a Google service
account, a GitHub App, any OAuth `jwt-bearer` grant. It assumes the spine (`SKILL.md`): how `Http`
sends a form body, *Secrets & auth*, and what a data slot is.

## Fields

| Field | |
|---|---|
| `type` | `"JWT"` |
| `name` | **required** — binds the compact token (`header.payload.signature`) as a string, `{ /<name> }` |
| `algorithm` | `"RS256"`, the only value (any case) |
| `signingKey` | value expression resolving to the RSA private key as PEM — write `"{ /secrets/<key> }"` |
| `claims` | **required** data slot — the payload, at least one claim |
| `header` | optional data slot — parameters set beside the platform's own `typ` and `alg` (e.g. `kid`); setting `alg` or `typ` here fails |

The statement calls nothing, so it does not count as an external call.

**Claims are written in a data slot:** a claim name is a bare key, and an operator needs `$`. Time
claims are epoch **seconds**: `"iat": "{ /now/seconds }"` stays a number (a single pointer keeps its
type) and `{ "$+": [ "{ /now/seconds }", 3600 ] }` is written as an integer. A bare `{ "+": … }` is a
claim holding an object, and a mixed template (`"{ /now/seconds }000"`) is a string — the platform
signs either without complaint, and the provider refuses the token.

## Google service account: sign → exchange → call

```jsonc
"statements": [
  { "type": "JWT", "name": "assertion", "algorithm": "RS256", "signingKey": "{ /secrets/GOOGLE_SA_KEY }",
    "claims": {
      "iss": "sheets-writer@my-project.iam.gserviceaccount.com",  // the key file's client_email
      "scope": "https://www.googleapis.com/auth/spreadsheets",    // the API's scopes, space-separated
      "aud": "https://oauth2.googleapis.com/token",               // the key file's token_uri
      "iat": "{ /now/seconds }",
      "exp": { "$+": [ "{ /now/seconds }", 3600 ] }              // Google accepts at most 1 hour
    } },
  { "type": "Http", "name": "token", "method": "POST", "url": "https://oauth2.googleapis.com/token",
    "headers": [ { "key": "Content-Type", "value": "application/x-www-form-urlencoded" } ],
    "body": { "grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer", "assertion": "{ /assertion }" } },
  { "type": "Http", "name": "rows", "method": "GET",
    "url": "https://sheets.googleapis.com/v4/spreadsheets/1AbC…/values/A1:C10",
    "headers": [ { "key": "Authorization", "value": "Bearer { /token/body/access_token }" } ] }
],
"secrets": [ { "key": "GOOGLE_SA_KEY", "description": "Google service account private key (PEM)",
               "value": "-----BEGIN PRIVATE KEY-----\nMIIE…\n-----END PRIVATE KEY-----\n" } ]
```

- `iss` and `aud` are not secret, so literals are fine; only the key goes in `secrets`.
- Every run signs and exchanges again — one more `Http` per run. Exchange once, before any `Loop`,
  and reuse `{ /token/body/access_token }` inside it.
- The assertion and the access token are credentials: never `Return`, `SetVar` or store them.

## APIs that take the JWT itself

Some endpoints skip the exchange and take the JWT as the bearer token: send it in `headers` as
`{ "key": "Authorization", "value": "Bearer { /<name> }" }`. A GitHub App's `/app/…` endpoints work
this way (one of them issues the installation token its repository APIs take); GitHub wants `iss` =
the App's client ID, `iat` 60 seconds back against clock drift
(`{ "$-": [ "{ /now/seconds }", 60 ] }`) and `exp` no more than 10 minutes ahead. Take the claim set
and the lifetime from the provider's own docs.

## Storing the key

- The secret `value` is the PEM text of an **RSA key of 2048 bits or more** —
  `-----BEGIN PRIVATE KEY-----` (PKCS#8, what Google issues) or `-----BEGIN RSA PRIVATE KEY-----`
  (PKCS#1, what GitHub issues). A 2048-bit key is about 1,700 chars and a 4096-bit one about 3,300,
  so both fit the 4,096-char secret value.
- **Out of a JSON key file, the value is `private_key` decoded**, with real line breaks. The file's
  text writes each line break as the two characters `\` `n`; stored that way, the Script **saves, and
  every run fails `400`**. Inside a JSON request — an MCP `cma_*` Script call included — a single `\n`
  already decodes to a line break, so the trap is a doubled `\\n`, or the file's text pasted into a
  form field. Line breaks dropped, replaced by spaces or written as CRLF are read fine.
- Store the key, not the whole key file: a secret is read whole (`{ /secrets/<key>/private_key }` is
  rejected at save), and the key inside the file is still escaped.

## What fails, and when

Save checks none of these, so a Script that saved has not yet shown that its key and claims work —
its first run does. Each fails the statement:

| Cause | Status |
|---|---|
| `signingKey` resolves to nothing, is not a PEM private key, or is not an RSA key of 2048+ bits (an EC key, a 1024-bit key) | `400`; the message never echoes the key |
| `claims` resolves to an empty object, or to something that is not an object | `400` |
| a claim or `header` value resolves to `null` — e.g. a `{ /payload/… }` the caller did not send | `400`, naming the key |
| `header` sets `alg` or `typ` | `400` |
| `claims` serializes to more than 65,536 chars | `422` |

A token the provider refuses — a wrong `aud`, an `exp` past its limit, a claim holding an object —
does not fail this statement: the exchange `Http` fails instead, with the provider's reason in
`{ /error/message }` inside a `catch`.
