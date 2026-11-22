import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from 'cloudflare:workers';
import { get, run } from '../../src/lib/server/db.ts';
import { addWebhook, cleanUrl, deliver, maskUrl, testWebhook, updateWebhook } from '../../src/lib/server/webhooks.ts';
import { claim, mkCategory, mkGame, mkMember, mkOption, mkPhoto, mkTeam, mkUser, useDatabase } from './helpers.ts';

useDatabase();

const ROOM = 'https://chat.example.com/rooms/r1/bot-key/messages';
type Call = { url: string; method: string; type: string | null; body: unknown; headers: Headers };
let calls: Call[];
let answers: Response[];
let counter = 0;

beforeEach(() => {
	calls = [];
	answers = [];
	counter = 0;
	vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
		const headers = new Headers(init?.headers);
		const body = init?.body instanceof FormData ? init.body : init?.body;
		calls.push({ url: String(input), method: init?.method ?? 'GET', type: headers.get('content-type'), body, headers });
		return answers.shift() ?? new Response(null, { status: 201, headers: { location: `https://chat.example.com/rooms/r1/@m${++counter}` } });
	});
});
afterEach(() => vi.restoreAllMocks());

async function world(o: { visibility?: 'hidden' | 'open'; revealed?: number } = {}) {
	const game = await mkGame({ visibility: o.visibility ?? 'open', revealed_at: o.revealed ?? 0 });
	const a = await mkTeam(game.id, 'Reds');
	const host = await mkUser({ name: 'Hana' });
	await mkMember(game.id, host, a, 'host');
	const cat = await mkCategory(game.id);
	const photo = await mkPhoto(game, { cat, team: a, user: host });
	await env.PHOTOS.put(`photos/${photo}/large.jpg`, new Uint8Array([0xff, 0xd8, 0xff, 0xd9]));
	return { game, team: a, cat, photo };
}
const hook = async (gameId: number, o: Record<string, unknown> = {}) => {
	const r = await addWebhook(gameId, { name: 'Chat', kind: 'ember', url: ROOM, ...o });
	if ('error' in r) throw new Error(r.error);
	return r.id;
};

describe('setting up', () => {
	it('accepts only room bot addresses for ember and https everywhere', () => {
		expect(cleanUrl('ember', `${ROOM}?x=1`)).toEqual({ url: ROOM });
		expect(cleanUrl('ember', 'https://chat.example.com/rooms/r1/key/slack')).toHaveProperty('error');
		expect(cleanUrl('json', 'http://example.com/x')).toHaveProperty('error');
		expect(cleanUrl('json', 'http://localhost:8787/x')).toHaveProperty('url');
		expect(cleanUrl('json', 'nope')).toHaveProperty('error');
	});
	it('never shows the key in a masked address', () => {
		expect(maskUrl(ROOM)).toBe('https://chat.example.com/…');
		expect(maskUrl(ROOM)).not.toContain('bot-key');
	});
	it('needs a name and an event, and keeps old secrets when a field is left blank', async () => {
		const { game } = await world();
		expect(await addWebhook(game.id, { name: '', kind: 'ember', url: ROOM })).toHaveProperty('error');
		expect(await addWebhook(game.id, { name: 'x', kind: 'ember', url: ROOM, events: ['nope'] })).toHaveProperty('error');
		const id = await hook(game.id);
		expect(await updateWebhook(game.id, id, { name: 'Renamed', url: '' })).toEqual({ ok: true });
		const row = await get<{ name: string; url: string }>('SELECT name, url FROM webhook WHERE id = ?', id);
		expect(row).toEqual({ name: 'Renamed', url: ROOM });
		expect(await updateWebhook(game.id + 999, id, { name: 'x' })).toHaveProperty('error');
	});
});

