import { defineConfig, devices } from '@playwright/test';

const PORT = 8799;

// Real Chromium against the built Worker running under `wrangler dev --local` with throwaway storage.
// Run `npm run test:ui` (it builds first). The desktop and phone projects run the same specs.
export default defineConfig({
	testDir: 'tests/ui',
	testMatch: '**/*.spec.ts',
	// One shared site and database; tests keep out of each other's way by making their own game and people.
	workers: 1,
	fullyParallel: false,
	timeout: 60_000,
	expect: { timeout: 10_000 },
	reporter: [['list']],
	use: { baseURL: `http://localhost:${PORT}`, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
	projects: [
		{ name: 'desktop', use: { ...devices['Desktop Chrome'] } },
		// Pixel 7 emulation: phone viewport, touch and mobile user agent, still Chromium underneath.
		{ name: 'phone', use: { ...devices['Pixel 7'] } }
	],
	webServer: {
		command: `node tests/ui/serve.mjs ${PORT}`,
		url: `http://localhost:${PORT}/robots.txt`,
		timeout: 120_000,
		reuseExistingServer: false,
		gracefulShutdown: { signal: 'SIGTERM', timeout: 5000 }
	}
});
