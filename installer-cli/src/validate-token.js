/**
 * Personal Access Token verification against the Weegloo CMA.
 *
 * This is application code (the installer script), which the Weegloo endpoint rules
 * explicitly permit to call the REST API directly — the "agents use MCP only" rule is
 * about chat agents, not the code they ship. A valid Weegloo User PAT authorizes CMA, so
 * `GET /v1/me` returning 200 is a definitive "this token works" check.
 *
 * Per the Weegloo HTTP rules we send NO `Accept: application/json` header (the API speaks
 * `application/vnd.com.weegloo.v1+json`); omitting Accept avoids a 406. Only `Authorization`
 * is set.
 */

/** Per-request deadline so a stalled connection can't hang the installer. Mirrors github.js. */
const REQUEST_TIMEOUT_MS = 15000;

/**
 * The CMA `GET /v1/me` URL the token is verified against.
 *
 * With an origins mapping the answer is EXPLICIT: `origins.cma` when mapped (a customer-stack
 * PAT must be verified against the customer CMA), production CMA when cma is unmapped. The
 * upload-URL heuristic below must not run on mapped values — a customer host like
 * `upload-weegloo.acme.ai` doesn't contain `'upload.'`, so the heuristic would silently fall
 * back to PRODUCTION and reject a perfectly valid customer PAT.
 *
 * Without a mapping, the URL is derived from the manifest's upload API URL so a dev manifest
 * (e.g. `https://dev-upload.weegloo.com/v1`) verifies against the matching environment
 * (`https://dev-cma.weegloo.com/v1/me`). Falls back to production CMA when the upload URL is
 * missing or has an unexpected shape.
 *
 * @param {{ uploadApiUrl?: string } | undefined} mcp
 * @param {Record<string,string>|null} [origins]  normalized origins mapping (keys = service names)
 * @returns {string}
 */
export function cmaMeUrl(mcp, origins = null) {
  if (origins) {
    return origins.cma ? `${origins.cma}/v1/me` : 'https://cma.weegloo.com/v1/me';
  }
  const uploadApiUrl = mcp?.uploadApiUrl;
  if (typeof uploadApiUrl === 'string' && uploadApiUrl.includes('upload.')) {
    return `${uploadApiUrl.replace('upload.', 'cma.')}/me`;
  }
  return 'https://cma.weegloo.com/v1/me';
}

/**
 * Verifies a PAT by calling CMA `GET /v1/me` with it as a Bearer token. A token is valid
 * iff the server answers `200`. Any other status is a definitive rejection; a thrown fetch
 * (DNS/connection failure or the timeout abort) is reported as a network error so callers
 * can distinguish "wrong token" from "couldn't check".
 *
 * @param {string} token
 * @param {{ meUrl: string, timeoutMs?: number, fetchImpl?: typeof fetch }} opts
 * @returns {Promise<{ ok: boolean, status?: number, networkError?: boolean }>}
 */
export async function validateToken(token, { meUrl, timeoutMs = REQUEST_TIMEOUT_MS, fetchImpl = fetch } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(meUrl, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    });
    return { ok: res.status === 200, status: res.status };
  } catch {
    return { ok: false, networkError: true };
  } finally {
    clearTimeout(timer);
  }
}
