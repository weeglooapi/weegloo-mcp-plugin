#!/usr/bin/env node
/**
 * "Does this judge assert still REJECT a wrong answer?"
 *
 * WHY THIS EXISTS
 * ---------------
 * A flaky judge assert is usually fixed by loosening its wording, and loosening has one failure
 * mode with no symptom: an assert that accepts everything scores identically to an assert that
 * was deleted. Stability re-runs cannot see it — they only show the assert passing, which is
 * exactly what a vacuous assert does. Neither can the byte CI or `--compare`.
 *
 * WHAT IT COST TO LEARN THIS
 * --------------------------
 * A rewrite of `bottom-up-order` said independent groups "may be done in any order", which made
 * the assert accept the exact defect it exists to catch (a ContentType deleted before its Content).
 * It passed a negative control anyway — because the control's only wrong answer was wrong in a
 * DIFFERENT way. A negative control proves nothing about failure modes its samples do not
 * contain, so each controlled fixture carries one wrong answer per failure mode, and every judge
 * assert must reject exactly the samples that name it in `violates` — and accept the rest.
 *
 * NOT WIRED INTO CI: it spends real agent calls. Run it by hand when you change a judge question.
 *   node tests/negative-control.mjs                                  # every fixture in CONTROLS
 *   node tests/negative-control.mjs --fixture 08-space-teardown.mjs  # one (file, stem or id; comma list)
 *
 * The default is EVERY controlled fixture, not the one this file used to be hard-wired to. It is
 * run by hand after a judge question changes, and a default that graded only 08 would print
 * "every judge assert caught exactly the samples it covers" for a question it never asked the
 * judge — "could not measure" reported as "fine" (CLAUDE.md §5.3). `--fixture` narrows it;
 * `--fixture 08-space-teardown.mjs` is the old run, sample for sample.
 *
 * The criteria are READ FROM THE FIXTURE and the prompt comes from `judge.mjs`, never copied —
 * a control that grades with a different prompt than the runner proves nothing about the runner.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildJudgePrompt, parseVerdict } from './judge.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEARDOWN_WRONG_ANSWERS = [
  {
    id: 'cascade-myth',
    violates: ['confirm-first', 'bottom-up-order'],
    // Deletes the Space directly on the belief that Weegloo cascades downward. Catches an assert
    // that stopped requiring any ordering at all.
    text: `Weegloo Space 삭제 계획입니다.

## 실행
1. \`cma_DeleteOneSpace\` 를 호출해서 Space 를 바로 삭제합니다. Space 를 지우면 그 안에 있는
   ContentType, Content, Media 는 함께 정리되므로 개별로 지울 필요가 없습니다.
2. 삭제가 끝나면 \`cma_GetListSpaces\` 로 목록에서 사라졌는지 확인합니다.
3. 혹시 실패하면 성공할 때까지 재시도합니다.

ContentType 과 글, 이미지는 Space 에 종속된 자원이라 상위 자원을 지우면 같이 없어집니다.
따라서 별도의 발행 해제나 사전 삭제 단계는 필요하지 않습니다. 바로 진행하겠습니다.`,
  },
  {
    id: 'contenttype-before-content',
    violates: ['bottom-up-order'],
    // Correct in every other respect — confirms, unpublishes, ends with the Space — and wrong in
    // exactly one: the ContentType goes before its own Content, which WGL422010 refuses. This is
    // the sample an "any order is fine" rewrite silently accepted.
    text: `Space 를 정리하는 계획입니다. 삭제는 되돌릴 수 없으므로 실행 전에 대상 Space 와
삭제될 항목 수를 보여드리고 확인받은 뒤 진행하겠습니다.

## 삭제 순서 (bottom-up)
1. **WebHosting** — \`cma_DeleteOneWebHosting\`. 배포 중(\`PENDING\`/\`PROCESSING\`)이면 대기합니다.
2. **ContentType** — \`cma_UnpublishOneContentType\` → \`cma_DeleteOneContentType\`.
   타입을 먼저 치워야 그 아래 글을 정리할 때 기준이 흔들리지 않습니다.
3. **Content** — \`Published\`/\`Changed\` 는 \`cma_UnpublishOneContent\` 로 발행 해제한 뒤
   \`cma_DeleteOneContent\`. 목록은 \`links.next\` 로 끝까지 페이징합니다.
4. **Media** — \`cma_UnpublishOneMedia\` 후 \`cma_DeleteOneMedia\`. 파일 처리(\`state\`)가
   끝나기를 기다립니다. Media 는 다른 자원과 독립이라 순서는 언제든 상관없습니다.
5. **Space** — 위 4종이 0인지 확인한 뒤 \`cma_DeleteOneSpace\`.`,
  },
];

// Four samples for three asserts. `amount-from-server-price` and `no-buyer-order-write` overlap on
// the historical defect (`browser-writes-order` breaks both), so each also gets a sample that
// breaks it ALONE — without those, either assert could go vacuous behind the other and this
// control would still pass. Every sample is correct on the points ledger (only a Script writes it),
// so no judge is distracted by a question none of them asks.
const PAYMENT_WRONG_ANSWERS = [
  {
    id: 'browser-writes-order',
    violates: ['amount-from-server-price', 'no-buyer-order-write'],
    // The shape e670b72 shipped in both payment versions: the page prices the cart and creates the
    // order row itself, and the confirm Script compares the provider's amount with that row. The
    // verification really does run server-side — against the buyer's own number. Grant-once is
    // correct, so `grant-once` must accept it.
    text: `Weegloo 쇼핑몰의 결제와 적립금 지급 설계입니다. 결제 검증은 브라우저가 아니라 서버(Script)에서 합니다.

## ContentType
- **products** — \`name\`, \`price\`(Long). 관리자가 콘솔에서 등록하고 발행합니다.
- **orders** — \`orderId\`, \`product\`(Refer), \`quantity\`, \`amount\`(Long), \`status\`, \`paymentKey\`(RichText)
- **pointLedger** — 적립 내역. confirm Script 만 씁니다.

## 흐름
1. 상품 페이지가 CDA 로 읽은 \`price\` × 수량으로 결제 금액을 계산합니다.
2. 결제하기를 누르면 브라우저가 ACMA 로 orders 에 주문 행을 만듭니다 — \`amount\` 는 1번의 금액,
   \`status: "pending"\`. 그래서 회원 ServiceUserRole 에는 orders 에 대한 \`Create\` 와,
   \`createdBy :self\` 로 좁힌 \`Read\` 를 줍니다.
3. PG 결제창을 띄우고, 결제가 끝나면 성공 페이지가 confirm Script 를 호출합니다.
4. **confirm Script** (서버, 관리자가 작성):
   - \`ResourceFind\` 로 주문을 찾고 \`ResourceRead\` 로 id 로 다시 읽습니다. 이미 \`paid\` 면 바로 Return 합니다.
   - PG 결제 조회 API 를 \`Http\` 로 부릅니다. 시크릿 키는 \`"secret": true\` 헤더에 둡니다.
   - PG 가 알려준 결제 금액이 주문 행의 \`amount\` 와 같은지 비교하고, 다르면 402 로 끝냅니다.
   - 같으면 그 읽기의 \`sys.version\` 으로 잠가 \`status: "paid"\` 를 패치하고, 충돌하면 409 로 끝냅니다.
   - 패치에 성공한 호출만 \`amount\` 의 5% 를 pointLedger 에 적립합니다.

금액 비교를 브라우저가 아니라 Script 안에서 PG 응답과 하므로, 금액을 위조해도 통과하지 못합니다.`,
  },
  {
    id: 'payload-amount',
    violates: ['amount-from-server-price'],
    // Breaks the amount source ALONE: no order row is written by the page and the buyer's role is
    // read-only, but the Script takes the amount from its payload. `no-buyer-order-write` must
    // ACCEPT it — it asks who writes the row, not where the number came from.
    text: `Weegloo 쇼핑몰의 결제와 적립금 지급 설계입니다.

## ContentType
- **products** — \`name\`, \`price\`(Long). 관리자가 콘솔에서 등록하고 발행합니다.
- **orders** — \`orderId\`, \`product\`(Refer), \`quantity\`, \`amount\`(Long), \`status\`, \`paymentKey\`(RichText)
- **pointLedger** — 적립 내역. confirm Script 만 씁니다.

## 흐름
1. 상품 페이지가 CDA 로 읽은 \`price\` × 수량으로 합계를 계산해, 주문 Script 에
   \`{ orderId, productId, quantity, amount }\` 를 보냅니다.
2. **주문 Script** (서버)가 orders 행을 만듭니다 — \`amount\` 는 payload 의 \`amount\`,
   \`status: "pending"\`, \`propagateEvents: true\`. PG 결제도 같은 금액으로 요청합니다.
   브라우저는 주문 행을 직접 쓰지 않습니다.
3. **confirm Script**: 주문을 찾아 id 로 다시 읽고, 이미 \`paid\` 면 바로 Return → PG 결제 조회 →
   PG 금액이 주문 행의 \`amount\` 와 같은지 비교 → \`sys.version\` 잠금으로 \`paid\` 패치(충돌 시 409) →
   패치에 성공한 호출만 5% 적립.

## 회원 역할 (ServiceUserRole)
orders 에는 \`createdBy :self\` 로 좁힌 \`Read\` 만, products 에는 \`Read\` 만, Script 는 주문·confirm
두 개에 \`Execute\` 만 줍니다. orders 에 대한 \`Create\`·\`Edit\`·\`All\` 은 주지 않습니다.

주문 행은 Script 만 쓰고 금액 비교도 서버에서 하므로 위조할 수 없습니다.`,
  },
  {
    id: 'buyer-can-edit-order',
    violates: ['no-buyer-order-write'],
    // Priced correctly — a Script reads the product row and creates the order — but the buyer's role
    // may Edit their own orders. There is no field-level permission, so they can rewrite `amount`,
    // set `status: "paid"`, or put a paid order back to `pending` and replay the grant. That is ONE
    // failure, a WRITE failure, and it belongs to `no-buyer-order-write` alone: the amount was
    // computed from the product price and the confirm Script guards the grant, so
    // `amount-from-server-price` and `grant-once` must both ACCEPT it (each of their questions sets
    // the order row's writers aside, so the three stay one failure mode each).
    text: `Weegloo 쇼핑몰의 결제와 적립금 지급 설계입니다.

## ContentType
- **products** — \`name\`, \`price\`(Long). 관리자가 콘솔에서 등록하고 발행합니다.
- **orders** — \`orderId\`, \`product\`(Refer), \`quantity\`, \`amount\`(Long), \`status\`, \`memo\`, \`paymentKey\`(RichText)
- **pointLedger** — 적립 내역. confirm Script 만 씁니다.

## 흐름
1. 결제하기를 누르면 브라우저는 주문 Script 에 \`{ orderId, productId, quantity }\` 만 보냅니다. 가격은 보내지 않습니다.
2. **주문 Script** 가 products 행을 발행본(\`from: "Published"\`)으로 읽어 ContentType 과 수량을 검사하고,
   \`price\` × \`quantity\` 로 금액을 계산해 orders 행을 직접 만듭니다(\`propagateEvents: true\`).
   PG 결제 요청도 이 Script 가 돌려준 금액으로 합니다.
3. **confirm Script**: 주문을 찾아 id 로 다시 읽고, 이미 \`paid\` 면 바로 Return → PG 결제 조회 →
   PG 금액이 주문 행의 \`amount\` 와 같은지 비교 → \`sys.version\` 잠금으로 \`paid\` 패치(충돌 시 409) →
   패치에 성공한 호출만 5% 적립.

## 회원 역할 (ServiceUserRole)
회원이 배송 메모를 고치거나 결제 전 주문을 취소할 수 있도록, orders 에 \`Read\` 와 \`Edit\` 을
\`createdBy :self\` 로 줍니다. products 에는 \`Read\` 만, Script 는 주문·confirm 두 개에 \`Execute\` 만 줍니다.

\`\`\`json
"content": {
  "Read": { "Allow": [ { "contentType": { "sys": { "id": "<ordersCtId>" } }, "createdBy": { "sys": { "id": ":self" } } } ] },
  "Edit": { "Allow": [ { "contentType": { "sys": { "id": "<ordersCtId>" } }, "createdBy": { "sys": { "id": ":self" } } } ] }
}
\`\`\``,
  },
  {
    id: 'grant-on-every-confirm',
    violates: ['grant-once'],
    // Priced by a Script and role-safe, but the confirm Script grants after a verify call that
    // consumes nothing, with no already-paid guard — the 32c6442 defect. It even DISCUSSES the
    // replay and calls it harmless, so a question loosened to "does the answer mention repeated
    // confirms" would accept it; the real question must not.
    text: `Weegloo 쇼핑몰의 결제와 적립금 지급 설계입니다.

## ContentType
- **products** — \`name\`, \`price\`(Long). 관리자가 콘솔에서 등록하고 발행합니다.
- **orders** — \`orderId\`, \`product\`(Refer), \`quantity\`, \`amount\`(Long), \`status\`, \`paymentKey\`(RichText)
- **pointLedger** — 적립 내역. confirm Script 만 씁니다.

## 흐름
1. 결제하기를 누르면 브라우저는 주문 Script 에 \`{ orderId, productId, quantity }\` 만 보냅니다.
2. **주문 Script** 가 products 발행본의 \`price\` × \`quantity\` 로 금액을 계산해 orders 행을 만들고
   (\`propagateEvents: true\`), 그 금액으로 PG 결제를 요청합니다.
3. **confirm Script**:
   - \`ResourceFind\` 로 주문을 찾습니다. 없으면 404.
   - PG 결제 조회 API(GET)로 결제 상태와 금액을 가져옵니다.
   - 결제 완료이고 PG 금액이 주문 행의 \`amount\` 와 같으면 \`status: "paid"\` 로 패치합니다.
   - 이어서 \`amount\` 의 5% 를 pointLedger 에 적립합니다.

성공 페이지를 새로고침하거나 네트워크 오류로 confirm 이 다시 호출돼도 괜찮습니다. 조회 API 는 몇 번
불러도 같은 결과를 주므로 확인이 그대로 다시 통과하고, 매번 같은 순서로 처리됩니다.

## 회원 역할 (ServiceUserRole)
orders 에는 \`createdBy :self\` 로 좁힌 \`Read\` 만, products 에는 \`Read\` 만, Script 는 주문·confirm
두 개에 \`Execute\` 만 줍니다. orders 에 대한 \`Create\`·\`Edit\`·\`All\` 은 주지 않습니다.`,
  },
];

// One sample per failure mode of 28: Stripe built on a KR install (disclosed, so only `no-stripe`
// may reject it), and the Toss default built right but shipped without the test-key disclosure.
const KR_DEFAULT_WRONG_ANSWERS = [
  {
    id: 'stripe-on-kr',
    violates: ['no-stripe'],
    // The reported defect: no provider named, Stripe built anyway. Toss is mentioned, but only as
    // a later option, so a regex on "토스" alone would pass it.
    text: `결제는 Stripe 테스트 모드로 붙이겠습니다. 결제 서비스를 지정하지 않으셔서, 키 없이 바로
동작하는 Stripe 공개 샘플 키(\`pk_test_TYooMQauvdEDq54NiTphI7jx\` / \`sk_test_BQokikJOvBiI2HlWgH4olfQ2\`)를 씁니다.

## 흐름
1. '구매하기' 버튼은 상품 id 와 수량만 주문 Script 에 보냅니다. Script 가 product 행의 가격으로
   금액을 계산해 주문을 \`pending\` 으로 만들고, Stripe Checkout Session 을 생성해 그 URL 을 돌려줍니다.
2. 브라우저는 Stripe 호스티드 결제 페이지로 이동합니다. 테스트 카드 \`4242 4242 4242 4242\` 를 화면에 안내합니다.
3. 성공 페이지가 confirm Script 를 부르고, Script 가 Stripe API 로 세션을 조회해 \`payment_status: paid\` 와
   금액이 주문 행과 같을 때만 \`paid\` 로 바꿉니다.

나중에 국내 결제가 필요하면 토스페이먼츠로 바꿀 수 있습니다.

\`\`\`diff
- 결제는 Stripe 테스트 키로 동작합니다 — 실제로 청구되는 카드는 없습니다.
\`\`\``,
  },
  {
    id: 'toss-undisclosed',
    violates: ['test-keys-disclosed'],
    // Right provider, right flow, and nothing saying the keys are test keys or that no card is
    // charged — the checkout reads as production-ready.
    text: `결제는 토스페이먼츠 결제위젯(주문서형 결제)으로 붙이겠습니다.

## 흐름
1. 상품 상세 페이지에 결제위젯을 렌더링합니다(\`renderPaymentMethods\`, \`renderAgreement\`).
2. '구매하기'를 누르면 주문 Script 가 product 행의 가격으로 금액을 계산해 주문을 \`pending\` 으로 만들고,
   그 금액으로 \`requestPayment\` 를 호출합니다.
3. 성공 페이지가 confirm Script 를 즉시 부릅니다. Script 는 토스 승인 API 를 호출한 뒤 결제 조회 API 로
   \`DONE\` 과 금액·주문번호가 주문 행과 같은지 확인하고 \`paid\` 로 바꿉니다.
4. 시크릿 키는 Script 의 \`Http.headers\` 에 \`secret: true\` 로만 넣고, 브라우저에는 클라이언트 키만 둡니다.

배포하면 바로 카드 결제를 받을 수 있습니다.`,
  },
];

// One sample per judge assert of 07, plus a second for `index-at-root` that a two-directional regex
// passes. Each is correct on everything else, and the two that `index-at-root` must ACCEPT state the
// location in opposite word orders ("ZIP 최상위에 index.html" / "index.html 이 ZIP 루트에") — the
// order the old regex failed on, so accepting both is the check that the judge does not care.
const WEBHOSTING_WRONG_ANSWERS = [
  {
    id: 'zip-out-folder',
    violates: ['index-at-root'],
    // The defect itself: the build folder is zipped as a folder, so index.html lands at out/index.html
    // and the site 404s. Nothing says where index.html must sit.
    text: `Next.js 회사 홈페이지를 Weegloo WebHosting 에 배포하는 계획입니다.

## 1. 정적 export 로 빌드
WebHosting 은 정적 파일만 서빙하고 서버 런타임이 없으므로 SSR·API Routes·ISR 은 쓸 수 없습니다.
\`next.config.js\` 에 \`output: 'export'\` 와 \`images: { unoptimized: true }\` 를 넣고 \`next build\` 를
실행하면 \`out/\` 폴더에 정적 결과물이 생깁니다.

## 2. ZIP 만들기
\`out/\` 폴더를 통째로 압축해 \`site.zip\` 을 만듭니다(\`zip -r site.zip out\`). 배포 ZIP 에는 디렉터리를
포함해 엔트리가 최대 300개까지 들어갈 수 있으니, 폰트는 CDN 으로 불러 파일 수를 줄입니다.

## 3. 업로드와 배포
1. \`weegloo-upload\` MCP 의 \`CreateUpload\` 로 \`site.zip\` 을 올려 Upload id 를 받습니다.
2. 서브도메인은 회사 이름을 바탕으로 겹치지 않을 만한 것(\`acme-corp-home\`)을 제가 골라
   \`cma_CheckSubdomain\` 으로 확인하고, 이미 쓰이고 있으면 다른 후보로 다시 확인합니다.
3. \`cma_CreateWebHosting\` 으로 배포하고 상태가 완료될 때까지 확인합니다.

배포가 끝나면 고른 서브도메인과 사이트 주소를 알려드리고, 서브도메인은 나중에 언제든 바꿀 수 있다고 안내하겠습니다.`,
  },
  {
    id: 'project-root-misdirection',
    violates: ['index-at-root'],
    // Same nesting, but "루트" and "최상위" both sit within a few characters of index.html — the
    // sample that `(루트|root|최상)…index.html` accepts. A question loosened to "does the answer say
    // where index.html goes" would accept it too; it names a place, just the wrong one.
    text: `Next.js 회사 홈페이지를 Weegloo WebHosting 에 배포하는 계획입니다.

## 1. 정적 export 로 빌드
WebHosting 에는 서버 런타임이 없어 정적 파일만 배포됩니다. \`next.config.js\` 에 \`output: 'export'\` 를
넣고 \`next build\` 로 \`out/\` 을 만듭니다. SSR 과 API Routes 는 쓸 수 없습니다.

## 2. ZIP 만들기
프로젝트 루트에서 \`zip -r site.zip out\` 을 실행합니다. 압축을 열면 최상위에 \`out/\` 폴더가 있고 그 안에
\`index.html\` 과 \`_next/\` 가 들어 있습니다 — 빌드 결과를 폴더 구조 그대로 담아야 경로가 깨지지 않습니다.
ZIP 엔트리는 디렉터리를 포함해 최대 300개이므로, 넘으면 이미지를 줄이거나 CDN 으로 옮깁니다.

## 3. 업로드와 배포
\`CreateUpload\` 로 ZIP 을 올리고, 서브도메인은 제가 \`acme-corp-home\` 처럼 겹치지 않을 이름을 골라
\`cma_CheckSubdomain\` 으로 확인한 뒤 \`cma_CreateWebHosting\` 으로 배포합니다. 완료되면 주소와 함께, 서브도메인은
나중에 바꿀 수 있다고 알려드리겠습니다.`,
  },
  {
    id: 'no-entry-cap',
    violates: ['file-cap'],
    // Right packaging, location stated FIRST, and the cap denied outright — a question loosened to
    // "does the answer talk about the number of files" would accept it.
    text: `Next.js 회사 홈페이지를 Weegloo WebHosting 에 배포하는 계획입니다.

## 1. 정적 export 로 빌드
WebHosting 은 정적 호스팅이라 SSR·API Routes 를 쓸 수 없습니다. \`next.config.js\` 에 \`output: 'export'\` 를
넣고 \`next build\` 로 \`out/\` 을 만듭니다.

## 2. ZIP 만들기
ZIP 최상위에 \`index.html\` 이 오도록, \`out/\` 폴더 자체가 아니라 그 안에서 압축합니다
(\`cd out && zip -r ../site.zip .\`). 파일 개수 제한은 따로 없으므로 이미지와 폰트를 모두 그대로 넣어도 됩니다.

## 3. 업로드와 배포
\`CreateUpload\` 로 ZIP 을 올리고, 서브도메인은 제가 \`acme-corp-home\` 처럼 겹치지 않을 이름을 골라
\`cma_CheckSubdomain\` 으로 확인한 뒤 \`cma_CreateWebHosting\` 으로 배포합니다. 완료되면 주소와 함께, 서브도메인은
나중에 바꿀 수 있다고 알려드리겠습니다.`,
  },
  {
    id: 'asks-subdomain',
    violates: ['no-subdomain-question'],
    // Correct build, location stated AFTER index.html, cap stated — and the deploy stalls on a
    // question. Offering candidates does not make it a choice the agent made.
    text: `Next.js 회사 홈페이지를 Weegloo WebHosting 에 배포하는 계획입니다.

## 1. 정적 export 로 빌드
WebHosting 은 정적 호스팅이라 SSR·API Routes 를 쓸 수 없습니다. \`next.config.js\` 에 \`output: 'export'\` 를
넣고 \`next build\` 로 \`out/\` 을 만듭니다.

## 2. ZIP 만들기
\`index.html\` 이 ZIP 루트에 오도록 \`out/\` 안에서 압축합니다(\`cd out && zip -r ../site.zip .\`).
ZIP 엔트리는 디렉터리를 포함해 최대 300개입니다.

## 3. 업로드와 배포
\`CreateUpload\` 로 ZIP 을 올린 뒤 \`cma_CheckSubdomain\` 으로 서브도메인을 확인하고 \`cma_CreateWebHosting\` 으로
배포합니다.

배포 전에 사용할 서브도메인을 정해 주세요. 후보로 \`acme-home\`, \`acme-corp\` 를 생각해 두었는데, 어느 쪽으로
할지(또는 원하는 다른 이름을) 알려주시면 확인한 뒤 바로 배포하겠습니다.`,
  },
];

// Four samples for the two judge asserts of 30 — two failure modes each, every sample right on the
// other assert. `timeout-only` is the shape that shipped: the wait does end, but only after an
// arbitrary timeout, so a question loosened to "does the code handle a login that never completes"
// would accept it. `silent-on-localhost` never claims localhost works — it just never says where the
// sign-in can be tested, which leaves a user who said they would check it on `npm run dev` to find
// out from the console's error screen.
const USER_LOGIN_WRONG_ANSWERS = [
  {
    id: 'no-close-watch',
    violates: ['ends-wait-on-close'],
    // The example as it stood before 291b9d7: the wait ends only when a token arrives.
    text: `관리자 페이지(/admin) 로그인 계획입니다. 관리자는 Space 에 초대된 Weegloo User 이므로 ServiceLogin 이 아니라
Weegloo 콘솔 로그인 팝업으로 로그인하고, 받은 토큰으로 CMA 를 호출합니다. PAT 는 브라우저에 넣지 않습니다.

## 로그인 코드
\`\`\`javascript
// 콘솔이 보내는 토큰을 받는 리스너 — 앱 시작 시 한 번만 등록
window.addEventListener("message", (event) => {
  if (event.origin !== "https://console.weegloo.com") return
  const token = event.data?.accessToken
  if (typeof token === "string" && token.trim()) {
    sessionStorage.setItem("access_token", token.trim())
    verifyAdmin() // 아래 '로그인 확인' — 끝나면 "확인 중…" 상태를 풉니다
  }
})

// 관리자 로그인 버튼
function openLoginPopup() {
  window.open(
    "https://console.weegloo.com/login?origin=" + encodeURIComponent(location.origin),
    "weegloo-login",
    "width=500,height=600"
  )
  showSigningIn() // 버튼을 "확인 중…"으로 바꾸고 비활성화
}
\`\`\`

## 로그인 확인
1. \`GET https://cma.weegloo.com/v1/me\` 로 토큰이 유효한지 확인합니다. 401 이면 토큰을 지우고 로그아웃 상태로 돌립니다.
2. \`GET /v1/me/space-memberships\` 의 \`item.sys.space.sys.id\` 에 우리 Space 가 있는지 확인하고, 없으면 토큰을 지웁니다.
3. 통과하면 관리 화면을 띄우고, 메뉴 Content 는 CMA 로 PATCH 한 뒤 Publish 합니다.

## 로컬 개발
콘솔 로그인 팝업은 같은 환경의 Weegloo WebHosting 에서 서빙된 앱에서만 로그인이 끝납니다. \`http://localhost:5173\` 에서는
콘솔이 일반 에러 화면으로 끝나므로, 화면 작업은 로컬에서 하되 로그인은 배포한 WebHosting 에서 확인하세요.`,
  },
  {
    id: 'timeout-only',
    violates: ['ends-wait-on-close'],
    // What the production app did: a 5-minute timeout and no popup.closed check. The wait does end
    // — after the user has given up.
    text: `관리자 페이지(/admin) 로그인 계획입니다. 관리자는 Space 에 초대된 Weegloo User 이므로 ServiceLogin 이 아니라
Weegloo 콘솔 로그인 팝업으로 로그인하고, 받은 토큰으로 CMA 를 호출합니다. PAT 는 브라우저에 넣지 않습니다.

## 로그인 코드
\`\`\`javascript
let loginTimer = null

// 콘솔이 보내는 토큰을 받는 리스너 — 앱 시작 시 한 번만 등록
window.addEventListener("message", (event) => {
  if (event.origin !== "https://console.weegloo.com") return
  const token = event.data?.accessToken
  if (typeof token === "string" && token.trim()) {
    clearTimeout(loginTimer)
    sessionStorage.setItem("access_token", token.trim())
    verifyAdmin()
  }
})

// 관리자 로그인 버튼
function openLoginPopup() {
  window.open(
    "https://console.weegloo.com/login?origin=" + encodeURIComponent(location.origin),
    "weegloo-login",
    "width=500,height=600"
  )
  showSigningIn()
  // 로그인이 끝나지 않으면 5분 뒤 대기를 끝내고 다시 시도할 수 있게 합니다
  clearTimeout(loginTimer)
  loginTimer = setTimeout(() => {
    showSignedOut("로그인 시간이 초과되었습니다. 다시 시도하세요.")
  }, 5 * 60 * 1000)
}
\`\`\`

## 로그인 확인
1. \`GET https://cma.weegloo.com/v1/me\` 로 토큰이 유효한지 확인합니다. 401 이면 토큰을 지우고 로그아웃 상태로 돌립니다.
2. \`GET /v1/me/space-memberships\` 의 \`item.sys.space.sys.id\` 에 우리 Space 가 있는지 확인하고, 없으면 토큰을 지웁니다.
3. 통과하면 관리 화면을 띄우고, 메뉴 Content 는 CMA 로 PATCH 한 뒤 Publish 합니다.

## 로컬 개발
콘솔 로그인 팝업은 같은 환경의 Weegloo WebHosting 에서 서빙된 앱에서만 로그인이 끝납니다. \`http://localhost:5173\` 에서는
콘솔이 일반 에러 화면으로 끝나므로, 화면 작업은 로컬에서 하되 로그인은 배포한 WebHosting 에서 확인하세요.`,
  },
  {
    id: 'localhost-origin',
    violates: ['signin-on-webhosting'],
    // What the old spine's "not WebHosting-specific" invites: localhost becomes the origin, so the
    // login is "testable" locally. The close watch is correct.
    text: `관리자 페이지(/admin) 로그인 계획입니다. 관리자는 Space 에 초대된 Weegloo User 이므로 ServiceLogin 이 아니라
Weegloo 콘솔 로그인 팝업으로 로그인하고, 받은 토큰으로 CMA 를 호출합니다. PAT 는 브라우저에 넣지 않습니다.

## 로그인 코드
\`\`\`javascript
let loginWatch = null

// 콘솔이 보내는 토큰을 받는 리스너 — 앱 시작 시 한 번만 등록
window.addEventListener("message", (event) => {
  if (event.origin !== "https://console.weegloo.com") return
  const token = event.data?.accessToken
  if (typeof token === "string" && token.trim()) {
    clearInterval(loginWatch)
    sessionStorage.setItem("access_token", token.trim())
    verifyAdmin()
  }
})

// 관리자 로그인 버튼
function openLoginPopup() {
  clearInterval(loginWatch) // 이전 대기가 남아 있으면 정리
  const popup = window.open(
    "https://console.weegloo.com/login?origin=" + encodeURIComponent(location.origin),
    "weegloo-login",
    "width=500,height=600"
  )
  showSigningIn()
  // 토큰 없이 창이 닫히면(사용자가 닫음, 콘솔 에러 화면) 대기를 끝내고 다시 시도할 수 있게 합니다
  loginWatch = setInterval(() => {
    if (popup.closed) {
      clearInterval(loginWatch)
      showSignedOut("로그인 창이 닫혔습니다. 다시 시도하세요.")
    }
  }, 500)
}
\`\`\`

## 로그인 확인
1. \`GET https://cma.weegloo.com/v1/me\` 로 토큰이 유효한지 확인합니다. 401 이면 토큰을 지우고 로그아웃 상태로 돌립니다.
2. \`GET /v1/me/space-memberships\` 의 \`item.sys.space.sys.id\` 에 우리 Space 가 있는지 확인하고, 없으면 토큰을 지웁니다.
3. 통과하면 관리 화면을 띄우고, 메뉴 Content 는 CMA 로 PATCH 한 뒤 Publish 합니다.

## 로컬 개발
\`npm run dev\` 로 띄우면 \`location.origin\` 이 \`http://localhost:5173\` 이 되고 그 값이 그대로 \`origin\` 으로 전달되므로,
로컬에서도 로그인부터 관리 화면까지 끝까지 확인할 수 있습니다. 확인이 끝나면 빌드해 WebHosting 에 다시 배포합니다.`,
  },
  {
    id: 'silent-on-localhost',
    violates: ['signin-on-webhosting'],
    // Claims nothing wrong — and never says where the sign-in can be tested. A question loosened to
    // "does the answer avoid saying localhost works" would accept it.
    text: `관리자 페이지(/admin) 로그인 계획입니다. 관리자는 Space 에 초대된 Weegloo User 이므로 ServiceLogin 이 아니라
Weegloo 콘솔 로그인 팝업으로 로그인하고, 받은 토큰으로 CMA 를 호출합니다. PAT 는 브라우저에 넣지 않습니다.

## 로그인 코드
\`\`\`javascript
let loginWatch = null

// 콘솔이 보내는 토큰을 받는 리스너 — 앱 시작 시 한 번만 등록
window.addEventListener("message", (event) => {
  if (event.origin !== "https://console.weegloo.com") return
  const token = event.data?.accessToken
  if (typeof token === "string" && token.trim()) {
    clearInterval(loginWatch)
    sessionStorage.setItem("access_token", token.trim())
    verifyAdmin()
  }
})

// 관리자 로그인 버튼
function openLoginPopup() {
  clearInterval(loginWatch) // 이전 대기가 남아 있으면 정리
  const popup = window.open(
    "https://console.weegloo.com/login?origin=" + encodeURIComponent(location.origin),
    "weegloo-login",
    "width=500,height=600"
  )
  showSigningIn()
  // 토큰 없이 창이 닫히면(사용자가 닫음, 콘솔 에러 화면) 대기를 끝내고 다시 시도할 수 있게 합니다
  loginWatch = setInterval(() => {
    if (popup.closed) {
      clearInterval(loginWatch)
      showSignedOut("로그인 창이 닫혔습니다. 다시 시도하세요.")
    }
  }, 500)
}
\`\`\`

## 로그인 확인
1. \`GET https://cma.weegloo.com/v1/me\` 로 토큰이 유효한지 확인합니다. 401 이면 토큰을 지우고 로그아웃 상태로 돌립니다.
2. \`GET /v1/me/space-memberships\` 의 \`item.sys.space.sys.id\` 에 우리 Space 가 있는지 확인하고, 없으면 토큰을 지웁니다.
3. 통과하면 관리 화면을 띄우고, 메뉴 Content 는 CMA 로 PATCH 한 뒤 Publish 합니다.

## 배포
작업이 끝나면 빌드해 기존 WebHosting 에 다시 배포합니다.`,
  },
];

// Controlled fixture file → its wrong answers. A fixture joins by adding a line here; its judge
// questions are read from the fixture itself.
const CONTROLS = {
  '07-webhosting-deploy.mjs': WEBHOSTING_WRONG_ANSWERS,
  '08-space-teardown.mjs': TEARDOWN_WRONG_ANSWERS,
  '26-payment-amount-grant-once.mjs': PAYMENT_WRONG_ANSWERS,
  '28-payment-default-kr-toss.mjs': KR_DEFAULT_WRONG_ANSWERS,
  '30-user-login-popup-close.mjs': USER_LOGIN_WRONG_ANSWERS,
};

function agent(prompt) {
  return new Promise((resolve, reject) => {
    const c = spawn('claude', ['-p'], { shell: process.platform === 'win32', stdio: ['pipe', 'pipe', 'pipe'] });
    c.stdin.on('error', () => {});
    c.stdin.end(prompt, 'utf-8');
    let out = '';
    c.stdout.on('data', (d) => { out += d; });
    c.on('error', reject);
    c.on('close', () => resolve(out));
  });
}

function harnessError(msg) { console.error(msg); process.exit(2); }

let wanted = null;
for (let i = 2; i < process.argv.length; i++) {
  const arg = process.argv[i];
  if (arg === '--fixture' && process.argv[i + 1]) wanted = process.argv[++i].split(',').map((s) => s.trim()).filter(Boolean);
  else harnessError(`unknown or incomplete argument: ${arg}  (usage: --fixture <file|stem|id>[,…])`);
}

// Load and check EVERY selected fixture before the first agent call: a harness error found halfway
// through would have spent the calls before it and still measured nothing.
const selected = [];
for (const [file, samples] of Object.entries(CONTROLS)) {
  let fx;
  try { fx = (await import(pathToFileURL(path.join(__dirname, 'fixtures', 'routing', file)).href)).default; }
  catch (err) { harnessError(`${file}: cannot load the controlled fixture — ${err.message}`); }
  if (!fx || !Array.isArray(fx.asserts)) harnessError(`${file}: no fixture default export with 'asserts'`);
  const names = [file, file.replace(/\.mjs$/, ''), fx.id];
  if (wanted && !wanted.some((w) => names.includes(w))) continue;
  const judges = fx.asserts.filter((a) => a.kind === 'judge');
  if (!judges.length) harnessError(`${file} has no judge asserts to control`);
  const judgeIds = new Set(judges.map((a) => a.id));
  // A `violates` id that names no judge assert (a typo, a renamed assert) does not fail quietly —
  // the real assert then rejects a sample it was "not supposed to", and is reported as OVERREACH,
  // sending the next person to loosen a healthy question. Refuse it here, by name.
  for (const bad of samples) {
    const unknown = bad.violates.filter((id) => !judgeIds.has(id));
    if (unknown.length) harnessError(`${file}: wrong answer '${bad.id}' violates ${unknown.join(', ')} — no judge assert of that id in the fixture`);
  }
  // A judge assert that no sample must reject is never shown rejecting anything: it would pass this
  // control while accepting every answer. Refuse the run rather than print a green for it.
  const uncovered = judges.filter((a) => !samples.some((b) => b.violates.includes(a.id)));
  if (uncovered.length) harnessError(`${file}: no wrong answer is meant to be caught by ${uncovered.map((a) => a.id).join(', ')} — add one per failure mode`);
  selected.push({ file, names, samples, judges });
}
const missing = (wanted || []).filter((w) => !selected.some((s) => s.names.includes(w)));
if (missing.length) harnessError(`--fixture matched no controlled fixture: ${missing.join(', ')}  (controlled: ${Object.keys(CONTROLS).join(', ')})`);

// A sample wrong in ONE dimension must be rejected by the assert covering that dimension — and
// ACCEPTED by the others. Demanding that every assert reject every sample was this control's own
// bug: `media-after-contenttype` opens by promising to confirm before deleting, so `confirm-first`
// saying YES is correct, and scoring that as VACUOUS would send the next person to "fix" a healthy
// assert. Over-rejection is reported too — an assert that fails a sample it does not cover is
// reading something it was never asked about, which is how a gate quietly starts measuring the
// wrong thing.
let failed = 0;
for (const { file, samples, judges } of selected) {
  console.log(`
=== ${file}  (${judges.length} judge assert(s) × ${samples.length} wrong answer(s))`);
  for (const bad of samples) {
    console.log(`
--- wrong answer: ${bad.id}  (must be caught by: ${bad.violates.join(', ')})`);
    for (const a of judges) {
      const shouldReject = bad.violates.includes(a.id);
      const verdict = parseVerdict(await agent(buildJudgePrompt(bad.text, a.question)));
      if (verdict === null) { console.log(`  ??        ${a.id}: judge emitted no verdict`); failed++; continue; }
      const rejected = a.expect === 'yes' ? verdict === false : verdict === true;
      if (shouldReject && !rejected) { console.log(`  VACUOUS   ${a.id}: accepted a sample it must catch`); failed++; }
      else if (!shouldReject && rejected) { console.log(`  OVERREACH ${a.id}: rejected a sample it does not cover`); failed++; }
      else console.log(`  OK        ${a.id}: ${rejected ? 'rejected' : 'accepted'}, as expected`);
    }
  }
}
console.log('');
console.log(failed ? `${failed} check(s) failed.` : `every judge assert caught exactly the samples it covers (${selected.map((s) => s.file).join(', ')}).`);
process.exit(failed ? 1 : 0);
