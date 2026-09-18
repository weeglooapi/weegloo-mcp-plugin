/**
 * Silent-failure class A on the write side. Two distinct traps:
 *  - a required+localized field missing its default-locale bucket is the most common create
 *    rejection;
 *  - a localized:false field written under a NON-default locale is ACCEPTED on create/PUT and
 *    then never delivered on a normal read — the value simply vanishes.
 */
export default {
  id: 'locale-create',
  lang: 'ko',
  prompt: '한국어와 영어를 지원하는 사이트를 만들고 있어. 공지사항 Content 를 하나 만드는 요청 본문을 보여줘. 제목은 언어별로 다르고, 게시 여부 플래그는 언어와 무관해.',
  asserts: [
    { id: 'buckets-not-scalar', kind: 'must_match', pattern: /fields[\s\S]{0,160}(ko-KR|en-US)/,
      why: 'CMA 쓰기는 per-locale 버킷 구조다' },
    { id: 'default-locale-bucket', kind: 'judge', expect: 'yes',
      question: 'Does the request body include a value under the space DEFAULT locale for the required localized title field?',
      why: 'required+localized 필드는 기본 로케일 버킷을 반드시 포함해야 한다 — 없으면 create 가 거부된다' },
    { id: 'non-localized-default-only', kind: 'judge', expect: 'yes',
      question: 'Is the non-localized flag field (the publish/게시 여부 boolean) written ONLY under the default locale bucket, rather than under every locale?',
      why: 'localized:false 필드에 비기본 로케일 키를 넣으면 create/PUT 은 통과하지만 그 값은 배달되지 않는다' },
  ],
};
