<script lang="ts">
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { startRegistration } from '@simplewebauthn/browser';
	let { data, form } = $props();
	let pkMsg = $state('');
	let pkErr = $state('');

	async function addPasskey() {
		pkMsg = pkErr = '';
		try {
			const options = await (await fetch('/auth/passkey/register-options', { method: 'POST' })).json();
			const response = await startRegistration({ optionsJSON: options });
			const res = await fetch('/auth/passkey/register-verify', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(response)
			});
			if (!res.ok) throw new Error((await res.json()).message);
			pkMsg = 'Passkey saved. Next time, tap “Use a passkey” to sign in.';
			invalidateAll();
		} catch (e: any) {
			if (e?.name === 'InvalidStateError') pkMsg = 'This device already has a passkey for you.';
			else if (e?.name !== 'NotAllowedError') pkErr = e?.message || 'Couldn’t save a passkey on this device.';
		}
	}
</script>

<main>
	<h1>Your account</h1>

	<form method="POST" action="?/name" class="card stack" use:enhance>
		<label>Name <input name="name" value={data.user?.name} maxlength="40" required /></label>
		<p class="muted small">Signed in as {data.user?.email}</p>
		{#if form?.error}<p class="err">{form.error}</p>{/if}
		{#if form?.saved}<p class="ok">Saved.</p>{/if}
		<button>Save name</button>
	</form>

	<div class="card stack">
		<h2>Passkey</h2>
		<p class="muted small">Sign in with Face ID, fingerprint or your screen lock instead of an email code.</p>
		{#each data.passkeys as p, i}
			<form method="POST" action="?/forget" class="spread" use:enhance>
				<span>Passkey {i + 1} <span class="muted small">added {new Date(p.created_at).toLocaleDateString()}</span></span>
				<input type="hidden" name="id" value={p.id} />
				<button class="sm danger">Remove</button>
			</form>
		{/each}
		<button class="primary" onclick={addPasskey}>Save a passkey on this device</button>
		{#if pkMsg}<p class="ok">{pkMsg}</p>{/if}
		{#if pkErr}<p class="err">{pkErr}</p>{/if}
	</div>

	<div class="card stack">
		<h2>Sign in on another device</h2>
		{#if form?.qr}
			<img src={form.qr} alt="Sign-in QR code" style="width:100%;max-width:280px;margin:0 auto;border-radius:12px" />
			<p class="muted small">Scan this with the other device's camera. It works once, for 10 minutes.</p>
		{:else}
			<p class="muted small">Show a QR code here, scan it with the other phone or tablet, and it signs in as you.</p>
			<form method="POST" action="?/qr" use:enhance><button class="block">Show QR code</button></form>
		{/if}
	</div>

	<form method="POST" action="/logout"><button class="danger block">Sign out</button></form>
</main>
