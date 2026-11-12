<script lang="ts">
	import '../app.css';
	import favicon from '#lib/assets/favicon.svg';
	let { children, data } = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<title>The Photo Game</title>
	<meta name="theme-color" content="#e4572e" />
</svelte:head>

<header class="topbar">
	<a class="brand" href="/">📸 The Photo Game</a>
	{#if data.user}
		<a class="btn sm" href="/account">{data.user.name}</a>
	{:else}
		<a class="btn sm" href="/login">Sign in</a>
	{/if}
</header>

{@render children()}
