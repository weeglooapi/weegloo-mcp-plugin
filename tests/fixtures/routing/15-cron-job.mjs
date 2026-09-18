/**
 * Routing gate: "every night at 3am" is the clock, which is a Scheduler. Every wrong
 * answer (a frontend timer, a Webhook, a polling loop) demos fine and fails in production
 * — a static site has no process alive at 3am. The UTC assert catches the 9-hour KST slip.
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
    { id: 'utc-cron', kind: 'must_match', pattern: /UTC/i,
      why: 'cron 표현식은 UTC 로 해석된다 — KST 로 착각하면 9시간 어긋난다' },
    { id: 'no-frontend-timer', kind: 'must_not_match', pattern: /setInterval|setTimeout|프론트엔드?\s*(에서)?\s*타이머/i,
      why: '프론트엔드 타이머로 스케줄을 흉내내면 안 된다' },
  ],
};
