<script lang="ts">
	let { data, form } = $props();
</script>

<main>
	{#if data.invite}
		<p class="muted">{data.invite.from ?? 'Someone'} invited you to</p>
		<h1>{data.invite.game ?? 'The Photo Game'}</h1>
		<form method="POST" class="card stack">
			<p style="margin:0">Hi {data.invite.name}! Accept to sign in as <strong>{data.invite.email}</strong>{data.invite.game ? ' and join the game' : ''}.</p>
			{#if data.otherUser}
				<p class="muted small" style="margin:0">You’re signed in here as {data.otherUser}. Accepting switches this device to {data.invite.name}.</p>
			{/if}
			<p class="muted small" style="margin:0">Next we’ll help you save a passkey, so this phone can sign you in with Face ID or your fingerprint.</p>
			{#if form?.error}<p class="err">{form.error}</p>{/if}
			<button class="primary">Accept invite</button>
		</form>
	{:else}
		<h1>This invite has run out</h1>
		<p class="muted">It was already used or is more than a week old. Ask whoever invited you for a new one, or <a href="/login">sign in with your email</a>.</p>
	{/if}
</main>
