import { describe, expect, it } from 'vitest';
import { get, run } from '../../src/lib/server/db.ts';
import {
	canSee, cleanCode, createGame, enter, gameByCode, hostingCheck, intOrNull, num, positiveOrNull, randomCode, requireAdmin, requireHost,
	str, visibleSql, type Viewer
} from '../../src/lib/server/game.ts';
import { asUser, locals, mkGame, mkMember, mkTeam, mkUser, useDatabase } from './helpers.ts';

useDatabase();

describe('input cleaners', () => {
	it('cleanCode upper-cases and drops spaces and dashes', () => {
		expect(cleanCode(' ab-c d2 ')).toBe('ABCD2');
		expect(cleanCode(null)).toBe('');
		expect(cleanCode('x'.repeat(100))).toHaveLength(40);
	});
	it('num falls back on junk', () => {
		expect(num(' 4.5 ')).toBe(4.5);
		expect(num('abc', 7)).toBe(7);
		// A blank field is 0, not the fallback.
		expect(num('', 3)).toBe(0);
		expect(num(undefined, 3)).toBe(0);
	});
	it('intOrNull accepts only positive numbers', () => {
		expect(intOrNull('3.9')).toBe(3);
		expect(intOrNull('')).toBeNull();
		expect(intOrNull('0')).toBeNull();
		expect(intOrNull('-2')).toBeNull();
		expect(intOrNull('x')).toBeNull();
	});
	it('positiveOrNull keeps decimals', () => {
		expect(positiveOrNull('2.5')).toBe(2.5);
		expect(positiveOrNull('0')).toBeNull();
		expect(positiveOrNull(' ')).toBeNull();
	});
	it('str trims and truncates', () => {
		expect(str('  hi  ')).toBe('hi');
		expect(str('abcdef', 3)).toBe('abc');
		expect(str(undefined)).toBe('');
	});
});

describe('join codes', () => {
	it('are 10 characters without look-alike letters', async () => {
		for (let i = 0; i < 50; i++) expect(await randomCode()).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{10}$/);
	});
});

describe('createGame', () => {
	it('makes the creator an active host', async () => {
		const u = await mkUser();
		const code = await createGame(await asUser(u), 'Summer');
		const g = await gameByCode(code);
		expect(g.name).toBe('Summer');
		expect(await get('SELECT role, status FROM member WHERE game_id = ? AND user_id = ?', g.id, u)).toEqual({ role: 'host', status: 'active' });
	});
	it('finds games regardless of code case', async () => {
		const code = await createGame(await asUser(await mkUser()), 'x');
		expect((await gameByCode(code.toLowerCase())).code).toBe(code);
	});
	it('404s on an unknown code', async () => {
		await expect(gameByCode('NOPE')).rejects.toMatchObject({ status: 404 });
	});
});

describe('hostingCheck', () => {
	it('always allows site admins', async () => {
		await run("INSERT OR REPLACE INTO setting (key, value) VALUES ('signups', '0')");
		expect(await hostingCheck(await asUser(await mkUser({ admin: true })))).toEqual({ ok: true });
	});
	it('refuses everyone else when sign-ups are closed', async () => {
		await run("INSERT OR REPLACE INTO setting (key, value) VALUES ('signups', '0')");
		expect(await hostingCheck(await asUser(await mkUser()))).toMatchObject({ ok: false, why: 'closed' });
	});
	it('requires a verified email', async () => {
		expect(await hostingCheck(await asUser(await mkUser({ verified: false })))).toMatchObject({ ok: false, why: 'unverified' });
	});
	it('stops at the game limit', async () => {
		const u = await asUser(await mkUser());
		for (let i = 0; i < 3; i++) await createGame(u, `g${i}`);
		expect(await hostingCheck(u)).toEqual({ ok: false, why: 'limit', limit: 3 });
	});
	it('does not limit site admins', async () => {
		const u = await asUser(await mkUser({ admin: true }));
		for (let i = 0; i < 4; i++) await createGame(u, `g${i}`);
		expect(await hostingCheck(u)).toEqual({ ok: true });
	});
});

