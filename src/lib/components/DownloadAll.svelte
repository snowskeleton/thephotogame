<script lang="ts">
	// Builds the zip of every original in the browser (see admin/download/+server.ts for why).
	import { downloadZip } from 'client-zip';

	let { code }: { code: string } = $props();
	let busy = $state(false);
	let done = $state(0);
	let total = $state(0);
	let err = $state('');

	async function go() {
		busy = true;
		err = '';
		done = 0;
		try {
			const list: { zip: string; files: { url: string; name: string }[] } = await (
				await fetch(`/g/${code}/admin/download`)
			).json();
			total = list.files.length;
			async function* files() {
				for (const f of list.files) {
					const res = await fetch(f.url);
					if (res.ok) yield { name: f.name, input: res };
					done++;
				}
			}
			const blob = await downloadZip(files()).blob();
			const a = document.createElement('a');
			a.href = URL.createObjectURL(blob);
			a.download = list.zip;
			a.click();
			setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
		} catch {
			err = 'The download stopped partway. Check your connection and try again.';
		}
		busy = false;
	}
</script>

<button class="btn" onclick={go} disabled={busy}>
	{busy ? `Zipping ${Math.min(done + 1, total)} of ${total}…` : '⬇ Download all'}
</button>
{#if busy && total}<progress max={total} value={done}></progress>{/if}
{#if err}<p class="err small" style="margin:0">{err}</p>{/if}

<style>
	progress { width: 100%; height: 8px; }
</style>
