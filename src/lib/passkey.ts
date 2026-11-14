import { browserSupportsWebAuthn, startAuthentication, startRegistration } from '@simplewebauthn/browser';

const post = (url: string, body: unknown, signal?: AbortSignal) =>
	fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal });

export const passkeysSupported = () => browserSupportsWebAuthn();

/**
 * Tries to sign in with a passkey saved for this email.
 * 'none' = this person has no passkey (or the browser can't use one); 'failed' = they have one but it didn't work here.
 */
export async function passkeySignIn(email: string): Promise<'ok' | 'none' | 'failed'> {
	if (!email || !browserSupportsWebAuthn()) return 'none';
	let options;
	try {
		// Don't leave someone stuck on a slow connection: after a few seconds, fall back to an email code.
		const res = await post('/auth/passkey/login-options', { email }, AbortSignal.timeout(5000));
		options = res.ok ? await res.json() : null;
	} catch {
		return 'none';
	}
	if (!options?.challenge) return 'none';
	try {
		const response = await startAuthentication({ optionsJSON: options });
		return (await post('/auth/passkey/login-verify', response)).ok ? 'ok' : 'failed';
	} catch {
		return 'failed';
	}
}

/** Saves a passkey for the signed-in person. 'exists' = this device already has one for them. */
export async function passkeySave(): Promise<'ok' | 'exists' | 'cancelled' | 'failed'> {
	try {
		const options = await (await post('/auth/passkey/register-options', {})).json();
		const response = await startRegistration({ optionsJSON: options });
		return (await post('/auth/passkey/register-verify', response)).ok ? 'ok' : 'failed';
	} catch (e: any) {
		if (e?.name === 'InvalidStateError') return 'exists';
		if (e?.name === 'NotAllowedError' || e?.name === 'AbortError') return 'cancelled';
		return 'failed';
	}
}
