import type { User, Session } from 'better-auth';

// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		interface Locals {
			// `twoFactorEnabled` is added to the user by the better-auth two-factor plugin
			// (returned field); the base `User` type doesn't include it.
			user?: User & { twoFactorEnabled?: boolean | null };
			session?: Session;
		}

		// interface Error {}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
}

export {};
