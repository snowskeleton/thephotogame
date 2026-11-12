<script lang="ts">
	let { data, form } = $props();
</script>

<main>
	{#if data.user}
		<h1>Your games</h1>
		{#each data.games as g}
			<a class="card spread" href="/g/{g.code}" style="text-decoration:none">
				<strong>{g.name}</strong><span class="pill">{g.code}</span>
			</a>
		{:else}
			<p class="muted">You aren't in a game yet. Enter a game code below, or open your join link.</p>
		{/each}
		{#if data.user.is_admin}
			<a class="btn" href="/admin">Admin: games &amp; users</a>
		{/if}
	{:else}
		<h1>Find it. Snap it. Win it.</h1>
		<p class="muted">A photo scavenger hunt for the whole family.</p>
	{/if}

	<form method="POST" class="card stack" style="margin-top:16px">
		<label>Game code <input name="code" autocapitalize="characters" autocomplete="off" required /></label>
		{#if form?.error}<p class="err">{form.error}</p>{/if}
		<button class="primary">Join a game</button>
	</form>
</main>
