import { defineConfig, devices } from '@playwright/test';

/**
 * QIVVRA verifiers run against a deployed environment, never a local build of
 * the app: QIVVRA assures what is actually running in QE.
 *
 *   BASE_URL       the environment under test (required)
 *   EXPECTED_SHA   the PR head commit QIVVRA is assuring (V1 checks /version against it)
 *   LOG_PATH       the application log file, as mounted for QIVVRA (V4 logs check)
 *   EVIDENCE_DIR   where evidence.json is written (default evidence/<sha>)
 */
if (!process.env.BASE_URL) throw new Error('Set BASE_URL to the environment under test');

export default defineConfig({
  testDir: './verifiers',
  // Checks create their own data, but run serially so the environment sees one actor at a time.
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 60_000,
  use: { baseURL: process.env.BASE_URL, trace: 'retain-on-failure' },
  projects: [{ name: 'verifiers', use: { ...devices['Desktop Chrome'] } }],
  reporter: [['list'], ['./reporters/evidence-reporter.ts']],
});
