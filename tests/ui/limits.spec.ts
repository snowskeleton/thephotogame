import { expect, test } from './fixtures.ts';

test.describe('points limits, guesses and overage', () => {
	test('a full category tells players up front, counting pending guesses', async ({ page, site, world }) => {
		site.exec('UPDATE category SET max_points = 10 WHERE id = ?', world.hats.id);
		const done = await site.upload(world.alice.id, world.g.code, { category: world.hats.id, caption: 'first' });
		site.exec('INSERT INTO photo_claim (photo_id, option_id, qty) VALUES (?, ?, 1)', done, world.hats.option);
		await site.signIn(page, world.alice.id);
		await page.goto(`/g/${world.g.code}/c/${world.hats.id}`);
		await expect(page.getByTestId('room')).toContainText('5 of 10 pts confirmed');
		await expect(page.getByTestId('room')).not.toContainText('Full');

		// A pending photo with a guess fills the rest.
		const waiting = await site.upload(world.alice.id, world.g.code, { category: world.hats.id, caption: 'second' });
		site.exec('INSERT INTO photo_guess (photo_id, option_id, qty) VALUES (?, ?, 2)', waiting, world.hats.option);
		await page.reload();
		await expect(page.getByTestId('room')).toContainText('5 pending');
		await expect(page.getByTestId('room')).toContainText('probably won');
		await expect(page.getByText('guess ~10 pt')).toBeVisible();
	});

	test('a player edits their guess, the host confirms it', async ({ page, site, world, browser }) => {
		const id = await site.upload(world.alice.id, world.g.code, { category: world.hats.id, caption: 'Guessy' });
		await site.signIn(page, world.alice.id);
		await page.goto(`/g/${world.g.code}/p/${id}`);
		await page.getByText('Edit photo').click();
		await expect(page.getByText('What do you think this earns?')).toBeVisible();
		await page.getByRole('button', { name: 'Save', exact: true }).first().click();
		await expect(page.getByText('Saved.')).toBeVisible();
		await expect(page.getByText('~5 guess')).toBeVisible();
		expect(site.claims(world.g.id)).toEqual([]);

		const hostPage = await (await browser.newContext({ ...(page.context() as any)._options })).newPage();
		await site.signIn(hostPage, world.host.id);
		await hostPage.goto(`/g/${world.g.code}/p/${id}`);
		await hostPage.getByRole('button', { name: /^✓ Confirm the guess/ }).click();
		await expect(hostPage.getByRole('button', { name: /Confirm the guess/ })).toHaveCount(0);
		expect(site.claims(world.g.id).map((c) => c.option_id)).toEqual([world.hats.option]);
	});

	test('the leaderboard shows overage and pending points', async ({ page, site, world }) => {
		site.exec('UPDATE category SET max_points = 5 WHERE id = ?', world.hats.id);
		for (const caption of ['a', 'b']) {
			const id = await site.upload(world.alice.id, world.g.code, { category: world.hats.id, caption });
			site.exec('INSERT INTO photo_claim (photo_id, option_id, qty) VALUES (?, ?, 1)', id, world.hats.option);
		}
		await site.signIn(page, world.alice.id);
		await page.goto(`/g/${world.g.code}/scores`);
		await expect(page.getByTestId('beyond')).toContainText('Alice');
		await expect(page.getByTestId('beyond')).toContainText('+5 over');
	});
});
