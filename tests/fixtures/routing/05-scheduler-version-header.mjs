/**
 * This fixture encodes a LIVE DRIFT found during the survey: the always-loaded rule
 * (rules/weegloo-global-rules.mdc:159) says x-weegloo-version is required on updating "any
 * resource", while skills/weegloo-scheduler/SKILL.md:61-62 says a Scheduler takes NO version
 * header. The always-loaded copy is the wrong one.
 *
 * It is a fixture rather than just a bug report because it is the exact failure mode the
 * restructure must not multiply: a general rule that outranks a specific correction.
 */
export default {
  id: 'scheduler-version-header',
  lang: 'en',
  prompt: 'I need to change the cron expression on an existing Weegloo Scheduler. Walk me through the update call, including every header it needs.',
  asserts: [
    { id: 'no-version-header', kind: 'judge', expect: 'yes',
      question: 'Does the answer state that updating a Scheduler does NOT take an X-Weegloo-Version header (because a Scheduler is not a versioned resource)?',
      why: 'Scheduler 는 버전이 없어서 X-Weegloo-Version 을 받지 않는다 — global-rules 의 "모든 리소스" 주장이 틀렸다' },
    { id: 'no-spurious-version', kind: 'judge', expect: 'no',
      question: 'Does the answer tell the reader to send an X-Weegloo-Version header on the Scheduler update request?',
      why: 'Scheduler 업데이트에 버전 헤더를 보내면 거부된다' },
  ],
};
