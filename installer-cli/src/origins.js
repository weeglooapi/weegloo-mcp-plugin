/**
 * Origins 매핑 — 룰/스킬 본문과 MCP 설정에 박힌 weegloo URL을 환경/고객 도메인으로 치환.
 * 설계: docs/origins-mapping.md.
 *
 * 키는 짧은 서비스 이름(cma/cda/… — 전체 origin 키도 정규화 수용), 값은 대상 origin.
 * 치환은 HOST 문자열 단위로 한다: 본문에는 scheme 없는
 * bare 호스트 언급이 ~52곳 있어(auth 29·cma 17…) origin 단위 치환만으로는 산문 안내가
 * 프로덕션 호스트로 남아 뒤섞인다. 호스트 치환은 scheme URL(경로 보존)과 bare 언급을 한 번에
 * 처리한다. 단 8개 호스트는 상호 비중첩이 **아니다** — `acma.weegloo.com` ⊃ `cma.weegloo.com`,
 * `acda.weegloo.com` ⊃ `cda.weegloo.com` — 그래서 단순 replaceAll이 아니라 **호스트 문자
 * 경계 검사**(앞뒤가 [A-Za-z0-9-]가 아닐 때만 매칭)로 치환한다. 이 경계 덕에 순서 무관하고,
 * 오답 예시(`cda-weegloo.com`)도 dash 경계라 안 걸린다.
 *
 * 치환은 디스크 파일이 아니라 fetch된 매니페스트의 메모리 위 문자열에 일어난다(소스 불변).
 * 매번 원본에서 새로 치환하므로 이중 치환은 없다.
 */
import fs from 'node:fs';

/** cma 매핑 시 카탈로그에서 제외되는 약관 게이트 룰 (docs/origins-mapping.md §6). */
export const TERMS_CONSENT_RULE_ID = 'weegloo-terms-consent';

/**
 * 매핑 가능한 서비스 8개: 키는 짧은 서비스 이름(사람이 쓰는 입력 형식 — 소스 origin은 고정이라
 * 전체 URL 키는 순수 중복 타이핑), 값은 그 서비스의 weegloo 소스 origin. 이 밖의 키는
 * 에러(오타가 조용히 무시되지 않도록). 입력에서 전체 origin 키도 받아 서비스명으로 정규화한다.
 */
export const MAPPABLE_SERVICES = {
  cma: 'https://cma.weegloo.com',
  cda: 'https://cda.weegloo.com',
  acma: 'https://acma.weegloo.com',
  acda: 'https://acda.weegloo.com',
  upload: 'https://upload.weegloo.com', // manifest.mcp.uploadApiUrl 포함
  auth: 'https://auth.weegloo.com', // 최대 표면(~50곳) — provider redirect URI 포함
  console: 'https://console.weegloo.com', // PAT 페이지 + FE 로그인 팝업 origin
  ai: 'https://ai.weegloo.com', // /v1/version(버전체크) + /mcp(MCP 서버)
};

/** 전체 origin 키 입력을 서비스명으로 되돌리는 역방향 색인. */
const SERVICE_BY_ORIGIN = Object.fromEntries(
  Object.entries(MAPPABLE_SERVICES).map(([service, origin]) => [origin, service])
);

/** origin 문자열에서 host 부분만 (치환 키로 쓰임). */
function hostOf(origin) {
  return origin.replace(/^https:\/\//, '');
}

const SOURCE_HOSTS = Object.values(MAPPABLE_SERVICES).map(hostOf);

/**
 * origins 입력(객체)을 검증·정규화한다. 실패는 사용자에게 보여줄 메시지로 throw.
 * 빈 매핑은 null(매핑 없음)로 수렴 — 호출부 분기가 단순해진다.
 *
 * 값 규칙: `https://<host>[:port]` origin 형태만(경로/쿼리 금지 — API 경로는 콘텐츠가 이미
 * 갖고 있으므로 host만 갈아끼움), weegloo 원본 호스트를 포함하면 거부(순환/이중 치환 방지).
 *
 * @param {unknown} raw
 * @returns {Record<string,string>|null} 정규화된 매핑(trailing slash 제거), 또는 null
 */
export function normalizeOrigins(raw) {
  if (raw == null) return null;
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('origins mapping must be a JSON object of { "<service>": "<origin>" }, e.g. { "cma": "https://cma.acme.com" }.');
  }
  const normalized = {};
  for (const [rawKey, rawValue] of Object.entries(raw)) {
    const trimmed = String(rawKey).trim().replace(/\/+$/, '');
    // 표준 입력은 짧은 서비스명; 전체 origin 키도 받아 정규화(옛 문서/복붙 관용).
    const service = MAPPABLE_SERVICES[trimmed] ? trimmed : SERVICE_BY_ORIGIN[trimmed];
    if (!service) {
      throw new Error(
        `Unknown origins key '${rawKey}'. Mappable services: ${Object.keys(MAPPABLE_SERVICES).join(', ')}`
      );
    }
    const key = service;
    if (typeof rawValue !== 'string') {
      throw new Error(`origins['${key}'] must be a string origin, got ${typeof rawValue}.`);
    }
    const value = rawValue.trim().replace(/\/+$/, '');
    if (!/^https:\/\/[A-Za-z0-9.-]+(:\d+)?$/.test(value)) {
      throw new Error(
        `origins['${key}'] must be an https origin (no path/query), e.g. "https://cma.acme.com" — got '${rawValue}'.`
      );
    }
    const valueHost = hostOf(value);
    // 치환과 **같은 경계 기준**으로 판정한다. 단순 includes 였을 때 `dev-cma.weegloo.com`
    // 처럼 접두만 붙은 동일 도메인 스택(= 이 기능의 첫 용도인 환경 분리)이 전부 거부됐다.
    // 재치환 위험도 실제로 없다 — hostPattern 의 경계 검사가 `-cma.weegloo.com` 을
    // 매칭하지 않으므로 치환 결과가 다시 치환되지 않는다.
    const collides = SOURCE_HOSTS.find((h) => hostPattern(h).test(valueHost));
    if (collides) {
      throw new Error(
        `origins['${key}'] value '${value}' contains the weegloo source host '${collides}' — circular/overlapping mappings are not allowed.`
      );
    }
    normalized[key] = value;
  }
  return Object.keys(normalized).length > 0 ? normalized : null;
}

