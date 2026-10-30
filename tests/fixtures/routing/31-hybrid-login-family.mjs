/**
 * Silent-failure class: a product with two kinds of people — the parents who write, the family they
 * invite to read — put on ONE login model. Every variant works, so nothing ever errors:
 *   - the family invited to the Space as Weegloo members: every grandparent needs a Weegloo platform
 *     account and holds management-API rights,
 *   - the parents moved onto ServiceLogin too: their editing is boxed into a ServiceUserRole (no
 *     publish, no settings), or dropped to "use the console",
 *   - the family on ServiceLogin with the reader role as everyone's default: anyone with a Google
 *     account reads every diary.
 *
 * Reported from MongleDiary, a MarketApp with exactly this shape (owner on the console login popup →
 * CMA, invited family on ServiceLogin → ACDA, `approvalRequired: true`): agents kept choosing one of the
 * two logins. The corpus pointed them there — `weegloo-service-architecture` said "Pick the row that
 * matches the product" (one recipe per product) and described ServiceLogin only as open sign-up, so an
 * INVITED family read like invited Space members. The fix decides per actor and says an invite-only
 * end-user is a ServiceLogin account with `approvalRequired`.
 *
 * Deliberately NOT scored: the family's own writes (hearts) and their `:self` scope — that is
 * `members-only-site` — and which social provider the family uses.
 *
 * WHAT THE A/B SHOWED (2026-10-30, agent and judge spawned outside the repo, installed corpus latest
 * f23c7c37ebe1; for "after", only `weegloo-service-architecture/SKILL.md` was replaced, with this
 * branch's manifest text — the bytes `--update` would write. The installer stamp does not see such a
 * swap, so `tests/run.hybrid-login.json` still records installedVersion f23c7c37ebe1):
 *                      before    after
 *     both-logins       0/4       4/4
 *     invite-gate       4/4       4/4
 * The "before" answer kept verbatim put the parents on the family's Kakao ServiceLogin too — a
 * `parent-author` ServiceUserRole attached in the console — and left in-app approval "to be confirmed".
 * `invite-gate` is a floor: the old corpus already gated with a do-nothing `defaultRole` + `roleOverride`.
 * What the fix added there is `approvalRequired`, named in all 3 "after" answers read and in the 1
 * "before" answer read not at all — not scored, because `roleOverride` gating alone is correct.
 *
 * MEASURE OUTSIDE THE REPO, as `30-user-login-popup-close` explains: run in the repo root, the agent can
 * read the checkout's SKILL.md, so a run on the old installed corpus sees the new text.
 *
 * Every judge assert here is controlled by `tests/negative-control.mjs` — one wrong answer per failure
 * mode, each right on the other assert. Change a question, re-run the control.
 *
 * NOT IN `tests/baseline.develop.json`: `--compare` scores these asserts but cannot flag them as
 * regressions until a baseline that includes them is recorded.
 */
export default {
  id: 'hybrid-login-family',
  lang: 'ko',
  prompt: '가족 육아일기 웹앱을 Weegloo 로 만들려고 해. 우리 부부가 앱에서 일기를 쓰고 사진을 올리면, 우리가 초대한 가족(할머니, 고모 같은)만 들어와서 일기를 읽고 하트를 남길 수 있어야 해. 초대받지 않은 사람은 아무것도 볼 수 없어야 하고. 로그인과 권한을 어떻게 설계하면 될까?',
  asserts: [
    { id: 'both-logins', kind: 'judge', expect: 'yes',
      question: 'Does the answer give the two groups two different sign-ins — the parents (who write the diary) sign in with their own Weegloo accounts as members of the Space, through the Weegloo console login popup, and write through CMA, while the invited family sign in through ServiceLogin (a social login) as Service Users? It is NO if the answer puts everyone on one of them: the family invited to the Weegloo Space as members with Weegloo accounts, or the parents also signing in through ServiceLogin, or the parents left to write in the Weegloo console with no sign-in in the app.',
      why: '로그인을 하나로 몰면 한쪽이 틀린 신원으로 간다 — 가족을 Space 에 초대하면 할머니마다 Weegloo 계정과 관리 API 권한이 생기고, 부부까지 ServiceLogin 에 두면 일기 관리가 ServiceUserRole(발행·설정 불가)에 갇힌다. 어느 쪽도 에러가 나지 않는다' },
    { id: 'invite-gate', kind: 'judge', expect: 'yes',
      question: 'Does the answer include a concrete mechanism that keeps people who were NOT invited from reading the diary — for example an approval step before a new account can sign in (ServiceLogin `approvalRequired`), or a default role that reads nothing with the read role given only to each invited person (`roleOverride`) — and leave no anonymous read path (such as a DeliveryAccessToken / CDA read shipped to the browser) that exposes the diary? It is NO if anyone who completes the sign-in gets a role that can read the diary, if the answer never says how an uninvited sign-in is kept out, or if the diary can be read without signing in.',
      why: '초대 확인 없이 기본 역할이 일기를 읽으면 Google 계정만 있으면 누구나 모든 가족 일기를 읽는다 — 에러도 경고도 없다. 브라우저 번들에 실린 DeliveryAccessToken 도 같다' },
  ],
};
