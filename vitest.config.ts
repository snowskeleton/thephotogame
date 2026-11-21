import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

// Server code runs inside workerd with a real (local) D1 and R2, the same runtime as production.

export default defineConfig({
	plugins: [
		cloudflareTest({
			wrangler: { configPath: './tests/wrangler.test.jsonc' },
			miniflare: { compatibilityFlags: ['nodejs_compat'] }
		})
	],
	resolve: { alias: { '#lib': new URL('./src/lib', import.meta.url).pathname } },
	test: { include: ['tests/unit/**/*.test.ts'] }
});
