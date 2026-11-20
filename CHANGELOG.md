# Changelog

Release availability and assets are determined by GitHub Releases, not by this file.

## 0.3.2

## What changed

- Readable, responsive Settings: Quality & display first; separate requested and actually loaded detail; View & navigation; collapsed Advanced and Scene & diagnostics; clearer labels, help and reload actions.
- Crisp static complete teal O identity across the header, favicon and desktop/PWA assets; no spinner animation or application rename.
- Explicit **Full source detail** for supported binary Gaussian PLY imports, enabled only for the current session after accepting a memory-risk warning. Requests all source splats, supported source SH0–3 and float32 centers without the conservative automatic budget step-down. Automatic remains the default. Existing scenes remain until a reload succeeds; cancellation, allocation limits and bounded crash recovery are retained.
- Honest actual-loaded reasons distinguish an explicit SH load cap from recorded memory-budget reduction; unknown metadata is neutral. Pending settings do not claim already-loaded Full detail; render-only SH remains distinct from stored source detail.

## Important Full-detail limits

Full is **not lossless Spark precision**: SH/color/scale/rotation still use Spark encoding. Source SH above 3 is explicitly unsupported rather than silently labeled Full. Full source is limited to supported binary Gaussian PLY; Spark-only formats do not silently fall back. Available VRAM is unknown: no RTX 4090/5090 fit, performance or actual-user-scan verification is claimed. Very large imports can exhaust memory or exceed actual typed-array/WebGL texture limits. Automatic safeguards are recommended unless the risk is understood.

## Verification

The verified quality candidate passed **369 unit tests**, **143 default browser tests** and **22 exact-production-preview replay tests**. **51 optional tests were skipped**, not passed: 50 opt-in UI-shot matrix cases and one opt-in live-release API lookup. Independent code probes and browser/operator checks covered the Settings hierarchy, narrow/light/dark layouts, keyboard and actual Chrome 200% reachability, static identity and the tiny real SH3 fixture's SH2-cap → consent → pending → successful SH3 reload. Release-metadata gates and exact-head GitHub CI are recorded with the publication evidence.

Headless software-WebGL and CI compilation are not native installation/upgrade, physical-touch, assistive-technology, large-scene capacity or real-GPU performance acceptance.

## Desktop installation and security limits

Windows NSIS/MSI, universal macOS DMG and Linux AppImage/deb builds use the existing system WebView dependencies (WebView2, WKWebView or WebKitGTK). Installers remain **unsigned/not notarized** (macOS uses ad-hoc signing), so Windows SmartScreen/macOS Gatekeeper may warn. Native installation/upgrade and signing/notarization have not been tested or certified. No new updater/signing/security-policy changes are included; existing WebView/CSP limitations remain.

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
