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
    { id: 'flattened-on-delivery', kind: 'judge', expect: 'yes',
      question: 'Does the answer state that a default CDA/ACDA read returns each field FLATTENED (fields.title is the value itself), as opposed to a per-locale bucket?',
      why: 'CDA 기본 읽기는 fields.title 자체가 값이다' },
    { id: 'no-blind-locale-index', kind: 'judge', expect: 'no',
      question: 'Does the answer instruct the reader to index a locale key on a default CDA/ACDA response — e.g. accessing fields.title["en-US"] — as the way to read the value?',
      why: 'CDA 응답에 [locale] 인덱싱하면 undefined 가 나온다. 단, 두 plane 의 차이를 설명하며 대비로 보여주는 것은 올바른 행동이다' },
  ],
};
