import { error, json } from '@sveltejs/kit';
import {
	generateAuthenticationOptions,
	generateRegistrationOptions,
	verifyAuthenticationResponse,
	verifyRegistrationResponse
} from '@simplewebauthn/server';
import { isoBase64URL } from '@simplewebauthn/server/helpers';
import { all, get, now, run } from '#lib/server/db.ts';
import { cleanEmail, startSession } from '#lib/server/auth.ts';

const CH = 'pg_challenge';

export const POST = async ({ params, request, cookies, locals, url }) => {
	const rpID = url.hostname;
	const origin = url.origin;
	const remember = (challenge: string) =>
		cookies.set(CH, challenge, { path: '/', httpOnly: true, sameSite: 'strict', maxAge: 300 });
	const recall = () => {
		const c = cookies.get(CH);
		cookies.delete(CH, { path: '/' });
		if (!c) error(400, 'That took too long. Try again.');
		return c;
	};

	switch (params.step) {
		case 'register-options': {
			if (!locals.user) error(401, 'Sign in first');
			const existing = await all<{ id: string }>('SELECT id FROM passkey WHERE user_id = ?', locals.user.id);
			const options = await generateRegistrationOptions({
				rpName: 'The Photo Game',
				rpID,
				userName: locals.user.email,
				userDisplayName: locals.user.name,
				userID: new TextEncoder().encode(`user-${locals.user.id}`),
				attestationType: 'none',
				excludeCredentials: existing.map((p) => ({ id: p.id })),
				authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' }
			});
			remember(options.challenge);
			return json(options);
		}
		case 'register-verify': {
			if (!locals.user) error(401, 'Sign in first');
			const result = await verifyRegistrationResponse({
				response: await request.json(),
				expectedChallenge: recall(),
				expectedOrigin: origin,
				expectedRPID: rpID,
				requireUserVerification: false
			}).catch(() => null);
			if (!result?.verified || !result.registrationInfo) error(400, 'Could not save that passkey.');
			const c = result.registrationInfo.credential;
			await run(
				'INSERT OR REPLACE INTO passkey (id, user_id, public_key, counter, transports, created_at) VALUES (?, ?, ?, ?, ?, ?)',
				c.id,
				locals.user.id,
				isoBase64URL.fromBuffer(c.publicKey),
				c.counter,
				JSON.stringify(c.transports ?? []),
				now()
			);
			return json({ ok: true });
		}
		case 'login-options': {
			// Email first: only offer a passkey prompt when this person has one saved.
			const body = await request.json().catch(() => ({}));
			const email = cleanEmail(body?.email);
			const keys = email
				? await all<{ id: string; transports: string }>(
						'SELECT k.id, k.transports FROM passkey k JOIN user u ON u.id = k.user_id WHERE u.email = ?',
						email
					)
				: [];
			if (!keys.length) return json({ passkey: false });
			const options = await generateAuthenticationOptions({
				rpID,
				userVerification: 'preferred',
				allowCredentials: keys.map((k) => ({ id: k.id, transports: JSON.parse(k.transports || '[]') }))
			});
			remember(options.challenge);
			return json(options);
		}
		case 'login-verify': {
			const response = await request.json();
			const pk = await get<{ id: string; user_id: number; public_key: string; counter: number; transports: string }>(
				'SELECT * FROM passkey WHERE id = ?',
				String(response?.id ?? '')
			);
			if (!pk) error(400, 'This passkey isn’t linked to a player. Use an email code instead.');
			const result = await verifyAuthenticationResponse({
				response,
				expectedChallenge: recall(),
				expectedOrigin: origin,
				expectedRPID: rpID,
				requireUserVerification: false,
				credential: {
					id: pk.id,
					publicKey: isoBase64URL.toBuffer(pk.public_key),
					counter: pk.counter,
					transports: JSON.parse(pk.transports || '[]')
				}
			}).catch(() => null);
			if (!result?.verified) error(400, 'That passkey didn’t work. Use an email code instead.');
			await run('UPDATE passkey SET counter = ? WHERE id = ?', result.authenticationInfo.newCounter, pk.id);
			await startSession(cookies, pk.user_id);
			return json({ ok: true });
		}
	}
	error(404, 'Not found');
};
