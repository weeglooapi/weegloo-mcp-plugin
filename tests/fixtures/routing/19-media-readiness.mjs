/**
 * Silent-failure class A: referencing a Media from Content before its file has finished
 * processing produces a Refer stub that resolves to an image which never loads. No error at
 * write time, no error at read time — just a broken image in production.
 */
export default {
  id: 'media-readiness',
  lang: 'ko',
  prompt: '이미지를 업로드해서 Media 로 만들고, 그 이미지를 상품 Content 의 대표 이미지 필드에 연결하는 흐름을 설명해줘.',
  asserts: [
    { id: 'wait-for-readiness', kind: 'judge', expect: 'yes',
      question: 'Does the answer wait for the Media to become ready — polling until sys.status is Published and the file processing state for the needed locale has settled — BEFORE referencing it from Content?',
      why: '처리 중인 Media 를 참조하면 영원히 로드되지 않는 이미지가 된다 — 에러는 없다' },
    { id: 'file-state', kind: 'must_match', pattern: /PENDING|PROCESSING|FAILED/,
      why: '필요한 로케일의 file state 가 처리 중이면 아직 배포 가능한 자산이 아니다' },
    { id: 'no-manual-publish-step', kind: 'judge', expect: 'no',
      question: 'Does the answer present calling PublishOneMedia as the normal, required step right after upload — as opposed to noting that Weegloo publishes the Media itself once processing succeeds?',
      why: 'Media 는 처리 성공 시 플랫폼이 스스로 Published 로 올린다 — 수동 publish 가 기본 절차가 아니다' },
  ],
};
