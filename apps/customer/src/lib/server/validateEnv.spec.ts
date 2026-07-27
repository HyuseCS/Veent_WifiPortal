import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mutable state the virtual-module mocks read through, so each test can flip `dev`/`building`
// and set env without re-importing. `$app/environment`'s `dev`/`building` are exposed via
// getters so the live named imports reflect changes between tests.
const state = vi.hoisted(() => ({
	dev: false,
	building: false,
	env: {} as Record<string, string | undefined>,
	pub: {} as Record<string, string | undefined>
}));

// validateEnv → otp.ts (for isTestMode) pulls these in transitively; mock them so the import graph
// resolves without a real DB / core module.
vi.mock('$lib/server/db', () => ({ db: { insert: () => ({ values: vi.fn() }) } }));
vi.mock('@veent/db/schema', () => ({ customerOtpDeliveryLog: {} }));
vi.mock('@veent/core', () => ({ captureHandled: vi.fn() }));

vi.mock('$app/environment', () => ({
	get dev() {
		return state.dev;
	},
	get building() {
		return state.building;
	},
	browser: false
}));
vi.mock('$env/dynamic/private', () => ({
	get env() {
		return state.env;
	}
}));
vi.mock('$env/dynamic/public', () => ({
	get env() {
		return state.pub;
	}
}));

import { validateEnv } from './validateEnv';

/** All prod-required vars set + a LAN http ORIGIN, so the ONLY failure axis under test is TEST_MODE. */
function configureValidProdEnv() {
	state.env.DATABASE_URL = 'postgres://localhost/db';
	state.env.BETTER_AUTH_SECRET = 'x'.repeat(40);
	state.env.CRON_SECRET = 'cron';
	state.env.MAYA_PUBLIC_KEY = 'pk';
	state.env.MAYA_SECRET_KEY = 'sk';
	state.env.ORIGIN = 'http://10.0.0.5:5173'; // private LAN → http allowed (warn only)
}

beforeEach(() => {
	state.dev = false;
	state.building = false;
	state.env = {};
	state.pub = {};
	vi.clearAllMocks();
});

describe('validateEnv — TEST_MODE prod gate', () => {
	it('throws in production (dev=false) when TEST_MODE is truthy', () => {
		configureValidProdEnv();
		state.env.TEST_MODE = 'true';

		expect(() => validateEnv()).toThrow(/TEST_MODE is enabled/);
	});

	it('does NOT throw in dev (dev=true) when TEST_MODE is truthy — warns only', () => {
		configureValidProdEnv();
		state.dev = true;
		state.env.TEST_MODE = 'true';
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

		expect(() => validateEnv()).not.toThrow();
		expect(warn).toHaveBeenCalledWith(expect.stringContaining('TEST_MODE is enabled'));
	});

	it('does NOT throw in production when TEST_MODE is off and required vars are present', () => {
		configureValidProdEnv();
		state.env.TEST_MODE = '';
		vi.spyOn(console, 'warn').mockImplementation(() => {});

		expect(() => validateEnv()).not.toThrow();
	});
});
