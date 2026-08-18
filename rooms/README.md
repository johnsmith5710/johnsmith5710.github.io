# Room exports for the product viewer

One `.glb` per room. A room is **scenery**: the bathroom the products stand
in. It never joins the build list, never carries a part number, and never
changes what fits. Adding one cannot alter a single product answer.

The viewer always draws a plain alcove of its own — a floor, a back wall,
and two side walls. That is the fallback and it needs no file. Everything
here is about offering something better alongside it.

## Adding a room

Three steps.

1. Export the room to `rooms/<Slug>.glb`.
2. Add one line to `ROOMS` in `tools/build_line_pages.py`:

   ```python
   ROOMS: list[RoomSpec] = [
       RoomSpec("Tiled", "Tiled bathroom", unit=39.3701),
   ]
   ```

3. Run `python tools/build_line_pages.py`.

The picker appears under the picture as soon as one room is on offer. "Plain
alcove" is always the first choice. The build report names a `RoomSpec` whose
file is missing, and names a `.glb` that no `RoomSpec` claims, so either half
of the mistake shows up as a build message rather than a room that silently
never loads.

## RoomSpec

| Field | Meaning |
| --- | --- |
| `slug` | The file name without `.glb`, and the id the page uses. |
| `name` | What the picker shows. Write it for a customer. |
| `unit` | How many inches one model unit is worth. |
| `note` | Free text, for the build report only. |

**`unit` is not optional in practice.** A product works its own unit out,
because the opening tells the viewer how wide the part has to be and the
answer must be one of the known unit factors. A room has no such known
measurement to be read against, so it has to say. Use `39.3701` for a file
modelled in metres, which is what Blender gives you by default, `1` for
inches, `0.0393701` for millimetres, `12` for feet.

Get it wrong and it is obvious: the room arrives 39 times too big or too
small.

## What to export

Most of this matches `models/README.md`. The differences are noted.

- **Orientation: Y up.** Tick **+Y Up** in the glTF exporter, the default.
- **The back wall is at the model's furthest −Z.** The viewer pushes the
  room back until that face meets the alcove's back wall, which is where the
  surround stands. Model the room facing +Z, out toward the viewer.
- **Centre the alcove on X = 0.** The room is centred across the opening.
- **The floor is the model's lowest point.** It is stood on Y = 0.
- **The room is not scaled to the opening.** A part is as wide as the alcove
  by definition. A room is not sized by the tub standing in it, so it is
  placed and never stretched. Build it large enough for the biggest opening
  you want to show it with. Today the openings run from 32″ × 32″ to
  60″ × 36″ for an alcove, and out to **54″ × 54″** for a Sea Wave corner
  bath, so **60″ wide by 54″ deep** clears everything. The build reports
  every opening, and `rooms/README.md` is the only place this number is
  written down, so check it against the wizard if a line is added.
- **Ceiling height.** The plain alcove is 96″ floor to ceiling. Match it
  unless you mean not to.
- **Export materials. This is the opposite of a product.** A product's
  finish comes from the workbook and every material on it is replaced. A
  room keeps what it was modelled with, because the tile, the paint, and the
  window are the whole point of having one. Textures may be embedded.
- **Leave a gap where the products go.** The viewer draws the bathtub, the
  base, and the surround itself. A room with its own tub modelled in will
  show two.
- **Keep it light.** Under 8 MB and 250,000 triangles, the same guide a part
  gets, and it matters more here: a room is on screen for every answer. The
  build prints size and triangle count and flags anything over.
- **Draco and KTX2** need their decoders vendored in `js/vendor/`, and
  neither is there yet. Export uncompressed. See `js/vendor/README.md`.

## What the viewer does with it

Loaded once, cached, and reused. Switching rooms does not reload either one.
The room keeps its own materials and its geometry is marked so the per-answer
teardown leaves it alone.

Shadows: every mesh in a room receives them and none of them cast. The
products cast onto the room, which is the effect worth having; a room casting
onto itself mostly produces artefacts on its own corners.

If a room file fails to load, the plain alcove stands in and the wizard
carries on. Nothing about a room can break the page.
