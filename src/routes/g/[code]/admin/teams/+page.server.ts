import { fail } from '@sveltejs/kit';
import { cleanEmail, createUser, findUserByEmail, INVITES_PER_DAY, invitesLeft, sendInvite } from '#lib/server/auth.ts';
import { mailReady } from '#lib/server/mail.ts';
import { all, get, insert, run } from '#lib/server/db.ts';
import { validColor } from '#lib/colors.ts';
import { gameByCode, requireHost, str } from '#lib/server/game.ts';

export const load = async ({ params, locals }) => {
	const game = await gameByCode(params.code);
	return {
		teams: await all<{ id: number; name: string; color: string; members: number; photos: number }>(
			`SELECT t.*, (SELECT COUNT(*) FROM member m WHERE m.team_id = t.id) AS members,
				(SELECT COUNT(*) FROM photo p WHERE p.team_id = t.id) AS photos
			 FROM team t WHERE t.game_id = ? ORDER BY t.id`,
			game.id
		),
		mailReady: mailReady(),
		invitesLeft: Math.min(await invitesLeft(locals.user!), 999),
		invitesPerDay: INVITES_PER_DAY,
		players: await all<{ id: number; name: string; email: string; team_id: number | null; role: string; status: string; photos: number }>(
			`SELECT u.id, u.name, u.email, m.team_id, m.role, m.status,
				(SELECT COUNT(*) FROM photo p WHERE p.user_id = u.id AND p.game_id = m.game_id) AS photos
			 FROM member m JOIN user u ON u.id = m.user_id WHERE m.game_id = ? ORDER BY m.status = 'invited', m.team_id IS NOT NULL, u.name`,
			game.id
		)
	};
};

const color = validColor;

export const actions = {
	addTeam: async ({ request, params, locals }) => {
		const game = await requireHost(locals, params.code);
		const f = await request.formData();
		const name = str(f.get('name'), 40);
		const c = color(f.get('color'));
		if (!name || !c) return fail(400, { error: 'A team needs a name and a color.' });
		await insert('INSERT INTO team (game_id, name, color) VALUES (?, ?, ?)', game.id, name, c);
	},
	saveTeam: async ({ request, params, locals }) => {
		const game = await requireHost(locals, params.code);
		const f = await request.formData();
		const name = str(f.get('name'), 40);
		const c = color(f.get('color'));
		if (!name || !c) return fail(400, { error: 'A team needs a name and a color.' });
		await run('UPDATE team SET name = ?, color = ? WHERE id = ? AND game_id = ?', name, c, Number(f.get('id')), game.id);
	},
	deleteTeam: async ({ request, params, locals }) => {
		const game = await requireHost(locals, params.code);
		const id = Number((await request.formData()).get('id'));
		if (await get('SELECT 1 FROM photo WHERE team_id = ? LIMIT 1', id))
			return fail(400, { error: 'That team has photos. Delete or keep the team; its photos can’t be orphaned.' });
		await run('DELETE FROM team WHERE id = ? AND game_id = ?', id, game.id);
	},
	assign: async ({ request, params, locals }) => {
		const game = await requireHost(locals, params.code);
		const f = await request.formData();
		const teamId = Number(f.get('team')) || null;
		if (teamId && !await get('SELECT 1 FROM team WHERE id = ? AND game_id = ?', teamId, game.id))
			return fail(400, { error: 'No such team.' });
		await run('UPDATE member SET team_id = ? WHERE game_id = ? AND user_id = ?', teamId, game.id, Number(f.get('user')));
	},
	addPlayer: async ({ request, params, locals, url }) => {
		const game = await requireHost(locals, params.code);
		const f = await request.formData();
		const email = cleanEmail(f.get('email'));
		const name = str(f.get('name'), 40);
		if (!email) return fail(400, { error: 'That email doesn’t look right.' });
		if (!(await invitesLeft(locals.user!))) return fail(429, { error: TOO_MANY });
		const user = await findUserByEmail(email);
		if (!user && !name) return fail(400, { error: 'New players need a name.' });
		const id = user?.id ?? (await createUser(email, name));
		if (await get("SELECT 1 FROM member WHERE game_id = ? AND user_id = ? AND status = 'active'", game.id, id))
			return fail(400, { error: `${user?.name ?? name} is already in this game.` });
		await run("INSERT OR IGNORE INTO member (game_id, user_id, status) VALUES (?, ?, 'invited')", game.id, id);
		return invite(game, { id, email, name: user?.name ?? name }, locals.user!, url.origin);
	},
	resend: async ({ request, params, locals, url }) => {
		const game = await requireHost(locals, params.code);
		const u = await get<{ id: number; email: string; name: string }>(
			`SELECT u.id, u.email, u.name FROM member m JOIN user u ON u.id = m.user_id
			 WHERE m.game_id = ? AND m.user_id = ? AND m.status = 'invited'`,
			game.id,
			Number((await request.formData()).get('user'))
		);
		if (!u) return fail(400, { error: 'That person isn’t waiting on an invite.' });
		if (!(await invitesLeft(locals.user!))) return fail(429, { error: TOO_MANY });
		return invite(game, u, locals.user!, url.origin);
	},
	setRole: async ({ request, params, locals }) => {
		const game = await requireHost(locals, params.code);
		const f = await request.formData();
		const userId = Number(f.get('user'));
		const role = f.get('role') === 'host' ? 'host' : 'player';
		if (role === 'player' && (await hosts(game.id)) <= 1 && (await isHost(game.id, userId)))
			return fail(400, { error: 'A game needs at least one host. Make someone else a host first.' });
		await run("UPDATE member SET role = ? WHERE game_id = ? AND user_id = ? AND status = 'active'", role, game.id, userId);
	},
	removePlayer: async ({ request, params, locals }) => {
		const game = await requireHost(locals, params.code);
		const userId = Number((await request.formData()).get('user'));
		if (await isHost(game.id, userId)) return fail(400, { error: 'Hosts can’t be removed. Make them a player first.' });
		await run('DELETE FROM member WHERE game_id = ? AND user_id = ?', game.id, userId);
	}
};

const TOO_MANY = `You’ve sent ${INVITES_PER_DAY} invites in the last day, the most allowed. Share the game’s join link or QR code instead; any number of people can use it.`;

const hosts = async (gameId: number) =>
	(await get<{ n: number }>("SELECT COUNT(*) AS n FROM member WHERE game_id = ? AND role = 'host' AND status = 'active'", gameId))!.n;
const isHost = async (gameId: number, userId: number) =>
	!!(await get("SELECT 1 FROM member WHERE game_id = ? AND user_id = ? AND role = 'host'", gameId, userId));

async function invite(
	game: { id: number; code: string; name: string },
	user: { id: number; email: string; name: string },
	from: { id: number; name: string },
	origin: string
) {
	try {
		await sendInvite(user, origin, from, game);
	} catch {
		return fail(500, { error: `${user.name} is on the list, but the invite email couldn’t be sent. Try “Resend invite” later.` });
	}
	return { invited: user.name, logged: !mailReady() };
}
