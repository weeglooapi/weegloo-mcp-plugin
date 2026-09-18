/**
 * Standing policy: never ask "which PG should I use?". If the user named none, integrate the
 * skill's default on its published test keys. The failure this guards is a STALL, and a stall
 * is invisible to every byte metric.
 *
 * The provider assert accepts either Stripe or Toss on purpose — develop and older published
 * corpora disagree on the default, and what is under test is "did the agent pick one and
 * proceed", not which brand won.
 */
export default {
  id: 'payment-default',
  lang: 'ko',
  prompt: 'Weegloo 로 만든 쇼핑몰에 결제를 붙이고 싶어. 카드 결제가 되면 좋겠어.',
  asserts: [
    { id: 'picks-a-provider', kind: 'must_match', pattern: /Stripe|Toss|토스/i,
      why: '사용자가 PG 를 지정하지 않으면 스킬의 기본 provider 로 진행한다' },
    { id: 'no-provider-question', kind: 'judge', expect: 'no',
      question: 'Does the answer ask the user which payment gateway / PG / provider to use, instead of choosing a default and proceeding?',
      why: '"어느 PG 를 쓸까요?" 는 금지된 질문 — 기본값이 정해져 있다' },
    { id: 'server-side-verification', kind: 'judge', expect: 'yes',
      question: 'Does the answer verify the payment (its truth and its amount) server-side — via a Weegloo Script calling the provider, or an equivalent server-authoritative step — rather than trusting what the browser reports?',
      why: '금액 검증을 클라이언트가 하면 위조된다. 서버 권위가 필요하다' },
  ],
};
