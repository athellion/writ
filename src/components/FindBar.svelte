<script>
  // Find (Ctrl+F) and replace (Ctrl+H): a small card at the top of the page. Matches are marked on the
  // sheet; Enter goes to the next one, Shift+Enter to the one before.
  import { onMount, onDestroy } from 'svelte';
  // (it works through the document's handles, so it's the same in both kinds of document)
  let { doc, replace = false, seed = '', onclose } = $props();

  let query = $state(seed);
  let replacement = $state('');
  let caseSensitive = $state(false);
  let wholeWords = $state(false);
  let showReplace = $state(replace);
  let found = $state({ count: 0, current: -1 });
  let input = $state();
  let note = $state('');

  function run() {
    doc.setFind(query, { caseSensitive, wholeWords });
    found = doc.findState();
    note = '';
  }
  function step(dir) {
    doc.findStep(dir);
    found = doc.findState();
  }
  function one() {
    doc.replaceCurrent(replacement);
    found = doc.findState();
  }
  function all() {
    const n = doc.replaceAll(replacement);
    found = doc.findState();
    note = n ? `Replaced ${n}` : '';
  }
  function keys(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onclose();
    } else if (e.key === 'Enter' && e.currentTarget.dataset.role === 'find') {
      e.preventDefault();
      step(e.shiftKey ? -1 : 1);
    } else if (e.key === 'Enter' && e.currentTarget.dataset.role === 'replace') {
      e.preventDefault();
      one();
    }
  }
  onMount(() => {
    input?.focus();
    input?.select();
    if (query) run();
  });
  onDestroy(() => doc.clearFind());
</script>

<div class="find" role="search">
  <div class="line">
    <input bind:this={input} data-role="find" placeholder="Find" bind:value={query} oninput={run} onkeydown={keys} spellcheck="false" aria-label="Find" />
    <span class="count">{query ? (found.count ? `${found.current + 1} of ${found.count}` : note || 'None') : ''}</span>
    <button class="ic" title="Previous (Shift+Enter)" aria-label="Previous" disabled={!found.count} onclick={() => step(-1)}>
      <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 7.5L6 4l3.5 3.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" /></svg>
    </button>
    <button class="ic" title="Next (Enter)" aria-label="Next" disabled={!found.count} onclick={() => step(1)}>
      <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 4.5L6 8l3.5-3.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" /></svg>
    </button>
    <button class="ic" class:on={showReplace} title="Replace" aria-label="Show replace" onclick={() => (showReplace = !showReplace)}>
      <svg width="13" height="13" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h12l-3-3M20 16H8l3 3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /></svg>
    </button>
    <button class="ic" title="Close (Esc)" aria-label="Close" onclick={onclose}>
      <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true"><path d="M1.5 1.5l9 9M10.5 1.5l-9 9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" /></svg>
    </button>
  </div>
  {#if showReplace}
    <div class="line">
      <input data-role="replace" placeholder="Replace with" bind:value={replacement} onkeydown={keys} spellcheck="false" aria-label="Replace with" />
      <button class="txt" disabled={!found.count} onclick={one}>Replace</button>
      <button class="txt" disabled={!found.count} onclick={all}>Replace all</button>
    </div>
  {/if}
  <div class="opts">
    <label><input type="checkbox" bind:checked={caseSensitive} onchange={run} /> Match case</label>
    <label><input type="checkbox" bind:checked={wholeWords} onchange={run} /> Whole words</label>
  </div>
</div>

<style>
  .find {
    position: sticky;
    top: -16px;
    z-index: 12;
    float: right;
    margin: -16px -8px 0 0;
    width: 360px;
    padding: 8px;
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: 10px;
    box-shadow: var(--shadow);
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .line {
    display: flex;
    align-items: center;
    gap: 3px;
  }
  input:not([type]) {
    flex: 1;
    min-width: 0;
    height: 28px;
    padding: 0 8px;
    border: 1px solid var(--line);
    border-radius: 6px;
    background: var(--bg);
    color: var(--ink);
    font: inherit;
  }
  .count {
    min-width: 54px;
    text-align: right;
    font-size: 11.5px;
    color: var(--faint);
    padding: 0 4px;
    font-variant-numeric: tabular-nums;
  }
  .ic {
    width: 26px;
    height: 26px;
    border-radius: 6px;
    display: grid;
    place-items: center;
    color: var(--muted);
  }
  .ic:hover:not(:disabled),
  .ic.on {
    background: var(--surface-2);
    color: var(--ink);
  }
  .ic:disabled,
  .txt:disabled {
    opacity: 0.4;
  }
  .txt {
    height: 28px;
    padding: 0 9px;
    border-radius: 6px;
    border: 1px solid var(--line);
    background: var(--surface);
    font-size: 12px;
    font-weight: 500;
  }
  .txt:hover:not(:disabled) {
    background: var(--surface-2);
  }
  .opts {
    display: flex;
    gap: 14px;
    padding: 0 2px;
    font-size: 12px;
    color: var(--muted);
  }
  .opts label {
    display: flex;
    align-items: center;
    gap: 5px;
  }
  .opts input {
    accent-color: var(--accent);
    margin: 0;
  }
</style>
