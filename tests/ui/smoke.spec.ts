import { expect, test } from './fixtures.ts';

test('signed-out home page renders and the guard stays quiet', async ({ page }) => {
	await page.goto('/');
	await expect(page.getByRole('heading', { name: /Find it. Snap it. Win it./ })).toBeVisible();
});
