# Blender exports for the product viewer

One `.glb` per part number. Drop a file in here, rerun
`python tools/gen_line_models.py && python tools/build_line_pages.py`, and
the viewer picks it up. No code change.

## Naming

The filename is the **first** part number of the model, exactly as the
workbook spells it. Where the workbook merges drain variants, use the first:

| Workbook                              | File                  |
| ------------------------------------- | --------------------- |
| `WBSL01603219R / WBSR01603219L`        | `WBSL01603219R.glb`   |
| `T01603259`                            | `T01603259.glb`       |
| `GP01605458`                           | `GP01605458.glb`      |

The build prints how many parts are covered and names any `.glb` that
matches no part number, so a typo shows up as a build message rather than a
part that silently never loads.

## What to export

**Geometry only.** The finish comes from the workbook, so the viewer
replaces the material on every mesh with the colour the customer picked.
Modelling a gelcoat shader in Blender is wasted work — it will be
overwritten. If you later want a chrome drain or a trim piece to survive
that, say so and the override can be made to skip named materials.

- **Orientation: Y up.** Tick **+Y Up** in the glTF exporter, which is the
  default and what the glTF spec asks for. That gives X = width,
  Y = height, Z = depth. A model exported Z up arrives lying on its back,
  and it will be obvious.
- **Front faces +Z.** The back wall of the alcove is at −Z.
- **Any unit.** Millimetres, centimetres, inches, feet, and metres all
  work. The loader scales by the width and snaps to the exact unit factor,
  so a Blender file left in metres is fine.
- **Do not unwrap. The viewer writes its own UVs.** A colour tile is a
  photograph of a finish at a real size, so it has to land at that size on
  the product. `boxUV()` in `js/seeit-3d.js` projects every vertex onto the
  plane its normal faces most and measures the result in inches, so one tile
  covers `TILE_IN` inches on a generated shape and on an export alike. Any
  UV map in the file is replaced. Time spent unwrapping is wasted, in the
  same way that time spent on a gelcoat shader is.
- **Export normals.** `boxUV()` picks the projection plane from the vertex
  normal. The glTF exporter writes normals by default; leave that on. A file
  with none still loads, and the viewer computes flat normals, but the
  finish will run the wrong way across a curved face.
- **Apply the transforms.** In Blender, select all and Ctrl+A → All
  Transforms, so every object arrives with no rotation and no scale of its
  own. `boxUV()` reads the normals as the file states them. A node left
  rotated draws correctly but takes the finish at an angle. Both current
  exports are clean on this point.
- **Placement is worked out for you.** The model is centred across the
  opening, stood on the floor, and pushed back until its rear face meets
  the back wall. Anything that returns past the mouth of the alcove — the
  front edge of a surround does, by about 0.9″ — sticks out into the room,
  which is where it belongs. The origin inside the file does not matter.
- **Height is taken from the model, not the workbook.** The Wave base
  measures 4.93″ against a 3½″ nominal, because the nominal leaves out the
  flange. The surround is then stacked on 4.93″, so the two meet. Using the
  nominal would have hung the surround with a 1.4″ gap under it.
- **Keep it light.** Under 8 MB and 250,000 triangles per part. The build
  prints the size and triangle count of every file and flags any that go
  over.
- **Draco** is fine for meshes but needs its decoder vendored alongside
  `js/vendor/`; it is not there yet, so export uncompressed until it is.
- **KTX2** textures likewise need a transcoder. Not vendored yet.

## What is drawn without a file

Every part that has no `.glb` is built from its workbook dimensions — a
rounded vessel for a tub or a pan, flat panels for a surround. That means
the page works today and improves one part at a time as exports land.
