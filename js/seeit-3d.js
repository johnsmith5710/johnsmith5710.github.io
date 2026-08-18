/* ============================================================
   seeit-3d.js — the bathroom the product viewer draws into.

   The page talks to this file through two calls and nothing else:

       const view = await createViewer(mountElement, options);
       view.update(build);        // draw a build
       view.dispose();            // give the canvas back

   That is the whole contract. A hosted configurator would implement the
   same two calls, so the wizard never has to know which one is behind it.

   A build looks like this. Every length is in inches.

       {
         shape:   'alcove' | 'corner',
         opening: { w, d },
         fixture: { part, box:[w,d,h], category, sits, color } | null,
         wall:    { part, box:[w,d,h], color } | null,
         bars:    [ 'back' | 'side', ... ],
         room:    '<room id>' | null
       }

   room names one of the rooms declared in options.rooms. Anything else,
   including null, draws the plain alcove the viewer builds itself. A room is
   scenery: it is never part of the build list and never priced.

   Geometry is generated from those numbers. When a Blender export exists
   at models/<part>.glb it is loaded and used instead, so the two can live
   side by side while the exports are worked through.
   ============================================================ */

import * as THREE from 'three';

const ROOM_H = 96;           // floor to ceiling, inches
const PANEL_T = 0.75;        // how thick a surround panel is
const WALL_T = 3;            // the wall of a tub or a pan
const APRON_R = 1.5;         // the radius on a rim
const BAR_R = 0.7;           // a grab bar

// How much product one colour tile covers. Every textured surface carries
// UVs measured in inches, so this one number sets the density everywhere.
// See boxUV().
const TILE_IN = 26;

// The room the products stand in.
const FLOOR_TILE_IN = 12;    // a 12 in. floor tile, the commonest size
const BASE_H = 4;            // baseboard, 4 in. tall
const BASE_T = 0.625;        // and 5/8 in. proud of the wall
const CORNER_OPEN = 42;      // floor to the side of a corner bath
// Wall either side of an alcove opening. This is what makes the niche read as
// a recess cut into a wall rather than a corridor the width of the tub. 30 in.
// is a plausible run of wall between a tub alcove and a door or a vanity.
const JAMB_W = 30;

// The ADA Select base is the only piece with no height in the workbook.
// These are drawing defaults, not specifications.
const NOMINAL_H = { low: 5, tall: 19 };

