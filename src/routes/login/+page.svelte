<script lang="ts">
	import { startAuthentication } from '@simplewebauthn/browser';
	let { data, form } = $props();
	let busy = $state(false);
	let pkError = $state('');

	async function passkey() {
		busy = true;
		pkError = '';
		try {
			const options = await (await fetch('/auth/passkey/login-options', { method: 'POST' })).json();
			const response = await startAuthentication({ optionsJSON: options });
			const res = await fetch('/auth/passkey/login-verify', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(response)
			});
			if (!res.ok) throw new Error((await res.json()).message);
			location.href = data.next;
		} catch (e: any) {
			if (e?.name !== 'NotAllowedError') pkError = e?.message || 'That passkey didn’t work. Try an email code instead.';
		}
		busy = false;
	}
</script>

<main>
	<h1>Sign in</h1>
	<div class="card stack">
		<button class="primary" onclick={passkey} disabled={busy}>Use a passkey</button>
		{#if pkError}<p class="err">{pkError}</p>{/if}
		<p class="muted small">Face ID, fingerprint or screen lock, if you saved one on this device.</p>
	</div>
	<form method="POST" class="card stack">
		<input type="hidden" name="next" value={data.next} />
		<label>Or get a code by email <input name="email" type="email" autocomplete="email" inputmode="email" required /></label>
		{#if form?.error}<p class="err">{form.error}</p>{/if}
		<button>Email me a code</button>
	</form>
</main>
