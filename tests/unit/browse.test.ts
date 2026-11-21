import { describe, expect, it } from 'vitest';
import { browseQuery, fromGallery } from '../../src/lib/browse.ts';

describe('browseQuery', () => {
	it('is empty with no filters', () => {
		expect(browseQuery({})).toBe('');
	});
	it('keeps every filter in the URL', () => {
		const q = new URLSearchParams(browseQuery({ cat: 1, team: 2, user: 3, day: '2026-07-04', unscored: true }));
		expect(Object.fromEntries(q)).toEqual({ cat: '1', team: '2', user: '3', day: '2026-07-04', unscored: '1' });
	});
	it('drops unset filters', () => {
		expect(browseQuery({ team: 2, unscored: false })).toBe('?team=2');
	});
});

describe('fromGallery', () => {
	it('starts a query string when there is none', () => {
		expect(fromGallery('')).toBe('?from=gallery');
	});
	it('appends to an existing one', () => {
		expect(fromGallery('?team=2')).toBe('?team=2&from=gallery');
	});
});
