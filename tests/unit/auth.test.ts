import { describe, expect, it, vi } from 'vitest';
import { env } from 'cloudflare:workers';
import { get, run } from '../../src/lib/server/db.ts';
import {
	acceptInvite, checkCode, cleanEmail, createUser, findInvite, invitesLeft, INVITES_PER_DAY, makeHandoff, markVerified, offerPasskey,
	safeNext, sendCode, sendInvite, userFromToken, useHandoff, endSession, startSession
} from '../../src/lib/server/auth.ts';
import { mkGame, mkUser, useDatabase } from './helpers.ts';

useDatabase();

/** The code from the "[mail not configured]" line the app logs when no mail key is set. */
async function lastCode(email: string, origin = 'https://x.test') {
	const log = vi.spyOn(console, 'log').mockImplementation(() => {});
	try {
		await sendCode(email, origin);
		return /\n\s+(\d{6})\n/.exec(String(log.mock.calls.at(-1)?.[0]))![1];
	} finally {
		log.mockRestore();
	}
}

describe('cleanEmail', () => {
	it('lower-cases and trims', () => expect(cleanEmail('  Foo@Bar.COM ')).toBe('foo@bar.com'));
	it.each(['', 'nope', 'a@b', 'a b@c.com', '@x.com', 'a@b@c.com'])('rejects %j', (v) => expect(cleanEmail(v)).toBeNull());
	it('rejects very long addresses', () => expect(cleanEmail(`${'a'.repeat(200)}@x.com`)).toBeNull());
	it('rejects non-strings', () => expect(cleanEmail(undefined)).toBeNull());
});

describe('safeNext', () => {
	it('allows in-site paths', () => expect(safeNext('/g/ABC?x=1')).toBe('/g/ABC?x=1'));
	it.each(['//evil.com', 'https://evil.com', '/\\evil.com', 'javascript:alert(1)', ''])('blocks %j', (v) => expect(safeNext(v)).toBe('/'));
	it('uses the given fallback', () => expect(safeNext('//x', '/home')).toBe('/home'));
});

describe('sign-in codes', () => {
	it('accepts the right code once', async () => {
		const code = await lastCode('a@example.com');
		expect(await checkCode('a@example.com', code)).toEqual({ ok: true, name: null });
		expect((await checkCode('a@example.com', code)).ok).toBe(false);
	});
	it('ignores spaces and dashes in the typed code', async () => {
		const code = await lastCode('a@example.com');
		expect((await checkCode('a@example.com', `${code.slice(0, 3)} - ${code.slice(3)}`)).ok).toBe(true);
	});
	it('rejects a wrong code', async () => {
		const code = await lastCode('a@example.com');
		const wrong = code === '000000' ? '000001' : '000000';
		expect((await checkCode('a@example.com', wrong)).ok).toBe(false);
	});
	it('locks out after six wrong guesses, even for the right code', async () => {
		const code = await lastCode('a@example.com');
		const wrong = code === '000000' ? '000001' : '000000';
		for (let i = 0; i < 6; i++) await checkCode('a@example.com', wrong);
		expect((await checkCode('a@example.com', code)).ok).toBe(false);
	});
	it('rejects an expired code', async () => {
		const code = await lastCode('a@example.com');
		await run('UPDATE login_code SET expires_at = 1');
		expect((await checkCode('a@example.com', code)).ok).toBe(false);
	});
	it('does not accept one address’s code for another', async () => {
		const code = await lastCode('a@example.com');
		expect((await checkCode('b@example.com', code)).ok).toBe(false);
	});
	it('replaces the earlier code when a new one is requested', async () => {
		const first = await lastCode('a@example.com');
		const second = await lastCode('a@example.com');
		if (first !== second) expect((await checkCode('a@example.com', first)).ok).toBe(false);
		expect((await checkCode('a@example.com', second)).ok).toBe(true);
	});
	it('keeps the name for a brand-new account', async () => {
		vi.spyOn(console, 'log').mockImplementation(() => {});
		await sendCode('new@example.com', 'https://x.test', 'Newbie');
		vi.restoreAllMocks();
		const row = await get<{ code_hash: string }>('SELECT code_hash FROM login_code');
		expect(row!.code_hash).toMatch(/^[0-9a-f]{64}$/);
		expect((await get<{ name: string }>('SELECT name FROM login_code'))!.name).toBe('Newbie');
	});
	it('stores only a hash of the code', async () => {
		const code = await lastCode('a@example.com');
		expect(JSON.stringify(await get('SELECT * FROM login_code'))).not.toContain(code);
	});
});

describe('site admin rights', () => {
	it('go to OWNER_EMAIL only once the email is verified', async () => {
		const id = await createUser(env.OWNER_EMAIL, 'Owner');
		expect((await get<{ is_admin: number }>('SELECT is_admin FROM user WHERE id = ?', id))!.is_admin).toBe(0);
		await markVerified(id);
		expect((await get<{ is_admin: number }>('SELECT is_admin FROM user WHERE id = ?', id))!.is_admin).toBe(1);
	});
	it('never go to anyone else', async () => {
		const id = await createUser('someone@example.com', 'Someone');
		await markVerified(id);
		expect((await get<{ is_admin: number }>('SELECT is_admin FROM user WHERE id = ?', id))!.is_admin).toBe(0);
	});
	it('markVerified keeps the first verification time', async () => {
		const id = await createUser('v@example.com', 'V');
		await markVerified(id);
		const first = (await get<{ t: number }>('SELECT email_verified_at AS t FROM user WHERE id = ?', id))!.t;
		await new Promise((r) => setTimeout(r, 5));
		await markVerified(id);
		expect((await get<{ t: number }>('SELECT email_verified_at AS t FROM user WHERE id = ?', id))!.t).toBe(first);
	});
	it('treats email case-insensitively', async () => {
		await createUser('Case@Example.com', 'C');
		await expect(createUser('case@example.com', 'C2')).rejects.toThrow();
	});
});

