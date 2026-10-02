import { presentEpsg } from '../core/epsg';
import { detectMemoryBudget } from '../core/memoryBudget';
import { createStallWatchdog, type StallWatchdog } from '../core/watchdog';
import { SAMPLES, sampleUrl, type SampleAsset } from '../core/samples';
import { readProbe, sourceFromFile, sourceFromUrl } from '../core/sniff';
import {
  DEFAULT_SETTINGS,
  type AssetSource,
  type GaussianLoadOverrides,
  type LoadProgress,
  type RenderSettings,
  type ShadingMode,
} from '../core/types';
import { createDefaultRegistry } from '../loaders';
import type { FrameStats } from '../render/SceneHost';
import { SceneHost } from '../render/SceneHost';
import type { NavMode } from '../render/Navigation';
import { isTypingTarget } from '../render/Navigation';
import { explainLoadError } from '../loaders/gaussian/explainLoadError';
import { createDemoSlab } from '../render/demoSlab';
import { bindRangeFills, syncRangeFill } from '../ui/controls';
import { formatBytes, formatCompact, formatCount, formatFixed } from '../ui/format';
import { detectDesktopOs, unsignedInstallNote } from '../ui/downloadDesktop';
import { bindMenu } from '../ui/menu';

const PROBE_EXTENSIONS = new Set(['ply', '']);

export class ViewerApp {
  private readonly host: SceneHost;
  private readonly registry = createDefaultRegistry();
  private readonly settings: RenderSettings;
  private generation = 0;
  private loadAbort: AbortController | null = null;
  private toastTimer = 0;
  private lastSource: AssetSource | null = null;
  private loadingSource: AssetSource | null = null;
  private loadingStage: LoadProgress['stage'] | null = null;
  private loadingStarted = 0;
  private elapsedTimer = 0;
  private stageStarted = 0;
  private geoCopy = '';
  private hintHeld = false;
  private hintCleanup: (() => void) | null = null;
  private readonly menus: { button: HTMLButtonElement; menu: HTMLElement; close: () => void }[] = [];
  /** Captured once from the page URL so later `history.replaceState` calls keep it. */
  private readonly gaussianOverrides = readGaussianOverrides();

