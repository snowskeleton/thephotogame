import { config } from './db.ts';
import { logEvent } from './log.ts';

// Cloudflare Turnstile guards the forms that create accounts. It's off until both TURNSTILE_SITE_KEY
// (a var) and TURNSTILE_SECRET (a secret) are set, so development needs nothing.

export const turnstileKey = () => (config().TURNSTILE_SECRET && config().TURNSTILE_SITE_KEY) || '';

export async function humanCheck(f: FormData, ip: string | null): Promise<boolean> {
	const secret = config().TURNSTILE_SECRET;
	if (!secret || !config().TURNSTILE_SITE_KEY) return true;
	const body = new FormData();
	body.set('secret', secret);
	body.set('response', String(f.get('cf-turnstile-response') ?? ''));
	if (ip) body.set('remoteip', ip);
	const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body });
	const out = (await res.json()) as { success?: boolean; 'error-codes'?: string[] };
	if (!out.success)
		// An empty token means the form was sent before the check finished (or the widget never loaded).
		await logEvent('warn', 'turnstile_failed', 'Bot check failed on a sign-up form', {
			detail: { tokenEmpty: !f.get('cf-turnstile-response'), codes: out['error-codes'] ?? [] }
		});
	return !!out.success;
}

export const NOT_HUMAN = 'Please complete the check that you’re a person, then try again.';
