<script lang="ts">
	import { enhance } from '$app/forms';
	let { data, form } = $props();
	let kind = $state<'ember' | 'json'>('ember');
	const when = (t: number | null) => (t ? new Date(t).toLocaleString() : 'never');
	const confirmDel = (e: SubmitEvent) => { if (!confirm('Delete this webhook?')) e.preventDefault(); };
</script>

<h1>Webhooks</h1>
<p class="muted small">
	Tell a chat room or another service when something happens in this game. Players never see these settings.
	In a game that hides photos until a reveal, a webhook only gets photos that are already revealed, unless you tick the box below.
</p>

{#each data.hooks as h (h.id)}
	<div class="card stack">
		<div class="spread">
			<strong>{h.name}</strong>
			<span class="pill" class:warn={!h.active}>{h.active ? data.kinds[h.kind] : 'Paused'}</span>
		</div>
		<div class="muted small">
			{h.url} · {h.events.length} of {Object.keys(data.events).length} events{h.signed ? ' · signed' : ''}<br />
			Last sent: {when(h.last_at)}{h.last_status ? ` (${h.last_status})` : ''}
		</div>
		{#if form?.tested === h.id}<p class={form.result === 'Sent.' ? 'ok' : 'err'}>{form.result}</p>{/if}
		{#if form?.saved === h.id}<p class="ok">Saved.</p>{/if}
		{#if form?.id === h.id && form?.error}<p class="err">{form.error}</p>{/if}
		<form method="POST" action="?/test" class="row" use:enhance>
			<input type="hidden" name="id" value={h.id} />
			<button class="sm">Send a test</button>
		</form>
		<details>
			<summary class="small">Edit</summary>
			<form method="POST" action="?/save" class="stack" style="margin-top:10px" use:enhance={() => async ({ update }) => update({ reset: false })}>
				<input type="hidden" name="id" value={h.id} />
				<label>Name <input name="name" value={h.name} required maxlength="60" /></label>
				<label>New address <input name="url" type="url" placeholder="Leave blank to keep the current one" autocomplete="off" /></label>
				{#if h.kind === 'json'}
					<label>New signing secret <input name="secret" placeholder="Leave blank to keep the current one" autocomplete="off" /></label>
				{/if}
				<fieldset class="stack">
					<legend class="small">Send when</legend>
					{#each Object.entries(data.events) as [name, label]}
						<label class="row"><input type="checkbox" name="events" value={name} checked={h.events.includes(name as never)} /> {label}</label>
					{/each}
				</fieldset>
				<label class="row"><input type="checkbox" name="active" checked={h.active} /> Active</label>
				<label class="row"><input type="checkbox" name="hidden_ok" checked={h.hidden_ok} /> Send photos even while this game hides them from other teams</label>
				<button>Save</button>
			</form>
			<form method="POST" action="?/delete" style="margin-top:8px" onsubmit={confirmDel} use:enhance>
				<input type="hidden" name="id" value={h.id} />
				<button class="sm danger">Delete webhook</button>
			</form>
		</details>
	</div>
{/each}

<details class="card" open={data.hooks.length === 0}>
	<summary>Add a webhook</summary>
	<form method="POST" action="?/add" class="stack" style="margin-top:12px" use:enhance>
		<label>Name <input name="name" required maxlength="60" placeholder="Family chat" /></label>
		<label>Sends to
			<select name="kind" bind:value={kind}>
				{#each Object.entries(data.kinds) as [k, label]}<option value={k}>{label}</option>{/each}
			</select>
		</label>
		<label>Address
			<input name="url" type="url" required autocomplete="off"
				placeholder={kind === 'ember' ? 'https://chat.example.com/rooms/…/…/messages' : 'https://example.com/hook'} />
		</label>
		<p class="muted small">
			{#if kind === 'ember'}
				The bot address from the room’s Chat bots page. New photos arrive as pictures, and points, disqualifications and the rest are comments in each photo’s thread.
			{:else}
				Each event is a JSON POST with the headers X-Photogame-Event and, if you set a secret, X-Photogame-Signature (sha256= and the HMAC of the body).
			{/if}
		</p>
		{#if kind === 'json'}
			<label>Signing secret (optional) <input name="secret" autocomplete="off" /></label>
		{/if}
		<fieldset class="stack">
			<legend class="small">Send when</legend>
			{#each Object.entries(data.events) as [name, label]}
				<label class="row"><input type="checkbox" name="events" value={name} checked /> {label}</label>
			{/each}
		</fieldset>
		<label class="row"><input type="checkbox" name="hidden_ok" /> Send photos even while this game hides them from other teams</label>
		{#if form?.error && form?.id === undefined}<p class="err">{form.error}</p>{/if}
		<button class="primary">Add webhook</button>
	</form>
</details>
