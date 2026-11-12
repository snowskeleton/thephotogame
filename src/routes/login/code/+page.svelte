<script lang="ts">
	let { data, form } = $props();
</script>

<main>
	<h1>Check your email</h1>
	<p class="muted">We sent a six-digit code to <strong>{data.email}</strong>.</p>
	<form method="POST" class="card stack">
		<input type="hidden" name="email" value={data.email} />
		<input type="hidden" name="next" value={data.next} />
		<label>
			Code
			<input name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9 ]*" maxlength="8" required
				style="font-size:1.6rem;letter-spacing:0.3em;text-align:center" />
		</label>
		{#if form?.error}<p class="err">{form.error}</p>{/if}
		<button class="primary">Sign in</button>
	</form>
	<p class="muted small"><a href="/login?next={encodeURIComponent(data.next)}">Send another code</a></p>
</main>
