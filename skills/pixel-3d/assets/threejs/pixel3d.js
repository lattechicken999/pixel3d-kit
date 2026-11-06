// pixel3d.js — render a real-time 3D scene so it reads as hand-made pixel art.
// MIT License. Requires three.js r150+ (WebGL2).
//
// Implements the eight techniques (see SKILL.md):
//  1. low-res render + nearest-neighbour upscale        -> PixelRenderer
//  2. 1-pixel silhouette outline (depth edges)           -> PixelRenderer (outline)
//  3. inner crease lines (normal edges)                  -> PixelRenderer (creases)
//  4. stepped lighting / fixed colour bands              -> createToonMaterial, palette
//  5. edited light response + separate shadow shapes     -> sphericalizeNormals, addShadowProxy
//  6. pixel-grid snapping (camera, objects, joints, fx)  -> PixelRenderer (snapping), userData.pixelSnap
//  7. stepped rotation ("flip-book" angles)              -> quantizeAngle
//  8. sprite-like draw order (no clipping into walls)    -> flattenDepth

import * as THREE from 'three';

const FS_VERT = /* glsl */ `
out vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const FS_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform sampler2D tNormal;
uniform vec2 innerSize;      // visible low-res size (pixels)
uniform vec2 subPixel;       // camera snap remainder, in low-res pixels
uniform float depthRange;    // far - near (ortho depth is linear)
uniform bool outlineOn;
uniform float outlineThreshold; // world units
uniform float outlineDarken;
uniform vec3 outlineColor;
uniform bool outlineUseColor;
uniform bool creaseOn;
uniform float creaseThreshold;
uniform float creaseStrength;   // >0 lighten, <0 darken
uniform int paletteSize;
uniform vec3 palette[32];
uniform float posterize;     // 0 = off, else levels per channel
in vec2 vUv;
out vec4 outColor;

ivec2 cl(ivec2 p) { return clamp(p, ivec2(0), textureSize(tColor, 0) - 1); }
float depthAt(ivec2 p) { return texelFetch(tDepth, cl(p), 0).r * depthRange; }
vec3 normalAt(ivec2 p) { return normalize(texelFetch(tNormal, cl(p), 0).rgb * 2.0 - 1.0); }

void main() {
  // +1: the target has a one-pixel margin used by sub-pixel camera scrolling.
  vec2 lp = vUv * innerSize + 1.0 + subPixel;
  ivec2 p = cl(ivec2(floor(lp)));
  vec3 col = texelFetch(tColor, p, 0).rgb;
  float d = depthAt(p);

  ivec2 o[4] = ivec2[4](ivec2(1,0), ivec2(-1,0), ivec2(0,1), ivec2(0,-1));

  // (2) silhouette: this pixel is in front of a neighbour by a big jump
  // -> it is the outermost pixel of the nearer object, so it gets the line.
  float edge = 0.0;
  if (outlineOn) {
    for (int i = 0; i < 4; i++) edge += max(0.0, depthAt(p + o[i]) - d);
    edge = step(outlineThreshold, edge);
  }

  // (3) creases: normals bend sharply but depth is continuous.
  float crease = 0.0;
  if (creaseOn && edge < 0.5) {
    vec3 n = normalAt(p);
    for (int i = 0; i < 4; i++) {
      vec3 nn = normalAt(p + o[i]);
      float dd = depthAt(p + o[i]) - d;
      // one-sided bias so lines are exactly 1px wide, never doubled
      vec3 bias = normalize(vec3(1.0, 1.0, 1.0));
      float nIndicator = clamp(dot(n - nn, bias), 0.0, 1.0);
      float dIndicator = clamp(sign(dd * 0.25 + 0.0025), 0.0, 1.0);
      crease += (1.0 - dot(n, nn)) * nIndicator * dIndicator;
    }
    crease = step(creaseThreshold, crease);
  }

  if (edge > 0.5) {
    col = outlineUseColor ? outlineColor : col * outlineDarken;
  } else if (crease > 0.5) {
    col = creaseStrength > 0.0 ? mix(col, vec3(1.0), creaseStrength) : col * (1.0 + creaseStrength);
  }

  // (4) fixed colour steps
  if (posterize > 0.0) col = floor(col * posterize + 0.5) / posterize;
  if (paletteSize > 0) {
    float best = 1e9; vec3 pick = col;
    for (int i = 0; i < 32; i++) {
      if (i >= paletteSize) break;
      vec3 dv = palette[i] - col;
      float dist = dot(dv, dv);
      if (dist < best) { best = dist; pick = palette[i]; }
    }
    col = pick;
  }
  outColor = linearToOutputTexel(vec4(col, 1.0));
}`;

