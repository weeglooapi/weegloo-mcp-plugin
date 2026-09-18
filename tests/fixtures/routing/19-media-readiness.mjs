/**
 * Silent-failure class A: referencing a Media from Content before its file has finished
 * processing produces a Refer stub that resolves to an image which never loads. No error
 * at write time, no error at read time — just a broken image in production.
 */
export default {
  id: 'media-readiness',
  lang: 'ko',
  prompt: '이미지를 업로드해서 Media 로 만들고, 그 이미지를 상품 Content 의 대표 이미지 필드에 연결하는 흐름을 설명해줘.',
  asserts: [
    { id: 'wait-published', kind: 'must_match', pattern: /Published|처리\s*(완료|끝)|대기|기다/i,
      why: 'Content 에서 참조하기 전에 sys.status 가 Published 가 될 때까지 기다려야 한다' },
    { id: 'file-state', kind: 'must_match', pattern: /PENDING|PROCESSING|FAILED|state/i,
      why: '필요한 로케일의 file state 가 처리 중이면 아직 배포 가능한 자산이 아니다' },
    { id: 'no-manual-publish-step', kind: 'must_not_match', pattern: /업로드\s*(후|다음)[\s\S]{0,40}(반드시|바로)\s*(수동으로\s*)?publish/i,
      why: 'Media 는 처리 성공 시 플랫폼이 스스로 Published 로 올린다 — 수동 publish 가 기본 절차가 아니다' },
  ],
};
