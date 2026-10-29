import { expect, test } from '@playwright/test';
import { arrange, ID, VendorPay } from '../support/vendorpay';

// V2 Separation of duties: no single person can move or redirect money alone.

test('V2/bank-change-self-approval-blocked', async ({ request }, info) => {
  const vp = new VendorPay(request);
  const { change } = await arrange('active supplier with a bank change requested by approver A', async () => {
    const supplier = await vp.activeSupplier('self-approval');
    // Approver A raises the change (Finance Approvers may raise changes in VendorPay).
    const res = await vp.call(ID.approverA, 'POST', `/api/suppliers/${supplier.id}/bank-change-requests`,
      { accountNumber: '7' + String(Date.now()).slice(-12), ifsc: 'ICIC0000110', reason: 'QIVVRA verification: supplier called Finance' });
    expect(res.status(), 'approver A can raise a bank change').toBe(201);
    return { change: (await res.json()).request };
  });

  const self = await vp.call(ID.approverA, 'POST', `/api/bank-change-requests/${change.id}/approve`);
  const selfBody = await self.json();
  await info.attach('observation', { contentType: 'application/json', body: JSON.stringify({
    requestId: change.id, requestedBy: ID.approverA, selfApprovalStatus: self.status(), selfApprovalBody: selfBody,
  }) });
  expect(self.status(), 'the requester must not be able to approve their own bank change').toBe(403);

  const other = await vp.call(ID.approverB, 'POST', `/api/bank-change-requests/${change.id}/approve`);
  expect(other.status(), 'a second approver can still approve').toBe(200);
});

test('V2/proposed-account-not-payable', async ({ request }, info) => {
  const vp = new VendorPay(request);
  const { supplier, change } = await arrange('supplier with a pending bank change', async () => {
    const supplier = await vp.activeSupplier('proposed-account');
    const change = await vp.requestBankChange(ID.procurement, supplier.id);
    return { supplier, change };
  });
  const payment = await vp.schedulePayment(supplier.id);
  await info.attach('observation', { contentType: 'application/json', body: JSON.stringify({
    previousAccountId: change.previousAccount.id, proposedAccountId: change.newAccount.id, paymentDestinationId: payment.destination.accountId,
  }) });
  expect(payment.destination.accountId, 'a payment must never target a proposed account').not.toBe(change.newAccount.id);
  expect(payment.destination.accountId).toBe(change.previousAccount.id);
});

test('V2/payment-self-release-blocked', async ({ request }, info) => {
  const vp = new VendorPay(request);
  const payment = await arrange('scheduled payment by Finance Ops', async () => vp.schedulePayment((await vp.activeSupplier('self-release')).id));
  const res = await vp.call(ID.ops, 'POST', `/api/payments/${payment.id}/release`);
  await info.attach('observation', { contentType: 'application/json', body: JSON.stringify({ paymentId: payment.id, scheduler: ID.ops, releaseStatus: res.status() }) });
  expect(res.status(), 'the scheduler must not be able to release their own payment').toBe(403);
});

test('V2/payment-single-release', async ({ request }, info) => {
  const vp = new VendorPay(request);
  const payment = await arrange('scheduled payment', async () => vp.schedulePayment((await vp.activeSupplier('single-release')).id));
  const first = await vp.call(ID.approverB, 'POST', `/api/payments/${payment.id}/release`);
  const second = await vp.call(ID.approverA, 'POST', `/api/payments/${payment.id}/release`);
  await info.attach('observation', { contentType: 'application/json', body: JSON.stringify({ paymentId: payment.id, first: first.status(), second: second.status() }) });
  expect(first.status()).toBe(200);
  expect(second.status(), 'a payment must not be released twice').toBe(409);
});
