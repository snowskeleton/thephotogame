import { expect, test } from './fixtures.ts';

test('a host gives superlatives to a player, a team and a photo, and players see them on Scores', async ({ page, site, world, browser }) => {
	site.exec("UPDATE game SET visibility = 'open' WHERE id = ?", world.g.id);
	const photo = await site.upload(world.alice.id, world.g.code, { category: world.hats.id, caption: 'Big wig' });
	await site.signIn(page, world.host.id);
	await page.goto(`/g/${world.g.code}/admin/superlatives`);

	await page.locator('input[name=title]').fill('Most likely to nap');
	await page.locator('select[name=person]').selectOption({ label: 'Bob (Blues)' });
	await page.getByRole('button', { name: 'Give it' }).click();
	await expect(page.getByText('🏆 Most likely to nap')).toBeVisible();

	await page.locator('input[name=title]').fill('Loudest');
	await page.getByLabel('Goes to').selectOption('team');
	await page.locator('select[name=team]').selectOption({ label: 'Reds' });
	await page.getByRole('button', { name: 'Give it' }).click();
	await expect(page.getByText('🏆 Loudest')).toBeVisible();

	// From the photo page, the link presets the photo.
	await page.goto(`/g/${world.g.code}/p/${photo}`);
	await page.getByRole('link', { name: /Give a superlative/ }).click();
	await page.waitForURL(/admin\/superlatives/);
	await page.waitForLoadState('networkidle');
	await page.locator('input[name=title]').fill('Best wig');
	await page.getByRole('button', { name: 'Give it' }).click();
	await expect(page.getByText('🏆 Best wig')).toBeVisible();
	expect(site.all('SELECT title, kind FROM superlative WHERE game_id = ? ORDER BY id', world.g.id)).toEqual([
		{ title: 'Most likely to nap', kind: 'person' }, { title: 'Loudest', kind: 'team' }, { title: 'Best wig', kind: 'photo' }
	]);

	const ctx = await browser.newContext();
	const pp = await ctx.newPage();
	await site.signIn(pp, world.bob.id);
	await pp.goto(`/g/${world.g.code}/scores`);
	await expect(pp.getByRole('heading', { name: 'Superlatives' })).toBeVisible();
	await expect(pp.getByText('🏆 Most likely to nap')).toBeVisible();
	await expect(pp.getByText('🏆 Best wig')).toBeVisible();
	await pp.goto(`/g/${world.g.code}/admin/superlatives`);
	await ctx.close();
});

test('a photo’s superlative stays hidden from other teams until the photo is revealed', async ({ page, site, world }) => {
	const photo = await site.upload(world.alice.id, world.g.code, { category: world.hats.id });
	site.exec("INSERT INTO superlative (game_id, title, kind, photo_id, created_at) VALUES (?, 'Secret wig', 'photo', ?, 1)", world.g.id, photo);
	await site.signIn(page, world.bob.id);
	await page.goto(`/g/${world.g.code}/scores`);
	await expect(page.getByText('Secret wig')).toHaveCount(0);
});
