<script lang="ts">
	import { pts } from '#lib/format.ts';
	type Option = { id: number; label: string; points: number; kind: string; category: string };
	let { options, claims = [] }: { options: Option[]; claims?: { option_id: number; qty: number }[] } = $props();
	const has = (id: number) => claims.find((c) => c.option_id === id);
	// (Map.groupBy is too new for older phones.)
	const groups = $derived(
		options.reduce<{ name: string; list: Option[] }[]>((acc, o) => {
			const g = acc.find((x) => x.name === o.category);
			if (g) g.list.push(o);
			else acc.push({ name: o.category, list: [o] });
			return acc;
		}, [])
	);
	const used = $derived(options.some((o) => has(o.id)));
</script>

{#if options.length}
	<details class="also" open={used}>
		<summary>Also earns points from other categories</summary>
		<input type="hidden" name="also_present" value="1" />
		{#each groups as g}
			<fieldset>
				<legend>{g.name}</legend>
				{#each g.list as o}
					<label class="check">
						{#if o.kind === 'extra'}
							<input type="number" name="also_{o.id}" min="0" max="99" step="1" inputmode="numeric" defaultValue={has(o.id)?.qty ?? 0} style="width:72px" />
						{:else}
							<input type="checkbox" name="also_{o.id}" value="1" checked={!!has(o.id)} />
						{/if}
						<span class="grow">{o.label}</span><span class="pill">+{pts(o.points)}{o.kind === 'extra' ? ' each' : ''}</span>
					</label>
				{/each}
			</fieldset>
		{/each}
	</details>
{/if}

<style>
	.also { display: grid; gap: 8px; }
	fieldset { border: 0; padding: 0; margin: 8px 0 0; display: grid; gap: 8px; }
	legend { font-weight: 600; font-size: 0.85rem; padding: 0; margin-bottom: 4px; }
</style>
