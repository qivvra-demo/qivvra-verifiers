import { expect, test } from '@playwright/test';
import { existsSync, readFileSync } from 'fs';
import { arrange, FULL_ACCOUNT, ID, PASSWORD, VendorPay } from '../support/vendorpay';

// V4 Data exposure: a full bank account number must never leave the service.

const findings = (text: string) => (text.match(new RegExp(FULL_ACCOUNT, 'g')) ?? []).length;

test('V4/api-masked', async ({ request }, info) => {
  const vp = new VendorPay(request);
  const { supplier } = await arrange('supplier with a bank change and a payment', async () => {
    const supplier = await vp.activeSupplier('api-masking');
    await vp.schedulePayment(supplier.id);
    await vp.requestBankChange(ID.procurement, supplier.id);
    return { supplier };
  });
  const reads: Array<[string, string]> = [
    [ID.ops, '/api/suppliers'], [ID.ops, `/api/suppliers/${supplier.id}`], [ID.ops, '/api/payments'],
    [ID.approverB, '/api/bank-change-requests'], [ID.procurement, `/api/bank-change-requests?supplierId=${supplier.id}`],
    [ID.auditor, '/api/audit-events?limit=500'], [ID.approverB, '/api/suppliers/SUP-0192'],
  ];
  const results: Array<{ as: string; path: string; status: number; fullNumbers: number }> = [];
  for (const [as, path] of reads) {
    const res = await vp.call(as, 'GET', path);
    results.push({ as, path, status: res.status(), fullNumbers: findings(await res.text()) });
  }
  await info.attach('observation', { contentType: 'application/json', body: JSON.stringify(results) });
  for (const r of results) expect(r.fullNumbers, `${r.path} as ${r.as}`).toBe(0);
});

test('V4/ui-masked', async ({ page }, info) => {
  const screens: Array<{ as: string; hash: string }> = [
    { as: ID.ops, hash: '#suppliers' }, { as: ID.ops, hash: '#payments' }, { as: ID.ops, hash: '#supplier/SUP-0192' },
    { as: ID.approverB, hash: '#changes' }, { as: ID.auditor, hash: '#audit' },
  ];
  const results: Array<{ as: string; screen: string; fullNumbers: number; maskedShown: boolean }> = [];
  let current = '';
  for (const s of screens) {
    if (current !== s.as) {
      await page.goto('/');
      await page.evaluate(() => sessionStorage.clear());
      await page.goto('/');
      await page.fill('#username', s.as);
      await page.fill('#password', PASSWORD);
      await page.click('#signin-form button[type=submit]');
      await expect(page.locator('#app')).toBeVisible();
      current = s.as;
    }
    await page.goto('/' + s.hash);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(300);
    const text = await page.locator('body').innerText();
    results.push({ as: s.as, screen: s.hash, fullNumbers: findings(text), maskedShown: text.includes('**** ') });
  }
  await info.attach('observation', { contentType: 'application/json', body: JSON.stringify(results) });
  for (const r of results) expect(r.fullNumbers, `${r.screen} as ${r.as}`).toBe(0);
});

test('V4/logs-masked', async ({ request }, info) => {
  const logPath = process.env.LOG_PATH;
  test.skip(!logPath || !existsSync(logPath), 'LOG_PATH not mounted: application logs not available to QIVVRA');
  const vp = new VendorPay(request);
  await arrange('a bank change so the log has fresh account activity', async () => {
    const supplier = await vp.activeSupplier('log-masking');
    const change = await vp.requestBankChange(ID.procurement, supplier.id);
    await vp.call(ID.approverA, 'POST', `/api/bank-change-requests/${change.id}/approve`);
  });
  const log = readFileSync(logPath!, 'utf8');
  const audit = JSON.stringify(await vp.json(ID.auditor, 'GET', '/api/audit-events?limit=500', undefined, 200));
  const result = { logLines: log.split('\n').length, logFullNumbers: findings(log), auditFullNumbers: findings(audit) };
  await info.attach('observation', { contentType: 'application/json', body: JSON.stringify(result) });
  expect(result.logFullNumbers, 'application log').toBe(0);
  expect(result.auditFullNumbers, 'audit details').toBe(0);
});
