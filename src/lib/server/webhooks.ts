import { waitUntil } from 'cloudflare:workers';
import { all, config, get, insert, now, run } from './db.ts';
import type { Game } from './game.ts';
import { key as photoKey } from './images.ts';
import { logEvent } from './log.ts';
import { scoreGame } from './scoring.ts';
import { oneSuperlative, type Superlative } from './superlatives.ts';
import { plural, pts } from '../format.ts';

/**
 * Outgoing webhooks. A host adds one per place that should hear about a game (a chat room, a script). Each lists
 * the events it wants.
 *
 *   ember  posts to an Ember/Campfire room's bot API. A new photo is posted as the picture itself, which starts its
 *          thread, and every later event about that photo (scored, disqualified, ...) is a comment in that thread.
 *   json   POSTs the event as JSON, signed with HMAC-SHA256 when a secret is set. No threads.
 *
 * Deliveries run after the response (`waitUntil`) and one at a time, so a photo's picture always lands before the
 * comments about it. They never throw into the request, and a failure is only noted on the webhook.
 */
export const EVENTS = {
	'photo.added': 'A photo is uploaded',
	'photo.filed': 'A photo is put in a category',
	'photo.scored': 'A host sets or changes a photo’s points',
	'photo.disqualified': 'A photo is disqualified',
	'photo.restored': 'A disqualified or doubted photo is put back in play',
	'photo.review': 'Players doubt a photo enough to send it to review',
	'points.granted': 'A team is given extra points',
	'superlative.awarded': 'A host gives a superlative to a person, team or photo'
} as const;
export type EventName = keyof typeof EVENTS;
export const isEvent = (s: string): s is EventName => s in EVENTS;
export const KINDS = { ember: 'Ember or Campfire chat room', json: 'Signed JSON POST' } as const;
export type Kind = keyof typeof KINDS;

export type Hook = {
	id: number; game_id: number; name: string; kind: Kind; url: string; secret: string; events: string;
	active: number; hidden_ok: number; last_at: number | null; last_status: string | null; created_at: number;
};

const MAX_HOOKS = 10;
const TIMEOUT_MS = 8000;

// ---- setting them up

const localHost = (h: string) => h === 'localhost' || h === '127.0.0.1' || h === '[::1]';

/** The address to store, or why it can't be used. Ember addresses must be a room's bot address (`/rooms/<room>/<key>/messages`). */
export function cleanUrl(kind: Kind, raw: unknown): { url: string } | { error: string } {
	let u: URL;
	try {
		u = new URL(String(raw ?? '').trim());
	} catch {
		return { error: 'That isn’t a web address.' };
	}
	if (u.protocol !== 'https:' && !(u.protocol === 'http:' && localHost(u.hostname))) return { error: 'The address must start with https://.' };
	u.hash = '';
	if (kind === 'ember') {
		u.search = '';
		if (!/^\/rooms\/[^/]+\/[^/]+\/messages$/.test(u.pathname))
			return { error: 'An Ember address looks like https://your.chat/rooms/<room>/<bot key>/messages.' };
	}
	return { url: u.toString() };
}

/** The address with the secret parts hidden, for pages and API answers. */
export function maskUrl(raw: string): string {
	try {
		const u = new URL(raw);
		return `${u.origin}${u.pathname === '/' ? '' : '/…'}`;
	} catch {
		return '…';
	}
}

export type NewHook = { name: unknown; kind: unknown; url: unknown; secret?: unknown; events?: unknown; hiddenOk?: unknown; active?: unknown };

const eventList = (v: unknown): EventName[] => {
	const list = Array.isArray(v) ? v : String(v ?? '').split(',');
	return [...new Set(list.map((s) => String(s).trim()).filter(isEvent))];
};

