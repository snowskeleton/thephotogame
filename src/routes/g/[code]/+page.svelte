<script lang="ts">
	import ColorPicker from '#lib/components/ColorPicker.svelte';
	import { tv } from '#lib/colors.ts';
	import { enhance } from '$app/forms';
	import { pts, plural } from '#lib/format.ts';
	let { data, form } = $props();
	const base = $derived(`/g/${data.game.code}`);
	let list = $state(false);
	const asList = $derived(list || (!data.game.bingo && data.categories.length > 12));
	const mine = $derived(new Map(data.mine.map((m) => [m.category_id, m])));
	const others = $derived.by(() => {
		const m = new Map<number, string[]>();
		for (const o of data.others) m.set(o.category_id, [...(m.get(o.category_id) ?? []), o.color]);
		return m;
	});
	const cols = $derived(data.game.bingo ? data.game.bingo_cols : 3);
</script>

{#if !data.team}
	<div class="card stack">
		{#if data.game.team_mode === 'self'}
			<h2>Pick your team</h2>
			{#if form?.error}<p class="err">{form.error}</p>{/if}
			{#each data.teams as t}
				{@const full = !!data.game.max_team_size && t.members >= data.game.max_team_size}
				<form method="POST" action="?/joinTeam" class="spread" use:enhance style="{tv(t.color)}">
					<input type="hidden" name="team" value={t.id} />
					<span class="row grow"><span class="dot"></span>
						<span class="grow"><strong>{t.name}</strong><br /><span class="muted small">{t.names ?? 'Nobody yet'}</span></span>
					</span>
					<span class="muted small">{t.members}{data.game.max_team_size ? `/${data.game.max_team_size}` : ''}</span>
					<button class="sm team" disabled={full}>{full ? 'Full' : 'Join'}</button>
				</form>
			{/each}
			<details open={data.teams.length === 0}>
				<summary>Start a new team</summary>
				<form method="POST" action="?/newTeam" class="stack" style="margin-top:10px" use:enhance>
					<label>Team name <input name="name" maxlength="40" required /></label>
					<ColorPicker taken={data.teams.map((t) => t.color)} />
					<button class="primary">Create team</button>
				</form>
			</details>
			<p class="muted small">Playing solo is fine: start a team of one.</p>
		{:else}
			<h2>You're in!</h2>
			<p class="muted">The showrunner will put you on a team soon. You can look around in the meantime.</p>
		{/if}
	</div>
{:else if data.score}
	<div class="card spread" style="border-color:var(--team);border-width:2px">
		<div><div class="muted small">Your team has</div><strong style="font-size:1.5rem">{pts(data.score.total)} pts</strong></div>
		<div style="text-align:right" class="small">
			{data.score.filled} of {data.categories.length} found
			{#if data.game.bingo}<br />{plural(data.score.lines, 'bingo line')}{/if}
		</div>
	</div>
{/if}

<div class="spread" style="margin-bottom:8px">
	<h2 style="margin:0">{data.game.bingo ? 'Bingo board' : 'Categories'}</h2>
	<button class="sm" onclick={() => (list = !list)}>{asList ? 'Grid' : 'List'}</button>
</div>

{#if data.categories.length === 0}
	<p class="muted">No categories yet. The showrunner is still setting things up.</p>
{:else if asList}
	<div class="card" style="padding:4px 14px">
		{#each data.categories as c}
			{@const m = mine.get(c.id)}
			<a class="spread listrow" href="{base}/c/{c.id}">
				<span class="check" class:done={m}>{m ? '✓' : ''}</span>
				<span class="grow"><strong>{c.name}</strong>
					{#if c.day_label}<span class="muted small"> · {c.day_label}</span>{/if}</span>
				<span class="row" style="gap:3px">{#each others.get(c.id) ?? [] as color}<span class="dot" style="{tv(color)};width:8px;height:8px"></span>{/each}</span>
				{#if m}<span class="pill team">{m.n}</span>{/if}
			</a>
		{/each}
	</div>
{:else}
	<div class="board" style="grid-template-columns:repeat({cols},1fr)">
		{#each data.categories as c}
			{@const m = mine.get(c.id)}
			<a class="cell" class:done={m} href="{base}/c/{c.id}"
				style={m ? `background-image:linear-gradient(rgba(0,0,0,.15),rgba(0,0,0,.6)),url(/media/${m.cover}/thumb)` : ''}>
				<span class="dots">{#each others.get(c.id) ?? [] as color}<span class="dot" style="{tv(color)};width:8px;height:8px"></span>{/each}</span>
				<span class="name">{c.name}</span>
				{#if m}<span class="badge">✓{m.n > 1 ? ` ${m.n}` : ''}</span>{/if}
			</a>
		{/each}
	</div>
	<p class="muted small" style="margin-top:10px">Small dots show which other teams have found a category.</p>
{/if}

<style>
	.board { display: grid; gap: 6px; }
	.cell {
		position: relative;
		aspect-ratio: 1;
		border-radius: 12px;
		border: 2px solid var(--line);
		background: var(--card) center / cover;
		display: flex;
		align-items: flex-end;
		padding: 6px;
		text-decoration: none;
		overflow: hidden;
	}
	.cell .name {
		font-size: clamp(0.62rem, 2.6vw, 0.88rem);
		font-weight: 700;
		line-height: 1.15;
		overflow-wrap: anywhere;
	}
	.cell.done { border-color: var(--team); border-width: 3px; color: #fff; }
	.cell .badge {
		position: absolute; top: 4px; right: 4px;
		background: var(--team-bg, var(--team)); color: var(--team-ink, #fff); border-radius: 999px;
		font-size: 0.7rem; font-weight: 800; padding: 1px 6px;
	}
	.cell .dots { position: absolute; top: 6px; left: 6px; display: flex; gap: 2px; }
	.listrow { padding: 11px 0; border-bottom: 1px solid var(--line); text-decoration: none; }
	.listrow:last-child { border-bottom: 0; }
	.check {
		width: 24px; height: 24px; border-radius: 7px; border: 2px solid var(--line);
		display: grid; place-items: center; font-weight: 800; flex: none; color: #fff;
	}
	.check.done { background: var(--team-bg, var(--team)); border-color: var(--team); color: var(--team-ink, #fff); }
</style>
