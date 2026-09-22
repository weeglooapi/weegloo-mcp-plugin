/**
 * The email credential IS a blocking input (unlike a PG key), so the correct behavior is to
 * ask for exactly two values and stop — not to ask which vendor, and not to ship an inert
 * email feature. Both wrong directions fail silently.
 */
export default {
  id: 'send-email',
  lang: 'ko',
  prompt: '문의 폼으로 들어온 내용을 우리 회사 메일로 받아보고 싶어. Weegloo 에서 메일 보내는 것도 되나?',
  asserts: [
    { id: 'gmail-default', kind: 'must_match', pattern: /Gmail|구글|Google/i,
      why: '사용자가 메일 서비스를 지정하지 않으면 Google/Gmail SMTP 가 기본' },
    { id: 'app-password', kind: 'must_match', pattern: /앱\s*비밀번호|App\s*Password/i,
      why: '계정 비밀번호가 아니라 앱 비밀번호를 요청해야 한다' },
    { id: 'no-vendor-question', kind: 'judge', expect: 'no',
      question: 'Does the answer ask the user which email service or SMTP vendor to use, instead of defaulting to Google/Gmail SMTP?',
      why: '"어떤 메일 서비스를 쓸까요?" 는 금지된 질문' },
    { id: 'asks-gmail-address', kind: 'judge', expect: 'yes',
      question: 'Does the answer ask the user for the Google/Gmail ADDRESS that the App Password belongs to, in addition to the App Password itself?',
      why: '주소가 username 과 fromAddress 를 채운다 — 비밀번호만 받으면 계정을 만들 수 없다' },
    { id: 'emailaccount-resource', kind: 'must_match', pattern: /EmailAccount/i,
      why: 'SMTP 발신자는 Space 에 EmailAccount 로 등록된다' },
  ],
};
