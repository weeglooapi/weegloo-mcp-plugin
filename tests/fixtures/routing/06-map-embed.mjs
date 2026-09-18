/**
 * Not a silent failure but a silent STALL: asking the user for a Maps API key blocks a task
 * that has no blocking input — the key is hard-coded in the skill. A restructure that loses
 * this turns every map request into a dead end.
 */
export default {
  id: 'map-embed',
  lang: 'ko',
  prompt: '회사 소개 페이지에 우리 사무실 위치를 지도로 보여주고 싶어. Weegloo WebHosting 으로 배포할 정적 사이트야.',
  asserts: [
    { id: 'embed-iframe', kind: 'must_match', pattern: /iframe|Embed\s*API/i,
      why: '정적 호스팅에는 Maps Embed API iframe 을 쓴다 (JavaScript API 아님)' },
    // Measured 2/3 on an unchanged corpus. The old wording ("...supply, obtain OR CONFIGURE...")
    // fired on answers that merely explained where the key already sits, which is not the
    // behaviour being forbidden. What matters is whether the user is made responsible for it.
    { id: 'no-key-question', kind: 'judge', expect: 'no',
      question: 'Does the answer make the user responsible for providing a Google Maps API key — asking them for one, or telling them to go create or obtain one before this can work?',
      why: 'Maps 키는 스킬에 하드코딩돼 있다 — 사용자에게 묻는 것은 불필요한 차단' },
    { id: 'no-placeholder', kind: 'judge', expect: 'no',
      question: 'Does the code in the answer leave the Maps API key as a placeholder or an environment-variable read (e.g. YOUR_API_KEY, process.env.MAPS_KEY) that the user would have to fill in?',
      why: '정적 빌드에는 env 주입 경로가 없다 — placeholder 는 동작하지 않는 코드' },
  ],
};
