<script lang="ts">
	import { pts, plural } from '#lib/format.ts';
	import { tv } from '#lib/colors.ts';
	import Thumb from '#lib/components/Thumb.svelte';
	import ClaimFields from '#lib/components/ClaimFields.svelte';
	import AlsoFields from '#lib/components/AlsoFields.svelte';
	import Uploader from '#lib/components/Uploader.svelte';
	import PhotoEditor from '#lib/components/PhotoEditor.svelte';
	let { data, form } = $props();
	const open = $derived(data.game.submissions_open && data.category.active);
	const foundSet = $derived(new Set(data.found));
	const pendingPts = $derived(Math.max(0, data.pool.projected - data.pool.confirmed));
	const fullNow = $derived(
		(!!data.category.max_points && data.pool.confirmed >= data.category.max_points) ||
			(!!data.category.scoring_cap && data.pool.count >= data.category.scoring_cap)
	);
	const fullSoon = $derived(
		(!!data.category.max_points && data.pool.projected >= data.category.max_points) ||
			(!!data.category.scoring_cap && data.pool.projectedCount >= data.category.scoring_cap)
	);
	const canEdit = (p: { user_id: number }) => p.user_id === data.user?.id || data.isHost;
</script>

<a class="muted small" href="/g/{data.game.code}">← Board</a>
<h1 style="margin-top:6px">{data.category.name}</h1>
{#if data.category.day_label}<p><span class="pill">{data.category.day_label}</span></p>{/if}

<div class="card stack">
	{#if data.category.rules}<p style="white-space:pre-wrap;margin:0">{data.category.rules}</p>{/if}
	{#if data.options.length}
		<div>
			{#each data.options as o}
				<div class="spread small" style="padding:3px 0">
					<span>{o.label}</span>
					<strong>{o.kind !== 'tier' ? '+' : ''}{pts(o.points)} pt{o.kind === 'extra' ? ' each' : o.kind === 'bonus' ? ' bonus' : ''}</strong>
				</div>
			{/each}
		</div>
	{/if}
	{#if data.category.scoring_cap}
		<p class="muted small" style="margin:0">Only your team's first {plural(data.category.scoring_cap, 'photo')} here score points. Every photo can still win votes.</p>
	{/if}
	{#if data.category.max_points}
		<p class="muted small" style="margin:0">A team can count at most {pts(data.category.max_points)} pts here. Photos fill it in the order they're submitted, and a photo that doesn't fit entirely earns what room is left.</p>
	{/if}
	{#if data.category.notes}<p class="muted small" style="white-space:pre-wrap;margin:0">{data.category.notes}</p>{/if}
</div>

{#if data.items.length}
	<div class="card stack">
		<div class="spread">
			<h2 style="margin:0">Checklist</h2>
			<span class="pill team">{data.found.length} of {data.items.length}</span>
		</div>
		<ul class="checklist">
			{#each data.items as i (i.id)}
				<li class:done={foundSet.has(i.id)}>
					<span class="box" aria-hidden="true">{foundSet.has(i.id) ? '✓' : ''}</span>
					<a href="/g/{data.game.code}/gallery?cat={data.category.id}&item={i.id}">{i.label}</a>
					<span class="sr">{foundSet.has(i.id) ? 'found' : 'not found yet'}</span>
				</li>
			{/each}
		</ul>
	</div>
{/if}

{#if data.team && open}
	<div class="card stack" style="border-color:var(--team);border-width:2px">
		<h2 style="margin:0">Add photos here</h2>
		{#if data.category.max_points || data.category.scoring_cap}
			<p class="small" style="margin:0" data-testid="room">
				{#if data.category.max_points}Your team: {pts(data.pool.confirmed)} of {pts(data.category.max_points)} pts confirmed{pendingPts ? `, ${pts(pendingPts)} pending` : ''}.{/if}
				{#if data.category.scoring_cap}{data.category.max_points ? ' ' : 'Your team: '}{data.pool.count} of {data.category.scoring_cap} photos confirmed{data.pool.projectedCount > data.pool.count ? `, ${data.pool.projectedCount - data.pool.count} pending` : ''}.{/if}
				{#if fullNow}<strong> Full. New photos won't earn points here.</strong>
				{:else if fullSoon}<strong> Pending photos already fill it, so a new one probably won't earn points.</strong>{/if}
			</p>
		{/if}
		<Uploader>
			{#snippet fields()}
				{#if data.items.length}
					<label>Checklist item (optional)
						<select name="item">
							<option value="">None</option>
							{#each data.items as i}<option value={i.id}>{foundSet.has(i.id) ? '✓ ' : ''}{i.label}</option>{/each}
						</select>
					</label>
				{/if}
				{#if data.isHost}
					<ClaimFields options={data.options} />
				{:else}
					<p class="muted small" style="margin:0">What do you think this earns? The host confirms or changes it.</p>
					<ClaimFields options={data.options} />
					<AlsoFields options={data.also} />
				{/if}
				<label>Caption (optional) <input name="caption" maxlength="200" /></label>
			{/snippet}
		</Uploader>
		{#if form?.error}<p class="err" style="margin:0">{form.error}</p>{/if}
		{#if form?.added}<p class="ok" style="margin:0">{plural(form.added, 'photo')} added.</p>{/if}
	</div>
{:else if !data.team}
	<p class="muted">Join a team on the <a href="/g/{data.game.code}">board</a> to submit photos.</p>
{:else}
	<p class="muted">Submissions are closed.</p>
{/if}

{#if data.ours.length}
	<h2>Your team's photos</h2>
	<div class="stack" style="margin-bottom:16px;gap:10px">
		{#each data.ours as p (p.id)}
			<div class="card ourrow" style="{tv(p.color)}">
				<div class="row" style="flex-wrap:nowrap">
					<div class="ourthumb"><Thumb photo={p} code={data.game.code} showScore={data.isHost} /></div>
					<div class="grow">
						<strong>{p.who}</strong>
						{#if p.caption}<div class="small">{p.caption}</div>{/if}
						<div class="muted small">
							{#if p.status === 'disqualified'}Disqualified
							{:else if p.status === 'review'}Under review
							{:else if p.score.pending}Awaiting the host{#if p.score.guess} · guess ~{pts(p.score.guess)} pt{/if}
							{:else if p.score.points > 0}{pts(p.score.points)} pt{#if p.score.over > 0} ({pts(p.score.over)} over the limit){/if}
							{:else if p.score.over > 0}Over the scoring limit
							{:else}{pts(p.score.points)} pt{/if}
						</div>
					</div>
				</div>
				{#if canEdit(p)}
					<details>
						<summary>Edit</summary>
						<div class="stack" style="margin-top:10px">
							<PhotoEditor photo={p} code={data.game.code} options={data.options} claims={p.claims} categories={data.categories} items={data.items} canScore={data.isHost} also={data.also} />
						</div>
					</details>
				{/if}
			</div>
		{/each}
	</div>
{/if}
{#if data.theirs.length}
	<h2>Other teams</h2>
	<div class="photos">
		{#each data.theirs as p}<Thumb photo={p} code={data.game.code} showScore={data.isHost} />{/each}
	</div>
{/if}

<style>
	.checklist { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 4px 12px; }
	.checklist li { display: flex; align-items: center; gap: 8px; padding: 3px 0; }
	.checklist a { color: inherit; text-decoration: none; }
	.checklist li.done a { color: var(--muted, inherit); text-decoration: line-through; }
	.box { width: 20px; height: 20px; flex: none; border: 2px solid var(--line, #999); border-radius: 5px; display: grid; place-items: center; font-size: 13px; line-height: 1; }
	.done .box { background: var(--team); border-color: var(--team); color: #fff; }
	.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
	.ourrow { padding: 10px; margin: 0; display: grid; gap: 8px; }
	.ourthumb { width: 84px; flex: none; }
	summary { cursor: pointer; font-weight: 600; }
</style>
