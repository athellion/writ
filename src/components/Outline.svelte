<script>
  // The outline: the document's headings, beside the page. Click one to go there; the small arrow folds
  // its section away on the page (the words stay, only out of sight); drag a heading to move it with its
  // whole section, subheadings and all.
  let { heads = [], here = null, onjump, onfold, onmove } = $props();

  let dragging = $state(null); // the position of the heading being dragged
  let dropAt = $state(undefined); // the position it would be dropped before (null: at the end)

  // a folded heading hides the rows of its subheadings too
  const visible = $derived.by(() => {
    const out = [];
    let hideBelow = null;
    for (const h of heads) {
      if (hideBelow != null && h.level > hideBelow) continue;
      hideBelow = h.folded ? h.level : null;
      out.push(h);
    }
    return out;
  });
  const top = $derived(heads.length ? Math.min(...heads.map((h) => h.level)) : 1);

  function start(e, h) {
    dragging = h.pos;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', h.text);
  }
  function over(e, pos) {
    if (dragging == null) return;
    e.preventDefault();
    dropAt = pos;
  }
  function drop(e) {
    e.preventDefault();
    if (dragging != null && dropAt !== undefined && dropAt !== dragging) onmove(dragging, dropAt);
    end();
  }
  function end() {
    dragging = null;
    dropAt = undefined;
  }
</script>

<nav class="outline" aria-label="Outline">
  <header>
    <span class="h">Outline</span>
    {#if heads.length}<span class="n">{heads.length} {heads.length === 1 ? 'heading' : 'headings'}</span>{/if}
  </header>
  {#if !heads.length}
    <p class="empty">Headings you write appear here, to move around the document by.</p>
  {:else}
    <div class="list" role="list" ondragleave={(e) => !e.currentTarget.contains(e.relatedTarget) && (dropAt = undefined)}>
      {#each visible as h (h.pos)}
        <div
          class="row lv{h.level}"
          class:on={h.pos === here}
          class:dragging={h.pos === dragging}
          class:drop-before={dropAt === h.pos && dragging !== h.pos}
          style:--d={h.level - top}
          role="listitem"
          draggable="true"
          ondragstart={(e) => start(e, h)}
          ondragover={(e) => over(e, h.pos)}
          ondrop={drop}
          ondragend={end}
        >
          <button class="tw" class:folded={h.folded} class:none={!h.hasSection} tabindex={h.hasSection ? 0 : -1} title={h.folded ? 'Show this section' : 'Fold this section away'} aria-label={h.folded ? 'Unfold' : 'Fold'} onclick={() => onfold(h.pos)}>
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M2 3.5l3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" /></svg>
          </button>
          <button class="tx" title={h.text} onclick={() => onjump(h.pos)}>{h.text || 'Untitled heading'}</button>
        </div>
      {/each}
      <div class="end" class:drop-before={dropAt === null} role="presentation" ondragover={(e) => over(e, null)} ondrop={drop}></div>
    </div>
  {/if}
</nav>

<style>
  .outline {
    flex: none;
    width: 248px;
    display: flex;
    flex-direction: column;
    border-right: 1px solid var(--line);
    min-height: 0;
  }
  header {
    display: flex;
    align-items: baseline;
    gap: 8px;
    padding: 14px 16px 8px;
  }
  .h {
    font: 500 14px var(--font-title);
  }
  .n {
    font-size: 11.5px;
    color: var(--faint);
  }
  .empty {
    margin: 4px 16px;
    color: var(--faint);
    font-size: 12.5px;
    line-height: 1.5;
  }
  .list {
    flex: 1;
    overflow: auto;
    padding: 2px 8px 16px;
  }
  .row {
    position: relative;
    display: flex;
    align-items: center;
    gap: 2px;
    padding-left: calc(var(--d, 0) * 14px);
    border-radius: 6px;
    color: var(--muted);
  }
  .row:hover {
    background: var(--surface-2);
    color: var(--ink);
  }
  .row.on {
    background: var(--accent-soft);
    color: var(--ink);
  }
  .row.on::before {
    content: '';
    position: absolute;
    left: 0;
    top: 6px;
    bottom: 6px;
    width: 2px;
    border-radius: 2px;
    background: var(--accent);
  }
  .row.dragging {
    opacity: 0.4;
  }
  .row.drop-before::after,
  .end.drop-before::after {
    content: '';
    position: absolute;
    left: 6px;
    right: 6px;
    top: -1px;
    height: 2px;
    border-radius: 2px;
    background: var(--accent);
  }
  .end {
    position: relative;
    height: 28px;
  }
  .tw {
    flex: none;
    width: 18px;
    height: 18px;
    margin-left: 3px;
    border-radius: 4px;
    display: grid;
    place-items: center;
    color: var(--faint);
  }
  .tw:hover {
    color: var(--ink);
    background: color-mix(in srgb, var(--ink) 8%, transparent);
  }
  .tw svg {
    transition: transform 0.12s;
  }
  .tw.folded svg {
    transform: rotate(-90deg);
  }
  .tw.none {
    visibility: hidden;
  }
  .tx {
    flex: 1;
    min-width: 0;
    text-align: left;
    padding: 5px 8px 5px 2px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    font-size: 12.5px;
  }
  .lv1 .tx {
    font: 500 13.5px/1.3 var(--font-text);
    color: var(--ink);
    padding-top: 6px;
    padding-bottom: 6px;
  }
  .lv2 .tx {
    color: var(--ink);
  }
</style>
