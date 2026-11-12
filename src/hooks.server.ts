import type { Handle } from '@sveltejs/kit/hooks';
import { COOKIE, userFromToken } from '#lib/server/auth.ts';

export const handle: Handle = async ({ event, resolve }) => {
	event.locals.user = userFromToken(event.cookies.get(COOKIE));
	return resolve(event);
};
