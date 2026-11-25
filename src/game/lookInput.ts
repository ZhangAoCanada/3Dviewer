export type LookDecision = { kind: 'zero' | 'applied' | 'capture-handoff' | 'discontinuity'; dx: number; dy: number };
/** Pointer ownership changes can produce a center-warp impulse. Trust is diagnostic, not a filter. */
export class RelativeLookInput {
  private awaitingFirstMotion = true;
  reset(): void { this.awaitingFirstMotion = true; }
  consume(dx: number, dy: number, sensitivity: number): LookDecision {
    if (dx === 0 && dy === 0) return { kind: 'zero', dx: 0, dy: 0 };
    if (this.awaitingFirstMotion) {
      this.awaitingFirstMotion = false;
      return { kind: 'capture-handoff', dx: 0, dy: 0 };
    }
    // A single event exceeding 45 degrees on either axis is a discontinuity, not an accumulated turn.
    // Ordinary events remain 1:1; do not clamp the eventual heading or reject untrusted input wholesale.
    if (Math.max(Math.abs(dx), Math.abs(dy)) * .0025 * sensitivity > Math.PI / 4)
      return { kind: 'discontinuity', dx: 0, dy: 0 };
    return { kind: 'applied', dx, dy };
  }
}
