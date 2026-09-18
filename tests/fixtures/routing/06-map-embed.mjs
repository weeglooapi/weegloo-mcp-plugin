/**
 * Not a silent failure but a silent STALL: asking the user for a Maps API key blocks a
 * task that has no blocking input. The key is hard-coded in the skill. A restructure that
 * loses this turns every map request into a dead-end question.
 */
export default {
  id: 'map-embed',
  lang: 'ko',
  prompt: '회사 소개 페이지에 우리 사무실 위치를 지도로 보여주고 싶어. Weegloo WebHosting 으로 배포할 정적 사이트야.',
  asserts: [
    { id: 'embed-iframe', kind: 'must_match', pattern: /iframe|Embed\s*API/i,
      why: '정적 호스팅에는 Maps Embed API iframe 을 쓴다 (JavaScript API 아님)' },
    { id: 'no-key-question', kind: 'must_not_match', pattern: /(API\s*키|api[_ ]?key)[\s\S]{0,80}(알려|주세요|필요합니다|발급|제공해)/i,
      why: 'Maps 키는 스킬에 하드코딩돼 있다 — 사용자에게 묻는 것은 불필요한 차단' },
    { id: 'no-placeholder', kind: 'must_not_match', pattern: /YOUR_API_KEY|process\.env\.[A-Z_]*MAPS|<YOUR_KEY>/,
      why: '정적 빌드에는 env 주입 경로가 없다 — placeholder 는 동작하지 않는 코드' },
  ],
};
