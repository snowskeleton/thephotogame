<script lang="ts">
	import CopyLink from '#lib/components/CopyLink.svelte';
	import { enhance } from '$app/forms';
	import { plural } from '#lib/format.ts';
	let { data, form } = $props();
	const u = $derived(data.u);
	const date = (ms: number) => new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
	const ask = (msg: string) => (e: SubmitEvent) => {
		if (!confirm(msg)) e.preventDefault();
	};
</script>

<main>
	<p class="small"><a href="/admin/users">‹ People</a></p>
	<h1>{u.name} {#if u.is_admin}<span class="pill">site admin</span>{/if}</h1>
	<p class="muted small">
		Added {date(u.created_at)} ·
		{u.last_seen_at ? `last active ${date(u.last_seen_at)}` : 'hasn’t signed in yet'} ·
		{plural(data.photos, 'photo')} ·
		{u.email_verified_at ? 'email confirmed' : 'email not confirmed'}
	</p>

	{#if data.added}
		<p class="ok">
			{u.name} was added.
			{#if data.invited === '1'}An invite is on its way to {u.email}.
			{:else}The invite email couldn’t be sent, so give them a sign-in link below.{/if}
		</p>
	{/if}
	{#if form?.error}<p class="err">{form.error}</p>{/if}

	<form method="POST" action="?/save" class="card stack" use:enhance>
		<label>Name <input name="name" defaultValue={u.name} required maxlength="40" /></label>
		<label>Email <input name="email" type="email" defaultValue={u.email} required /></label>
		<label class="check">
			<input type="checkbox" name="is_admin" checked={!!u.is_admin} disabled={data.isMe} />
			Site admin (can run every game, manage people and change settings)
		</label>
		{#if data.isMe}<p class="muted small" style="margin:0">This is you. Another site admin has to change your site admin rights.</p>{/if}
		{#if form?.saved}<p class="ok">Saved.</p>{/if}
		<button class="primary">Save</button>
	</form>

	<div class="card stack">
		<h2>Games</h2>
		{#each data.memberships as m}
			<div class="stack" style="gap:6px">
				<div class="spread">
					<span>
						<a href="/g/{m.code}/admin/teams"><strong>{m.name}</strong></a>
						{#if m.role === 'host'}<span class="pill">host</span>{/if}
						{#if m.status === 'invited'}<span class="pill warn">invited</span>{/if}
					</span>
					<form method="POST" action="?/leaveGame" use:enhance onsubmit={ask(`Take ${u.name} out of ${m.name}? Their photos stay.`)}>
						<input type="hidden" name="game" value={m.game_id} />
						<button class="sm danger">Remove</button>
					</form>
				</div>
				<form method="POST" action="?/setTeam" use:enhance>
					<input type="hidden" name="game" value={m.game_id} />
					<select name="team" aria-label="Team in {m.name}" onchange={(e) => e.currentTarget.form?.requestSubmit()}>
						<option value="" selected={!m.team_id}>No team</option>
						{#each data.teams.filter((t) => t.game_id === m.game_id) as t}
							<option value={t.id} selected={t.id === m.team_id}>{t.name}</option>
						{/each}
					</select>
				</form>
			</div>
		{:else}
			<p class="muted small" style="margin:0">Not in a game yet.</p>
		{/each}
		{#if data.otherGames.length}
			<form method="POST" action="?/addToGame" class="row" use:enhance>
				<select name="game" class="grow" aria-label="Game to add to">
					{#each data.otherGames as g}<option value={g.id}>{g.name}</option>{/each}
				</select>
				<button>Invite to game</button>
			</form>
		{/if}
	</div>

	<div class="card stack">
		<h2>Sign-in</h2>
		<p class="muted small" style="margin:0">
			Signed in on {plural(data.devices, 'device')} · {plural(data.passkeys.length, 'passkey')}
		</p>
		{#if form?.link}
			<img src={form.qr} alt="Sign-in QR code" style="width:220px;margin:0 auto;border-radius:12px" />
			<CopyLink value={form.link} label="Sign-in link" shareText={`Sign in to The Photo Game as ${u.name}`} />
			<p class="muted small" style="margin:0">Signs in as {u.name}. Works once, for 24 hours.</p>
		{/if}
		{#if form?.emailed}<p class="ok">Invite sent to {u.email}.</p>{/if}
		{#if form?.signedOut}<p class="ok">Signed out on every device.</p>{/if}
		<div class="row">
			<form method="POST" action="?/link" use:enhance><button>Show sign-in link &amp; QR</button></form>
			{#if data.mailReady}
				<form method="POST" action="?/email" use:enhance><button>Email an invite link</button></form>
			{/if}
			{#if data.devices}
				<form method="POST" action="?/signout" use:enhance onsubmit={ask(`Sign ${u.name} out on every device?`)}>
					<button>Sign out everywhere</button>
				</form>
			{/if}
		</div>
		{#each data.passkeys as p, i}
			<form method="POST" action="?/forget" class="spread" use:enhance onsubmit={ask('Remove this passkey?')}>
				<span>Passkey {i + 1} <span class="muted small">added {date(p.created_at)}</span></span>
				<input type="hidden" name="key" value={p.id} />
				<button class="sm danger">Remove</button>
			</form>
		{/each}
	</div>

	{#if !data.isMe}
		<form method="POST" action="?/delete" onsubmit={ask(`Delete ${u.name} and their ${plural(data.photos, 'photo')}? This can’t be undone.`)}>
			<button class="danger block">Delete {u.name}</button>
		</form>
	{/if}
</main>
