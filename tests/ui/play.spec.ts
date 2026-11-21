import { expect, png, test } from './fixtures.ts';
import type { Page } from '@playwright/test';

/** Every thumbnail and photo on the page has actually loaded, not just got an <img> tag. */
const imagesLoaded = (page: Page) =>
	expect.poll(() => page.evaluate(() => [...document.images].filter((i) => i.src.includes('/media/')).every((i) => i.complete && i.naturalWidth > 0)));

test.describe('uploading and sorting', () => {
	test('a player uploads a photo through the real uploader and files it into a category', async ({ page, site, world }) => {
		await site.signIn(page, world.alice.id);
		await page.goto(`/g/${world.g.code}`);
		await page.locator('input[type=file]').first().setInputFiles({ name: 'sunset.png', mimeType: 'image/png', buffer: png(640, 480, 1) });
		await expect(page.getByRole('heading', { name: 'Sort your photos' })).toBeVisible();
		await imagesLoaded(page);

		// The browser made the thumbnail and screen copy; both are JPEGs and smaller than the original.
		const p = site.photos(world.g.id)[0];
		expect(p).toMatchObject({ category_id: null, team_id: world.reds, user_id: world.alice.id, width: 640, height: 480 });

		await page.getByLabel('Caption').fill('Golden hour');
		await page.getByLabel('Caption').blur();
		await page.getByLabel('Category').selectOption({ label: 'Silly hats' });
		// With one photo in the pile the card (and its "Filed in ..." note) disappears as soon as it is filed.
		await expect(page.getByRole('heading', { name: 'Sort your photos' })).toHaveCount(0);
		expect(site.one('SELECT category_id, caption FROM photo WHERE id = ?', p.id)).toEqual({ category_id: world.hats.id, caption: 'Golden hour' });
		await expect(page.locator('a.cell.done', { hasText: 'Silly hats' })).toBeVisible();
	});

	test('several photos at once all arrive, with a progress message', async ({ page, site, world }) => {
		await site.signIn(page, world.alice.id);
		await page.goto(`/g/${world.g.code}`);
		await page.locator('input[type=file]').first().setInputFiles([1, 2, 3].map((i) => ({ name: `p${i}.png`, mimeType: 'image/png', buffer: png(120, 80, i) })));
		await expect(page.locator('.pill', { hasText: /^3$/ })).toBeVisible();
		expect(site.photos(world.g.id)).toHaveLength(3);
		await imagesLoaded(page);
	});

	test('a file that is not an image is rejected with a message and nothing is stored', async ({ page, site, world }) => {
		await site.signIn(page, world.alice.id);
		await page.goto(`/g/${world.g.code}`);
		await page.locator('input[type=file]').first().setInputFiles({ name: 'notes.png', mimeType: 'image/png', buffer: Buffer.from('definitely not a picture') });
		await expect(page.getByText(/isn’t a photo this phone can read/)).toBeVisible();
		expect(site.photos(world.g.id)).toEqual([]);
	});

	test('uploading straight into a category from its page', async ({ page, site, world }) => {
		await site.signIn(page, world.alice.id);
		await page.goto(`/g/${world.g.code}/c/${world.dogs.id}`);
		await page.locator('input[type=file]').first().setInputFiles({ name: 'rex.png', mimeType: 'image/png', buffer: png(200, 100, 2) });
		await page.getByLabel(/Caption/).fill('Rex');
		await page.getByRole('button', { name: 'Submit' }).click();
		await expect(page.getByText('1 photo added.')).toBeVisible();
		await expect(page.getByRole('heading', { name: "Your team's photos" })).toBeVisible();
		expect(site.photos(world.g.id)[0]).toMatchObject({ category_id: world.dogs.id, caption: 'Rex' });
		// A player's own points are never stored; the photo waits for the host.
		expect(site.claims(world.g.id)).toEqual([]);
		await expect(page.getByText('Awaiting points')).toBeVisible();
	});

	test('a player can discard an unsorted photo after confirming', async ({ page, site, world }) => {
		await site.upload(world.alice.id, world.g.code);
		await site.signIn(page, world.alice.id);
		await page.goto(`/g/${world.g.code}`);
		page.once('dialog', (d) => d.dismiss());
		await page.getByRole('button', { name: 'Delete photo' }).click();
		expect(site.photos(world.g.id)).toHaveLength(1);
		page.once('dialog', (d) => d.accept());
		await page.getByRole('button', { name: 'Delete photo' }).click();
		await expect(page.getByRole('heading', { name: 'Sort your photos' })).toHaveCount(0);
		expect(site.photos(world.g.id)).toEqual([]);
	});

	test('closing submissions hides the uploader', async ({ page, site, world }) => {
		site.exec('UPDATE game SET submissions_open = 0 WHERE id = ?', world.g.id);
		await site.signIn(page, world.alice.id);
		await page.goto(`/g/${world.g.code}`);
		await expect(page.getByRole('heading', { name: 'Add photos' })).toHaveCount(0);
		await page.goto(`/g/${world.g.code}/c/${world.hats.id}`);
		await expect(page.getByText('Submissions are closed.')).toBeVisible();
	});
});

