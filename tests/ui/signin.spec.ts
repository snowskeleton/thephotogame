import { expect, test } from './fixtures.ts';

test.describe('signing in', () => {
	test('an existing player signs in with the emailed code', async ({ page, site }) => {
		const u = site.user({ name: 'Amy', email: `amy${Date.now()}@example.com` });
		await page.goto('/login');
		await page.getByLabel('Email').fill(u.email);
		await page.getByRole('button', { name: 'Sign in' }).click();
		await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();
		await page.getByLabel('Code').fill(await site.codeFor(u.email));
		await page.getByRole('button', { name: 'Sign in' }).click();
		// People without a passkey are offered one on the way in.
		await expect(page.getByRole('heading', { name: /You’re in!/ })).toBeVisible();
		await page.getByRole('button', { name: 'Not now' }).click();
		await expect(page.getByRole('heading', { name: 'Your games' })).toBeVisible();
	});

	test('a wrong code is refused with a message, and the right one still works afterwards', async ({ page, site }) => {
		const u = site.user({ email: `wrong${Date.now()}@example.com` });
		await page.goto('/login');
		await page.getByLabel('Email').fill(u.email);
		await page.getByRole('button', { name: 'Sign in' }).click();
		const real = await site.codeFor(u.email);
		await page.getByLabel('Code').fill(real === '111111' ? '222222' : '111111');
		await page.getByRole('button', { name: 'Sign in' }).click();
		await expect(page.getByText('That code is wrong or has expired')).toBeVisible();
		await page.getByLabel('Code').fill(real);
		await page.getByRole('button', { name: 'Sign in' }).click();
		await expect(page.getByRole('heading', { name: /You’re in!/ })).toBeVisible();
	});

	test('a new person is asked for a name, then confirms the address with a code', async ({ page, site }) => {
		const email = `new${Date.now()}@example.com`;
		await page.goto('/login');
		await page.getByLabel('Email').fill(email);
		await page.getByRole('button', { name: 'Sign in' }).click();
		await expect(page.getByRole('heading', { name: /New here/ })).toBeVisible();
		await page.getByLabel('Your name').fill('Newcomer');
		await page.getByRole('button', { name: 'Create my account' }).click();
		await page.getByLabel('Code').fill(await site.codeFor(email));
		await page.getByRole('button', { name: 'Sign in' }).click();
		await page.getByRole('button', { name: 'Not now' }).click();
		await expect(page.getByRole('heading', { name: 'Your games' })).toBeVisible();
		expect(site.one('SELECT name, email_verified_at IS NOT NULL AS v FROM user WHERE email = ?', email)).toEqual({ name: 'Newcomer', v: 1 });
	});

	test('a typo in the email is caught before anything is sent', async ({ page }) => {
		await page.goto('/login');
		await page.getByLabel('Email').fill('not-an-email');
		await page.getByRole('button', { name: 'Sign in' }).click();
		await expect(page).toHaveURL(/\/login$/);
	});

	test('the page the person wanted survives sign-in', async ({ page, site, world }) => {
		await page.goto(`/login?next=${encodeURIComponent(`/g/${world.g.code}`)}`);
		await page.getByLabel('Email').fill(world.alice.email);
		await page.getByRole('button', { name: 'Sign in' }).click();
		await page.getByLabel('Code').fill(await site.codeFor(world.alice.email));
		await page.getByRole('button', { name: 'Sign in' }).click();
		await page.getByRole('button', { name: 'Not now' }).click();
		await expect(page).toHaveURL(new RegExp(`/g/${world.g.code}$`));
	});

	test('a passkey saved on this device signs the person in without a code', async ({ page, context, site }) => {
		const cdp = await context.newCDPSession(page);
		await cdp.send('WebAuthn.enable');
		await cdp.send('WebAuthn.addVirtualAuthenticator', {
			options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true }
		});
		const u = site.user({ name: 'Pat', email: `pat${Date.now()}@example.com` });
		await site.signIn(page, u.id);
		await page.goto('/passkey?next=/');
		await page.getByRole('button', { name: 'Save a passkey' }).click();
		await expect(page.getByRole('heading', { name: 'Your games' })).toBeVisible();
		expect(site.all('SELECT * FROM passkey WHERE user_id = ?', u.id)).toHaveLength(1);

		await context.clearCookies();
		await page.goto('/login');
		await page.getByLabel('Email').fill(u.email);
		await page.getByRole('button', { name: 'Sign in' }).click();
		await expect(page.getByRole('heading', { name: 'Your games' })).toBeVisible();
	});
});

test.describe('joining from a link', () => {
	test('a new player joins with a name and email and lands in the game', async ({ page, site, world }) => {
		await page.goto(`/join/${world.g.code}`);
		await expect(page.getByRole('heading', { name: 'UI Game' })).toBeVisible();
		await page.getByLabel('Your name').fill('Dana');
		await page.getByLabel('Email').fill(`dana${Date.now()}@example.com`);
		await page.getByRole('button', { name: 'Join the game' }).click();
		await page.getByRole('button', { name: 'Not now' }).click();
		await expect(page).toHaveURL(new RegExp(`/g/${world.g.code}\\?welcome=1`));
		await expect(page.getByRole('heading', { name: "You're in!" })).toBeVisible();
		expect(site.one("SELECT m.status FROM member m JOIN user u ON u.id = m.user_id WHERE u.name = 'Dana'")).toEqual({ status: 'active' });
	});

	test('in a self-serve game the new player starts a team and can then upload', async ({ page, site }) => {
		const g = site.game({ team_mode: 'self' });
		site.category(g.id, 'Hats');
		await page.goto(`/join/${g.code}`);
		await page.getByLabel('Your name').fill('Solo');
		await page.getByLabel('Email').fill(`solo${Date.now()}@example.com`);
		await page.getByRole('button', { name: 'Join the game' }).click();
		await page.getByRole('button', { name: 'Not now' }).click();
		await expect(page.getByRole('heading', { name: 'Pick your team' })).toBeVisible();
		await page.getByLabel('Team name').fill('Just Me');
		await page.getByRole('button', { name: 'Create team' }).click();
		await expect(page.getByRole('heading', { name: 'Add photos' })).toBeVisible();
		await expect(page.locator('.pill.team', { hasText: 'Just Me' })).toBeVisible();
	});

	test('joining a team that is full is not offered', async ({ page, site }) => {
		const g = site.game({ team_mode: 'self' });
		site.exec('UPDATE game SET max_team_size = 1 WHERE id = ?', g.id);
		const t = site.team(g.id, 'Tiny');
		const taken = site.user({ name: 'Taken' });
		site.member(g.id, taken.id, t);
		const newbie = site.user({ name: 'Newbie' });
		site.member(g.id, newbie.id, null);
		await site.signIn(page, newbie.id);
		await page.goto(`/g/${g.code}`);
		await expect(page.getByRole('button', { name: 'Full' })).toBeDisabled();
	});

	test('the home page finds a game by code and rejects a wrong one', async ({ page, site, world }) => {
		await site.signIn(page, world.bob.id);
		await page.goto('/');
		await page.getByLabel('Game code').fill('nope');
		await page.getByRole('button', { name: 'Join a game' }).click();
		await expect(page.getByText('No game has that code')).toBeVisible();
		await page.getByLabel('Game code').fill(world.g.code.toLowerCase());
		await page.getByRole('button', { name: 'Join a game' }).click();
		await expect(page).toHaveURL(new RegExp(`/g/${world.g.code}$`));
	});
});
