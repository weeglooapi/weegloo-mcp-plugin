/**
 * Silent-failure class A: a `fields.*` filter without X-Weegloo-Advanced-Search returns
 * an EMPTY ARRAY, not an error. The agent then reports "검색 결과가 없습니다" to the user
 * and everyone believes it. It also degrades into an unindexed scan that passes on seed
 * data and times out in production.
 */
export default {
  id: 'search-feature',
  lang: 'ko',
  prompt: 'Weegloo 로 만든 블로그에 검색 기능을 넣고 싶어. 사용자가 입력한 단어가 글 제목이나 본문에 포함된 글을 찾아야 해. 어떻게 구현해?',
  asserts: [
    { id: 'advanced-search-header', kind: 'must_match', pattern: /X-Weegloo-Advanced-Search/i,
      why: '이 헤더가 없으면 fields.* 필터는 에러가 아니라 빈 배열을 돌려주고, 에이전트는 "결과 없음"이라 보고한다' },
    { id: 'server-side', kind: 'must_match', pattern: /서버|server-?side|filter|쿼리|query/i,
      why: '페이지네이션된 컬렉션을 클라이언트에서 Array.filter 하면 로드된 행만 검색하고 나머지를 조용히 놓친다' },
    { id: 'no-memory-filter-only', kind: 'must_not_match', pattern: /(전부|모두|all)\s*(불러|가져|fetch|로드)[\s\S]{0,60}(filter|필터)/i,
      why: '전체를 받아서 메모리 필터링하는 설계는 데이터가 커지면 틀린 결과를 낸다' },
  ],
};
