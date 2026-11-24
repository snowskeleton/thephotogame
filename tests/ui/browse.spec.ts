import { expect, test, type World, type Site } from './fixtures.ts';

/** Four photos: Alice (Reds) hats x2, Alice dogs, Bob (Blues) hats. Oldest first, so ids rise with age. */
async function gallery(site: Site, world: World) {
	site.exec("UPDATE game SET visibility = 'open' WHERE id = ?", world.g.id);
	const a = await site.upload(world.alice.id, world.g.code, { category: world.hats.id, caption: 'A hat one', seed: 1 });
	const b = await site.upload(world.alice.id, world.g.code, { category: world.hats.id, caption: 'A hat two', seed: 2 });
	const c = await site.upload(world.alice.id, world.g.code, { category: world.dogs.id, caption: 'A dog', seed: 3 });
	const d = await site.upload(world.bob.id, world.g.code, { category: world.hats.id, caption: 'B hat', seed: 4 });
	return { a, b, c, d };
}
const thumbs = (page: import('@playwright/test').Page) => page.locator('a.ph');

test.describe('gallery', () => {
	test('shows every thumbnail, loaded, and filters by team, person and category through the URL', async ({ page, site, world }) => {
		await gallery(site, world);
		await site.signIn(page, world.alice.id);
		await page.goto(`/g/${world.g.code}/gallery`);
		await expect(thumbs(page)).toHaveCount(4);
		await expect.poll(() => page.evaluate(() => [...document.images].every((i) => i.complete && i.naturalWidth > 0))).toBe(true);

		await page.getByLabel('Team').selectOption({ label: 'Blues' });
		await expect(page).toHaveURL(new RegExp(`team=${world.blues}`));
		await expect(thumbs(page)).toHaveCount(1);

		await page.getByLabel('Team').selectOption({ label: 'All teams' });
		await page.getByLabel('Category').selectOption({ label: 'Dogs' });
		await expect(thumbs(page)).toHaveCount(1);
		await page.getByLabel('Person').selectOption({ label: 'Bob' });
		await expect(thumbs(page)).toHaveCount(0);
		await expect(page.getByText('No photos here yet.')).toBeVisible();
		await page.getByRole('link', { name: 'Clear filters' }).click();
		await expect(thumbs(page)).toHaveCount(4);
	});

	test('a photo opened from a filtered list steps through that list and goes back to it', async ({ page, site, world }) => {
		const ids = await gallery(site, world);
		await site.signIn(page, world.alice.id);
		await page.goto(`/g/${world.g.code}/gallery?team=${world.reds}`);
		await expect(thumbs(page)).toHaveCount(3);
		// Newest first: the dog, then hat two, then hat one.
		await thumbs(page).first().click();
		await expect(page).toHaveURL(new RegExp(`/p/${ids.c}\\?`));
		await expect(page.getByText('1 / 3')).toBeVisible();
		await expect(page.getByRole('link', { name: /Newer/ })).toHaveCount(0);
		await page.getByRole('link', { name: /Older/ }).click();
		await expect(page).toHaveURL(new RegExp(`/p/${ids.b}\\?`));
		await expect(page.getByText('2 / 3')).toBeVisible();
		await page.getByRole('link', { name: /Older/ }).click();
		await expect(page.getByText('3 / 3')).toBeVisible();
		await expect(page.getByRole('link', { name: /Older/ })).toHaveCount(0);
		await expect(page.getByText('A hat one').first()).toBeVisible();
		// Stepping replaces history, so one Back returns to the gallery, still filtered.
		await page.goBack();
		await expect(page).toHaveURL(new RegExp(`/gallery\\?team=${world.reds}`));
		await expect(thumbs(page)).toHaveCount(3);
	});

	test('stepping to the next photo refreshes the category and caption in the edit form', async ({ page, site, world }) => {
		const ids = await gallery(site, world);
		await site.signIn(page, world.alice.id);
		await page.goto(`/g/${world.g.code}/gallery?team=${world.reds}`);
		await thumbs(page).first().click();
		await expect(page).toHaveURL(new RegExp(`/p/${ids.c}\\?`));
		await page.waitForLoadState('networkidle');
		await page.getByText('Edit photo').click();
		await expect(page.locator('select[name=category]')).toHaveValue(String(world.dogs.id));
		await expect(page.locator('input[name=caption]')).toHaveValue('A dog');
		await page.getByRole('link', { name: /Older/ }).click();
		await expect(page).toHaveURL(new RegExp(`/p/${ids.b}\\?`));
		await page.getByText('Edit photo').click();
		await expect(page.locator('select[name=category]')).toHaveValue(String(world.hats.id));
		await expect(page.locator('input[name=caption]')).toHaveValue('A hat two');
	});

	test('the Back link on a photo returns to the same filtered list', async ({ page, site, world }) => {
		const ids = await gallery(site, world);
		await site.signIn(page, world.alice.id);
		await page.goto(`/g/${world.g.code}/gallery?cat=${world.hats.id}&team=${world.reds}`);
		await thumbs(page).first().click();
		await expect(page).toHaveURL(new RegExp(`/p/${ids.b}`));
		await page.getByRole('link', { name: /← Gallery/ }).click();
		await expect(page).toHaveURL(new RegExp(`cat=${world.hats.id}`));
		await expect(thumbs(page)).toHaveCount(2);
	});

	test('the Gallery tab remembers the last filters after visiting other screens', async ({ page, site, world }) => {
		await gallery(site, world);
		await site.signIn(page, world.alice.id);
		await page.goto(`/g/${world.g.code}/gallery?team=${world.blues}`);
		await expect(thumbs(page)).toHaveCount(1);
		await page.getByRole('link', { name: /Scores/ }).click();
		await expect(page.getByRole('heading', { name: 'Leaderboard' })).toBeVisible();
		await page.getByRole('link', { name: /Gallery/ }).click();
		await expect(page).toHaveURL(new RegExp(`team=${world.blues}`));
		await expect(thumbs(page)).toHaveCount(1);
		await page.getByRole('link', { name: 'Clear filters' }).click();
		await page.getByRole('link', { name: /Board/ }).click();
		await page.getByRole('link', { name: /Gallery/ }).click();
		await expect(page).toHaveURL(/\/gallery$/);
	});

	test('deleting from a filtered gallery returns to that gallery', async ({ page, site, world }) => {
		const ids = await gallery(site, world);
		await site.signIn(page, world.alice.id);
		await page.goto(`/g/${world.g.code}/gallery?team=${world.reds}`);
		await thumbs(page).first().click();
		await page.getByText('Edit photo').click();
		page.once('dialog', (d) => d.accept());
		await page.getByRole('button', { name: 'Delete photo' }).click();
		await expect(page).toHaveURL(new RegExp(`/gallery\\?team=${world.reds}`));
		await expect(thumbs(page)).toHaveCount(2);
		expect(site.one('SELECT 1 AS x FROM photo WHERE id = ?', ids.c)).toBeUndefined();
	});

	test('hosts see unscored photos flagged and can filter to them', async ({ page, site, world }) => {
		const ids = await gallery(site, world);
		site.exec('INSERT INTO photo_claim (photo_id, option_id, qty) VALUES (?, ?, 1)', ids.a, world.hats.option);
		await site.signIn(page, world.host.id);
		await page.goto(`/g/${world.g.code}/gallery`);
		await expect(page.getByText('⏳ unscored')).toHaveCount(3);
		await expect(page.getByText('✓ 5 pt')).toHaveCount(1);
		await page.getByLabel('Unscored only').check();
		await expect(page).toHaveURL(/unscored=1/);
		await expect(thumbs(page)).toHaveCount(3);
		// Players never see score state.
		await site.signIn(page, world.alice.id);
		await page.goto(`/g/${world.g.code}/gallery`);
		await expect(page.getByText('⏳ unscored')).toHaveCount(0);
		await expect(page.getByLabel('Unscored only')).toHaveCount(0);
	});

	test('the slideshow opens from the gallery and shows photos', async ({ page, site, world }) => {
		await gallery(site, world);
		await site.signIn(page, world.alice.id);
		await page.goto(`/g/${world.g.code}/gallery`);
		await page.getByRole('link', { name: /Slideshow/ }).click();
		await expect(page).toHaveURL(/\/show/);
		await expect.poll(() => page.evaluate(() => [...document.images].some((i) => i.complete && i.naturalWidth > 0))).toBe(true);
	});
});

