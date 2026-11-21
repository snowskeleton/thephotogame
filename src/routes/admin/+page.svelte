<script lang="ts">
	import { plural } from '#lib/format.ts';
	let { data, form } = $props();
	const size = (b: number) => (b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : `${Math.round(b / 1e6)} MB`);
	const total = $derived(data.games.reduce((s, g) => s + g.bytes, 0));
</script>

<main>
	<h1>Site admin</h1>
	{#if form?.error}<p class="err">{form.error}</p>{/if}

	<a class="card spread" href="/admin/settings" style="text-decoration:none">
		<span>
			<strong>Settings</strong><br />
			<span class="muted small">
				{data.mailReady ? 'Email is set up' : 'Email isn’t set up yet'} ·
				public sign-ups {data.settings.signups ? 'on' : 'off'} · limits
			</span>
		</span>
		<span aria-hidden="true">›</span>
	</a>
	<a class="card spread" href="/admin/users" style="text-decoration:none">
		<span>
			<strong>People</strong><br />
			<span class="muted small">{plural(data.people.n, 'person')}, {plural(data.people.admins, 'site admin')}. Add people, fix sign-in.</span>
		</span>
		<span aria-hidden="true">›</span>
	</a>

	<h2 style="margin-top:22px">All games <span class="muted small">{size(total)} of photos</span></h2>
	{#each data.games as g}
		<a class="card spread" href="/g/{g.code}/admin" style="text-decoration:none">
			<span>
				<strong>{g.name}</strong><br />
				<span class="muted small">{g.host ? `${g.host} · ` : ''}{g.players} players · {g.photos} photos · {size(g.bytes)}</span>
			</span>
			<span class="pill">{g.code}</span>
		</a>
	{/each}
	<form method="POST" action="?/newGame" class="card stack">
		<label>New game <input name="name" required maxlength="80" placeholder="Cancún 2027" /></label>
		<button class="primary">Create game</button>
	</form>
</main>
