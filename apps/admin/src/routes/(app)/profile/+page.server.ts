import { fail, redirect } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { renderSVG } from 'uqr';
import { APIError } from 'better-auth/api';
import { adminUser, adminProfile } from '@veent/db';
import { db } from '$lib/server/db';
import { auth } from '$lib/server/auth';
import { verifyStepUp } from '$lib/server/step-up';
import { isTotpCode, secretFromTotpUri } from '$lib/server/twoFactor';
import { logger } from '$lib/server/logger';
import type { Actions, PageServerLoad } from './$types';

const log = logger('profile');

/** Permissive email check — rejects obviously-invalid input before it's stored. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** Loose phone check: digits plus the usual separators, 5–20 chars. */
const PHONE_RE = /^[+()\-\s\d]{5,20}$/;

/** Cap on the stored avatar data-URI (the client already downscales to ~256px WebP). */
const AVATAR_MAX_BYTES = 60 * 1024;

/**
 * Validate a client-produced avatar data-URI: must be a base64 image of an allowed type
 * and small enough (the browser resizes/compresses before submit; this is the server-side
 * backstop so a crafted POST can't stuff a huge blob into the user row).
 */
function validateAvatar(dataUrl: string): string | null {
	if (!dataUrl) return 'Choose an image first.';
	const m = /^data:image\/(webp|png|jpeg);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
	if (!m) return 'Unsupported image — use PNG, JPG or WebP.';
	const bytes = Math.floor((m[2].length * 3) / 4);
	if (bytes > AVATAR_MAX_BYTES) return 'Image is too large (max ~60KB after resizing).';
	return null;
}

export const load: PageServerLoad = async (event) => {
	const user = event.locals.user;
	if (!user) return redirect(302, '/login');

	const [row] = await db
		.select({
			name: adminUser.name,
			email: adminUser.email,
			image: adminUser.image,
			phone: adminProfile.phone,
			jobTitle: adminProfile.jobTitle,
			contactEmail: adminProfile.contactEmail
		})
		.from(adminUser)
		.leftJoin(adminProfile, eq(adminProfile.userId, adminUser.id))
		.where(eq(adminUser.id, user.id))
		.limit(1);

	return {
		profile: row ?? {
			name: user.name,
			email: user.email,
			image: user.image ?? null,
			phone: null,
			jobTitle: null,
			contactEmail: null
		}
	};
};

