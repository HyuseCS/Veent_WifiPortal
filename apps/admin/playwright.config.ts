import { defineConfig } from '@playwright/test';
import { OWNER_STORAGE_STATE, TEST_ENV, TEST_ORIGIN } from './e2e/config';

export default defineConfig({
	testMatch: '**/*.e2e.{ts,js}',
	globalSetup: './e2e/global-setup.ts',
	// Governance specs mutate shared DB state (roles, staff rows) — run serially so they
	// don't race. Each spec also self-seeds its preconditions, so order is irrelevant.
	workers: 1,
	fullyParallel: false,
	// The preview build + DB seed + 2FA enrollment take a while; give CI headroom.
	timeout: 60_000,
	expect: { timeout: 10_000 },
	use: {
		baseURL: TEST_ORIGIN,
		// Every spec starts authenticated as the enrolled owner (banked in global-setup).
		storageState: OWNER_STORAGE_STATE
	},
	webServer: {
		command: 'npm run build && npm run preview',
		port: 4173,
		// Point the preview server at the throwaway DB + stub router (never the dev DB,
		// never the real MikroTik). Process env overrides the .env file values.
		env: TEST_ENV,
		reuseExistingServer: !process.env.CI,
		timeout: 180_000
	}
});
