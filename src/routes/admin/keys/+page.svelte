<script lang="ts">
	const date = (ms: number) => new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
	let { data, form } = $props();
</script>

<main>
	<p class="small"><a href="/admin">‹ Admin</a></p>
	<h1>API keys</h1>
	<p class="muted small">
		A key lets a script or assistant act on the site as <strong>you</strong>, with only the permissions you tick. It can never do
		more than you can, and it stops working if you lose your admin rights.
		{#if !data.owner}Owner-only permissions are greyed out.{/if}
	</p>

	{#if form?.token}
		<div class="card stack">
			<h2>New key: {form.name}</h2>
			<p class="ok" style="margin:0">Copy it now. It is shown once and can’t be recovered.</p>
			<input readonly value={form.token} onfocus={(e) => e.currentTarget.select()} style="font-family:monospace" />
		</div>
	{/if}
	{#if form?.error}<p class="err">{form.error}</p>{/if}

	<form method="POST" action="?/mint" class="card stack">
		<h2>Make a key</h2>
		<label>Name <input name="name" required maxlength="60" placeholder="Hermes assistant" /></label>
		<fieldset class="stack" style="border:0;padding:0;margin:0">
			<legend class="small muted">Permissions</legend>
			{#each data.scopes as s}
				<label class="check" style={s.ok ? '' : 'opacity:.5'}>
					<input type="checkbox" name="scope" value={s.id} disabled={!s.ok} />
					<span><strong>{s.label}</strong><br /><span class="muted small">{s.help}</span></span>
				</label>
			{/each}
		</fieldset>
		<label>
			Limit to one game (optional)
			<select name="game">
				<option value="">All games</option>
				{#each data.games as g}<option value={g.id}>{g.name} ({g.code})</option>{/each}
			</select>
		</label>
		<label>
			Expires
			<select name="days">
				<option value="30">in 30 days</option>
				<option value="90">in 90 days</option>
				<option value="365">in a year</option>
				<option value="">never</option>
			</select>
		</label>
		<button class="primary">Make key</button>
	</form>

	<h2 style="margin-top:22px">{data.owner ? 'All keys' : 'Your keys'}</h2>
	{#each data.keys as k (k.id)}
		<div class="card spread" style={k.revoked_at ? 'opacity:.55' : ''}>
			<span>
				<strong>{k.name}</strong> <span class="muted small">…{k.hint}</span>
				{#if k.revoked_at}<span class="pill">revoked</span>{:else if k.expires_at && k.expires_at < Date.now()}<span class="pill">expired</span>{/if}
				<br />
				<span class="muted small">
					{k.scopes.join(', ')}{k.game_name ? ` · only ${k.game_name}` : ''}<br />
					{#if k.user_id !== data.me}by {k.owner_name} · {/if}made {date(k.created_at)}
					{k.expires_at ? ` · expires ${date(k.expires_at)}` : ' · never expires'}
					{k.last_used_at ? ` · last used ${date(k.last_used_at)}` : ' · never used'}
				</span>
			</span>
			{#if !k.revoked_at}
				<form method="POST" action="?/revoke">
					<input type="hidden" name="id" value={k.id} />
					<button class="sm danger">Revoke</button>
				</form>
			{/if}
		</div>
	{:else}
		<p class="muted">No keys yet.</p>
	{/each}
</main>
