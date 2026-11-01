# QIVVRA assessment: vendorpay @ af51c26

**Disposition: NOT READY**

Jira VP-184 · profile payments-critical · policy repo 2871923 · snapshot `sha256:6a1416648674c270f34019c0ee92f0bc9890f877c2615519e51d9732da638488` · verifiers dfaa599

| State | Obligation | Statement | Evidence |
|---|---|---|---|
| SUPPORTED | CMP-001.1 | Each bank account change step (request, approve, reject) writes an audit event with its actor. | V5/bank-change-audited |
| SUPPORTED | CMP-001.2 | Each payment step (schedule, release, hold) writes an audit event with its actor. | V5/payment-steps-audited |
| VIOLATED | FIN-001.1 | The person who requested a bank account change cannot approve it. | V2/bank-change-self-approval-blocked: Error: the requester must not be able to approve their own bank change |
| SUPPORTED | FIN-001.2 | A proposed bank account cannot receive payments before it is approved. | V2/proposed-account-not-payable |
| SUPPORTED | FIN-001.3 | The requester and the approver of every change are recorded. | V5/bank-change-actors-recorded |
| VIOLATED | FIN-002.1 | After a bank change is approved, the supplier's scheduled payments are on hold and cannot be released. | V3/scheduled-payments-held: Error: payment scheduled to the replaced account must be on hold |
| SUPPORTED | FIN-002.2 | Scheduled payments are never redirected to the new account without a Finance decision. | V3/no-silent-redirect |
| VIOLATED | FIN-002.3 | Each held payment is visible to Finance with the reason it was held. | V3/held-payment-visible: Error: Finance must see the payment as held |
| SUPPORTED | FIN-003.1 | The scheduler of a payment cannot release it. | V2/payment-self-release-blocked |
| SUPPORTED | FIN-003.2 | A payment cannot be released twice. | V2/payment-single-release |
| SUPPORTED | PLT-001.1 | The QE environment reports the pull request's head commit at /version before and after verification. | V1/qe-runs-head-commit |
| SUPPORTED | SEC-001.1 | Screens show only the last four digits of any bank account. | V4/ui-masked |
| SUPPORTED | SEC-001.2 | API responses never contain a full bank account number. | V4/api-masked |
| SUPPORTED | SEC-001.3 | Application logs and audit details never contain a full bank account number. | V4/logs-masked |
