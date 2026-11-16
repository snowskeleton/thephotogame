import { error, fail, redirect } from '@sveltejs/kit';
import { qrDataUrl } from '#lib/server/qr.ts';
import { cleanEmail, makeHandoff, sendInvite } from '#lib/server/auth.ts';
import { all, get, now, run } from '#lib/server/db.ts';
import { requireAdmin, str } from '#lib/server/game.ts';
import { remove } from '#lib/server/images.ts';
import { mailReady } from '#lib/server/mail.ts';

type Person = { id: number; name: string; email: string; is_admin: number; created_at: number; last_seen_at: number | null };
const person = async (id: string) => {
	const u = await get<Person>('SELECT id, name, email, is_admin, created_at, last_seen_at FROM user WHERE id = ?', Number(id) || 0);
	if (!u) error(404, 'No such person');
	return u;
};

export const load = async ({ locals, params, url }) => {
	const me = requireAdmin(locals);
	const u = await person(params.id);
	const memberships = await all<{ game_id: number; code: string; name: string; team_id: number | null }>(
		`SELECT g.id AS game_id, g.code, g.name, m.team_id FROM member m JOIN game g ON g.id = m.game_id
		 WHERE m.user_id = ? ORDER BY g.created_at DESC`,
		u.id
	);
	return {
		u,
		isMe: u.id === me.id,
		mailReady: mailReady(),
		added: url.searchParams.has('added'),
		invited: url.searchParams.get('invited'),
		memberships,
		teams: await all<{ id: number; game_id: number; name: string }>(
			'SELECT t.id, t.game_id, t.name FROM team t JOIN member m ON m.game_id = t.game_id WHERE m.user_id = ? ORDER BY t.id',
			u.id
		),
		otherGames: await all<{ id: number; name: string }>(
			'SELECT id, name FROM game WHERE id NOT IN (SELECT game_id FROM member WHERE user_id = ?) ORDER BY created_at DESC',
			u.id
		),
		passkeys: await all<{ id: string; created_at: number }>('SELECT id, created_at FROM passkey WHERE user_id = ? ORDER BY created_at', u.id),
		devices: (await get<{ n: number }>('SELECT COUNT(*) AS n FROM session WHERE user_id = ? AND expires_at > ?', u.id, now()))!.n,
		photos: (await get<{ n: number }>('SELECT COUNT(*) AS n FROM photo WHERE user_id = ?', u.id))!.n
	};
};

export const actions = {
	save: async ({ request, locals, params }) => {
		const me = requireAdmin(locals);
		const u = await person(params.id);
		const f = await request.formData();
		const name = str(f.get('name'), 40);
		const email = cleanEmail(f.get('email'));
		if (!name || !email) return fail(400, { error: 'A person needs a name and a valid email.' });
		const other = await get<{ name: string }>('SELECT name FROM user WHERE email = ? AND id != ?', email, u.id);
		if (other) return fail(400, { error: `${other.name} already has that email.` });
		// You can't remove your own admin rights, so there's always at least one admin.
		const isAdmin = u.id === me.id ? 1 : f.get('is_admin') ? 1 : 0;
		await run('UPDATE user SET name = ?, email = ?, is_admin = ? WHERE id = ?', name, email, isAdmin, u.id);
		return { saved: true };
	},
	addToGame: async ({ request, locals, params }) => {
		requireAdmin(locals);
		const u = await person(params.id);
		const game = Number((await request.formData()).get('game'));
		if (!await get('SELECT 1 FROM game WHERE id = ?', game)) return fail(400, { error: 'Pick a game.' });
		await run('INSERT OR IGNORE INTO member (game_id, user_id) VALUES (?, ?)', game, u.id);
	},
	setTeam: async ({ request, locals, params }) => {
		requireAdmin(locals);
		const u = await person(params.id);
		const f = await request.formData();
		const game = Number(f.get('game'));
		const team = Number(f.get('team')) || null;
		if (team && !await get('SELECT 1 FROM team WHERE id = ? AND game_id = ?', team, game)) return fail(400, { error: 'No such team.' });
		await run('UPDATE member SET team_id = ? WHERE game_id = ? AND user_id = ?', team, game, u.id);
	},
	leaveGame: async ({ request, locals, params }) => {
		requireAdmin(locals);
		const u = await person(params.id);
		await run('DELETE FROM member WHERE game_id = ? AND user_id = ?', Number((await request.formData()).get('game')), u.id);
	},
	link: async ({ locals, params, url }) => {
		requireAdmin(locals);
		const u = await person(params.id);
		const link = `${url.origin}/link/${await makeHandoff(u.id, 60 * 24)}`;
		return { link, qr: await qrDataUrl(link) };
	},
	email: async ({ locals, params, url }) => {
		const me = requireAdmin(locals);
		const u = await person(params.id);
		try {
			await sendInvite(u, url.origin, me.name);
		} catch {
			return fail(500, { error: 'The email couldn’t be sent. Check the mail settings, or use a sign-in link.' });
		}
		return { emailed: true };
	},
	signout: async ({ locals, params }) => {
		requireAdmin(locals);
		await run('DELETE FROM session WHERE user_id = ?', (await person(params.id)).id);
		return { signedOut: true };
	},
	forget: async ({ request, locals, params }) => {
		requireAdmin(locals);
		await run('DELETE FROM passkey WHERE id = ? AND user_id = ?', String((await request.formData()).get('key')), (await person(params.id)).id);
	},
	delete: async ({ locals, params }) => {
		const me = requireAdmin(locals);
		const u = await person(params.id);
		if (u.id === me.id) return fail(400, { error: 'You can’t delete yourself.' });
		const ids = await all<{ id: number; ext: string }>('SELECT id, ext FROM photo WHERE user_id = ?', u.id);
		await run('DELETE FROM user WHERE id = ?', u.id);
		await remove(ids);
		redirect(303, '/admin/users');
	}
};
