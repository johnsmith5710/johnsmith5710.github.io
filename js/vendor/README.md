# Vendored three.js

**three.js 0.185.1.** Every file here comes from that one release. Do not
mix releases: the core and the addons share private symbols.

| File | Upstream path in `three@0.185.1` | Bytes |
| --- | --- | --: |
| `three.core.min.js` | `build/three.core.min.js` | 385,386 |
| `three.module.min.js` | `build/three.module.min.js` | 365,552 |
| `addons/loaders/GLTFLoader.js` | `examples/jsm/loaders/GLTFLoader.js` | 114,959 |
| `addons/utils/BufferGeometryUtils.js` | `examples/jsm/utils/BufferGeometryUtils.js` | 37,621 |
| `addons/utils/SkeletonUtils.js` | `examples/jsm/utils/SkeletonUtils.js` | 11,535 |

Fetch a file from `https://unpkg.com/three@0.185.1/<upstream path>`.

## Gaussian splats were tried, and removed

For the record, so it is not researched twice: **three.js has no Gaussian
splat support of its own.** All 1,195 files in `three@0.185.1` were checked.
The only match for splat, gaussian, gsplat, spz, ksplat, or sogs is
`examples/jsm/tsl/display/GaussianBlurNode.js`, a post-processing blur, and
the build exports 451 names with nothing splat-related.

Splats therefore need a third-party renderer. Spark
(`@sparkjsdev/spark` 2.1.0, MIT, peer range `three >=0.180.0`) was vendored
and integrated, then removed on 2026-08-17. Two reasons it is worth knowing
about before anyone tries again:

- The bundle is 5.0 MB, six times three.js itself.
- **A splat bakes colour and light in, so there is no material to replace.**
  That runs against the point of this viewer, which applies the customer's
  chosen finish to every mesh. A capture can only be multiplied toward another
  finish, and Glacier Marble and Luna Grey are figured rather than flat, so a
  multiply loses the veining. Full colour coverage needs a separate capture
  per finish per part.

The working implementation is kept in the backup tree, at
`johnsmith5710-backups/js/seeit-3d.js.bak-20260817-142831` and
`johnsmith5710-backups/tools/build_line_pages.py.bak-20260817-142831`, with
its capture guide at `johnsmith5710-backups/splats/README.md.bak-20260817-142831`.

## The build comes in two halves

This is the fact that matters most here. From release 0.171 the browser
build is split in two:

- `three.core.min.js` holds the classes. It is self-contained.
- `three.module.min.js` holds the WebGL renderer. Its first line is
  `import{...}from"./three.core.min.js"`, and it re-exports 245 more names
  from the same file. It defines no classes of its own.

**Both files are required.** `three.module.min.js` alone resolves nothing.
The two sit side by side in this folder, and the relative path between them
must not change.

The failure is quiet. A missing `three.core.min.js` gives a 404 on a file
no page names, so the module graph fails before any code runs. On
`Products/SeeIt.html` the `.catch` then falls back to flat mode, and the
wizard keeps working with no picture in it. Nothing in the console names
three.js.

## Version, and how to read it

`REVISION` lives in `three.core.min.js`, which exports it as `"185"`.
`three.module.min.js` only passes it along, so that file on its own carries
no readable version. Its `Copyright 2010-2026` banner is not a version.

Keep this README as the record. There is no `package.json` in this repo.

## Verifying

Two checks, in this order. The second one is the one that matters.

1. Every `THREE.*` symbol the viewer uses appears in an export list. This
   check passes even when `three.core.min.js` is absent, because
   `three.module.min.js` names all 441 symbols in a re-export. **Never
   trust it on its own.**
2. Resolve the whole module graph. Start at `Products/SeeIt.html`, apply
   the import map, follow every specifier including the relative ones
   inside the vendored files, and confirm each file exists and exports
   every name that is imported from it. Six modules must resolve:

   ```
   js/seeit-3d.js
   js/vendor/three.module.min.js
   js/vendor/three.core.min.js
   js/vendor/addons/loaders/GLTFLoader.js
   js/vendor/addons/utils/BufferGeometryUtils.js
   js/vendor/addons/utils/SkeletonUtils.js
   ```

The import map is in the `<head>` of `Products/SeeIt.html`. It maps `three`
and `three/addons/` into this folder. No other page loads three.js.

## Not vendored yet

`GLTFLoader.js` supports Draco, KTX2, and meshopt, but each needs its own
decoder alongside it. None is here:

| Wanted for | File | Upstream path |
| --- | --- | --- |
| Draco meshes | `DRACOLoader.js` + `draco/` | `examples/jsm/loaders/DRACOLoader.js` |
| KTX2 textures | `KTX2Loader.js` + `basis/` | `examples/jsm/loaders/KTX2Loader.js` |

Export every `.glb` uncompressed until these land. See `models/README.md`.
