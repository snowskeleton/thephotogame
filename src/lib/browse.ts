export const BROWSE_SETS = ['winners', 'voted', 'superlatives'] as const;
/** Photos that won a closed vote, got any vote (hosts only: open votes are secret) or carry a photo superlative. */
export type BrowseSet = (typeof BROWSE_SETS)[number];
export const SET_LABEL: Record<BrowseSet, string> = { winners: 'Winners', voted: 'Any vote', superlatives: 'Superlatives' };

export type BrowseFilter = { cat?: number; item?: number; team?: number; user?: number; day?: string; unscored?: boolean; set?: BrowseSet };

/** The gallery filters as a query string, e.g. "?team=2&user=5" (empty when nothing is filtered). */
export function browseQuery(f: BrowseFilter): string {
	const p = new URLSearchParams();
	if (f.cat) p.set('cat', String(f.cat));
	if (f.item) p.set('item', String(f.item));
	if (f.team) p.set('team', String(f.team));
	if (f.user) p.set('user', String(f.user));
	if (f.day) p.set('day', f.day);
	if (f.unscored) p.set('unscored', '1');
	if (f.set) p.set('set', f.set);
	const s = p.toString();
	return s ? `?${s}` : '';
}

/** Adds `from=gallery` so a photo page knows which list it was opened from. */
export const fromGallery = (search: string) => `${search}${search ? '&' : '?'}from=gallery`;
