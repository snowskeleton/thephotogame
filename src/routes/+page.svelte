<script lang="ts">
	let { data, form } = $props();
</script>

<main>
	{#if data.user}
		{#if data.invited.length}
			<h1>You’re invited</h1>
			{#each data.invited as g}
				<a class="card spread" href="/join/{g.code}" style="text-decoration:none">
					<strong>{g.name}</strong><span class="btn sm primary">Join</span>
				</a>
			{/each}
		{/if}
		<h1>Your games</h1>
		{#each data.games as g}
			<a class="card spread" href="/g/{g.code}" style="text-decoration:none">
				<strong>{g.name}</strong>
				<span class="row" style="gap:6px">{#if g.role === 'host'}<span class="pill">host</span>{/if}<span class="pill">{g.code}</span></span>
			</a>
		{:else}
			<p class="muted">You aren't in a game yet. Enter a game code below, open your join link, or host your own.</p>
		{/each}
	{:else}
		<h1>Find it. Snap it. Win it.</h1>
		<p class="muted">A photo scavenger hunt for the whole family.</p>
	{/if}

	<form method="POST" action="?/join" class="card stack" style="margin-top:16px">
		<label>Game code <input name="code" autocapitalize="characters" autocomplete="off" required /></label>
		{#if form?.error}<p class="err">{form.error}</p>{/if}
		<button class="primary">Join a game</button>
	</form>

	{#if data.hosting && (data.hosting.ok || data.hosting.why !== 'closed')}
		<div class="card stack">
			<h2 style="margin:0">Host a game</h2>
			{#if data.hosting.ok}
				<form method="POST" action="?/newGame" class="stack">
					<label>Game name <input name="name" required maxlength="80" placeholder="Cancún 2027" /></label>
					{#if form?.hostError}<p class="err">{form.hostError}</p>{/if}
					<button class="primary">Create game</button>
				</form>
			{:else if data.hosting.why === 'unverified'}
				<p class="muted" style="margin:0">Confirm your email address first. We’ll send a six-digit code to {data.user?.email}.</p>
				<form method="POST" action="?/verify"><button class="primary block">Send me a code</button></form>
			{:else if data.hosting.why === 'limit'}
				<p class="muted" style="margin:0">You’ve created {data.hosting.limit} games, the most one person can host here.</p>
			{/if}
		</div>
	{:else if !data.user && data.signups}
		<p class="muted small">Want to run your own? <a href="/login">Sign up</a> and host a game.</p>
	{/if}

	{#if data.user?.is_admin}
		<a class="btn" href="/admin">Site admin: games, people &amp; settings</a>
	{/if}
</main>
