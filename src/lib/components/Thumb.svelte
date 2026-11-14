<script lang="ts">
	import { tv } from '#lib/colors.ts';
	let {
		photo,
		code,
		tag = ''
	}: {
		photo: { id: number; color: string; status?: string; caption?: string };
		code: string;
		tag?: string;
	} = $props();
</script>

<a class="ph" class:off={photo.status === 'disqualified'} href="/g/{code}/p/{photo.id}" style="{tv(photo.color)}">
	<img src="/media/{photo.id}/thumb" alt={photo.caption || 'Photo'} loading="lazy" />
	{#if photo.status === 'review'}<span class="tag">⚠️ review</span>
	{:else if photo.status === 'disqualified'}<span class="tag">✖ out</span>
	{:else if tag}<span class="tag">{tag}</span>{/if}
</a>
