# Changelog

Release availability and assets are determined by GitHub Releases, not by this file.

## 0.3.1

Quality fixes since v0.3.0:

- Preserve explicit scene selections through deferred startup and graphics recovery; honor crash-recovery dismissal instead of retrying the failed source automatically.
- Keep modal/menu/button keyboard ownership intact, clear held flight input on focus loss, and make repeated Orbit selection idempotent.
- Fit portrait/aspect-ratio views correctly, reset against the current viewport without discarding deliberate navigation during resize, and continue supported touch gestures after either pointer leaves/cancels.
- Reject truncated/nonfinite PLY records clearly; handle preceding scalar elements and integer coordinate aliases, bounded allocations, consistent source/retained counts and full headers within the shared 1 MiB budget.
- Share PLY terminator grammar and exact binary payload offsets across probing, classification and point/Gaussian parsers, including trailing spaces/tabs and comment lookalikes.
- Preserve grouped mesh materials, transparency and vertex colors in Unlit; resolve each OBJ material library's own texture base, preserve supported quoted/apostrophe/hash filenames, and repaint after late textures.
- Keep cached HEAD/range routing valid after worker restart; validate response offsets, totals and exposed resource validators without adding cross-origin If-Range preflight requirements.
- Measure actual rendered-frame cadence, cancel benchmark-owned reloads without canceling unrelated user loads, and support quality radio arrow/Home/End/Tab behavior.
- Keep narrow/short empty-state guidance and actions scrollable and reachable; prevent notices/chrome and the scene stats HUD from obscuring the start card while preserving loaded HUD preferences.
- Keep optional release lookup failures/rate limits from blocking scene operations; retain strict deterministic error tests.

### Verification and limits

The quality candidate passed 326 unit tests and 125 default browser tests, with 51 explicit optional skips (50 UI_SHOTS captures and one live release lookup). All seven added PLY imports and three HUD regressions also passed against its immutable production preview. Release preparation adds a version-integrity regression and a manifest-derived fallback expectation; its actual gate results must be recorded separately before publication.

Headless software-renderer tests and CI compilation are not native installation, upgrade, physical-touch, assistive-technology or real-GPU capacity/performance verification. Operator evidence includes narrow actions, loaded HUD keyboard expansion, actual Chrome 200% reachability, a long-header point import and a red Unlit OBJ with selected companion files; directory hierarchy remains automation-only.

Desktop installers remain unsigned/not notarized (macOS uses ad-hoc signing), with the existing system WebView dependencies. Windows SmartScreen/macOS Gatekeeper may warn. Native installation/upgrade and signing/notarization have not been verified. No dependency/security-policy changes are included; existing CSP/WebView limitations remain.
