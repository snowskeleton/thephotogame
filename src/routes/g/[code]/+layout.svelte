<script lang="ts">
	import { tv } from '#lib/colors.ts';
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import { galleryMemory } from '#lib/galleryMemory.svelte.ts';
	let { children, data } = $props();
	onMount(() => galleryMemory.load());
	const base = $derived(`/g/${data.game.code}`);
	const tabs = $derived([
		{ href: base, icon: '🎯', label: 'Board', on: page.url.pathname === base || page.url.pathname.startsWith(base + '/c/') },
		{ href: `${base}/gallery${galleryMemory.get(data.game.code)}`, icon: '🖼️', label: 'Gallery', on: /\/(gallery|p|show)(\/|$)/.test(page.url.pathname.slice(base.length)) },
		{ href: `${base}/vote`, icon: '🗳️', label: 'Vote', on: page.url.pathname.startsWith(`${base}/vote`) },
		{ href: `${base}/scores`, icon: '🏆', label: 'Scores', on: page.url.pathname.startsWith(`${base}/scores`) },
		...(data.isHost
			? [{ href: `${base}/admin`, icon: '🛠️', label: 'Host', on: page.url.pathname.startsWith(`${base}/admin`) }]
			: [])
	]);
</script>

<div style="{tv(data.team?.color ?? 'var(--accent)')}">
	<main>
		<div class="spread" style="margin-bottom:12px">
			<strong class="muted">{data.game.name}</strong>
			{#if data.team}<span class="pill team">{data.team.name}</span>{/if}
		</div>
		{@render children()}
	</main>
	<nav class="tabs">
		{#each tabs as t}
			<a href={t.href} class:on={t.on}><span>{t.icon}</span>{t.label}</a>
		{/each}
	</nav>
</div>
