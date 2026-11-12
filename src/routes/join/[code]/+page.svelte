<script lang="ts">
	let { data, form } = $props();
</script>

<main>
	<p class="muted">You're invited to</p>
	<h1>{data.game.name}</h1>
	<form method="POST" class="card stack">
		<label>Your name <input name="name" value={form?.name ?? ''} autocomplete="given-name" required maxlength="40" /></label>
		<label>
			Email
			<input name="email" type="email" value={form?.email ?? ''} autocomplete="email" inputmode="email" required />
		</label>
		<p class="muted small">Your email is only used to sign you back in on another phone.</p>
		{#if form?.error}<p class="err">{form.error}</p>{/if}
		<button class="primary">Join the game</button>
	</form>
	<p class="muted small">Already playing? <a href="/login?next=/join/{data.game.code}">Sign in</a></p>
</main>
