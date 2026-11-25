<script lang="ts">
	import { tv } from '#lib/colors.ts';
	import { pts } from '#lib/format.ts';
	import Thumb from '#lib/components/Thumb.svelte';
	let { data } = $props();
	let tab = $state<'teams' | 'people'>('teams');
	const medal = (i: number) => ['🥇', '🥈', '🥉'][i] ?? `${i + 1}`;
</script>

<h1>Leaderboard</h1>
<div class="subnav">
	<button class="sm" class:primary={tab === 'teams'} onclick={() => (tab = 'teams')}>Teams</button>
	<button class="sm" class:primary={tab === 'people'} onclick={() => (tab = 'people')}>People</button>
</div>

{#if tab === 'teams'}
	{#each data.teams as t, i}
		<div class="card" style="{tv(t.color)};border-left:8px solid var(--team)">
			<div class="spread">
				<strong style="font-size:1.1rem">{medal(i)} {t.name}</strong>
				<strong style="font-size:1.4rem">{pts(t.total)}{#if t.pendingPts} <span class="muted small" style="font-weight:400">+{pts(t.pendingPts)} pending</span>{/if}</strong>
			</div>
			<div class="bar"><div style="width:{data.categoryCount ? (t.filled / data.categoryCount) * 100 : 0}%"></div></div>
			<div class="row small muted" style="gap:6px 14px">
				<span>{t.filled}/{data.categoryCount} categories</span>
				<span>📷 {pts(t.photoPts)}</span>
				{#if data.game.bingo}<span>🎯 {pts(t.bingoPts)} ({t.lines} lines)</span>{/if}
				{#if t.awardPts}<span>🗳️ {pts(t.awardPts)}</span>{/if}
				{#if t.grantPts}<span>🏅 {pts(t.grantPts)}</span>{/if}
			</div>
		</div>
	{:else}
		<p class="muted">No teams yet.</p>
	{/each}
	<p class="muted small">📷 photos · 🎯 bingo · 🗳️ voted awards · 🏅 showrunner awards</p>
{:else}
	<div class="card">
		<table>
			<thead><tr><th>Player</th><th class="n">Photos</th><th class="n">Pending</th><th class="n">Points</th></tr></thead>
			<tbody>
				{#each data.people as p}
					<tr style="{tv(p.color ?? 'var(--line)')}">
						<td><span class="dot"></span> {p.name} <span class="muted small">{p.team ?? 'no team'}</span></td>
						<td class="n">{p.photos}</td>
						<td class="n muted">{p.pending ? `+${pts(p.pending)}` : ''}</td>
						<td class="n"><strong>{pts(p.points)}</strong></td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
{/if}

{#if data.beyond.people.length || data.beyond.teams.length}
	<h2 style="margin-top:20px">Above and beyond</h2>
	<div class="card stack" data-testid="beyond">
		<p class="muted small" style="margin:0">Points earned past a category limit. They don't count, but they're a lot of effort.</p>
		{#each data.beyond.people as p}
			<div class="spread" style="{tv(p.color ?? 'var(--line)')}"><span><span class="dot"></span> {p.name} <span class="muted small">{p.team ?? ''}</span></span><strong>+{pts(p.over)} over</strong></div>
		{/each}
		{#each data.beyond.teams as t}
			<div class="spread" style="{tv(t.color)}"><span class="pill team">Team {t.name}</span><strong>+{pts(t.over)} over</strong></div>
		{/each}
	</div>
{/if}

{#if data.awards.length || data.grants.length}
	<h2 style="margin-top:20px">Awards</h2>
	{#each data.awards as a}
		<div class="card stack">
			<div class="spread"><strong>🗳️ {a.name}</strong><span class="pill">+{pts(a.points)}</span></div>
			{#each a.winners as w}
				<div class="row" style="{tv(w.color)}">
					{#if w.visible}<div style="width:72px"><Thumb photo={w} code={data.game.code} /></div>{/if}
					<div class="grow">
						<span class="pill team">{w.who} · {w.team}</span>
						<div class="muted small">{a.scope === 'category' ? `${w.category} · ` : ''}{w.votes} vote{w.votes === 1 ? '' : 's'}</div>
					</div>
				</div>
			{:else}
				<p class="muted small" style="margin:0">Nobody voted, so nobody won.</p>
			{/each}
		</div>
	{/each}
	{#each data.grants as g}
		<div class="card stack" style="{tv(g.color)}">
			<div class="spread"><strong>🏅 {g.title}</strong><span class="pill">{g.points >= 0 ? '+' : ''}{pts(g.points)}</span></div>
			<div><span class="pill team">{g.who ? `${g.who} · ` : ''}{g.team}</span></div>
			{#if g.note}<p class="small" style="margin:0">{g.note}</p>{/if}
			{#if g.photos.length}
				<div class="photos">{#each g.photos as p}<Thumb photo={p} code={data.game.code} />{/each}</div>
			{/if}
		</div>
	{/each}
{/if}

{#if data.superlatives.length}
	<h2 style="margin-top:20px">Superlatives</h2>
	{#each data.superlatives as s (s.id)}
		<div class="card stack" style="{tv(s.color ?? 'var(--line)')}">
			<strong>🏆 {s.title}</strong>
			<div class="row">
				{#if s.photo}<div style="width:72px"><Thumb photo={s.photo} code={data.game.code} /></div>{/if}
				<div class="grow">
					<span class="pill team">{s.kind === 'team' ? `Team ${s.who}` : s.team ? `${s.who} · ${s.team}` : s.who}</span>
					{#if s.note}<div class="muted small">{s.note}</div>{/if}
				</div>
			</div>
		</div>
	{/each}
{/if}

<style>
	.bar { height: 8px; border-radius: 999px; background: var(--line); overflow: hidden; margin: 10px 0 8px; }
	.bar div { height: 100%; background: var(--team-bg, var(--team)); border-radius: 999px; }
</style>
