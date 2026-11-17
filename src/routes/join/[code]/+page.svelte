<script lang="ts">
	import { passkeySignIn } from '#lib/passkey.ts';
	import Turnstile from '#lib/components/Turnstile.svelte';
	let { data, form } = $props();
	// Starting values are fixed when the page loads. Tying them to page state made Svelte write them
	// back into the fields on every redraw, wiping whatever had been typed or autofilled.
	const start = { name: form?.name ?? '', email: form?.email ?? '' };
	let busy = $state(false);
	let checked = false;

	// Someone who already has a passkey is signed in with it; everyone else goes through the form.
	// Fields are left to the browser (no binding) so autofill can't be overwritten.
	async function submit(e: SubmitEvent) {
		if (checked) return;
		e.preventDefault();
		const formEl = e.currentTarget as HTMLFormElement;
		busy = true;
		if ((await passkeySignIn(String(new FormData(formEl).get('email') ?? '').trim())) === 'ok') {
			location.href = `/join/${data.game.code}`;
			return;
		}
		checked = true;
		formEl.requestSubmit();
	}
	function restored(e: PageTransitionEvent) {
		if (!e.persisted) return;
		busy = false;
		checked = false;
	}
</script>

<svelte:window onpageshow={restored} />

<main>
	<p class="muted">You're invited to</p>
	<h1>{data.game.name}</h1>
	<form method="POST" class="card stack" onsubmit={submit}>
		<label>Your name <input name="name" defaultValue={start.name} autocomplete="name" autocapitalize="words" required maxlength="40" /></label>
		<label>
			Email
			<input
				name="email"
				type="email"
				defaultValue={start.email}
				autocomplete="email"
				inputmode="email"
				autocapitalize="none"
				autocorrect="off"
				spellcheck="false"
				required
			/>
		</label>
		<Turnstile />
		<p class="muted small">Your email is only used to sign you back in on another phone.</p>
		{#if form?.error}<p class="err">{form.error}</p>{/if}
		<button class="primary" disabled={busy}>{busy ? 'Joining…' : 'Join the game'}</button>
	</form>
	<p class="muted small">Already playing? <a href="/login?next=/join/{data.game.code}">Sign in</a></p>
</main>
