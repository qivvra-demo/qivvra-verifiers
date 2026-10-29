import { expect, test } from '@playwright/test';

// V1 Environment identity: evidence only counts if it came from the commit under review.
test('V1/qe-runs-head-commit', async ({ request }, info) => {
  const expected = process.env.EXPECTED_SHA;
  test.skip(!expected, 'EXPECTED_SHA not given: cannot tell which commit is under review');
  const res = await request.get('/version');
  expect(res.status()).toBe(200);
  const version = await res.json();
  await info.attach('observation', { contentType: 'application/json', body: JSON.stringify({ expected, version }) });
  expect(version.gitSha, 'QE must run the PR head commit').toBe(expected);
});
