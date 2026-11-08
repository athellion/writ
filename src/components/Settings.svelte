<script>
  // Settings: light or dark, and whether the outline is shown.
  import Mark from './Mark.svelte';
  let { settings = $bindable(), version, onclose } = $props();

  async function set(patch) {
    settings = await window.writ.setSettings(patch);
  }
  const themes = [['system', 'Like Windows'], ['light', 'Light'], ['dark', 'Dark']];
</script>

<div class="veil" role="presentation" onclick={(e) => e.target === e.currentTarget && onclose()}>
  <section class="panel" role="dialog" aria-label="Settings">
    <header>
      <h2>Settings</h2>
      <button class="x" aria-label="Close" title="Close (Esc)" onclick={onclose}>
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M1.5 1.5l9 9M10.5 1.5l-9 9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" /></svg>
      </button>
    </header>

    <div class="field">
      <span class="label">Look</span>
      <div class="seg" role="radiogroup" aria-label="Look">
        {#each themes as [value, text]}
          <button role="radio" aria-checked={settings.theme === value} class:on={settings.theme === value} onclick={() => set({ theme: value })}>{text}</button>
        {/each}
      </div>
    </div>

    <label class="toggle">
      <input type="checkbox" checked={settings.outline} onchange={(e) => set({ outline: e.currentTarget.checked })} />
      <span>Show the outline beside the page <small>(Ctrl+\\)</small></span>
    </label>

    <div class="field wide">
      <span class="label">Documents</span>
      <p>Writ saves Word documents (.docx), on A4 paper in Georgia, so anyone can open them as they were written. Markdown documents (.md) open in Markdown mode, and are saved exactly as they were, apart from what you changed.</p>
    </div>

    <footer><Mark size={15} /> Writ {version}</footer>
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
    width: min(460px, calc(100% - 32px));
    max-height: calc(100% - 64px);
    overflow: auto;
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: 14px;
    box-shadow: var(--shadow);
    padding: 18px 20px 14px;
  }
  header {
    display: flex;
    align-items: center;
    margin-bottom: 12px;
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
  .field {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 7px 0;
  }
  .field.wide {
    flex-direction: column;
    align-items: stretch;
    gap: 4px;
    border-top: 1px solid var(--line);
    margin-top: 8px;
    padding-top: 12px;
  }
  .field p {
    margin: 0;
    color: var(--muted);
  }
  .label {
    width: 96px;
    flex: none;
    color: var(--muted);
  }
  .wide .label {
    width: auto;
    color: var(--ink);
    font-weight: 550;
  }
  .seg {
    flex: 1;
    display: flex;
    background: var(--surface-2);
    border-radius: 8px;
    padding: 3px;
    gap: 2px;
  }
  .seg button {
    flex: 1;
    padding: 5px 6px;
    border-radius: 6px;
    color: var(--muted);
    font-size: 12.5px;
  }
  .seg button.on {
    background: var(--surface);
    color: var(--ink);
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08);
  }
  .toggle {
    display: flex;
    align-items: flex-start;
    gap: 9px;
    padding: 6px 0;
  }
  .toggle input {
    accent-color: var(--accent);
    margin: 2px 0 0;
  }
  .toggle small {
    color: var(--faint);
  }
  footer {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: 14px;
    color: var(--faint);
    font-size: 12px;
  }
</style>
