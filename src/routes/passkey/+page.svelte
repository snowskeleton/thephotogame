<script lang="ts">
	import { onMount } from 'svelte';
	import { passkeySave, passkeysSupported } from '#lib/passkey.ts';
	let { data } = $props();
	let busy = $state(false);
	let error = $state('');
	let done: HTMLFormElement;

	onMount(() => {
		// Nothing to offer on a browser without passkeys: carry straight on.
		if (!passkeysSupported()) location.replace(data.next);
	});

	async function save() {
		busy = true;
		error = '';
		const result = await passkeySave();
		if (result === 'ok' || result === 'exists') {
			done.requestSubmit();
			return;
		}
		if (result === 'failed') error = 'Couldn’t save a passkey on this device. You can carry on without one.';
		busy = false;
	}
</script>

<main>
	<h1>You’re in! One quick thing</h1>
	<div class="card stack">
		<p style="margin:0"><strong>Skip the email code next time.</strong></p>
		<p class="muted" style="margin:0">
			Save a passkey and this device signs you in with Face ID, your fingerprint or your screen lock.
		</p>
		{#if error}<p class="err">{error}</p>{/if}
		<button class="primary" onclick={save} disabled={busy}>{busy ? 'Saving…' : 'Save a passkey'}</button>
		<form method="POST">
			<input type="hidden" name="next" value={data.next} />
			<button class="block" disabled={busy}>Not now</button>
		</form>
		<p class="muted small" style="margin:0">Until you save one, we’ll ask each time you sign in.</p>
	</div>
	<form method="POST" bind:this={done} hidden>
		<input type="hidden" name="next" value={data.next} />
		<input type="hidden" name="saved" value="1" />
	</form>
</main>
