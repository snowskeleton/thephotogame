import { fail, redirect } from '@sveltejs/kit';
import QRCode from 'qrcode';
import { makeHandoff } from '#lib/server/auth.ts';
import { all, run } from '#lib/server/db.ts';
import { str } from '#lib/server/game.ts';

export const load = ({ locals }) => {
	if (!locals.user) redirect(303, '/login?next=/account');
	return {
		passkeys: all<{ id: string; created_at: number }>(
			'SELECT id, created_at FROM passkey WHERE user_id = ? ORDER BY created_at',
			locals.user.id
		)
	};
};

export const actions = {
	name: async ({ request, locals }) => {
		if (!locals.user) redirect(303, '/login');
		const name = str((await request.formData()).get('name'), 40);
		if (!name) return fail(400, { error: 'Name can’t be empty.' });
		run('UPDATE user SET name = ? WHERE id = ?', name, locals.user.id);
		return { saved: true };
	},
	qr: async ({ locals, url }) => {
		if (!locals.user) redirect(303, '/login');
		const link = `${url.origin}/link/${makeHandoff(locals.user.id, 10)}`;
		return { qr: await QRCode.toDataURL(link, { margin: 2, width: 320 }), link };
	},
	forget: async ({ request, locals }) => {
		if (!locals.user) redirect(303, '/login');
		run('DELETE FROM passkey WHERE id = ? AND user_id = ?', String((await request.formData()).get('id')), locals.user.id);
	}
};