describe('ember', () => {
	it('posts the picture, then who/where as its first comment', async () => {
		const { game, photo } = await world();
		await hook(game.id);
		await deliver('photo.added', photo);
		expect(calls).toHaveLength(2);
		expect(calls[0].url).toBe(ROOM);
		expect(calls[0].body).toBeInstanceOf(FormData);
		expect((calls[0].body as FormData).get('attachment')).toBeInstanceOf(File);
		expect(calls[1].url).toBe(`${ROOM}?thread=m1`);
		expect(String(calls[1].body)).toContain('New photo from Hana (Reds)');
		expect(await get('SELECT root_id FROM webhook_post WHERE photo_id = ?', photo)).toEqual({ root_id: 'm1' });
	});

	it('does not post the same photo twice', async () => {
		const { game, photo } = await world();
		await hook(game.id);
		await deliver('photo.added', photo);
		await deliver('photo.added', photo);
		expect(calls).toHaveLength(2);
	});

	it('comments in the photo’s thread when points change, and stays quiet when they do not', async () => {
		const { game, photo, cat } = await world();
		await hook(game.id);
		await deliver('photo.added', photo);
		calls.length = 0;
		await deliver('photo.scored', photo);
		expect(calls).toHaveLength(0); // still pending
		await claim(photo, await mkOption(cat, 5));
		await deliver('photo.scored', photo);
		expect(calls).toHaveLength(1);
		expect(calls[0].url).toBe(`${ROOM}?thread=m1`);
		expect(String(calls[0].body)).toContain('Scored 5 points');
		expect(String(calls[0].body)).toContain('Reds now has 5');
		await deliver('photo.scored', photo);
		expect(calls).toHaveLength(1);
		await run('UPDATE photo SET points_override = 8 WHERE id = ?', photo);
		await deliver('photo.scored', photo);
		expect(String(calls[1].body)).toContain('Scored 8 points (was 5)');
	});

	it('makes the picture first when a comment arrives for a photo it never saw', async () => {
		const { game, photo } = await world();
		await hook(game.id, { events: ['photo.disqualified'] });
		await run("UPDATE photo SET status = 'disqualified' WHERE id = ?", photo);
		await deliver('photo.disqualified', photo);
		expect(calls).toHaveLength(2);
		expect(calls[0].body).toBeInstanceOf(FormData);
		expect(String(calls[1].body)).toContain('Disqualified');
	});

	it('starts a new picture when the old message is gone from the chat', async () => {
		const { game, photo } = await world();
		await hook(game.id, { events: ['photo.added', 'photo.disqualified'] });
		await deliver('photo.added', photo);
		calls.length = 0;
		answers.push(new Response(null, { status: 404 }));
		await deliver('photo.disqualified', photo);
		expect(calls.map((c) => c.url)).toEqual([`${ROOM}?thread=m1`, ROOM, `${ROOM}?thread=m3`]);
	});

	it('escapes HTML in captions', async () => {
		const { game, photo } = await world();
		await run("UPDATE photo SET caption = '<b>hi</b> & bye' WHERE id = ?", photo);
		await hook(game.id);
		await deliver('photo.added', photo);
		expect(String(calls[1].body)).toContain('&lt;b&gt;hi&lt;/b&gt; &amp; bye');
	});

	it('only sends the events a webhook asked for', async () => {
		const { game, photo } = await world();
		await hook(game.id, { events: ['photo.review'] });
		await deliver('photo.added', photo);
		await deliver('photo.restored', photo);
		expect(calls).toHaveLength(0);
	});

	it('posts a team grant in the thread of its photo, and as a plain message without one', async () => {
		const { game, photo, team } = await world();
		await hook(game.id, { events: ['photo.added', 'points.granted'] });
		await deliver('photo.added', photo);
		calls.length = 0;
		const { insert } = await import('../../src/lib/server/db.ts');
		const g = await insert("INSERT INTO grant_award (game_id, team_id, title, points, created_at) VALUES (?, ?, 'Cameo', 3, 1)", game.id, team);
		await run('INSERT INTO grant_photo (grant_id, photo_id) VALUES (?, ?)', g, photo);
		await deliver('points.granted', photo, { grantId: g });
		expect(calls[0].url).toBe(`${ROOM}?thread=m1`);
		expect(String(calls[0].body)).toContain('+3 for “Cameo”');
		await deliver('points.granted', null, { grantId: g }, game.id);
		expect(calls[1].url).toBe(ROOM);
		expect(calls[1].type).toBe('text/plain');
	});
});

