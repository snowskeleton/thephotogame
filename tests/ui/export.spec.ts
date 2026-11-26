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
