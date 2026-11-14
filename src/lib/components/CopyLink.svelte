<script lang="ts">
	// A link (or code) with one-tap Copy and, on phones, the system share sheet.
	let {
		value,
		label = 'Link',
		shareTitle = 'The Photo Game',
		shareText = ''
	}: { value: string; label?: string; shareTitle?: string; shareText?: string } = $props();

	let input: HTMLInputElement;
	let copied = $state(false);
	let canShare = $state(false);
	$effect(() => {
		canShare = typeof navigator !== 'undefined' && !!navigator.share;
	});

	async function copy() {
		try {
			// Some browsers never answer when the page isn't allowed to use the clipboard; don't wait forever.
			await Promise.race([
				navigator.clipboard.writeText(value),
				new Promise((_, no) => setTimeout(no, 800))
			]);
		} catch {
			// Older browsers and non-HTTPS pages: select the text and use the legacy command.
			input.focus();
			input.setSelectionRange(0, value.length);
			document.execCommand('copy');
		}
		copied = true;
		setTimeout(() => (copied = false), 2000);
	}
	async function share() {
		const url = /^https?:/.test(value) ? value : undefined;
		try {
			await navigator.share({ title: shareTitle, text: url ? shareText || undefined : value, url });
		} catch {
			/* closed the share sheet */
		}
	}
</script>

<div class="copy">
	<input bind:this={input} readonly {value} aria-label={label} onfocus={(e) => e.currentTarget.select()} />
	<div class="row">
		<button type="button" class="grow" class:primary={!canShare} onclick={copy} aria-live="polite">{copied ? 'Copied ✓' : `Copy ${label.toLowerCase()}`}</button>
		{#if canShare}<button type="button" class="grow primary" onclick={share}>Share…</button>{/if}
	</div>
</div>

<style>
	.copy { display: grid; gap: 8px; }
	input { font-size: 0.86rem; text-overflow: ellipsis; }
</style>
