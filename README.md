# qivvra-verifiers

QIVVRA's own checks for VendorPay. They run against the **deployed** QE environment and produce evidence that QIVVRA maps onto the policy repository's obligations.

This repository is owned by QIVVRA, not by the VendorPay team. The team writes its own tests in `vendorpay-app/tests`; those prove the story was built as written. These prove the change meets policy, including rules the story never mentioned. Because the team cannot edit them, a team cannot weaken the checks on its own change.

## The checks

| Check | What it does | Obligations (from the policy repo) |
|---|---|---|
| V1/qe-runs-head-commit | `/version` reports the PR head commit, and the same build is still running at the end of the run | PLT-001.1 |
| V2/bank-change-self-approval-blocked | Approver A raises a bank change and tries to approve it: must be 403. Approver B then can. | FIN-001.1 |
| V2/proposed-account-not-payable | While a change is pending, a new payment goes to the current account, never the proposed one | FIN-001.2 |
| V2/payment-self-release-blocked | The scheduler cannot release their own payment | FIN-003.1 |
| V2/payment-single-release | A second release is refused | FIN-003.2 |
| V3/scheduled-payments-held | Schedule a payment, approve a bank change, then try to release: the payment must be held and the release refused | FIN-002.1 |
| V3/no-silent-redirect | A held payment's destination only changes with a recorded Finance decision | FIN-002.2 |
| V3/held-payment-visible | Finance sees the payment as held, with a reason | FIN-002.3 |
| V4/api-masked | No API response, for any role, contains a 9–18 digit run | SEC-001.2 |
| V4/ui-masked | No screen, for any role, shows a full account number | SEC-001.1 |
| V4/logs-masked | The application log and audit details contain no full account number | SEC-001.3 |
| V5/bank-change-actors-recorded | Requester and approver are stored and distinct | FIN-001.3 |
| V5/bank-change-audited | Request, approve and reject are audited with the actor | CMP-001.1 |
| V5/payment-steps-audited | Schedule, release and any hold are audited with the actor | CMP-001.2 |

Each check creates its own suppliers and payments through the public API, as real users would. It never uses the team's fixtures or reads the database.

## From test result to obligation state

Checks report results, not obligations. The policy snapshot says which check is the evidence for which obligation, so a policy owner can re-point an obligation without touching code here.

| Check result | State |
|---|---|
| Passed | SUPPORTED |
| Failed in an assertion | VIOLATED (positive evidence of a breach) |
| Failed while arranging its data (`arrange:` steps) | NOT ASSESSED |
| Skipped (e.g. no `LOG_PATH`) | NOT ASSESSED |
| Any check, when V1 did not pass | NOT ASSESSED (evidence discarded, PLT-001) |
| Obligation with no check result at all | INSUFFICIENT |

`reporters/evidence-reporter.ts` writes `evidence.json` and its SHA-256. It masks any 9–18 digit run in observations and error messages, because evidence is kept for years and must not hold the data it protects.

## Run it

```bash
npm ci
BASE_URL=https://qe.vendorpay.example EXPECTED_SHA=3f6e20d LOG_PATH=/mnt/qe-logs/app.log npm run verify
```

Then map the evidence onto a frozen policy snapshot and preview the disposition:

```bash
(cd ../vendorpay-policies && npm run -s select -- --repo vendorpay --repo-dir ../vendorpay-app \
   --range main...3f6e20d --jira VP-184 --json) > snapshot.json
npm run summarize -- --evidence evidence/3f6e20d/evidence.json --snapshot snapshot.json --out report.md
```

The QIVVRA engine does the same steps in production and posts the result to the PR.

## PR #482, measured

`scripts/demo-matrix.sh` deploys each commit locally (git worktree, build, fresh database, `GIT_SHA` set), runs the verifiers, snapshots the policies and summarises. It needs PostgreSQL and port 3000.

```bash
scripts/demo-matrix.sh ../vendorpay-app ../vendorpay-policies main af51c26 ae50deb 3f6e20d
```

| | Commit 1 `af51c26` | Commit 2 `ae50deb` | Commit 3 `3f6e20d` |
|---|---|---|---|
| Team tests (theirs) | 25/25 pass | 26/26 pass | 29/29 pass |
| FIN-001.1 requester cannot approve | **VIOLATED** | SUPPORTED | SUPPORTED |
| FIN-002.1 scheduled payments held | **VIOLATED** | **VIOLATED** | SUPPORTED |
| FIN-002.3 held payment visible | **VIOLATED** | **VIOLATED** | SUPPORTED |
| Other 11 obligations | SUPPORTED | SUPPORTED | SUPPORTED |
| Disposition | **NOT READY** | **NOT READY** | **READY** |

The reports from that run are in `docs/results/`.

V1 also proved itself during development. A leftover server was still running commit 1 while commits 2 and 3 were being "verified". V1 caught it, all other evidence was discarded, and both runs came out INDETERMINATE instead of a false READY.

## In CI

`.github/workflows/verify.yml` runs on a `repository_dispatch` from the QIVVRA engine with the QE URL, the expected commit and the assessment id. It uploads the evidence as an artifact. A failing check does not fail the job: outcomes are evidence, not build status.

## Identities

Verifiers sign in as QIVVRA-provisioned users per environment (`VP_PROCUREMENT`, `VP_OPS`, `VP_APPROVER_A`, `VP_APPROVER_B`, `VP_AUDITOR`, `VP_PASSWORD`). The defaults are VendorPay's demo users.

## Test identities

`identities.yaml` lists the logins the verifiers use: environment variable, role and purpose. When an Admin onboards the application in QIVVRA, the wizard reads this file from the repository and asks only for the values, which QIVVRA stores encrypted and passes to the verifiers at run time. Adding a login means adding it here and in `support/`, by pull request; the Admin then supplies its value. The defaults in `support/vendorpay.ts` exist only for local runs.