export async function createViewer(mount, options = {}) {
  const opts = Object.assign({
    modelPath: '../models/',     // where a Blender export lives
    models: [],                  // part numbers that actually have one
    roomPath: '../rooms/',       // where a room export lives
    rooms: [],                   // [{ id, file, unit }], see roomList below
    textures: {},                // color name -> image url
    onReady: null
  }, options);

  // Only ask for a file that is known to be there. Guessing would put a
  // failed request on the wire for every part that has not been exported.
  const exported = new Set(opts.models);

  // The rooms on offer, by id. A room needs its unit declared, unlike a
  // part: a part's unit is worked out from the width the opening gives it,
  // and a room has no such known measurement to be read against.
  const roomList = new Map();
  for (const r of opts.rooms) {
    if (!r || !r.id) { continue; }
    roomList.set(r.id, {
      file: r.file || (r.id + '.glb'),
      unit: r.unit || 1
    });
  }

  const renderer = new THREE.WebGLRenderer({
    antialias: true, alpha: false, powerPreference: 'high-performance'
  });
  // The pixel ratio cap is decided in resize(), because it depends on how
  // wide the canvas actually is and that changes when a phone is turned.
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.domElement.className = 'seeit-canvas';
  mount.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xeef2f7);

  const camera = new THREE.PerspectiveCamera(38, 1, 1, 4000);

  // ── Light ──────────────────────────────────────────────────────────
  // A small box of glowing planes, baked once into an environment map.
  // It gives gelcoat something to reflect without shipping an HDR file.
  // far has to clear the studio box. The default is 100 and the box is 450
  // out, so leaving it would clip every panel out of the reflection.
  const pmrem = new THREE.PMREMGenerator(renderer);
  const box = studio();
  scene.environment = pmrem.fromScene(box, 0.04, 1, 2000).texture;
  pmrem.dispose();
  // The bake uploads the box to the GPU, and pmrem.dispose() does not reach
  // it. Held in a local so it can be taken apart afterwards; dropped straight
  // into fromScene() it would be unreachable and its buffers would stay for
  // the life of the context.
  clear(box);

  scene.add(new THREE.HemisphereLight(0xffffff, 0xb8c6d4, 0.55));

  const key = new THREE.DirectionalLight(0xffffff, 1.5);
  key.position.set(90, 150, 130);
  key.castShadow = true;
  // 1024² is enough for a single product at this camera distance. Dropping
  // to 512 saves fill-rate on integrated GPUs with almost no visible change.
  const shadowRes = (typeof navigator !== 'undefined' &&
    navigator.deviceMemory && navigator.deviceMemory <= 4) ? 512 : 1024;
  key.shadow.mapSize.set(shadowRes, shadowRes);
  key.shadow.camera.near = 20;
  key.shadow.camera.far = 600;
  key.shadow.camera.left = -140;
  key.shadow.camera.right = 140;
  key.shadow.camera.top = 160;
  key.shadow.camera.bottom = -60;
  key.shadow.bias = -0.0012;
  scene.add(key);

  const fill = new THREE.DirectionalLight(0xffffff, 0.35);
  fill.position.set(-120, 70, 90);
  scene.add(fill);

  // ── Materials ──────────────────────────────────────────────────────
  const loader = new THREE.TextureLoader();
  const tiles = new Map();

  // A color tile is a photograph of the finish. It is only fetched when
  // somebody picks that color, because each one is close to a megabyte.
  function tile(name) {
    if (!name || !opts.textures[name]) { return null; }
    if (!tiles.has(name)) {
      const t = loader.load(opts.textures[name], () => render());
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.colorSpace = THREE.SRGBColorSpace;
      // UVs are in inches on every painted surface, so this is literally
      // one tile across TILE_IN inches.
      t.repeat.set(1 / TILE_IN, 1 / TILE_IN);
      t.anisotropy = renderer.capabilities.getMaxAnisotropy();
      tiles.set(name, t);
    }
    return tiles.get(name);
  }

  // Gelcoat: bright, near-white, and glossy but not a mirror.
  function finish(color) {
    return new THREE.MeshStandardMaterial({
      map: tile(color),
      color: 0xffffff,
      roughness: 0.12,
      metalness: 0.0,
      envMapIntensity: 1.1
    });
  }

  // The room and the trim are drawn from these three on every build, but the
  // scene is torn down between builds and clear() disposes what it walks.
  // own() marks a material as belonging to the viewer rather than to one
  // build, and clear() steps over it. Without the mark these three are
  // disposed and their shaders recompiled on every answer, which is the most
  // expensive thing in the frame.
  const roomMat = own(new THREE.MeshStandardMaterial({
    color: 0xdfe6ee, roughness: 0.92, metalness: 0
  }));
  const floorMat = own(new THREE.MeshStandardMaterial({
    color: 0xc9d2dc, roughness: 0.75, metalness: 0
  }));
  const trimMat = own(new THREE.MeshStandardMaterial({
    color: 0xb6c2ce, roughness: 0.35, metalness: 0.6
  }));

  // ── The scene is rebuilt on every change ───────────────────────────
  const room = new THREE.Group();
  const parts = new THREE.Group();
  scene.add(room, parts);

  const gltfCache = new Map();
  let GLTF = null;                       // loaded the first time it is wanted
  let build = null;
  let dirty = true;
  let alive = true;

  // ── Orbit, written here rather than pulled in ──────────────────────
  // Only three degrees of freedom are wanted, and all of them are clamped
  // so the camera stays in the room and in front of the alcove.
  const orbit = { r: 150, theta: 0, phi: 1.16, target: new THREE.Vector3() };
  const LIMIT = { theta: 0.62, phiLo: 0.62, phiHi: 1.52, rLo: 0.55, rHi: 1.7 };
  let rBase = 150;

  // How far forward the room reaches. The camera has to stay behind it: the
  // walls face inward, so from outside they disappear and the room turns
  // inside out. Set when a room is drawn; until then there is nothing to hit.
  let frontZ = Infinity;

  function place() {
    const { theta, phi, target } = orbit;
    const out = Math.sin(phi) * Math.cos(theta);   // how much of r goes into +z
    // Pull in far enough to stay inside, rather than making the room long
    // enough to never be left. A bathroom is not 20 ft deep.
    let r = orbit.r;
    if (out > 0.05 && frontZ !== Infinity) {
      r = Math.min(r, Math.max(24, (frontZ - 8 - target.z) / out));
    }
    camera.position.set(
      target.x + r * Math.sin(phi) * Math.sin(theta),
      target.y + r * Math.cos(phi),
      target.z + r * out
    );
    camera.lookAt(target);
  }

  // ── Zoom ───────────────────────────────────────────────────────────
  // One way in for every gesture: a wheel, a pinch, the two buttons, and the
  // plus and minus keys all come through here, so they cannot drift apart or
  // escape the limits frame() set.
  const ZOOM_STEP = 1.18;

  function zoomBy(mult) {
    const next = clamp(orbit.r * mult, rBase * LIMIT.rLo, rBase * LIMIT.rHi);
    if (next === orbit.r) { return; }
    orbit.r = next;
    place();
    render();
  }

  const el = renderer.domElement;
  el.style.touchAction = 'none';

  // Every pointer currently down, so two of them can be told from one.
  const pts = new Map();
  let pinch = 0;

  function spread() {
    const [a, b] = [...pts.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  el.addEventListener('pointerdown', (e) => {
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    el.setPointerCapture(e.pointerId);
    el.classList.add('is-dragging');
    if (pts.size === 2) { pinch = spread(); }
  });

  el.addEventListener('pointermove', (e) => {
    const prev = pts.get(e.pointerId);
    if (!prev) { return; }
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });

    // Two fingers is a pinch, not a turn. Turning on a pinch makes the room
    // lurch sideways while the customer is only trying to get closer.
    if (pts.size >= 2) {
      const now = spread();
      if (pinch > 0 && now > 0) { zoomBy(pinch / now); }
      pinch = now;
      return;
    }

    orbit.theta = clamp(orbit.theta - (e.clientX - prev.x) * 0.006,
                        -LIMIT.theta, LIMIT.theta);
    orbit.phi = clamp(orbit.phi - (e.clientY - prev.y) * 0.005,
                      LIMIT.phiLo, LIMIT.phiHi);
    place();
    render();
  });

  const stop = (e) => {
    pts.delete(e.pointerId);
    if (pts.size < 2) { pinch = 0; }
    if (!pts.size) { el.classList.remove('is-dragging'); }
    if (e.pointerId !== undefined && el.hasPointerCapture(e.pointerId)) {
      el.releasePointerCapture(e.pointerId);
    }
  };
  el.addEventListener('pointerup', stop);
  el.addEventListener('pointercancel', stop);

  el.addEventListener('wheel', (e) => {
    e.preventDefault();
    zoomBy(1 + Math.sign(e.deltaY) * 0.08);
  }, { passive: false });

  // The buttons are built here because the canvas is built here, so the page
  // needs to know nothing about them and the two-call contract is untouched.
  // A hosted configurator would bring its own.
  const zoomBox = document.createElement('div');
  zoomBox.className = 'seeit-zoom';
  for (const [glyph, label, mult] of [
    ['+', 'Zoom in', 1 / ZOOM_STEP],
    ['−', 'Zoom out', ZOOM_STEP]
  ]) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'zoom-btn';
    b.textContent = glyph;
    b.setAttribute('aria-label', label);
    b.addEventListener('click', () => zoomBy(mult));
    zoomBox.appendChild(b);
  }
  mount.appendChild(zoomBox);

  // The keyboard gets the same movement, since the page is otherwise
  // entirely operable without a mouse.
  el.tabIndex = 0;
  el.setAttribute('role', 'img');
  el.setAttribute('aria-label',
    'Your bathroom, drawn. Drag or use the arrow keys to turn it, ' +
    'and the plus and minus keys to zoom. What is in it is written ' +
    'under the picture.');
  el.addEventListener('keydown', (e) => {
    const step = 0.09;
    // Zoom first: these two already clamp and redraw themselves.
    if (e.key === '+' || e.key === '=') { zoomBy(1 / ZOOM_STEP); }
    else if (e.key === '-' || e.key === '_') { zoomBy(ZOOM_STEP); }
    else if (e.key === 'ArrowLeft') { orbit.theta = clamp(orbit.theta + step, -LIMIT.theta, LIMIT.theta); }
    else if (e.key === 'ArrowRight') { orbit.theta = clamp(orbit.theta - step, -LIMIT.theta, LIMIT.theta); }
    else if (e.key === 'ArrowUp') { orbit.phi = clamp(orbit.phi - step, LIMIT.phiLo, LIMIT.phiHi); }
    else if (e.key === 'ArrowDown') { orbit.phi = clamp(orbit.phi + step, LIMIT.phiLo, LIMIT.phiHi); }
    else { return; }
    e.preventDefault();
    place();
    render();
  });

  // ── Size ───────────────────────────────────────────────────────────
  // The shape of the box is the stylesheet's business. This reads it rather
  // than imposing a ratio of its own: the two disagreed — 0.72 here against
  // 16/9 in the CSS — and the canvas came out 28% taller than the box that
  // clipped it.
  //
  // setSize's third argument is false, so three.js writes no inline width or
  // height. The canvas is sized to 100% by the stylesheet instead, which
  // keeps the ResizeObserver from watching a box the canvas is itself
  // resizing.
  let prCap = 0;

  function resize() {
    const w = mount.clientWidth || 640;
    const h = mount.clientHeight || Math.round(w * 0.5625);

    // Decided here, not once at startup: turning a phone to landscape can
    // cross this line in either direction. Only set when it changes, because
    // setPixelRatio reallocates the drawing buffer.
    const cap = w < 700 ? 1.5 : 2;
    if (cap !== prCap) {
      prCap = cap;
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, cap));
    }

    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    render();
  }
  const ro = new ResizeObserver(resize);
  ro.observe(mount);

  // ── Draw only when something changed ───────────────────────────────
  // Demand-driven: no continuous rAF while idle. Saves battery on mobile
  // and drops CPU to near zero when the user is reading the build list.
  let raf = 0;
  function tick() {
    raf = 0;
    if (!alive || document.hidden) { return; }
    if (dirty) {
      dirty = false;
      renderer.render(scene, camera);
    }
  }
  function render() {
    dirty = true;
    if (alive && !document.hidden && !raf) {
      raf = requestAnimationFrame(tick);
    }
  }
  // Named, because dispose() has to take it off again. Every other listener
  // here is on the canvas and goes when the canvas does; this one is on
  // document, so left attached it would hold this whole closure — renderer,
  // scene, caches and all — reachable for the life of the page, and
  // dispose() would not give anything back.
  function onVisible() {
    if (!alive) { return; }
    if (!document.hidden) { render(); }
  }
  document.addEventListener('visibilitychange', onVisible);


  // ── Build the room ─────────────────────────────────────────────────
  // A named room is tried first and the plain alcove stands in whenever one
  // is not asked for, is not on offer, or does not load. The room is only
  // ever scenery, so nothing about the products depends on which one it is.
  async function drawRoom(w, d, want, corner) {
    clear(room);
    const made = want ? await roomModel(want, d) : null;
    if (made) {
      room.add(made);
      return;
    }
    plainRoom(w, d, corner);
  }

  const roomCache = new Map();
  let roomsOff = false;

  async function roomModel(id, d) {
    const spec = roomList.get(id);
    if (!spec || roomsOff) { return null; }
    const url = opts.roomPath + spec.file;
    if (roomCache.get(url) === false) { return null; }
    try {
      if (!GLTF) {
        ({ GLTFLoader: GLTF } = await import('three/addons/loaders/GLTFLoader.js'));
      }
      if (!roomCache.has(url)) {
        const loaded = await new GLTF().loadAsync(url);
        // A room keeps the finish it was modelled with. That is the one place
        // this file trusts a material out of a file, and it is the reason a
        // room is worth having: the tile, the paint, and the window are the
        // point of it. own() also holds clear() off, since the room group is
        // emptied and refilled on every answer.
        loaded.scene.traverse((n) => {
          if (n.geometry) { own(n.geometry); }
          if (n.material) {
            (Array.isArray(n.material) ? n.material : [n.material]).forEach(own);
          }
          if (n.isMesh) { n.receiveShadow = true; n.castShadow = false; }
        });
        roomCache.set(url, loaded);
      }
      return placeRoom(roomCache.get(url).scene, spec, d);
    } catch (err) {
      // A missing loader stops every room. A bad file stops only that one.
      if (!GLTF) { roomsOff = true; } else { roomCache.set(url, false); }
      return null;
    }
  }

  // The same placement rule a part gets: centred across the opening, stood on
  // the floor, and pushed back until its rear face meets the alcove's back
  // wall. A room is not scaled to the opening, though. A part is as wide as
  // the alcove by definition; a room is not sized by the tub standing in it.
  function placeRoom(scene, spec, d) {
    const holder = new THREE.Group();
    holder.add(scene);
    scene.scale.setScalar(spec.unit);
    scene.position.set(0, 0, 0);
    scene.updateMatrixWorld(true);

    const box = new THREE.Box3().setFromObject(scene);
    const mid = box.getCenter(new THREE.Vector3());
    scene.position.set(-mid.x, -box.min.y, -d - box.min.z);
    // Where this room's front edge ends up, so place() can keep the camera
    // inside it the same way it does for the plain alcove.
    frontZ = -d + (box.max.z - box.min.z);
    return holder;
  }

  // A bathroom with the product set into it.
  //
  // An alcove is a recess. The niche is as wide as the opening and only as
  // deep as the product; at its mouth the wall turns outward and carries on,
  // and the bathroom in front is wider than the product is. Running the two
  // side walls the whole depth of the room instead, which is what this did,
  // gives two parallel walls the width of the tub receding 12 ft — the end of
  // a hallway rather than something built into a wall.
  //
  // A corner unit is not in an alcove and gets no return. Two of the room's
  // own walls meet behind it and the floor opens out to one side.
  function plainRoom(w, d, corner) {
    const jamb = corner ? 0 : JAMB_W;      // wall either side of the mouth
    const x0 = corner ? -w / 2 : -w / 2 - jamb;
    const x1 = corner ? -w / 2 + w + CORNER_OPEN : w / 2 + jamb;
    const z0 = -d;                         // the back of the niche
    const z1 = roomFront(w);               // the front of the room
    frontZ = z1;                           // place() keeps the camera behind it
    const midX = (x0 + x1) / 2;
    const midZ = (z0 + z1) / 2;
    const fw = x1 - x0;
    const fd = z1 - z0;

    // One slab each for floor and ceiling, over the whole plan. What falls
    // behind a jamb is hidden by it, so there is nothing to cut out.
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(fw, fd), floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(midX, 0, midZ);
    floor.receiveShadow = true;
    room.add(floor);
    // The tile is the only thing in the picture at a known size, so it is what
    // the eye measures the product against. 12 in. squares.
    floorTile(fw, fd);

    // Closing the top is what stops the room reading as flats in a void. It
    // faces down, so from a high angle the camera passes through it and the
    // view is unobstructed.
    const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(fw, fd), roomMat);
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.set(midX, ROOM_H, midZ);
    room.add(ceiling);

    // The back of the niche is only as wide as the niche. Past that it is
    // behind a jamb and never seen.
    const backW = corner ? fw : w;
    const back = new THREE.Mesh(new THREE.PlaneGeometry(backW, ROOM_H), roomMat);
    back.position.set(corner ? midX : 0, ROOM_H / 2, z0);
    back.receiveShadow = true;
    room.add(back);

    if (jamb > 0) {
      // The two walls of the niche, stopping at its mouth rather than running
      // on. These are what the surround's end panels meet.
      for (const inward of [1, -1]) {
        const side = new THREE.Mesh(new THREE.PlaneGeometry(d, ROOM_H), roomMat);
        side.rotation.y = inward * Math.PI / 2;
        side.position.set(inward * -w / 2, ROOM_H / 2, z0 + d / 2);
        side.receiveShadow = true;
        room.add(side);
      }

      // The return: the face of the wall the niche is cut into, from the mouth
      // outward to the room. Facing the viewer, which is what reads as depth.
      for (const inward of [1, -1]) {
        const face = new THREE.Mesh(
          new THREE.PlaneGeometry(jamb, ROOM_H), roomMat);
        face.position.set(inward * -(w / 2 + jamb / 2), ROOM_H / 2, 0);
        face.receiveShadow = true;
        room.add(face);

        const b = new THREE.Mesh(
          new THREE.BoxGeometry(jamb, BASE_H, BASE_T), trimMat);
        b.position.set(inward * -(w / 2 + jamb / 2), BASE_H / 2, BASE_T / 2);
        b.receiveShadow = true;
        room.add(b);
      }
    }

    // The room's own side walls. In the alcove case they start at the mouth,
    // because everything behind that line is inside the wall.
    const sideZ0 = jamb > 0 ? 0 : z0;
    const sideD = z1 - sideZ0;
    for (const [x, inward] of [[x0, 1], [x1, -1]]) {
      const side = new THREE.Mesh(new THREE.PlaneGeometry(sideD, ROOM_H), roomMat);
      side.rotation.y = inward * Math.PI / 2;
      side.position.set(x, ROOM_H / 2, sideZ0 + sideD / 2);
      side.receiveShadow = true;
      room.add(side);

      // Baseboard, from the mouth forward. Behind that line the product is
      // against the wall and a skirting would be inside it.
      if (z1 > 1) {
        const b = new THREE.Mesh(
          new THREE.BoxGeometry(BASE_T, BASE_H, z1), trimMat);
        b.position.set(x + inward * BASE_T / 2, BASE_H / 2, z1 / 2);
        b.receiveShadow = true;
        room.add(b);
      }
    }
  }

  // How far the room runs forward of the alcove. It used to be d + 220, a
  // 20 ft corridor, chosen so the camera could never get out of it; place()
  // holds the camera in now, so this can be a floor instead of a runway.
  //
  // The floor is what is left. It has to be deep enough for the camera to
  // stand back and take in the tallest build, which is a low base under a
  // 78 in. surround, near enough 84 in. At a 38 degree lens that wants about
  // 122 in. of standoff, and the camera looks in at a slight angle, so 112 in.
  // of floor in front of the rim covers it with a little to spare.
  function roomFront(w) {
    return Math.max(112, w * 1.7);
  }

  let tileTex = null;

  function floorTile(fw, fd) {
    if (!tileTex) {
      // Drawn here rather than shipped, so it costs no request and stays
      // exactly one tile whatever the room measures.
      const c = document.createElement('canvas');
      c.width = c.height = 128;
      const g = c.getContext('2d');
      g.fillStyle = '#ffffff';
      g.fillRect(0, 0, 128, 128);
      g.strokeStyle = 'rgba(90, 105, 120, 0.30)';
      g.lineWidth = 3;
      g.strokeRect(1.5, 1.5, 125, 125);
      tileTex = new THREE.CanvasTexture(c);
      tileTex.wrapS = tileTex.wrapT = THREE.RepeatWrapping;
      tileTex.colorSpace = THREE.SRGBColorSpace;
      tileTex.anisotropy = renderer.capabilities.getMaxAnisotropy();
      floorMat.map = tileTex;
      floorMat.needsUpdate = true;
    }
    tileTex.repeat.set(fw / FLOOR_TILE_IN, fd / FLOOR_TILE_IN);
  }

  // ── Build the products ─────────────────────────────────────────────
  async function drawParts() {
    clear(parts);
    if (!build) { return; }

    const w = build.opening.w;
    const d = build.opening.d;
    const f = build.fixture;
    const wall = build.wall;

    let rim = 0;
    let top = 40;

    if (f) {
      const nominal = f.box[2] || NOMINAL_H[f.sits] || 19;
      const mat = finish(f.color);
      const made = await piece(f, w, d, () => ({
        obj: vessel(f.box[0] || w, f.box[1] || d, nominal,
                    build.shape === 'corner'),
        h: nominal
      }));
      // The rim is wherever the piece actually ends, not where the nominal
      // size says it should. The exported base is a shade over 4 in. tall
      // against a 3-1/2 in. nominal, and the surround has to meet it.
      rim = made.h;
      top = rim;
      paint(made.obj, mat);
      parts.add(made.obj);

      // A seated base closes one end off at the rim.
      if (f.category === 'Seated Base') {
        const sw = Math.min(17, w * 0.32);
        const seatGeo = rounded(sw, d - 2 * WALL_T, rim - WALL_T, 1);
        boxUV(seatGeo);                      // built here, so painted here
        const seat = new THREE.Mesh(seatGeo, mat);
        seat.position.set(-w / 2 + WALL_T + sw / 2, (rim - WALL_T) / 2, -d / 2);
        // Both, the way paint() sets them. This mesh is built here rather than
        // inside the group, so it has to say so itself.
        seat.castShadow = seat.receiveShadow = true;
        parts.add(seat);
      }
    }

    if (wall) {
      const nominal = wall.box[2] || 59;
      const mat = finish(wall.color);
      const made = await piece(wall, w, d,
                               () => ({ obj: panels(w, d, nominal), h: nominal }));
      made.obj.position.y = rim;
      paint(made.obj, mat);
      parts.add(made.obj);
      top = rim + made.h;

      for (const which of (build.bars || [])) {
        const bar = which === 'back'
          ? cylinder(w * 0.42, BAR_R, 'x', [0, rim + 33, -d + 2.4])
          : cylinder(made.h * 0.42, BAR_R, 'y',
                     [w / 2 - 2.6, rim + made.h * 0.45, -d * 0.55]);
        bar.castShadow = true;
        parts.add(bar);
      }
    }

    frame(w, d, top);
  }

  // Three flat panels and a shelf, standing on y = 0. Used when the wall
  // has no export yet.
  function panels(w, d, h) {
    const g = new THREE.Group();

    const back = new THREE.Mesh(new THREE.BoxGeometry(w, h, PANEL_T), null);
    back.position.set(0, h / 2, -d + PANEL_T / 2);
    g.add(back);

    for (const s of [-1, 1]) {
      const side = new THREE.Mesh(new THREE.BoxGeometry(PANEL_T, h, d), null);
      side.position.set(s * (w / 2 - PANEL_T / 2), h / 2, -d / 2);
      g.add(side);
    }

    const shelf = new THREE.Mesh(new THREE.BoxGeometry(16, 1.2, 4.5), null);
    shelf.position.set(w / 2 - 14, h * 0.62, -d + 2.6);
    g.add(shelf);

    return g;
  }

  // A Blender export wins when one exists. Otherwise the shape is built
  // from the numbers, so the page works before the exports are finished.
  // Either way the answer is the same pair: the thing, and how tall it
  // turned out, because the next piece up has to sit on it.
  let gltfOff = false;
  async function piece(spec, w, d, fallback) {
    const key = spec.part.split(' / ')[0];
    if (gltfOff || !exported.has(key)) { return fallback(); }
    const url = opts.modelPath + key + '.glb';
    if (gltfCache.get(url) === false) { return fallback(); }
    try {
      if (!GLTF) {
        ({ GLTFLoader: GLTF } = await import('three/addons/loaders/GLTFLoader.js'));
      }
      if (!gltfCache.has(url)) {
        const loaded = await new GLTF().loadAsync(url);
        // A clone shares its geometry and its materials with the original by
        // reference. The cache hands the original out again on the next
        // answer, so clear() must not dispose what it walked on this one.
        loaded.scene.traverse((n) => {
          if (n.geometry) { own(n.geometry); }
          if (n.material) {
            (Array.isArray(n.material) ? n.material : [n.material]).forEach(own);
          }
        });
        gltfCache.set(url, loaded);
      }
      // box[0] is the part's own width from the workbook. It is what the unit
      // has to be read against, not the opening: see fit().
      return fit(gltfCache.get(url).scene.clone(true), w, d,
                 (spec.box && spec.box[0]) || w);
    } catch (err) {
      // A missing loader stops every part. A bad file stops only that one.
      if (!GLTF) { gltfOff = true; } else { gltfCache.set(url, false); }
      return fallback();
    }
  }

  // Sit an export in the opening. The export is Y up, the way glTF says:
  // X is the width, Y the height, Z the depth. See models/README.md.
  //
  // The one thing being worked out here is the file's unit, and it is read
  // against the part's own width, not the opening's. Those are the same
  // number for a part built for that opening, and they are not for a panel
  // that cuts down to it: a 60 in. Glue-Up panel in a 32 in. alcove is still
  // a 60 in. panel until somebody cuts it. Reading the unit off the opening
  // would have squashed it to 53% on every axis, so a 72 in. panel would have
  // been drawn 38 in. tall.
  //
  // Nothing is ever stretched to fit. Width, depth, and height all come out
  // as modelled, in inches. A surround legitimately returns past the mouth of
  // the alcove, and a cut-to-fit panel legitimately overhangs it; the wizard
  // flags that separately.
  //
  // Height is therefore read off the model rather than the workbook. A
  // nominal size leaves out the flange, so a 3-1/2 in. base measures nearer
  // 5, and the surround above it has to stack on what is really there.
  function fit(root, w, d, trueWidth) {
    const holder = new THREE.Group();
    holder.add(root);
    root.updateMatrixWorld(true);

    const span = new THREE.Box3().setFromObject(root)
      .getSize(new THREE.Vector3());
    const unit = span.x > 1e-9 ? snapUnit((trueWidth || w) / span.x) : 1;
    if (span.x > 1e-9) { root.scale.setScalar(unit); }
    root.updateMatrixWorld(true);

    // What one model unit is worth in inches. paint() needs it, because the
    // export is measured in its own units and a UV has to come out in
    // inches like every other surface. Carried on the holder rather than
    // worked out again, since snapUnit() has already decided.
    //
    // This is the same number every time the part is drawn, whatever opening
    // it is drawn in, which is what makes boxUV()'s write-once guard safe on
    // geometry the cache shares between clones.
    holder.userData.uvScale = unit;

    // X centred in the opening, Y on the floor, and Z pushed back until the
    // rear face meets the back wall. Back-aligned rather than centred, so
    // that a front return sticks out into the room instead of being buried.
    const box = new THREE.Box3().setFromObject(root);
    const mid = box.getCenter(new THREE.Vector3());
    root.position.set(-mid.x, -box.min.y, -d - box.min.z);
    root.updateMatrixWorld(true);

    return { obj: holder, h: box.max.y - box.min.y };
  }

  // A Blender file is in millimetres, centimetres, inches, feet, or metres,
  // so the scale that makes the width come out right should be one of those
  // factors. Snapping to the exact one keeps a model that is a shade over
  // its nominal size a shade over, instead of squashing it to fit.
  const UNITS = [0.0393701, 0.393701, 1, 12, 39.3701];

  function snapUnit(k) {
    for (const u of UNITS) {
      if (Math.abs(k - u) / u < 0.05) { return u; }
    }
    return k;
  }

  // ── Shapes ─────────────────────────────────────────────────────────
  // A tub or a pan: a rim ring with a hole in it, and a basin below.
  function vessel(w, d, h, corner) {
    const g = new THREE.Group();
    const r = corner ? Math.min(w, d) * 0.28 : Math.min(6, h * 0.5, w * 0.12);

    const shape = roundedShape(w, d, r);
    shape.holes.push(roundedShape(w - 2 * WALL_T, d - 2 * WALL_T,
                                  Math.max(0.5, r - WALL_T)));
    const lip = Math.max(0.6, h * 0.08);
    const rimGeo = new THREE.ExtrudeGeometry(shape, {
      depth: lip, bevelEnabled: true,
      bevelSize: APRON_R * 0.4, bevelThickness: APRON_R * 0.4,
      bevelSegments: 2, curveSegments: 10
    });
    // Extrude runs along +Z, so the ring is turned upright. The turn is put
    // on the geometry, not on the mesh: it is the same shape either way, but
    // boxUV() reads the normals off the geometry and has to see which way
    // the surface really faces. The ring then grows upward from wherever it
    // is put, and its top has to land on h, not above.
    rimGeo.rotateX(-Math.PI / 2);
    const rim = new THREE.Mesh(rimGeo, null);
    rim.position.y = h - lip;
    g.add(rim);

    const body = new THREE.Mesh(rounded(w, d, h - 0.6, r), null);
    body.position.y = (h - 0.6) / 2;
    g.add(body);

    // Laid flat on the geometry, for the same reason as the rim.
    const basinGeo = new THREE.PlaneGeometry(w - 2 * WALL_T, d - 2 * WALL_T);
    basinGeo.rotateX(-Math.PI / 2);
    const basin = new THREE.Mesh(basinGeo, null);
    basin.position.y = h * 0.14 + 0.2;
    g.add(basin);

    g.position.z = -d / 2;
    g.traverse((o) => { if (o.isMesh) { o.castShadow = o.receiveShadow = true; } });
    return g;
  }

  function roundedShape(w, d, r) {
    const x = w / 2, z = d / 2;
    r = Math.max(0, Math.min(r, x - 0.1, z - 0.1));
    const s = new THREE.Shape();
    s.moveTo(-x + r, -z);
    s.lineTo(x - r, -z);
    s.quadraticCurveTo(x, -z, x, -z + r);
    s.lineTo(x, z - r);
    s.quadraticCurveTo(x, z, x - r, z);
    s.lineTo(-x + r, z);
    s.quadraticCurveTo(-x, z, -x, z - r);
    s.lineTo(-x, -z + r);
    s.quadraticCurveTo(-x, -z, -x + r, -z);
    return s;
  }

  // Centred on its own middle, the way BoxGeometry is, so position.y = h/2
  // stands it on the floor. Extrude runs along +Z, so it is turned upright
  // and then pulled back down by half its height.
  function rounded(w, d, h, r) {
    const shape = roundedShape(w, d, r === undefined ? 1 : r);
    const g = new THREE.ExtrudeGeometry(shape, {
      depth: h, bevelEnabled: false, curveSegments: 10
    });
    g.rotateX(-Math.PI / 2);
    g.translate(0, -h / 2, 0);
    return g;
  }

  function cylinder(len, r, axis, at) {
    const m = new THREE.Mesh(
      new THREE.CylinderGeometry(r, r, len, 14), trimMat);
    if (axis === 'x') { m.rotation.z = Math.PI / 2; }
    if (axis === 'z') { m.rotation.x = Math.PI / 2; }
    m.position.set(at[0], at[1], at[2]);
    return m;
  }

  // The finish comes from the workbook, never from the model file, so it is
  // applied to a Blender export as well as to a generated shape. Export
  // geometry; the color a part is made in is decided here.
  //
  // The UVs are settled here too, for the same reason. A tile is a
  // photograph of a finish at a real size, so it has to land at that size on
  // whatever it is painted on. Three sources disagreed about what a UV
  // means: an extruded shape gave inches, a box gave 0 to 1, and a Blender
  // export gave a few thousand. boxUV() replaces all three.
  function paint(group, mat) {
    const scale = group.userData.uvScale || 1;
    group.traverse((o) => {
      if (!o.isMesh) { return; }
      if (o.geometry) { boxUV(o.geometry, scale); }
      o.material = mat;
      o.castShadow = true;
      o.receiveShadow = true;
    });
  }

  // Sit the camera back far enough to hold whatever was built.
  function frame(w, d, h) {
    orbit.target.set(0, Math.max(28, h * 0.42), -d * 0.55);
    rBase = Math.max(w, h) * 1.55 + d * 0.5;
    orbit.r = clamp(orbit.r, rBase * LIMIT.rLo, rBase * LIMIT.rHi);
    if (Math.abs(orbit.r - rBase) > rBase * 0.6) { orbit.r = rBase; }
    place();
  }

  // ── The contract ───────────────────────────────────────────────────
  let pending = Promise.resolve();

  function update(next) {
    build = next;
    // Loading a model is asynchronous, so updates are queued. Without this
    // a fast run through the wizard can land parts out of order.
    pending = pending.then(async () => {
      // Checked again after every await. Loading a room or a heavy export
      // takes long enough for dispose() to land in the middle of it, and the
      // rest of this would then add parts to a torn-down scene and reach for
      // a renderer that has given its context back.
      if (!alive || build !== next) { return; }
      await drawRoom(next.opening.w || 60, next.opening.d || 32, next.room,
                     next.shape === 'corner');
      if (!alive || build !== next) { return; }
      await drawParts();
      if (!alive) { return; }
      render();
    }).catch((err) => {
      // The chain has to end resolved. A rejected promise is inherited by
      // every later update, so one failed draw would freeze the viewer for
      // the rest of the visit and report nothing. Say so and carry on: the
      // next answer draws from scratch anyway.
      console.error('seeit-3d: this build did not draw.', err);
    });
    return pending;
  }

  function dispose() {
    alive = false;
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    document.removeEventListener('visibilitychange', onVisible);
    ro.disconnect();
    clear(room);
    clear(parts);
    // clear() steps over everything own() marked, so the viewer releases its
    // own things here. This is the only place they go.
    // dropMaterial rather than dispose, because the floor now carries the
    // tile canvas and a material never releases its own images.
    [roomMat, floorMat, trimMat].forEach(dropMaterial);
    tileTex = null;
    for (const cache of [gltfCache, roomCache]) {
      cache.forEach((loaded) => {
        if (!loaded) { return; }            // false marks a file that failed
        loaded.scene.traverse((n) => {
          if (n.geometry) { n.geometry.dispose(); }
          if (n.material) {
            (Array.isArray(n.material) ? n.material : [n.material])
              .forEach(dropMaterial);
          }
        });
      });
      cache.clear();
    }
    tiles.forEach((t) => t.dispose());
    if (scene.environment) { scene.environment.dispose(); }
    renderer.dispose();
    if (renderer.domElement.parentNode) {
      renderer.domElement.parentNode.removeChild(renderer.domElement);
    }
  }

  resize();
  place();
  if (opts.onReady) { opts.onReady(); }

  return { update, dispose, el: renderer.domElement };
}

