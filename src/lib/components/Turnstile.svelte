<script lang="ts">
	// Cloudflare's "are you a person" check, shown only when the site has a Turnstile key (see turnstile.ts).
	// It adds a cf-turnstile-response field to the form it sits in.
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	const key: string = page.data.turnstileKey ?? '';
	let el = $state<HTMLDivElement>();

	onMount(() => {
		if (!key || !el) return;
		const w = window as unknown as { turnstile?: { render: (el: HTMLElement, o: object) => string; remove: (id: string) => void } };
		let id: string | undefined;
		const draw = () => (id = w.turnstile!.render(el!, { sitekey: key }));
		if (w.turnstile) draw();
		else {
			const s = document.createElement('script');
			s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
			s.async = true;
			s.onload = draw;
			document.head.appendChild(s);
		}
		return () => id && w.turnstile?.remove(id);
	});
</script>

{#if key}<div bind:this={el} style="min-height:65px"></div>{/if}
