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
         bars:    [ 'back' | 'side', ... ]
       }

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

// The ADA Select base is the only piece with no height in the workbook.
// These are drawing defaults, not specifications.
const NOMINAL_H = { low: 5, tall: 19 };

export async function createViewer(mount, options = {}) {
  const opts = Object.assign({
    modelPath: '../models/',     // where a Blender export lives
    models: [],                  // part numbers that actually have one
    textures: {},                // color name -> image url
    onReady: null
  }, options);

  // Only ask for a file that is known to be there. Guessing would put a
  // failed request on the wire for every part that has not been exported.
  const exported = new Set(opts.models);

  const renderer = new THREE.WebGLRenderer({
    antialias: true, alpha: false, powerPreference: 'high-performance'
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
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
  scene.environment = pmrem.fromScene(studio(), 0.04, 1, 2000).texture;
  pmrem.dispose();

  scene.add(new THREE.HemisphereLight(0xffffff, 0xb8c6d4, 0.55));

  const key = new THREE.DirectionalLight(0xffffff, 1.5);
  key.position.set(90, 150, 130);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
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
      t.repeat.set(1 / 26, 1 / 26);      // one tile across ~26 in.
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

  function place() {
    const { r, theta, phi, target } = orbit;
    camera.position.set(
      target.x + r * Math.sin(phi) * Math.sin(theta),
      target.y + r * Math.cos(phi),
      target.z + r * Math.sin(phi) * Math.cos(theta)
    );
    camera.lookAt(target);
  }

  let drag = null;
  const el = renderer.domElement;
  el.style.touchAction = 'none';

  el.addEventListener('pointerdown', (e) => {
    drag = { x: e.clientX, y: e.clientY };
    el.setPointerCapture(e.pointerId);
    el.classList.add('is-dragging');
  });
  el.addEventListener('pointermove', (e) => {
    if (!drag) { return; }
    orbit.theta = clamp(orbit.theta - (e.clientX - drag.x) * 0.006,
                        -LIMIT.theta, LIMIT.theta);
    orbit.phi = clamp(orbit.phi - (e.clientY - drag.y) * 0.005,
                      LIMIT.phiLo, LIMIT.phiHi);
    drag = { x: e.clientX, y: e.clientY };
    place();
    render();
  });
  const stop = (e) => {
    drag = null;
    el.classList.remove('is-dragging');
    if (e.pointerId !== undefined && el.hasPointerCapture(e.pointerId)) {
      el.releasePointerCapture(e.pointerId);
    }
  };
  el.addEventListener('pointerup', stop);
  el.addEventListener('pointercancel', stop);

  el.addEventListener('wheel', (e) => {
    e.preventDefault();
    orbit.r = clamp(orbit.r * (1 + Math.sign(e.deltaY) * 0.08),
                    rBase * LIMIT.rLo, rBase * LIMIT.rHi);
    place();
    render();
  }, { passive: false });

  // The keyboard gets the same movement, since the page is otherwise
  // entirely operable without a mouse.
  el.tabIndex = 0;
  el.setAttribute('role', 'img');
  el.setAttribute('aria-label',
    'Your bathroom, drawn. Drag or use the arrow keys to turn it. ' +
    'What is in it is written under the picture.');
  el.addEventListener('keydown', (e) => {
    const step = 0.09;
    if (e.key === 'ArrowLeft') { orbit.theta = clamp(orbit.theta + step, -LIMIT.theta, LIMIT.theta); }
    else if (e.key === 'ArrowRight') { orbit.theta = clamp(orbit.theta - step, -LIMIT.theta, LIMIT.theta); }
    else if (e.key === 'ArrowUp') { orbit.phi = clamp(orbit.phi - step, LIMIT.phiLo, LIMIT.phiHi); }
    else if (e.key === 'ArrowDown') { orbit.phi = clamp(orbit.phi + step, LIMIT.phiLo, LIMIT.phiHi); }
    else { return; }
    e.preventDefault();
    place();
    render();
  });

  // ── Size ───────────────────────────────────────────────────────────
  function resize() {
    const w = mount.clientWidth || 640;
    const h = Math.round(w * 0.72);
    renderer.setSize(w, h, true);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    render();
  }
  const ro = new ResizeObserver(resize);
  ro.observe(mount);

  // ── Draw only when something changed ───────────────────────────────
  function render() { dirty = true; }

  (function loop() {
    if (!alive) { return; }
    if (dirty) { dirty = false; renderer.render(scene, camera); }
    requestAnimationFrame(loop);
  })();

  // ── Build the room ─────────────────────────────────────────────────
  function drawRoom(w, d) {
    clear(room);

    const floor = new THREE.Mesh(new THREE.PlaneGeometry(w + 220, d + 220), floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.z = (d + 220) / 2 - d - 4;
    floor.receiveShadow = true;
    room.add(floor);

    const back = new THREE.Mesh(new THREE.PlaneGeometry(w + 200, ROOM_H), roomMat);
    back.position.set(0, ROOM_H / 2, -d);
    back.receiveShadow = true;
    room.add(back);

    for (const s of [-1, 1]) {
      const side = new THREE.Mesh(new THREE.PlaneGeometry(d + 200, ROOM_H), roomMat);
      side.rotation.y = s * Math.PI / 2;
      side.position.set(s * (w / 2), ROOM_H / 2, -d + (d + 200) / 2);
      side.receiveShadow = true;
      room.add(side);
    }
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
        const seat = new THREE.Mesh(
          rounded(sw, d - 2 * WALL_T, rim - WALL_T, 1), mat);
        seat.position.set(-w / 2 + WALL_T + sw / 2, (rim - WALL_T) / 2, -d / 2);
        seat.castShadow = true;
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
      return fit(gltfCache.get(url).scene.clone(true), w, d);
    } catch (err) {
      // A missing loader stops every part. A bad file stops only that one.
      if (!GLTF) { gltfOff = true; } else { gltfCache.set(url, false); }
      return fallback();
    }
  }

  // Sit an export in the opening. The export is Y up, the way glTF says:
  // X is the width, Y the height, Z the depth. See models/README.md.
  //
  // Scale comes from the width alone, because the width is what has to
  // meet the two side walls. Depth is left as modelled, since a surround
  // legitimately returns past the mouth of the alcove.
  //
  // Height is read off the model rather than the workbook. A nominal size
  // leaves out the flange, so a 3-1/2 in. base measures nearer 5, and the
  // surround above it has to stack on what is really there.
  function fit(root, w, d) {
    const holder = new THREE.Group();
    holder.add(root);
    root.updateMatrixWorld(true);

    const span = new THREE.Box3().setFromObject(root)
      .getSize(new THREE.Vector3());
    if (span.x > 1e-9) { root.scale.setScalar(snapUnit(w / span.x)); }
    root.updateMatrixWorld(true);

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
    const rim = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, {
      depth: lip, bevelEnabled: true,
      bevelSize: APRON_R * 0.4, bevelThickness: APRON_R * 0.4,
      bevelSegments: 2, curveSegments: 10
    }), null);
    // Turning the mesh sends its local +Z to world +Y, so the ring grows
    // upward from wherever it is put. Its top has to land on h, not above.
    rim.rotation.x = -Math.PI / 2;
    rim.position.y = h - lip;
    g.add(rim);

    const body = new THREE.Mesh(rounded(w, d, h - 0.6, r), null);
    body.position.y = (h - 0.6) / 2;
    g.add(body);

    const basin = new THREE.Mesh(
      new THREE.PlaneGeometry(w - 2 * WALL_T, d - 2 * WALL_T), null);
    basin.rotation.x = -Math.PI / 2;
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
  function paint(group, mat) {
    group.traverse((o) => {
      if (!o.isMesh) { return; }
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
      if (!alive || build !== next) { return; }
      drawRoom(next.opening.w || 60, next.opening.d || 32);
      await drawParts();
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
    ro.disconnect();
    clear(room);
    clear(parts);
    // clear() steps over everything own() marked, so the viewer releases its
    // own things here. This is the only place they go.
    [roomMat, floorMat, trimMat].forEach((m) => m.dispose());
    gltfCache.forEach((loaded) => {
      if (!loaded) { return; }              // false marks a file that failed
      loaded.scene.traverse((n) => {
        if (n.geometry) { n.geometry.dispose(); }
        if (n.material) {
          (Array.isArray(n.material) ? n.material : [n.material])
            .forEach((m) => m.dispose());
        }
      });
    });
    gltfCache.clear();
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
