<script lang="ts">
	let { form } = $props();
</script>

<main>
	<h1>Sign in on this device</h1>
	<form method="POST" class="card stack">
		<p>Tap below to sign in to The Photo Game here.</p>
		{#if form?.error}<p class="err">{form.error}</p>{/if}
		<button class="primary">Sign me in</button>
	</form>
</main>