/** Adds a webhook to a game. Returns the new id, or a message for the person who filled in the form. */
export async function addWebhook(gameId: number, h: NewHook): Promise<{ id: number } | { error: string }> {
	const name = String(h.name ?? '').trim().slice(0, 60);
	if (!name) return { error: 'Give the webhook a name.' };
	const kind: Kind = h.kind === 'json' ? 'json' : 'ember';
	const url = cleanUrl(kind, h.url);
	if ('error' in url) return url;
	const events = eventList(h.events ?? Object.keys(EVENTS));
	if (!events.length) return { error: 'Choose at least one event.' };
	const n = (await get<{ n: number }>('SELECT COUNT(*) AS n FROM webhook WHERE game_id = ?', gameId))!.n;
	if (n >= MAX_HOOKS) return { error: `A game can have ${MAX_HOOKS} webhooks.` };
	const id = await insert(
		'INSERT INTO webhook (game_id, name, kind, url, secret, events, active, hidden_ok, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
		gameId, name, kind, url.url, kind === 'json' ? String(h.secret ?? '').slice(0, 200) : '', events.join(','),
		h.active === false || h.active === '0' ? 0 : 1, h.hiddenOk === true || h.hiddenOk === '1' || h.hiddenOk === 'on' ? 1 : 0, now()
	);
	return { id };
}

/** Changes the parts of a webhook that are given. A blank url or secret keeps the old one (they are never shown). */
export async function updateWebhook(gameId: number, id: number, h: Partial<NewHook>): Promise<{ ok: true } | { error: string }> {
	const cur = await get<Hook>('SELECT * FROM webhook WHERE id = ? AND game_id = ?', id, gameId);
	if (!cur) return { error: 'No such webhook.' };
	const name = h.name === undefined ? cur.name : String(h.name).trim().slice(0, 60);
	if (!name) return { error: 'Give the webhook a name.' };
	let url = cur.url;
	if (h.url !== undefined && String(h.url).trim()) {
		const c = cleanUrl(cur.kind, h.url);
		if ('error' in c) return c;
		url = c.url;
	}
	const events = h.events === undefined ? eventList(cur.events) : eventList(h.events);
	if (!events.length) return { error: 'Choose at least one event.' };
	const secret = cur.kind === 'json' && h.secret !== undefined && String(h.secret) !== '' ? String(h.secret).slice(0, 200) : cur.secret;
	const on = (v: unknown, was: number) => (v === undefined ? was : v === true || v === '1' || v === 'on' || v === 1 ? 1 : 0);
	await run(
		'UPDATE webhook SET name = ?, url = ?, secret = ?, events = ?, active = ?, hidden_ok = ? WHERE id = ?',
		name, url, secret, events.join(','), on(h.active, cur.active), on(h.hiddenOk, cur.hidden_ok), id
	);
	return { ok: true };
}

export const listWebhooks = (gameId: number) => all<Hook>('SELECT * FROM webhook WHERE game_id = ? ORDER BY id', gameId);

/** What a page or the API may show of a webhook: never the address or the secret. */
export const publicHook = (h: Hook) => ({
	id: h.id, name: h.name, kind: h.kind, url: maskUrl(h.url), signed: !!h.secret, events: eventList(h.events), active: !!h.active,
	hidden_ok: !!h.hidden_ok, last_at: h.last_at, last_status: h.last_status
});

// ---- sending

type Photo = {
	id: number; game_id: number; team_id: number; status: string; caption: string; ext: string; created_at: number;
	category_id: number | null; category: string | null; who: string; team: string; points_override: number | null;
};
type Extra = { doubts?: number; grantId?: number; teamId?: number; superlativeId?: number };
type Say = { text: string; data: Record<string, unknown> };

let origin = '';
/** The site's own address, remembered from requests so messages can link back to the photo. */
export const rememberOrigin = (o: string) => void (origin = o);

// One delivery at a time per Worker instance keeps a photo's picture ahead of the comments about it.
let queue: Promise<unknown> = Promise.resolve();

/** Tells a photo's game's webhooks about an event, after the response is sent. Pass photoId null for a grant with no photo. */
export function announce(event: EventName, photoId: number | null, extra: Extra = {}, gameId?: number) {
	const job = queue.then(() => deliver(event, photoId, extra, gameId)).catch((e) => console.error('[webhook]', e));
	queue = job;
	try {
		waitUntil(job);
	} catch {
		// no request to hang the work on (a test): it still runs
	}
}