export const actions: Actions = {
	// --- Display name + contact info ------------------------------------------
	saveProfile: async (event) => {
		const user = event.locals.user;
		if (!user) return fail(401, { action: 'profile', error: 'Not signed in.' });

		const form = await event.request.formData();
		const name = String(form.get('name') ?? '').trim();
		const phone = String(form.get('phone') ?? '').trim();
		const jobTitle = String(form.get('jobTitle') ?? '').trim();
		const contactEmail = String(form.get('contactEmail') ?? '').trim();
		const values = { name, phone, jobTitle, contactEmail };

		if (!name) return fail(400, { action: 'profile', error: 'Name is required.', values });
		if (contactEmail && !EMAIL_RE.test(contactEmail))
			return fail(400, { action: 'profile', error: 'Enter a valid contact email.', values });
		if (phone && !PHONE_RE.test(phone))
			return fail(400, { action: 'profile', error: 'Enter a valid phone number.', values });

		await db
			.update(adminUser)
			.set({ name, updatedAt: new Date() })
			.where(eq(adminUser.id, user.id));
		// admin_profile is a 1:1 row created at invite; update its contact columns in place.
		await db
			.update(adminProfile)
			.set({
				phone: phone || null,
				jobTitle: jobTitle || null,
				contactEmail: contactEmail || null
			})
			.where(eq(adminProfile.userId, user.id));

		return { action: 'profile', ok: true };
	},

	// --- Avatar (client-resized data-URI) -------------------------------------
	saveAvatar: async (event) => {
		const user = event.locals.user;
		if (!user) return fail(401, { action: 'avatar', error: 'Not signed in.' });

		const image = String((await event.request.formData()).get('image') ?? '');
		const err = validateAvatar(image);
		if (err) return fail(400, { action: 'avatar', error: err });

		await db
			.update(adminUser)
			.set({ image, updatedAt: new Date() })
			.where(eq(adminUser.id, user.id));
		return { action: 'avatar', ok: true };
	},

	removeAvatar: async (event) => {
		const user = event.locals.user;
		if (!user) return fail(401, { action: 'avatar', error: 'Not signed in.' });

		await db
			.update(adminUser)
			.set({ image: null, updatedAt: new Date() })
			.where(eq(adminUser.id, user.id));
		return { action: 'avatar', ok: true, removed: true };
	},

	// --- Login email (immediate, gated by a TOTP step-up) ---------------------
	changeEmail: async (event) => {
		const user = event.locals.user;
		if (!user) return fail(401, { action: 'email', error: 'Not signed in.' });

		const form = await event.request.formData();
		const newEmail = String(form.get('email') ?? '')
			.trim()
			.toLowerCase();
		const code = String(form.get('code') ?? '').trim();

		if (!EMAIL_RE.test(newEmail))
			return fail(400, { action: 'email', error: 'Enter a valid email address.', values: { email: newEmail } });
		if (newEmail === user.email.toLowerCase())
			return fail(400, { action: 'email', error: 'That is already your email.', values: { email: newEmail } });

		// High-stakes: re-prompt for the authenticator code (same pattern as content saves).
		const stepUp = await verifyStepUp(event, code, { scope: 'admin_profile_email', action: 'email' });
		if (stepUp) return stepUp;

		// Email is the unique login identity — reject a collision with a friendly message rather
		// than letting the DB unique constraint throw a 500.
		const [existing] = await db
			.select({ id: adminUser.id })
			.from(adminUser)
			.where(eq(adminUser.email, newEmail))
			.limit(1);
		if (existing && existing.id !== user.id)
			return fail(409, { action: 'email', error: 'That email is already in use.', values: { email: newEmail } });

		// The new address hasn't been verified; admin login is password + TOTP (not email-link),
		// so this doesn't lock anyone out — it just keeps emailVerified honest.
		await db
			.update(adminUser)
			.set({ email: newEmail, emailVerified: false, updatedAt: new Date() })
			.where(eq(adminUser.id, user.id));

		return { action: 'email', ok: true };
	},

	// --- Password (better-auth verifies the current one) ----------------------
	changePassword: async (event) => {
		const user = event.locals.user;
		if (!user) return fail(401, { action: 'password', error: 'Not signed in.' });

		const form = await event.request.formData();
		const currentPassword = String(form.get('currentPassword') ?? '');
		const newPassword = String(form.get('newPassword') ?? '');
		const confirm = String(form.get('confirmPassword') ?? '');
		const code = String(form.get('code') ?? '').trim();

		if (newPassword.length < 8)
			return fail(400, { action: 'password', error: 'New password must be at least 8 characters.' });
		if (newPassword !== confirm)
			return fail(400, { action: 'password', error: 'New passwords do not match.' });

		// High-stakes: re-prompt for the authenticator code (checked before the password change so a
		// leaked/shoulder-surfed password alone can't rotate credentials).
		const stepUp = await verifyStepUp(event, code, { scope: 'admin_profile_password', action: 'password' });
		if (stepUp) return stepUp;

		try {
			// revokeOtherSessions: a password change signs out this account everywhere else.
			await auth.api.changePassword({
				body: { currentPassword, newPassword, revokeOtherSessions: true },
				headers: event.request.headers
			});
		} catch (e) {
			if (e instanceof APIError)
				return fail(400, { action: 'password', error: 'Current password is incorrect.' });
			log.error('changePassword unexpected error:', e);
			return fail(500, { action: 'password', error: 'Unexpected error.' });
		}

		return { action: 'password', ok: true };
	},

	// --- Re-enroll authenticator: rotate to a fresh secret (stays enrolled) ---
	reenroll2faStart: async (event) => {
		const user = event.locals.user;
		if (!user) return fail(401, { action: 'twofa', error: 'Not signed in.' });

		const password = String((await event.request.formData()).get('password') ?? '');
		if (!password) return fail(400, { action: 'twofa', error: 'Enter your password.' });

		try {
			// Issue a fresh secret + backup codes for the NEW authenticator. enableTwoFactor works
			// while still enrolled — it stages the new secret; the old one keeps working until the
			// confirm step verifies a code from the new device (verifyTOTP), which activates it.
			// (We deliberately DON'T disableTwoFactor first — that rotates the session and leaves the
			// follow-up call unauthorized, and would also drop the mandatory-2FA guarantee mid-flow.)
			const res = await auth.api.enableTwoFactor({ body: { password }, headers: event.request.headers });
			return {
				action: 'twofa',
				step: 'confirm' as const,
				qrSvg: renderSVG(res.totpURI),
				secret: secretFromTotpUri(res.totpURI),
				backupCodes: res.backupCodes
			};
		} catch (e) {
			// The only expected APIError here is a bad password (we don't disable first, so no
			// session-rotation UNAUTHORIZED). Anything else is unexpected — log it.
			if (e instanceof APIError) return fail(400, { action: 'twofa', error: 'Incorrect password.' });
			log.error('2FA re-enroll start unexpected error:', e);
			return fail(500, { action: 'twofa', error: 'Unexpected error.' });
		}
	},

	reenroll2faConfirm: async (event) => {
		const user = event.locals.user;
		if (!user) return fail(401, { action: 'twofa', error: 'Not signed in.' });

		const form = await event.request.formData();
		const code = String(form.get('code') ?? '').trim();
		// Carry the once-shown secret + backup codes so a mistyped code doesn't lose them. The QR
		// is NOT round-tripped (it's {@html}'d — re-emitting client markup would be an injection
		// vector); the manual secret stays available for re-entry instead.
		const echo = {
			action: 'twofa' as const,
			step: 'confirm' as const,
			secret: String(form.get('secret') ?? ''),
			backupCodes: String(form.get('backupCodes') ?? '')
				.split('\n')
				.filter(Boolean)
		};

		if (!isTotpCode(code))
			return fail(400, { ...echo, error: 'Enter the 6-digit code from your app.' });

		try {
			await auth.api.verifyTOTP({ body: { code }, headers: event.request.headers });
		} catch (e) {
			if (e instanceof APIError) return fail(400, { ...echo, error: 'Invalid code. Please try again.' });
			log.error('2FA re-enroll confirm unexpected error:', e);
			return fail(500, { ...echo, error: 'Unexpected error.' });
		}

		return { action: 'twofa', ok: true, reenrolled: true };
	},

	// --- Fresh backup codes (invalidates the old set) -------------------------
	regenBackupCodes: async (event) => {
		const user = event.locals.user;
		if (!user) return fail(401, { action: 'backup', error: 'Not signed in.' });

		const password = String((await event.request.formData()).get('password') ?? '');
		if (!password) return fail(400, { action: 'backup', error: 'Enter your password.' });

		try {
			const res = await auth.api.generateBackupCodes({
				body: { password },
				headers: event.request.headers
			});
			return { action: 'backup', ok: true, backupCodes: res.backupCodes };
		} catch (e) {
			if (e instanceof APIError) return fail(400, { action: 'backup', error: 'Incorrect password.' });
			log.error('regenerate backup codes unexpected error:', e);
			return fail(500, { action: 'backup', error: 'Unexpected error.' });
		}
	}
};