/**
 * Low-res 3D -> pixel-art post pipeline.
 * Use an OrthographicCamera (perspective "works" but pixels will swim).
 */
export class PixelRenderer {
  constructor(renderer, opts = {}) {
    this.renderer = renderer;
    this.pixelSize = opts.pixelSize ?? 4;
    this.snapCamera = opts.snapCamera ?? true;     // (6) camera on the pixel grid
    this.snapObjects = opts.snapObjects ?? true;   // (6) objects with userData.pixelSnap
    this.subPixelScroll = opts.subPixelScroll ?? true; // smooth camera pan despite snapping

    this._normalMat = new THREE.MeshNormalMaterial();
    this._flatNormal = new THREE.Color().setRGB(0.5, 0.5, 1, THREE.LinearSRGBColorSpace);
    this._quadScene = new THREE.Scene();
    this._quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.material = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: FS_VERT,
      fragmentShader: FS_FRAG,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        tColor: { value: null }, tDepth: { value: null }, tNormal: { value: null },
        innerSize: { value: new THREE.Vector2() },
        subPixel: { value: new THREE.Vector2() },
        depthRange: { value: 1 },
        outlineOn: { value: opts.outline ?? true },
        outlineThreshold: { value: opts.outlineThreshold ?? 0.6 },
        outlineDarken: { value: opts.outlineDarken ?? 0.35 },
        outlineColor: { value: new THREE.Color(opts.outlineColor ?? 0x000000) },
        outlineUseColor: { value: opts.outlineColor != null },
        creaseOn: { value: opts.creases ?? true },
        creaseThreshold: { value: opts.creaseThreshold ?? 0.25 },
        creaseStrength: { value: opts.creaseStrength ?? 0.2 },
        paletteSize: { value: 0 },
        palette: { value: Array.from({ length: 32 }, () => new THREE.Color()) },
        posterize: { value: opts.posterize ?? 0 },
      },
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    quad.frustumCulled = false;
    this._quadScene.add(quad);
    if (opts.palette) this.setPalette(opts.palette);

