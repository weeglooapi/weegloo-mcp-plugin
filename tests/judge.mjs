/**
 * The judge prompt, in ONE place.
 *
 * It was previously inlined in `run-fixtures.mjs` and copied into `negative-control.mjs`. A
 * control that grades with a DIFFERENT prompt than the runner proves nothing about the runner,
 * and nothing makes the copies diverge loudly — so they live here and both import them.
 *
 * FORMAT: cite-then-verdict. The judge quotes the span it is deciding on before committing.
 * Measured on a held-fixed, hand-verified-correct answer, 5 runs each:
 *     one-word (the old format)   4/5 YES   ← flipped on an input that never changed
 *     cite-then-verdict           5/5 YES
 * The old format forced a binary call on a multi-clause criterion with no room to work, and its
 * disagreement was pure instrument noise: same answer, same criterion, different verdict. That
 * noise is not harmless even though `--compare` re-runs a regression before believing it — every
 * flake buys 4 extra confirmation runs, so a noisy judge is also the expensive one.
 *
 * NOTE: the verdict marker is REQUIRED on the last line. A judge that rambles without emitting
 * one is reported as "no verdict" rather than silently read as NO — an unparsed grade is a
 * missing measurement, and this harness never scores those as "fine".
 */

/** Wraps one answer + one criterion into the grading prompt. */
export function buildJudgePrompt(answer, question) {
  return `You are grading one answer against one criterion.

CRITERION: ${question}

Judge only what the ANSWER below actually says. Warning against a practice, or explicitly
ruling it out, is NOT doing or recommending it — that is the opposite, and must be graded as
such. If the answer neither does nor recommends the thing in the criterion, the criterion is
not met.

--- ANSWER BEGINS ---
${answer}
--- ANSWER ENDS ---

First quote the shortest span of the ANSWER that decides this criterion, or write NONE if the
answer never addresses it. Then, on the LAST line by itself, write exactly one of:
VERDICT: YES
VERDICT: NO`;
}

/**
 * Reads the verdict off a judge reply. Returns true/false, or null when the judge emitted no
 * parseable marker — the caller must treat null as "not measured", never as a NO.
 */
export function parseVerdict(raw) {
  const m = String(raw).toUpperCase().match(/VERDICT:\s*(YES|NO)/g);
  if (!m || !m.length) return null;
  return /YES/.test(m[m.length - 1]); // the LAST marker is the verdict; earlier ones may be quoted
}
