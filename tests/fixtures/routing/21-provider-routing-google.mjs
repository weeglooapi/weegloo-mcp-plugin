/**
 * Phase 2 caps every frontmatter description at 700 B, and the seven per-provider OAuth skills
 * are where that is most dangerous: they share most of their shape, so a careless compression
 * makes them mutually indistinguishable and the router picks the wrong one — or the generic
 * spine — with no error anywhere.
 *
 * This fixture pins the Google branch. Its partner (22) pins Kakao; if a rewrite collapses the
 * two, one of them fails.
 */
export default {
  id: 'provider-routing-google',
  lang: 'ko',
  prompt: '우리 서비스에 구글 계정으로 로그인하는 기능을 넣고 싶어. Weegloo 로 어떻게 붙여?',
  asserts: [
    { id: 'service-login', kind: 'must_match', pattern: /ServiceLogin/i,
      why: '제품 end-user 로그인은 ServiceLogin 이다 (Weegloo 플랫폼 계정 로그인이 아니다)' },
    // Measured 5/7 on an unchanged corpus with the earlier two-part wording ("...AND the
    // redirect URI..."): every run, including the failures, named the Google Cloud Console — the
    // second clause duplicated the `redirect-uri` assert below and made the verdict turn on a
    // detail this assert is not about. One question, one fact.
    { id: 'google-specific', kind: 'judge', expect: 'yes',
      question: "Does the answer name Google's own developer console (Google Cloud Console) as where the OAuth client is created for this sign-in?",
      why: 'provider 스킬 7개가 서로 구분되지 않으면 라우터가 엉뚱한 것을 열거나 spine 만 연다' },
    { id: 'redirect-uri', kind: 'judge', expect: 'yes',
      question: 'Does the answer give the auth.weegloo.com redirect URI that must be registered in the provider console, as a value the user is told to copy?',
      why: 'provider 콘솔에 등록할 Redirect URI 는 사용자가 직접 해야 하는 수동 단계다' },
    { id: 'no-wrong-provider', kind: 'judge', expect: 'no',
      question: 'Does the answer walk through a DIFFERENT provider (Kakao, Naver, GitHub, LINE, Facebook, GitLab) as the one being set up?',
      why: '요청한 provider 가 아닌 것을 설정하면 조용히 틀린 작업이 된다' },
  ],
};
