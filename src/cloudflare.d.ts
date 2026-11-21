// The Worker's bindings, as `import { env } from 'cloudflare:workers'` (Env is declared in app.d.ts).
declare module 'cloudflare:workers' {
	export const env: Env;
	/** Keeps the Worker alive until the promise settles, after the response has gone out. */
	export function waitUntil(promise: Promise<unknown>): void;
}
