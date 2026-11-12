import { fail, redirect } from '@sveltejs/kit';
import QRCode from 'qrcode';
import { cleanEmail, makeHandoff } from '#lib/server/auth.ts';
import { all, get, insert, now, run } from '#lib/server/db.ts';
import { requireAdmin, str } from '#lib/server/game.ts';
import { remove } from '#lib/server/images.ts';

export const load = ({ locals }) => {
	const me = requireAdmin(locals);
	return {
		me: me.id,
		games: all<{ code: string; name: string; players: number; photos: number }>(
			`SELECT g.code, g.name, (SELECT COUNT(*) FROM member m WHERE m.game_id = g.id) AS players,
				(SELECT COUNT(*) FROM photo p WHERE p.game_id = g.id) AS photos
			 FROM game g ORDER BY g.created_at DESC`
		),
		users: all<{ id: number; name: string; email: string; is_admin: number; passkeys: number; games: number }>(
			`SELECT u.id, u.name, u.email, u.is_admin,
				(SELECT COUNT(*) FROM passkey k WHERE k.user_id = u.id) AS passkeys,
				(SELECT COUNT(*) FROM member m WHERE m.user_id = u.id) AS games
			 FROM user u ORDER BY u.name`
		)
	};
};

const randomCode = () => {
	const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
	for (;;) {
		const code = Array.from({ length: 4 }, () => letters[Math.floor(Math.random() * letters.length)]).join('');
		if (!get('SELECT 1 FROM game WHERE code = ?', code)) return code;
	}
};

export const actions = {
	newGame: async ({ request, locals }) => {
		const me = requireAdmin(locals);
		const f = await request.formData();
		const name = str(f.get('name'), 80);
		if (!name) return fail(400, { error: 'Give the game a name.' });
		const code = randomCode();
		const id = insert('INSERT INTO game (code, name, created_at) VALUES (?, ?, ?)', code, name, now());
		run('INSERT INTO member (game_id, user_id) VALUES (?, ?)', id, me.id);
		redirect(303, `/g/${code}/admin`);
	},
	saveUser: async ({ request, locals }) => {
		const me = requireAdmin(locals);
		const f = await request.formData();
		const id = Number(f.get('id'));
		const name = str(f.get('name'), 40);
		const email = cleanEmail(f.get('email'));
		if (!name || !email) return fail(400, { error: 'A user needs a name and a valid email.' });
		if (get('SELECT 1 FROM user WHERE email = ? AND id != ?', email, id))
			return fail(400, { error: 'Someone else already has that email.' });
		// You can't remove your own admin rights, so there's always at least one admin.
		const isAdmin = id === me.id ? 1 : f.get('is_admin') ? 1 : 0;
		run('UPDATE user SET name = ?, email = ?, is_admin = ? WHERE id = ?', name, email, isAdmin, id);
		return { saved: id };
	},
	signin: async ({ request, locals, url }) => {
		requireAdmin(locals);
		const id = Number((await request.formData()).get('id'));
		const u = get<{ name: string }>('SELECT name FROM user WHERE id = ?', id);
		if (!u) return fail(400, { error: 'No such user.' });
		const link = `${url.origin}/link/${makeHandoff(id, 60 * 24)}`;
		return { signin: { name: u.name, link, qr: await QRCode.toDataURL(link, { margin: 2, width: 320 }) } };
	},
	signout: async ({ request, locals }) => {
		requireAdmin(locals);
		const id = Number((await request.formData()).get('id'));
		run('DELETE FROM session WHERE user_id = ?', id);
		run('DELETE FROM passkey WHERE user_id = ?', id);
		return { saved: id };
	},
	deleteUser: async ({ request, locals }) => {
		const me = requireAdmin(locals);
		const id = Number((await request.formData()).get('id'));
		if (id === me.id) return fail(400, { error: 'You can’t delete yourself.' });
		const ids = all<{ id: number }>('SELECT id FROM photo WHERE user_id = ?', id);
		run('DELETE FROM user WHERE id = ?', id);
		for (const p of ids) await remove(p.id);
	}
};
