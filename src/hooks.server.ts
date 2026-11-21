import type { Handle, HandleServerError } from '@sveltejs/kit/hooks';
import { COOKIE, userFromToken } from '#lib/server/auth.ts';
import { now, run } from '#lib/server/db.ts';
import { databaseReady } from '#lib/server/migrate.ts';
import { logEvent } from '#lib/server/log.ts';

export const handle: Handle = async ({ event, resolve }) => {
	await databaseReady();
	const user = (event.locals.user = await userFromToken(event.cookies.get(COOKIE)));
	// "Last seen" for the admin's user list; written at most every five minutes per person.
	if (user)
		await run(
			'UPDATE user SET last_seen_at = ? WHERE id = ? AND COALESCE(last_seen_at, 0) < ?',
			now(),
			user.id,
			now() - 5 * 60_000
		);
	return resolve(event);
};

// Unexpected errors only (kind 'unknown': a bug or a failed dependency). 404s and deliberate error(...) responses
// aren't problems. Keep a record, with the stack, for the admin log.
export const handleError: HandleServerError = async ({ kind, error, event }) => {
	if (kind !== 'unknown') return;
	const e = error instanceof Error ? error : new Error(String(error));
	await logEvent('error', 'server_error', `${e.name}: ${e.message}`, {
		request: event.request,
		path: event.url.pathname,
		status: 500,
		userId: event.locals?.user?.id,
		detail: e.stack
	});
};
