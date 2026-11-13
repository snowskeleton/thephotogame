import { browserSupportsWebAuthn, startAuthentication } from '@simplewebauthn/browser';

/**
 * Tries to sign in with a passkey saved for this email.
 * 'none' = this person has no passkey (or the browser can't use one); 'failed' = they have one but it didn't work here.
 */
export async function passkeySignIn(email: string): Promise<'ok' | 'none' | 'failed'> {
	if (!browserSupportsWebAuthn()) return 'none';
	let options;
	try {
		const res = await fetch('/auth/passkey/login-options', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ email })
		});
		options = res.ok ? await res.json() : null;
	} catch {
		return 'none';
	}
	if (!options?.challenge) return 'none';
	try {
		const response = await startAuthentication({ optionsJSON: options });
		const res = await fetch('/auth/passkey/login-verify', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(response)
		});
		return res.ok ? 'ok' : 'failed';
	} catch {
		return 'failed';
	}
}
