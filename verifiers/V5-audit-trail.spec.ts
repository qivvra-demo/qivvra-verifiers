import { expect, test } from '@playwright/test';
import { arrange, ID, VendorPay } from '../support/vendorpay';

// V5 Audit trail: every money-relevant step is attributable to a person.

test('V5/bank-change-actors-recorded', async ({ request }, info) => {
  const vp = new VendorPay(request);
  const change = await arrange('approved bank change', async () => {
    const c = await vp.requestBankChange(ID.procurement, (await vp.activeSupplier('actors')).id);
    await vp.json(ID.approverA, 'POST', `/api/bank-change-requests/${c.id}/approve`, undefined, 200);
    return c;
  });
  const record = (await vp.json(ID.auditor, 'GET', `/api/bank-change-requests/${change.id}`, undefined, 200)).request;
  await info.attach('observation', { contentType: 'application/json', body: JSON.stringify({ id: record.id, requestedBy: record.requestedBy, decidedBy: record.decidedBy }) });
  expect(record.requestedBy).toBe(ID.procurement);
  expect(record.decidedBy).toBe(ID.approverA);
  expect(record.decidedBy).not.toBe(record.requestedBy);
});

test('V5/bank-change-audited', async ({ request }, info) => {
  const vp = new VendorPay(request);
  const { supplier } = await arrange('one approved and one rejected bank change', async () => {
    const supplier = await vp.activeSupplier('audit-change');
    const a = await vp.requestBankChange(ID.procurement, supplier.id);
    await vp.json(ID.approverA, 'POST', `/api/bank-change-requests/${a.id}/approve`, undefined, 200);
    const b = await vp.requestBankChange(ID.procurement, supplier.id);
    await vp.json(ID.approverB, 'POST', `/api/bank-change-requests/${b.id}/reject`, { note: 'QIVVRA verification: rejected' }, 200);
    return { supplier };
  });
  const events = (await vp.auditFor(supplier.id)).map((e) => `${e.type}:${e.actor}`);
  await info.attach('observation', { contentType: 'application/json', body: JSON.stringify(events) });
  expect(events).toEqual(expect.arrayContaining([
    `BANK_CHANGE_REQUESTED:${ID.procurement}`, `BANK_CHANGE_APPROVED:${ID.approverA}`, `BANK_CHANGE_REJECTED:${ID.approverB}`,
  ]));
});

test('V5/payment-steps-audited', async ({ request }, info) => {
  const vp = new VendorPay(request);
  const { released, heldCandidate } = await arrange('a released payment, and a payment caught by a bank change', async () => {
    const s1 = await vp.activeSupplier('audit-pay');
    const released = await vp.schedulePayment(s1.id);
    await vp.json(ID.approverB, 'POST', `/api/payments/${released.id}/release`, undefined, 200);
    const s2 = await vp.activeSupplier('audit-hold');
    const heldCandidate = await vp.schedulePayment(s2.id);
    const c = await vp.requestBankChange(ID.procurement, s2.id);
    await vp.json(ID.approverA, 'POST', `/api/bank-change-requests/${c.id}/approve`, undefined, 200);
    return { released, heldCandidate };
  });
  const relEvents = (await vp.auditFor(released.id)).map((e) => `${e.type}:${e.actor}`);
  const held = await vp.payment(heldCandidate.id);
  const heldEvents = (await vp.auditFor(heldCandidate.id)).map((e) => e.type);
  await info.attach('observation', { contentType: 'application/json', body: JSON.stringify({ relEvents, heldStatus: held.status, heldEvents }) });
  expect(relEvents).toEqual(expect.arrayContaining([`PAYMENT_SCHEDULED:${ID.ops}`, `PAYMENT_RELEASED:${ID.approverB}`]));
  // A hold, where the application performs one, must be audited too.
  if (held.status === 'on_hold') expect(heldEvents).toContain('PAYMENT_HELD');
});
