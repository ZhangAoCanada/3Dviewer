# OBJ / MTL references

Each library resolves textures from its own directory, for both URLs and local folders. Later libraries win duplicate material names. Local fallback by filename is used only when the basename is unique; ambiguous matches are reported missing rather than guessing a texture.

`mtllib` supports one filename, quoted filenames with spaces, and multiple whitespace-separated `.mtl` filenames. A single unquoted name ending in `.mtl` may contain spaces. Other ambiguous multi-name forms require quotes. Inline `#` comments are ignored outside quotes. Backslashes in paths are retained. Quoted material identifiers in `usemtl` are not normalized; use ordinary matching `newmtl` / `usemtl` names.

Texture map filenames may contain spaces or be quoted. Supported map options are `-s` and `-o` with one to three numeric components, `-bm` with one, and `-mm` with two. Missing scale components default to 1; offset components default to 0. Unsupported options, duplicate flags, missing numeric arguments, unclosed quotes and ambiguous leading-dash filenames produce an explicit error. Prefix a leading-dash filename with `./`. This is a documented subset, not a universal MTL parser. Non-map statements retain Three.js MTLLoader's support and limitations.

Unlit preserves per-group color/texture, vertex-color enablement, opacity, cutouts, sidedness and core blend/depth settings. It intentionally removes lighting; advanced physical shading effects are not reproduced by MeshBasicMaterial. Generated presentation materials share original textures and never own their disposal. Late texture version changes request a redraw even when the camera is idle.

Reference quotes open only at token boundaries, so `o'clock.png` is a literal filename. Quoted apostrophes, `#`, and spaces remain literal during companion lookup. One preparation pass produces raw companion names and the separate Three.js text; URL-reserved quote/hash characters in that text are percent-encoded rather than reparsed as comments or quotes.
