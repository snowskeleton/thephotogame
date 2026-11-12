import { redirect } from '@sveltejs/kit';
import { endSession } from '#lib/server/auth.ts';

export const POST = ({ cookies }) => {
	endSession(cookies);
	redirect(303, '/');
};
