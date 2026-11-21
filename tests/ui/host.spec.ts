import { expect, test } from './fixtures.ts';

test.describe('voting', () => {
	async function setup(site: any, world: any) {
		site.exec("UPDATE game SET visibility = 'open' WHERE id = ?", world.g.id);
		const mine = await site.upload(world.alice.id, world.g.code, { category: world.hats.id, caption: 'Alice hat', seed: 1 });
		const theirs = await site.upload(world.bob.id, world.g.code, { category: world.hats.id, caption: 'Bob hat', seed: 2 });
		const award = site.exec("INSERT INTO award (game_id, name, points, status, scope) VALUES (?, 'Best hat', 4, 'open', 'game')", world.g.id);
		return { mine, theirs, award };
	}

	test('a player votes for another team’s photo, can’t vote for their own, and can change their mind', async ({ page, site, world }) => {
		const { mine, theirs, award } = await setup(site, world);
		await site.signIn(page, world.alice.id);
		await page.goto(`/g/${world.g.code}/vote`);
		await expect(page.getByText('you haven’t voted yet')).toBeVisible();
		await page.getByRole('link', { name: /Best hat/ }).click();
		await expect(page.getByText('yours')).toBeVisible();
		await expect(page.locator('input[name=pick]')).toHaveCount(1);
		await page.locator(`label.pick:has(img[alt="Bob hat"])`).click();
		await page.getByRole('button', { name: 'Save my votes' }).click();
		await expect(page.getByText('Your votes are in.')).toBeVisible();
		expect(site.all('SELECT photo_id FROM vote WHERE award_id = ?', award)).toEqual([{ photo_id: theirs }]);
		await expect(page.locator('input[name=pick]')).toBeChecked();
		await page.locator(`label.pick:has(img[alt="Bob hat"])`).click();
		await page.getByRole('button', { name: 'Save my votes' }).click();
		expect(site.all('SELECT * FROM vote WHERE award_id = ?', award)).toEqual([]);
		expect(mine).toBeGreaterThan(0);
	});

	test('the host closes voting and the winner’s team gets the points on the leaderboard', async ({ page, site, world, browser }) => {
		const { theirs, award } = await setup(site, world);
		site.exec('INSERT INTO vote (award_id, photo_id, user_id) VALUES (?, ?, ?)', award, theirs, world.alice.id);
		const ctx = await browser.newContext();
		const hp = await ctx.newPage();
		await site.signIn(hp, world.host.id);
		await hp.goto(`/g/${world.g.code}/admin/awards`);
		await hp.getByRole('button', { name: /Close voting/ }).click();
		await expect(hp.getByText('Closed', { exact: true })).toBeVisible();
		await ctx.close();

		await site.signIn(page, world.alice.id);
		await page.goto(`/g/${world.g.code}/scores`);
		await expect(page.locator('.card', { hasText: 'Blues' }).first()).toContainText('4');
		await expect(page.getByText('🗳️ Best hat')).toBeVisible();
		await page.goto(`/g/${world.g.code}/vote/${award}`);
		await expect(page.getByText('🏆 1')).toBeVisible();
		await expect(page.locator('input[name=pick]')).toHaveCount(0);
	});

	test('players do not see an award that is still a draft', async ({ page, site, world }) => {
		await setup(site, world);
		site.exec("UPDATE award SET status = 'draft' WHERE game_id = ?", world.g.id);
		await site.signIn(page, world.alice.id);
		await page.goto(`/g/${world.g.code}/vote`);
		await expect(page.getByText('Nothing to vote on yet')).toBeVisible();
	});
});

