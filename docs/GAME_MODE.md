# Game mode implementation

Game mode owns camera/input only while playing or paused; ordinary Orbit/Fly stays in `NavigationController`. `GameSession` snapshots position, quaternion, pivot, up, clipping and FOV without changing `NavSnapshot` reload semantics. `SceneHost` drives both through its one frame loop; suspended ordinary navigation is inert. Scene replacement/orientation clears the session before disposal; GPU recovery returns to ordinary viewing. No source decode or persistent preference change is needed for navigation geometry.

## Geometry and units

`sceneGeometry` samples at most 24,000 positions over at most 256 objects and anchors coordinates before Float32 conversion. Mesh floor samples cover triangle interiors; points/Gaussians remain appearance evidence, not solids. Gaussian extraction stays in `gaussianRenderable`, supports original resident packed/extended buffers, filters opacity/nonfinite centers and declines paged data.

Gemini-bot supplied the bounded pure `groundDetection` module (original commit 0c9cbf8). Integration independently tested/fixed finite nonzero up normalization and occupancy-area ranking. `groundSuggestions` schedules its job cooperatively, checks aborts, uses caller-unit robust-span tolerance and maps incomplete/unavailable results to manual setup. Every candidate remains unconfirmed. Up alignment is a proposal prior, not walkability. Fixed-seed RANSAC may miss a weak plane; geometry alone cannot identify semantic floors.

`gameFrame` leaves content transforms intact: a nearby world origin and chosen normal define a local Y-up physics frame. Scene-unit eye height consistently sets capsule, speed, gravity, step size and near plane. There is no inferred metric scale.

## Supported collision

A static spatial-split triangle BVH includes all supported collision triangles or reports unavailability. No sampled walls. Hard caps: 20,000 triangles, 4096 candidates/node visits per query, 8192 triangle tests across one player update, 120 Hz fixed step with 50 ms elapsed cap and radius-relative movement subdivisions. A budget/unsolved contact is a safe blocked/recovery outcome, not empty space. Production coordinate conversion, validation, bounds, partition and BVH finalization all yield cooperatively and check cancellation. No uninterruptible full-array sort is used. Work slices check elapsed time every64units, aim for4ms and contain at most2048units; these are scheduling targets, not GC/OS latency guarantees. Setup stays editable and Start waits for complete collision data; calibration/exit/replacement abort stale work.

Capsule contact uses segment/triangle closest points, with both face orientations supported independently of display shading/material cloning. Support rays accept local slopes up to 45 degrees; small steps check upward clearance and landing. Missing mesh support causes gravity/fall recovery, not an invisible plane. Virtual-floor support is a separate finite rectangular model, explicitly artificial and without reconstructed wall/stair collision.

Unsupported static-collision sources include multi-material group layouts, transparent/alpha-cutout materials, skinned/morph/instanced geometry, mixed point/splat data, oversized or invalid meshes. No voxel loader exists. Scene geometry is assumed static during a session; content-transform changes invalidate it.

## Verification

Unit suites: `gameGroundDetection`, `gameGroundIntegration`, `gameGeometry`, `gameLocomotion`, `gameSession`. Browser suite: `game-mode.spec.ts` plus existing navigation, upright, cache, branding, presets and toolbar regressions.

Browser pointer capture/release is exercised through real Chromium APIs. Headless CDP sends zero relative mouse deltas under pointer lock, so relative yaw/pitch tests explicitly inject a synthetic MouseEvent and check actual rendered changes; this is not proof of physical mouse/native-WebView behavior. Operator review must exercise real relative mouse input. No physical-device performance or universal reconstruction-floor accuracy is claimed.
