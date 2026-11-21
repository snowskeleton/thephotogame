import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

// Drives the built Worker over HTTP, the way a browser would. Run `npm run build` first (npm run test:e2e does).
export default defineConfig({
	plugins: [cloudflareTest({ wrangler: { configPath: './tests/wrangler.e2e.jsonc' } })],
	test: { include: ['tests/e2e/**/*.test.ts'], testTimeout: 30_000 }
});
