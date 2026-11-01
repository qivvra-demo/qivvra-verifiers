/**
 * A thin client for VendorPay's public API, acting as real users would.
 * Verifiers use QIVVRA's own test identities (configured per environment),
 * never the application team's fixtures or test helpers.
 */
import { APIRequestContext, APIResponse, expect, test } from '@playwright/test';

export const ID = {
  procurement: process.env.VP_PROCUREMENT ?? 'ravi.kumar',
  ops: process.env.VP_OPS ?? 'neha.joshi',
  approverA: process.env.VP_APPROVER_A ?? 'm.fernandes',
  approverB: process.env.VP_APPROVER_B ?? 'j.thomas',
  auditor: process.env.VP_AUDITOR ?? 'audit.viewer',
};
export const PASSWORD = process.env.VP_PASSWORD ?? 'VendorPay@2026';

/** Any 9 to 18 digit run: what an unmasked bank account number looks like. */
export const FULL_ACCOUNT = /\b\d{9,18}\b/;

/** Arrange-phase work. If it fails the check is NOT ASSESSED, not VIOLATED. */
export const arrange = <T>(title: string, body: () => Promise<T>) => test.step(`arrange: ${title}`, body);

const tokens = new Map<string, string>();
export class VendorPay {
  constructor(private readonly request: APIRequestContext) {}

  async token(user: string): Promise<string> {
    if (!tokens.has(user)) {
      const res = await this.request.post('/api/auth/login', { data: { username: user, password: PASSWORD } });
      expect(res.status(), `sign-in as ${user}`).toBe(200);
      tokens.set(user, (await res.json()).token);
    }
    return tokens.get(user)!;
  }

  async call(user: string, method: 'GET' | 'POST', path: string, data?: unknown): Promise<APIResponse> {
    const headers = { authorization: `Bearer ${await this.token(user)}` };
    return method === 'GET' ? this.request.get(path, { headers }) : this.request.post(path, { headers, data });
  }

  async json<T = any>(user: string, method: 'GET' | 'POST', path: string, data?: unknown, expectStatus?: number): Promise<T> {
    const res = await this.call(user, method, path, data);
    if (expectStatus !== undefined) expect(res.status(), `${method} ${path} as ${user}`).toBe(expectStatus);
    return res.json();
  }

  /** A fresh, verified, active supplier so every check starts from a known state. */
  async activeSupplier(label: string) {
    const created = await this.json(ID.procurement, 'POST', '/api/suppliers',
      { name: `QIVVRA ${label} ${Date.now().toString(36)}`, accountNumber: newAccountNumber(), ifsc: 'HDFC0001234' }, 201);
    const s = created.supplier;
    await this.json(ID.approverA, 'POST', `/api/suppliers/${s.id}/bank-accounts/${s.bankAccount.id}/verify`, undefined, 200);
    return s as { id: string; bankAccount: { id: number } };
  }

  async schedulePayment(supplierId: string, amount = 10_000) {
    const d = new Date(); d.setUTCDate(d.getUTCDate() + 10);
    const r = await this.json(ID.ops, 'POST', '/api/payments', { supplierId, amount, scheduledFor: d.toISOString().slice(0, 10) }, 201);
    return r.payment as { id: string; destination: { accountId: number } };
  }

  async requestBankChange(by: string, supplierId: string) {
    const r = await this.json(by, 'POST', `/api/suppliers/${supplierId}/bank-change-requests`,
      { accountNumber: newAccountNumber(), ifsc: 'ICIC0000110', reason: 'QIVVRA verification: supplier moved banks' }, 201);
    return r.request as { id: string; previousAccount: { id: number }; newAccount: { id: number } };
  }

  payment(id: string, as = ID.approverB) {
    return this.json(as, 'GET', `/api/payments/${id}`, undefined, 200).then((r) => r.payment);
  }

  auditFor(entityId: string) {
    return this.json(ID.auditor, 'GET', `/api/audit-events?entityId=${encodeURIComponent(entityId)}&limit=200`, undefined, 200)
      .then((r) => r.events as Array<{ type: string; actor: string; details: Record<string, unknown> }>);
  }
}

let seq = 0;
export function newAccountNumber(): string {
  seq += 1;
  return ('7' + String(Date.now()).slice(-9) + String(seq).padStart(3, '0')).slice(0, 14);
}
