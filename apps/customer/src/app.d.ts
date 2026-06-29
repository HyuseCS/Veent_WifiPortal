import type { User, Session } from 'better-auth';

// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		interface Locals {
			user?: User;
			session?: Session;
			// Set by the OTP-send form actions after they've already charged the per-phone/MAC
			// send limit, so the auth `sendOTP` callback (which enforces the same limit at the
			// universal seam, to also cover the direct /api/auth/phone-number/send-otp route)
			// doesn't double-count a legitimate form send.
			otpLimitEnforced?: boolean;
		}

		// interface Error {}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
}

export {};
