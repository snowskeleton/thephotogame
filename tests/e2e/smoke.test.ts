import { SELF } from 'cloudflare:test';
import { expect, it } from 'vitest';

it('serves the sign-in page', async () => {
	const r = await SELF.fetch('https://t.test/login');
	expect(r.status).toBe(200);
	expect(await r.text()).toContain('email');
});
