import { fail } from '@sveltejs/kit';
import { run } from '#lib/server/db.ts';
import { requireHost } from '#lib/server/game.ts';
import { addWebhook, EVENTS, KINDS, listWebhooks, publicHook, testWebhook, updateWebhook } from '#lib/server/webhooks.ts';

export const load = async ({ params, locals }) => {
	const game = await requireHost(locals, params.code);
	return { hooks: (await listWebhooks(game.id)).map(publicHook), events: EVENTS, kinds: KINDS };
};

const fields = (f: FormData) => ({
	name: f.get('name'),
	kind: f.get('kind'),
	url: f.get('url'),
	secret: f.get('secret'),
	events: f.getAll('events').map(String),
	hiddenOk: f.get('hidden_ok') ? '1' : '0',
	active: f.get('active') ? '1' : '0'
});

export const actions = {
	add: async ({ request, params, locals }) => {
		const game = await requireHost(locals, params.code);
		const r = await addWebhook(game.id, { ...fields(await request.formData()), active: '1' });
		if ('error' in r) return fail(400, { error: r.error });
		return { added: r.id };
	},
	save: async ({ request, params, locals }) => {
		const game = await requireHost(locals, params.code);
		const f = await request.formData();
		const id = Number(f.get('id'));
		const r = await updateWebhook(game.id, id, fields(f));
		if ('error' in r) return fail(400, { error: r.error, id });
		return { saved: id };
	},
	test: async ({ request, params, locals }) => {
		const game = await requireHost(locals, params.code);
		const id = Number((await request.formData()).get('id'));
		const result = await testWebhook(game.id, id);
		return { tested: id, result };
	},
	delete: async ({ request, params, locals }) => {
		const game = await requireHost(locals, params.code);
		const id = Number((await request.formData()).get('id'));
		await run('DELETE FROM webhook WHERE id = ? AND game_id = ?', id, game.id);
	}
};
