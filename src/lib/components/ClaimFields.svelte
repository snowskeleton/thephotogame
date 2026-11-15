<script lang="ts">
	import { pts } from '#lib/format.ts';
	type Option = { id: number; label: string; points: number; kind: string };
	let { options, claims = [] }: { options: Option[]; claims?: { option_id: number; qty: number }[] } = $props();
	const tiers = $derived(options.filter((o) => o.kind === 'tier'));
	const extras = $derived(options.filter((o) => o.kind === 'extra'));
	const has = (id: number) => claims.find((c) => c.option_id === id);
</script>

{#if tiers.length > 1}
	<fieldset>
		<legend>What are you claiming?</legend>
		{#each tiers as o, i}
			<label class="check">
				<input type="radio" name="tier" value={o.id} checked={claims.length ? !!has(o.id) : i === 0} />
				<span class="grow">{o.label}</span><span class="pill">{pts(o.points)} pt</span>
			</label>
		{/each}
	</fieldset>
{:else if tiers.length === 1}
	<input type="hidden" name="tier" value={tiers[0].id} />
{/if}
{#if extras.length}
	<fieldset>
		<legend>Extras</legend>
		{#each extras as o}
			<label class="check">
				<input type="number" name="extra_{o.id}" min="0" max="99" step="1" inputmode="numeric" defaultValue={has(o.id)?.qty ?? 0} style="width:72px" />
				<span class="grow">{o.label}</span><span class="pill">+{pts(o.points)} each</span>
			</label>
		{/each}
	</fieldset>
{/if}

<style>
	fieldset { border: 0; padding: 0; margin: 0; display: grid; gap: 8px; }
	legend { font-weight: 600; font-size: 0.9rem; padding: 0; margin-bottom: 6px; }
</style>
