/**
 * Silent-failure class A: Content created on CMA and never published simply does not
 * appear on CDA. Nothing errors — the delivery read returns an empty list and the site
 * renders blank, which reads as "the API is broken" rather than "you skipped a step".
 */
export default {
  id: 'publish-after-create',
  lang: 'en',
  prompt: 'I created three Content entries through the Weegloo CMA but my public site reading from the CDA shows nothing. What did I miss?',
  asserts: [
    { id: 'publish-required', kind: 'must_match', pattern: /publish/i,
      why: 'CDA 는 published 리소스만 돌려준다 — create 후 publish 가 필요하다' },
    { id: 'published-snapshot', kind: 'must_match', pattern: /snapshot|published[\s\S]{0,60}(only|만)|draft/i,
      why: 'CDA 가 보는 것은 publish 시점의 스냅샷이지 최신 draft 가 아니다' },
  ],
};