test.describe('hidden until revealed', () => {
	test('the other team’s new photos are hidden, then appear after the host reveals them', async ({ page, site, world }) => {
		await site.upload(world.alice.id, world.g.code, { category: world.hats.id, caption: 'Secret hat' });
		await site.upload(world.bob.id, world.g.code, { category: world.hats.id, caption: 'Blue hat' });
		await site.signIn(page, world.bob.id);
		await page.goto(`/g/${world.g.code}/gallery`);
		await expect(thumbs(page)).toHaveCount(1);
		await expect(page.getByText(/1 photo from other teams is hidden/)).toBeVisible();

		const host = await page.context().browser()!.newContext();
		const hp = await host.newPage();
		await site.signIn(hp, world.host.id);
		await hp.goto(`/g/${world.g.code}/admin`);
		await hp.getByRole('button', { name: /Reveal everything so far/ }).click();
		await expect(hp.getByText(/Last reveal/)).toBeVisible();
		await host.close();

		await page.reload();
		await expect(thumbs(page)).toHaveCount(2);
		await expect(page.getByText(/hidden until the showrunner reveals/)).toHaveCount(0);
	});

	test('a hidden photo’s page and image are refused to the other team', async ({ page, site, world }) => {
		const id = await site.upload(world.alice.id, world.g.code, { category: world.hats.id });
		await site.signIn(page, world.bob.id);
		const r = await page.goto(`/g/${world.g.code}/p/${id}`);
		expect(r!.status()).toBe(403);
		const img = await page.request.get(`/media/${id}/thumb`);
		expect(img.status()).toBe(403);
	});
});