describe('sessions', () => {
	const jar = () => {
		const store = new Map<string, string>();
		return { get: (k: string) => store.get(k), set: (k: string, v: string) => void store.set(k, v), delete: (k: string) => void store.delete(k) } as never;
	};
	it('round-trips a token to its user and stores only a hash', async () => {
		const u = await mkUser({ name: 'Zed' });
		const cookies = jar() as any;
		await startSession(cookies, u);
		const token = cookies.get('pg_session');
		expect(token).toBeTruthy();
		expect((await userFromToken(token))!.name).toBe('Zed');
		expect((await get<{ token: string }>('SELECT token FROM session'))!.token).not.toBe(token);
	});
	it('rejects unknown, empty and expired tokens', async () => {
		const u = await mkUser();
		const cookies = jar() as any;
		await startSession(cookies, u);
		const token = cookies.get('pg_session');
		expect(await userFromToken(undefined)).toBeNull();
		expect(await userFromToken('nope')).toBeNull();
		await run('UPDATE session SET expires_at = 1');
		expect(await userFromToken(token)).toBeNull();
	});
	it('ends the session on logout', async () => {
		const cookies = jar() as any;
		await startSession(cookies, await mkUser());
		const token = cookies.get('pg_session');
		await endSession(cookies);
		expect(await userFromToken(token)).toBeNull();
		expect(cookies.get('pg_session')).toBeUndefined();
	});
	it('reports verification state', async () => {
		const cookies = jar() as any;
		await startSession(cookies, await mkUser({ verified: false }));
		expect((await userFromToken(cookies.get('pg_session')))!.verified).toBe(false);
	});
});

describe('hand-off links', () => {
	it('work once', async () => {
		const u = await mkUser();
		const t = await makeHandoff(u, 5);
		expect(await useHandoff(t)).toBe(u);
		expect(await useHandoff(t)).toBeNull();
	});
	it('expire', async () => {
		const t = await makeHandoff(await mkUser(), 5);
		await run('UPDATE handoff SET expires_at = 1');
		expect(await useHandoff(t)).toBeNull();
	});
	it('reject unknown tokens', async () => expect(await useHandoff('nope')).toBeNull());
});

describe('invites', () => {
	const quiet = () => vi.spyOn(console, 'log').mockImplementation(() => {});
	async function invite() {
		const g = await mkGame();
		const inviter = await mkUser({ name: 'Host' });
		const guest = await mkUser({ verified: false, name: 'Guest' });
		const log = quiet();
		await sendInvite({ id: guest, email: 'guest@example.com', name: 'Guest' }, 'https://x.test', { id: inviter, name: 'Host' }, g);
		const token = /\/invite\/([\w-]+)/.exec(String(log.mock.calls.at(-1)![0]))![1];
		log.mockRestore();
		return { g, inviter, guest, token };
	}

	it('verifies the guest and adds them to the game on acceptance', async () => {
		const { g, guest, token } = await invite();
		const inv = await acceptInvite(token);
		expect(inv!.game_id).toBe(g.id);
		expect(await get('SELECT 1 FROM user WHERE id = ? AND email_verified_at IS NOT NULL', guest)).toBeTruthy();
		expect(await get('SELECT status FROM member WHERE game_id = ? AND user_id = ?', g.id, guest)).toEqual({ status: 'active' });
	});
	it('works only once', async () => {
		const { token } = await invite();
		expect(await acceptInvite(token)).not.toBeNull();
		expect(await acceptInvite(token)).toBeNull();
	});
	it('does not work after it expires', async () => {
		const { token } = await invite();
		await run('UPDATE invite SET expires_at = 1');
		expect(await acceptInvite(token)).toBeNull();
	});
	it('rejects unknown tokens', async () => {
		expect(await acceptInvite('nope')).toBeNull();
		expect(await findInvite('nope')).toBeUndefined();
	});
	it('activates an already-invited member without duplicating the row', async () => {
		const { g, guest, token } = await invite();
		await run("INSERT INTO member (game_id, user_id, status) VALUES (?, ?, 'invited')", g.id, guest);
		await acceptInvite(token);
		const rows = await get<{ n: number }>('SELECT COUNT(*) AS n FROM member WHERE user_id = ?', guest);
		expect(rows!.n).toBe(1);
	});
	it('counts toward the host’s daily limit, except for site admins', async () => {
		const { inviter } = await invite();
		expect(await invitesLeft({ id: inviter, is_admin: 0 })).toBe(INVITES_PER_DAY - 1);
		expect(await invitesLeft({ id: inviter, is_admin: 1 })).toBe(Infinity);
	});
	it('does not count invites older than a day', async () => {
		const { inviter } = await invite();
		await run('UPDATE invite SET created_at = 1');
		expect(await invitesLeft({ id: inviter, is_admin: 0 })).toBe(INVITES_PER_DAY);
	});
});

describe('offerPasskey', () => {
	it('detours people without a passkey and passes through those with one', async () => {
		const u = await mkUser();
		expect(await offerPasskey(u, '/g/A?x=1')).toBe('/passkey?next=%2Fg%2FA%3Fx%3D1');
		await run("INSERT INTO passkey (id, user_id, public_key, created_at) VALUES ('k', ?, 'pk', 1)", u);
		expect(await offerPasskey(u, '/g/A')).toBe('/g/A');
	});
});
