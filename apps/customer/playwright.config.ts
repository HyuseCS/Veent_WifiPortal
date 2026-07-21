import { defineConfig } from '@playwright/test';

export default defineConfig({
	webServer: {
		command: 'npm run build && npm run preview',
		port: 4173,
		// Credential tripwire. There are no *.e2e.ts specs in this app yet; without this the
		// preview server loads the real .env and the first spec would hit live Maya and live
		// Cast SMS. Blanking does NOT stub — behaviour differs per integration:
		//   SMS      — genuinely throws. `dev` is false in a preview build, so the missing-key
		//              branch raises before any network call. Nothing leaves the machine.
		//   Maya     — does NOT throw. basicAuth('') is still a valid header, so the checkout
		//              request GOES OUT and comes back 401. Fail-*rejected*, not fail-closed.
		//              MAYA_SANDBOX is pinned 'true' (it hard-throws unless 'true'/'false', so
		//              it cannot be blanked) to guarantee anything escaping hits sandbox, never
		//              prod. Actually preventing the call needs a payments stub, which does not
		//              exist. Do not assume requests are contained.
		//   MikroTik — NETWORK_CONTROLLER='stub' is a real stub.
		// If you add a spec, build real stubs — do not delete this block.
		env: {
			MAYA_PUBLIC_KEY: '',
			MAYA_SECRET_KEY: '',
			MAYA_SANDBOX: 'true',
			CAST_API_KEY: '',
			CAST_SENDER_ID: '',
			ITEXMO_API_CODE: '',
			ITEXMO_EMAIL: '',
			ITEXMO_PASSWORD: '',
			ITEXMO_SENDER_ID: '',
			UNISMS_SECRET_KEY: '',
			UNISMS_SENDER_ID: '',
			SMSGATE_BASE_URL: '',
			SMSGATE_USERNAME: '',
			SMSGATE_PASSWORD: '',
			NETWORK_CONTROLLER: 'stub',
			MIKROTIK_HOST: '',
			MIKROTIK_USER: '',
			MIKROTIK_PASSWORD: '',
			MIKROTIK_HOTSPOT_USER: '',
			MIKROTIK_HOTSPOT_PASSWORD: ''
		}
	},
	testMatch: '**/*.e2e.{ts,js}'
});
