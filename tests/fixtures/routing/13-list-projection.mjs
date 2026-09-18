/**
 * An unprojected list returns whole documents — every locale bucket of every field of every
 * row. It never errors; it quietly consumes the context window and the user's quota for data
 * nothing renders. `limit` over 100 is the opposite: a hard rejection.
 */
export default {
  id: 'list-projection',
  lang: 'en',
  prompt: 'Write the CDA request for a blog index page that shows each post title and publish date, 20 posts per page.',
  asserts: [
    { id: 'select-present', kind: 'must_match', pattern: /\bselect=/i,
      why: 'select 는 모든 읽기의 기본 — 없으면 문서 전체가 돌아온다' },
    { id: 'limit-sane', kind: 'must_match', pattern: /limit=\d+/i,
      why: 'limit 은 화면이 렌더링하는 만큼만' },
    { id: 'no-oversized-limit', kind: 'judge', expect: 'no',
      question: 'Does the answer use a limit value greater than 100 in a request it tells the reader to make? A mention that 100 is the maximum does NOT count.',
      why: 'limit 의 하드 최대는 100 — 초과하면 거부된다' },
  ],
};
