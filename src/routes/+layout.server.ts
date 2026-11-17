import { mailReady } from '#lib/server/mail.ts';
import { turnstileKey } from '#lib/server/turnstile.ts';

export const load = async ({ locals }) => ({
	user: locals.user,
	// Site admins are reminded on every page until email is set up.
	mailMissing: !!locals.user?.is_admin && !mailReady(),
	turnstileKey: turnstileKey()
});
