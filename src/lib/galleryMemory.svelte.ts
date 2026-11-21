// Remembers each game's last gallery filters for this browser tab, so tapping the Gallery tab (or coming
// back from a photo) returns to the same filtered list instead of resetting it.
const KEY = 'pg_gallery';

function read(): Record<string, string> {
	try {
		return JSON.parse(sessionStorage.getItem(KEY) ?? '{}');
	} catch {
		return {};
	}
}

// `get` runs inside $derived expressions, where Svelte forbids writing state, so reading never writes:
// the saved copy starts empty and is filled in by `load()` (called once from onMount) and `set()`.
let saved = $state<Record<string, string>>({});

export const galleryMemory = {
	get: (code: string): string => saved[code] ?? '',
	load() {
		saved = read();
	},
	set(code: string, search: string) {
		if (saved[code] === search) return;
		saved = { ...read(), ...saved, [code]: search };
		try {
			sessionStorage.setItem(KEY, JSON.stringify(saved));
		} catch {
			// storage unavailable: the filters just aren't remembered
		}
	}
};
