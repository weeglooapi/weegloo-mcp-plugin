/**
 * Silent-failure class A: a ServiceUserRole without the `createdBy :self` filter lets
 * EVERY member read, edit and DELETE every other member's rows, with no error anywhere.
 * Nothing in the product surface reveals it. This is the single highest-consequence gate
 * in the corpus, so it is fixture #1.
 */
export default {
  id: 'members-only-site',
  lang: 'ko',
  prompt: '회원제 커뮤니티 사이트를 Weegloo로 만들려고 해. 누구나 가입할 수 있고, 회원이 글을 쓰고 자기가 쓴 글만 수정/삭제할 수 있어야 해. 어떻게 설계하면 될까?',
  asserts: [
    { id: 'service-login', kind: 'must_match', pattern: /ServiceLogin/i,
      why: '오픈 가입 end-user 는 Weegloo 플랫폼 계정이 아니라 ServiceLogin(Service User) 이어야 한다' },
    { id: 'createdby-self', kind: 'must_match', pattern: /createdBy[\s\S]{0,120}:self|":self"|':self'/,
      why: '이 필터가 없으면 모든 회원이 남의 글을 읽고 수정하고 삭제한다 — 에러 없이 조용히' },
    { id: 'acma-not-cma', kind: 'must_match', pattern: /\bACMA\b/,
      why: 'Service User 토큰은 CMA/CDA 에 절대 가지 않는다; 멤버 쓰기는 ACMA' },
    { id: 'no-cma-for-members', kind: 'judge', expect: 'no',
      question: 'Does the answer propose that signed-in members (Service Users) call the CMA or CDA API with their ServiceLogin token?',
      why: 'Service User 토큰을 CMA/CDA 로 보내는 설계는 토큰 경계 위반이다' },
  ],
};
