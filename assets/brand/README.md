# Omniview brand sources

`omniview.svg` is the **exact, byte-preserved approved Gaussian polish v5** full logo (selected2026-11-20, Asia/Shanghai), not aligned-v6. SHA256: `3b95ee43fcbc552839d869c7c790d010829fc63cc2601e1dd3c6ef0de6114915`. It includes the original white presentation background and outlined dark wordmark. Do not edit the master or substitute a newer concept without approval.

Run `npm run build:icons` using the installed dependencies. This single source generates all assets; the favicon/mark/lockups are **outputs**, never independent source artwork. Tests pin the approved master and compare the rendered derivative against its original symbol crop.

- `omniview-mark.svg` / `public/logo.svg`: remove only the presentation background and entire wordmark group; viewBox `232 142 560 560` centers the original symbol at512,422 with20 source-unit clearance beyond its260-radius circle. All seven Gaussian centers, rotations, gradients, masks, mesh paths, points and overlaps are retained. No blur is added or clipped; no geometry is redrawn. Header remains20×20 CSS pixels with the existing adjacent HTML wordmark (no duplication). Empty-state symbol and HTML wordmark follow the same rule.
- `omniview-favicon.svg` / `public/favicon.svg`: the same faithful symbol, including at16/20/24/32px. No alternate solid O or small-size motif/simplification. Raster antialiasing necessarily merges fine mesh/points at small sizes.
- `omniview-lockup.svg` and `omniview-lockup-dark.svg` (also `public/brand-lockup*.svg`): full approved layout without its white background. Dark version changes **only** outlined wordmark fill from `#17373a` to `#e5f6f3`; symbol artwork is identical. Use the variant matching the surrounding background; in-app HTML wordmarks inherit the existing selected theme.
- PNG/favicon ICO, PWA192/512 and desktop Windows/macOS/Linux icons derive from that symbol. Normal PNG/ICO/ICNS keep transparency. Apple touch/iOS and maskable/adaptive backgrounds are intentionally opaque platform tiles (`#f8fafc` for web tiles; Tauri platform defaults for native mobile). The maskable symbol is inset within the80%-diameter safe circle with an additional4% margin. These backgrounds are not part of the symbol artwork.

No animation, app rename, release version change or new branding motif. Regenerating icons uses the local Tauri CLI, not a network-installed tool, and a unique cleaned-up temporary directory. Native installation/OS icon-cache acceptance and real PWA installation require separate operator testing.

Tauri may reorder ICNS container chunks between runs. Verification compares all decoded frame sizes/pixels as well as other generated file hashes; chunk order is not an artwork change.
