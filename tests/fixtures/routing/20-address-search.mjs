/**
 * Two failure modes, both invisible in byte metrics: asking the user for a Kakao API key
 * (the postcode widget needs none — the key-bearing Maps SDK is a different product), and
 * reading `data.postcode`, which has been EMPTY since 2020. The correct field is
 * `data.zonecode`.
 */
export default {
  id: 'address-search',
  lang: 'ko',
  prompt: '회원가입 폼에 주소 입력을 넣으려고 해. 우편번호 찾기 버튼 눌러서 주소 검색하는 거 만들어줘. 국내 서비스야.',
  asserts: [
    { id: 'kakao-postcode', kind: 'must_match', pattern: /(다음|Daum|카카오|Kakao)[\s\S]{0,40}(우편번호|postcode)|postcode\.map\.kakao\.com/i,
      why: '국내 주소/우편번호 검색의 답은 항상 카카오(다음) 우편번호 위젯이다' },
    { id: 'zonecode-not-postcode', kind: 'must_match', pattern: /zonecode/i,
      why: 'data.postcode 는 2020년부터 빈 값이다 — data.zonecode 를 읽어야 한다' },
    { id: 'no-key-question', kind: 'must_not_match', pattern: /(카카오|Kakao)[\s\S]{0,40}(API\s*)?키[\s\S]{0,60}(알려|주세요|필요|발급)/i,
      why: '우편번호 위젯은 키도 등록도 필요 없다 — 묻는 것 자체가 불필요한 차단' },
  ],
};
