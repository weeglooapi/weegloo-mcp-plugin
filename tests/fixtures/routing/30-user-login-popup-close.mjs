/**
 * Silent-failure class: a browser admin UI whose console login popup closes WITHOUT posting a token —
 * the user closes it, or the console shows an error screen (not a member of the Space, terms not
 * accepted) and the user dismisses it. Code that only waits for the token message never learns this:
 * the login button stays on "확인 중…" until some timeout, with no hint to retry. It happened: an app
 * built from the skill's example sat disabled until its own 5-minute timeout (found while investigating
 * a production Sentry issue). 291b9d7 added a `popup.closed` watch to the example.
 *
 * The same commit reversed a claim the old spine made — that the popup flow is "not WebHosting-specific"
 * and works on "any other browser-hosted site". The sign-in completes only for an app served from a
 * Weegloo WebHosting of the same environment; from `localhost` it ends on a generic error screen. The
 * prompt says the user will check the login on `npm run dev`, so an answer has to take a position on it.
 *
 * Deliberately NOT scored: the blocked-popup branch (`window.open` returning null) and ending an earlier
 * wait before reopening. Both are in the example, and a question that also asked them would stop being
 * one question.
 *
 * WHAT THE A/B SHOWED (2026-10-29, 3 runs per corpus, agent spawned outside the repo — next paragraph):
 *                            latest 8d3ff81db8f1 (before)   291b9d7 f23c7c37ebe1 (after)
 *     console-popup                    3/3                           3/3
 *     ends-wait-on-close               2/3                           3/3
 *     signin-on-webhosting             0/3                           3/3
 * `signin-on-webhosting` is what 291b9d7 bought: on the old corpus one run told the user `location.origin`
 * would carry localhost through "with no code change", and the other two never said where the sign-in
 * could be tested. `ends-wait-on-close` is mostly a floor — the agent added a close watch on its own in two
 * runs of three — so read a failure there, and do not cite a pass as proof of the fix.
 *
 * MEASURE A CONTROL OUTSIDE THE REPO. `run-fixtures.mjs` spawns the agent in the repo root, and there the
 * answer leaks whenever the installed corpus differs from the checkout: the agent can read
 * `plugins/weegloo/skills/**` without a permission prompt (one run grepped the branch's SKILL.md for
 * `closed|WebHosting|localhost`), and Claude Code puts recent commit subjects in its system prompt —
 * 291b9d7's subject states both fixes. Run in the repo with the OLD corpus installed, this fixture scored
 * 3/3 on both judge asserts. The numbers above came from `--agent-cmd` pointing at a wrapper that spawns
 * `claude -p` in an empty directory, for the agent and the judge alike.
 *
 * Every judge assert here is controlled by `tests/negative-control.mjs` — one wrong answer per failure
 * mode, each right on the other assert. Change a question, re-run the control.
 *
 * NOT IN `tests/baseline.develop.json`: `--compare` scores these asserts but cannot flag them as
 * regressions until a baseline that includes them is recorded.
 */
export default {
  id: 'user-login-popup-close',
  lang: 'ko',
  prompt: 'Weegloo WebHosting 에 올려 둔 우리 카페 홈페이지(정적 사이트)에 관리자 페이지(/admin)를 붙이려고 해. 관리자는 우리 Weegloo Space 에 초대된 팀원들이고, 로그인하면 메뉴 Content 를 고치고 발행할 수 있어야 해. 관리자 로그인 버튼을 누른 순간부터 관리 화면이 뜨기까지의 프론트엔드 로그인 코드를 짜줘. 개발은 로컬에서 npm run dev(http://localhost:5173)로 로그인까지 확인하면서 하고, 다 되면 다시 배포할 거야.',
  asserts: [
    // Both spellings of the login URL: the literal, or a `CONSOLE_ORIGIN` constant + `/login?origin=`
    // (measured: one correct run built it from the constant and failed a literal-only pattern).
    { id: 'console-popup', kind: 'must_match', pattern: /^(?=[\s\S]*console\.weegloo\.com)(?=[\s\S]*\/login\?origin=)/,
      why: '초대된 Space 멤버의 로그인이 콘솔 로그인 팝업이 아니면 ServiceLogin(누구나 가입)이나 번들에 박은 PAT 로 간다 — 아무나 관리자가 되거나 전권 토큰이 공개된다' },
    { id: 'ends-wait-on-close', kind: 'judge', expect: 'yes',
      question: "Does the answer's login code detect that the login popup window was closed without a token having arrived — for example by checking `popup.closed` on an interval — and then end the 'signing in' wait so the user can press the login button again? It is NO if the code only reacts to the token message, or ends the wait only through a fixed timeout, without ever checking whether the popup was closed.",
      why: '로그인 창이 토큰 없이 닫히면(사용자가 닫음, 콘솔 에러 화면을 닫음) 앱은 알 길이 없다 — "확인 중…"에 멈춰 타임아웃까지 다시 로그인할 수 없다. 운영 앱에서 실제로 난 일이다' },
    { id: 'signin-on-webhosting', kind: 'judge', expect: 'yes',
      question: 'Does the answer tell the user that the console login popup cannot complete the sign-in for the app running on the local dev server (http://localhost:5173) — it completes only for the app served from a deployed Weegloo WebHosting — so the sign-in has to be tested on a deployed WebHosting? It is NO if the answer says or implies the sign-in can be completed on localhost (for example by passing origin=http://localhost:5173 to the console), or never says where the sign-in can be tested.',
      why: 'localhost 에서는 콘솔 로그인이 일반 에러 화면으로 끝난다 — 로컬에서 된다고 안내받은 사용자는 멀쩡한 코드를 붙잡고 디버깅한다' },
  ],
};
