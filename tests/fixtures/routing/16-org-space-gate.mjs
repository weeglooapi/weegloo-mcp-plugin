/**
 * The gate that keeps work from scattering into an arbitrary workspace. Its failure is
 * maximally silent: every call succeeds, in the wrong Space. This fixture uses a deliberately
 * bare request — no feature named — which is the strongest case for routing.
 */
export default {
  id: 'org-space-gate',
  lang: 'ko',
  prompt: 'Weegloo 로 포트폴리오 사이트 만들어줘.',
  asserts: [
    { id: 'space-is-settled', kind: 'judge', expect: 'yes',
      question: 'Does the answer establish which Organization/Space the work targets — by asking the user to choose, or by listing their options — before creating resources?',
      why: '거의 모든 리소스는 특정 Space 안에 산다 — 먼저 정해야 한다' },
    { id: 'no-auto-pick-first', kind: 'judge', expect: 'no',
      question: 'Does the answer silently pick an Organization or Space for the user — for example by taking the first item of a list — without their choice?',
      why: '목록의 첫 항목을 자동으로 고르면 작업이 엉뚱한 워크스페이스에 흩어진다' },
    { id: 'routes-to-modeling', kind: 'must_match', pattern: /ContentType|콘텐츠\s*타입|모델링/i,
      why: '광범위 요청은 라우터를 거쳐 구체 스킬로 가야 한다 — 바로 스캐폴딩하면 안 된다' },
  ],
};
