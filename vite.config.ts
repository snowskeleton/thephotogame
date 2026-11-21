import adapter from '@sveltejs/adapter-cloudflare';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

// SvelteKit's client router keeps per-history-entry scroll info in sessionStorage. When the browser drops
// sessionStorage but keeps the history entry (iOS tab restore, in-app browsers), saving scroll throws
// "undefined is not an object (evaluating 'N[e].scroll=...')" and the navigation ends on a 500 page.
const scrollGuard = {
	name: 'scroll-info-guard',
	enforce: 'pre' as const,
	transform(code: string, id: string) {
		const bad = 'history_info[index].scroll = scroll_state();';
		if (!id.includes('@sveltejs/kit/src/runtime/client/client.js') || !code.includes(bad)) return;
		return code.replace(bad, '(history_info[index] ??= {}).scroll = scroll_state();');
	}
};

export default defineConfig({
	plugins: [
		scrollGuard,
		sveltekit({
			compilerOptions: {
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},
			adapter: adapter()
		})
	]
});
