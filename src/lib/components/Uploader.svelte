<script lang="ts">
	import { deserialize } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { plural } from '#lib/format.ts';
	import type { Snippet } from 'svelte';

	let {
		action = '',
		label = '📷 Take or choose photos',
		auto = false,
		fields
	}: {
		/** Form action URL, e.g. "?/upload". */
		action?: string;
		label?: string;
		/** Start uploading as soon as photos are picked (no Submit button). */
		auto?: boolean;
		/** Extra fields sent with every photo (claims, caption). */
		fields?: Snippet;
	} = $props();

	let formEl: HTMLFormElement;
	let input: HTMLInputElement;
	let picked = $state(0);
	let done = $state(0);
	let total = $state(0);
	let busy = $state(false);
	let added = $state(0);
	let errors = $state<string[]>([]);

	function onpick() {
		picked = input.files?.length ?? 0;
		added = 0;
		errors = [];
		if (auto && picked) formEl.requestSubmit();
	}

	// One request per photo: a phone's camera roll can be hundreds of MB, and this way one bad
	// file or a dropped connection only costs that photo.
	async function onsubmit(e: SubmitEvent) {
		e.preventDefault();
		const files = [...(input.files ?? [])];
		if (!files.length || busy) return;
		busy = true;
		done = 0;
		total = files.length;
		added = 0;
		errors = [];
		const base = new FormData(formEl);
		base.delete('photo');
		for (const file of files) {
			const fd = new FormData();
			for (const [k, v] of base) fd.append(k, v);
			fd.append('photo', file);
			try {
				const res = await fetch(formEl.action, {
					method: 'POST',
					body: fd,
					headers: { accept: 'application/json', 'x-sveltekit-action': 'true' }
				});
				const result = deserialize(await res.text());
				if (result.type === 'success') added++;
				else if (result.type === 'failure') errors.push(String(result.data?.error ?? `“${file.name}” didn’t upload.`));
				else errors.push(`“${file.name}” didn’t upload.`);
			} catch {
				errors.push(`“${file.name}” didn’t upload. Check your connection and try it again.`);
			}
			done++;
		}
		input.value = '';
		picked = 0;
		busy = false;
		await invalidateAll();
	}
</script>

<form bind:this={formEl} method="POST" {action} enctype="multipart/form-data" class="stack" {onsubmit}>
	<label class="btn team block" class:disabled={busy}>
		{#if busy}Uploading {Math.min(done + 1, total)} of {total}…
		{:else if picked && !auto}{plural(picked, 'photo')} chosen — tap to change
		{:else}{label}{/if}
		<input bind:this={input} type="file" name="photo" accept="image/jpeg,image/png,image/webp" multiple required hidden
			disabled={busy} onchange={onpick} />
	</label>
	{#if busy}<progress max={total} value={done}></progress>{/if}
	{@render fields?.()}
	{#if added && !busy}<p class="ok" style="margin:0">{plural(added, 'photo')} added.</p>{/if}
	{#each errors as err}<p class="err" style="margin:0">{err}</p>{/each}
	{#if !auto}<button class="primary" disabled={busy || !picked}>{busy ? 'Uploading…' : 'Submit'}</button>
	{:else}<noscript><button class="primary">Upload</button></noscript>{/if}
</form>

<style>
	progress { width: 100%; height: 8px; accent-color: var(--team); }
	.disabled { opacity: 0.7; pointer-events: none; }
</style>
