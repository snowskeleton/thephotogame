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

{#if data.mailMissing}
	<a class="banner" href="/admin/settings">
		Email isn’t set up, so sign-in codes and invites only go to the server log. <strong>Set it up ›</strong>
	</a>
{/if}

{@render children()}

<style>
	.banner { display: block; margin: 0 auto; max-width: 720px; box-sizing: border-box; padding: 10px 16px; background: #f5b800; color: #23201c; text-decoration: none; font-size: 0.9rem; }
</style>
