import { json } from '@sveltejs/kit';
import { clientErrorRoom, logEvent } from '#lib/server/log.ts';

// Browsers report their own JavaScript errors here (see +layout.svelte), so trouble on someone's phone shows up in the
// admin log. Anyone can post, so it's tiny, rate-limited, and never stores more than a short note.
export const POST = async ({ request, locals }) => {
	const text = (await request.text()).slice(0, 4000);
	let b: Record<string, unknown> = {};
	try {
		b = JSON.parse(text);
	} catch {}
	if (await clientErrorRoom())
		await logEvent('warn', 'client_error', String(b.message ?? 'unknown').slice(0, 300), {
			request,
			path: String(b.page ?? '').slice(0, 200) || undefined,
			userId: locals.user?.id,
			detail: { source: String(b.source ?? '').slice(0, 200), line: b.line, col: b.col, stack: String(b.stack ?? '').slice(0, 800) }
		});
	return json({ ok: true });
};
