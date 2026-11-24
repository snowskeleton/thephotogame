<script lang="ts">
	import { tv } from '#lib/colors.ts';
	import { pts, plural } from '#lib/format.ts';
	let { data, form } = $props();
	const a = $derived(data.award);
	const open = $derived(a.status === 'open');
	const groups = $derived.by(() => {
		if (a.scope !== 'category') return [{ name: '', photos: data.photos }];
		const m = new Map<string, typeof data.photos>();
		for (const p of data.photos) m.set(p.category, [...(m.get(p.category) ?? []), p]);
		return [...m].map(([name, photos]) => ({ name, photos }));
	});
</script>

<a class="muted small" href="/g/{data.game.code}/vote">← Awards</a>
<h1 style="margin-top:6px">{a.name}</h1>
{#if a.description}<p>{a.description}</p>{/if}
<p class="muted small">
	+{pts(a.points)} pts · {a.scope === 'category' ? 'a winner in every category' : 'one winner overall'}
	{#if a.status === 'draft'} · <strong>draft — players can't see this yet</strong>{/if}
	{#if a.status === 'closed'} · {plural(data.voters, 'voter')}{/if}
</p>

{#if data.saved}<p class="card ok">Your votes are in. You can change them until voting closes.</p>{/if}
{#if form?.error}<p class="err">{form.error}</p>{/if}

<form method="POST">
	{#each groups as g}
		{#if g.name}<h2 style="margin-top:16px">{g.name}</h2>{/if}
		<div class="photos big">
			{#each g.photos as p}
				<label class="pick" class:won={p.won} class:ours={open && p.ours} style="{tv(p.color)}">
					{#if open && !p.ours}<input type="checkbox" name="pick" value={p.id} checked={p.picked} />{/if}
					<img src="/media/{p.id}/thumb" alt={p.caption || p.category} loading="lazy" />
					<span class="mark">✓</span>
					{#if a.status === 'closed'}<span class="tag">{p.won ? '🏆 ' : ''}{p.votes}</span>
					{:else if p.ours}<span class="tag">yours</span>{/if}
					<a class="zoom" href="/g/{data.game.code}/p/{p.id}" aria-label="Open photo">⤢</a>
				</label>
			{/each}
		</div>
	{:else}
		<p class="muted">No photos to vote on yet.</p>
	{/each}
	{#if open}
		<div class="sticky"><button class="primary block">Save my votes</button></div>
	{/if}
</form>

<style>
	.big { grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); }
	.pick {
		position: relative; display: block; aspect-ratio: 1; border-radius: 12px; overflow: hidden;
		border: 3px solid var(--team); background: var(--line); cursor: pointer;
	}
	.pick img { width: 100%; height: 100%; object-fit: cover; display: block; }
	.pick input { position: absolute; opacity: 0; }
	.mark {
		position: absolute; inset: 0; display: none; place-items: center; font-size: 3rem; font-weight: 800;
		color: #fff; background: rgba(47, 158, 91, 0.55);
	}
	.pick input:checked ~ .mark { display: grid; }
	.pick input:focus-visible ~ img { outline: 3px solid var(--accent); outline-offset: -3px; }
	.pick.ours { opacity: 0.45; cursor: default; }
	.pick.won { box-shadow: 0 0 0 4px #f5b800; }
	.tag {
		position: absolute; left: 4px; bottom: 4px; background: rgba(0, 0, 0, 0.66); color: #fff;
		font-size: 0.8rem; font-weight: 700; padding: 1px 8px; border-radius: 999px;
	}
	.zoom {
		position: absolute; right: 4px; top: 4px; width: 32px; height: 32px; display: grid; place-items: center;
		background: rgba(0, 0, 0, 0.6); color: #fff; border-radius: 50%; text-decoration: none; z-index: 2;
	}
	.sticky { position: sticky; bottom: calc(78px + env(safe-area-inset-bottom)); margin-top: 16px; }
</style>
