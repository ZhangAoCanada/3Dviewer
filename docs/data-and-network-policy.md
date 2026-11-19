# Data, cache and measurement contracts

## Point-cloud PLY

Vertex coordinates must be finite and within the float32 world-transform range used by the renderer and every declared vertex record must be present, including records omitted by subsampling. ASCII uses one scalar record per nonblank line with exactly the declared property count. Fixed-size scalar elements preceding vertices are skipped; vertex lists and lists before vertices are explicitly unsupported. Elements after vertices (e.g. mesh faces) are not consumed by this point-only loader. Both binary endiannesses are supported. Counts must be safe nonnegative integers; an empty vertex set is rejected. Duplicate elements/properties, unsupported types and overlarge record layouts are errors.

Input is read in chunks of at most 4 MiB, not buffered as one file. Retained position/color arrays are capped at 256 MiB even if a caller supplies an excessive point budget. ASCII pending records are capped at 1 MiB; headers at 1 MiB; binary record layouts at 64 KiB. Invalid records are rejected, not silently filtered or zero-filled. Source/retained counts therefore describe complete validated vertices and the actual subsampling stride. This does not certify unlimited GPU capacity or every PLY exporter grammar.

## HTTP byte ranges

A 206 must expose a valid `Content-Range` with exactly the requested start/end and the same resource total as the source. Missing/non-exposed `Content-Range` is a clear error, not permission to trust offsets. CORS hosts must expose that header (and preferably ETag/Last-Modified). Encoded 206 bodies are refused. Truncated/oversized bodies are rejected with bounded reads.

Exposed validators must remain equal across partial reads. A strong ETag or Last-Modified is sent as If-Range; weak ETags are compared but not sent as If-Range. Switching from accepted partial bytes to a whole response is rejected to avoid mixing versions. Without any exposed validator, total length and byte offsets are checked, but a same-size in-place server mutation cannot be detected: use an immutable URL for such sources. No stronger coherence guarantee is claimed.

An initial 200 response that ignored Range may still be used as one whole object, up to 64 MiB, including transparently decoded gzip. Subsequent reads slice those same bytes. Larger no-range downloads fail rather than silently allocating unbounded memory. Aborts propagate.

The custom worker HEAD/Range handler checks only Workbox precache membership on each fetch, including after a cold restart. It never consults runtime HTML caches. Uncached requests use the original network request and preserve its failure status. Cross-origin requests are not intercepted.

## Benchmarks and keyboard ownership

Rendered-frame intervals come from changes to drawStamp during the moving portion of the orbit, not animation callback cadence. The first draw establishes a baseline; paused sort-settle callbacks do not contribute intervals. CPU submission durations are separate; GPU execution time remains unmeasured. Software rendering results are labelled, not presented as hardware performance.

Benchmark cancellation aborts only its owned load, races hung reload promises, and prevents late scene adoption through the existing load generation. Starting another user scene aborts the benchmark and transfers scene/camera ownership; its old cancellation cannot cancel that newer load or restore an old camera over it. Synthetic demo creation can still finish internally after cancellation, but its eventual result is rejected/disposed, never adopted.

Quality buttons implement one roving Tab stop, selection/focus with arrow keys, and Home/End. Native button Space activation remains available. Screen-reader and physical-device acceptance remain separate from headless keyboard tests.
