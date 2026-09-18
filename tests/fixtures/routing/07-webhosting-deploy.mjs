/**
 * WebHosting has four constraints that each produce a DIFFERENT failure: SSR builds fail
 * at deploy, >300 entries fail at upload, a nested index.html fails silently as a 404,
 * and asking the user to pick a subdomain stalls a task that should not stall.
 */
export default {
  id: 'webhosting-deploy',
  lang: 'ko',
  prompt: 'Next.js 로 만든 회사 홈페이지를 Weegloo WebHosting 에 배포하려고 해. 어떻게 준비하고 배포하면 돼?',
  asserts: [
    { id: 'static-export', kind: 'must_match', pattern: /정적|static|export|SSR\s*(불가|안|없|미지원)/i,
      why: 'WebHosting 에는 서버 런타임이 없다 — 정적 export 만 배포된다' },
    { id: 'index-at-root', kind: 'must_match', pattern: /index\.html[\s\S]{0,60}(루트|root|최상)/i,
      why: 'ZIP 루트에 index.html 이 없으면 사이트가 뜨지 않는다' },
    { id: 'file-cap', kind: 'must_match', pattern: /\b(300|100)\b[\s\S]{0,40}(파일|files|개)/i,
      why: '배포 ZIP 의 엔트리 상한을 넘기면 업로드가 거부된다' },
    { id: 'no-subdomain-question', kind: 'must_not_match', pattern: /서브도메인[\s\S]{0,60}(뭐로|무엇으로|어떤\s*걸|알려주세요|정해주세요)/i,
      why: '서브도메인은 에이전트가 고르고 사후 통지한다 — 물어보지 않는다' },
  ],
};
