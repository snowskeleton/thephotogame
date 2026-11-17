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

{#if data.noOwner}
	<p class="banner">
		Setup: this site has no owner yet. In the Cloudflare dashboard, add a variable named <code>OWNER_EMAIL</code>
		with your email to this Worker (Settings → Variables and Secrets), then sign in with that address.
	</p>
{:else if data.mail === 'missing'}
	<a class="banner" href="/admin/settings">
		Email isn’t set up, so sign-in codes and invites only go to the Worker’s logs. <strong>Set it up ›</strong>
	</a>
{:else if data.mail === 'test'}
	<a class="banner" href="/admin/settings">
		Email only reaches your own inbox until you set a sender address. <strong>Set it up ›</strong>
	</a>
{/if}

{@render children()}

<style>
	.banner { display: block; margin: 0 auto 0; max-width: 720px; box-sizing: border-box; padding: 10px 16px; background: #f5b800; color: #23201c; text-decoration: none; font-size: 0.9rem; }
</style>
