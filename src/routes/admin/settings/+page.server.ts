import { fail } from '@sveltejs/kit';
import { config } from '#lib/server/db.ts';
import { requireAdmin } from '#lib/server/game.ts';
import { mailReady, sendMail } from '#lib/server/mail.ts';
import { saveSettings, settings } from '#lib/server/settings.ts';
import { turnstileKey } from '#lib/server/turnstile.ts';

export const load = async ({ locals }) => {
	requireAdmin(locals);
	const env = config();
	return {
		settings: await settings(),
		mailReady: mailReady(),
		mailFrom: env.MAIL_FROM || '',
		mailFromPlaceholder: !env.MAIL_FROM || /@example\.com>?$/.test(env.MAIL_FROM),
		turnstile: !!turnstileKey(),
		adminEmail: env.ADMIN_EMAIL || ''
	};
};

const whole = (v: FormDataEntryValue | null) => Math.max(0, Math.floor(Number(v) || 0));

export const actions = {
	save: async ({ request, locals }) => {
		requireAdmin(locals);
		const f = await request.formData();
		await saveSettings({ signups: !!f.get('signups'), maxGames: whole(f.get('max_games')), maxPhotos: whole(f.get('max_photos')) });
		return { saved: true };
	},
	testMail: async ({ locals, url }) => {
		const me = requireAdmin(locals);
		try {
			await sendMail(me.email, 'Photo Game test email', `Email from ${url.origin} is working.`);
		} catch (e) {
			return fail(500, { mailError: String((e as Error).message).slice(0, 300) });
		}
		return { mailSent: true };
	}
};
