import { expect, test } from './fixtures.ts';

// Cancelling a confirm() must stop the action. These forms are progressively enhanced, so the cancel has to
// happen in the enhance callback; a plain onsubmit handler runs too late and the request goes out anyway.
test.describe('cancelling a confirmation does nothing', () => {
	test('discarding an unsorted photo', async ({ page, site, world }) => {
		await site.upload(world.alice.id, world.g.code);
		await site.signIn(page, world.alice.id);
		await page.goto(`/g/${world.g.code}`);
		page.once('dialog', (d) => d.dismiss());
		await page.getByRole('button', { name: 'Delete photo' }).click();
		await page.waitForTimeout(1000);
		expect(site.photos(world.g.id)).toHaveLength(1);
		await expect(page.getByRole('heading', { name: 'Sort your photos' })).toBeVisible();
	});

	test('removing another team’s points from a photo', async ({ page, site, world }) => {
		const id = await site.upload(world.alice.id, world.g.code, { category: world.hats.id });
		const grant = site.exec("INSERT INTO grant_award (game_id, team_id, title, points, created_at) VALUES (?, ?, 'Bob in shot', 2, ?)", world.g.id, world.blues, Date.now());
		site.exec('INSERT INTO grant_photo (grant_id, photo_id) VALUES (?, ?)', grant, id);
		await site.signIn(page, world.host.id);
		await page.goto(`/g/${world.g.code}/p/${id}`);
		page.once('dialog', (d) => d.dismiss());
		await page.getByRole('button', { name: 'Remove these points' }).click();
		await page.waitForTimeout(1000);
		expect(site.grants(world.g.id)).toHaveLength(1);
	});

	test('a site admin signing someone out everywhere', async ({ page, site, world }) => {
		const admin = site.user({ name: 'Boss', admin: true });
		site.session(world.alice.id);
		await site.signIn(page, admin.id);
		await page.goto(`/admin/users/${world.alice.id}`);
		const before = site.all('SELECT * FROM session WHERE user_id = ?', world.alice.id).length;
		page.once('dialog', (d) => d.dismiss());
		await page.getByRole('button', { name: /Sign out/ }).click();
		await page.waitForTimeout(1000);
		expect(site.all('SELECT * FROM session WHERE user_id = ?', world.alice.id)).toHaveLength(before);
	});
});

test('a caption typed just before picking a category is kept', async ({ page, site, world }) => {
	const id = await site.upload(world.alice.id, world.g.code);
	await site.signIn(page, world.alice.id);
	await page.goto(`/g/${world.g.code}`);
	await page.getByLabel('Caption').fill('Golden hour');
	// Pick the category as soon as the caption save returns: the form must not have been wiped by it.
	const saved = page.waitForResponse((r) => r.url().includes('?/file'));
	await page.getByLabel('Caption').blur();
	await saved;
	await page.getByLabel('Category').selectOption({ label: 'Silly hats' });
	await expect.poll(() => site.one('SELECT category_id FROM photo WHERE id = ?', id).category_id).toBe(world.hats.id);
	expect(site.one('SELECT caption FROM photo WHERE id = ?', id).caption).toBe('Golden hour');
});
