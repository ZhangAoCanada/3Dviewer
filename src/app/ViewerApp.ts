import { detectMemoryBudget } from '../core/memoryBudget';
import { SAMPLES, sampleUrl, type SampleAsset } from '../core/samples';
import { readProbe, sourceFromFile, sourceFromUrl } from '../core/sniff';
import {
  DEFAULT_SETTINGS,
  type AssetSource,
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
import { formatBytes, formatCount, formatFixed } from '../ui/format';

const PROBE_EXTENSIONS = new Set(['ply', '']);

export class ViewerApp {
  private readonly host: SceneHost;
  private readonly registry = createDefaultRegistry();
  private readonly settings: RenderSettings;
  private generation = 0;
  private loadAbort: AbortController | null = null;
  private toastTimer = 0;

  constructor() {
    const canvas = document.querySelector<HTMLCanvasElement>('#view');
    if (!canvas) throw new Error('Missing viewport canvas');
    const budget = detectMemoryBudget();
    this.settings = {
      ...DEFAULT_SETTINGS,
      shDegree: budget.maxSh,
    };
    this.host = new SceneHost(canvas, budget);
    this.host.setBackground(this.canvasColor());
    this.host.applySettings(this.settings);
    this.syncControls();
    this.restoreNavPrefs();
    this.bind(canvas);
    this.renderSceneInfo();
    this.renderPerf(this.host.stats());
    this.host.start((stats) => this.renderPerf(stats));
    window.addEventListener('resize', () => this.host.resize());
    void this.boot();
  }

  private canvasColor(): string {
    return document.documentElement.dataset.theme === 'light' ? '#e7ebf1' : '#10141b';
  }

  private bind(canvas: HTMLCanvasElement): void {
    const fileInput = must<HTMLInputElement>('#file-input');
    const open = () => fileInput.click();
    must('#open-btn').addEventListener('click', open);
    must('#empty-open').addEventListener('click', open);
    fileInput.addEventListener('change', () => {
      const file = fileInput.files?.[0];
      fileInput.value = '';
      if (file) void this.load(sourceFromFile(file));
    });

    must('#empty-sample').addEventListener('click', () => {
      const sample = SAMPLES[0];
      if (sample) void this.loadSample(sample);
    });

    this.buildSamples();
    must('#mode-orbit').addEventListener('click', () => this.setMode('orbit'));
    must('#mode-fly').addEventListener('click', () => this.setMode('fly'));
    must('#reset-btn').addEventListener('click', () => this.host.resetView());
    must('#theme-btn').addEventListener('click', () => this.toggleTheme());
    must('#panel-btn').addEventListener('click', () => this.togglePanel());

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
      if (file) void this.load(sourceFromFile(file));
    });

    window.addEventListener('keydown', (event) => {
      if (isTypingTarget(event.target) || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.code === 'KeyR') {
        this.host.resetView();
      } else if (event.code === 'KeyF') {
        const rect = canvas.getBoundingClientRect();
        const hit = this.host.focusPointer(rect.left + rect.width / 2, rect.top + rect.height / 2);
        if (!hit) this.toast('Nothing under the center of the view to focus.');
      } else if (event.code === 'Digit1') {
        this.setMode('orbit');
      } else if (event.code === 'Digit2') {
        this.setMode('fly');
      } else if (event.code === 'KeyH') {
        this.togglePanel();
      }
    });

    if (window.matchMedia('(max-width: 860px)').matches) {
      must('#panel').classList.add('is-collapsed');
      must<HTMLButtonElement>('#panel-btn').setAttribute('aria-expanded', 'false');
    }
  }

  private bindSettings(): void {
    const scale = must<HTMLInputElement>('#splat-scale');
    const points = must<HTMLInputElement>('#point-size');
    const lod = must<HTMLInputElement>('#lod-scale');
    scale.addEventListener('input', () => {
      this.settings.splatScale = Number(scale.value);
      must('#out-splat-scale').textContent = formatFixed(this.settings.splatScale);
      this.host.applySettings(this.settings);
    });
    points.addEventListener('input', () => {
      this.settings.pointSize = Number(points.value);
      must('#out-point-size').textContent = formatFixed(this.settings.pointSize);
      this.host.applySettings(this.settings);
    });
    lod.addEventListener('input', () => {
      this.settings.lodSplatScale = Number(lod.value);
      must('#out-lod').textContent = formatFixed(this.settings.lodSplatScale);
      this.host.applySettings(this.settings);
    });
    must<HTMLSelectElement>('#sh-degree').addEventListener('change', (event) => {
      this.settings.shDegree = Number((event.target as HTMLSelectElement).value) as RenderSettings['shDegree'];
      this.host.applySettings(this.settings);
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
    must<HTMLSelectElement>('#up-axis').addEventListener('change', (event) => {
      const value = (event.target as HTMLSelectElement).value;
      if (value !== 'auto' && value !== 'y' && value !== 'z') return;
      this.host.setUpMode(value);
      localStorage.setItem('3dviewer-up', value);
      this.syncUpLabel();
    });
    const sensitivity = must<HTMLInputElement>('#sensitivity');
    sensitivity.addEventListener('input', () => {
      const value = Number(sensitivity.value);
      this.host.setSensitivity(value);
      must('#out-sensitivity').textContent = formatFixed(value);
      localStorage.setItem('3dviewer-sensitivity', String(value));
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
  }

  private syncUpLabel(): void {
    must('#up-using').textContent = this.host.upAxis === 'z' ? 'Z-up' : 'Y-up';
  }

  private async loadDemoSlab(count?: number): Promise<void> {
    this.setEmpty(false);
    this.setLoading(true, 'Building a synthetic drone slab');
    try {
      const renderable = await createDemoSlab(count);
      this.host.clear();
      this.host.add(renderable, this.settings);
      this.host.setFlip(false);
      this.syncUpLabel();
      this.renderSceneInfo();
    } catch (error) {
      this.toast(explainLoadError(error), 'error');
      this.setEmpty(this.host.items.length === 0);
    } finally {
      this.setLoading(false);
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
  }

  private buildSamples(): void {
    const menu = must('#samples-menu');
    const button = must<HTMLButtonElement>('#samples-btn');
    for (const sample of SAMPLES) {
      const item = document.createElement('button');
      item.type = 'button';
      item.innerHTML = `${sample.label}${sample.note ? `<small>${sample.note}</small>` : ''}`;
      item.addEventListener('click', () => {
        menu.hidden = true;
        button.setAttribute('aria-expanded', 'false');
        void this.loadSample(sample);
      });
      menu.append(item);
    }
    button.addEventListener('click', () => {
      menu.hidden = !menu.hidden;
      button.setAttribute('aria-expanded', String(!menu.hidden));
    });
    document.addEventListener('pointerdown', (event) => {
      if (!(event.target instanceof Node)) return;
      if (!button.contains(event.target) && !menu.contains(event.target)) {
        menu.hidden = true;
        button.setAttribute('aria-expanded', 'false');
      }
    });
  }

  private async boot(): Promise<void> {
    const params = new URLSearchParams(location.search);
    const url = params.get('url');
    const sampleId = params.get('sample');
    if (params.get('demo') === 'slab') {
      const requested = Number(params.get('n'));
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
    const torus = SAMPLES.find((item) => item.id === 'torus-ply');
    if (torus) await this.loadSample(torus);
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
    const timeoutMs = loadTimeoutMs(source.sizeBytes);
    const timer = window.setTimeout(() => {
      abort.abort(
        new Error(
          'This file is taking too long to decode. It is still on disk; try again, or convert it to a paged .rad so the next open does not read the whole PLY.',
        ),
      );
    }, timeoutMs);
    this.setEmpty(false);
    this.setLoading(true, `Opening ${source.name}`);
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
      const renderable = await loader.load(source, {
        signal: abort.signal,
        budget: detectMemoryBudget(),
        extendedPrecision: this.settings.extendedPrecision,
        onProgress: (progress) => {
          if (generation !== this.generation) return;
          this.setLoading(true, progress.message ?? 'Loading', progress.loaded, progress.total);
        },
      });
      if (generation !== this.generation) {
        renderable.dispose();
        return;
      }
      this.host.clear();
      this.host.add(renderable, this.settings);
      this.host.setFlip(this.settings.flipY);
      this.syncUpLabel();
      this.renderSceneInfo();
      this.setEmpty(false);
      const note = renderable.getStats().extra?.note;
      if (typeof note === 'string' && note.length > 0) this.toast(note, 'warn');
    } catch (error) {
      if (generation !== this.generation) return;
      this.toast(explainLoadError(error), 'error');
      this.setEmpty(this.host.items.length === 0);
    } finally {
      window.clearTimeout(timer);
      if (generation === this.generation) this.setLoading(false);
    }
  }

  private setMode(mode: NavMode): void {
    this.host.setMode(mode);
    must('#mode-orbit').classList.toggle('is-on', mode === 'orbit');
    must('#mode-fly').classList.toggle('is-on', mode === 'fly');
  }

  private toggleTheme(): void {
    const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
    document.documentElement.dataset.theme = next;
    localStorage.setItem('3dviewer-theme', next);
    const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (meta) meta.content = next === 'light' ? '#f3f5f8' : '#0c0f14';
    this.host.setBackground(this.canvasColor());
  }

  private togglePanel(): void {
    const panel = must('#panel');
    panel.classList.toggle('is-collapsed');
    const open = !panel.classList.contains('is-collapsed');
    must('#panel-btn').setAttribute('aria-expanded', String(open));
  }

  private setEmpty(empty: boolean): void {
    must('#empty').hidden = !empty;
  }

  private setLoading(active: boolean, message = '', loaded?: number, total?: number): void {
    const overlay = must('#loading');
    overlay.hidden = !active;
    if (message) must('#loading-text').textContent = message;
    const track = must('#loading-track');
    const bar = must<HTMLElement>('#loading-bar');
    const detail = must('#loading-detail');
    const known = total !== undefined && total > 0 && loaded !== undefined && Number.isFinite(loaded);
    if (!active) {
      track.hidden = true;
      detail.textContent = '';
      return;
    }
    track.hidden = false;
    if (known) {
      const ratio = Math.max(0, Math.min(1, loaded / total));
      track.classList.remove('is-indet');
      bar.style.width = `${(ratio * 100).toFixed(1)}%`;
      detail.textContent = `${formatCount(loaded)} / ${formatCount(total)}  ·  ${Math.round(ratio * 100)}%`;
    } else {
      track.classList.add('is-indet');
      bar.style.width = '';
      detail.textContent = '';
    }
  }

  private toast(message: string, kind: 'error' | 'warn' = 'error'): void {
    const toast = must('#toast');
    toast.hidden = false;
    toast.classList.toggle('is-warn', kind === 'warn');
    toast.textContent = message;
    window.clearTimeout(this.toastTimer);
    const hold = Math.min(14_000, 5000 + message.length * 20);
    this.toastTimer = window.setTimeout(() => {
      toast.hidden = true;
    }, hold);
  }

  private renderSceneInfo(): void {
    const root = must('#scene-info');
    const item = this.host.items[0];
    if (!item) {
      root.innerHTML = '<dt>Status</dt><dd>Nothing loaded</dd>';
      return;
    }
    const stats = item.getStats();
    const rows: [string, string][] = [
      ['File', item.meta.fileName],
      ['Kind', item.kind],
      ['Loader', item.meta.loaderId],
      ['Load', `${Math.round(item.meta.loadMs)} ms`],
      ['Size', formatBytes(item.meta.bytes)],
      ['Count', formatCount(stats.primitives)],
    ];
    if (stats.sourcePrimitives && stats.sourcePrimitives !== stats.primitives) {
      rows.push(['Source', formatCount(stats.sourcePrimitives)]);
    }
    if (stats.triangles) rows.push(['Triangles', formatCount(stats.triangles)]);
    if (stats.extra) {
      for (const [key, value] of Object.entries(stats.extra)) rows.push([key, String(value)]);
    }
    root.replaceChildren(
      ...rows.flatMap(([key, value]) => {
        const dt = document.createElement('dt');
        dt.textContent = key;
        const dd = document.createElement('dd');
        dd.textContent = value;
        return [dt, dd];
      }),
    );
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
    must('#hud-fps').textContent = formatFixed(stats.fps, 0);
    must('#hud-ms').textContent = `${formatFixed(stats.frameMs)} ms`;
    must('#hud-splats').textContent = formatCount(shownSplats);
    must('#hud-points').textContent = formatCount(points);
    must('#hud-tris').textContent = formatCount(tris);
    must('#hud-gpu').textContent = formatBytes(stats.gpuMemoryBytes);
    const perf = must('#perf-info');
    const rows: [string, string][] = [
      ['Backend', stats.webgpuAvailable ? 'WebGL2 (WebGPU present)' : 'WebGL2'],
      ['FPS', formatFixed(stats.fps, 0)],
      ['Frame', `${formatFixed(stats.frameMs)} ms`],
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

function loadTimeoutMs(sizeBytes: number | undefined): number {
  const mb = (sizeBytes ?? 0) / (1024 * 1024);
  if (mb >= 512) return 45 * 60_000;
  if (mb >= 64) return 10 * 60_000;
  return 3 * 60_000;
}

function must<T extends Element = HTMLElement>(selector: string): T {
  const node = document.querySelector<T>(selector);
  if (!node) throw new Error(`Missing ${selector}`);
  return node;
}

function bindCheck(selector: string, onChange: (checked: boolean) => void): void {
  must<HTMLInputElement>(selector).addEventListener('change', (event) => {
    onChange((event.target as HTMLInputElement).checked);
  });
}