describe('superlatives', () => {
	it('posts in the photo’s thread for a photo, and as a plain message for a team', async () => {
		const { game, photo, team } = await world();
		await hook(game.id, { events: ['photo.added', 'superlative.awarded'] });
		await deliver('photo.added', photo);
		calls.length = 0;
		// Straight into the table, so the app's own background announcement doesn't mix into the calls under test.
		const { insert } = await import('../../src/lib/server/db.ts');
		const row = (title: string, kind: string, u: number | null, t: number | null, p: number | null) =>
			insert('INSERT INTO superlative (game_id, title, kind, user_id, team_id, photo_id, created_at) VALUES (?, ?, ?, ?, ?, ?, 1)', game.id, title, kind, u, t, p);
		const a = { id: await row('Best hat', 'photo', null, null, photo) };
		const b = { id: await row('Loudest', 'team', null, team, null) };
		calls.length = 0;
		await deliver('superlative.awarded', photo, { superlativeId: a.id }, game.id);
		expect(calls[0].url).toBe(`${ROOM}?thread=m1`);
		expect(String(calls[0].body)).toContain('Superlative “Best hat” goes to this photo');
		await deliver('superlative.awarded', null, { superlativeId: b.id }, game.id);
		expect(calls[1].url).toBe(ROOM);
		expect(String(calls[1].body)).toContain('“Loudest” goes to team Reds');
	});
});

describe('hidden games', () => {
	it('keeps unrevealed photos from a webhook unless the host allowed it', async () => {
		const { game, photo } = await world({ visibility: 'hidden', revealed: 0 });
		const id = await hook(game.id);
		await deliver('photo.added', photo);
		expect(calls).toHaveLength(0);
		await updateWebhook(game.id, id, { hiddenOk: '1' });
		await deliver('photo.added', photo);
		expect(calls).toHaveLength(2);
	});
	it('sends photos that were already revealed', async () => {
		const { game, photo } = await world({ visibility: 'hidden', revealed: Date.now() + 10_000 });
		await hook(game.id);
		await deliver('photo.added', photo);
		expect(calls).toHaveLength(2);
	});
});

describe('json', () => {
	it('signs the body so the receiver can check it', async () => {
		const { game, photo } = await world();
		await hook(game.id, { kind: 'json', url: 'https://example.com/hook', secret: 's3cret' });
		await deliver('photo.disqualified', photo);
		expect(calls).toHaveLength(1);
		const body = String(calls[0].body);
		const parsed = JSON.parse(body);
		expect(parsed).toMatchObject({ event: 'photo.disqualified', game: { code: game.code }, photo: { id: photo, team: 'Reds' } });
		const key = await crypto.subtle.importKey('raw', new TextEncoder().encode('s3cret'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
		const mac = [...new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body)))].map((b) => b.toString(16).padStart(2, '0')).join('');
		expect(calls[0].headers.get('x-photogame-signature')).toBe(`sha256=${mac}`);
		expect(calls[0].headers.get('x-photogame-event')).toBe('photo.disqualified');
	});
	it('sends a ping on test', async () => {
		const { game } = await world();
		const id = await hook(game.id, { kind: 'json', url: 'https://example.com/hook' });
		expect(await testWebhook(game.id, id)).toBe('Sent.');
		expect(JSON.parse(String(calls[0].body)).event).toBe('ping');
	});
});

describe('failures', () => {
	it('notes the failure on the webhook and does not throw', async () => {
		const { game, photo } = await world();
		const id = await hook(game.id);
		answers.push(new Response('no', { status: 500 }));
		await deliver('photo.added', photo);
		const row = await get<{ last_status: string }>('SELECT last_status FROM webhook WHERE id = ?', id);
		expect(row!.last_status).toContain('500');
		expect(await get("SELECT 1 AS x FROM event WHERE kind = 'webhook_failed'")).toBeTruthy();
	});
	it('skips paused webhooks and deleted photos', async () => {
		const { game, photo } = await world();
		await hook(game.id, { active: '0' });
		await deliver('photo.added', photo);
		await deliver('photo.added', 999999);
		expect(calls).toHaveLength(0);
	});
});
