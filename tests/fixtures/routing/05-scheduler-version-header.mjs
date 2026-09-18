/**
 * This fixture encodes a LIVE DRIFT found during the survey: the always-loaded rule
 * (rules/weegloo-global-rules.mdc:159) says x-weegloo-version is required on updating
 * "any resource", while skills/weegloo-scheduler/SKILL.md:61-62 says a Scheduler takes
 * NO version header. The always-loaded copy is the wrong one.
 *
 * It is a fixture rather than just a bug report because it is the exact failure mode the
 * restructure must not multiply: a general rule that outranks a specific correction.
 */
export default {
  id: 'scheduler-version-header',
  lang: 'en',
  prompt: 'I need to change the cron expression on an existing Weegloo Scheduler. Walk me through the update call, including every header it needs.',
  asserts: [
    { id: 'no-version-header', kind: 'must_match', pattern: /no\s+(X-Weegloo-)?[Vv]ersion|version[^.]{0,40}(not\s+(required|needed)|없)|버전\s*헤더\s*(는|가)?\s*(없|불필요|받지)/i,
      why: 'Scheduler 는 버전이 없어서 X-Weegloo-Version 을 받지 않는다 — global-rules 의 "모든 리소스" 주장이 틀렸다' },
    { id: 'no-spurious-version', kind: 'must_not_match', pattern: /(반드시|must|always|required)[\s\S]{0,60}X-Weegloo-Version[\s\S]{0,40}(Scheduler|스케줄러)/i,
      why: 'Scheduler 업데이트에 버전 헤더를 요구하면 호출이 거부된다' },
  ],
};