    const size = renderer.getSize(new THREE.Vector2());
    this.setSize(size.x, size.y);
  }

  /** Accessors for the shader toggles. */
  get outline() { return this.material.uniforms.outlineOn.value; }
  set outline(v) { this.material.uniforms.outlineOn.value = v; }
  get creases() { return this.material.uniforms.creaseOn.value; }
  set creases(v) { this.material.uniforms.creaseOn.value = v; }
  get posterize() { return this.material.uniforms.posterize.value; }
  set posterize(v) { this.material.uniforms.posterize.value = v; }

  /** Limit output to a palette: array of hex numbers / CSS strings (max 32), or null. */
  setPalette(colors) {
    const u = this.material.uniforms;
    if (!colors || !colors.length) { u.paletteSize.value = 0; return; }
    colors.slice(0, 32).forEach((c, i) => u.palette.value[i].set(c)); // THREE.Color converts sRGB -> linear
    u.paletteSize.value = Math.min(colors.length, 32);
  }

  setPixelSize(px) { this.pixelSize = Math.max(1, Math.round(px)); this.setSize(this._w, this._h); }

  setSize(w, h) {
    this._w = w; this._h = h;
    this.renderer.setSize(w, h, false);
    const iw = Math.max(1, Math.floor(w / this.pixelSize));
    const ih = Math.max(1, Math.floor(h / this.pixelSize));
    this.innerSize = new THREE.Vector2(iw, ih);
    const tw = iw + 2, th = ih + 2; // one-pixel margin on every side
    this._color?.dispose(); this._normal?.dispose();
    const params = { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter };
    this._color = new THREE.WebGLRenderTarget(tw, th, {
      ...params,
      depthTexture: new THREE.DepthTexture(tw, th, THREE.FloatType),
    });
    this._normal = new THREE.WebGLRenderTarget(tw, th, { ...params, depthBuffer: true });
    const u = this.material.uniforms;
    u.tColor.value = this._color.texture;
    u.tDepth.value = this._color.depthTexture;
    u.tNormal.value = this._normal.texture;
    u.innerSize.value.copy(this.innerSize);
  }

  /** World units covered by one low-res pixel (ortho camera). */
  pixelWorldSize(camera) {
    return (camera.top - camera.bottom) / camera.zoom / this.innerSize.y;
  }

  render(scene, camera) {
    const r = this.renderer;
    const u = this.material.uniforms;
    const isOrtho = camera.isOrthographicCamera;
    const saved = [];

    // ---- (6) snap camera + flagged objects to the pixel grid -------------
    const savedCamPos = camera.position.clone();
    const frustum = isOrtho && [camera.left, camera.right, camera.top, camera.bottom];
    u.subPixel.value.set(0, 0);
    if (isOrtho) {
      const pw = this.pixelWorldSize(camera);
      camera.updateMatrixWorld();
      const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
      const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
      if (this.snapCamera) {
        const x = camera.position.dot(right), y = camera.position.dot(up);
        const sx = Math.round(x / pw) * pw, sy = Math.round(y / pw) * pw;
        camera.position.addScaledVector(right, sx - x).addScaledVector(up, sy - y);
        if (this.subPixelScroll) u.subPixel.value.set((x - sx) / pw, (y - sy) / pw);
      }
      if (this.snapObjects) {
        // snap in the camera-aligned frame, relative to the (snapped) camera
        const origin = camera.position;
        scene.traverseVisible((o) => {
          if (!o.userData.pixelSnap) return;
          o.updateWorldMatrix(true, false);
          const wp = new THREE.Vector3().setFromMatrixPosition(o.matrixWorld);
          const rel = wp.clone().sub(origin);
          const x = rel.dot(right), y = rel.dot(up);
          const dx = Math.round(x / pw) * pw - x, dy = Math.round(y / pw) * pw - y;
          const target = wp.clone().addScaledVector(right, dx).addScaledVector(up, dy);
          if (o.parent) o.parent.worldToLocal(target);
          saved.push([o, o.position.clone()]);
          o.position.copy(target);
        });
      }
      // widen the frustum by one pixel on each side to fill the margin
      const zx = pw * camera.zoom, zy = pw * camera.zoom;
      camera.left -= zx; camera.right += zx; camera.top += zy; camera.bottom -= zy;
      camera.updateProjectionMatrix();
      u.depthRange.value = camera.far - camera.near;
    } else {
      u.depthRange.value = 1.0; // non-linear; tune outlineThreshold small (~0.001)
    }

    // ---- passes ---------------------------------------------------------
    const prevTarget = r.getRenderTarget();
    const prevOverride = scene.overrideMaterial;
    const prevBg = scene.background;

    scene.overrideMaterial = this._normalMat;
    scene.background = null;
    const proxies = [];
    scene.traverse((o) => { if (o.userData.isShadowProxy && o.visible) { o.visible = false; proxies.push(o); } });
    const prevClear = r.getClearColor(new THREE.Color());
    const prevAlpha = r.getClearAlpha();
    r.setClearColor(this._flatNormal, 1);
    r.setRenderTarget(this._normal);
    r.clear();
    r.render(scene, camera);
    r.setClearColor(prevClear, prevAlpha);
    proxies.forEach((o) => { o.visible = true; });
    scene.overrideMaterial = prevOverride;
    scene.background = prevBg;

    r.setRenderTarget(this._color);
    r.clear();
    r.render(scene, camera);

    r.setRenderTarget(prevTarget);
    r.render(this._quadScene, this._quadCam);

    // ---- restore --------------------------------------------------------
    for (const [o, p] of saved) o.position.copy(p);
    camera.position.copy(savedCamPos);
    if (isOrtho) {
      [camera.left, camera.right, camera.top, camera.bottom] = frustum;
      camera.updateProjectionMatrix();
    }
  }

  dispose() {
    this._color.dispose(); this._normal.dispose();
    this.material.dispose(); this._normalMat.dispose();
  }
}

/**
 * (4) Stepped lighting: a toon material whose light response has exactly `steps` bands.
 * `bands` lets you set the brightness of each band (0..1), dark -> light.
 */
export function createToonMaterial({ color = 0xffffff, steps = 3, bands, map, ...rest } = {}) {
  const levels = bands ?? Array.from({ length: steps }, (_, i) => (steps === 1 ? 1 : 0.35 + (0.65 * i) / (steps - 1)));
  const data = new Uint8Array(levels.length * 4);
  levels.forEach((v, i) => data.set([v * 255, v * 255, v * 255, 255], i * 4));
  const gradientMap = new THREE.DataTexture(data, levels.length, 1, THREE.RGBAFormat);
  gradientMap.minFilter = gradientMap.magFilter = THREE.NearestFilter;
  gradientMap.needsUpdate = true;
  return new THREE.MeshToonMaterial({ color, gradientMap, ...(map ? { map } : {}), ...rest });
}