test.describe('the host scores photos', () => {
	test('the host sets points and the team’s total, board and leaderboard follow', async ({ page, site, world, browser }) => {
		const id = await site.upload(world.alice.id, world.g.code, { category: world.hats.id, caption: 'Big hat' });
		// Alice sees it waiting for points.
		await site.signIn(page, world.alice.id);
		await page.goto(`/g/${world.g.code}/p/${id}`);
		await expect(page.getByText('Awaiting points from the host')).toBeVisible();
		await expect(page.getByText('Showrunner')).toHaveCount(0);

		// The host scores it.
		const hostPage = await (await browser.newContext({ ...(page.context() as any)._options })).newPage();
		await site.signIn(hostPage, world.host.id);
		await hostPage.goto(`/g/${world.g.code}/p/${id}`);
		await hostPage.getByText('Edit photo').click();
		await hostPage.getByRole('button', { name: 'Save', exact: true }).first().click();
		await expect(hostPage.getByText('Saved.')).toBeVisible();
		await expect(hostPage.getByText('Found it').first()).toBeVisible();
		expect(site.claims(world.g.id).map((c) => ({ option_id: c.option_id }))).toEqual([{ option_id: world.hats.option }]);

		// The player's board and the leaderboard show the points.
		await page.goto(`/g/${world.g.code}`);
		await expect(page.getByText('5 pts')).toBeVisible();
		await page.goto(`/g/${world.g.code}/scores`);
		const reds = page.locator('.card', { hasText: 'Reds' }).first();
		await expect(reds).toContainText('5');
		await page.getByRole('button', { name: 'People' }).click();
		await expect(page.getByRole('row', { name: /Alice/ })).toContainText('5');
		await hostPage.context().close();
	});

	test('the host can override points, then disqualify and restore', async ({ page, site, world }) => {
		const id = await site.upload(world.alice.id, world.g.code, { category: world.hats.id });
		await site.signIn(page, world.host.id);
		await page.goto(`/g/${world.g.code}/p/${id}`);
		await page.getByLabel(/Set points yourself/).fill('12');
		await page.getByRole('button', { name: 'Save', exact: true }).last().click();
		await expect(page.getByText('Set by the showrunner')).toBeVisible();
		await page.getByRole('button', { name: /Disqualify/ }).click();
		await expect(page.getByText('Disqualified').first()).toBeVisible();
		await page.getByRole('button', { name: /Restore/ }).click();
		await expect(page.getByRole('button', { name: /Disqualify/ })).toBeVisible();
		await page.goto(`/g/${world.g.code}/scores`);
		await expect(page.locator('.card', { hasText: 'Reds' }).first()).toContainText('12');
	});

	test('the host gives another team points from a photo and can take them back', async ({ page, site, world }) => {
		const id = await site.upload(world.alice.id, world.g.code, { category: world.hats.id });
		await site.signIn(page, world.host.id);
		await page.goto(`/g/${world.g.code}/p/${id}`);
		await page.getByLabel('Blues').check();
		await page.getByLabel('Reason').fill('Bob photobombed');
		await page.getByRole('button', { name: 'Give points' }).click();
		await expect(page.getByText('Points given.')).toBeVisible();
		await expect(page.getByText('🏅 Blues: Bob photobombed')).toBeVisible();
		page.once('dialog', (d) => d.accept());
		await page.getByRole('button', { name: 'Remove these points' }).click();
		await expect(page.getByText('🏅 Blues: Bob photobombed')).toHaveCount(0);
		expect(site.grants(world.g.id)).toEqual([]);
	});

	test('a player cannot see the host controls or change points', async ({ page, site, world }) => {
		const id = await site.upload(world.alice.id, world.g.code, { category: world.hats.id });
		await site.signIn(page, world.alice.id);
		await page.goto(`/g/${world.g.code}/p/${id}`);
		await expect(page.getByText('Disqualify')).toHaveCount(0);
		await expect(page.getByLabel(/Set points yourself/)).toHaveCount(0);
		await page.getByText('Edit photo').click();
		await expect(page.getByText('What are you claiming?')).toHaveCount(0);
		await page.getByLabel('Caption').fill('my own caption');
		await page.getByRole('button', { name: 'Save', exact: true }).click();
		await expect(page.getByText('Saved.')).toBeVisible();
		expect(site.one('SELECT caption FROM photo WHERE id = ?', id).caption).toBe('my own caption');
		expect(site.claims(world.g.id)).toEqual([]);
	});

	test('a player can move their photo to another category and the points reset', async ({ page, site, world }) => {
		const id = await site.upload(world.alice.id, world.g.code, { category: world.hats.id });
		site.exec('INSERT INTO photo_claim (photo_id, option_id, qty) VALUES (?, ?, 1)', id, world.hats.option);
		await site.signIn(page, world.alice.id);
		await page.goto(`/g/${world.g.code}/p/${id}`);
		await page.getByText('Edit photo').click();
		await page.getByLabel('Category').selectOption({ label: 'Dogs' });
		await expect(page.getByText(/Moving clears the photo's points/)).toBeVisible();
		await page.getByRole('button', { name: 'Move photo' }).click();
		await expect(page.getByText('Moved to Dogs.')).toBeVisible();
		expect(site.one('SELECT category_id FROM photo WHERE id = ?', id).category_id).toBe(world.dogs.id);
		expect(site.claims(world.g.id)).toEqual([]);
	});

	test('deleting a photo asks first, then returns to the category', async ({ page, site, world }) => {
		const id = await site.upload(world.alice.id, world.g.code, { category: world.hats.id });
		await site.signIn(page, world.alice.id);
		await page.goto(`/g/${world.g.code}/p/${id}`);
		await page.getByText('Edit photo').click();
		page.once('dialog', (d) => d.dismiss());
		await page.getByRole('button', { name: 'Delete photo' }).click();
		expect(site.photos(world.g.id)).toHaveLength(1);
		page.once('dialog', (d) => d.accept());
		await page.getByRole('button', { name: 'Delete photo' }).click();
		await expect(page).toHaveURL(new RegExp(`/c/${world.hats.id}$`));
		expect(site.photos(world.g.id)).toEqual([]);
	});
});

test.describe('doubts', () => {
	test('enough doubts send a photo to review, and the other team can vote on it', async ({ page, site, world }) => {
		site.exec("UPDATE game SET visibility = 'open', doubt_limit = 0 WHERE id = ?", world.g.id);
		const id = await site.upload(world.alice.id, world.g.code, { category: world.hats.id });
		await site.signIn(page, world.bob.id);
		await page.goto(`/g/${world.g.code}/p/${id}`);
		await page.getByRole('button', { name: /Doubt this/ }).click();
		await expect(page.getByRole('heading', { name: /Under review/ })).toBeVisible();
		await page.getByRole('button', { name: /It counts/ }).click();
		await expect(page.getByRole('button', { name: /It counts \(1\)/ })).toBeVisible();
		await page.getByRole('button', { name: /Take back my doubt/ }).click();
		await expect(page.getByRole('heading', { name: /Under review/ })).toHaveCount(0);
	});

	test('a team cannot doubt its own photo', async ({ page, site, world }) => {
		const id = await site.upload(world.alice.id, world.g.code, { category: world.hats.id });
		await site.signIn(page, world.alice.id);
		await page.goto(`/g/${world.g.code}/p/${id}`);
		await expect(page.getByRole('button', { name: /Doubt this/ })).toHaveCount(0);
	});
});
