<script lang="ts">
	import { enhance } from '$app/forms';
	let { data, form } = $props();
	const s = $derived(data.settings);
</script>

<main>
	<p class="small"><a href="/admin">‹ Site admin</a></p>
	<h1>Settings</h1>

	<div class="card stack">
		<h2 style="margin:0">Email {#if data.mailReady}<span class="pill">set up</span>{:else}<span class="pill warn">not set up</span>{/if}</h2>
		{#if data.mailReady}
			<p class="muted small" style="margin:0">Sending through Resend as <strong>{data.mailFrom}</strong>.</p>
		{:else}
			<p style="margin:0">
				Sign-in codes and invites are only written to the server log until you add a Resend API key. Nobody else can
				sign in or accept an invite until then.
			</p>
		{/if}
		{#if !data.mailReady || data.mailFromPlaceholder}
			<ol class="small steps">
				<li>In <a href="https://resend.com/domains" target="_blank" rel="noreferrer">Resend → Domains</a>, add and verify the domain you’ll send from.</li>
				<li>In <a href="https://resend.com/api-keys" target="_blank" rel="noreferrer">Resend → API Keys</a>, create a key with <em>Sending access</em>.</li>
				{#if !data.mailReady}
					<li>On your computer, in the project folder, run this and paste the key when it asks:
						<pre>npx wrangler secret put RESEND_API_KEY</pre>
						It’s stored encrypted with the Worker and takes effect straight away, no deploy needed.
					</li>
				{/if}
				{#if data.mailFromPlaceholder}
					<li>In <code>wrangler.jsonc</code>, set <code>MAIL_FROM</code> to an address on that domain, like
						<code>"The Photo Game &lt;photos@yourdomain.com&gt;"</code>, then run <code>npm run deploy</code>.</li>
				{/if}
				<li>Come back here and send yourself a test.</li>
			</ol>
		{/if}
		<form method="POST" action="?/testMail" use:enhance>
			<button disabled={!data.mailReady}>Send a test email to me</button>
		</form>
		{#if form?.mailSent}<p class="ok">Sent. Check your inbox.</p>{/if}
		{#if form?.mailError}<p class="err">Resend refused it: {form.mailError}</p>{/if}
	</div>

	<form method="POST" action="?/save" class="card stack" use:enhance>
		<h2 style="margin:0">Sign-ups &amp; limits</h2>
		<label class="check">
			<input type="checkbox" name="signups" checked={s.signups} />
			Public sign-ups: anyone can make an account from the sign-in page and, once they’ve confirmed their email, host games
		</label>
		<p class="muted small" style="margin:0">
			Off: only site admins create games, and only people with an account or a game’s join link can get in.
		</p>
		<label>Games one person can create <input name="max_games" type="number" min="0" value={s.maxGames} /></label>
		<label>Photos per game <input name="max_photos" type="number" min="0" value={s.maxPhotos} /></label>
		<p class="muted small" style="margin:0">Site admins, and games they create, aren’t limited. R2’s free tier holds about 10 GB, roughly 2,000 phone photos.</p>
		{#if form?.saved}<p class="ok">Saved.</p>{/if}
		<button class="primary">Save</button>
	</form>

	<div class="card stack">
		<h2 style="margin:0">Bot check {#if data.turnstile}<span class="pill">on</span>{:else}<span class="pill warn">off</span>{/if}</h2>
		<p class="muted small" style="margin:0">
			Cloudflare Turnstile checks that new accounts are made by people, so bots can’t use up your free email
			allowance. {#if !data.turnstile}To turn it on, add a widget under Turnstile in the Cloudflare dashboard, put its site key
			in <code>TURNSTILE_SITE_KEY</code> in <code>wrangler.jsonc</code> and deploy, then run
			<code>npx wrangler secret put TURNSTILE_SECRET</code> with its secret key.{/if}
		</p>
	</div>

	{#if !data.adminEmail}
		<p class="muted small">
			Tip: set <code>ADMIN_EMAIL</code> in <code>wrangler.jsonc</code> to your address. While it’s empty, a site with no
			admin makes the first person to confirm an email the admin.
		</p>
	{/if}
</main>

<style>
	.steps { margin: 0; padding-left: 20px; display: grid; gap: 8px; }
	pre { margin: 6px 0; padding: 8px 10px; background: var(--line); border-radius: 8px; overflow-x: auto; user-select: all; }
</style>
