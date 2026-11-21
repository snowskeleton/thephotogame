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

let saved = $state<Record<string, string>>({});
let loaded = false;

export const galleryMemory = {
	get(code: string): string {
		if (!loaded && typeof sessionStorage !== 'undefined') {
			saved = read();
			loaded = true;
		}
		return saved[code] ?? '';
	},
	set(code: string, search: string) {
		if (typeof sessionStorage === 'undefined') return;
		if (!loaded) (saved = read()), (loaded = true);
		saved = { ...saved, [code]: search };
		try {
			sessionStorage.setItem(KEY, JSON.stringify(saved));
		} catch {
			// storage unavailable: the filters just aren't remembered
		}
	}
};
