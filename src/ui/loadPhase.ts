import type { AssetOrigin, LoadProgress } from '../core/types';
import { formatBytes } from './format';

/** Idle time before a non-GPU stall hint. The GPU stage keeps the longer wait. */
export const STALL_HINT_MS = 10_000;
const GPU_STALL_HINT_MS = 20_000;

export type LoadPhase = 'reading' | 'preparing';

export interface StallHintInput {
  phase: LoadPhase;
  stage?: LoadProgress['stage'];
  origin?: AssetOrigin;
  host?: string;
  idleMs: number;
  splats?: number;
}

/** `detect` and `download` read the file. `parse` and `gpu` prepare the scene. */
export function phaseOf(progress: Pick<LoadProgress, 'phase' | 'stage'>): LoadPhase {
  if (progress.phase) return progress.phase;
  if (progress.stage === 'parse' || progress.stage === 'gpu' || progress.stage === 'ready') return 'preparing';
  return 'reading';
}

/**
 * One line under the progress bar.
 * Reading shows bytes and, when the length is known, a percent.
 * Preparing shows the loader message, with no percent invented for the GPU upload.
 */
export function progressLine(progress: LoadProgress, source?: { sizeBytes?: number } | null): string {
  if (phaseOf(progress) !== 'reading') return progress.message ?? '';
  const loaded = progress.bytes ? progress.bytes.loaded : progress.loaded;
  const total = progress.bytes ? (progress.bytes.total ?? source?.sizeBytes) : (progress.total ?? source?.sizeBytes);
  if (!Number.isFinite(loaded)) return progress.message ?? '';
  if (total == null || !Number.isFinite(total) || total <= 0) return formatBytes(loaded);
  const pct = Math.round(Math.max(0, Math.min(1, loaded / total)) * 100);
  return `${formatBytes(loaded)} of ${formatBytes(total)} · ${pct}%`;
}

/** Stage-specific hint once a load has gone quiet. Null while progress is still fresh. */
export function stallHint(input: StallHintInput): string | null {
  const limit = input.stage === 'gpu' ? GPU_STALL_HINT_MS : STALL_HINT_MS;
  if (input.idleMs < limit) return null;
  const seconds = Math.max(1, Math.round(input.idleMs / 1000));
  if (input.phase === 'preparing') {
    if (input.stage === 'gpu') {
      const count =
        input.splats != null && Number.isFinite(input.splats) ? Math.round(input.splats).toLocaleString() : null;
      const subject = count ? `${count} splats` : 'splats';
      return `Uploading ${subject} to the GPU in one step. The page can freeze until it finishes; Cancel applies right after.`;
    }
    return 'Still decoding. Compressed formats (.spz, .sog) decode in one step and do not report progress.';
  }
  if (input.origin === 'file') {
    return `The browser has not read more of the file for ${seconds} s. Files on network or cloud-synced drives can pause while they download.`;
  }
  const host = input.host && input.host.length > 0 ? input.host : 'the server';
  return `No data from ${host} for ${seconds} s. The server or connection may be slow. You can keep waiting or cancel.`;
}
