<script lang="ts">
	let { data } = $props();
	let i = $state(0);
	let playing = $state(false);
	const p = $derived(data.photos[i]);
	const go = (d: number) => (i = (i + d + data.photos.length) % data.photos.length);

	$effect(() => {
		if (!playing) return;
		const t = setInterval(() => go(1), 6000);
		return () => clearInterval(t);
	});
	function key(e: KeyboardEvent) {
		if (e.key === 'ArrowRight' || e.key === ' ') go(1);
		else if (e.key === 'ArrowLeft') go(-1);
		else if (e.key === 'Escape') location.href = data.back;
	}
</script>

<svelte:window onkeydown={key} />

<div class="show">
	{#if p}
		{#key p.id}<img src="/media/{p.id}/large" alt={p.caption || p.category} />{/key}
		<button class="zone left" onclick={() => go(-1)} aria-label="Previous"></button>
		<button class="zone right" onclick={() => go(1)} aria-label="Next"></button>
		<div class="bar top">
			<a class="btn sm" href={data.back}>✕ Close</a>
			<span>{i + 1} / {data.photos.length}</span>
			<button class="sm" onclick={() => (playing = !playing)}>{playing ? '⏸ Pause' : '▶ Play'}</button>
		</div>
		<div class="bar bottom" style="--team:{p.color}">
			<div>
				<strong>{p.category}</strong>
				{#if p.caption}<div>{p.caption}</div>{/if}
			</div>
			<span class="pill team">{p.who} · {p.team}</span>
		</div>
	{:else}
		<div class="bar top"><a class="btn sm" href={data.back}>✕ Close</a></div>
		<p style="margin:auto">No photos to show.</p>
	{/if}
</div>

<style>
	.show { position: fixed; inset: 0; z-index: 50; background: #000; color: #fff; display: flex; }
	img { width: 100%; height: 100%; object-fit: contain; }
	.zone { position: absolute; top: 60px; bottom: 90px; width: 40%; background: none; border: 0; border-radius: 0; }
	.left { left: 0; }
	.right { right: 0; }
	.bar {
		position: absolute; left: 0; right: 0; display: flex; justify-content: space-between; align-items: center; gap: 12px;
		padding: 12px 16px; background: linear-gradient(var(--dir), rgba(0, 0, 0, 0.75), transparent);
	}
	.top { top: 0; --dir: to bottom; }
	.bottom { bottom: 0; --dir: to top; padding-bottom: calc(14px + env(safe-area-inset-bottom)); font-size: 1.1rem; }
	.bar :global(.btn), .bar button { background: rgba(255, 255, 255, 0.16); border-color: transparent; color: #fff; }
</style>
