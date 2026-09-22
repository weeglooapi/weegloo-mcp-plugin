/**
 * "Space 초기화" is the INVERSE of a Space delete, and the corpus's own always-loaded sentence —
 * everything else "cascades with the Space — do not delete those first" — is correct for the delete
 * and exactly backwards here. The failure raises no error: the agent clears ContentType / Content /
 * Media / WebHosting, reports the Space initialized, and leaves its Webhooks, Schedulers, Scripts,
 * access tokens and ServiceLogin live — so the "reset" Space keeps firing its automation and keeps
 * handing out credentials nobody remembers issuing.
 *
 * `08-space-teardown` measures the opposite request; the two must not answer each other's.
 */
export default {
  id: 'space-reset',
  lang: 'ko',
  prompt: 'Weegloo Space 를 초기화하고 싶어. 안에 있는 걸 싹 비우고 처음부터 다시 쓰려고 해. Space 자체는 지우지 말고 그대로 둬.',
  asserts: [
    { id: 'keeps-the-space', kind: 'judge', expect: 'no',
      question: 'Does the answer delete the Space itself (cma_DeleteOneSpace), or propose deleting it and creating a new one?',
      why: '사용자가 Space 는 유지하라고 명시했다 — 지우고 다시 만들면 spaceId 가 바뀌어 연동이 전부 끊긴다' },
    { id: 'no-cascade-assumption', kind: 'judge', expect: 'yes',
      question: 'Does the answer explicitly delete the Space CONFIGURATION resources — naming at least two of Webhook, Scheduler, Script, ServiceLogin, ServiceUserRole, DeliveryAccessToken, SpaceAccessToken, EmailAccount, Tag, SpaceRole — and not only ContentType / Content / Media / WebHosting? Listing only those four content-plane types is NO. Saying the configuration is cleaned up automatically is NO.',
      why: 'Space 를 남기면 아무것도 cascade 되지 않는다 — 설정 리소스는 하나하나 직접 지워야 한다' },
    { id: 'unpublish-first', kind: 'must_match', pattern: /unpublish|게시\s*해제|발행\s*취소|Draft|Archived/i,
      why: 'Published/Changed 상태는 삭제되지 않는다 (WGL422009)' },
    { id: 'confirm-first', kind: 'judge', expect: 'yes',
      question: 'Does the answer treat the user\'s confirmation as REQUIRED before the first destructive call — either by asking outright, or by making "confirm with the user first" an explicit step of the plan — while stating that the deletion cannot be undone?',
      why: '초기화는 되돌릴 수 없는 삭제의 연속이다 — 범위를 확인받고 시작해야 한다' },
  ],
};
