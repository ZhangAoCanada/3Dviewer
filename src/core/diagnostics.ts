import { isDesktopApp } from '../desktop/runtime';
import { detectMemoryBudget } from './memoryBudget';
import { formatBytes } from '../ui/format';
import { GraphicsUnavailableError } from './loadFailure';

export interface LoadDiag {
  name?: string;
  extension?: string;
  size?: number;
  origin?: string;
  /** Full URL. The report keeps the host only. */
  url?: string;
  stage?: string;
  elapsedMs?: number;
  preset?: string;
  error?: unknown;
}

export interface GraphicsSnapshot {
  rendererInfo: {
    renderer?: string;
    vendor?: string;
    maxTextureSize: number;
    software: boolean;
  };
  contextStatusMessage?: string;
}

export interface Diagnostics {
  build: string;
  desktop: boolean;
  pwa: boolean;
  userAgent: string;
  brands?: string;
  platform: string;
  language: string;
  webgl2: boolean;
  webgl1: boolean;
  renderer?: string;
  vendor?: string;
  maxTextureSize: number;
  software: boolean;
  statusMessage?: string;
  deviceMemory?: number;
  hardwareConcurrency?: number;
  jsHeapSizeLimit?: number;
  profile: string;
  cpuBytes: number;
  load?: LoadDiag;
  error?: unknown;
}

interface NavigatorHints {
  userAgent: string;
  platform: string;
  language: string;
  deviceMemory?: number;
  hardwareConcurrency?: number;
  userAgentData?: { brands?: { brand: string; version: string }[] };
}

export function collectDiagnostics(host?: GraphicsSnapshot | null, load?: LoadDiag): Diagnostics {
  const nav = readNavigator();
  const budget = detectMemoryBudget({
    userAgent: nav?.userAgent,
    deviceMemory: nav?.deviceMemory,
    hardwareConcurrency: nav?.hardwareConcurrency,
  });
  const graphics = host ? graphicsFromHost(host) : probeGraphics();
  const statusMessage = graphics.statusMessage || statusFrom(load?.error);
  const brands = nav?.userAgentData?.brands
    ?.map((brand) => `${brand.brand} ${brand.version}`)
    .filter((brand) => brand.trim().length > 0)
    .join(', ');
  return {
    build: appBuild(),
    desktop: isDesktopApp(),
    pwa: standaloneDisplay(),
    userAgent: nav?.userAgent ?? '',
    brands: brands || undefined,
    platform: nav?.platform ?? '',
    language: nav?.language ?? '',
    webgl2: graphics.webgl2,
    webgl1: graphics.webgl1,
    renderer: graphics.renderer,
    vendor: graphics.vendor,
    maxTextureSize: graphics.maxTextureSize,
    software: graphics.software,
    statusMessage,
    deviceMemory: nav?.deviceMemory,
    hardwareConcurrency: nav?.hardwareConcurrency,
    jsHeapSizeLimit: heapLimit(),
    profile: budget.profile,
    cpuBytes: budget.cpuBytes,
    load: load ? { ...load, preset: load.preset ?? 'automatic' } : undefined,
    error: load?.error,
  };
}

/** One `Key: value` per line. URLs contribute their host only. */
export function formatReport(d: Diagnostics): string {
  const yn = (value: boolean) => (value ? 'yes' : 'no');
  const lines = [
    `Omniview ${d.build}`,
    `App: ${d.desktop ? 'desktop app' : d.pwa ? 'installed app' : 'browser'}`,
    `User agent: ${d.userAgent || 'unknown'}`,
  ];
  if (d.brands) lines.push(`Brands: ${d.brands}`);
  lines.push(`Platform: ${d.platform || 'unknown'}`, `Language: ${d.language || 'unknown'}`);
  lines.push(`WebGL2: ${yn(d.webgl2)}`, `WebGL1: ${yn(d.webgl1)}`);
  if (d.renderer) lines.push(`Renderer: ${d.renderer}`);
  if (d.vendor) lines.push(`Vendor: ${d.vendor}`);
  lines.push(`Max texture size: ${d.maxTextureSize}`, `Software renderer: ${yn(d.software)}`);
  if (d.statusMessage) lines.push(`Graphics status: ${d.statusMessage}`);
  lines.push(
    `Device memory: ${d.deviceMemory == null ? 'unknown' : `${d.deviceMemory} GB`}`,
    `CPU cores: ${d.hardwareConcurrency ?? 'unknown'}`,
  );
  if (d.jsHeapSizeLimit != null) lines.push(`JS heap limit: ${formatBytes(d.jsHeapSizeLimit)}`);
  lines.push(`Memory profile: ${d.profile}`, `CPU budget: ${formatBytes(d.cpuBytes)}`);
  const load = d.load;
  if (load) {
    if (load.name) lines.push(`File: ${load.name}`);
    if (load.extension) lines.push(`Extension: ${load.extension}`);
    if (load.size != null) lines.push(`Size: ${formatBytes(load.size)}`);
    if (load.origin) lines.push(`Origin: ${load.origin}`);
    const host = hostOnly(load.url);
    if (host) lines.push(`Host: ${host}`);
    if (load.stage) lines.push(`Stage: ${load.stage}`);
    if (load.elapsedMs != null) lines.push(`Elapsed: ${formatElapsed(load.elapsedMs)}`);
    if (load.preset) lines.push(`Preset: ${load.preset}`);
  }
  const chain = errorChain(d.error);
  if (chain) lines.push(`Error: ${chain}`);
  return lines.join('\n');
}

