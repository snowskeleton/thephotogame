import { ownerEmail } from '#lib/server/auth.ts';
import { mailFrom, mailReady, TEST_SENDER } from '#lib/server/mail.ts';
import { turnstileKey } from '#lib/server/turnstile.ts';

export const load = async ({ locals }) => ({
	user: locals.user,
	// Site admins are reminded on every page until email reaches everyone.
	mail: locals.user?.is_admin ? (!mailReady() ? 'missing' : (await mailFrom()) === TEST_SENDER ? 'test' : 'ok') : 'ok',
	// A fresh deploy without OWNER_EMAIL has no way to get a site admin; say so to whoever looks.
	noOwner: !ownerEmail(),
	turnstileKey: turnstileKey()
});
