/**
 * Silent-failure class A: binding Administrator (or `roles[0]`) to a browser-exposed
 * DeliveryAccessToken produces a token that WORKS PERFECTLY in testing and hands full
 * Space control to anyone who reads the JS bundle. Nothing fails; the blast radius is
 * invisible until it is used.
 */
export default {
  id: 'delivery-token-role',
  lang: 'ko',
  prompt: '정적 사이트에서 Weegloo CDA 로 공개 콘텐츠를 읽으려고 해. 브라우저에서 쓸 DeliveryAccessToken 을 만들어줘. 역할은 알아서 정해줘.',
  asserts: [
    { id: 'least-privilege', kind: 'must_match', pattern: /읽기\s*전용|read-?only|최소\s*권한|least[- ]privilege/i,
      why: '브라우저 노출 토큰은 필요한 ContentType 에 대한 읽기 전용 역할이어야 한다' },
    { id: 'no-administrator', kind: 'must_not_match', pattern: /Administrator\s*(역할)?\s*(를|을)?\s*(바인딩|binding|사용|선택|지정)/i,
      why: 'Administrator 를 브라우저 토큰에 바인딩하면 번들을 읽는 누구나 Space 를 장악한다' },
    { id: 'no-first-item', kind: 'must_not_match', pattern: /(roles?|목록)\s*\[\s*0\s*\]|첫\s*번째\s*(역할|role)\s*(를|을)\s*(사용|선택)/i,
      why: '목록의 첫 항목을 고르는 것은 금지 — 무엇이 걸릴지 알 수 없다' },
  ],
};
