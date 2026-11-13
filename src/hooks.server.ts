import type { Handle } from '@sveltejs/kit/hooks';
import { COOKIE, userFromToken } from '#lib/server/auth.ts';
import { now, run } from '#lib/server/db.ts';

export const handle: Handle = async ({ event, resolve }) => {
	const user = (event.locals.user = userFromToken(event.cookies.get(COOKIE)));
	// "Last seen" for the admin's user list; written at most every five minutes per person.
	if (user)
		run(
			'UPDATE user SET last_seen_at = ? WHERE id = ? AND COALESCE(last_seen_at, 0) < ?',
			now(),
			user.id,
			now() - 5 * 60_000
		);
	return resolve(event);
};
