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
   <div class="game-heading"><div><p class="game-eyebrow">FIRST-PERSON EXPLORATION</p><h2 id="game-title" tabindex="-1">Adjust ground</h2></div><button id="game-exit" type="button" class="btn btn-ghost btn-sm" aria-label="Exit game mode">Exit</button></div>
   <p id="game-status" class="game-status" role="status"></p>
   <div id="game-setup"><button id="game-selected-spawn" type="button" class="btn btn-secondary btn-sm">Use selected spawn</button><p class="hint">Explored position and look are preserved when safe. Changing surface may require explicitly choosing the selected spawn.</p>
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
   <div id="game-paused" hidden>
    <div class="game-quick"><label for="game-quick-eye">Standing eye / body height · scene units</label><div class="game-stepper"><button id="game-eye-minus" type="button" class="btn btn-secondary btn-sm" aria-label="Decrease eye height">−</button><input id="game-quick-eye" type="number" step="any" min="0.00001" max="100000000"/><button id="game-eye-plus" type="button" class="btn btn-secondary btn-sm" aria-label="Increase eye height">+</button><button id="game-eye-apply" type="button" class="btn btn-secondary btn-sm">Apply</button></div>
    <label for="game-quick-floor">Virtual floor offset · scene units</label><div class="game-stepper"><button id="game-floor-minus" type="button" class="btn btn-secondary btn-sm" aria-label="Lower virtual floor">−</button><input id="game-quick-floor" type="number" step="any"/><button id="game-floor-plus" type="button" class="btn btn-secondary btn-sm" aria-label="Raise virtual floor">+</button><button id="game-floor-apply" type="button" class="btn btn-secondary btn-sm">Apply</button></div><p id="game-floor-help" class="hint"></p>
    <label for="game-speed">Walk speed <output id="game-speed-value">1×</output> · independent of height</label><input id="game-speed" type="range" min="0.25" max="4" step="0.25" value="1"/>
    </div><div class="game-actions"><button id="game-reset" class="btn btn-secondary btn-sm" type="button">Reset pose</button><button id="game-adjust" class="btn btn-secondary btn-sm" type="button">Floor &amp; surface setup</button><button id="game-stance" class="btn btn-secondary btn-sm" type="button">Crouch / stand</button></div>
    <details id="game-controls"><summary>Controls &amp; comfort</summary><p id="game-current-keys" class="hint"></p><p class="hint">Mouse looks; arrows look in Keyboard mode. Escape pauses. Height changes keep position and speed; crouch is a temporary stance. Virtual hops return to the artificial floor, with no reconstructed walls or ceilings. No head bob or camera shake.</p><label class="game-field">FPS look sensitivity <output id="game-look-value">1×</output><input id="game-look-sensitivity" type="range" min="0.4" max="2" step="0.05" value="1"/></label><label class="game-confirm"><input id="game-reduced-motion" type="checkbox"/>Instant stance transitions</label></details>
    <details id="game-bindings"><summary>Customize keys</summary><div id="game-bindings-list"></div><p id="game-binding-status" role="status"></p><button id="game-bindings-reset" type="button" class="btn btn-secondary btn-sm">Reset key defaults</button></details>
   </div>
   <details id="game-trace-details" hidden><summary>Local mouse input trace</summary><pre id="game-trace-paused"></pre></details>
   <div id="game-start-actions" class="game-start-actions"><button id="game-start" class="btn btn-primary" type="button">Start FPS</button><button id="game-keyboard" class="btn btn-secondary" type="button">Keyboard look</button><p class="hint">FPS captures your mouse. Keyboard look uses arrow keys to look and WASD to walk. Desktop keyboard required; no touch controls yet.</p></div>
  `;
    this.hud.className = 'game-hud';
    this.hud.hidden = true;
    this.hud.innerHTML = '<div class="game-instructions"><strong>Game mode</strong><span id="game-hud-capability"></span><span id="game-look-help">WASD move · Mouse look · Esc pause</span><output id="game-motion" aria-live="polite"></output><button type="button" id="game-help" class="btn btn-secondary btn-sm" aria-label="Game controls and comfort">Controls</button><button type="button" id="game-pause" class="btn btn-secondary btn-sm">Pause</button></div><div class="game-crosshair" aria-hidden="true">+</div>';
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
    this.get('#game-selected-spawn').addEventListener('click', () => game.useSelectedSpawn());
    this.get('#game-stance').addEventListener('click', () => game.toggleCrouch());
    this.get('#game-eye-apply').addEventListener('click', () => game.setEyeHeight(this.input('#game-quick-eye').valueAsNumber));
    this.get('#game-floor-apply').addEventListener('click', () => game.setFloorOffset(this.input('#game-quick-floor').valueAsNumber));
    for (const sign of [-1,1]) {
      this.get(sign < 0 ? '#game-eye-minus' : '#game-eye-plus').addEventListener('click', () => { if (game.config) game.setEyeHeight(game.config.eyeHeight * (sign < 0 ? 1 / 1.15 : 1.15)); });
      this.get(sign < 0 ? '#game-floor-minus' : '#game-floor-plus').addEventListener('click', () => { if (game.config) game.setFloorOffset(game.floorOffset + sign * game.config.eyeHeight * .25); });
    }
    this.input('#game-speed').addEventListener('input', () => game.setPreferences({speed:this.input('#game-speed').valueAsNumber}));
    this.input('#game-look-sensitivity').addEventListener('input', () => game.setPreferences({sensitivity:this.input('#game-look-sensitivity').valueAsNumber}));
    this.input('#game-reduced-motion').addEventListener('change', () => game.setPreferences({reducedMotion:this.input('#game-reduced-motion').checked}));
    game.onControls = () => { const details = this.get('#game-controls');if (details instanceof HTMLDetailsElement) { details.open = true;queueMicrotask(() => { if (game.state.kind === 'paused') details.querySelector('summary')?.focus(); }); } };
    this.hud.querySelector('#game-help')?.addEventListener('click', () => game.showControls());
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
    this.game.enterDirect(); };
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
    this.panel.hidden = state.kind === 'inactive' || state.kind === 'playing' || state.kind === 'acquiring';
    this.hud.hidden = state.kind !== 'playing' && state.kind !== 'acquiring';
    const help = this.hud.querySelector('#game-look-help');
    if (help) help.textContent = state.kind === 'playing' && state.control === 'keyboard' ? 'WASD · Arrows look · Space jump · C crouch · Esc' : 'WASD · Mouse look · Space jump · C crouch · Esc';
    const motion = this.hud.querySelector('#game-motion');
    const motionText = state.kind === 'acquiring' ? 'Capturing mouse…' : (this.game.motion === 'boundary' ? 'Floor boundary' : this.game.motion === 'wall' ? 'Blocked — try strafing' : '') || this.game.feedback || (this.game.airborne ? 'Airborne' : this.game.crouched ? 'Crouched' : '') || {idle:'',walking:'Moving',boundary:'Floor boundary',wall:'Blocked — try strafing'}[this.game.motion];
    if (motion && motion.textContent !== motionText) motion.textContent = motionText;
    document.body.classList.toggle('is-game-playing', state.kind === 'playing' || state.kind === 'acquiring');
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
      state.kind === 'paused' ? this.game.feedback || state.message : state.kind === 'setup' ? state.message || (c?.collisionPreparing && c.support === 'mesh' ? 'Preparing bounded static collision… You can still adjust or exit.' : 'Inspect the preview, then confirm your floor.') : '';
    this.get('#game-title').textContent = state.kind === 'paused' ? 'Exploration paused' : 'Adjust ground';
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
    const setValue = (id:string,value:number) => { const input=this.input(id);if(document.activeElement!==input) input.value=String(Number(value.toPrecision(7))); };
    setValue('#game-quick-eye',c.eyeHeight);setValue('#game-quick-floor',this.game.floorOffset);
    this.input('#game-speed').value=String(this.game.preferences.speed);
    this.get('#game-speed-value').textContent=`${this.game.preferences.speed}×`;
    this.input('#game-look-sensitivity').value=String(this.game.preferences.sensitivity);
    this.get('#game-look-value').textContent=`${this.game.preferences.sensitivity}×`;
    this.input('#game-reduced-motion').checked=this.game.preferences.reducedMotion;
    for(const id of ['#game-quick-floor','#game-floor-minus','#game-floor-plus','#game-floor-apply']) {
      const control=this.get(id);if(control instanceof HTMLInputElement || control instanceof HTMLButtonElement) control.disabled=c.support!=='virtual';
    }
    this.get('#game-floor-help').textContent=c.support==='virtual'?'Moves the artificial floor and body vertically, not your explored XZ/look.':'Floor follows static mesh. Use surface setup to choose different support.';
    this.get('#game-current-keys').textContent='WASD move · Space jump/hop · C crouch · Shift sprint · R reset · [ / ] body height · PageUp / PageDown virtual floor · ? controls';
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
  dispose(): void { this.game.onControls = null; this.game.onInputTrace = null; this.game.inputTraceEnabled = false; this.unsubscribe(); this.button.removeEventListener('click', this.onEntry); this.panel.remove(); this.hud.remove(); document.body.classList.remove('is-game-playing'); }
}
