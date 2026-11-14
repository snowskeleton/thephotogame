<script lang="ts">
	import { colorName, FINISHES, PALETTES, tv } from '#lib/colors.ts';

	let {
		value = '',
		taken = [],
		name = 'color'
	}: { value?: string; taken?: string[]; name?: string } = $props();

	const used = $derived(new Set(taken.map((t) => t.toLowerCase()).filter((t) => t !== value.toLowerCase())));
	const firstFree = () => PALETTES.flatMap((p) => p.colors).find((c) => !taken.includes(c)) ?? PALETTES[0].colors[0];
	let picked = $state(value || firstFree());
	const startTab = PALETTES.findIndex((p) => p.colors.includes(picked));
	let tab = $state(startTab < 0 ? -1 : startTab);
	const isCustom = $derived(!PALETTES.some((p) => p.colors.includes(picked)));
	const customHex = $derived(picked.startsWith('#') ? picked : (FINISHES[picked]?.base ?? '#888888'));
</script>

<div class="picker">
	<input type="hidden" {name} value={picked} />
	<div class="preview" style={tv(picked)}>
		<span class="swatch big"></span>
		<span class="pill team">Team color</span>
		{#if FINISHES[picked]}<span class="muted small">{FINISHES[picked].name}</span>{/if}
	</div>
	<div class="subnav" role="tablist">
		{#each PALETTES as p, i}
			<button type="button" class="sm" class:on={tab === i} role="tab" aria-selected={tab === i} onclick={() => (tab = i)}>{p.name}</button>
		{/each}
		<button type="button" class="sm" class:on={tab === -1} role="tab" aria-selected={tab === -1} onclick={() => (tab = -1)}>Custom</button>
	</div>
	{#if tab >= 0}
		<div class="grid">
			{#each PALETTES[tab].colors as c}
				<button
					type="button"
					class="swatch"
					class:sel={picked === c}
					class:used={used.has(c)}
					style={tv(c)}
					title={colorName(c) + (used.has(c) ? ' (another team has it)' : '')}
					aria-label={colorName(c)}
					aria-pressed={picked === c}
					onclick={() => (picked = c)}
				></button>
			{/each}
		</div>
	{:else}
		<label>
			Any color
			<input type="color" value={customHex} oninput={(e) => (picked = e.currentTarget.value)} style="width:100%;height:48px;padding:2px" />
		</label>
	{/if}
	{#if isCustom && tab !== -1}<p class="muted small" style="margin:0">Using a custom color.</p>{/if}
</div>

<style>
	.picker { display: grid; gap: 10px; }
	.preview { display: flex; align-items: center; gap: 10px; }
	.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(44px, 1fr)); gap: 10px; }
	.swatch {
		aspect-ratio: 1; min-height: 44px; padding: 0; border-radius: 50%;
		background: var(--team-bg); background-size: 200% 200%;
		border: 3px solid transparent; outline: 2px solid transparent; outline-offset: 2px;
		box-shadow: inset 0 0 0 1px rgb(0 0 0 / 0.15);
		animation: sheen 6s ease-in-out infinite alternate;
	}
	.swatch.big { width: 40px; min-height: 40px; flex: none; display: inline-block; }
	.swatch.sel { outline-color: var(--ink); border-color: var(--bg); }
	.swatch.used { opacity: 0.3; }
	.subnav button.on { background: var(--ink); color: var(--bg); border-color: var(--ink); }
</style>
