/**
 * Standing policy: never ask "which PG should I use?". If the user named none, integrate
 * the skill's default on its published test keys. The failure this guards is a STALL, and
 * a stall is invisible to every byte metric.
 *
 * NOTE: the expected default differs between develop (Stripe) and the currently published
 * corpus (Toss). The assert accepts either on purpose — what is under test is "did the
 * agent pick one and proceed", not which brand won.
 */
export default {
  id: 'payment-default',
  lang: 'ko',
  prompt: 'Weegloo 로 만든 쇼핑몰에 결제를 붙이고 싶어. 카드 결제가 되면 좋겠어.',
  asserts: [
    { id: 'picks-a-provider', kind: 'must_match', pattern: /Stripe|Toss|토스/i,
      why: '사용자가 PG 를 지정하지 않으면 스킬의 기본 provider 로 진행한다' },
    { id: 'no-provider-question', kind: 'must_not_match', pattern: /(어떤|어느|무슨)\s*(PG|결제|provider|사|업체)[\s\S]{0,40}(쓰|사용|원하|선택)[\s\S]{0,20}(세요|시겠|나요|\?)/i,
      why: '"어느 PG 를 쓸까요?" 는 금지된 질문 — 기본값이 정해져 있다' },
    { id: 'server-side-verification', kind: 'must_match', pattern: /Script|서버|검증|verify|금액\s*확인/i,
      why: '금액 검증은 클라이언트가 아니라 서버(Script) 권위로 해야 한다' },
  ],
};
