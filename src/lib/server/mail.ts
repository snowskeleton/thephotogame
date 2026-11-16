import { config } from './db.ts';

// Workers can't speak SMTP through nodemailer, so mail goes out over Resend's HTTP API.
// Without RESEND_API_KEY, messages are printed to the log instead (fine for development).

export const mailReady = () => !!config().RESEND_API_KEY;

export async function sendMail(to: string, subject: string, text: string) {
	const { RESEND_API_KEY, MAIL_FROM } = config();
	if (!RESEND_API_KEY) {
		console.log(`[mail not configured] to=${to} subject=${subject}\n${text}`);
		return;
	}
	const res = await fetch('https://api.resend.com/emails', {
		method: 'POST',
		headers: { authorization: `Bearer ${RESEND_API_KEY}`, 'content-type': 'application/json' },
		body: JSON.stringify({ from: MAIL_FROM || 'The Photo Game <photogame@example.com>', to, subject, text })
	});
	if (!res.ok) throw new Error(`Mail failed: ${res.status} ${await res.text()}`);
}
