/**
 * A 403 here is self-announcing, but the agent's INSTINCTIVE repair is wrong and makes
 * things worse: it widens the bound SpaceRole. The settings axis is gated by TOKEN TYPE,
 * so widening the role changes nothing and leaves a over-privileged token behind.
 * This is the "wrong instinctive repair" class — the one-liner must stay resident.
 */
export default {
  id: 'settings-403',
  lang: 'en',
  prompt: 'My backend uses a SpaceAccessToken and gets 403 when it tries to create a Webhook in the Space. What permission do I need to add to its role?',
  asserts: [
    { id: 'token-type-not-role', kind: 'must_match', pattern: /token\s*type|PAT|Personal\s*Access\s*Token|console|토큰\s*(종류|타입)/i,
      why: 'settings 축은 토큰 타입 게이트다 — SpaceAccessToken 은 어떤 역할이어도 403' },
    { id: 'no-widen-role', kind: 'must_not_match', pattern: /(add|추가|grant|부여)[\s\S]{0,60}SETTING_WEBHOOK[\s\S]{0,80}(role|역할)[\s\S]{0,40}(fix|해결|되면|하면)/i,
      why: '역할에 settings 액션을 추가해도 403 은 그대로다 — 잘못된 본능적 수리' },
  ],
};