describe('enter', () => {
	async function world() {
		const g = await mkGame();
		const team = await mkTeam(g.id);
		const player = await mkUser();
		const host = await mkUser();
		await mkMember(g.id, player, team);
		await mkMember(g.id, host, team, 'host');
		return { g, team, player, host };
	}

	it('sends signed-out visitors to the join page', async () => {
		const { g } = await world();
		await expect(enter(await locals(null), g.code)).rejects.toMatchObject({ status: 303, location: `/join/${g.code}` });
	});
	it('sends non-members to the join page', async () => {
		const { g } = await world();
		await expect(enter(await locals(await mkUser()), g.code)).rejects.toMatchObject({ status: 303 });
	});
	it('sends invited-but-not-accepted people to the join page', async () => {
		const { g } = await world();
		const u = await mkUser();
		await mkMember(g.id, u, null, 'player', 'invited');
		await expect(enter(await locals(u), g.code)).rejects.toMatchObject({ status: 303 });
	});
	it('gives a player their team and no host power', async () => {
		const { g, team, player } = await world();
		const { viewer } = await enter(await locals(player), g.code);
		expect(viewer).toMatchObject({ teamId: team, isHost: false });
	});
	it('gives a host host power', async () => {
		const { g, host } = await world();
		expect((await enter(await locals(host), g.code)).viewer.isHost).toBe(true);
	});
	it('lets a site admin in without membership, as host with no team', async () => {
		const { g } = await world();
		const { viewer } = await enter(await locals(await mkUser({ admin: true })), g.code);
		expect(viewer).toMatchObject({ teamId: null, isHost: true });
	});

	describe('requireHost', () => {
		it('rejects players with 403', async () => {
			const { g, player } = await world();
			await expect(requireHost(await locals(player), g.code)).rejects.toMatchObject({ status: 403 });
		});
		it('rejects a host of a different game', async () => {
			const { g } = await world();
			const other = await mkGame();
			const u = await mkUser();
			await mkMember(other.id, u, null, 'host');
			await expect(requireHost(await locals(u), g.code)).rejects.toMatchObject({ status: 403 });
		});
		it('rejects a host who has not accepted yet', async () => {
			const { g } = await world();
			const u = await mkUser();
			await mkMember(g.id, u, null, 'host', 'invited');
			await expect(requireHost(await locals(u), g.code)).rejects.toMatchObject({ status: 403 });
		});
		it('accepts the host and site admins', async () => {
			const { g, host } = await world();
			expect((await requireHost(await locals(host), g.code)).id).toBe(g.id);
			expect((await requireHost(await locals(await mkUser({ admin: true })), g.code)).id).toBe(g.id);
		});
		it('sends signed-out visitors to /login', async () => {
			const { g } = await world();
			await expect(requireHost(await locals(null), g.code)).rejects.toMatchObject({ status: 303, location: '/login' });
		});
	});
});

describe('requireAdmin', () => {
	it('lets admins through, 403s others, redirects strangers', async () => {
		expect(requireAdmin(await locals(await mkUser({ admin: true })))).toBeTruthy();
		expect(() => requireAdmin(null as never)).toThrow();
		await expect(async () => requireAdmin(await locals(await mkUser()))).rejects.toMatchObject({ status: 403 });
		await expect(async () => requireAdmin(await locals(null))).rejects.toMatchObject({ status: 303 });
	});
});

describe('photo visibility', () => {
	const viewer = (o: Partial<Viewer> = {}): Viewer => ({ user: {} as never, teamId: 1, isHost: false, ...o });
	const hidden = { visibility: 'hidden', revealed_at: 1000 } as never;
	const open = { visibility: 'open', revealed_at: 0 } as never;

	it('hides other teams’ new photos in hidden mode', () => {
		expect(canSee(hidden, viewer(), { team_id: 2, created_at: 2000 })).toBe(false);
	});
	it('shows own team’s photos', () => {
		expect(canSee(hidden, viewer(), { team_id: 1, created_at: 2000 })).toBe(true);
	});
	it('shows photos submitted before the last reveal', () => {
		expect(canSee(hidden, viewer(), { team_id: 2, created_at: 1000 })).toBe(true);
	});
	it('shows everything in open mode and to hosts', () => {
		expect(canSee(open, viewer(), { team_id: 2, created_at: 2000 })).toBe(true);
		expect(canSee(hidden, viewer({ isHost: true }), { team_id: 2, created_at: 2000 })).toBe(true);
	});
	it('visibleSql mirrors canSee', () => {
		expect(visibleSql(open, viewer())).toEqual({ sql: '1=1', params: [] });
		expect(visibleSql(hidden, viewer({ isHost: true }))).toEqual({ sql: '1=1', params: [] });
		expect(visibleSql(hidden, viewer())).toEqual({ sql: '(p.team_id = ? OR p.created_at <= ?)', params: [1, 1000] });
		expect(visibleSql(hidden, viewer({ teamId: null })).params[0]).toBe(-1);
	});
});
