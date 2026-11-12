<script lang="ts">
	import { page } from '$app/state';
	let { children, data } = $props();
	const base = $derived(`/g/${data.game.code}/admin`);
	const links = $derived([
		{ href: base, label: 'Game' },
		{ href: `${base}/categories`, label: 'Categories' },
		{ href: `${base}/awards`, label: 'Awards' },
		{ href: `${base}/teams`, label: 'Teams & players' }
	]);
</script>

<div class="subnav">
	{#each links as l}
		<a class="btn sm" class:on={l.href === base ? page.url.pathname === base : page.url.pathname.startsWith(l.href)} href={l.href}>{l.label}</a>
	{/each}
</div>
{@render children()}