const PHOTO_SQL = `SELECT p.id, p.game_id, p.team_id, p.status, p.caption, p.ext, p.created_at, p.category_id, p.points_override,
		c.name AS category, u.name AS who, t.name AS team
	FROM photo p JOIN user u ON u.id = p.user_id JOIN team t ON t.id = p.team_id LEFT JOIN category c ON c.id = p.category_id
	WHERE p.id = ?`;

/** Runs one delivery and waits for it. `announce` is what the app calls. */
export async function deliver(event: EventName, photoId: number | null, extra: Extra = {}, gameId?: number) {
	const photo = photoId == null ? undefined : await get<Photo>(PHOTO_SQL, photoId);
	const gid = photo?.game_id ?? gameId;
	if (gid == null || (photoId != null && !photo)) return;
	const hooks = (await all<Hook>('SELECT * FROM webhook WHERE game_id = ? AND active = 1', gid)).filter((h) => h.events.split(',').includes(event));
	if (!hooks.length) return;
	const game = (await get<Game>('SELECT * FROM game WHERE id = ?', gid))!;
	const scores = event === 'photo.added' || event === 'photo.filed' || event === 'photo.review' ? null : await scoreGame(game);
	// A hidden game keeps other teams' photos secret until a reveal, so a webhook only sees them if its host said so.
	const secret = !!photo && game.visibility === 'hidden' && photo.created_at > game.revealed_at;
	const grant = extra.grantId
		? await get<{ title: string; note: string; points: number; team_id: number; team: string }>(
				'SELECT g.title, g.note, g.points, g.team_id, t.name AS team FROM grant_award g JOIN team t ON t.id = g.team_id WHERE g.id = ?',
				extra.grantId
			)
		: undefined;
	if (event === 'points.granted' && !grant) return;
	const sup = extra.superlativeId ? await oneSuperlative(extra.superlativeId) : undefined;
	if (event === 'superlative.awarded' && !sup) return;
	const teamTotal = (id: number) => scores?.teams.find((t) => t.id === id)?.total ?? null;
	const photoUrl = photo && origin ? `${origin}/g/${game.code}/p/${photo.id}` : null;

	for (const h of hooks) {
		if (secret && !h.hidden_ok) continue;
		try {
			const post = photo ? await get<{ root_id: string; points: number | null }>('SELECT root_id, points FROM webhook_post WHERE webhook_id = ? AND photo_id = ?', h.id, photo.id) : undefined;
			const claimed = photo ? scores?.photoScores.get(photo.id) : undefined;
			const say = describe(event, { game, photo, photoUrl, grant, sup, extra, claimed, prev: post?.points ?? null, total: teamTotal(photo?.team_id ?? grant?.team_id ?? -1) });
			if (!say) continue;
			const status = h.kind === 'json' ? await sendJson(h, event, game, photo, say) : await sendEmber(h, event, photo, say, post?.root_id ?? '');
			if (event === 'photo.scored' && photo && claimed) await rememberPoints(h.id, photo.id, claimed.claimed);
			if (event === 'photo.filed' && photo) await rememberPoints(h.id, photo.id, null);
			await note(h.id, status);
		} catch (e) {
			const why = e instanceof Error ? e.message : String(e);
			await note(h.id, `failed: ${why}`.slice(0, 200));
			await logEvent('warn', 'webhook_failed', `${h.kind} webhook ${h.id} (${event}): ${why}`, { detail: { game: game.id, webhook: h.id, event } });
		}
	}
}

const note = (id: number, status: string) => run('UPDATE webhook SET last_at = ?, last_status = ? WHERE id = ?', now(), status, id);
const rememberPoints = (hookId: number, photoId: number, points: number | null) =>
	run(
		`INSERT INTO webhook_post (webhook_id, photo_id, points) VALUES (?, ?, ?)
		 ON CONFLICT(webhook_id, photo_id) DO UPDATE SET points = excluded.points`,
		hookId, photoId, points
	);

