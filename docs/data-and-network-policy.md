# Data, cache and measurement contracts

## Point-cloud PLY

Vertex coordinates must be finite and within the float32 world-transform range used by the renderer and every declared vertex record must be present, including records omitted by subsampling. ASCII uses one scalar record per nonblank line with exactly the declared property count. Fixed-size scalar elements preceding vertices are skipped; vertex lists and lists before vertices are explicitly unsupported. Elements after vertices (e.g. mesh faces) are not consumed by this point-only loader. Both binary endiannesses are supported. Counts must be safe nonnegative integers; an empty vertex set is rejected. Duplicate elements/properties, unsupported types and overlarge record layouts are errors.

Input is read in chunks of at most 4 MiB, not buffered as one file. Retained position/color arrays are capped at 256 MiB even if a caller supplies an excessive point budget. ASCII pending records are capped at 1 MiB; headers at 1 MiB; binary record layouts at 64 KiB. Invalid records are rejected, not silently filtered or zero-filled. Source/retained counts therefore describe complete validated vertices and the actual subsampling stride. This does not certify unlimited GPU capacity or every PLY exporter grammar.

### Shared PLY boundary grammar

Representation selection first reads 64 KiB; an incomplete PLY header extends to the shared 1 MiB header budget before choosing points versus Gaussians. Comment text is not a Gaussian declaration. Incomplete/over-budget headers are errors, not affirmative format matches. Prefix bodies are clipped while collecting and canceled; valid long-comment and long-property ASCII/both-endian imports remain bounded.

Probe completion, classifier header slicing, point parsing and Gaussian parsing use the same bounded boundary helper. The keyword must start its line. Payload begins after the complete terminator, including horizontal whitespace and line ending; binary readers never interpret that whitespace as coordinate bytes.

| Terminator / context | Compatibility regression |
| --- | --- |
| `end_header` + none, space, tab, or mixed spaces/tabs + LF | All four accepted |
| Same four suffixes + CRLF | All four accepted |
| Same four suffixes + legacy bare CR, with following byte available | All four accepted |
| CRLF split at the 64-KiB prefix edge | Extend prefix; do not start payload at LF |
| Complete LF/CRLF terminator ending exactly at 1 MiB | Accepted; one byte over is rejected |
| Comment containing `end_header`, indented/uppercase keyword, extra keyword suffix, inline comment, vertical tab, missing line ending | Not a boundary |

The 12 accepted forms each exercise real ASCII point parsing, both binary point endiannesses, both Gaussian header endiannesses and Gaussian decoding, preserving count 1 and coordinates [1,2,3]. A bare CR at the budget edge is ambiguous with a split CRLF and is not considered complete without lookahead inside the budget. Binary data is never searched beyond that bound. Missing/incomplete/over-budget and aborted probes remain errors. Application-browser cases additionally cover the three reported whitespace files, bare CR, both binary endiannesses, and a Gaussian scene; long-header application controls remain separate.

## HTTP byte ranges

A 206 must expose a valid `Content-Range` with exactly the requested start/end and the same resource total as the source. Missing/non-exposed `Content-Range` is a clear error, not permission to trust offsets. CORS hosts must expose that header (and preferably ETag/Last-Modified). Encoded 206 bodies are refused. Truncated/oversized bodies are rejected with bounded reads.

Exposed validators must remain equal across partial reads. For same-origin reads, a strong ETag or Last-Modified is sent as If-Range. Cross-origin reads do not add that non-safelisted header or assume OPTIONS permission; their exposed response validators are still compared and a change is rejected. Even hosts permitting If-Range use this compatible cross-origin path; weak ETags are compared but not sent as If-Range. Switching from accepted partial bytes to a whole response is rejected to avoid mixing versions. Without any exposed validator, total length and byte offsets are checked, but a same-size in-place server mutation cannot be detected: use an immutable URL for such sources. No stronger coherence guarantee is claimed.

An initial 200 response that ignored Range may still be used as one whole object, up to 64 MiB, including transparently decoded gzip. Subsequent reads slice those same bytes. Larger no-range downloads fail rather than silently allocating unbounded memory. Aborts propagate.

The custom worker HEAD/Range handler checks only Workbox precache membership on each fetch, including after a cold restart. It never consults runtime HTML caches. Uncached requests use the original network request and preserve its failure status. Cross-origin requests are not intercepted.

## Benchmarks and keyboard ownership

Rendered-frame intervals come from changes to drawStamp during the moving portion of the orbit, not animation callback cadence. The first draw establishes a baseline; paused sort-settle callbacks do not contribute intervals. CPU submission durations are separate; GPU execution time remains unmeasured. Software rendering results are labelled, not presented as hardware performance.

Benchmark cancellation aborts only its owned load, races hung reload promises, and prevents late scene adoption through the existing load generation. Starting another user scene aborts the benchmark and transfers scene/camera ownership; its old cancellation cannot cancel that newer load or restore an old camera over it. Synthetic demo creation can still finish internally after cancellation, but its eventual result is rejected/disposed, never adopted.

Quality buttons implement one roving Tab stop, selection/focus with arrow keys, and Home/End. Native button Space activation remains available. Screen-reader and physical-device acceptance remain separate from headless keyboard tests.
