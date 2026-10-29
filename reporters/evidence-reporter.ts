/**
 * Turns a verifier run into an evidence record QIVVRA can store and decide on.
 *
 * Verifiers report per CHECK (e.g. "V2/bank-change-self-approval-blocked"). They do
 * not know about policies or obligations: the policy snapshot maps obligations to
 * checks, so policy owners can re-point an obligation without touching verifiers.
 *
 *   passed                         -> SUPPORTED
 *   failed in an assertion         -> VIOLATED       (positive evidence of a breach)
 *   failed while arranging data    -> NOT_ASSESSED   (could not run the check)
 *   skipped                        -> NOT_ASSESSED
 *   any check, if V1 did not pass  -> NOT_ASSESSED   (evidence is not from the commit under review)
 */
import type { FullConfig, FullResult, Reporter, Suite, TestCase, TestResult, TestStep } from '@playwright/test/reporter';
import { createHash } from 'crypto';
import { execFileSync } from 'child_process';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

type State = 'SUPPORTED' | 'VIOLATED' | 'NOT_ASSESSED';
interface CheckEvidence {
  check: string; verifier: string; name: string; state: State; outcome: string;
  reason: string | null; durationMs: number; observation: unknown;
}

const FULL_ACCOUNT = /\b\d{9,18}\b/g;
/** Evidence is stored for years; it must never contain the data the checks protect. */
const mask = (s: string) => s.replace(FULL_ACCOUNT, (m) => `**** ${m.slice(-4)}`);
const stripAnsi = (s: string) => s.replace(/\u001b\[[0-9;]*m/g, '');

function failedArrangeStep(steps: TestStep[]): TestStep | undefined {
  for (const s of steps) {
    if (s.title.startsWith('arrange:') && s.error) return s;
    const inner = failedArrangeStep(s.steps);
    if (inner) return inner;
  }
  return undefined;
}

export default class EvidenceReporter implements Reporter {
  private checks: CheckEvidence[] = [];
  private startedAt = new Date().toISOString();
  private baseURL = process.env.BASE_URL!;
  private versionAtStart: unknown = null;

  async onBegin(_config: FullConfig, _suite: Suite) {
    this.versionAtStart = await this.version();
  }

  onTestEnd(test: TestCase, result: TestResult) {
    const [verifier, name] = test.title.split('/');
    const raw = result.attachments.find((a) => a.name === 'observation')?.body?.toString();
    let observation: unknown = null;
    try { observation = raw ? JSON.parse(mask(raw)) : null; } catch { observation = mask(raw ?? ''); }

    let state: State; let reason: string | null = null;
    if (result.status === 'passed') state = 'SUPPORTED';
    else if (result.status === 'skipped') {
      state = 'NOT_ASSESSED';
      reason = test.annotations.find((a) => a.type === 'skip')?.description ?? 'skipped';
    } else {
      const arrange = failedArrangeStep(result.steps);
      const message = mask(stripAnsi(result.error?.message ?? result.status)).split('\n').slice(0, 6).join('\n');
      if (arrange) { state = 'NOT_ASSESSED'; reason = `Could not ${arrange.title.replace('arrange: ', 'arrange ')}: ${message}`; }
      else { state = 'VIOLATED'; reason = message; }
    }
    this.checks.push({ check: test.title, verifier, name, state, outcome: result.status, reason, durationMs: result.duration, observation });
  }

  async onEnd(result: FullResult) {
    const versionAtEnd = await this.version();
    const v1 = this.checks.find((c) => c.check === 'V1/qe-runs-head-commit');
    const sameBuild = JSON.stringify(versionAtEnd) === JSON.stringify(this.versionAtStart);
    const environmentConfirmed = v1?.state === 'SUPPORTED' && sameBuild;
    if (v1 && v1.state === 'SUPPORTED' && !sameBuild) {
      v1.state = 'VIOLATED';
      v1.reason = 'The environment changed build during the run';
    }
    if (!environmentConfirmed) {
      for (const c of this.checks) if (c !== v1 && c.state !== 'NOT_ASSESSED') {
        c.reason = `Evidence discarded (${c.state}): the environment was not confirmed to run the commit under review`;
        c.state = 'NOT_ASSESSED';
      }
    }

    let verifierCommit: string | null = null;
    try { verifierCommit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { /* not a checkout */ }

    const record = {
      kind: 'qivvra.evidence/v1',
      target: { baseUrl: this.baseURL, expectedSha: process.env.EXPECTED_SHA ?? null, versionAtStart: this.versionAtStart, versionAtEnd },
      environmentConfirmed,
      verifiers: { repository: 'qivvra-verifiers', commit: verifierCommit },
      run: { startedAt: this.startedAt, finishedAt: new Date().toISOString(), playwrightStatus: result.status },
      checks: Object.fromEntries(this.checks.sort((a, b) => a.check.localeCompare(b.check)).map((c) => [c.check, c])),
    };
    const sha = process.env.EXPECTED_SHA ?? 'unknown';
    const dir = process.env.EVIDENCE_DIR ?? join('evidence', sha);
    mkdirSync(dir, { recursive: true });
    const body = JSON.stringify(record, null, 2);
    const digest = createHash('sha256').update(body).digest('hex');
    writeFileSync(join(dir, 'evidence.json'), body);
    writeFileSync(join(dir, 'evidence.sha256'), `${digest}  evidence.json\n`);

    console.log(`\nQIVVRA evidence: ${join(dir, 'evidence.json')} (sha256:${digest.slice(0, 12)}…)`);
    for (const c of this.checks) console.log(`  ${c.state.padEnd(13)} ${c.check}`);
  }

  private async version() {
    try { return await (await fetch(new URL('/version', this.baseURL))).json(); } catch { return null; }
  }

  printsToStdio() { return true; }
}
