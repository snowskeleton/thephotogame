import { expect, png, test } from './fixtures.ts';

test('a host defines a checklist; players tick items off at upload and filter the gallery by item', async ({ browser, page, site, world }) => {
	site.exec("UPDATE game SET visibility = 'open' WHERE id = ?", world.g.id);

	// Host writes the list in the category's setup.
	await site.signIn(page, world.host.id);
	await page.goto(`/g/${world.g.code}/admin/categories/${world.dogs.id}`);
	await page.getByLabel('Checklist items').fill('Beagle\nPoodle\n\nCorgi\npoodle');
	await page.getByRole('button', { name: 'Save category' }).click();
	await page.waitForURL(/admin\/categories$/);
	expect(site.all('SELECT label FROM category_item WHERE category_id = ? ORDER BY sort', world.dogs.id).map((r) => r.label)).toEqual(['Beagle', 'Poodle', 'Corgi']);

	// Alice sees it on the category page and picks an item while uploading.
	const ctx = await browser.newContext();
	const alice = await ctx.newPage();
	await site.signIn(alice, world.alice.id);
	await alice.goto(`/g/${world.g.code}/c/${world.dogs.id}`);
	await expect(alice.getByText('0 of 3')).toBeVisible();
	await alice.locator('input[type=file]').first().setInputFiles({ name: 'rex.png', mimeType: 'image/png', buffer: png(200, 100, 2) });
	await alice.getByLabel(/Checklist item/).selectOption({ label: 'Poodle' });
	await alice.getByRole('button', { name: 'Submit' }).click();
	await expect(alice.getByText('1 photo added.')).toBeVisible();
	await expect(alice.getByText('1 of 3')).toBeVisible();
	await expect(alice.locator('li.done', { hasText: 'Poodle' })).toBeVisible();
	await expect(alice.locator('li.done', { hasText: 'Beagle' })).toHaveCount(0);
	const poodle = site.one('SELECT id FROM category_item WHERE category_id = ? AND label = ?', world.dogs.id, 'Poodle').id;
	expect(site.photos(world.g.id)[0]).toMatchObject({ category_id: world.dogs.id, item_id: poodle });

	// A teammate on the other team has none ticked.
	// Its own context: sessions are cookies, so sharing one would sign Alice out.
	const ctxB = await browser.newContext();
	const bob = await ctxB.newPage();
	await site.signIn(bob, world.bob.id);
	await bob.goto(`/g/${world.g.code}/c/${world.dogs.id}`);
	await expect(bob.getByText('0 of 3')).toBeVisible();

	// Gallery: item filter appears with a category, and clears when the category changes.
	const second = await site.upload(world.alice.id, world.g.code, { category: world.dogs.id, seed: 5 });
	await alice.goto(`/g/${world.g.code}/gallery`);
	await expect(alice.getByLabel('Checklist item')).toHaveCount(0);
	await alice.getByLabel('Category').selectOption({ label: 'Dogs' });
	await expect(alice.locator('a.ph')).toHaveCount(2);
	await alice.getByLabel('Checklist item').selectOption({ label: 'Poodle' });
	await expect(alice).toHaveURL(new RegExp(`item=${poodle}`));
	await expect(alice.locator('a.ph')).toHaveCount(1);
	await alice.getByLabel('Category').selectOption({ label: 'Silly hats' });
	await expect(alice).not.toHaveURL(/item=\d/);

	// Editing the photo's item from its page.
	await alice.goto(`/g/${world.g.code}/p/${second}`);
	await alice.getByText('Edit photo', { exact: true }).click();
	await alice.getByLabel('Checklist item').selectOption({ label: 'Corgi' });
	await alice.getByRole('button', { name: 'Save' }).click();
	await expect(alice.getByText('Saved.')).toBeVisible();
	await expect(alice.getByText('✓ Corgi')).toBeVisible();
	await ctx.close();
	await ctxB.close();
});