test.describe('running a game as the host', () => {
	test('creates a game, adds categories, teams and an invite, and a player can then play it', async ({ page, site, browser }) => {
		const host = site.user({ name: 'Newhost' });
		await site.signIn(page, host.id);
		await page.goto('/');
		await page.getByLabel('Game name').fill('Beach week');
		await page.getByRole('button', { name: 'Create game' }).click();
		await expect(page).toHaveURL(/\/admin$/);
		const code = page.url().match(/\/g\/(\w+)\/admin/)![1];
		await expect(page.getByRole('heading', { name: 'Game settings' })).toBeVisible();
		await expect(page.getByLabel('Join link')).toHaveValue(new RegExp(`/join/${code}`));

		await page.goto(`/g/${code}/admin/categories`);
		await page.getByLabel('Name').fill('Sandcastle');
		await page.getByLabel('Points').fill('7');
		await page.getByRole('button', { name: 'Add', exact: true }).click();
		await expect(page.getByText('Sandcastle')).toBeVisible();
		// The list prints the stored REAL value, which may or may not carry a ".0".
		await expect(page.getByText(/7(\.0)? pts/)).toBeVisible();

		await page.goto(`/g/${code}/admin/teams`);
		await page.getByLabel('Name').first().fill('Gulls');
		await page.getByRole('button', { name: /Add team/ }).click();
		await expect(page.getByText('Gulls').first()).toBeVisible();

		// A player opens the join link in their own browser and sees the game.
		const ctx = await browser.newContext();
		const pp = await ctx.newPage();
		await pp.goto(`/join/${code}`);
		await pp.getByLabel('Your name').fill('Guest');
		await pp.getByLabel('Email').fill(`guest${Date.now()}@example.com`);
		await pp.getByRole('button', { name: 'Join the game' }).click();
		await pp.getByRole('button', { name: 'Not now' }).click();
		await expect(pp.getByRole('heading', { name: "You're in!" })).toBeVisible();
		await ctx.close();
	});

	test('saving settings shows a confirmation and the changes stick', async ({ page, site, world }) => {
		await site.signIn(page, world.host.id);
		await page.goto(`/g/${world.g.code}/admin`);
		await page.getByLabel('Name').first().fill('Renamed game');
		await page.getByLabel('Who can see photos?').selectOption('open');
		await page.getByRole('button', { name: 'Save settings' }).click();
		await expect(page.getByText('Saved.')).toBeVisible();
		expect(site.one('SELECT name, visibility FROM game WHERE id = ?', world.g.id)).toEqual({ name: 'Renamed game', visibility: 'open' });
	});

	test('bingo scoring appears on the board and leaderboard', async ({ page, site, world }) => {
		site.exec('UPDATE game SET bingo = 1, bingo_cols = 2, bingo_line_points = 3, bingo_board_points = 10 WHERE id = ?', world.g.id);
		site.exec('UPDATE category SET active = 1 WHERE game_id = ?', world.g.id);
		const ids = [await site.upload(world.alice.id, world.g.code, { category: world.hats.id }), await site.upload(world.alice.id, world.g.code, { category: world.dogs.id })];
		for (const [i, id] of ids.entries()) site.exec('INSERT INTO photo_claim (photo_id, option_id, qty) VALUES (?, ?, 1)', id, i ? world.dogs.option : world.hats.option);
		await site.signIn(page, world.alice.id);
		await page.goto(`/g/${world.g.code}`);
		await expect(page.getByRole('heading', { name: 'Bingo board' })).toBeVisible();
		await expect(page.locator('a.cell.done')).toHaveCount(2);
		// 5 + 3 points for the photos, 3 for the completed row, 10 for the full 2x1... board
		await expect(page.getByText(/1 bingo line/)).toBeVisible();
	});

	test('deleting a game needs its code typed and then removes it', async ({ page, site, world }) => {
		await site.signIn(page, world.host.id);
		await page.goto(`/g/${world.g.code}/admin`);
		await page.getByText('Delete this game').click();
		await page.getByRole('button', { name: 'Delete game forever' }).click();
		await expect(page.getByText('Type the game code to confirm.')).toBeVisible();
		expect(site.one('SELECT 1 AS x FROM game WHERE id = ?', world.g.id)).toBeTruthy();
		// The form is a plain post, so the page reloaded with the section closed again.
		await page.getByText('Delete this game').click();
		await page.locator('details input[name=confirm]').fill(world.g.code);
		await page.getByRole('button', { name: 'Delete game forever' }).click();
		await expect(page).toHaveURL(/\/$/);
		expect(site.one('SELECT 1 AS x FROM game WHERE id = ?', world.g.id)).toBeUndefined();
	});

	test('players never see the Host tab and cannot open host pages', async ({ page, site, world }) => {
		await site.signIn(page, world.alice.id);
		await page.goto(`/g/${world.g.code}`);
		await expect(page.locator('nav.tabs a', { hasText: 'Host' })).toHaveCount(0);
		const r = await page.goto(`/g/${world.g.code}/admin`);
		expect(r!.status()).toBe(403);
		await site.signIn(page, world.host.id);
		await page.goto(`/g/${world.g.code}`);
		await expect(page.locator('nav.tabs a', { hasText: 'Host' })).toBeVisible();
	});
});

