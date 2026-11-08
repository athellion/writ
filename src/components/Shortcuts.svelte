<script>
  // Keyboard shortcuts: every key Writ knows, in one calm list, so they can be learnt.
  // Opened from the menu or with Ctrl+/; Esc or a click outside closes it.
  let { onclose } = $props();

  // two columns: Documents, Finding and Showing on the left; Writing and Formatting on the right
  // each line: the keys (a "+" joins keys pressed together, " / " separates alternatives) and what they do
  const groups = [
    ['Documents', [
      ['Ctrl+N', 'New document'],
      ['Ctrl+O', 'Open a Word document'],
      ['Ctrl+S', 'Save'],
      ['Ctrl+Shift+S', 'Save as'],
      ['Ctrl+W', 'Close the document'],
    ]],
    ['Finding', [
      ['Ctrl+F', 'Find'],
      ['Ctrl+H', 'Find and replace'],
      ['Enter / Shift+Enter', 'Next / previous match'],
    ]],
    ['Showing', [
      ['Ctrl+\\', 'Show or hide the outline'],
      ['Ctrl++ / Ctrl+−', 'Zoom in / out'],
      ['Ctrl+0', 'Back to 100 %'],
      ['Ctrl+/', 'These keyboard shortcuts'],
    ]],
    ['Formatting', [
      ['Ctrl+B', 'Bold'],
      ['Ctrl+I', 'Italic'],
      ['Ctrl+U', 'Underline'],
      ['Ctrl+Shift+X', 'Strikethrough'],
      ['Ctrl+K', 'Link'],
      ['Ctrl+Alt+1 / 2 / 3', 'Heading 1, 2 or 3'],
      ['Ctrl+Alt+0', 'Ordinary text'],
      ['Ctrl+Shift+8', 'Bulleted list'],
      ['Ctrl+Shift+7', 'Numbered list'],
      ['Ctrl+Shift+9', 'Checklist'],
      ['Ctrl+Shift+B', 'Quote'],
    ]],
    ['Writing', [
      ['# / ## / ###', 'Typed at the start of a line, then a space: a heading'],
      ['- / 1.', 'Then a space: a bulleted or numbered list'],
      ['[ ]', 'Then a space: a checklist'],
      ['**word**', 'Bold as you type (*word* for italic)'],
      ['Tab / Shift+Tab', 'Indent / outdent a list item'],
      ['Ctrl+Click', 'Open a link'],
      ['Ctrl+Z / Ctrl+Y', 'Undo / redo'],
    ]],
  ];
  // "Ctrl+Shift+S" → [["Ctrl","Shift","S"]]; "Tab / Shift+Tab" → [["Tab"],["Shift","Tab"]]
  // ("Ctrl++" is Ctrl and the plus key; typed marks like "**word**" are shown whole)
  const split = (keys) =>
    keys.split(' / ').map((k) => (k.endsWith('++') ? [...k.slice(0, -2).split('+'), '+'] : /^[#*[\]\-\d]/.test(k) || /^\d$/.test(k) ? [k] : k.split('+')));
</script>

<div class="veil" role="presentation" onclick={(e) => e.target === e.currentTarget && onclose()}>
  <section class="panel" role="dialog" aria-label="Keyboard shortcuts">
    <header>
      <h2>Keyboard shortcuts</h2>
      <button class="x" aria-label="Close" title="Close (Esc)" onclick={onclose}>
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M1.5 1.5l9 9M10.5 1.5l-9 9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" /></svg>
      </button>
    </header>

    <div class="groups">
    {#each [groups.slice(0, 3), groups.slice(3)] as column}
    <div class="col">
    {#each column as [title, rows]}
      <div class="group">
      <h3>{title}</h3>
      <dl>
        {#each rows as [keys, what]}
          <div class="row">
            <dt>{what}</dt>
            <dd>
              {#each split(keys) as combo, i}
                {#if i}<span class="or">/</span>{/if}
                {#each combo as k}<kbd>{k}</kbd>{/each}
              {/each}
            </dd>
          </div>
        {/each}
      </dl>
      </div>
    {/each}
    </div>
    {/each}
    </div>
  </section>
</div>

<style>
  .veil {
    position: absolute;
    inset: 0;
    z-index: 25;
    background: color-mix(in srgb, var(--bg) 55%, transparent);
    backdrop-filter: blur(1.5px);
    display: grid;
    place-items: center;
  }
  .panel {
    width: min(760px, calc(100% - 32px));
    max-height: calc(100% - 64px);
    overflow: auto;
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: 14px;
    box-shadow: var(--shadow);
    padding: 18px 20px 16px;
  }
  header {
    display: flex;
    align-items: center;
    margin-bottom: 4px;
  }
  h2 {
    margin: 0;
    font: 600 18px var(--font-title);
    flex: 1;
  }
  .x {
    width: 28px;
    height: 28px;
    border-radius: 7px;
    display: grid;
    place-items: center;
    color: var(--muted);
  }
  .x:hover {
    background: var(--surface-2);
  }
  /* two columns when there's room, one in a narrow window */
  .groups {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(290px, 1fr));
    column-gap: 32px;
  }
  h3 {
    margin: 12px 0 4px;
    font-size: 11.5px;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--faint);
  }
  dl {
    margin: 0;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: 30px;
    border-bottom: 1px solid color-mix(in srgb, var(--line) 60%, transparent);
  }
  .row:last-child {
    border-bottom: 0;
  }
  dt {
    flex: 1;
    min-width: 0;
    color: var(--ink);
  }
  dd {
    margin: 0;
    flex: none;
    display: flex;
    align-items: center;
    gap: 3px;
  }
  kbd {
    font: inherit;
    font-size: 11.5px;
    min-width: 22px;
    text-align: center;
    padding: 1px 6px;
    border: 1px solid var(--line);
    border-bottom-width: 2px;
    border-radius: 5px;
    background: var(--surface-2);
    color: var(--muted);
  }
  .or {
    color: var(--faint);
    margin: 0 3px;
  }
</style>
