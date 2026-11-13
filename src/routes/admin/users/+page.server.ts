import { fail, redirect } from '@sveltejs/kit';
import { cleanEmail, createUser, findUserByEmail, sendInvite } from '#lib/server/auth.ts';
import { all, get, run } from '#lib/server/db.ts';
import { requireAdmin, str } from '#lib/server/game.ts';
import { mailReady } from '#lib/server/mail.ts';

export const load = ({ locals }) => {
	const me = requireAdmin(locals);
	return {
		me: me.id,
		mailReady,
		games: all<{ id: number; name: string }>('SELECT id, name FROM game ORDER BY created_at DESC'),
		users: all<{
			id: number;
			name: string;
			email: string;
			is_admin: number;
			passkeys: number;
			games: string | null;
			photos: number;
			last_seen_at: number | null;
		}>(
			`SELECT u.id, u.name, u.email, u.is_admin, u.last_seen_at,
				(SELECT COUNT(*) FROM passkey k WHERE k.user_id = u.id) AS passkeys,
				(SELECT COUNT(*) FROM photo p WHERE p.user_id = u.id) AS photos,
				(SELECT GROUP_CONCAT(g.name, ', ') FROM member m JOIN game g ON g.id = m.game_id WHERE m.user_id = u.id) AS games
			 FROM user u ORDER BY u.name COLLATE NOCASE`
		)
	};
};

const gameById = (v: unknown) =>
	get<{ id: number; code: string; name: string }>('SELECT id, code, name FROM game WHERE id = ?', Number(v) || 0);

/** "Ada Lovelace, ada@example.com", "Ada <ada@example.com>" or just an email. */
function parseLine(line: string): { name: string; email: string } | null {
	const m = line.match(/[^\s<>,;]+@[^\s<>,;]+/);
	const email = m && cleanEmail(m[0]);
	if (!email) return null;
	const name = line.replace(m![0], '').replace(/[<>,;\t"]/g, ' ').replace(/\s+/g, ' ').trim();
	return { email, name: (name || email.split('@')[0]).slice(0, 40) };
}

export const actions = {
	add: async ({ request, locals, url }) => {
		const me = requireAdmin(locals);
		const f = await request.formData();
		const name = str(f.get('name'), 40);
		const email = cleanEmail(f.get('email'));
		const back = { name, email: String(f.get('email') ?? '') };
		if (!name || !email) return fail(400, { error: 'A person needs a name and a valid email.', existing: 0, ...back });
		const existing = findUserByEmail(email);
		if (existing) return fail(400, { error: `${existing.name} already has that email.`, existing: existing.id, ...back });
		const game = gameById(f.get('game'));
		const id = createUser(email, name);
		if (f.get('is_admin')) run('UPDATE user SET is_admin = 1 WHERE id = ?', id);
		if (game) run('INSERT OR IGNORE INTO member (game_id, user_id) VALUES (?, ?)', game.id, id);
		let sent = '';
		if (f.get('invite')) {
			try {
				await sendInvite({ id, email, name }, url.origin, me.name, game);
				sent = '&invited=1';
			} catch {
				sent = '&invited=0';
			}
		}
		redirect(303, `/admin/users/${id}?added=1${sent}`);
	},
	addMany: async ({ request, locals, url }) => {
		const me = requireAdmin(locals);
		const f = await request.formData();
		const game = gameById(f.get('game'));
		const invite = !!f.get('invite');
		const lines = String(f.get('list') ?? '').split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 200);
		const report = { added: [] as string[], already: [] as string[], bad: [] as string[], mailFailed: [] as string[] };
		for (const line of lines) {
			const p = parseLine(line);
			if (!p) {
				report.bad.push(line.slice(0, 80));
				continue;
			}
			const existing = findUserByEmail(p.email);
			const id = existing?.id ?? createUser(p.email, p.name);
			if (game) run('INSERT OR IGNORE INTO member (game_id, user_id) VALUES (?, ?)', game.id, id);
			if (existing) {
				report.already.push(existing.name);
				continue;
			}
			report.added.push(p.name);
			if (invite) await sendInvite({ id, ...p }, url.origin, me.name, game).catch(() => report.mailFailed.push(p.name));
		}
		return { report, game: game?.name };
	}
};
