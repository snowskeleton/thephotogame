import { createServer, type Server } from 'node:http';
import { createHmac } from 'node:crypto';
import { expect, test } from './fixtures.ts';

type Hit = { headers: Record<string, string | string[] | undefined>; raw: string; json: any };

/** A receiver on localhost that remembers what it was sent. The app allows plain http only for localhost. */
async function receiver() {
	const hits: Hit[] = [];
	const server: Server = createServer((req, res) => {
		let raw = '';
		req.on('data', (c) => (raw += c));
		req.on('end', () => {
			hits.push({ headers: req.headers, raw, json: JSON.parse(raw || 'null') });
			res.writeHead(200).end('ok');
		});
	});
	await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
	const port = (server.address() as { port: number }).port;
	return { hits, url: `http://127.0.0.1:${port}/hook`, close: () => new Promise((r) => server.close(r)) };
}

test('a host adds a webhook, tests it, and then hears about photos and disqualifications', async ({ page, site, world }) => {
	const rx = await receiver();
	site.exec("UPDATE game SET visibility = 'open' WHERE id = ?", world.g.id);
	await site.signIn(page, world.host.id);
	await page.goto(`/g/${world.g.code}/admin/webhooks`);
	await page.getByLabel('Name').first().fill('Script');
	await page.getByLabel('Sends to').selectOption('json');
	await page.getByLabel('Address').fill(rx.url);
	await page.getByLabel(/Signing secret/).fill('s3cret');
	await page.getByRole('button', { name: 'Add webhook' }).click();
	await expect(page.locator('.pill', { hasText: 'Signed JSON POST' })).toBeVisible();
	// The secret address and key are never printed back.
	await expect(page.locator('body')).not.toContainText('s3cret');

	await page.getByRole('button', { name: 'Send a test' }).click();
	await expect(page.getByText('Sent.')).toBeVisible();
	expect(rx.hits.map((h) => h.json.event)).toEqual(['ping']);

	const id = await site.upload(world.alice.id, world.g.code, { category: world.hats.id, caption: 'Wig <b>' });
	await expect.poll(() => rx.hits.length).toBe(2);
	expect(rx.hits[1].json).toMatchObject({ event: 'photo.added', game: { code: world.g.code }, photo: { id, team: 'Reds', photographer: 'Alice', caption: 'Wig <b>' } });
	const sig = `sha256=${createHmac('sha256', 's3cret').update(rx.hits[1].raw).digest('hex')}`;
	expect(rx.hits[1].headers['x-photogame-signature']).toBe(sig);

	await page.goto(`/g/${world.g.code}/p/${id}`);
	await page.getByRole('button', { name: /Disqualify/ }).click();
	await expect.poll(() => rx.hits.length).toBe(3);
	expect(rx.hits[2].json).toMatchObject({ event: 'photo.disqualified', photo: { id } });
	await rx.close();
});

test('webhook settings are for hosts only', async ({ page, site, world }) => {
	await site.signIn(page, world.alice.id);
	const res = await page.goto(`/g/${world.g.code}/admin/webhooks`);
	expect(res?.status()).toBe(403);
});