export function hostOnly(url: string | undefined): string {
  if (!url) return '';
  try {
    return new URL(url).host;
  } catch {
    const noQuery = url.split('?')[0]?.split('#')[0] ?? '';
    const noScheme = noQuery.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '');
    const host = noScheme.split('/')[0] ?? '';
    return host;
  }
}

function appBuild(): string {
  return typeof __APP_BUILD__ === 'string' && __APP_BUILD__.length > 0 ? __APP_BUILD__ : 'dev';
}

function readNavigator(): NavigatorHints | undefined {
  if (typeof navigator === 'undefined') return undefined;
  const extra = navigator as Navigator & {
    deviceMemory?: number;
    userAgentData?: { brands?: { brand: string; version: string }[] };
  };
  return {
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    language: navigator.language,
    deviceMemory: extra.deviceMemory,
    hardwareConcurrency: navigator.hardwareConcurrency,
    userAgentData: extra.userAgentData,
  };
}

function standaloneDisplay(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(display-mode: standalone)').matches;
}

function heapLimit(): number | undefined {
  if (typeof performance === 'undefined') return undefined;
  const memory = (performance as Performance & { memory?: { jsHeapSizeLimit?: number } }).memory;
  return memory?.jsHeapSizeLimit;
}

function graphicsFromHost(host: GraphicsSnapshot): {
  webgl2: boolean;
  webgl1: boolean;
  renderer?: string;
  vendor?: string;
  maxTextureSize: number;
  software: boolean;
  statusMessage?: string;
} {
  const info = host.rendererInfo;
  return {
    webgl2: true,
    webgl1: true,
    renderer: info.renderer,
    vendor: info.vendor,
    maxTextureSize: info.maxTextureSize,
    software: info.software,
    statusMessage: host.contextStatusMessage,
  };
}

function probeGraphics(): {
  webgl2: boolean;
  webgl1: boolean;
  renderer?: string;
  vendor?: string;
  maxTextureSize: number;
  software: boolean;
  statusMessage?: string;
} {
  if (typeof document === 'undefined') {
    return { webgl2: false, webgl1: false, maxTextureSize: 0, software: false };
  }
  const gl2 = probeContext('webgl2');
  const gl1 = probeContext('webgl');
  const info = readRenderer(gl2.gl ?? gl1.gl);
  release(gl2.gl);
  release(gl1.gl);
  return {
    webgl2: gl2.gl != null,
    webgl1: gl1.gl != null,
    renderer: info.renderer,
    vendor: info.vendor,
    maxTextureSize: info.maxTextureSize,
    software: info.software,
    statusMessage: gl2.status || gl1.status,
  };
}

function probeContext(type: 'webgl2' | 'webgl'): {
  gl: WebGLRenderingContext | WebGL2RenderingContext | null;
  status?: string;
} {
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  let status = '';
  const onFail = (event: Event) => {
    const message = (event as WebGLContextEvent).statusMessage;
    if (message) status = message;
  };
  canvas.addEventListener('webglcontextcreationerror', onFail);
  const gl = canvas.getContext(type, { antialias: false, failIfMajorPerformanceCaveat: false }) as
    | WebGLRenderingContext
    | WebGL2RenderingContext
    | null;
  canvas.removeEventListener('webglcontextcreationerror', onFail);
  return { gl, status: status || undefined };
}

function readRenderer(gl: WebGLRenderingContext | WebGL2RenderingContext | null): {
  renderer?: string;
  vendor?: string;
  maxTextureSize: number;
  software: boolean;
} {
  if (!gl) return { maxTextureSize: 0, software: false };
  const debug = gl.getExtension('WEBGL_debug_renderer_info');
  let renderer: string | undefined;
  let vendor: string | undefined;
  if (debug) {
    const rawRenderer = gl.getParameter(debug.UNMASKED_RENDERER_WEBGL);
    const rawVendor = gl.getParameter(debug.UNMASKED_VENDOR_WEBGL);
    if (typeof rawRenderer === 'string') renderer = rawRenderer;
    if (typeof rawVendor === 'string') vendor = rawVendor;
  }
  const max = gl.getParameter(gl.MAX_TEXTURE_SIZE);
  const software = renderer != null && /SwiftShader|llvmpipe|Software|Basic Render/i.test(renderer);
  return { renderer, vendor, maxTextureSize: typeof max === 'number' ? max : 0, software };
}

function release(gl: WebGLRenderingContext | WebGL2RenderingContext | null): void {
  gl?.getExtension('WEBGL_lose_context')?.loseContext();
}

function statusFrom(error: unknown): string | undefined {
  if (error instanceof GraphicsUnavailableError && error.statusMessage) return error.statusMessage;
  if (error instanceof Error && error.name === 'GraphicsUnavailableError') {
    const status = (error as GraphicsUnavailableError).statusMessage;
    if (status) return status;
  }
  return undefined;
}

function errorChain(error: unknown): string {
  const parts: string[] = [];
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current != null && !seen.has(current) && parts.length < 8) {
    seen.add(current);
    if (current instanceof Error) {
      parts.push(`${current.name}: ${current.message}`);
      current = current.cause;
    } else {
      parts.push(String(current));
      break;
    }
  }
  return parts.join(' | ');
}

function formatElapsed(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}