type Ctx = {
	game: Game; photo?: Photo; photoUrl: string | null; grant?: { title: string; note: string; points: number; team: string }; sup?: Superlative;
	extra: Extra; claimed?: { claimed: number; points: number; counted: boolean; pending: boolean }; prev: number | null; total: number | null;
};

/** The words and the facts for one event, or null when there is nothing worth saying. */
function describe(event: EventName, c: Ctx): Say | null {
	const p = c.photo;
	const where = p?.category ?? null;
	const total = c.total == null ? '' : ` ${p?.team ?? c.grant?.team} now has ${pts(c.total)}.`;
	const data: Record<string, unknown> = { team_total: c.total };
	let text: string;
	switch (event) {
		case 'photo.added':
			text = `New photo from ${p!.who} (${p!.team})${where ? ` in ${where}` : ', not filed yet'}${p!.caption ? `: “${p!.caption}”` : ''}.`;
			break;
		case 'photo.filed':
			text = `Filed under ${where}.`;
			break;
		case 'photo.scored': {
			const s = c.claimed;
			if (!s || (s.pending && c.prev == null)) return null;
			if (c.prev != null && c.prev === s.claimed && !s.pending) return null;
			data.points = s.claimed;
			data.previous_points = c.prev;
			data.counted = s.counted;
			if (s.pending) text = `Points cleared, so this photo is waiting for a score again.${total}`;
			else {
				const was = c.prev == null ? '' : ` (was ${pts(c.prev)})`;
				text = `Scored ${plural(s.claimed, 'point')}${was}${s.counted ? '' : ', but it doesn’t count toward the team (category limit or a better photo already fills it)'}.${total}`;
			}
			break;
		}
		case 'photo.disqualified':
			text = `Disqualified, so its points no longer count.${total}`;
			break;
		case 'photo.restored':
			text = `Back in play.${total}`;
			break;
		case 'photo.review':
			text = `${plural(c.extra.doubts ?? 0, 'player')} doubt${c.extra.doubts === 1 ? 's' : ''} this photo, so the host will review it.`;
			data.doubts = c.extra.doubts ?? 0;
			break;
		case 'superlative.awarded': {
			const s = c.sup!;
			data.title = s.title;
			data.kind = s.kind;
			data.recipient = s.who;
			data.note = s.note;
			const to = s.kind === 'photo' ? `this photo (${s.who}, ${s.team})` : s.kind === 'team' ? `team ${s.who}` : `${s.who}${s.team ? ` (${s.team})` : ''}`;
			text = `🏆 Superlative “${s.title}” goes to ${to}${s.note ? `: ${s.note}` : ''}.`;
			break;
		}
		case 'points.granted': {
			const g = c.grant!;
			data.points = g.points;
			data.title = g.title;
			data.note = g.note;
			data.team = g.team;
			text = `${g.team} gets ${g.points >= 0 ? '+' : ''}${pts(g.points)} for “${g.title}”${g.note ? ` (${g.note})` : ''}.${total}`;
			break;
		}
	}
	if (c.photoUrl && event !== 'photo.restored' && event !== 'photo.scored' && event !== 'photo.disqualified' && event !== 'photo.filed') text += ` ${c.photoUrl}`;
	return { text, data };
}

const escapeHtml = (s: string) => s.replace(/[&<>]/g, (ch) => (ch === '&' ? '&amp;' : ch === '<' ? '&lt;' : '&gt;'));

async function post(url: string, init: RequestInit): Promise<Response> {
	return fetch(url, { ...init, redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS) });
}

