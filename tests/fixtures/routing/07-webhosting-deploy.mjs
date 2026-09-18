/**
 * WebHosting has four constraints that each produce a DIFFERENT failure: an SSR build fails
 * at deploy, >300 entries fail at upload, a nested index.html fails silently as a 404, and
 * asking the user to pick a subdomain stalls a task that should not stall.
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
    // Was a regex requiring 300/100 within 40 chars of 파일/files/개. Measured at ~4/6 across
    // repeated runs on an unchanged corpus: the agent states the cap correctly every time but
    // phrases it as "아카이브 엔트리 300개" / "최대 300 엔트리" / "300 entries", and the window
    // caught only some of those. An assert that fails on correct answers is the false-regression
    // machine this suite exists to avoid, so the criterion is judged rather than matched.
    { id: 'file-cap', kind: 'judge', expect: 'yes',
      question: 'Does the answer state a hard upper limit on how many entries/files the deployment ZIP may contain (a number such as 300 or 100)?',
      why: '배포 ZIP 의 엔트리 상한을 넘기면 업로드가 거부된다' },
    { id: 'no-subdomain-question', kind: 'judge', expect: 'no',
      question: 'Does the answer ask the user to choose or provide the subdomain, rather than picking one itself and telling the user afterwards?',
      why: '서브도메인은 에이전트가 고르고 사후 통지한다 — 물어보지 않는다' },
  ],
};