// ── Helpers that need no closure ─────────────────────────────────────
function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

// Mark a geometry or a material as the viewer's, not one build's. clear()
// leaves anything marked alone, and dispose() releases it at the end.
function own(res) {
  res.userData.keep = true;
  return res;
}

function kept(res) {
  return !!res.userData && res.userData.keep === true;
}

// Disposing a material does not release the images hanging off it, and a room
// is the one thing here that arrives with its own. Only the caches call this,
// at the end; a build's own material has no map but the shared colour tile,
// which outlives it.
const MAPS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap',
              'emissiveMap', 'alphaMap', 'bumpMap', 'displacementMap',
              'lightMap', 'clearcoatMap', 'specularMap'];

function dropMaterial(mat) {
  if (!mat) { return; }
  for (const key of MAPS) {
    if (mat[key] && mat[key].dispose) { mat[key].dispose(); }
  }
  mat.dispose();
}

// Give a geometry UVs measured in inches, by projecting every vertex onto
// whichever of the three planes its normal faces most. A tile then covers
// TILE_IN inches of product wherever it lands.
//
// This replaces whatever UVs the geometry arrived with, and that is the
// point. Three sources disagreed: ExtrudeGeometry writes the vertex
// coordinates, so it was already inches; BoxGeometry and PlaneGeometry write
// 0 to 1 per face, which made a tile 26 times too big; and the Blender
// exports carry a projection from the CAD import running to a few thousand,
// which made a tile about fifty times too small. One rule now covers all
// three, so a generated shape and an export show the same finish.
//
// scale converts a model unit to an inch. Generated shapes are drawn in
// inches and pass 1. An export passes what snapUnit() worked out.
//
// The plane is chosen per vertex, not per face, because per face needs one
// vertex per triangle and these exports are heavy enough already. Where a
// curved surface turns a corner the two projections meet in a seam. A
// gelcoat speckle hides it. A directional pattern would not, and would need
// the per-face form.
function boxUV(geometry, scale = 1) {
  if (geometry.userData.uvInches) { return; }
  const pos = geometry.attributes.position;
  if (!pos) { return; }
  if (!geometry.attributes.normal) { geometry.computeVertexNormals(); }
  const nor = geometry.attributes.normal;

  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) * scale;
    const y = pos.getY(i) * scale;
    const z = pos.getZ(i) * scale;
    const nx = Math.abs(nor.getX(i));
    const ny = Math.abs(nor.getY(i));
    const nz = Math.abs(nor.getZ(i));
    let u, v;
    if (nx >= ny && nx >= nz) { u = z; v = y; }        // a left or right face
    else if (ny >= nz) { u = x; v = z; }               // a floor or a rim
    else { u = x; v = y; }                             // a back or a front
    uv[i * 2] = u;
    uv[i * 2 + 1] = v;
  }

  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  // Written once. The geometry of an export is shared with the cache, so a
  // second pass would be wasted work on a heavy mesh.
  geometry.userData.uvInches = true;
}

