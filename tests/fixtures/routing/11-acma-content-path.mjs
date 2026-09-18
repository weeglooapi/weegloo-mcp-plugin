/**
 * A flat /contents path on ACMA returns 404 — self-announcing, so not a silent failure —
 * but the agent's instinctive repair is to retry URL variants rather than nest under the
 * ContentType. The text that prevents the wasted loop has to survive the restructure.
 */
export default {
  id: 'acma-content-path',
  lang: 'en',
  prompt: 'In my app a signed-in member wants to edit one of their own posts. I have the contentId. Show me the exact ACMA endpoint to call.',
  asserts: [
    { id: 'nested-path', kind: 'must_match', pattern: /content-types\/[^/\s]+\/contents/i,
      why: 'ACMA 의 모든 Content 연산은 ContentType 아래에 중첩된다' },
    { id: 'no-flat-acma', kind: 'must_not_match', pattern: /acma\.weegloo\.com\/v1\/spaces\/[^/\s]+\/contents\//i,
      why: 'ACMA 에 flat /contents/{id} 는 존재하지 않는다 (404)' },
    { id: 'resolve-contenttype', kind: 'must_match', pattern: /contentTypeId|sys\.contentType|ContentType\s*(id|를|을)/i,
      why: 'contentId 만으로는 ACMA URL 을 만들 수 없다 — ContentType 을 먼저 해결해야 한다' },
  ],
};
