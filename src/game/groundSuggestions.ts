import * as THREE from 'three';
import { robustBox } from '../render/upright';
import { createGroundProposalJob } from './groundDetection';
import type { GroundAnalysis, GroundSuggestion } from './GameSession';
import type { SceneGeometry } from './sceneGeometry';

export async function suggestGround(geometry: SceneGeometry, up: THREE.Vector3, signal: AbortSignal,
  options: { maxWork?: number } = {}): Promise<GroundAnalysis> {
  signal.throwIfAborted();
  if (geometry.positions.length < 24) return { suggestions: [], message: 'Not enough resident samples for a reliable plane proposal.' };
  const span = robustBox(geometry.positions).getSize(new THREE.Vector3()).length();
  if (!Number.isFinite(span) || span <= 0) return { suggestions: [], message: 'No broad finite surface evidence.' };
  const created = createGroundProposalJob({
    samples: { positions: geometry.positions, provenance: geometry.provenance },
    upHint: [up.x, up.y, up.z], distanceTolerance: Math.max(span * .002, 1e-9),
    maxSamples: 24_000, maxHypotheses: 64, maxCandidates: 3,
    minSupport: Math.max(8, Math.ceil(geometry.positions.length / 3 * .04)), seed: 20261125,
    ...(options.maxWork === undefined ? {} : { maxWork: options.maxWork }),
  });
  if (created.kind === 'invalid-input') return { suggestions: [], message: `Plane analysis unavailable (${created.reason}).` };
  let status = created.job.step(2048);
  while (status.status !== 'done') {
    signal.throwIfAborted();
    const start = performance.now();
    do {
      status = created.job.step(2048);
    } while (status.status !== 'done' && performance.now() - start < 2);
    if (status.status !== 'done') await new Promise<void>(resolve => globalThis.setTimeout(resolve, 0));
  }
  signal.throwIfAborted();
  const result = status.result;
  if (result.kind === 'capped') return { suggestions: [], message: 'Plane analysis reached its work cap, not a no-floor verdict. Use manual setup.' };
  if (result.kind === 'unavailable') return { suggestions: [], message: `No supported plane proposal (${result.reason}). Use manual setup or Make upright.` };
  const suggestions: GroundSuggestion[] = [];
  for (const candidate of result.candidates) {
    const normal = new THREE.Vector3(...candidate.normal);
    const centered = new THREE.Vector3(...candidate.centroid);
    if (![...normal.toArray(), ...centered.toArray(), candidate.offset, candidate.rms, candidate.spread].every(Number.isFinite) || normal.lengthSq() < 1e-20) continue;
    centered.addScaledVector(normal, -(normal.dot(centered) + candidate.offset));
    const point = centered.add(geometry.anchor);
    suggestions.push({ normal: normal.normalize(), point,
      evidence: `${result.ambiguous ? 'Multiple plausible planes — choose the correct level.' : 'Suggested plane — inspect and confirm.'} ${candidate.inlierCount.toLocaleString()} of ${candidate.sampleCount.toLocaleString()} sampled positions support this plane. Geometry alone cannot distinguish a floor from a table or ceiling.` });
  }
  return { suggestions, message: suggestions.length ? '' : 'Plane evidence was not numerically usable. Use manual setup.' };
}
