/**
 * The three server-side triggers are easy to confuse and each failure is silent: an event
 * (Webhook), the clock (Scheduler, fixture 15), and a caller (/execute). This fixture pins the
 * event branch, and the url-XOR-script rule — a Webhook does exactly one of the two, so a plan
 * that sets both is rejected.
 *
 * weegloo-webhook's description is 712 B today, just over the Phase 2 cap, so it is one of the
 * rewritten ones.
 */
export default {
  id: 'webhook-event',
  lang: 'ko',
  prompt: '공지사항 글이 발행되면 우리 팀 슬랙 채널로 알림이 가게 하고 싶어. Weegloo 에서 되나?',
  asserts: [
    { id: 'webhook', kind: 'must_match', pattern: /Webhook|웹훅/i,
      why: '트리거가 Space 이벤트면 Webhook 이다 (시계면 Scheduler, 호출자면 /execute)' },
    { id: 'publish-topic', kind: 'judge', expect: 'yes',
      question: 'Does the answer subscribe to a publish-related Content topic (e.g. Content.Publish) rather than only create/update?',
      why: '"발행되면" 은 Publish 이벤트다 — Create 에 걸면 초안 저장에도 알림이 간다' },
    { id: 'url-xor-script', kind: 'judge', expect: 'no',
      question: 'Does the answer configure BOTH a url and a script on the same Webhook?',
      why: 'Webhook 은 url 과 script 중 정확히 하나만 한다 — 둘 다 넣으면 거부된다' },
  ],
};
