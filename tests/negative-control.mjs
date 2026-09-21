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
 * the assert accept the exact defect it exists to catch (a ContentType deleted before its Media).
 * It passed a negative control anyway — because the control's only wrong answer was wrong in a
 * DIFFERENT way. A negative control proves nothing about failure modes its samples do not
 * contain, so WRONG_ANSWERS carries one per mode and every judge assert must reject every one.
 *
 * NOT WIRED INTO CI: it spends real agent calls. Run it by hand when you change a judge question.
 *   node tests/negative-control.mjs
 *
 * The criteria are READ FROM THE FIXTURE and the prompt comes from `judge.mjs`, never copied —
 * a control that grades with a different prompt than the runner proves nothing about the runner.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildJudgePrompt, parseVerdict } from './judge.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = '08-space-teardown.mjs';

const WRONG_ANSWERS = [
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
    id: 'media-after-contenttype',
    violates: ['bottom-up-order'],
    // Correct in every other respect — confirms, unpublishes, ends with the Space — and wrong in
    // exactly one: the ContentType goes before its Media, and Media is called independent. This is
    // the sample an "any order is fine" rewrite silently accepted.
    text: `Space 를 정리하는 계획입니다. 삭제는 되돌릴 수 없으므로 실행 전에 대상 Space 와
삭제될 항목 수를 보여드리고 확인받은 뒤 진행하겠습니다.

## 삭제 순서 (bottom-up)
1. **WebHosting** — \`cma_DeleteOneWebHosting\`. 배포 중(\`PENDING\`/\`PROCESSING\`)이면 대기합니다.
2. **Content** — \`Published\`/\`Changed\` 는 \`cma_UnpublishOneContent\` 로 발행 해제한 뒤
   \`cma_DeleteOneContent\`. 목록은 \`links.next\` 로 끝까지 페이징합니다.
3. **ContentType** — 해당 타입의 Content 가 모두 사라졌으므로 이제 지울 수 있습니다.
   \`cma_UnpublishOneContentType\` → \`cma_DeleteOneContentType\`.
4. **Media** — \`cma_UnpublishOneMedia\` 후 \`cma_DeleteOneMedia\`. 파일 처리(\`state\`)가
   끝나기를 기다립니다. Media 는 다른 자원과 독립이라 순서는 언제든 상관없습니다.
5. **Space** — 위 4종이 0인지 확인한 뒤 \`cma_DeleteOneSpace\`.`,
  },
];

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

const fx = (await import(pathToFileURL(path.join(__dirname, 'fixtures', 'routing', FIXTURE)).href)).default;
const judges = fx.asserts.filter((a) => a.kind === 'judge');
if (!judges.length) { console.error(`${FIXTURE} has no judge asserts to control`); process.exit(2); }

// A sample wrong in ONE dimension must be rejected by the assert covering that dimension — and
// ACCEPTED by the others. Demanding that every assert reject every sample was this control's own
// bug: `media-after-contenttype` opens by promising to confirm before deleting, so `confirm-first`
// saying YES is correct, and scoring that as VACUOUS would send the next person to "fix" a healthy
// assert. Over-rejection is reported too — an assert that fails a sample it does not cover is
// reading something it was never asked about, which is how a gate quietly starts measuring the
// wrong thing.
let failed = 0;
for (const bad of WRONG_ANSWERS) {
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
console.log('');
console.log(failed ? `${failed} check(s) failed.` : 'every judge assert caught exactly the samples it covers.');
process.exit(failed ? 1 : 0);
