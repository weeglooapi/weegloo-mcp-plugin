/**
 * Routing gate with a security edge: calling a third-party API needs a secret, and a
 * secret cannot live in a static frontend. The wrong answer (fetch from the browser with
 * the key inlined) works in the demo and leaks the key to everyone who opens devtools.
 */
export default {
  id: 'external-api',
  lang: 'ko',
  prompt: '사용자가 글을 저장하면 외부 AI API 를 불러서 요약을 만들고, 그 요약을 글에 같이 저장하고 싶어. 백엔드 서버는 따로 없어.',
  asserts: [
    { id: 'script', kind: 'must_match', pattern: /Script/,
      why: '자체 백엔드 없이 외부 API 를 호출하고 결과를 쓰는 것은 Script 의 용도다' },
    { id: 'secret-server-side', kind: 'must_match', pattern: /(키|key|secret|시크릿)[\s\S]{0,80}(서버|Script|노출하지|숨기|클라이언트에\s*두지)/i,
      why: '외부 API 키는 클라이언트에 절대 두지 않는다' },
    { id: 'no-browser-key', kind: 'must_not_match', pattern: /(브라우저|프론트엔드|클라이언트)[\s\S]{0,60}(API\s*키|apiKey|Authorization)[\s\S]{0,40}(넣|포함|하드코딩)/i,
      why: '브라우저에 API 키를 인라인하면 devtools 를 여는 누구에게나 유출된다' },
  ],
};
