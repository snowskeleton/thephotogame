import { fail } from '@sveltejs/kit';
import QRCode from 'qrcode';
import { cleanEmail, createUser, findUserByEmail, makeHandoff } from '#lib/server/auth.ts';
import { all, get, insert, run } from '#lib/server/db.ts';
import { gameByCode, requireAdmin, str, TEAM_COLORS } from '#lib/server/game.ts';

export const load = ({ params }) => {
	const game = gameByCode(params.code);
	return {
		teams: all<{ id: number; name: string; color: string; members: number; photos: number }>(
			`SELECT t.*, (SELECT COUNT(*) FROM member m WHERE m.team_id = t.id) AS members,
				(SELECT COUNT(*) FROM photo p WHERE p.team_id = t.id) AS photos
			 FROM team t WHERE t.game_id = ? ORDER BY t.id`,
			game.id
		),
		players: all<{ id: number; name: string; email: string; team_id: number | null; photos: number }>(
			`SELECT u.id, u.name, u.email, m.team_id,
				(SELECT COUNT(*) FROM photo p WHERE p.user_id = u.id AND p.game_id = m.game_id) AS photos
			 FROM member m JOIN user u ON u.id = m.user_id WHERE m.game_id = ? ORDER BY m.team_id IS NOT NULL, u.name`,
			game.id
		),
		colors: TEAM_COLORS
	};
};

const color = (v: unknown) => (/^#[0-9a-f]{6}$/i.test(String(v)) ? String(v) : null);

export const actions = {
	addTeam: async ({ request, params, locals }) => {
		requireAdmin(locals);
		const game = gameByCode(params.code);
		const f = await request.formData();
		const name = str(f.get('name'), 40);
		const c = color(f.get('color'));
		if (!name || !c) return fail(400, { error: 'A team needs a name and a color.' });
		insert('INSERT INTO team (game_id, name, color) VALUES (?, ?, ?)', game.id, name, c);
	},
	saveTeam: async ({ request, params, locals }) => {
		requireAdmin(locals);
		const game = gameByCode(params.code);
		const f = await request.formData();
		const name = str(f.get('name'), 40);
		const c = color(f.get('color'));
		if (!name || !c) return fail(400, { error: 'A team needs a name and a color.' });
		run('UPDATE team SET name = ?, color = ? WHERE id = ? AND game_id = ?', name, c, Number(f.get('id')), game.id);
	},
	deleteTeam: async ({ request, params, locals }) => {
		requireAdmin(locals);
		const game = gameByCode(params.code);
		const id = Number((await request.formData()).get('id'));
		if (get('SELECT 1 FROM photo WHERE team_id = ? LIMIT 1', id))
			return fail(400, { error: 'That team has photos. Delete or keep the team; its photos can’t be orphaned.' });
		run('DELETE FROM team WHERE id = ? AND game_id = ?', id, game.id);
	},
	assign: async ({ request, params, locals }) => {
		requireAdmin(locals);
		const game = gameByCode(params.code);
		const f = await request.formData();
		const teamId = Number(f.get('team')) || null;
		if (teamId && !get('SELECT 1 FROM team WHERE id = ? AND game_id = ?', teamId, game.id))
			return fail(400, { error: 'No such team.' });
		run('UPDATE member SET team_id = ? WHERE game_id = ? AND user_id = ?', teamId, game.id, Number(f.get('user')));
	},
	addPlayer: async ({ request, params, locals }) => {
		requireAdmin(locals);
		const game = gameByCode(params.code);
		const f = await request.formData();
		const email = cleanEmail(f.get('email'));
		const name = str(f.get('name'), 40);
		if (!email) return fail(400, { error: 'That email doesn’t look right.' });
		let user = findUserByEmail(email);
		if (!user && !name) return fail(400, { error: 'New players need a name.' });
		const id = user?.id ?? createUser(email, name);
		run('INSERT OR IGNORE INTO member (game_id, user_id) VALUES (?, ?)', game.id, id);
	},
	removePlayer: async ({ request, params, locals }) => {
		requireAdmin(locals);
		const game = gameByCode(params.code);
		run('DELETE FROM member WHERE game_id = ? AND user_id = ?', game.id, Number((await request.formData()).get('user')));
	},
	signin: async ({ request, params, locals, url }) => {
		requireAdmin(locals);
		const game = gameByCode(params.code);
		const userId = Number((await request.formData()).get('user'));
		const m = get<{ name: string }>(
			'SELECT u.name FROM member m JOIN user u ON u.id = m.user_id WHERE m.game_id = ? AND m.user_id = ?',
			game.id,
			userId
		);
		if (!m) return fail(400, { error: 'That player isn’t in this game.' });
		const link = `${url.origin}/link/${makeHandoff(userId, 60 * 24)}`;
		return { signin: { name: m.name, link, qr: await QRCode.toDataURL(link, { margin: 2, width: 320 }) } };
	}
};
