<script lang="ts">
	import { pts, plural } from '#lib/format.ts';
	import Thumb from '#lib/components/Thumb.svelte';
	let { data } = $props();
	const base = $derived(`/g/${data.game.code}`);
</script>

<h1>Vote</h1>
<p class="muted small">Approval voting: pick every photo you think deserves the award. The photo with the most votes wins.</p>

{#if data.reviews.length}
	<div class="card stack">
		<h2 style="margin:0">⚠️ Under review</h2>
		<p class="muted small" style="margin:0">These were doubted. Tap one to say whether it should count.</p>
		<div class="photos">{#each data.reviews as p}<Thumb photo={p} code={data.game.code} />{/each}</div>
	</div>
{/if}

{#each data.awards as a}
	<a class="card stack" href="{base}/vote/{a.id}" style="text-decoration:none">
		<div class="spread">
			<strong style="font-size:1.1rem">{a.name}</strong>
			{#if a.status === 'open'}<span class="pill warn">Voting open</span>{:else}<span class="pill">Results</span>{/if}
		</div>
		{#if a.description}<p class="small" style="margin:0">{a.description}</p>{/if}
		<div class="muted small">
			+{pts(a.points)} pts · {a.scope === 'category' ? 'a winner in every category' : 'one winner overall'}
			{#if a.status === 'open'} · {a.mine ? `you picked ${plural(a.mine, 'photo')}` : 'you haven’t voted yet'}{/if}
		</div>
	</a>
{:else}
	<p class="card muted">Nothing to vote on yet. The showrunner opens voting when it's time.</p>
{/each}
