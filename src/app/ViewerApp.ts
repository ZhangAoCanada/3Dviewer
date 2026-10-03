import { collectDiagnostics, formatReport, type LoadDiag } from '../core/diagnostics';
import { presentEpsg } from '../core/epsg';
import {
  classifyFailure,
  crashBreadcrumbFailure,
  GraphicsUnavailableError,
  LoadStalledError,
  type Failure,
} from '../core/loadFailure';
import { detectMemoryBudget } from '../core/memoryBudget';
import { mergePresetOverrides, parseQualityPreset, resolvePreset, type PresetPlan } from '../core/qualityPreset';
import { createStallWatchdog, type StallWatchdog } from '../core/watchdog';
import { SAMPLES, sampleUrl, type SampleAsset } from '../core/samples';
import { readProbe, sourceFromFile, sourceFromUrl } from '../core/sniff';
import {
  DEFAULT_SETTINGS,
  type AssetOrigin,
  type AssetSource,
  type GaussianLoadOverrides,
  type LoadProgress,
  type MemoryBudget,
  type QualityPreset,
  type Renderable,
  type RenderSettings,
  type ShadingMode,
} from '../core/types';
import { createDefaultRegistry } from '../loaders';
import type { FrameStats, Refinement } from '../render/SceneHost';
import { SceneHost } from '../render/SceneHost';
import type { NavMode, NavSnapshot, UpMode } from '../render/Navigation';
import { isTypingTarget } from '../render/Navigation';
import { createDemoSlab } from '../render/demoSlab';
import { bindRangeFills, syncRangeFill } from '../ui/controls';
import { formatBytes, formatCompact, formatCount, formatFixed } from '../ui/format';
import { phaseOf, progressLine, stallHint } from '../ui/loadPhase';
import { detectDesktopOs, unsignedInstallNote } from '../ui/downloadDesktop';
import { bindMenu } from '../ui/menu';
import { renderProblem, supportedFormats } from '../ui/problem';

const PROBE_EXTENSIONS = new Set(['ply', '']);
const INFLIGHT_KEY = '3dviewer-inflight';
const QUALITY_KEY = '3dviewer-quality';
const INFLIGHT_MAX_AGE = 24 * 60 * 60 * 1000;
const LARGE_BYTES = 64 * 1024 * 1024;
/** Below this, the pick index and first sort finish with the loading card. No badge. */
const REFINE_BADGE_ABOVE = 100_000;
const SOFTWARE_TOAST =
  'Graphics are running in software mode, so large scenes will be slow. Turn on hardware acceleration in your browser settings.';

interface InflightRecord {
  name: string;
  size: number | null;
  origin: AssetOrigin;
  url?: string;
  at: number;
}

interface ToastAction {
  label: string;
  run: () => void;
}

export class ViewerApp {
  private host: SceneHost | null = null;
  private readonly registry = createDefaultRegistry();
  private readonly budget: MemoryBudget;
  private readonly settings: RenderSettings;
  private generation = 0;
  private loadAbort: AbortController | null = null;
  private toastTimer = 0;
  private toastAction: ToastAction | null = null;
  private lastSource: AssetSource | null = null;
  private loadingSource: AssetSource | null = null;
  private failureSource: AssetSource | null = null;
  private lastError: unknown = null;
  private loadingStage: LoadProgress['stage'] | null = null;
  private loadingStarted = 0;
  private elapsedTimer = 0;
  private lastProgressAt = 0;
  private lastLoaded: number | undefined;
  private lastByteLoaded: number | undefined;
  private lastProgress: LoadProgress | null = null;
  private detailLine = '';
  private shownStep: 'reading' | 'preparing' | 'ready' | null = null;
  private qualityMode: 'off' | 'preview' | 'full' = 'off';
  private qualityTimer = 0;
  private geoCopy = '';
  private hintHeld = false;
  private hintCleanup: (() => void) | null = null;
  private readonly menus: { button: HTMLButtonElement; menu: HTMLElement; close: () => void }[] = [];
  /** Captured once from the page URL so later `history.replaceState` calls keep it. */
  private readonly gaussianOverrides = readGaussianOverrides();
  private savedUp: UpMode | null = null;
  private savedSensitivity: number | null = null;
  private graphicsFailure: Failure | null = null;
  private crashEntry: InflightRecord | null = null;
  private showingBreadcrumb = false;
  private reloadGraphics = false;
  private surface: 'empty' | 'problem' | 'none' = 'none';
  private bootFinishedWithoutGraphics = false;
  private loadedPreset: QualityPreset | null = null;
  private softwareNotified = false;
  private contextTimer = 0;

