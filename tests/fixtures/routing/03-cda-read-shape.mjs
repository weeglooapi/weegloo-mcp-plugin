/**
 * Silent-failure class A: CDA/ACDA FLATTEN fields by default (`fields.title`), while
 * CMA/ACMA return per-locale buckets (`fields.title[locale]`). Indexing `[locale]` on a
 * default delivery read yields `undefined` — no error, just an empty page.
 */
export default {
  id: 'cda-read-shape',
  lang: 'en',
  prompt: 'I have a static site that fetches published articles from the Weegloo CDA and renders the title and body. Show me how to read the fields out of the CDA response correctly, and explain the field shape.',
  asserts: [
    { id: 'flattened-on-delivery', kind: 'must_match', pattern: /flat|평탄|scalar|fields\.\w+(?!\s*\[)/i,
      why: 'CDA 기본 읽기는 fields.title 자체가 값이다' },
    { id: 'bucket-vs-flat-contrast', kind: 'must_match', pattern: /(CMA|management)[\s\S]{0,300}(bucket|locale)|locale[\s\S]{0,300}(CDA|delivery)/i,
      why: '두 plane 의 shape 차이를 알아야 [locale] 인덱싱 버그를 피한다' },
    { id: 'no-blind-locale-index', kind: 'must_not_match', pattern: /fields\.\w+\[\s*['"`]?(en-US|ko-KR|locale)['"`]?\s*\][\s\S]{0,80}(CDA|delivery)/i,
      why: 'CDA 응답에 [locale] 인덱싱하면 undefined 가 나온다' },
  ],
};