  constructor() {
    const canvas = document.querySelector<HTMLCanvasElement>('#view');
    if (!canvas) throw new Error('Missing viewport canvas');
    const budget = detectMemoryBudget();
    this.settings = {
      ...DEFAULT_SETTINGS,
      shDegree: budget.maxSh,
    };
    this.host = new SceneHost(canvas, budget);
    this.host.onContextLost = () => {
      this.toast('The GPU reset. Reloading the scene…', 'warn');
    };
    this.host.onContextRestored = () => {
      const source = this.lastSource;
      this.host.clear();
      this.renderSceneInfo();
      if (!source || (source.origin === 'url' && source.sizeBytes == null)) {
        this.setEmpty(true);
        if (source) {
          this.toast(
            'The GPU reset. This scene came from a URL of unknown size, so it was not reloaded. Open it again if you still need it. A multi-gigabyte file can take several minutes.',
            'warn',
          );
        }
        return;
      }
      this.toast('The GPU reset. Reloading the scene… A multi-gigabyte file can take several minutes.', 'warn');
      void this.load(source);
    };
    this.host.setBackground(this.canvasColor());
    this.host.applySettings(this.settings);
    bindRangeFills(document);
    this.syncControls();
    this.restoreNavPrefs();
    this.bind();
    this.syncThemeButton();
    this.applyHudPref();
    this.renderSceneInfo();
    this.renderPerf(this.host.stats());
    this.host.start((stats) => this.renderPerf(stats));
    // The stylesheet arrives with this module. Arm the drawer-clearance
    // transition only after the first paint, or the toolbar slides in.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => document.body.classList.add('chrome-ready'));
    });
    void this.boot();
  }

  private canvasColor(): string {
    return document.documentElement.dataset.theme === 'light' ? '#e7ebf1' : '#10141b';
  }

  private bind(): void {
    const fileInput = must<HTMLInputElement>('#file-input');
    const open = () => fileInput.click();
    must('#open-btn').addEventListener('click', open);
    must('#empty-open').addEventListener('click', open);
    fileInput.addEventListener('change', () => {
      const file = fileInput.files?.[0];
      fileInput.value = '';
      if (file) {
        this.setQuery(null);
        void this.load(sourceFromFile(file));
      }
    });

    must('#empty-sample').addEventListener('click', () => {
      const sample = SAMPLES[0];
      if (!sample) return;
      this.setQuery({ sample: sample.id });
      void this.loadSample(sample);
    });
    must('#url-btn').addEventListener('click', () => this.openUrlDialog());
    must('#empty-url').addEventListener('click', () => this.openUrlDialog());
    must('#help-btn').addEventListener('click', () => this.openHelp());
    must('#download-btn').addEventListener('click', () => this.openDownloadDialog());
    must('#loading-cancel').addEventListener('click', () => this.cancelLoad());
    must('#geo-badge').addEventListener('click', () => this.showGeoref());
    must('#geo-copy').addEventListener('click', () => {
      const text = this.geoCopy;
      if (!text) return;
      void navigator.clipboard.writeText(text).then(
        () => this.toast('Copied georeference.', 'info'),
        () => {
          /* clipboard unavailable */
        },
      );
    });
    this.bindUrlForm();
    this.bindToast();

    this.buildSamples();
    this.bindSheetSwipe();
    must('#mode-orbit').addEventListener('click', () => this.setMode('orbit'));
    must('#mode-fly').addEventListener('click', () => this.setMode('fly'));
    must('#focus-btn').addEventListener('click', () => this.focusCenter());
    must('#reset-btn').addEventListener('click', () => this.host.resetView());
    must('#theme-btn').addEventListener('click', () => this.toggleTheme());
    must('#panel-btn').addEventListener('click', () => this.togglePanel());
    must('#panel-close').addEventListener('click', () => {
      this.togglePanel();
      must<HTMLButtonElement>('#panel-btn').focus();
    });
    must('#hud-toggle').addEventListener('click', () => {
      const detail = must('#hud-detail');
      detail.hidden = !detail.hidden;
      must('#hud-toggle').setAttribute('aria-expanded', String(!detail.hidden));
    });
    const fullscreenBtn = must<HTMLButtonElement>('#fullscreen-btn');
    fullscreenBtn.hidden = !document.fullscreenEnabled;
    fullscreenBtn.addEventListener('click', () => {
      const action = document.fullscreenElement
        ? document.exitFullscreen()
        : document.documentElement.requestFullscreen();
      void action;
    });
    document.addEventListener('fullscreenchange', () => {
      const on = document.fullscreenElement != null;
      document.body.classList.toggle('is-fullscreen', on);
      const label = on ? 'Exit full screen' : 'Enter full screen';
      fullscreenBtn.setAttribute('aria-label', label);
      fullscreenBtn.title = label;
    });

    this.bindSettings();

    window.addEventListener('dragenter', (event) => {
      if (event.dataTransfer?.types.includes('Files')) document.body.classList.add('is-dragging');
    });
    window.addEventListener('dragover', (event) => {
      if (!event.dataTransfer?.types.includes('Files')) return;
      event.preventDefault();
      document.body.classList.add('is-dragging');
    });
    window.addEventListener('dragleave', (event) => {
      if (event.target === document.body || event.relatedTarget === null) {
        document.body.classList.remove('is-dragging');
      }
    });
    window.addEventListener('drop', (event) => {
      event.preventDefault();
      document.body.classList.remove('is-dragging');
      const file = event.dataTransfer?.files?.[0];
      if (file) {
        this.setQuery(null);
        void this.load(sourceFromFile(file));
      }
    });

    window.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        this.onEscape(event);
        return;
      }
      if (isTypingTarget(event.target) || event.metaKey || event.ctrlKey || event.altKey) return;
      if (document.querySelector('dialog[open]')) return;
      if (event.key === '?') {
        this.openHelp();
        return;
      }
      if (event.code === 'KeyO') {
        must<HTMLInputElement>('#file-input').click();
      } else if (event.code === 'KeyU') {
        this.openUrlDialog();
      } else if (event.code === 'KeyI') {
        this.toggleHud();
      } else if (event.code === 'KeyG') {
        this.toggleGrid();
      } else if (event.code === 'KeyT') {
        this.toggleTheme();
      } else if (event.code === 'KeyR') {
        this.host.resetView();
      } else if (event.code === 'KeyF') {
        this.focusCenter();
      } else if (event.code === 'Digit1') {
        this.setMode('orbit');
      } else if (event.code === 'Digit2') {
        this.setMode('fly');
      } else if (event.code === 'KeyH') {
        this.togglePanel();
      }
    });

    this.restorePanel();
  }

  private bindSettings(): void {
    const scale = must<HTMLInputElement>('#splat-scale');
    const points = must<HTMLInputElement>('#point-size');
    const lod = must<HTMLInputElement>('#lod-scale');
    scale.addEventListener('input', () => {
      this.settings.splatScale = Number(scale.value);
      must('#out-splat-scale').textContent = formatFixed(this.settings.splatScale);
      syncRangeFill(scale);
      this.host.applySettings(this.settings);
    });
    points.addEventListener('input', () => {
      this.settings.pointSize = Number(points.value);
      must('#out-point-size').textContent = formatFixed(this.settings.pointSize);
      syncRangeFill(points);
      this.host.applySettings(this.settings);
    });
    lod.addEventListener('input', () => {
      this.settings.lodSplatScale = Number(lod.value);
      must('#out-lod').textContent = formatFixed(this.settings.lodSplatScale);
      syncRangeFill(lod);
      this.host.applySettings(this.settings);
    });
    must<HTMLSelectElement>('#sh-degree').addEventListener('change', (event) => {
      this.settings.shDegree = Number((event.target as HTMLSelectElement).value) as RenderSettings['shDegree'];
      this.host.applySettings(this.settings);
      this.syncShDegree();
    });
    must<HTMLSelectElement>('#shading').addEventListener('change', (event) => {
      this.settings.shading = (event.target as HTMLSelectElement).value as ShadingMode;
      this.host.applySettings(this.settings);
    });
    must<HTMLSelectElement>('#pixel-ratio').addEventListener('change', (event) => {
      this.settings.pixelRatio = (event.target as HTMLSelectElement).value as RenderSettings['pixelRatio'];
      this.host.applySettings(this.settings);
    });
    bindCheck('#wireframe', (on) => {
      this.settings.wireframe = on;
      this.host.applySettings(this.settings);
    });
    bindCheck('#gs-2d', (on) => {
      this.settings.enable2DGS = on;
      this.host.applySettings(this.settings);
    });
    bindCheck('#sort-radial', (on) => {
      this.settings.sortRadial = on;
      this.host.applySettings(this.settings);
    });
    bindCheck('#extended', (on) => {
      this.settings.extendedPrecision = on;
    });
    bindCheck('#flip-y', (on) => {
      this.settings.flipY = on;
      if (this.host.items.length > 0) this.host.setFlip(on);
    });
    bindCheck('#grid', (on) => {
      this.settings.showGrid = on;
      this.host.applySettings(this.settings);
    });
    bindCheck('#hud-switch', (on) => {
      must('#hud').hidden = !on;
      writeStorage('3dviewer-hud', on ? 'on' : 'off');
    });
    must<HTMLSelectElement>('#up-axis').addEventListener('change', (event) => {
      const value = (event.target as HTMLSelectElement).value;
      if (value !== 'auto' && value !== 'y' && value !== 'z') return;
      this.host.setUpMode(value);
      writeStorage('3dviewer-up', value);
      this.syncUpLabel();
    });
    const sensitivity = must<HTMLInputElement>('#sensitivity');
    sensitivity.addEventListener('input', () => {
      const value = Number(sensitivity.value);
      this.host.setSensitivity(value);
      must('#out-sensitivity').textContent = formatFixed(value);
      syncRangeFill(sensitivity);
      writeStorage('3dviewer-sensitivity', String(value));
    });
  }

  private restoreNavPrefs(): void {
    try {
      const up = localStorage.getItem('3dviewer-up');
      if (up === 'auto' || up === 'y' || up === 'z') {
        this.host.upMode = up;
        must<HTMLSelectElement>('#up-axis').value = up;
      }
      const sensitivity = Number(localStorage.getItem('3dviewer-sensitivity'));
      if (Number.isFinite(sensitivity) && sensitivity >= 0.4 && sensitivity <= 2) {
        this.host.setSensitivity(sensitivity);
        must<HTMLInputElement>('#sensitivity').value = String(sensitivity);
        must('#out-sensitivity').textContent = formatFixed(sensitivity);
      }
    } catch {
      /* private mode */
    }
    syncRangeInputs();
  }

  private syncUpLabel(): void {
    must('#up-using').textContent = this.host.upAxis === 'z' ? 'Z-up' : 'Y-up';
  }

  private async loadDemoSlab(count?: number): Promise<void> {
    this.loadingSource = null;
    this.setEmpty(false);
    this.beginLoadingClock();
    this.setLoading(true, 'Building a synthetic drone slab', undefined, undefined, 'detect');
    must('#loading-file').textContent = 'Synthetic drone slab';
    let loaded = false;
    try {
      const renderable = await createDemoSlab(count);
      this.host.clear();
      this.host.add(renderable, this.settings);
      this.host.setFlip(false);
      this.syncUpLabel();
      this.renderSceneInfo();
      loaded = true;
    } catch (error) {
      this.toast(explainLoadError(error), 'error');
      this.setEmpty(this.host.items.length === 0);
    } finally {
      this.setLoading(false);
      if (loaded) this.maybeShowHint();
    }
  }

  private syncControls(): void {
    must<HTMLInputElement>('#splat-scale').value = String(this.settings.splatScale);
    must<HTMLInputElement>('#point-size').value = String(this.settings.pointSize);
    must<HTMLInputElement>('#lod-scale').value = String(this.settings.lodSplatScale);
    must<HTMLSelectElement>('#sh-degree').value = String(this.settings.shDegree);
    must<HTMLInputElement>('#gs-2d').checked = this.settings.enable2DGS;
    must<HTMLInputElement>('#sort-radial').checked = this.settings.sortRadial;
    must<HTMLInputElement>('#extended').checked = this.settings.extendedPrecision;
    must<HTMLInputElement>('#flip-y').checked = this.settings.flipY;
    must<HTMLInputElement>('#grid').checked = this.settings.showGrid;
    must<HTMLInputElement>('#wireframe').checked = this.settings.wireframe;
    syncRangeInputs();
  }

  private buildSamples(): void {
    const menu = must('#samples-menu');
    const button = must<HTMLButtonElement>('#samples-btn');
    const samplesRoot = must('#empty-samples');
    const moreSamples = must('#more-samples');
    for (const sample of SAMPLES) {
      menu.append(this.sampleItem(sample));
      moreSamples.append(this.sampleItem(sample));
    }
    for (const sample of SAMPLES.slice(1)) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'chip';
      chip.textContent = sample.label;
      chip.addEventListener('click', () => {
        this.setQuery({ sample: sample.id });
        void this.loadSample(sample);
      });
      samplesRoot.append(chip);
    }
    this.trackMenu(button, menu);
    const moreButton = must<HTMLButtonElement>('#more-btn');
    const moreMenu = must('#more-menu');
    moreMenu.addEventListener('click', (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const action = target.closest<HTMLElement>('[data-action]')?.dataset.action;
      if (action === 'url') this.openUrlDialog();
      else if (action === 'theme') this.toggleTheme();
      else if (action === 'help') this.openHelp();
      else if (action === 'download') this.openDownloadDialog();
    });
    this.trackMenu(moreButton, moreMenu);
  }

  private sampleItem(sample: SampleAsset): HTMLButtonElement {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'menu-item';
    item.setAttribute('role', 'menuitem');
    const label = document.createElement('span');
    label.textContent = sample.label;
    item.append(label);
    if (sample.note) {
      const note = document.createElement('small');
      note.textContent = sample.note;
      item.append(note);
    }
    item.addEventListener('click', () => {
      this.setQuery({ sample: sample.id });
      void this.loadSample(sample);
    });
    return item;
  }

  private trackMenu(button: HTMLButtonElement, menu: HTMLElement): void {
    const handle = bindMenu(button, menu);
    this.menus.push({ button, menu, close: () => handle.close() });
  }

  private bindSheetSwipe(): void {
    const head = document.querySelector<HTMLElement>('.panel-head');
    if (!head) return;
    let startY = 0;
    let tracking = false;
    head.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      startY = event.clientY;
      tracking = true;
      if (event.target instanceof Element && event.target.closest('button')) return;
      head.setPointerCapture(event.pointerId);
    });
    head.addEventListener('pointerup', (event) => {
      if (!tracking) return;
      tracking = false;
      if (event.target instanceof Element && event.target.closest('button')) return;
      if (event.clientY - startY > 64) this.togglePanel();
    });
  }

  private onEscape(event: KeyboardEvent): void {
    if (document.querySelector('dialog[open]')) return;
    const openMenu = this.menus.find((entry) => !entry.menu.hidden);
    if (openMenu) {
      event.preventDefault();
      openMenu.close();
      openMenu.button.focus();
      return;
    }
    if (!must('#loading').hidden) {
      event.preventDefault();
      this.cancelLoad();
      return;
    }
    const panel = must('#panel');
    if (panel.classList.contains('is-collapsed')) return;
    const focusInside = panel.contains(document.activeElement);
    if (!focusInside && !this.phoneSheet()) return;
    event.preventDefault();
    this.togglePanel();
    must<HTMLButtonElement>('#panel-btn').focus();
  }

  private phoneSheet(): boolean {
    const narrow = window.matchMedia('(max-width: 640px)').matches;
    const landscapeDrawer = window.matchMedia(
      '(max-width: 960px) and (max-height: 520px) and (pointer: coarse)',
    ).matches;
    return narrow && !landscapeDrawer;
  }

  private async boot(): Promise<void> {
    const params = new URLSearchParams(location.search);
    const url = params.get('url');
    const sampleId = params.get('sample');
    if (params.get('demo') === 'slab') {
      const raw = params.get('n');
      const requested = raw == null || raw === '' ? Number.NaN : Number(raw);
      const count = Number.isFinite(requested) ? Math.min(Math.max(Math.round(requested), 1000), 1_500_000) : undefined;
      await this.loadDemoSlab(count);
      return;
    }
    if (url) {
      await this.load(sourceFromUrl(url));
      return;
    }
    if (sampleId) {
      const sample = SAMPLES.find((item) => item.id === sampleId || item.href.endsWith(sampleId));
      if (sample) {
        await this.loadSample(sample);
        return;
      }
    }
    this.setLoading(false);
    this.setEmpty(true);
  }

  private async loadSample(sample: SampleAsset): Promise<void> {
    this.settings.flipY = Boolean(sample.flipY);
    must<HTMLInputElement>('#flip-y').checked = this.settings.flipY;
    const url = sampleUrl(sample, import.meta.env.BASE_URL);
    await this.load(sourceFromUrl(url, 'sample'));
  }

  private async load(source: AssetSource): Promise<void> {
    const generation = ++this.generation;
    this.loadAbort?.abort();
    const abort = new AbortController();
    this.loadAbort = abort;
    const stallFor = (stage?: string) => (stage === 'gpu' ? 10 * 60_000 : 90_000);
    let stallMs = stallFor();
    const stall = () => {
      abort.abort(new Error(stallMessage(stallMs)));
    };
    let watchdog: StallWatchdog = createStallWatchdog(stallMs, stall);
    const arm = (stage?: string) => {
      const next = stallFor(stage);
      if (next !== stallMs) {
        watchdog.clear();
        stallMs = next;
        watchdog = createStallWatchdog(stallMs, stall);
        return;
      }
      watchdog.kick();
    };
    this.loadingSource = source;
    this.setEmpty(false);
    this.beginLoadingClock();
    this.setLoading(true, `Opening ${source.name}`, undefined, undefined, 'detect');
    let loaded = false;
    try {
      const header = PROBE_EXTENSIONS.has(source.extension)
        ? await readProbe(source, 65536, abort.signal)
        : new Uint8Array();
      if (generation !== this.generation) return;
      const loader = this.registry.resolve(source, header);
      if (!loader) {
        throw new Error(
          `Unsupported file "${source.name}". Supported: ${this.registry.extensions().map((ext) => `.${ext}`).join(', ')}`,
        );
      }
      const large =
        (source.sizeBytes ?? Infinity) >= 64 * 1024 * 1024 ||
        this.host.items.some((item) => (item.getStats().memoryBytes ?? 0) >= 256 * 1024 * 1024);
      if (large) {
        this.host.clear();
        this.renderSceneInfo();
      }
      const renderable = await loader.load(source, {
        signal: abort.signal,
        budget: detectMemoryBudget(),
        extendedPrecision: this.settings.extendedPrecision,
        overrides: this.gaussianOverrides,
        onProgress: (progress) => {
          arm(progress.stage);
          if (generation !== this.generation) return;
          this.setLoading(true, progress.message ?? 'Loading', progress.loaded, progress.total, progress.stage);
        },
      });
      if (generation !== this.generation) {
        renderable.dispose();
        return;
      }
      this.host.clear();
      this.host.add(renderable, this.settings);
      this.lastSource = source;
      this.host.setFlip(this.settings.flipY);
      this.syncUpLabel();
      this.renderSceneInfo();
      this.setEmpty(false);
      const note = renderable.getStats().extra?.note;
      if (typeof note === 'string' && note.length > 0) this.toast(note, 'warn');
      loaded = true;
    } catch (error) {
      if (generation !== this.generation) return;
      this.toast(explainLoadError(error), 'error');
      this.setEmpty(this.host.items.length === 0);
    } finally {
      watchdog.clear();
      if (this.loadAbort === abort) this.loadAbort = null;
      if (generation === this.generation) {
        this.setLoading(false);
        if (loaded) this.maybeShowHint();
      }
    }
  }

  private setMode(mode: NavMode): void {
    this.host.setMode(mode);
    must('#mode-orbit').classList.toggle('is-on', mode === 'orbit');
    must('#mode-fly').classList.toggle('is-on', mode === 'fly');
    must('#mode-orbit').setAttribute('aria-pressed', mode === 'orbit' ? 'true' : 'false');
    must('#mode-fly').setAttribute('aria-pressed', mode === 'fly' ? 'true' : 'false');
  }

  private focusCenter(): void {
    const canvas = must<HTMLCanvasElement>('#view');
    const rect = canvas.getBoundingClientRect();
    const hit = this.host.focusPointer(rect.left + rect.width / 2, rect.top + rect.height / 2);
    if (!hit) this.toast('Nothing under the center of the view to focus.', 'info');
  }

  private toggleTheme(): void {
    const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
    document.documentElement.dataset.theme = next;
    writeStorage('3dviewer-theme', next);
    const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (meta) meta.content = next === 'light' ? '#f3f5f8' : '#0c0f14';
    this.host.setBackground(this.canvasColor());
    this.syncThemeButton();
  }

  private syncThemeButton(): void {
    const light = document.documentElement.dataset.theme === 'light';
    must('#theme-btn').setAttribute('aria-label', light ? 'Switch to dark theme' : 'Switch to light theme');
    const label = document.querySelector('.theme-label');
    if (label) label.textContent = light ? 'Dark theme' : 'Light theme';
  }

  private toggleHud(): void {
    const on = must('#hud').hidden;
    must('#hud').hidden = !on;
    must<HTMLInputElement>('#hud-switch').checked = on;
    writeStorage('3dviewer-hud', on ? 'on' : 'off');
  }

  private toggleGrid(): void {
    this.settings.showGrid = !this.settings.showGrid;
    must<HTMLInputElement>('#grid').checked = this.settings.showGrid;
    this.host.applySettings(this.settings);
  }

  private togglePanel(): void {
    const panel = must('#panel');
    panel.classList.toggle('is-collapsed');
    const open = !panel.classList.contains('is-collapsed');
    document.body.classList.toggle('panel-open', open);
    must('#panel-btn').setAttribute('aria-expanded', String(open));
    writeStorage('3dviewer-panel', open ? 'open' : 'closed');
  }

  private restorePanel(): void {
    let stored: string | null = null;
    try {
      stored = localStorage.getItem('3dviewer-panel');
    } catch {
      /* private mode */
    }
    const open = stored === 'open';
    must('#panel').classList.toggle('is-collapsed', !open);
    document.body.classList.toggle('panel-open', open);
    must('#panel-btn').setAttribute('aria-expanded', String(open));
  }

  private applyHudPref(): void {
    let stored: string | null = null;
    try {
      stored = localStorage.getItem('3dviewer-hud');
    } catch {
      /* private mode */
    }
    const on = stored === 'on' ? true : stored === 'off' ? false : window.matchMedia('(min-width: 641px)').matches;
    must('#hud').hidden = !on;
    must<HTMLInputElement>('#hud-switch').checked = on;
  }

  private setEmpty(empty: boolean): void {
    must('#empty').hidden = !empty;
  }

  private beginLoadingClock(): void {
    this.loadingStarted = performance.now();
    this.stageStarted = this.loadingStarted;
    this.loadingStage = null;
    must('#loading-elapsed').textContent = '';
    window.clearInterval(this.elapsedTimer);
    this.elapsedTimer = window.setInterval(() => this.renderElapsed(), 1000);
  }

  private renderElapsed(): void {
    const elapsed = performance.now() - this.loadingStarted;
    const node = must('#loading-elapsed');
    if (elapsed < 3000) {
      node.textContent = '';
    } else {
      const totalSec = Math.floor(elapsed / 1000);
      const minutes = Math.floor(totalSec / 60);
      const seconds = totalSec % 60;
      node.textContent = `${minutes}:${String(seconds).padStart(2, '0')}`;
    }
    if (this.loadingStage === 'gpu' && performance.now() - this.stageStarted > 20_000) {
      const detail = must('#loading-detail');
      if (detail.childElementCount === 0 && detail.textContent === '') {
        detail.textContent = 'Large scenes can take a few minutes on the GPU.';
      }
    }
  }

  private setLoading(
    active: boolean,
    message = '',
    loaded?: number,
    total?: number,
    stage?: LoadProgress['stage'],
  ): void {
    const overlay = must('#loading');
    const hint = must('#nav-hint');
    overlay.hidden = !active;
    must('#loading-cancel').hidden = this.loadAbort === null;
    if (active) {
      if (!hint.hidden) this.hintHeld = true;
      hint.hidden = true;
    } else if (this.hintHeld && must('#toast').hidden && !this.hintSeen()) {
      hint.hidden = false;
      hint.classList.remove('is-leaving');
      this.hintHeld = false;
    } else {
      this.hintHeld = false;
    }
    if (!active) {
      window.clearInterval(this.elapsedTimer);
      this.elapsedTimer = 0;
      must('#loading-track').hidden = true;
      must('#loading-detail').textContent = '';
      must('#loading-elapsed').textContent = '';
      must('#loading-sr').textContent = '';
      return;
    }
    if (message) must('#loading-text').textContent = message;
    const source = this.loadingSource;
    if (source) {
      const size = source.sizeBytes != null ? ` · ${formatBytes(source.sizeBytes)}` : '';
      must('#loading-file').textContent = `${source.name}${size}`;
      must('#step-download-label').textContent = source.origin === 'file' ? 'Read' : 'Download';
    }
    this.renderLoadingSteps(stage);
    const track = must('#loading-track');
    const bar = must<HTMLElement>('#loading-bar');
    const known = total !== undefined && total > 0 && loaded !== undefined && Number.isFinite(loaded);
    const determinate = known && stage !== 'gpu';
    track.hidden = false;
    if (determinate && loaded !== undefined && total !== undefined) {
      const ratio = Math.max(0, Math.min(1, loaded / total));
      const pct = Math.round(ratio * 100);
      track.classList.remove('is-indet');
      bar.style.width = `${(ratio * 100).toFixed(1)}%`;
      track.setAttribute('aria-valuenow', String(pct));
      const byteLine =
        stage === 'download' || total === source?.sizeBytes
          ? `${formatBytes(loaded)} of ${formatBytes(total)}`
          : '';
      this.setLoadingDetail(byteLine, `${pct}%`);
    } else {
      track.classList.add('is-indet');
      bar.style.width = '';
      track.removeAttribute('aria-valuenow');
      const gpuNote =
        stage === 'gpu' && performance.now() - this.stageStarted > 20_000
          ? 'Large scenes can take a few minutes on the GPU.'
          : '';
      this.setLoadingDetail(gpuNote, '');
    }
  }

  private setLoadingDetail(left: string, right: string): void {
    const detail = must('#loading-detail');
    detail.replaceChildren();
    if (left) {
      const span = document.createElement('span');
      span.textContent = left;
      detail.append(span);
    }
    if (right) {
      const span = document.createElement('span');
      span.textContent = right;
      if (!left) span.style.marginLeft = 'auto';
      detail.append(span);
    }
  }

  private renderLoadingSteps(stage?: LoadProgress['stage']): void {
    const order = ['download', 'parse', 'gpu'] as const;
    const index = stage == null || stage === 'detect' ? -1 : stage === 'ready' ? order.length : order.indexOf(stage);
    const source = this.loadingSource;
    const labels = [
      source?.origin === 'file' ? 'Read' : 'Download',
      'Decode',
      'GPU upload',
    ];
    const items = must('#loading-steps').querySelectorAll('li');
    items.forEach((item, i) => {
      item.classList.toggle('is-done', i < index);
      item.classList.toggle('is-active', i === index);
    });
    if (stage && stage !== this.loadingStage) {
      this.loadingStage = stage;
      this.stageStarted = performance.now();
      if (index >= 0 && index < order.length) {
        must('#loading-sr').textContent = `${labels[index]}, step ${index + 1} of 3`;
      }
    }
  }

  private cancelLoad(): void {
    const abort = this.loadAbort;
    if (!abort) return;
    this.loadAbort = null;
    this.generation += 1;
    abort.abort(new DOMException('Loading cancelled', 'AbortError'));
    this.setLoading(false);
    this.setEmpty(this.host.items.length === 0);
    this.toast('Loading cancelled.', 'info');
  }

  private bindToast(): void {
    const toast = must('#toast');
    toast.addEventListener('pointerenter', () => window.clearTimeout(this.toastTimer));
    toast.addEventListener('focusin', () => window.clearTimeout(this.toastTimer));
    toast.addEventListener('pointerleave', (event) => {
      if (toast.contains(event.relatedTarget as Node | null)) return;
      this.armToast(4000);
    });
    toast.addEventListener('focusout', (event) => {
      if (toast.contains(event.relatedTarget as Node | null)) return;
      this.armToast(4000);
    });
    must('#toast-close').addEventListener('click', () => {
      toast.hidden = true;
      window.clearTimeout(this.toastTimer);
    });
  }

  private armToast(ms: number): void {
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => {
      must('#toast').hidden = true;
    }, ms);
  }

  private hintSeen(): boolean {
    try {
      return localStorage.getItem('3dviewer-hint') === 'seen';
    } catch {
      return false;
    }
  }

  private maybeShowHint(): void {
    if (this.hintCleanup || this.hintSeen()) return;
    const hint = must('#nav-hint');
    if (must('#toast').hidden) {
      hint.classList.remove('is-leaving');
      hint.hidden = false;
    }
    const view = must('#view');
    const dismiss = () => this.dismissNavHint();
    view.addEventListener('pointerdown', dismiss);
    view.addEventListener('wheel', dismiss);
    const timer = window.setTimeout(dismiss, 8000);
    this.hintCleanup = () => {
      view.removeEventListener('pointerdown', dismiss);
      view.removeEventListener('wheel', dismiss);
      window.clearTimeout(timer);
      this.hintCleanup = null;
    };
  }

  private dismissNavHint(): void {
    const hint = must('#nav-hint');
    if (!this.hintCleanup && (hint.hidden || this.hintSeen())) return;
    this.hintCleanup?.();
    writeStorage('3dviewer-hint', 'seen');
    if (hint.hidden) return;
    hint.classList.add('is-leaving');
    const hide = () => {
      hint.hidden = true;
      hint.classList.remove('is-leaving');
    };
    const done = (event: TransitionEvent) => {
      if (event.propertyName !== 'opacity') return;
      hint.removeEventListener('transitionend', done);
      hide();
    };
    hint.addEventListener('transitionend', done);
    window.setTimeout(hide, 400);
  }

  private toast(message: string, kind: 'error' | 'warn' | 'info' = 'error'): void {
    const toast = must('#toast');
    const icons = {
      error: '#i-circle-alert',
      warn: '#i-triangle-alert',
      info: '#i-info',
    } as const;
    toast.dataset.kind = kind;
    toast.setAttribute('role', kind === 'error' ? 'alert' : 'status');
    must('#toast-icon').setAttribute('href', icons[kind]);
    must('#toast-msg').textContent = message;
    toast.hidden = false;
    must('#nav-hint').hidden = true;
    this.armToast(Math.min(14_000, 5000 + message.length * 20));
  }

  private openUrlDialog(): void {
    const dialog = must<HTMLDialogElement>('#url-dialog');
    const input = must<HTMLInputElement>('#url-input');
    input.value = '';
    must('#url-error').hidden = true;
    if (!dialog.open) dialog.showModal();
    input.focus();
  }

  private bindUrlForm(): void {
    const form = must<HTMLFormElement>('#url-form');
    const input = must<HTMLInputElement>('#url-input');
    const error = must('#url-error');
    form.addEventListener('submit', (event) => {
      const submitter = (event as SubmitEvent).submitter;
      if (!(submitter instanceof HTMLButtonElement) || submitter.value !== 'open') return;
      const value = input.value.trim();
      let parsed: URL;
      try {
        parsed = new URL(value);
      } catch {
        event.preventDefault();
        error.hidden = false;
        error.textContent = 'Enter an http or https link.';
        return;
      }
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        event.preventDefault();
        error.hidden = false;
        error.textContent = 'Enter an http or https link.';
        return;
      }
      error.hidden = true;
      this.setQuery({ url: value });
      void this.load(sourceFromUrl(value));
    });
  }

  private openHelp(): void {
    const dialog = must<HTMLDialogElement>('#help-dialog');
    if (!dialog.open) dialog.showModal();
  }

  private openDownloadDialog(): void {
    const os = detectDesktopOs();
    for (const row of document.querySelectorAll<HTMLElement>('#download-dialog [data-os]')) {
      const current = row.dataset.os === os;
      row.classList.toggle('is-current', current);
      if (current) row.setAttribute('aria-current', 'true');
      else row.removeAttribute('aria-current');
      const badge = row.querySelector<HTMLElement>('.download-badge');
      if (badge) badge.hidden = !current;
    }
    must('#download-note').textContent = unsignedInstallNote(os);
    const dialog = must<HTMLDialogElement>('#download-dialog');
    if (!dialog.open) dialog.showModal();
  }

  private setQuery(params: Record<string, string> | null): void {
    const search = params ? `?${new URLSearchParams(params).toString()}` : '';
    history.replaceState(null, '', location.pathname + search + location.hash);
  }

  private showGeoref(): void {
    const panel = must('#panel');
    if (panel.classList.contains('is-collapsed')) this.togglePanel();
    const section = must<HTMLDetailsElement>('#sec-geo');
    section.open = true;
    section.scrollIntoView({ block: 'nearest' });
    section.querySelector('summary')?.focus();
  }

  private renderSceneInfo(): void {
    const root = must('#scene-info');
    const item = this.host.items[0];
    if (!item) {
      fillKv(root, [['Status', 'Nothing loaded']]);
      this.renderGeoref(undefined);
    } else {
      const stats = item.getStats();
      const typeLabels: Record<string, string> = {
        splats: 'Gaussian splats',
        mesh: 'Mesh',
        points: 'Point cloud',
        voxels: 'Voxels',
      };
      const countLabels: Record<string, string> = {
        splats: 'Splats',
        points: 'Points',
        mesh: 'Vertices',
        voxels: 'Voxels',
      };
      const countValue = item.kind === 'mesh' ? (stats.vertices ?? stats.primitives) : stats.primitives;
      const rows: [string, string][] = [
        ['File', item.meta.fileName],
        ['Type', typeLabels[item.kind] ?? item.kind],
        ['Format', item.meta.loaderId],
        ['Size', formatBytes(item.meta.bytes)],
        [countLabels[item.kind] ?? 'Count', formatCount(countValue)],
      ];
      if (stats.sourcePrimitives != null && stats.sourcePrimitives !== stats.primitives) {
        rows.push(['Source', `${formatCount(stats.sourcePrimitives)} (subsampled to fit memory)`]);
      }
      if (stats.triangles) rows.push(['Triangles', formatCount(stats.triangles)]);
      const ms = item.meta.loadMs;
      rows.push(['Load time', ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`]);
      const skip = new Set(['epsg', 'offset', 'bounds', 'note']);
      const extraLabels: Record<string, string> = {
        stride: 'Sample stride',
        header: 'Header count',
        body: 'Body count',
        lodSplats: 'LoD splats',
      };
      if (stats.extra) {
        for (const [key, value] of Object.entries(stats.extra)) {
          if (skip.has(key)) continue;
          rows.push([extraLabels[key] ?? key, String(value)]);
        }
      }
      const pickLabel = this.host.pickIndexLabel();
      if (pickLabel) rows.push(['Pick index', pickLabel]);
      fillKv(root, rows);
      if (pickLabel) {
        const cells = root.querySelectorAll('dd');
        const last = cells[cells.length - 1];
        if (last) last.id = 'pick-index';
      }
      this.renderGeoref(stats.extra);
    }
    this.renderFileChip();
    this.syncShDegree();
    this.syncApplicable();
  }

  private renderGeoref(extra: Record<string, string | number> | undefined): void {
    const section = must('#sec-geo');
    const badge = must('#geo-badge');
    const link = must<HTMLAnchorElement>('#geo-epsg-link');
    const crs = presentEpsg(extra?.epsg);
    const offset = extra?.offset != null ? String(extra.offset) : '';
    const bounds = extra?.bounds != null ? String(extra.bounds) : '';
    const parts = bounds.split('→').map((part) => part.trim());
    const min = parts.length === 2 ? parts[0] ?? '' : '';
    const max = parts.length === 2 ? parts[1] ?? '' : '';
    const rows: [string, string][] = [];
    if (crs.crs) rows.push(['CRS', crs.crs]);
    if (offset) rows.push(['Offset', offset]);
    if (min) rows.push(['Min', min]);
    if (max) rows.push(['Max', max]);
    section.hidden = rows.length === 0;
    badge.hidden = crs.badge == null;
    must('#geo-badge-text').textContent = crs.badge ?? '';
    link.hidden = crs.href == null;
    if (crs.href) link.href = crs.href;
    else link.removeAttribute('href');
    fillKv(must('#geo-info'), rows, true);
    const lines = [
      crs.crs ? `CRS: ${crs.crs}` : '',
      offset ? `Offset: ${offset}` : '',
      min ? `Bounds min: ${min}` : '',
      max ? `Bounds max: ${max}` : '',
    ].filter((line) => line.length > 0);
    this.geoCopy = lines.join('\n');
  }

  private syncShDegree(): void {
    const select = must<HTMLSelectElement>('#sh-degree');
    let available: number | null = null;
    for (const item of this.host.items) {
      if (item.kind !== 'splats') continue;
      const sh = item.getStats().extra?.sh;
      if (sh == null) continue;
      const match = /^(\d+)/.exec(String(sh));
      if (!match?.[1]) continue;
      const degree = Number(match[1]);
      available = available == null ? degree : Math.min(available, degree);
    }
    for (const option of select.options) {
      option.disabled = available != null && Number(option.value) > available;
    }
    const shown = available == null ? this.settings.shDegree : Math.min(this.settings.shDegree, available);
    select.value = String(shown);
  }

  private renderFileChip(): void {
    const chip = must('#file-chip');
    const item = this.host.items[0];
    if (!item) {
      chip.hidden = true;
      return;
    }
    const labels: Record<string, string> = {
      splats: 'Splats',
      mesh: 'Mesh',
      points: 'Points',
      voxels: 'Voxels',
    };
    chip.hidden = false;
    must('#file-kind').textContent = labels[item.kind] ?? item.kind;
    const name = must('#file-name');
    name.textContent = item.meta.fileName;
    name.title = item.meta.fileName;
    must('#file-size').textContent = formatBytes(item.meta.bytes);
  }

  private syncApplicable(): void {
    const kinds = new Set<string>(this.host.items.map((item) => item.kind));
    for (const el of document.querySelectorAll<HTMLElement>('#panel [data-applies]')) {
      const applies = el.dataset.applies?.split(' ') ?? [];
      el.hidden = kinds.size > 0 && !applies.some((kind) => kinds.has(kind));
    }
    for (const sec of document.querySelectorAll<HTMLElement>('#panel details.sec')) {
      const applied = [...sec.querySelectorAll<HTMLElement>('[data-applies]')];
      if (applied.length === 0) continue;
      const otherControls = [...sec.querySelectorAll<HTMLElement>('.field, .field-row, .switch-row')].filter(
        (el) => !el.hasAttribute('data-applies'),
      );
      sec.hidden = applied.every((el) => el.hidden) && otherControls.every((el) => el.hidden);
    }
  }

  private renderPerf(stats: FrameStats): void {
    let splats = 0;
    let points = 0;
    let tris = 0;
    for (const item of this.host.items) {
      const itemStats = item.getStats();
      if (item.kind === 'splats') splats += itemStats.primitives;
      if (item.kind === 'points') points += itemStats.primitives;
      if (item.kind === 'mesh') tris += itemStats.triangles ?? itemStats.primitives;
    }
    const shownSplats = stats.activeSplats > 0 ? stats.activeSplats : splats;
    const hud = must('#hud');
    hud.classList.toggle('is-idle', stats.idle);
    must('#hud-fps').textContent = stats.idle ? 'Idle' : formatFixed(stats.fps, 0);
    must('#hud-ms').textContent = `${formatFixed(stats.renderMs)} ms`;
    must('#hud-splats').textContent = formatCount(shownSplats);
    must('#hud-points').textContent = formatCount(points);
    must('#hud-tris').textContent = formatCount(tris);
    must('#hud-gpu').textContent = formatBytes(stats.gpuMemoryBytes);
    must('#hud-summary-count').textContent =
      shownSplats > 0
        ? `${formatCompact(shownSplats)} splats`
        : points > 0
          ? `${formatCompact(points)} points`
          : tris > 0
            ? `${formatCompact(tris)} tris`
            : '—';
    must('#hud-summary-gpu').textContent = formatBytes(stats.gpuMemoryBytes);
    const pickIndex = document.getElementById('pick-index');
    if (pickIndex) pickIndex.textContent = this.host.pickIndexLabel();
    const rowValue: Record<string, number> = { splats: shownSplats, points, tris };
    for (const row of hud.querySelectorAll<HTMLElement>('[data-hud-row]')) {
      row.hidden = (rowValue[row.dataset.hudRow ?? ''] ?? 0) === 0;
    }
    if (must('#panel').classList.contains('is-collapsed')) return;
    const perf = must('#perf-info');
    const rows: [string, string][] = [
      ['Backend', stats.webgpuAvailable ? 'WebGL2 (WebGPU present)' : 'WebGL2'],
      ['FPS', stats.idle ? 'idle' : formatFixed(stats.fps, 0)],
      ['Frame', `${formatFixed(stats.renderMs)} ms`],
      ['Sort', stats.sortMs == null ? '—' : `${formatFixed(stats.sortMs, 0)} ms`],
      ['Active splats', formatCount(shownSplats)],
      ['GPU est.', formatBytes(stats.gpuMemoryBytes)],
    ];
    perf.replaceChildren(
      ...rows.flatMap(([key, value]) => {
        const dt = document.createElement('dt');
        dt.textContent = key;
        const dd = document.createElement('dd');
        dd.textContent = value;
        return [dt, dd];
      }),
    );
  }
}

function readGaussianOverrides(): GaussianLoadOverrides | undefined {
  if (typeof location === 'undefined') return undefined;
  const params = new URLSearchParams(location.search);
  const overrides: GaussianLoadOverrides = {};
  if (params.get('lod') === 'force') overrides.forceLod = true;
  const sh = params.get('sh');
  if (sh === '0' || sh === '1' || sh === '2' || sh === '3') {
    overrides.maxSh = Number(sh) as GaussianLoadOverrides['maxSh'];
  }
  if (!overrides.forceLod && overrides.maxSh == null) return undefined;
  return overrides;
}

function fillKv(root: HTMLElement, rows: [string, string][], mono = false): void {
  root.replaceChildren(
    ...rows.flatMap(([key, value]) => {
      const dt = document.createElement('dt');
      dt.textContent = key;
      const dd = document.createElement('dd');
      dd.textContent = value;
      if (mono) dd.classList.add('kv-mono');
      return [dt, dd];
    }),
  );
}

function stallMessage(ms: number): string {
  const label = ms >= 60_000 ? `${Math.round(ms / 60_000)} min` : `${Math.round(ms / 1000)} s`;
  return `Loading stalled: no progress for ${label}. The file is still on disk; try again, or convert it to a paged .rad so the next open does not read the whole PLY.`;
}

function writeStorage(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* quota or private mode */
  }
}

function must<T extends Element = HTMLElement>(selector: string): T {
  const node = document.querySelector<T>(selector);
  if (!node) throw new Error(`Missing ${selector}`);
  return node;
}

function syncRangeInputs(): void {
  for (const selector of ['#splat-scale', '#point-size', '#lod-scale', '#sensitivity']) {
    syncRangeFill(must<HTMLInputElement>(selector));
  }
}

function bindCheck(selector: string, onChange: (checked: boolean) => void): void {
  must<HTMLInputElement>(selector).addEventListener('change', (event) => {
    onChange((event.target as HTMLInputElement).checked);
  });
}
