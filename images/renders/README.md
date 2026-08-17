# Still renders, for a browser with no WebGL

The viewer falls back to a picture from this folder when three.js cannot
run — an old browser, a locked-down machine, or WebGL turned off.

## Naming

`<part>.jpg`, using the **first** part number exactly as the workbook
spells it, the same rule the `.glb` files in `/models` follow:

    WBSL01603219R.jpg
    T01603259.jpg

The page asks for the fixture first, and the wall only if no fixture was
chosen. `room.jpg` is the one it asks for before anything is picked.

## What happens with no file

Nothing breaks. The picture hides itself and the page carries on — the
wizard, the caption, the build list, and the part numbers all still work.
A visitor without WebGL can still get to a complete build and a phone
number; they just do not see it drawn.

## Rendering them

These come out of the same Blender scenes as the `/models` exports. A
camera matching the viewer's default framing keeps the fallback and the
live render recognisably the same room:

- camera about 38° vertical FOV
- looking at the middle of the alcove, roughly 40″ up
- backed off far enough to hold the opening plus the surround
