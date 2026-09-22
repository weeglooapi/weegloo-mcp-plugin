/**
 * Reproduces a real incident: an Order ContentType whose `stripeSessionId` was modelled as a
 * `ShortText`, because the name reads like an id. `ShortText` caps at 64 — far below the 255 most
 * CMSes allow, so nobody thinks to check — and `cs_test_…` runs 66–90. Nothing failed until a
 * buyer pressed 결제하기 and the Script answered `must not exceed a maximum length of 64`.
 *
 * The prompt deliberately gives no hint about length; picking the type is the whole test.
 */
export default {
  id: 'contenttype-external-id-length',
  lang: 'ko',
  prompt: 'Weegloo 에 주문 ContentType 을 만들려고 해. orderId, 금액, 상태, 그리고 Stripe 결제 세션 ID 랑 영수증 URL 을 저장해야 돼. 필드 타입 좀 정해줘.',
  asserts: [
    { id: 'provider-values-not-shorttext', kind: 'judge', expect: 'no',
      question: 'Does the answer assign the type ShortText to the Stripe session id field, or to the receipt URL field?',
      why: 'cs_test_… 는 66~90자, 영수증 URL 은 수백 자 — ShortText(64자) 에 들어가지 않는다' },
    { id: 'provider-values-hold-over-64', kind: 'judge', expect: 'yes',
      question: 'Does the answer give BOTH the Stripe session id and the receipt URL a text type that can hold more than 64 characters — LongText or RichText?',
      why: '길이를 우리가 정하지 않는 값은 LongText 또는 RichText 여야 한다' },
    { id: 'states-the-64-cap', kind: 'must_match', pattern: /\b64\b/,
      why: '숫자를 말하지 않고 타입만 맞히면 다음 provider 필드에서 같은 실수를 한다 — 64 가 load-bearing 한 사실이다' },
  ],
};
