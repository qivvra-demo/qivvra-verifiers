/**
 * Maps a verifier run onto a frozen policy snapshot and previews the disposition.
 * The QIVVRA engine owns the real decision; this is the same logic for local runs.
 *
 *   npm run summarize -- --evidence evidence/<sha>/evidence.json --snapshot snapshot.json [--out report.md]
 *
 * The snapshot comes from the policy repository:
 *   (cd ../vendorpay-policies && npm run -s select -- --repo vendorpay --repo-dir ../vendorpay-app \
 *      --range main...<sha> --jira VP-184 --json) > snapshot.json
 */
import { readFileSync, writeFileSync } from 'fs';

type State = 'SUPPORTED' | 'VIOLATED' | 'INSUFFICIENT' | 'CONFLICTED' | 'NOT_ASSESSED';
const args = process.argv.slice(2);
const opt = (n: string) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
if (!opt('evidence') || !opt('snapshot')) { console.error('Need --evidence and --snapshot'); process.exit(2); }

const evidence = JSON.parse(readFileSync(opt('evidence')!, 'utf8'));
const snapshot = JSON.parse(readFileSync(opt('snapshot')!, 'utf8'));

const rows: Array<{ policy: string; severity: string; obligation: string; statement: string; check: string; state: State; reason: string | null; excepted: boolean }> = [];
for (const p of snapshot.policies) {
  for (const o of p.obligations) {
    const key = `${o.verifier}/${o.check}`;
    const c = evidence.checks[key];
    // No check result at all means no evidence source: INSUFFICIENT.
    const state: State = c ? c.state : 'INSUFFICIENT';
    const excepted = snapshot.exceptions.some((x: { policy: string; obligations: string[] }) => x.policy === p.id && x.obligations.includes(o.id));
    rows.push({ policy: p.id, severity: p.severity, obligation: o.id, statement: o.statement, check: key, state, reason: c?.reason ?? (c ? null : 'No verifier evidence for this check'), excepted });
  }
}

// payments-critical profile, first match wins.
let disposition: string;
if (rows.some((r) => r.state === 'NOT_ASSESSED' && r.severity === 'critical')) disposition = 'INDETERMINATE';
else if (rows.some((r) => r.state === 'VIOLATED' || r.state === 'CONFLICTED')) disposition = 'NOT READY';
else if (rows.some((r) => r.state === 'INSUFFICIENT' && !r.excepted)) disposition = 'NOT READY';
else if (rows.some((r) => r.state === 'INSUFFICIENT')) disposition = 'READY WITH EXCEPTIONS';
else disposition = 'READY';

const sha = evidence.target.versionAtStart?.gitSha ?? evidence.target.expectedSha;
const count = (s: State) => rows.filter((r) => r.state === s).length;
console.log(`\n${snapshot.repository} @ ${sha}  (${snapshot.jira ?? 'no Jira key'}, profile ${snapshot.profile})`);
console.log(`Environment confirmed: ${evidence.environmentConfirmed ? 'yes' : 'NO'}   policy snapshot ${snapshot.snapshotDigest.slice(0, 19)}…\n`);
for (const r of rows) console.log(`  ${r.state.padEnd(13)} ${r.obligation.padEnd(10)} ${r.statement}`);
console.log(`\n  ${count('SUPPORTED')} supported, ${count('VIOLATED')} violated, ${count('INSUFFICIENT')} insufficient, ${count('NOT_ASSESSED')} not assessed`);
console.log(`  Disposition: ${disposition}\n`);

if (opt('out')) {
  const md = [
    `# QIVVRA assessment: ${snapshot.repository} @ ${sha}`,
    '',
    `**Disposition: ${disposition}**`,
    '',
    `Jira ${snapshot.jira ?? '—'} · profile ${snapshot.profile} · policy repo ${snapshot.policyRepoCommit} · snapshot \`${snapshot.snapshotDigest}\` · verifiers ${evidence.verifiers.commit ?? '—'}`,
    '',
    '| State | Obligation | Statement | Evidence |',
    '|---|---|---|---|',
    ...rows.map((r) => `| ${r.state} | ${r.obligation} | ${r.statement} | ${r.check}${r.reason && r.state !== 'SUPPORTED' ? `: ${r.reason.split('\n')[0].replace(/\|/g, '/')}` : ''} |`),
    '',
  ].join('\n');
  writeFileSync(opt('out')!, md);
}
