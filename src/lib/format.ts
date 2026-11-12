export function pts(n: number | null | undefined): string {
	if (n == null) return '0';
	return String(Math.round(n * 100) / 100);
}
export function plural(n: number, word: string): string {
	return `${n} ${word}${n === 1 ? '' : 's'}`;
}
export function dayOf(ms: number): string {
	return new Date(ms).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
}