// Take a group apart and release what that build alone was using. paint()
// puts one material on every mesh in a group, so a plain walk would dispose
// the same material once per mesh. The done set holds what has already gone.
function clear(group) {
  const done = new Set();
  for (let i = group.children.length - 1; i >= 0; i--) {
    const o = group.children[i];
    group.remove(o);
    o.traverse((n) => {
      if (n.geometry && !kept(n.geometry) && !done.has(n.geometry)) {
        done.add(n.geometry);
        n.geometry.dispose();
      }
      if (!n.material) { return; }
      for (const m of (Array.isArray(n.material) ? n.material : [n.material])) {
        if (m && !kept(m) && !done.has(m)) {
          done.add(m);
          m.dispose();
        }
      }
    });
  }
}

// A box of glowing planes. Baked once, it becomes the reflection in the
// gelcoat, which is what stops a white product reading as flat paint.
function studio() {
  const s = new THREE.Scene();
  const geo = new THREE.PlaneGeometry(1, 1);
  const lamp = (c) => new THREE.MeshBasicMaterial({
    color: c, side: THREE.DoubleSide, toneMapped: false
  });

  const faces = [
    [0xffffff, [0, 300, 0], [-Math.PI / 2, 0, 0], 900],   // ceiling
    [0xdde6f2, [0, 0, -450], [0, 0, 0], 900],             // far wall
    [0xf2f6fb, [-450, 150, 0], [0, Math.PI / 2, 0], 900], // left
    [0xe6edf6, [450, 150, 0], [0, -Math.PI / 2, 0], 900]  // right
  ];
  for (const [c, p, r, size] of faces) {
    const m = new THREE.Mesh(geo, lamp(c));
    m.scale.setScalar(size);
    m.position.set(p[0], p[1], p[2]);
    m.rotation.set(r[0], r[1], r[2]);
    s.add(m);
  }

  // Two bright strips give the rim of a tub something to catch.
  for (const x of [-160, 160]) {
    const strip = new THREE.Mesh(geo, lamp(0xffffff));
    strip.scale.set(90, 380, 1);
    strip.position.set(x, 220, 120);
    strip.rotation.y = x < 0 ? Math.PI / 2 : -Math.PI / 2;
    s.add(strip);
  }
  return s;
}

/** Whether this browser can run the viewer at all. */
export function supported() {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGLRenderingContext &&
              (c.getContext('webgl2') || c.getContext('webgl')));
  } catch (e) {
    return false;
  }
}
