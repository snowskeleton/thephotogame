<script lang="ts">
	import { enhance } from '$app/forms';
	let { data, form } = $props();
</script>

<main>
	<h1>Admin</h1>
	{#if form?.error}<p class="err">{form.error}</p>{/if}

	<h2>Games</h2>
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

	<h2 style="margin-top:22px">Users</h2>
	{#if form?.signin}
		<div class="card stack" style="border-color:var(--accent);border-width:2px">
			<h3 style="margin:0">Sign-in for {form.signin.name}</h3>
			<img src={form.signin.qr} alt="Sign-in QR code" style="width:220px;margin:0 auto;border-radius:12px" />
			<input readonly value={form.signin.link} onfocus={(e) => e.currentTarget.select()} />
			<p class="muted small" style="margin:0">Works once, for 24 hours.</p>
		</div>
	{/if}
	{#each data.users as u}
		<details class="card">
			<summary>
				{u.name} {#if u.is_admin}<span class="pill">admin</span>{/if}
				<span class="muted small">{u.email}</span>
			</summary>
			<form method="POST" action="?/saveUser" class="stack" style="margin-top:12px" use:enhance>
				<input type="hidden" name="id" value={u.id} />
				<label>Name <input name="name" value={u.name} required maxlength="40" /></label>
				<label>Email <input name="email" type="email" value={u.email} required /></label>
				<label class="check"><input type="checkbox" name="is_admin" checked={!!u.is_admin} disabled={u.id === data.me} /> Admin (can run every game)</label>
				{#if form?.saved === u.id}<p class="ok">Saved.</p>{/if}
				<button>Save</button>
			</form>
			<p class="muted small" style="margin:10px 0 6px">In {u.games} game{u.games === 1 ? '' : 's'} · {u.passkeys} passkey{u.passkeys === 1 ? '' : 's'}</p>
			<div class="row">
				<form method="POST" action="?/signin" use:enhance><input type="hidden" name="id" value={u.id} /><button class="sm">Sign-in QR</button></form>
				<form method="POST" action="?/signout" use:enhance onsubmit={(e) => { if (!confirm(`Sign ${u.name} out everywhere and remove their passkeys?`)) e.preventDefault(); }}>
					<input type="hidden" name="id" value={u.id} /><button class="sm">Sign out everywhere</button></form>
				{#if u.id !== data.me}
					<form method="POST" action="?/deleteUser" onsubmit={(e) => { if (!confirm(`Delete ${u.name} and all their photos?`)) e.preventDefault(); }}>
						<input type="hidden" name="id" value={u.id} /><button class="sm danger">Delete</button></form>
				{/if}
			</div>
		</details>
	{/each}
</main>
