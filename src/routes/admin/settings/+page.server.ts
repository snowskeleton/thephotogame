import { fail } from '@sveltejs/kit';
import { requireAdmin } from '#lib/server/game.ts';
import { mailFrom, mailReady, sendMail, TEST_SENDER } from '#lib/server/mail.ts';
import { saveSettings, settings } from '#lib/server/settings.ts';
import { turnstileKey } from '#lib/server/turnstile.ts';

export const load = async ({ locals }) => {
	requireAdmin(locals);
	const s = await settings();
	const from = await mailFrom();
	return {
		settings: s,
		mailReady: mailReady(),
		mailFrom: from,
		testSender: from === TEST_SENDER,
		turnstile: !!turnstileKey()
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
	sender: async ({ request, locals }) => {
		requireAdmin(locals);
		const v = String((await request.formData()).get('from') ?? '').trim().slice(0, 200);
		// "photos@yourdomain.com" or "The Photo Game <photos@yourdomain.com>"; empty goes back to the test sender.
		if (v && !/^([^<>@]+<)?[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+>?$/.test(v))
			return fail(400, { senderError: 'That doesn’t look like an email address.' });
		await saveSettings({ mailFrom: v });
		return { senderSaved: true };
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
