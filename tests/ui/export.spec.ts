import { expect, test } from './fixtures.ts';

test('a host downloads a zip of the winning photos', async ({ page, site, world }) => {
	site.exec("UPDATE game SET visibility = 'open' WHERE id = ?", world.g.id);
	const win = await site.upload(world.alice.id, world.g.code, { category: world.hats.id, caption: 'Alice hat', seed: 1 });
	await site.upload(world.bob.id, world.g.code, { category: world.hats.id, caption: 'Bob hat', seed: 2 });
	await site.signIn(page, world.host.id);
	await page.goto(`/g/${world.g.code}/admin`);
	await page.waitForLoadState('networkidle');
	await expect(page.getByRole('button', { name: /Winning photos \(0\)/ })).toBeDisabled();

	const award = site.exec("INSERT INTO award (game_id, name, points, status, scope) VALUES (?, 'Best hat', 4, 'closed', 'game')", world.g.id);
	site.exec('INSERT INTO vote (award_id, photo_id, user_id) VALUES (?, ?, ?)', award, win, world.bob.id);
	await page.reload();
	await page.waitForLoadState('networkidle');
	const button = page.getByRole('button', { name: /Winning photos \(1\)/ });
	await expect(button).toBeEnabled();
	const [download] = await Promise.all([page.waitForEvent('download'), button.click()]);
	expect(download.suggestedFilename()).toContain('winners');
});

test('the gallery filters to winners, any vote and superlatives', async ({ page, site, world }) => {
	site.exec("UPDATE game SET visibility = 'open' WHERE id = ?", world.g.id);
	const a = await site.upload(world.alice.id, world.g.code, { category: world.hats.id, caption: 'Alice hat', seed: 1 });
	const b = await site.upload(world.bob.id, world.g.code, { category: world.hats.id, caption: 'Bob hat', seed: 2 });
	const c = await site.upload(world.bob.id, world.g.code, { category: world.dogs.id, caption: 'Bob dog', seed: 3 });
	const award = site.exec("INSERT INTO award (game_id, name, points, status, scope) VALUES (?, 'Best hat', 4, 'closed', 'game')", world.g.id);
	site.exec('INSERT INTO vote (award_id, photo_id, user_id) VALUES (?, ?, ?)', award, a, world.bob.id);
	site.exec('INSERT INTO vote (award_id, photo_id, user_id) VALUES (?, ?, ?)', award, a, world.host.id);
	site.exec('INSERT INTO vote (award_id, photo_id, user_id) VALUES (?, ?, ?)', award, b, world.alice.id);
	site.exec("INSERT INTO superlative (game_id, title, kind, photo_id, created_at) VALUES (?, 'Best dog', 'photo', ?, 1)", world.g.id, c);

	// Players get winners and superlatives, but not "any vote".
	await site.signIn(page, world.alice.id);
	await page.goto(`/g/${world.g.code}/gallery`);
	await page.waitForLoadState('networkidle');
	await expect(page.getByLabel('Photo set').locator('option')).toHaveText(['All photos', '(1) Winners', '(1) Superlatives']);
	await page.getByLabel('Photo set').selectOption({ label: '(1) Winners' });
	await expect(page).toHaveURL(/set=winners/);
	await expect(page.locator('a.ph')).toHaveCount(1);
	await page.goto(`/g/${world.g.code}/gallery?set=voted`);
	await expect(page.locator('a.ph')).toHaveCount(3);

	// The host can also list every photo that got a vote.
	await site.signIn(page, world.host.id);
	await page.goto(`/g/${world.g.code}/gallery`);
	await page.waitForLoadState('networkidle');
	await expect(page.getByLabel('Photo set').locator('option')).toHaveText(['All photos', '(1) Winners', '(2) Any vote', '(1) Superlatives']);
	await page.getByLabel('Photo set').selectOption({ label: '(2) Any vote' });
	await expect(page.locator('a.ph')).toHaveCount(2);
});

test('the gallery shows votes per award and filters by one award', async ({ page, site, world }) => {
	site.exec("UPDATE game SET visibility = 'open' WHERE id = ?", world.g.id);
	const a = await site.upload(world.alice.id, world.g.code, { category: world.hats.id, caption: 'Alice hat', seed: 1 });
	const b = await site.upload(world.bob.id, world.g.code, { category: world.hats.id, caption: 'Bob hat', seed: 2 });
	const hat = site.exec("INSERT INTO award (game_id, name, points, status, scope) VALUES (?, 'Best hat', 4, 'closed', 'game')", world.g.id);
	const fun = site.exec("INSERT INTO award (game_id, name, points, status, scope) VALUES (?, 'Funniest', 4, 'open', 'game')", world.g.id);
	const vote = (award: number, photo: number, user: number) => site.exec('INSERT INTO vote (award_id, photo_id, user_id) VALUES (?, ?, ?)', award, photo, user);
	vote(hat, a, world.bob.id); vote(hat, a, world.host.id); vote(hat, b, world.alice.id);
	vote(fun, b, world.host.id); vote(fun, b, world.alice.id);

	// A player sees only the closed award's numbers; the open award stays secret.
	await site.signIn(page, world.alice.id);
	await page.goto(`/g/${world.g.code}/gallery`);
	await page.waitForLoadState('networkidle');
	await expect(page.getByLabel('Vote').locator('option')).toHaveText(['All votes', '(2) Best hat']);
	await expect(page.getByText('Funniest')).toHaveCount(0);
	await expect(page.locator(`a.ph[href^="/g/${world.g.code}/p/${a}"] .votes`)).toHaveText('🗳️ Best hat · 2');

	// The host sees each award's count on its own and can filter to one.
	await site.signIn(page, world.host.id);
	await page.goto(`/g/${world.g.code}/gallery`);
	await page.waitForLoadState('networkidle');
	await expect(page.getByLabel('Vote').locator('option')).toHaveText(['All votes', '(2) Best hat', '(1) Funniest']);
	await expect(page.locator(`a.ph[href^="/g/${world.g.code}/p/${b}"] .votes .tag`)).toHaveText(['🗳️ Best hat · 1', '🗳️ Funniest · 2']);
	await page.getByLabel('Vote').selectOption({ label: '(1) Funniest' });
	await expect(page).toHaveURL(/award=/);
	await expect(page.locator('a.ph')).toHaveCount(1);
	await page.locator('a.ph').click();
	await expect(page.getByRole('link', { name: '🗳️ Funniest · 2' })).toBeVisible();
	await expect(page.getByRole('link', { name: /← Gallery: Funniest/ })).toBeVisible();
});
