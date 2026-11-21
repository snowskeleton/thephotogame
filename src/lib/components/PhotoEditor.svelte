<script lang="ts">
	import { enhance } from '$app/forms';
	import { goto, invalidateAll } from '$app/navigation';
	import ClaimFields from './ClaimFields.svelte';
	import AlsoFields from './AlsoFields.svelte';

	type Option = { id: number; label: string; points: number; kind: string };
	let {
		photo,
		code,
		options,
		claims,
		categories,
		canScore = false,
		also = [],
		context = ''
	}: {
		photo: { id: number; category_id: number; caption: string };
		code: string;
		options: Option[];
		claims: { option_id: number; qty: number }[];
		categories: { id: number; name: string }[];
		/** Only the host assigns points. */
		canScore?: boolean;
		/** Options from the game's other categories the host can also credit this photo with. */
		also?: (Option & { category: string })[];
		/** Query string of the list this photo was opened from ("?from=gallery&…"); kept when the photo is deleted. */
		context?: string;
	} = $props();

	// The editor posts to the photo page's actions, so it works the same wherever it's shown.
	const action = $derived(`/g/${code}/p/${photo.id}`);
	let cat = $state(String(photo.category_id));
	let msg = $state('');
	let err = $state('');
	let busy = $state(false);
	const moving = $derived(cat !== String(photo.category_id));

	const submit = ({ action, cancel }: { action: URL; cancel: () => void }) => {
		if (action.search.includes('delete') && !confirm('Delete this photo for good?')) return cancel();
		busy = true;
		msg = err = '';
		return async ({ result }: { result: any }) => {
			busy = false;
			if (result.type === 'success') {
				msg = result.data?.moved ? `Moved to ${result.data.moved}.` : 'Saved.';
				await invalidateAll();
			} else if (result.type === 'failure') err = result.data?.error ?? 'That didn’t work.';
			else if (result.type === 'redirect') await goto(result.location, { invalidateAll: true });
			else err = 'That didn’t work.';
		};
	};
</script>

<form method="POST" action="{action}?/claims" class="stack" use:enhance={submit}>
	{#if categories.length > 1}
		<label>Category
			<select name="category" bind:value={cat}>
				{#each categories as c}<option value={String(c.id)}>{c.name}</option>{/each}
			</select>
		</label>
	{/if}
	{#if moving}
		<p class="muted small" style="margin:0">Moving clears the photo's points. The host sets them again.</p>
	{:else if canScore}
		<ClaimFields {options} {claims} />
		<AlsoFields options={also} {claims} />
	{/if}
	<label>Caption <input name="caption" maxlength="200" defaultValue={photo.caption} /></label>
	{#if msg}<p class="ok small" style="margin:0">{msg}</p>{/if}
	{#if err}<p class="err small" style="margin:0">{err}</p>{/if}
	<button class="primary" disabled={busy}>{moving ? 'Move photo' : 'Save'}</button>
</form>
<form method="POST" action="{action}?/delete{context ? `&${context.slice(1)}` : ''}" use:enhance={submit}>
	<button class="danger block sm" disabled={busy}>Delete photo</button>
</form>
