/**
 * Routing gate: "every night at 3am" is the clock, which is a Scheduler. Every wrong answer
 * (a frontend timer, a Webhook, a polling loop) demos fine and fails in production — a static
 * site has no process alive at 3am. The UTC assert catches the 9-hour KST slip.
 */
export default {
  id: 'cron-job',
  lang: 'ko',
  prompt: '매일 새벽 3시에 만료된 쿠폰을 정리하고 요약을 남기는 작업을 Weegloo 에서 돌리고 싶어.',
  asserts: [
    { id: 'scheduler', kind: 'must_match', pattern: /Scheduler|스케줄러/i,
      why: '시계가 트리거면 Scheduler 다' },
    { id: 'script', kind: 'must_match', pattern: /Script/,
      why: 'Scheduler 는 Script 하나를 실행한다' },
    { id: 'utc-cron', kind: 'judge', expect: 'yes',
      question: 'Does the answer account for the cron expression being interpreted in UTC — for example by converting 3am KST to the corresponding UTC hour, or by stating the expression is UTC?',
      why: 'cron 은 UTC 로 해석된다 — KST 로 착각하면 9시간 어긋난다' },
    { id: 'no-frontend-timer', kind: 'judge', expect: 'no',
      question: 'Does the answer propose driving this schedule from the frontend or client side (setInterval/setTimeout, a browser timer, or a polling loop) instead of a server-side Scheduler?',
      why: '정적 사이트에는 새벽 3시에 살아 있는 프로세스가 없다' },
  ],
};
