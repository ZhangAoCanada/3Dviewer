# Changelog

Release availability and assets are determined by GitHub Releases, not by this file.

## Unreleased

- **Fly starts mouse look in the same click** as the Fly toolbar button. Escape releases the mouse and stays in Fly; click the view or Fly to recapture. Drag-look remains when capture is unavailable or after a keyboard `2` entry, which cannot legally request pointer lock. Touch one-finger look is unchanged. Game one-click capture, Orbit, input ownership and prior-view restore are preserved. Inactive Game sessions no longer release a Fly pointer lock they did not own.

## 0.5.0

## What changed

- Preserved **one-click Game entry**; compact Pause controls adjust standing eye/body height, virtual-floor offset and independent movement speed without losing explored position or look. Unsafe changes give clearance/work-budget feedback. Optional floor/surface drafts and inspection preserve live stance and pose.
- Added **Space jump**, **C crouch/stand**, **Shift sprint**, **R reset**, **Escape pause** and arrow-key look fallback. Supported static-mesh capsule collision checks headroom and blocked standing. Virtual mode offers a finite-floor hop/return, explicitly **no reconstructed walls or ceilings**.
- Added optional16-action key remapping with conflict/recovery checks, capture/cancel/reset defaults and validated persistence. Independent FPS sensitivity and comfort/reduced-motion controls; no default head bob or shake.
- Fixed draft/live body isolation, crouched/airborne resume, stale error/recovery feedback, scale/pace calibration, keyboard Controls activation and focused-control Space ownership. Reset restores draft values during non-inspecting setup, only the inspector while inspecting, and normal player recovery in play/Pause.
- Preserved v5 identity, icon-only downloads, preferences/cache truth, previous Orbit/Fly restoration and waiting-update/no-automatic-reload behavior.

## Verification and limits

Approved54f8f36 passed612unit tests/61files,223canonical browsers, lint/types/build/precache41;51optional skips (50UI_SHOTS and1live-release lookup). Real8192-original-Gaussian fixture enabled. Independent actual Gemini-bot review/probes and scoped desktop operator checks passed; browser holds check actual camera/pixels. This is not physical sustained-key, installed-native, full-density or GPU certification. Final release-head/public-artifact checks are recorded separately.

Scene-unit scale and semantic floors are not guaranteed. Conservative reconstructed collision remains limited to supported static opaque single-material meshes up to20,000triangles, with bounded queries; unsupported meshes/points/splats retain finite virtual support, not invented walls/ceilings. A captured object subset is not a captured walkable-room certification. A documented pure-binding error-role attribution follow-up remains mitigated by truthful consumer conflict labels; invalid bindings are not accepted.

Installers remain **unsigned/not notarized** (macOS ad-hoc signing), with system-WebView dependencies and OS warnings. Hash integrity is not native installation/runtime/upgrade certification. Save work and choose **Reload** in the waiting update notice when ready; scenes are not forcibly reloaded.

## 0.4.1

## What changed

- **Game now enters FPS directly in one click** with mouse capture—no mandatory floor panel, reading or confirmation. Pause with Escape; optional floor/scale adjustment, Reset and Exit remain available. Exit restores the previous Orbit/Fly view.
- Fixed a verified keyboard-ownership failure: WASD could be discarded when an entry/resume button retained focus despite real canvas pointer capture. Editable fields, dialogs and menus still keep their input intent. Keyboard-look fallback clearly identifies arrow-key look.
- Improved scene-relative spawn/framing and finite virtual-floor room for thin scenes. Actual motion, blocked mesh movement and the artificial floor boundary now have distinct brief feedback.
- Ground preparation is opportunistic and cancellable. An already prepared capsule-clear supported static-mesh surface may be used; otherwise entry uses an explicitly labelled **finite virtual floor with no reconstructed wall/stair collision**. Background analysis never teleports a player or silently swaps the active collision world.
- Preserved v5 branding, icon-only downloads, settings/preferences, normal viewing modes, release-metadata cache truth and waiting-update/no-automatic-reload behavior.

## Verification and limits

The reviewed feature candidate passed523unit tests and205default browser tests, with51baselineoptional skips (50UI_SHOTS captures and1live-release lookup). Independent Gemini-bot review passed17targeted tests. Desktop operator review confirmed one-click capture/no setup, small mouse-look, pause/optional adjustment, Exit restoration and clear cloud labels; the native tool could not certify sustained key holds. Trusted browser holds verify actual camera translation, rendered-scene changes, keyup stability and retained-focus/resume paths. Real captured-center and original-Gaussian-subset fixtures also demonstrated movement; this is not full-density/native-GPU performance certification. The reporter's precise native cause remains unconfirmed despite the verified focus defect.

Scene scale and semantic floors are not guaranteed. Optional calibration remains available. Reconstructed collision is limited to supported static opaque single-material meshes up to20,000triangles, with bounded queries; points/Gaussians do not become solid walls or stairs. No touch, voxel, universal native-WebView capture, physical-GPU capacity/latency or actual-user-device acceptance is claimed. A full177kGaussian software observation timed out before its movement hold; no full-density performance guarantee.