const inThread = (url: string, root: string) => `${url}?thread=${encodeURIComponent(root)}`;
const messageId = (res: Response) => res.headers.get('location')?.match(/@([^/?#]+)$/)?.[1] ?? '';

/** Posts the photo as the picture of its own message and returns that message's id. Falls back to words if the file is gone. */
async function postRoot(h: Hook, photo: Photo, text: string): Promise<string> {
	const file = await config().PHOTOS.get(photoKey(photo.id, 'large', photo.ext));
	let res: Response;
	if (file) {
		const form = new FormData();
		form.append('attachment', new Blob([await file.arrayBuffer()], { type: 'image/jpeg' }), `photo-${photo.id}.jpg`);
		res = await post(h.url, { method: 'POST', body: form });
	} else res = await post(h.url, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: escapeHtml(text) });
	if (res.status !== 201) throw new Error(`room answered ${res.status} to the photo`);
	const id = messageId(res);
	if (!id) throw new Error('room gave no message id for the photo');
	await run(
		`INSERT INTO webhook_post (webhook_id, photo_id, root_id) VALUES (?, ?, ?)
		 ON CONFLICT(webhook_id, photo_id) DO UPDATE SET root_id = excluded.root_id`,
		h.id, photo.id, id
	);
	return id;
}

async function sendEmber(h: Hook, event: EventName, photo: Photo | undefined, say: Say, root: string): Promise<string> {
	const body = (text: string) => ({ method: 'POST', headers: { 'content-type': 'text/plain' }, body: escapeHtml(text) });
	if (!photo) {
		const res = await post(h.url, body(say.text));
		if (res.status !== 201) throw new Error(`room answered ${res.status}`);
		return '201';
	}
	if (event === 'photo.added' && root) return 'skipped: photo already posted';
	root ||= await postRoot(h, photo, say.text);
	if (event === 'photo.added') {
		// The picture is the message, so the who/where/caption line is the first comment under it.
		const res = await post(inThread(h.url, root), body(say.text));
		if (res.status !== 201) throw new Error(`room answered ${res.status} to the comment`);
		return '201';
	}
	let res = await post(inThread(h.url, root), body(say.text));
	if (res.status === 404) {
		// The photo's message was deleted in the chat: start over with a fresh picture.
		await run('DELETE FROM webhook_post WHERE webhook_id = ? AND photo_id = ? AND root_id = ?', h.id, photo.id, root);
		root = await postRoot(h, photo, say.text);
		res = await post(inThread(h.url, root), body(say.text));
	}
	if (res.status !== 201) throw new Error(`room answered ${res.status} to the comment`);
	return '201';
}

async function sign(secret: string, body: string): Promise<string> {
	const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
	const mac = new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(body)));
	return [...mac].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function sendJson(h: Hook, event: string, game: Game, photo: Photo | undefined, say: Say): Promise<string> {
	const body = JSON.stringify({
		event,
		at: new Date().toISOString(),
		game: { code: game.code, name: game.name },
		photo: photo
			? {
					id: photo.id, caption: photo.caption, status: photo.status, category: photo.category, team: photo.team, photographer: photo.who,
					url: origin ? `${origin}/g/${game.code}/p/${photo.id}` : null
				}
			: null,
		message: say.text,
		...say.data
	});
	const headers: Record<string, string> = { 'content-type': 'application/json', 'x-photogame-event': event };
	if (h.secret) headers['x-photogame-signature'] = `sha256=${await sign(h.secret, body)}`;
	const res = await post(h.url, { method: 'POST', headers, body });
	if (!res.ok) throw new Error(`receiver answered ${res.status}`);
	return String(res.status);
}

/** Sends a one-line test to a webhook so a host can see it arrive. Returns what happened. */
export async function testWebhook(gameId: number, id: number): Promise<string> {
	const h = await get<Hook>('SELECT * FROM webhook WHERE id = ? AND game_id = ?', id, gameId);
	if (!h) return 'No such webhook.';
	const game = (await get<Game>('SELECT * FROM game WHERE id = ?', gameId))!;
	const say = { text: `Test from The Photo Game: this webhook is connected to “${game.name}”.`, data: {} };
	try {
		const status = h.kind === 'json' ? await sendJson(h, 'ping', game, undefined, say) : await sendEmber(h, 'photo.added', undefined, say, '');
		await note(h.id, status);
		return 'Sent.';
	} catch (e) {
		const why = e instanceof Error ? e.message : String(e);
		await note(h.id, `failed: ${why}`.slice(0, 200));
		return `Failed: ${why}`;
	}
}
