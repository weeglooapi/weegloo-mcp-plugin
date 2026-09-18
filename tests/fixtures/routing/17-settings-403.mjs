/**
 * A 403 here is self-announcing, but the agent's INSTINCTIVE repair is wrong and makes things
 * worse: it widens the bound SpaceRole. The settings axis is gated by TOKEN TYPE, so widening
 * the role changes nothing and leaves an over-privileged token behind. This is the
 * "wrong instinctive repair" class — the one-liner must stay resident.
 */
export default {
  id: 'settings-403',
  lang: 'en',
  prompt: 'My backend uses a SpaceAccessToken and gets 403 when it tries to create a Webhook in the Space. What permission do I need to add to its role?',
  asserts: [
    { id: 'token-type-not-role', kind: 'judge', expect: 'yes',
      question: 'Does the answer explain that this 403 is caused by the TOKEN TYPE (a SpaceAccessToken cannot reach Space settings at all) rather than by a missing role permission — and point to a console session or Personal Access Token instead?',
      why: 'settings 축은 토큰 타입 게이트다 — SpaceAccessToken 은 어떤 역할이어도 403' },
    { id: 'no-widen-role', kind: 'judge', expect: 'no',
      question: 'Does the answer tell the user that adding a SETTING_* action (e.g. SETTING_WEBHOOK) to the bound SpaceRole will fix the 403?',
      why: '역할에 settings 액션을 추가해도 403 은 그대로다 — 잘못된 본능적 수리' },
  ],
};
