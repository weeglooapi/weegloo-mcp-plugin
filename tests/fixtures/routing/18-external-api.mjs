/**
 * Routing gate with a security edge: calling a third-party API needs a secret, and a secret
 * cannot live in a static frontend. The wrong answer (fetch from the browser with the key
 * inlined) works in the demo and leaks the key to everyone who opens devtools.
 */
export default {
  id: 'external-api',
  lang: 'ko',
  prompt: '사용자가 글을 저장하면 외부 AI API 를 불러서 요약을 만들고, 그 요약을 글에 같이 저장하고 싶어. 백엔드 서버는 따로 없어.',
  asserts: [
    { id: 'script', kind: 'must_match', pattern: /Script/,
      why: '자체 백엔드 없이 외부 API 를 호출하고 결과를 쓰는 것은 Script 의 용도다' },
    { id: 'no-browser-key', kind: 'judge', expect: 'no',
      question: 'Does the answer put the third-party API key in client-side code (browser fetch, inlined constant, or a build-time public env var), so a visitor could read it?',
      why: '브라우저에 API 키를 두면 devtools 를 여는 누구에게나 유출된다' },
    { id: 'secret-server-side', kind: 'judge', expect: 'yes',
      question: 'Does the answer keep the external API key server-side (inside the Weegloo Script) rather than exposing it to the client?',
      why: '외부 API 키는 서버 권위가 있는 곳에만 둔다' },
  ],
};
