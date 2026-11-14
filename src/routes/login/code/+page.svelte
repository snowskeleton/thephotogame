<script lang="ts">
	let { data, form } = $props();
	// Keep the email and destination in the address through a wrong code or a resend.
	const keep = $derived(`&email=${encodeURIComponent(data.email)}&next=${encodeURIComponent(data.next)}${data.known ? '&known' : ''}`);
</script>

<main>
	<h1>Check your email</h1>
	{#if data.known}
		<p>You already have an account with that email, so we just need to check it’s you.</p>
	{/if}
	<p class="muted">We sent a six-digit code to <strong>{data.email}</strong>.</p>
	<form method="POST" action="?/verify{keep}" class="card stack">
		<input type="hidden" name="email" value={data.email} />
		<input type="hidden" name="next" value={data.next} />
		<label>
			Code
			<input name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="8" required
				style="font-size:1.6rem;letter-spacing:0.3em;text-align:center" />
		</label>
		{#if form?.error}<p class="err">{form.error}</p>{/if}
		{#if form?.resent}<p class="ok">A new code is on its way. Only the newest one works.</p>{/if}
		<button class="primary">Sign in</button>
	</form>
	<form method="POST" action="?/resend{keep}" class="row">
		<input type="hidden" name="email" value={data.email} />
		<button class="sm">Send another code</button>
		<a class="btn sm" href="/login?email={encodeURIComponent(data.email)}&next={encodeURIComponent(data.next)}">Use a different email</a>
	</form>
</main>