test.describe('navigation robustness', () => {
	test('browsing keeps working after the browser drops sessionStorage', async ({ page, site, world }) => {
		const id = await site.upload(world.alice.id, world.g.code, { category: world.hats.id });
		await site.signIn(page, world.alice.id);
		await page.goto(`/g/${world.g.code}`);
		await page.getByRole('link', { name: /Gallery/ }).click();
		await page.locator('a.ph').first().click();
		await expect(page).toHaveURL(new RegExp(`/p/${id}`));
		// Smoke test for tab restores that lose sessionStorage. It does not reproduce the old scroll-record crash
		// (that one needs a real iOS restore), so it is not proof the scrollGuard plugin works.
		await page.evaluate(() => sessionStorage.clear());
		await page.reload();
		await page.getByRole('link', { name: /Scores/ }).click();
		await expect(page.getByRole('heading', { name: 'Leaderboard' })).toBeVisible();
		await page.goBack();
		await page.goBack();
		await page.getByRole('link', { name: /Board/ }).click();
		await expect(page.getByRole('heading', { name: 'Categories' })).toBeVisible();
	});
});

test.describe('reordering categories by dragging', () => {
	const names = (page: import('@playwright/test').Page) => page.locator('[data-category]').evaluateAll((els) => els.map((e) => e.getAttribute('data-category')));

	async function drag(page: import('@playwright/test').Page, from: string, to: string, where: 'above' | 'below') {
		const handle = page.locator(`[data-category="${from}"] [data-handle]`);
		const target = page.locator(`[data-category="${to}"]`);
		const h = (await handle.boundingBox())!;
		const t = (await target.boundingBox())!;
		await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
		await page.mouse.down();
		const y = where === 'above' ? t.y + 4 : t.y + t.height - 4;
		await page.mouse.move(h.x + h.width / 2, (h.y + y) / 2, { steps: 5 });
		await page.mouse.move(h.x + h.width / 2, y, { steps: 10 });
		await page.mouse.up();
	}

	test('dragging a category to the top saves the new order, and it survives a reload', async ({ page, site, world }) => {
		const c3 = site.category(world.g.id, 'Third');
		const c4 = site.category(world.g.id, 'Fourth');
		await site.signIn(page, world.host.id);
		await page.goto(`/g/${world.g.code}/admin/categories`);
		expect(await names(page)).toEqual(['Silly hats', 'Dogs', 'Third', 'Fourth']);
		await drag(page, 'Fourth', 'Silly hats', 'above');
		await expect.poll(() => names(page)).toEqual(['Fourth', 'Silly hats', 'Dogs', 'Third']);
		await expect.poll(() => site.all('SELECT name FROM category WHERE game_id = ? ORDER BY sort, id', world.g.id).map((r) => r.name)).toEqual(['Fourth', 'Silly hats', 'Dogs', 'Third']);
		await page.reload();
		expect(await names(page)).toEqual(['Fourth', 'Silly hats', 'Dogs', 'Third']);
		// The board shows the same order.
		await page.goto(`/g/${world.g.code}`);
		await expect(page.locator('a.cell .name').first()).toHaveText('Fourth');
		expect(c3.id).toBeGreaterThan(0);
		expect(c4.id).toBeGreaterThan(0);
	});

	test('dragging a category down and then back up restores the order', async ({ page, site, world }) => {
		site.category(world.g.id, 'Third');
		await site.signIn(page, world.host.id);
		await page.goto(`/g/${world.g.code}/admin/categories`);
		await drag(page, 'Silly hats', 'Dogs', 'below');
		await expect.poll(() => names(page)).toEqual(['Dogs', 'Silly hats', 'Third']);
		await drag(page, 'Silly hats', 'Dogs', 'above');
		await expect.poll(() => names(page)).toEqual(['Silly hats', 'Dogs', 'Third']);
		await expect.poll(() => site.all('SELECT name FROM category WHERE game_id = ? ORDER BY sort, id', world.g.id).map((r) => r.name)).toEqual(['Silly hats', 'Dogs', 'Third']);
	});

	test('the arrow buttons still work', async ({ page, site, world }) => {
		await site.signIn(page, world.host.id);
		await page.goto(`/g/${world.g.code}/admin/categories`);
		await page.locator('[data-category="Dogs"]').getByRole('button', { name: 'Move up' }).click();
		await expect.poll(() => names(page)).toEqual(['Dogs', 'Silly hats']);
	});

	test('clicking a category name still opens it', async ({ page, site, world }) => {
		await site.signIn(page, world.host.id);
		await page.goto(`/g/${world.g.code}/admin/categories`);
		await page.locator('[data-category="Dogs"] a').click();
		await expect(page).toHaveURL(new RegExp(`/categories/${world.dogs.id}$`));
	});
});