/**
 * (5a) Edit how a shape receives light: blend each vertex normal toward the
 * direction from `center`, so lumpy meshes (bushes, cacti, heads) shade as one
 * clean round volume instead of noisy facets. strength 0..1.
 */
export function sphericalizeNormals(geometry, strength = 1, center) {
  geometry.computeBoundingBox();
  const c = center ?? geometry.boundingBox.getCenter(new THREE.Vector3());
  const pos = geometry.attributes.position;
  if (!geometry.attributes.normal) geometry.computeVertexNormals();
  const nrm = geometry.attributes.normal;
  const p = new THREE.Vector3(), n = new THREE.Vector3(), s = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i);
    n.fromBufferAttribute(nrm, i);
    s.copy(p).sub(c).normalize();
    n.lerp(s, strength).normalize();
    nrm.setXYZ(i, n.x, n.y, n.z);
  }
  nrm.needsUpdate = true;
  return geometry;
}

/**
 * (5b) Shadows from a separate, simpler shape: the visible mesh stops casting,
 * an invisible proxy (e.g. a disc, a capsule) casts instead.
 */
export function addShadowProxy(mesh, proxyGeometry) {
  mesh.castShadow = false;
  const proxy = new THREE.Mesh(proxyGeometry, new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }));
  proxy.castShadow = true;
  proxy.name = `${mesh.name || 'mesh'}-shadowProxy`;
  // writes no colour/depth; PixelRenderer also hides it from the normal pass
  mesh.add(proxy);
  proxy.userData.isShadowProxy = true;
  return proxy;
}

/** (7) Stepped rotation: snap an angle (radians) to `steps` directions, like sprite frames. */
export function quantizeAngle(angle, steps = 8) {
  const step = (Math.PI * 2) / steps;
  return Math.round(angle / step) * step;
}

/**
 * (8) Sprite-like draw order: `object` is depth-tested as if it were an upright
 * card standing at its pivot (like y-sorting sprites in a 2D game), so the
 * whole character occludes / is occluded as one flat sprite. A sword swung "into" a wall stays visible while the
 * character stands in front of it. `bias` pulls it toward the camera (world units);
 * `keep` (0..1) is how much of the object's own depth range survives, so its
 * parts (sword behind/in front of body) still sort correctly among themselves.
 */
export function flattenDepth(object, { bias = 0.05, keep = 0.1 } = {}) {
  const pivotWorld = { value: new THREE.Vector3() };
  const flattenBias = { value: bias };
  const flattenAmount = { value: 1 };
  const flattenKeep = { value: keep };
  object.traverse((o) => {
    if (!o.isMesh || !o.material) return;
    o.onBeforeRender = () => { object.getWorldPosition(pivotWorld.value); };
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    mats.forEach((m) => {
      m.onBeforeCompile = (shader) => {
        shader.uniforms.pivotWorld = pivotWorld;
        shader.uniforms.flattenBias = flattenBias;
        shader.uniforms.flattenAmount = flattenAmount;
        shader.uniforms.flattenKeep = flattenKeep;
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', '#include <common>\nuniform vec3 pivotWorld;\nuniform float flattenBias;\nuniform float flattenAmount;\nuniform float flattenKeep;')
          .replace('#include <project_vertex>', `#include <project_vertex>
  {
    // depth-test the object as an upright card standing at its pivot (2D y-sort):
    // squash every vertex's horizontal distance-from-camera onto the pivot,
    // keep its height. Parts keep a little relative depth (flattenKeep).
    vec3 fwd = -vec3(viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2]);
    vec3 fh = normalize(vec3(fwd.x, 0.0, fwd.z) + vec3(0.0, 0.0, 1e-5));
    vec4 wp = modelMatrix * vec4(transformed, 1.0);
    float along = dot(wp.xyz - pivotWorld, fh);
    wp.xyz -= fh * (along * (1.0 - flattenKeep) + flattenBias);
    vec4 pc = projectionMatrix * viewMatrix * wp;
    gl_Position.z = mix(gl_Position.z, (pc.z / pc.w) * gl_Position.w, flattenAmount);
  }`);
      };
      m.customProgramCacheKey = () => 'flattenDepth';
      m.needsUpdate = true;
    });
  });
  // handle: set .enabled = false to compare, .bias to tune
  return {
    get enabled() { return flattenAmount.value > 0.5; },
    set enabled(v) { flattenAmount.value = v ? 1 : 0; },
    get bias() { return flattenBias.value; },
    set bias(v) { flattenBias.value = v; },
  };
}