Installers are **unsigned/not notarized** (macOS ad-hoc signing), with normal OS warnings and system-WebView dependencies. Download integrity is not native installation/runtime/upgrade certification. Existing scenes are not forcibly reloaded: choose Reload in the update notice when ready.

## 0.4.0

## What changed

- Added grounded **Game mode**: explicitly choose **Start FPS** for mouse capture, then WASD to walk, mouse to look, Shift for faster walking, Escape to pause/release, and R to reset. Keyboard-look fallback uses arrow keys. Exit restores the previous Orbit/Fly view, including subsequent scene/quality reloads. Capture/resume rejects a first relative-motion handoff impulse; ordinary motion remains direct.
- Inspect and confirm a proposed floor and spawn before entering. Manual floor/spawn picking, offset, tilt/flip, eye height and optional known scale remain available. Plane suggestions are evidence, not guaranteed semantic floor or metric scale; parallel levels and unavailable/capped analysis require user judgment.
- Supported static opaque single-material triangle meshes up to20,000triangles use capsule floor/wall/ceiling collision, gravity, bounded slopes/steps and fall recovery. Unsupported/mixed/oversized/deforming/transparent geometry conservatively declines reconstructed collision. Collision preparation is cooperative and cancellable, with resource limits rather than universal scene guarantees.
- Points and Gaussian splats use an explicitly **finite virtual floor with no reconstructed wall/stair collision**, optional subtle visual floor guide and a previewed boundary. Rendered Gaussians are not collision geometry. No voxel support claim.
- Preserved the approved v5 identity, icon-only desktop download, preferences, normal viewing modes, release-metadata cache truth and waiting-update/no-automatic-reload behavior.

## Verification and limits

Accepted feature head8c8468b passed507unit tests and198default browser tests;51optional cases were skipped, not passed (50UI_SHOTS captures and1live-release lookup). Independent Gemini-bot code review/retests and an actual desktop pointer-lock/mouse/WASD/pause/reset/restore retest passed within their stated scope. Release-head and public-artifact checks are recorded separately in the publication evidence.

Desktop keyboard required; no touch, universal native-WebView capture, installed-app/native-upgrade or physical-GPU certification. Automatic ground/scale certainty and splat-derived walls are not claimed. Measured20k-triangle preparation trades entry delay for responsiveness; no hard frame/latency or device-capacity guarantee. Installers remain unsigned/not notarized (macOS ad-hoc signing); system WebView requirements and OS warnings remain. Existing scenes are not forcibly reloaded for updates.

## 0.3.3

## What changed

- Keep queued pick-index work pending during the existing orientation debounce. This prevents premature Ready/benchmark-complete reports followed by renewed index progress; the final Ready badge still hides on its original timer after work actually settles. No timeout increase, retry loop or slower index scheduling.
- Applied the exact user-selected Gaussian polish **v5** Omniview identity, not aligned-v6: solid teal, seven Gaussian ellipsoids, mesh and points in one static O. The full outlined-wordmark vector is retained as the canonical source; faithful symbol derivatives cover header, favicon, PWA and Windows/macOS/Linux desktop icons. Dark full-lockup variant changes only wordmark color. No animation or application rename.
- Balanced content-sized header groups with consistent padding/heights and quieter shadows. Desktop download callout compacts at narrower widths; empty phones retain the wordmark and loaded phones prioritize filename space. Header controls remain34px fine-pointer /44px coarse-pointer without shrinking14px labels.
- Fixed narrow coarse-pointer document overflow and shifted header insets; preserved reachable44px phone navigation controls, long-name detail access, the approved Settings layout and Samples pointer access above an open desktop Settings drawer.
- Unified icon generation on the exact approved master, with fidelity, transparency, format and mask-safe-area regressions. Tiny16–24px rasterization naturally merges fine mesh/point detail; no alternate solid-ring motif was substituted.

## Verification and limits

The integrated candidate passed **380 unit tests**, **167 default browser tests** and **24 exact-production-preview tests**. **51 optional tests were skipped, not passed**:50 opt-in UI-shot cases and1 live-release API lookup. Actual light/dark desktop/narrow captures and50 matched geometry states preserve the reviewed toolbar layout. Native icon PNG/ICO/ICNS assets were decoded and inspected; that is not native installation proof. Release-head CI and publication checks are recorded separately with the release evidence.

Installers remain **unsigned/not notarized** (macOS uses ad-hoc signing). Windows SmartScreen/macOS Gatekeeper may warn or block; existing system WebView dependencies remain (WebView2, WKWebView, WebKitGTK). Native installation, runtime, upgrade, signing/notarization, installed-PWA/icon-cache behavior, physical touch, assistive-technology acceptance and actual-GPU capacity/performance have not been certified. No updater/security-policy changes. Existing tabs/installations may require normal reload/update; no upgrade-path acceptance is claimed.

The existing Full-source feature remains session-only for supported binary Gaussian PLY and is not lossless Spark precision or a VRAM/RTX5090-fit guarantee. No new quality/planner behavior is introduced in this patch.

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
