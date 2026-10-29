import { expect, test } from '@playwright/test';
import { arrange, ID, VendorPay } from '../support/vendorpay';

// V3 Scheduled payment safety: after a supplier's bank account is replaced, money
// already scheduled must not flow to the old account or silently to the new one.

async function approvedChangeWithScheduledPayment(vp: VendorPay, label: string) {
  return arrange('scheduled payment, then an approved bank change for the same supplier', async () => {
    const supplier = await vp.activeSupplier(label);
    const payment = await vp.schedulePayment(supplier.id);
    const change = await vp.requestBankChange(ID.procurement, supplier.id);
    await vp.json(ID.approverA, 'POST', `/api/bank-change-requests/${change.id}/approve`, undefined, 200);
    return { supplier, payment, change };
  });
}

test('V3/scheduled-payments-held', async ({ request }, info) => {
  const vp = new VendorPay(request);
  const { payment, change } = await approvedChangeWithScheduledPayment(vp, 'held');
  const after = await vp.payment(payment.id);
  // A Finance Approver who had no part in scheduling or the change tries to release it.
  const release = await vp.call(ID.approverB, 'POST', `/api/payments/${payment.id}/release`);
  const releaseBody = await release.json();
  await info.attach('observation', { contentType: 'application/json', body: JSON.stringify({
    paymentId: payment.id, bankChange: change.id, statusAfterChange: after.status,
    destinationAccountId: after.destination.accountId, replacedAccountId: change.previousAccount.id,
    releaseStatus: release.status(), releaseError: releaseBody.error ?? null,
  }) });
  expect(after.status, 'payment scheduled to the replaced account must be on hold').not.toBe('scheduled');
  expect(release.ok(), 'a payment to a replaced account must not be releasable').toBe(false);
});

test('V3/no-silent-redirect', async ({ request }, info) => {
  const vp = new VendorPay(request);
  const { payment, change } = await approvedChangeWithScheduledPayment(vp, 'redirect');
  const after = await vp.payment(payment.id);
  const events = await vp.auditFor(payment.id);
  const decided = events.some((e) => e.type === 'PAYMENT_HOLD_RESOLVED');
  await info.attach('observation', { contentType: 'application/json', body: JSON.stringify({
    paymentId: payment.id, destinationBefore: payment.destination.accountId, destinationAfter: after.destination.accountId,
    newAccountId: change.newAccount.id, financeDecisionRecorded: decided,
  }) });
  if (after.destination.accountId !== payment.destination.accountId) {
    expect(decided, 'a destination change needs a recorded Finance decision').toBe(true);
  }
});

test('V3/held-payment-visible', async ({ request }, info) => {
  const vp = new VendorPay(request);
  const { supplier, payment } = await approvedChangeWithScheduledPayment(vp, 'visible');
  const list = await vp.json(ID.approverB, 'GET', `/api/payments?supplierId=${supplier.id}`, undefined, 200);
  const row = list.payments.find((p: { id: string }) => p.id === payment.id);
  await info.attach('observation', { contentType: 'application/json', body: JSON.stringify({
    paymentId: payment.id, status: row?.status, hold: row?.hold ?? null,
  }) });
  expect(row?.status, 'Finance must see the payment as held').toBe('on_hold');
  expect(row?.hold?.reason, 'a held payment must say why it is held').toBeTruthy();
});
