<script lang="ts">
	import { enhance } from '$app/forms';
	let { data, form } = $props();
	const s = $derived(data.settings);
</script>

<main>
	<p class="small"><a href="/admin">‹ Site admin</a></p>
	<h1>Settings</h1>

	<div class="card stack">
		<h2 style="margin:0">
			Email
			{#if !data.mailReady}<span class="pill warn">not set up</span>
			{:else if data.testSender}<span class="pill warn">only reaches you</span>
			{:else}<span class="pill">set up</span>{/if}
		</h2>
		{#if !data.mailReady}
			<p style="margin:0">
				Sign-in codes and invites only go to the Worker’s logs until you add a Resend API key, so nobody else can
				sign in or accept an invite yet.
			</p>
			<ol class="small steps">
				<li>In <a href="https://resend.com/api-keys" target="_blank" rel="noreferrer">Resend → API Keys</a>, create a key with <em>Sending access</em>.</li>
				<li>In the Cloudflare dashboard, open the <strong>thephotogame</strong> Worker → <strong>Settings → Variables and Secrets → Add</strong>.
					Choose type <em>Secret</em>, name it <code>RESEND_API_KEY</code>, paste the key, and deploy.</li>
				<li>Come back here and send yourself a test.</li>
			</ol>
		{:else if data.testSender}
			<p style="margin:0">
				Email goes out from Resend’s test address, which only delivers to the email on your Resend account. To reach
				everyone, verify a domain in <a href="https://resend.com/domains" target="_blank" rel="noreferrer">Resend → Domains</a>
				and enter an address on it below.
			</p>
		{:else}
			<p class="muted small" style="margin:0">Sending through Resend as <strong>{data.mailFrom}</strong>.</p>
		{/if}
		<form method="POST" action="?/sender" class="stack" use:enhance>
			<label>
				Send email from
				<input name="from" defaultValue={data.settings.mailFrom} placeholder="The Photo Game <photos@yourdomain.com>" maxlength="200" />
			</label>
			{#if form?.senderError}<p class="err">{form.senderError}</p>{/if}
			{#if form?.senderSaved}<p class="ok">Saved.</p>{/if}
			<button>Save sender</button>
		</form>
		<form method="POST" action="?/testMail" use:enhance>
			<button disabled={!data.mailReady}>Send a test email to me</button>
		</form>
		{#if form?.mailSent}<p class="ok">Sent. Check your inbox.</p>{/if}
		{#if form?.mailError}<p class="err">Resend refused it: {form.mailError}</p>{/if}
	</div>

	<form method="POST" action="?/save" class="card stack" use:enhance>
		<h2 style="margin:0">Sign-ups &amp; limits</h2>
		<label class="check">
			<input type="checkbox" name="signups" defaultChecked={s.signups} />
			Public sign-ups: anyone can make an account from the sign-in page and, once they’ve confirmed their email, host games
		</label>
		<p class="muted small" style="margin:0">
			Off: only site admins create games, and only people with an account or a game’s join link can get in.
		</p>
		<label>Games one person can create <input name="max_games" type="number" min="0" defaultValue={s.maxGames} /></label>
		<label>Photos per game <input name="max_photos" type="number" min="0" defaultValue={s.maxPhotos} /></label>
		<p class="muted small" style="margin:0">0 means no limit. Site admins, and games they create, are never limited. R2’s free tier holds about 10 GB, roughly 2,000 phone photos.</p>
		{#if form?.saved}<p class="ok">Saved.</p>{/if}
		<button class="primary">Save</button>
	</form>

	<div class="card stack">
		<h2 style="margin:0">Bot check {#if data.turnstile}<span class="pill">on</span>{:else}<span class="pill warn">off</span>{/if}</h2>
		<p class="muted small" style="margin:0">
			Cloudflare Turnstile checks that new accounts are made by people, so bots can’t use up your free email
			allowance. {#if !data.turnstile}To turn it on, add a widget under Turnstile in the Cloudflare dashboard, then add its keys to
			this Worker under Settings → Variables and Secrets: the site key as a variable named <code>TURNSTILE_SITE_KEY</code>
			and the secret key as a secret named <code>TURNSTILE_SECRET</code>.{/if}
		</p>
	</div>

</main>

<style>
	.steps { margin: 0; padding-left: 20px; display: grid; gap: 8px; }
	</style>
