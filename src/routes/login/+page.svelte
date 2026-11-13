<script lang="ts">
	import { passkeySignIn } from '#lib/passkey.ts';
	let { data, form } = $props();
	let email = $state(form?.email ?? data.email);
	let busy = $state(false);
	let passkeyFailed = $state(false);
	let useCode = false;

	// Email first. If this person saved a passkey we ask for it; otherwise the form posts and a code is emailed.
	async function submit(e: SubmitEvent) {
		if (useCode) return;
		e.preventDefault();
		const formEl = e.currentTarget as HTMLFormElement;
		busy = true;
		passkeyFailed = false;
		const result = await passkeySignIn(email);
		if (result === 'ok') {
			location.href = data.next;
			return;
		}
		if (result === 'none') {
			useCode = true;
			formEl.requestSubmit();
			return;
		}
		passkeyFailed = true;
		busy = false;
	}
</script>

<main>
	<h1>Sign in</h1>
	<form method="POST" class="card stack" onsubmit={submit}>
		<input type="hidden" name="next" value={data.next} />
		<label>
			Email
			<input name="email" type="email" autocomplete="username webauthn" inputmode="email" required bind:value={email} />
		</label>
		{#if form?.error && !passkeyFailed}<p class="err">{form.error}</p>{/if}
		{#if passkeyFailed}
			<p class="err">Your passkey didn’t work on this device.</p>
			<button class="primary" disabled={busy}>Try the passkey again</button>
			<button disabled={busy} onclick={() => (useCode = true)}>Email me a code instead</button>
		{:else}
			<button class="primary" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
			<p class="muted small" style="margin:0">
				If you saved a passkey, your phone will ask for it. Otherwise we’ll email you a six-digit code.
			</p>
		{/if}
	</form>
</main>
