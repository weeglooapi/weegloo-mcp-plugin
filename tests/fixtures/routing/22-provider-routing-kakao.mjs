/**
 * The Kakao half of the provider-routing pair (see 21). Kakao is also the provider most likely
 * to be confused with a DIFFERENT Kakao product — the address/postcode widget
 * (weegloo-address-search) — so this fixture also checks the router does not land there.
 */
export default {
  id: 'provider-routing-kakao',
  lang: 'ko',
  prompt: '카카오 로그인 붙여줘. Weegloo 쓰고 있어.',
  asserts: [
    { id: 'service-login', kind: 'must_match', pattern: /ServiceLogin/i,
      why: '제품 end-user 로그인은 ServiceLogin 이다' },
    { id: 'kakao-specific', kind: 'judge', expect: 'yes',
      question: 'Does the answer give KAKAO-specific setup (the Kakao Developers application and its keys/consent settings) rather than only generic provider-agnostic steps?',
      why: 'provider 스킬 7개가 서로 구분되어야 라우터가 맞는 것을 연다' },
    { id: 'not-postcode-widget', kind: 'judge', expect: 'no',
      question: 'Does the answer confuse this with the Kakao/Daum POSTCODE (주소·우편번호) widget, i.e. talk about address lookup instead of OAuth sign-in?',
      why: '같은 회사의 다른 제품이라 혼동되기 쉽다 — 주소 검색 위젯은 로그인과 무관하다' },
  ],
};