/**
 * CLI 입력(`--origins` 값 / WEEGLOO_ORIGINS env)을 매핑 객체로. `{`로 시작하면 inline JSON,
 * 아니면 파일 경로로 읽는다. 검증 실패는 메시지와 함께 throw(호출부가 출력 후 종료).
 *
 * @param {string} rawInput
 * @returns {Record<string,string>|null}
 */
export function loadOrigins(rawInput) {
  const trimmed = String(rawInput).trim();
  let text = trimmed;
  if (!trimmed.startsWith('{')) {
    try {
      text = fs.readFileSync(trimmed, 'utf-8');
    } catch (err) {
      throw new Error(`Could not read origins file '${trimmed}': ${err.message}`);
    }
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new Error(`origins mapping is not valid JSON: ${err.message}`);
  }
  return normalizeOrigins(parsed);
}

/**
 * 호스트 경계 매칭 패턴: 앞뒤가 호스트 구성 문자([A-Za-z0-9-])가 아닐 때만 매칭.
 * `acma.weegloo.com` 안의 `cma.weegloo.com`(앞이 'a')은 매칭 안 되고,
 * `https://cma.weegloo.com/x`(앞 '/'), 백틱/공백 속 bare 언급, 문장 끝 '.'은 매칭된다.
 */
function hostPattern(host) {
  const escaped = host.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![A-Za-z0-9-])${escaped}(?![A-Za-z0-9-])`, 'g');
}

/**
 * 콘텐츠 문자열에 호스트 치환 적용. origins가 null이면 원본 그대로(바이트 동일 — 기본 원칙).
 * 경계 검사 덕에 키 적용 순서와 무관하게 결과가 동일하다.
 *
 * @param {string} content
 * @param {Record<string,string>|null} origins  normalizeOrigins를 통과한 매핑
 */
export function applyOriginMapping(content, origins) {
  if (!origins) return content;
  let out = content;
  for (const [service, toOrigin] of Object.entries(origins)) {
    // 치환값은 함수로 — 고객 호스트에 '$' 같은 치환 패턴 문자가 있어도 literal로 들어감
    out = out.replace(hostPattern(hostOf(MAPPABLE_SERVICES[service])), () => hostOf(toOrigin));
  }
  return out;
}

/**
 * 매니페스트 리소스 전체(스킬 파일들 + 룰 content + MCP URL)에 매핑 적용 — 새 객체 반환.
 * weegloo-version 룰의 placeholder는 여기서 안 건드려짐(호스트가 없는 토큰) — 치환된 체크
 * URL은 applySelfUpdateTemplate이 굽는 시점에 매핑된다(self-update.js).
 */
export function applyOriginsToResources(resources, origins) {
  if (!origins) return resources;
  const map = (s) => (typeof s === 'string' ? applyOriginMapping(s, origins) : s);
  return {
    ...resources,
    // mcp is absent in update-flow fixtures (updates never touch MCP config) — map when present.
    ...(resources.mcp && {
      mcp: {
        ...resources.mcp,
        weeglooUrl: map(resources.mcp.weeglooUrl),
        uploadApiUrl: map(resources.mcp.uploadApiUrl),
      },
    }),
    skills: resources.skills.map((skill) => ({
      ...skill,
      files: Object.fromEntries(Object.entries(skill.files).map(([name, body]) => [name, map(body)])),
    })),
    rules: resources.rules.map((rule) => ({ ...rule, content: map(rule.content) })),
  };
}

/**
 * origins 매핑이 하나라도 있으면 ⇒ terms-consent 룰을 카탈로그에서 제거
 * (docs/origins-mapping.md §6). 약관 게이트는 weegloo가 운영하는 표준 스택의 것 —
 * origins를 쓰는 설치(스테이징/B2B 납품)는 그 바깥이라 룰 자체가 성립하지 않는다.
 * (초안은 cma 키가 있을 때만 제외였으나 "origin 변경 = 사실상 B2B뿐"이라 조건 없이 단순화.)
 * 카탈로그에서 빼면: install 체크박스·코어 강제(partitionCoreRules는 매니페스트 ∩ 이라
 * 자동 해제)·update의 add/prune(기존 집합 연산)이 전부 자연히 따라온다.
 */
export function applyTermsExclusion(resources, origins) {
  if (!origins) return resources;
  return { ...resources, rules: resources.rules.filter((r) => r.id !== TERMS_CONSENT_RULE_ID) };
}

/** 두 매핑(null 허용)의 동등 비교 — 공유 스토어 충돌 감지용. */
export function originsEqual(a, b) {
  const canon = (h) => JSON.stringify(Object.entries(h ?? {}).sort(([x], [y]) => x.localeCompare(y)));
  return canon(a) === canon(b);
}
