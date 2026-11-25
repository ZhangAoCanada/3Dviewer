import * as THREE from 'three';
import { gameFrame } from './frame';
import type { GameSession } from './GameSession';
export class GameUI {
  private readonly panel = document.createElement('section');
  private readonly hud = document.createElement('div');
  private readonly unsubscribe: () => void;
  private readonly button: HTMLButtonElement;
  private phase: string = 'inactive';
  constructor(private readonly game: GameSession, private readonly navigationMode: () => 'orbit' | 'fly') {
    const button = document.querySelector('#mode-game');
    if (!(button instanceof HTMLButtonElement))
      throw new Error('Missing Game mode action.');
    this.button = button;
    button.addEventListener('click', this.onEntry);
    this.panel.id = 'game-panel';
    this.panel.className = 'game-panel island';
    this.panel.hidden = true;
    this.panel.setAttribute('aria-labelledby', 'game-title');
    this.panel.innerHTML = `
   <div class="game-heading"><div><p class="game-eyebrow">FIRST-PERSON EXPLORATION</p><h2 id="game-title" tabindex="-1">Find your footing</h2></div><button id="game-exit" type="button" class="btn btn-ghost btn-sm" aria-label="Exit game mode">Exit</button></div>
   <p id="game-status" class="game-status" role="status"></p>
   <div id="game-setup">
    <p id="game-evidence" class="hint"></p>
    <label id="game-candidates-row" class="game-field" hidden>Suggested surface<select id="game-candidates"></select></label>
    <div class="game-actions"><button id="game-pick" type="button" class="btn btn-secondary btn-sm">Pick floor / spawn</button><button id="game-flip" type="button" class="btn btn-secondary btn-sm">Flip up</button></div>
    <div class="game-fields"><label class="game-field">Floor offset (scene units)<input id="game-height" type="number" step="any" /></label><label class="game-field">Eye height (scene units)<input id="game-eye" type="number" min="0.00001" step="any" /></label></div>
    <div class="game-actions game-tilt" aria-label="Tilt floor"><span>Tilt</span><button id="game-tilt-x-minus" class="btn btn-ghost btn-sm" type="button" aria-label="Tilt floor back">X −</button><button id="game-tilt-x-plus" class="btn btn-ghost btn-sm" type="button" aria-label="Tilt floor forward">X +</button><button id="game-tilt-z-minus" class="btn btn-ghost btn-sm" type="button" aria-label="Tilt floor left">Z −</button><button id="game-tilt-z-plus" class="btn btn-ghost btn-sm" type="button" aria-label="Tilt floor right">Z +</button></div>
    <p class="hint">Gold ring = spawn. Gold post = eye height; short tick = entry heading. Mint outline = finite reference floor.</p>
    <details><summary>Calibrate scale</summary><p class="hint">Scale is unknown. Adjust eye height against your scene, or enter a known conversion. This scales walking speed, gravity and body clearance together.</p><label class="game-field">Scene units per metre<input id="game-units" type="number" min="0.00001" step="any" placeholder="Optional, if known" /></label><p class="hint">A known conversion sets eye height to 1.7 metres. Without it, all values remain scene units.</p></details>
    <label class="game-field">Walking surface<select id="game-support"><option value="mesh">Static mesh collision</option><option value="virtual">Virtual floor · no wall collision</option></select></label>
    <label id="game-guide-row" class="game-confirm" hidden><input id="game-guide" type="checkbox" checked /><span>Show artificial floor guide during play.</span></label>
    <p id="game-capability" class="game-capability"></p>
    <label class="game-confirm"><input id="game-confirm" type="checkbox" /><span>I checked the floor, spawn and body scale.</span></label>
   </div>
   <div id="game-paused" hidden><p class="hint">WASD to walk · Shift to move faster · R to reset pose. Escape releases the mouse and pauses. No flying or jumping.</p><div class="game-actions"><button id="game-reset" class="btn btn-secondary btn-sm" type="button">Reset pose</button><button id="game-adjust" class="btn btn-secondary btn-sm" type="button">Adjust floor</button></div></div>
   <details id="game-trace-details" hidden><summary>Local mouse input trace</summary><pre id="game-trace-paused"></pre></details>
   <div id="game-start-actions" class="game-start-actions"><button id="game-start" class="btn btn-primary" type="button">Start FPS</button><button id="game-keyboard" class="btn btn-secondary" type="button">Keyboard look</button><p class="hint">FPS captures your mouse. Keyboard look uses arrow keys to look and WASD to walk. Desktop keyboard required; no touch controls yet.</p></div>
  `;
    this.hud.className = 'game-hud';
    this.hud.hidden = true;
    this.hud.innerHTML = '<div class="game-instructions"><strong>Game mode</strong><span id="game-hud-capability"></span><span>WASD walk · Esc pause</span><button type="button" id="game-pause" class="btn btn-secondary btn-sm">Pause</button></div><div class="game-crosshair" aria-hidden="true">+</div>';
    if (new URLSearchParams(location.search).get('gameInputTrace') === '1') {
      game.inputTraceEnabled = true;
      const output = document.createElement('pre'); output.className = 'game-input-trace'; this.hud.append(output);
      this.get('#game-trace-details').hidden = false;
      game.onInputTrace = () => {
        const rows = game.inputTrace;
        const text = rows.map(row => `#${row.index} ${row.event} trusted=${row.trusted} dx=${row.dx ?? '-'} dy=${row.dy ?? '-'} applied=${row.appliedDx ?? '-'},${row.appliedDy ?? '-'} ${row.disposition ?? ''} sensitivity=${row.sensitivity} yaw=${row.yawDegrees.toFixed(2)} pitch=${row.pitchDegrees.toFixed(2)} viewport=${row.width}x${row.height}`);
        this.get('#game-trace-paused').textContent = text.join('\n');
        output.textContent = [...text.slice(0, 3), ...(text.length > 7 ? ['…'] : []), ...text.slice(Math.max(3, text.length - 4))].join('\n');
      };
    }
    const viewport = document.querySelector('#viewport');
    if (!viewport)
      throw new Error('Missing viewport');
    viewport.append(this.panel, this.hud);
    this.get('#game-exit').addEventListener('click', () => { game.exit(); button.focus(); });
    this.get('#game-start').addEventListener('click', () => game.start('locked'));
    this.get('#game-keyboard').addEventListener('click', () => game.start('keyboard'));
    this.get('#game-pick').addEventListener('click', () => game.pickFloor());
    this.get('#game-flip').addEventListener('click', () => { const c = game.config; if (c)
      game.configure({ normal: c.normal.clone().negate() }); });
    this.get('#game-reset').addEventListener('click', () => game.reset());
    this.get('#game-adjust').addEventListener('click', () => game.adjust());
    this.hud.querySelector('#game-pause')?.addEventListener('click', () => game.pause());
    this.get('#game-guide').addEventListener('change', () => game.configure({ showGuide: this.input('#game-guide').checked }));
    this.get('#game-confirm').addEventListener('change', () => game.configure({ confirmed: this.input('#game-confirm').checked }));
    this.get('#game-eye').addEventListener('change', () => game.configure({ eyeHeight: this.input('#game-eye').valueAsNumber }));
    this.get('#game-height').addEventListener('change', () => {
      const c = game.config, value = this.input('#game-height').valueAsNumber;
      if (!c || !Number.isFinite(value))
        return;
      const prior = c.point.clone().sub(c.geometry.anchor).dot(c.normal);
      game.configure({ point: c.point.clone().addScaledVector(c.normal, value - prior) });
    });
    this.get('#game-units').addEventListener('change', () => {
      const value = this.input('#game-units').valueAsNumber;
      if (Number.isFinite(value) && value > 0)
        game.configure({ eyeHeight: value * 1.7 });
    });
    this.get('#game-support').addEventListener('change', () => {
      const value = this.select('#game-support').value;
      if (value === 'mesh' || value === 'virtual')
        game.configure({ support: value });
    });
    this.get('#game-candidates').addEventListener('change', () => game.chooseSuggestion(Number(this.select('#game-candidates').value)));
    for (const axis of ['x', 'z'] as const)
      for (const sign of ['minus', 'plus'] as const) {
        this.get(`#game-tilt-${axis}-${sign}`).addEventListener('click', () => {
          const c = game.config;
          if (!c)
            return;
          const frame = gameFrame(c.point, c.normal);
          const around = new THREE.Vector3(axis === 'x' ? 1 : 0, 0, axis === 'z' ? 1 : 0).applyQuaternion(frame.rotation);
          game.configure({ normal: c.normal.clone().applyAxisAngle(around, (sign === 'plus' ? 1 : -1) * Math.PI / 36) });
        });
      }
    this.unsubscribe = game.subscribe(() => this.render());
    this.render();
  }
  private get(selector: string): HTMLElement { const element = this.panel.querySelector(selector); if (!(element instanceof HTMLElement))
    throw new Error(`Missing ${selector}`); return element; }
  private input(selector: string): HTMLInputElement { const element = this.get(selector); if (!(element instanceof HTMLInputElement))
    throw new Error('Expected input'); return element; }
  private select(selector: string): HTMLSelectElement { const element = this.get(selector); if (!(element instanceof HTMLSelectElement))
    throw new Error('Expected select'); return element; }
  private onEntry = (): void => { if (this.game.active)
    this.game.exit();
  else
    void this.game.enter(); };
  private render(): void {
    const state = this.game.state, c = this.game.config;
    if (state.kind !== this.phase) {
      const target = state.kind;
      this.phase = target;
      if (target === 'setup' || target === 'paused')
        queueMicrotask(() => { if (this.game.state.kind === target)
          this.get('#game-title').focus({ preventScroll: true }); });
      if (target === 'inactive')
        this.button.focus({ preventScroll: true });
    }
    this.panel.hidden = state.kind === 'inactive' || state.kind === 'playing';
    this.hud.hidden = state.kind !== 'playing';
    document.body.classList.toggle('is-game-playing', state.kind === 'playing');
    this.button.classList.toggle('is-on', this.game.active);
    this.button.setAttribute('aria-pressed', String(this.game.active));
    for (const mode of ['orbit', 'fly'] as const) {
      const button = document.querySelector(`#mode-${mode}`);
      const on = !this.game.active && this.navigationMode() === mode;
      button?.classList.toggle('is-on', on);
      button?.setAttribute('aria-pressed', String(on));
    }
    this.get('#game-setup').hidden = state.kind !== 'setup';
    this.get('#game-paused').hidden = state.kind !== 'paused';
    this.get('#game-start-actions').hidden = state.kind !== 'setup' && state.kind !== 'paused';
    this.get('#game-status').textContent = state.kind === 'preparing' ? 'Preparing bounded floor evidence…' : state.kind === 'acquiring' ? 'Waiting for mouse capture…' :
      state.kind === 'paused' ? state.message : state.kind === 'setup' ? state.message || (c?.collisionPreparing && c.support === 'mesh' ? 'Preparing bounded static collision… You can still adjust or exit.' : 'Inspect the preview, then confirm your floor.') : '';
    this.get('#game-title').textContent = state.kind === 'paused' ? 'Exploration paused' : 'Find your footing';
    this.get('#game-start').textContent = state.kind === 'paused' ? 'Resume FPS' : 'Start FPS';
    for (const selector of ['#game-start', '#game-keyboard']) {
      const button = this.get(selector);
      if (button instanceof HTMLButtonElement) button.disabled = state.kind === 'setup' && c?.support === 'mesh' && c.collisionPreparing;
    }
    if (!c)
      return;
    const capability = c.support === 'mesh' ? 'Static mesh · solid-triangle collision' : 'Virtual floor · no wall collision';
    const label = this.hud.querySelector('#game-hud-capability');
    if (label)
      label.textContent = capability;
    this.get('#game-capability').textContent = c.support === 'mesh' ? 'Walls, floor and ceiling use static solid triangles. Transparent/animated geometry is excluded.' :
      `${c.geometry.collisionReason || 'Explicit virtual-floor mode.'} One artificial floor, no reconstructed walls or stairs. The boundary stops movement.`;
    this.get('#game-evidence').textContent = c.evidence;
    const floorOffset = c.point.clone().sub(c.geometry.anchor).dot(c.normal);
    this.input('#game-height').value = String(Number(floorOffset.toPrecision(7)));
    this.input('#game-eye').value = String(Number(c.eyeHeight.toPrecision(7)));
    this.input('#game-confirm').checked = c.confirmed;
    this.get('#game-guide-row').hidden = c.support !== 'virtual';
    this.input('#game-guide').checked = c.showGuide;
    this.select('#game-support').value = c.support;
    const mesh = this.select('#game-support').querySelector('option[value="mesh"]');
    if (mesh instanceof HTMLOptionElement)
      mesh.disabled = !c.geometry.triangles;
    const candidates = this.select('#game-candidates');
    if (candidates.options.length !== c.suggestions.length) {
      candidates.replaceChildren(...c.suggestions.map((_, i) => new Option(`Suggested plane ${i + 1}`, String(i))));
    }
    this.get('#game-candidates-row').hidden = !c.suggestions.length;
  }
  dispose(): void { this.game.onInputTrace = null; this.game.inputTraceEnabled = false; this.unsubscribe(); this.button.removeEventListener('click', this.onEntry); this.panel.remove(); this.hud.remove(); document.body.classList.remove('is-game-playing'); }
}
