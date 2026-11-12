import nodemailer from 'nodemailer';

const host = process.env.SMTP_HOST;
const transport = host
	? nodemailer.createTransport({
			host,
			port: Number(process.env.SMTP_PORT || 587),
			secure: process.env.SMTP_SECURE === 'true' || process.env.SMTP_PORT === '465',
			auth: process.env.SMTP_USER
				? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS || '' }
				: undefined
		})
	: null;

export async function sendMail(to: string, subject: string, text: string) {
	if (!transport) {
		console.log(`[mail not configured] to=${to} subject=${subject}\n${text}`);
		return;
	}
	await transport.sendMail({
		from: process.env.SMTP_FROM || 'The Photo Game <photogame@localhost>',
		to,
		subject,
		text
	});
}
