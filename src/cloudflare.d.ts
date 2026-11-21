// The Worker's bindings, as `import { env } from 'cloudflare:workers'` (Env is declared in app.d.ts).
declare module 'cloudflare:workers' {
	export const env: Env;
}
