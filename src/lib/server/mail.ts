import { config } from './db.ts';
import { settings } from './settings.ts';

// Workers can't speak SMTP through nodemailer, so mail goes out over Resend's HTTP API.
// Without RESEND_API_KEY, messages are printed to the Worker's log instead (fine for development,
// and how the owner gets their very first code if they haven't added the key yet).

/** Resend's shared test sender: it works without a verified domain, but only delivers to your own Resend account's email. */
export const TEST_SENDER = 'The Photo Game <onboarding@resend.dev>';

export const mailReady = () => !!config().RESEND_API_KEY;

/** The sender in use: the one set in Settings, else a MAIL_FROM variable, else Resend's test sender. */
export async function mailFrom(): Promise<string> {
	return (await settings()).mailFrom || config().MAIL_FROM || TEST_SENDER;
}

export async function sendMail(to: string, subject: string, text: string) {
	const { RESEND_API_KEY } = config();
	if (!RESEND_API_KEY) {
		console.log(`[mail not configured] to=${to} subject=${subject}\n${text}`);
		return;
	}
	const res = await fetch('https://api.resend.com/emails', {
		method: 'POST',
		headers: { authorization: `Bearer ${RESEND_API_KEY}`, 'content-type': 'application/json' },
		body: JSON.stringify({ from: await mailFrom(), to, subject, text })
	});
	if (!res.ok) {
		// Log the message too, so a site admin can still pass on a code or link from the Worker's logs.
		const why = `Mail failed: ${res.status} ${await res.text()}`;
		console.error(`[mail failed] to=${to} subject=${subject}\n${why}\n${text}`);
		throw new Error(why);
	}
}
