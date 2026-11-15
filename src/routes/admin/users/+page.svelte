<script lang="ts">
	import { plural } from '#lib/format.ts';
	let { data, form } = $props();
	// Fixed at load so redraws (searching, filtering) can't wipe a half-typed form.
	const start = { name: form?.name ?? '', email: form?.email ?? '' };
	let q = $state('');
	let show = $state<'all' | 'admins' | 'new'>('all');

	const never = $derived(data.users.filter((u) => !u.last_seen_at).length);
	const admins = $derived(data.users.filter((u) => u.is_admin).length);
	const shown = $derived(
		data.users.filter((u) => {
			if (show === 'admins' && !u.is_admin) return false;
			if (show === 'new' && u.last_seen_at) return false;
			const s = q.trim().toLowerCase();
			return !s || u.name.toLowerCase().includes(s) || u.email.toLowerCase().includes(s);
		})
	);

	function seen(ms: number | null) {
		if (!ms) return 'Hasn’t signed in yet';
		const days = Math.floor((Date.now() - ms) / 86400_000);
		if (days < 1) return 'Active today';
		if (days < 2) return 'Active yesterday';
		return `Active ${days} days ago`;
	}
</script>

<main>
	<p class="small"><a href="/admin">‹ Admin</a></p>
	<h1>People</h1>

	<details class="card" open={!!form?.error && !form?.report}>
		<summary>Add a person</summary>
		<form method="POST" action="?/add" class="stack" style="margin-top:12px">
			<label>Name <input name="name" defaultValue={start.name} required maxlength="40" autocomplete="off" /></label>
			<label>Email <input name="email" type="email" defaultValue={start.email} required autocomplete="off" /></label>
			<label class="check"><input type="checkbox" name="is_admin" /> Admin (can run every game and manage people)</label>
			{#if data.games.length}
				<label>
					Put them in a game
					<select name="game">
						<option value="">No game yet</option>
						{#each data.games as g}<option value={g.id}>{g.name}</option>{/each}
					</select>
				</label>
			{/if}
			<label class="check">
				<input type="checkbox" name="invite" checked={data.mailReady} disabled={!data.mailReady} /> Email them a sign-in link
			</label>
			{#if !data.mailReady}
				<p class="muted small" style="margin:0">Email isn’t set up on this server, so you’ll get a link or QR code to pass on instead.</p>
			{/if}
			{#if form?.error}
				<p class="err">
					{form.error}
					{#if form.existing}<a href="/admin/users/{form.existing}">Open their page</a>{/if}
				</p>
			{/if}
			<button class="primary">Add person</button>
		</form>
	</details>

	<details class="card" open={!!form?.report}>
		<summary>Add several at once</summary>
		<form method="POST" action="?/addMany" class="stack" style="margin-top:12px">
			<label>
				One person per line: name, then email
				<textarea name="list" rows="5" placeholder={'Laura Lyons, laura@example.com\nMiguel <miguel@example.com>'} required></textarea>
			</label>
			{#if data.games.length}
				<label>
					Put them in a game
					<select name="game">
						<option value="">No game yet</option>
						{#each data.games as g}<option value={g.id}>{g.name}</option>{/each}
					</select>
				</label>
			{/if}
			<label class="check">
				<input type="checkbox" name="invite" checked={data.mailReady} disabled={!data.mailReady} /> Email each new person a sign-in link
			</label>
			{#if form?.report}
				{@const r = form.report}
				<div class="small">
					<p class="ok">Added {plural(r.added.length, 'person')}{r.added.length ? `: ${r.added.join(', ')}` : ''}.</p>
					{#if r.already.length}
						<p>Already here{form.game ? ` (now in ${form.game})` : ''}: {r.already.join(', ')}.</p>
					{/if}
					{#if r.bad.length}<p class="err">No email found in: {r.bad.join(' · ')}</p>{/if}
					{#if r.mailFailed.length}<p class="err">Couldn’t email: {r.mailFailed.join(', ')}</p>{/if}
				</div>
			{/if}
			<button class="primary">Add people</button>
		</form>
	</details>

	<input type="search" placeholder="Search by name or email" bind:value={q} aria-label="Search people" style="margin:14px 0 10px" />
	<div class="subnav">
		<button class="sm" class:on={show === 'all'} onclick={() => (show = 'all')}>Everyone {data.users.length}</button>
		<button class="sm" class:on={show === 'admins'} onclick={() => (show = 'admins')}>Admins {admins}</button>
		<button class="sm" class:on={show === 'new'} onclick={() => (show = 'new')}>Not signed in yet {never}</button>
	</div>

	{#each shown as u (u.id)}
		<a class="card person" href="/admin/users/{u.id}">
			<span class="grow">
				<strong>{u.name}</strong>
				{#if u.is_admin}<span class="pill">admin</span>{/if}
				{#if u.id === data.me}<span class="muted small">you</span>{/if}
				<br />
				<span class="muted small email">{u.email}</span><br />
				<span class="muted small">
					{u.games || 'No game'} · {seen(u.last_seen_at)}{u.passkeys ? ' · passkey' : ''}
				</span>
			</span>
			<span aria-hidden="true">›</span>
		</a>
	{:else}
		<p class="muted">Nobody matches.</p>
	{/each}
</main>

<style>
	.person {
		display: flex;
		gap: 10px;
		align-items: center;
		text-decoration: none;
	}
	.email {
		overflow-wrap: anywhere;
	}
	.subnav button.on {
		background: var(--ink);
		color: var(--bg);
		border-color: var(--ink);
	}
	input[type='search'] {
		width: 100%;
	}
</style>
