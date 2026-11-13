<script lang="ts">
	import { passkeySignIn } from '#lib/passkey.ts';
	let { data, form } = $props();
	let email = $state(form?.email ?? '');
	let busy = $state(false);
	let checked = false;

	// Someone who already has a passkey is signed in with it; everyone else goes through the form.
	async function submit(e: SubmitEvent) {
		if (checked) return;
		e.preventDefault();
		const formEl = e.currentTarget as HTMLFormElement;
		busy = true;
		if ((await passkeySignIn(email)) === 'ok') {
			location.href = `/join/${data.game.code}`;
			return;
		}
		checked = true;
		formEl.requestSubmit();
	}
</script>

<main>
	<p class="muted">You're invited to</p>
	<h1>{data.game.name}</h1>
	<form method="POST" class="card stack" onsubmit={submit}>
		<label>Your name <input name="name" value={form?.name ?? ''} autocomplete="given-name" required maxlength="40" /></label>
		<label>
			Email
			<input name="email" type="email" bind:value={email} autocomplete="email" inputmode="email" required />
		</label>
		<p class="muted small">Your email is only used to sign you back in on another phone.</p>
		{#if form?.error}<p class="err">{form.error}</p>{/if}
		<button class="primary" disabled={busy}>Join the game</button>
	</form>
	<p class="muted small">Already playing? <a href="/login?next=/join/{data.game.code}">Sign in</a></p>
</main>