  constructor() {
    const canvas = document.querySelector<HTMLCanvasElement>('#view');
    if (!canvas) throw new Error('Missing viewport canvas');
    this.budget = detectMemoryBudget();
    this.settings = {
      ...DEFAULT_SETTINGS,
      quality: readStoredPreset(),
    };
    bindRangeFills(document);
    this.applyPreset(resolvePreset(this.settings.quality, this.budget));
    this.restoreNavPrefs();
    this.bind();
    this.syncThemeButton();
    this.applyHudPref();
    this.renderSceneInfo();
    this.crashEntry = readInflight();
    window.addEventListener('pagehide', () => this.clearInflight());
    // The stylesheet arrives with this module. Arm the drawer-clearance
    // transition only after the first paint, or the toolbar slides in.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => document.body.classList.add('chrome-ready'));
    });
  }

  private get items(): readonly Renderable[] {
    return this.host?.items ?? [];
  }

  /** Create the WebGL scene. The shell is already wired. Returns false when graphics are unavailable. */
  initGraphics(): boolean {
    if (this.host) return true;
    const canvas = document.querySelector<HTMLCanvasElement>('#view');
    if (!canvas) throw new Error('Missing viewport canvas');
    try {
      const host = new SceneHost(canvas, this.budget);
      host.onContextLost = () => this.onGpuLost();
      host.onContextRestored = () => this.onGpuRestored();
      host.setBackground(this.canvasColor());
      host.applySettings(this.settings);
      this.applyNavPrefs(host);
      this.host = host;
      document.body.classList.remove('no-graphics');
      host.start((stats) => this.renderPerf(stats));
      this.renderPerf(host.stats());
      this.maybeWarnSoftware(host);
      this.graphicsFailure = null;
      if (this.crashEntry) this.showBreadcrumb();
      else if (this.surface === 'problem') this.setSurface('none');
      if (this.bootFinishedWithoutGraphics) void this.boot();
      return true;
    } catch (error) {
      this.host = null;
      document.body.classList.add('no-graphics');
      must('#loading').hidden = true;
      this.lastError = error;
      this.graphicsFailure = classifyFailure(error);
      this.showProblem(this.graphicsFailure);
      return false;
    }
  }

  private canvasColor(): string {
    return document.documentElement.dataset.theme === 'light' ? '#e7ebf1' : '#10141b';
  }

  private bind(): void {
    const fileInput = must<HTMLInputElement>('#file-input');
    const open = () => {
      if (!this.host) {
        if (this.graphicsFailure) this.showProblem(this.graphicsFailure);
        return;
      }
      fileInput.click();
    };
    must('#open-btn').addEventListener('click', open);
    must('#empty-open').addEventListener('click', open);
    fileInput.addEventListener('change', () => {
      const file = fileInput.files?.[0];
      fileInput.value = '';
      if (!file) return;
      if (!this.host) {
        if (this.graphicsFailure) this.showProblem(this.graphicsFailure);
        return;
      }
      const source = sourceFromFile(file);
      this.setQuery(null);
      void this.load(source);
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
    must('#reset-btn').addEventListener('click', () => this.host?.resetView());
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
        if (!this.host) {
          if (this.graphicsFailure) this.showProblem(this.graphicsFailure);
          return;
        }
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
        this.host?.resetView();
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
    for (const preset of ['auto', 'quality', 'memory'] as const) {
      must<HTMLButtonElement>(`#quality-${preset}`).addEventListener('click', () => this.selectPreset(preset));
    }
    must('#quality-reopen').addEventListener('click', () => {
      const source = this.lastSource;
      if (!source) return;
      void this.load(source);
    });
    const scale = must<HTMLInputElement>('#splat-scale');
    const points = must<HTMLInputElement>('#point-size');
    const lod = must<HTMLInputElement>('#lod-scale');
    scale.addEventListener('input', () => {
      this.settings.splatScale = Number(scale.value);
      must('#out-splat-scale').textContent = formatFixed(this.settings.splatScale);
      syncRangeFill(scale);
      this.host?.applySettings(this.settings);
    });
    points.addEventListener('input', () => {
      this.settings.pointSize = Number(points.value);
      must('#out-point-size').textContent = formatFixed(this.settings.pointSize);
      syncRangeFill(points);
      this.host?.applySettings(this.settings);
    });
    lod.addEventListener('input', () => {
      this.settings.lodSplatScale = Number(lod.value);
      must('#out-lod').textContent = formatFixed(this.settings.lodSplatScale);
      syncRangeFill(lod);
      this.host?.applySettings(this.settings);
    });
    must<HTMLSelectElement>('#sh-degree').addEventListener('change', (event) => {
      this.settings.shDegree = Number((event.target as HTMLSelectElement).value) as RenderSettings['shDegree'];
      this.host?.applySettings(this.settings);
      this.syncShDegree();
    });
    must<HTMLSelectElement>('#shading').addEventListener('change', (event) => {
      this.settings.shading = (event.target as HTMLSelectElement).value as ShadingMode;
      this.host?.applySettings(this.settings);
    });
    must<HTMLSelectElement>('#pixel-ratio').addEventListener('change', (event) => {
      this.settings.pixelRatio = (event.target as HTMLSelectElement).value as RenderSettings['pixelRatio'];
      this.host?.applySettings(this.settings);
    });
    bindCheck('#wireframe', (on) => {
      this.settings.wireframe = on;
      this.host?.applySettings(this.settings);
    });
    bindCheck('#gs-2d', (on) => {
      this.settings.enable2DGS = on;
      this.host?.applySettings(this.settings);
    });
    bindCheck('#sort-radial', (on) => {
      this.settings.sortRadial = on;
      this.host?.applySettings(this.settings);
    });
    bindCheck('#extended', (on) => {
      this.settings.extendedPrecision = on;
    });
    bindCheck('#flip-y', (on) => {
      this.settings.flipY = on;
      if (this.items.length > 0) this.host?.setFlip(on);
    });
    bindCheck('#grid', (on) => {
      this.settings.showGrid = on;
      this.host?.applySettings(this.settings);
    });
    bindCheck('#hud-switch', (on) => {
      must('#hud').hidden = !on;
      writeStorage('3dviewer-hud', on ? 'on' : 'off');
    });
    must<HTMLSelectElement>('#up-axis').addEventListener('change', (event) => {
      const value = (event.target as HTMLSelectElement).value;
      if (value !== 'auto' && value !== 'y' && value !== 'z') return;
      this.savedUp = value;
      this.host?.setUpMode(value);
      writeStorage('3dviewer-up', value);
      this.syncUpLabel();
    });
    const sensitivity = must<HTMLInputElement>('#sensitivity');
    sensitivity.addEventListener('input', () => {
      const value = Number(sensitivity.value);
      this.savedSensitivity = value;
      this.host?.setSensitivity(value);
      must('#out-sensitivity').textContent = formatFixed(value);
      syncRangeFill(sensitivity);
      writeStorage('3dviewer-sensitivity', String(value));
    });
  }

  private restoreNavPrefs(): void {
    try {
      const up = localStorage.getItem('3dviewer-up');
      if (up === 'auto' || up === 'y' || up === 'z') {
        this.savedUp = up;
        must<HTMLSelectElement>('#up-axis').value = up;
      }
      const sensitivity = Number(localStorage.getItem('3dviewer-sensitivity'));
      if (Number.isFinite(sensitivity) && sensitivity >= 0.4 && sensitivity <= 2) {
        this.savedSensitivity = sensitivity;
        must<HTMLInputElement>('#sensitivity').value = String(sensitivity);
        must('#out-sensitivity').textContent = formatFixed(sensitivity);
      }
    } catch {
      /* private mode */
    }
    syncRangeInputs();
  }

  private applyNavPrefs(host: SceneHost): void {
    if (this.savedUp) host.upMode = this.savedUp;
    if (this.savedSensitivity != null) host.setSensitivity(this.savedSensitivity);
    this.syncUpLabel();
  }

  private syncUpLabel(): void {
    if (!this.host) return;
    must('#up-using').textContent = this.host.upAxis === 'z' ? 'Z-up' : 'Y-up';
  }

  private async loadDemoSlab(count?: number): Promise<void> {
    if (!this.host) {
      const failure =
        this.graphicsFailure ??
        classifyFailure(
          new GraphicsUnavailableError('no-webgl2', 'WebGL2 is required. This browser cannot create a WebGL2 context.'),
        );
      this.graphicsFailure = failure;
      this.showProblem(failure);
      this.setLoading(false);
      return;
    }
    const host = this.host;
    const generation = ++this.generation;
    this.loadAbort?.abort();
    const abort = new AbortController();
    this.loadAbort = abort;
    this.loadingSource = null;
    this.failureSource = null;
    this.setEmpty(false);
    this.beginLoadingClock();
    this.setLoading(true, { loaded: 0, stage: 'detect', message: 'Building a synthetic drone slab' });
    must('#loading-file').textContent = 'Synthetic drone slab';
    let loaded = false;
    try {
      const renderable = await createDemoSlab(count);
      if (generation !== this.generation || abort.signal.aborted) {
        renderable.dispose();
        return;
      }
      host.clear();
      host.add(renderable, this.settings);
      host.setFlip(false);
      this.syncUpLabel();
      this.renderSceneInfo();
      loaded = true;
    } catch (error) {
      if (generation !== this.generation) return;
      this.lastError = error;
      this.showProblem(classifyFailure(error, { stage: this.loadingStage ?? undefined }));
      this.setEmpty(this.items.length === 0);
    } finally {
      if (this.loadAbort === abort) this.loadAbort = null;
      if (generation === this.generation) {
        this.setLoading(false);
        if (loaded) this.maybeShowHint();
      }
    }
  }

  private selectPreset(preset: QualityPreset): void {
    if (this.settings.quality === preset) return;
    this.settings.quality = preset;
    writeStorage(QUALITY_KEY, preset);
    this.settings.splatScale = DEFAULT_SETTINGS.splatScale;
    this.settings.lodSplatScale = DEFAULT_SETTINGS.lodSplatScale;
    this.settings.enable2DGS = DEFAULT_SETTINGS.enable2DGS;
    this.settings.sortRadial = DEFAULT_SETTINGS.sortRadial;
    this.applyPreset(resolvePreset(preset, detectMemoryBudget()));
  }

  /** Apply a preset's render levers. Decode changes wait for a reopen. */
  private applyPreset(plan: PresetPlan): void {
    this.settings.shDegree = plan.renderSh;
    this.settings.pixelRatio = plan.pixelRatio;
    this.settings.extendedPrecision = plan.extendedPrecision;
    this.syncControls();
    this.host?.applySettings(this.settings);
    this.syncShDegree();
    this.syncReopen();
  }

  private syncQuality(plan: PresetPlan): void {
    for (const preset of ['auto', 'quality', 'memory'] as const) {
      const button = must<HTMLButtonElement>(`#quality-${preset}`);
      const on = this.settings.quality === preset;
      button.classList.toggle('is-on', on);
      button.setAttribute('aria-checked', on ? 'true' : 'false');
    }
    must('#quality-summary').textContent = plan.summary;
  }

  private syncReopen(): void {
    const reopen = document.querySelector<HTMLButtonElement>('#quality-reopen');
    if (!reopen) return;
    const needsDecode =
      this.loadedPreset != null &&
      this.loadedPreset !== this.settings.quality &&
      this.lastSource != null &&
      this.items.length > 0;
    reopen.hidden = !needsDecode;
  }

  private syncControls(): void {
    this.syncQuality(resolvePreset(this.settings.quality, detectMemoryBudget()));
    must<HTMLInputElement>('#splat-scale').value = String(this.settings.splatScale);
    must('#out-splat-scale').textContent = formatFixed(this.settings.splatScale);
    must<HTMLInputElement>('#point-size').value = String(this.settings.pointSize);
    must('#out-point-size').textContent = formatFixed(this.settings.pointSize);
    must<HTMLInputElement>('#lod-scale').value = String(this.settings.lodSplatScale);
    must('#out-lod').textContent = formatFixed(this.settings.lodSplatScale);
    must<HTMLSelectElement>('#sh-degree').value = String(this.settings.shDegree);
    must<HTMLSelectElement>('#pixel-ratio').value = this.settings.pixelRatio;
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

  async boot(): Promise<void> {
    const params = new URLSearchParams(location.search);
    const url = params.get('url');
    const sampleId = params.get('sample');
    if (!this.host) {
      if (url) this.loadingSource = sourceFromUrl(url);
      if (this.graphicsFailure) this.showProblem(this.graphicsFailure);
      this.setLoading(false);
      this.bootFinishedWithoutGraphics = true;
      return;
    }
    this.bootFinishedWithoutGraphics = false;
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

  private async load(source: AssetSource, options?: { restore?: NavSnapshot | null }): Promise<void> {
    if (!this.host) {
      this.loadingSource = source;
      this.failureSource = source;
      const failure =
        this.graphicsFailure ??
        classifyFailure(
          new GraphicsUnavailableError('no-webgl2', 'WebGL2 is required. This browser cannot create a WebGL2 context.'),
        );
      this.graphicsFailure = failure;
      this.lastError = this.lastError ?? this.graphicsFailure;
      this.showProblem(failure);
      this.setLoading(false);
      return;
    }
    const host = this.host;
    const generation = ++this.generation;
    this.loadAbort?.abort();
    const abort = new AbortController();
    this.loadAbort = abort;
    const stallFor = (stage?: string) => (stage === 'gpu' ? 10 * 60_000 : 90_000);
    let stallMs = stallFor();
    const stall = () => {
      abort.abort(new LoadStalledError(stallMessage(stallMs)));
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
    this.failureSource = source;
    this.showingBreadcrumb = false;
    this.setEmpty(false);
    this.beginLoadingClock();
    this.setLoading(true, { loaded: 0, stage: 'detect', message: `Opening ${source.name}` });
    this.noteInflight(source);
    const restore = options?.restore ?? null;
    const detected = detectMemoryBudget();
    const plan = resolvePreset(this.settings.quality, detected);
    const overrides = mergePresetOverrides(this.settings.quality, plan, this.gaussianOverrides);
    const extendedPrecision = this.settings.extendedPrecision;
    const presetAtLoad = this.settings.quality;
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
        plan.alwaysPreClear ||
        (source.sizeBytes ?? Infinity) >= LARGE_BYTES ||
        this.items.some((item) => (item.getStats().memoryBytes ?? 0) >= 256 * 1024 * 1024);
      if (large) {
        host.clear();
        this.renderSceneInfo();
      }
      const renderable = await loader.load(source, {
        signal: abort.signal,
        budget: plan.budget,
        extendedPrecision,
        overrides,
        onProgress: (progress) => {
          arm(progress.stage);
          if (generation !== this.generation) return;
          this.noteProgress(progress);
          this.setLoading(true, progress);
        },
      });
      if (generation !== this.generation) {
        renderable.dispose();
        return;
      }
      host.clear();
      host.add(renderable, this.settings);
      this.lastSource = source;
      this.loadedPreset = presetAtLoad;
      host.setFlip(this.settings.flipY);
      if (restore) {
        host.navigation.restore(restore);
        this.syncModeButtons(restore.mode);
      }
      this.syncUpLabel();
      this.renderSceneInfo();
      this.setEmpty(false);
      const note = renderable.getStats().extra?.note;
      if (typeof note === 'string' && note.length > 0) this.toast(note, 'warn');
      loaded = true;
    } catch (error) {
      if (generation !== this.generation) return;
      const reason = abort.signal.reason;
      const surfaced = reason instanceof LoadStalledError ? reason : error;
      this.lastError = surfaced;
      const failure = classifyFailure(surfaced, { source, stage: this.loadingStage ?? undefined });
      if (failure.kind === 'cancelled') {
        this.toast('Loading cancelled.', 'info');
        this.setEmpty(this.items.length === 0);
        return;
      }
      this.showProblem(failure);
      this.setEmpty(this.items.length === 0);
    } finally {
      watchdog.clear();
      if (this.loadAbort === abort) this.loadAbort = null;
      if (generation === this.generation) {
        this.clearInflight();
        this.setLoading(false);
        if (loaded) this.maybeShowHint();
      }
    }
  }

  private setMode(mode: NavMode): void {
    this.host?.setMode(mode);
    this.syncModeButtons(mode);
  }

  private syncModeButtons(mode: NavMode): void {
    must('#mode-orbit').classList.toggle('is-on', mode === 'orbit');
    must('#mode-fly').classList.toggle('is-on', mode === 'fly');
    must('#mode-orbit').setAttribute('aria-pressed', mode === 'orbit' ? 'true' : 'false');
    must('#mode-fly').setAttribute('aria-pressed', mode === 'fly' ? 'true' : 'false');
  }

  private focusCenter(): void {
    if (!this.host) return;
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
    this.host?.setBackground(this.canvasColor());
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
    this.host?.applySettings(this.settings);
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

  private setSurface(surface: 'empty' | 'problem' | 'none'): void {
    this.surface = surface;
    must('#empty').hidden = surface !== 'empty';
    must('#problem').hidden = surface !== 'problem';
  }

  private setEmpty(empty: boolean): void {
    if (!empty) {
      if (this.surface !== 'none') this.setSurface('none');
      return;
    }
    if (this.surface === 'problem') return;
    this.setSurface('empty');
  }

  private beginLoadingClock(): void {
    this.loadingStarted = performance.now();
    this.lastProgressAt = this.loadingStarted;
    this.lastLoaded = undefined;
    this.lastByteLoaded = undefined;
    this.lastProgress = null;
    this.detailLine = '';
    this.shownStep = null;
    this.loadingStage = null;
    this.resetQuality();
    must('#loading-elapsed').textContent = '';
    window.clearInterval(this.elapsedTimer);
    this.elapsedTimer = window.setInterval(() => this.renderElapsed(), 1000);
  }

  private noteProgress(progress: LoadProgress): void {
    const bytes = progress.bytes?.loaded;
    if (progress.loaded !== this.lastLoaded || bytes !== this.lastByteLoaded) {
      this.lastLoaded = progress.loaded;
      this.lastByteLoaded = bytes;
      this.lastProgressAt = performance.now();
    }
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
    this.writeLoadingDetail();
  }

  private setLoading(active: boolean, progress: LoadProgress | null = null): void {
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
      this.detailLine = '';
      must('#loading-track').hidden = true;
      must('#loading-detail').textContent = '';
      must('#loading-elapsed').textContent = '';
      must('#loading-sr').textContent = '';
      return;
    }
    const current = progress ?? { loaded: 0, stage: 'detect' as const };
    this.lastProgress = current;
    if (current.message) must('#loading-text').textContent = current.message;
    const source = this.loadingSource;
    if (source) {
      const size = source.sizeBytes != null ? ` · ${formatBytes(source.sizeBytes)}` : '';
      must('#loading-file').textContent = `${source.name}${size}`;
    }
    this.renderLoadingSteps(current);
    const track = must('#loading-track');
    const bar = must<HTMLElement>('#loading-bar');
    const { loaded, total, stage } = current;
    const known = total !== undefined && total > 0 && loaded !== undefined && Number.isFinite(loaded);
    const determinate = known && stage !== 'gpu';
    track.hidden = false;
    if (determinate && total !== undefined) {
      const ratio = Math.max(0, Math.min(1, loaded / total));
      const pct = Math.round(ratio * 100);
      track.classList.remove('is-indet');
      bar.style.width = `${(ratio * 100).toFixed(1)}%`;
      track.setAttribute('aria-valuenow', String(pct));
    } else {
      track.classList.add('is-indet');
      bar.style.width = '';
      track.removeAttribute('aria-valuenow');
    }
    this.detailLine = progressLine(current, source);
    this.writeLoadingDetail();
  }

  private currentStallHint(): string | null {
    const progress = this.lastProgress;
    const stage = progress?.stage ?? this.loadingStage ?? 'detect';
    return stallHint({
      phase: progress ? phaseOf(progress) : 'reading',
      stage,
      origin: this.loadingSource?.origin,
      host: remoteHost(this.loadingSource),
      idleMs: performance.now() - this.lastProgressAt,
      splats: stage === 'gpu' ? progress?.loaded : undefined,
    });
  }

  private writeLoadingDetail(): void {
    const hint = this.currentStallHint();
    const detail = must('#loading-detail');
    detail.textContent = hint ?? this.detailLine;
  }

  private renderLoadingSteps(progress: LoadProgress): void {
    const stage = progress.stage;
    const phase = phaseOf(progress);
    const reading = readingLabel(this.loadingSource?.origin);
    must('#step-download-label').textContent = reading;
    const items = must('#loading-steps').querySelectorAll('li');
    const activeIndex = stage === 'ready' ? items.length : phase === 'preparing' ? 1 : 0;
    items.forEach((item, index) => {
      const done = stage === 'ready' || index < activeIndex;
      item.classList.toggle('is-done', done);
      item.classList.toggle('is-active', stage !== 'ready' && index === activeIndex);
    });
    const step = stage === 'ready' ? 'ready' : phase;
    if (step !== this.shownStep) {
      this.shownStep = step;
      if (step === 'reading') must('#loading-sr').textContent = `${reading}, step 1 of 2`;
      else if (step === 'preparing') must('#loading-sr').textContent = 'Preparing scene, step 2 of 2';
    }
    if (stage !== this.loadingStage) this.loadingStage = stage;
  }

  private resetQuality(): void {
    window.clearTimeout(this.qualityTimer);
    this.qualityTimer = 0;
    this.qualityMode = 'off';
    const badge = document.getElementById('file-quality');
    if (!badge) return;
    badge.hidden = true;
    badge.removeAttribute('title');
  }

  private renderQuality(): void {
    const badge = must('#file-quality');
    if (must('#file-chip').hidden || !this.host) {
      if (this.qualityMode !== 'off') this.resetQuality();
      return;
    }
    const info = this.host.refinement();
    const refining = info.pending && this.primitiveCount() >= REFINE_BADGE_ABOVE;
    if (refining) {
      window.clearTimeout(this.qualityTimer);
      this.qualityTimer = 0;
      this.qualityMode = 'preview';
      badge.hidden = false;
      must('#file-quality-icon').hidden = true;
      must('#file-quality-label').textContent = 'Interactive preview';
      const title = qualityTitle(info, this.splatCount());
      if (title) badge.title = title;
      else badge.removeAttribute('title');
      return;
    }
    if (this.qualityMode !== 'preview') return;
    this.qualityMode = 'full';
    badge.hidden = false;
    must('#file-quality-icon').hidden = false;
    must('#file-quality-label').textContent = 'Full quality';
    badge.removeAttribute('title');
    window.clearTimeout(this.qualityTimer);
    this.qualityTimer = window.setTimeout(() => {
      badge.hidden = true;
      this.qualityMode = 'off';
    }, 2000);
  }

  private splatCount(): number {
    let splats = 0;
    for (const item of this.items) {
      if (item.kind === 'splats') splats += item.getStats().primitives;
    }
    return splats;
  }

  private primitiveCount(): number {
    let count = 0;
    for (const item of this.items) {
      const stats = item.getStats();
      count += stats.primitives;
    }
    return count;
  }

  private cancelLoad(): void {
    const abort = this.loadAbort;
    if (!abort) return;
    this.loadAbort = null;
    this.generation += 1;
    abort.abort(new DOMException('Loading cancelled', 'AbortError'));
    this.setLoading(false);
    this.clearInflight();
    this.setEmpty(this.items.length === 0);
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
    must('#toast-action').addEventListener('click', () => this.toastAction?.run());
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

  private toast(message: string, kind: 'error' | 'warn' | 'info' = 'error', action?: ToastAction): void {
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
    const button = must<HTMLButtonElement>('#toast-action');
    if (action) {
      button.hidden = false;
      button.textContent = action.label;
      this.toastAction = action;
    } else {
      button.hidden = true;
      this.toastAction = null;
    }
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
    const item = this.items[0];
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
      const pickLabel = this.host?.pickIndexLabel() ?? '';
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
    this.syncReopen();
    this.renderQuality();
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
    for (const item of this.items) {
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
    const item = this.items[0];
    if (!item) {
      chip.hidden = true;
      this.resetQuality();
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
    const kinds = new Set<string>(this.items.map((item) => item.kind));
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
    for (const item of this.items) {
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
    if (pickIndex) pickIndex.textContent = this.host?.pickIndexLabel() ?? '';
    this.renderQuality();
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

  private onGpuLost(): void {
    this.toast('The GPU reset. Reloading the scene…', 'warn');
    window.clearTimeout(this.contextTimer);
    this.contextTimer = window.setTimeout(() => {
      if (!this.host?.contextLost) return;
      this.lastError = new GraphicsUnavailableError('renderer-failed', 'The GPU reset and did not recover.');
      this.reloadGraphics = true;
      this.showingBreadcrumb = false;
      const failure = classifyFailure(this.lastError);
      this.showProblem(failure, { force: true });
    }, 10_000);
  }

  private onGpuRestored(): void {
    window.clearTimeout(this.contextTimer);
    this.reloadGraphics = false;
    const host = this.host;
    if (!host) return;
    const source = this.lastSource;
    const snap = source ? host.navigation.snapshot() : null;
    host.clear();
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
    void this.load(source, { restore: snap });
  }

  private maybeWarnSoftware(host: SceneHost): void {
    if (this.softwareNotified) return;
    let software = false;
    try {
      software = host.rendererInfo.software;
    } catch {
      software = false;
    }
    if (!software) return;
    this.softwareNotified = true;
    this.toast(SOFTWARE_TOAST, 'warn');
  }

  private showBreadcrumb(): void {
    const entry = this.crashEntry;
    if (!entry) return;
    this.showingBreadcrumb = true;
    this.reloadGraphics = false;
    this.showProblem(crashBreadcrumbFailure(entry), { force: true, breadcrumb: true });
  }

  private showProblem(failure: Failure, options?: { force?: boolean; breadcrumb?: boolean }): void {
    this.showingBreadcrumb = options?.breadcrumb === true;
    if (failure.kind !== 'graphics') this.reloadGraphics = false;
    const hasScene = this.items.length > 0;
    const graphicsDead = failure.kind === 'graphics';
    if (hasScene && !options?.force && !options?.breadcrumb && !graphicsDead) {
      this.toast(failure.title, 'error', {
        label: 'Details',
        run: () => this.paintProblem(failure, true),
      });
      return;
    }
    const startBehind = !hasScene;
    this.paintProblem(failure, hasScene || startBehind);
  }

  private paintProblem(failure: Failure, showBack: boolean): void {
    const root = must('#problem');
    renderProblem(root, failure, formatReport(collectDiagnostics(this.host, this.loadDiag())), {
      retry: () => this.retryLoad(),
      retryLowerMemory: () => this.retryLowerMemory(),
      chooseFile: () => this.chooseFile(),
      openFile: () => this.chooseFile(),
      downloadApp: () => this.openDownloadDialog(),
      reinitGraphics: () => {
        if (this.reloadGraphics) {
          location.reload();
          return;
        }
        this.initGraphics();
      },
      formats: () => {
        const desc = must('#problem-desc');
        const line = supportedFormats();
        if (!desc.textContent?.includes(line)) desc.textContent = `${desc.textContent ?? ''}\n\n${line}`;
      },
      back: () => this.setSurface(this.items.length > 0 ? 'none' : 'empty'),
      dismiss: () => this.dismissBreadcrumb(),
      labels: this.reloadGraphics ? { 'reinit-graphics': 'Reload viewer' } : undefined,
      showBack: showBack && !this.showingBreadcrumb,
      showDismiss: this.showingBreadcrumb,
    });
    this.setSurface('problem');
    must('#loading').hidden = true;
    must('#toast').hidden = true;
  }

  private dismissBreadcrumb(): void {
    this.clearInflight();
    this.crashEntry = null;
    this.showingBreadcrumb = false;
    this.setSurface(this.items.length > 0 ? 'none' : 'empty');
  }

  private retryLowerMemory(): void {
    this.selectPreset('memory');
    this.toast('Lower memory is on. Change it in Settings.', 'info');
    if (this.showingBreadcrumb && this.crashEntry) {
      this.retryBreadcrumb();
      return;
    }
    this.retryLoad();
  }

  private retryLoad(): void {
    if (this.showingBreadcrumb && this.crashEntry) {
      this.retryBreadcrumb();
      return;
    }
    const source = this.failureSource ?? this.loadingSource ?? this.lastSource;
    if (!source || (source.origin === 'file' && !source.file)) {
      this.chooseFile();
      return;
    }
    void this.load(source, { restore: this.snapshotForRetry(source) });
  }

  private retryBreadcrumb(): void {
    const entry = this.crashEntry;
    if (!entry) return;
    if (entry.origin === 'file' || !entry.url) {
      this.chooseFile();
      return;
    }
    const origin: AssetOrigin = entry.origin === 'sample' ? 'sample' : 'url';
    const source = sourceFromUrl(entry.url, origin);
    if (entry.size != null) source.sizeBytes = entry.size;
    void this.load(source, { restore: this.snapshotForRetry(source) });
  }

  private chooseFile(): void {
    if (!this.host) {
      if (this.graphicsFailure) this.showProblem(this.graphicsFailure);
      return;
    }
    must<HTMLInputElement>('#file-input').click();
  }

  private snapshotForRetry(source: AssetSource): NavSnapshot | null {
    if (!this.host || !this.lastSource || !sameAsset(this.lastSource, source)) return null;
    return this.host.navigation.snapshot();
  }

  private loadDiag(): LoadDiag {
    const source = this.loadingSource ?? this.failureSource;
    const params = new URLSearchParams(location.search);
    const bootUrl = params.get('url');
    return {
      name: source?.name,
      extension: source?.extension,
      size: source?.sizeBytes,
      origin: source?.origin,
      url: source?.url ?? bootUrl ?? undefined,
      stage: this.loadingStage ?? undefined,
      elapsedMs: this.loadingStarted > 0 ? performance.now() - this.loadingStarted : undefined,
      preset: this.settings.quality === 'quality' ? 'better quality' : this.settings.quality === 'memory' ? 'lower memory' : 'automatic',
      error: this.lastError,
    };
  }

  private noteInflight(source: AssetSource): void {
    const size = source.sizeBytes;
    if (size != null && size < LARGE_BYTES) return;
    const record: InflightRecord = {
      name: source.name,
      size: size ?? null,
      origin: source.origin,
      at: Date.now(),
    };
    if (source.url && source.origin !== 'file') record.url = source.url;
    writeStorage(INFLIGHT_KEY, JSON.stringify(record));
  }

  private clearInflight(): void {
    try {
      localStorage.removeItem(INFLIGHT_KEY);
    } catch {
      /* private mode */
    }
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

function sameAsset(a: AssetSource, b: AssetSource): boolean {
  return a.name === b.name && a.sizeBytes === b.sizeBytes && a.origin === b.origin;
}

function readInflight(): InflightRecord | null {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(INFLIGHT_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    clearStoredInflight();
    return null;
  }
  if (!parsed || typeof parsed !== 'object') {
    clearStoredInflight();
    return null;
  }
  const entry = parsed as Partial<InflightRecord>;
  if (typeof entry.name !== 'string' || typeof entry.at !== 'number') {
    clearStoredInflight();
    return null;
  }
  if (entry.origin !== 'file' && entry.origin !== 'url' && entry.origin !== 'sample') {
    clearStoredInflight();
    return null;
  }
  if (Date.now() - entry.at > INFLIGHT_MAX_AGE || entry.at > Date.now() + 60_000) {
    clearStoredInflight();
    return null;
  }
  const size = typeof entry.size === 'number' ? entry.size : null;
  const record: InflightRecord = { name: entry.name, size, origin: entry.origin, at: entry.at };
  if (typeof entry.url === 'string') record.url = entry.url;
  return record;
}

function clearStoredInflight(): void {
  try {
    localStorage.removeItem(INFLIGHT_KEY);
  } catch {
    /* private mode */
  }
}

function readingLabel(origin: AssetOrigin | undefined): string {
  return origin === 'url' || origin === 'sample' ? 'Downloading' : 'Reading file';
}

function remoteHost(source: AssetSource | null): string | undefined {
  const url = source?.url;
  if (!url) return undefined;
  try {
    return new URL(url, window.location.href).host;
  } catch {
    return undefined;
  }
}

function qualityTitle(info: Refinement, splats: number): string {
  const parts: string[] = [];
  if (info.index != null) {
    parts.push(`Building pick index ${Math.min(99, Math.round(info.index * 100))}%`);
  }
  if (info.sorting) parts.push(splats > 0 ? `sorting ${formatCompact(splats)} splats` : 'sorting');
  if (info.paging) parts.push('paging');
  return parts.join(' · ');
}

function stallMessage(ms: number): string {
  const label = ms >= 60_000 ? `${Math.round(ms / 60_000)} min` : `${Math.round(ms / 1000)} s`;
  return `Loading stalled: no progress for ${label}. The file is still on disk; try again, or convert it to a paged .rad so the next open does not read the whole PLY.`;
}

function readStoredPreset(): QualityPreset {
  try {
    return parseQualityPreset(localStorage.getItem(QUALITY_KEY));
  } catch {
    return 'auto';
  }
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
