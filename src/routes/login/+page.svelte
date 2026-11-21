<script lang="ts">
	import { passkeySignIn } from '#lib/passkey.ts';
	import Turnstile from '#lib/components/Turnstile.svelte';
	let { data, form } = $props();
	// Fixed when the page loads, so a redraw can never write it back over what was typed or autofilled.
	const startEmail = form?.email ?? data.email;
	let busy = $state(false);
	let passkeyFailed = $state(false);
	// A new email: the server asked for a name, so there's no passkey to try.
	const signingUp = !!form?.needName;
	let useCode = signingUp;

	// Email first. If this person saved a passkey we ask for it; otherwise the form posts and a code is emailed.
	// The field is left to the browser (no binding) so autofill and password managers can't be overwritten,
	// and its value is read from the form at the moment of submitting.
	async function submit(e: SubmitEvent) {
		if (useCode) return;
		e.preventDefault();
		const formEl = e.currentTarget as HTMLFormElement;
		const email = String(new FormData(formEl).get('email') ?? '').trim();
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

	// Coming back with the Back button restores this page as it was left; make it usable again.
	function restored(e: PageTransitionEvent) {
		if (!e.persisted) return;
		busy = false;
		useCode = signingUp;
	}
</script>

<svelte:window onpageshow={restored} />

<main>
	<h1>{signingUp ? 'New here? Welcome!' : 'Sign in'}</h1>
	<form method="POST" class="card stack" onsubmit={submit}>
		<input type="hidden" name="next" value={data.next} />
		<label>
			Email
			<input
				name="email"
				type="email"
				defaultValue={startEmail}
				autocomplete="email"
				inputmode="email"
				autocapitalize="none"
				autocorrect="off"
				spellcheck="false"
				required
			/>
		</label>
		{#if signingUp}
			<label>Your name <input name="name" defaultValue={form?.name ?? ''} autocomplete="name" autocapitalize="words" required maxlength="40" /></label>
			<Turnstile />
		{/if}
		{#if form?.error && !passkeyFailed}<p class="err">{form.error}</p>{/if}
		{#if passkeyFailed}
			<p class="err">Your passkey didn’t work on this device.</p>
			<button class="primary" disabled={busy}>Try the passkey again</button>
			<button disabled={busy} onclick={() => (useCode = true)}>Email me a code instead</button>
		{:else}
			<button class="primary" disabled={busy}>{busy ? 'Signing in…' : signingUp ? 'Create my account' : 'Sign in'}</button>
			<p class="muted small" style="margin:0">
				{#if signingUp}We’ll email you a six-digit code to confirm the address.
				{:else}If you saved a passkey, your phone will ask for it. Otherwise we’ll email you a six-digit code.
					{#if data.signups}New? Enter your email and we’ll set you up.{/if}{/if}
			</p>
		{/if}
	</form>
</main>
