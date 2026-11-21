<script lang="ts">
	import { tv } from '#lib/colors.ts';
	let {
		photo,
		code,
		tag = '',
		showScore = false
	}: {
		/** Hosts see which photos still need points. */
		showScore?: boolean;
		photo: { id: number; color: string; status?: string; caption?: string; score?: { pending: boolean; points: number; counted: boolean } };
		code: string;
		tag?: string;
	} = $props();
</script>

<a class="ph" class:off={photo.status === 'disqualified'} href="/g/{code}/p/{photo.id}" style="{tv(photo.color)}">
	<img src="/media/{photo.id}/thumb" alt={photo.caption || 'Photo'} loading="lazy" />
	{#if photo.status === 'review'}<span class="tag">⚠️ review</span>
	{:else if photo.status === 'disqualified'}<span class="tag">✖ out</span>
	{:else if showScore && photo.score?.pending}<span class="tag unscored">⏳ unscored</span>
	{:else if showScore && photo.score}<span class="tag scored">✓ {Math.round(photo.score.points * 100) / 100} pt</span>
	{:else if tag}<span class="tag">{tag}</span>{/if}
</a>
