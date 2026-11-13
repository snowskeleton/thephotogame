<script lang="ts">
	import { plural } from '#lib/format.ts';
	let { data, form } = $props();
</script>

<main>
	<h1>Admin</h1>
	{#if form?.error}<p class="err">{form.error}</p>{/if}

	<a class="card spread" href="/admin/users" style="text-decoration:none">
		<span>
			<strong>People</strong><br />
			<span class="muted small">{plural(data.people.n, 'person')}, {plural(data.people.admins, 'admin')}. Add people, make admins, fix sign-in.</span>
		</span>
		<span aria-hidden="true">›</span>
	</a>

	<h2 style="margin-top:22px">Games</h2>
	{#each data.games as g}
		<a class="card spread" href="/g/{g.code}/admin" style="text-decoration:none">
			<span><strong>{g.name}</strong><br /><span class="muted small">{g.players} players · {g.photos} photos</span></span>
			<span class="pill">{g.code}</span>
		</a>
	{/each}
	<form method="POST" action="?/newGame" class="card stack">
		<label>New game <input name="name" required maxlength="80" placeholder="Cancún 2027" /></label>
		<button class="primary">Create game</button>
	</form>
</main>
