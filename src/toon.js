import * as THREE from 'three';

const gradCache = new Map();

/** Stepped gradient ramp used by MeshToonMaterial for cel shading. */
export function gradientMap(steps = 3) {
  if (gradCache.has(steps)) return gradCache.get(steps);
  const presets = {
    2: [120, 255],
    3: [88, 176, 255],
    4: [70, 140, 205, 255],
  };
  const vals = presets[steps] || presets[3];
  const data = new Uint8Array(vals.length * 4);
  vals.forEach((v, i) => {
    data[i * 4] = v; data[i * 4 + 1] = v; data[i * 4 + 2] = v; data[i * 4 + 3] = 255;
  });
  const tex = new THREE.DataTexture(data, vals.length, 1, THREE.RGBAFormat);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  gradCache.set(steps, tex);
  return tex;
}

/**
 * Toon material with a crisp stylised rim light (fresnel band) injected.
 */
export function toonMat(color, o = {}) {
  const m = new THREE.MeshToonMaterial({
    color,
    gradientMap: gradientMap(o.steps ?? 3),
    map: o.map ?? null,
    emissive: new THREE.Color(o.emissive ?? 0x000000),
    emissiveIntensity: o.emissiveIntensity ?? 1,
    emissiveMap: o.emissiveMap ?? null,
    transparent: !!o.transparent,
    opacity: o.opacity ?? 1,
    alphaTest: o.alphaTest ?? 0,
    side: o.side ?? THREE.FrontSide,
    vertexColors: !!o.vertexColors,
  });
  const rim = o.rim ?? 0.32;
  if (rim > 0) {
    const rimColor = new THREE.Color(o.rimColor ?? 0xffe4c4);
    const uniforms = { uRimColor: { value: rimColor }, uRim: { value: rim } };
    m.userData.rimUniforms = uniforms;
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uRimColor = uniforms.uRimColor;
      sh.uniforms.uRim = uniforms.uRim;
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform vec3 uRimColor;\nuniform float uRim;')
        .replace(
          '#include <opaque_fragment>',
          `{
            vec3 vdir = normalize(vViewPosition);
            float fr = 1.0 - saturate(dot(vdir, normal));
            float band = smoothstep(0.60, 0.67, fr);
            outgoingLight += uRimColor * band * uRim;
          }
          #include <opaque_fragment>`
        );
    };
    m.customProgramCacheKey = () => 'toon-rim';
  }
  return m;
}

const outlineCache = new Map();

/** Inverted-hull outline material; thickness grows gently with distance so lines stay readable. */
export function outlineMat(thickness = 0.012, color = 0x120e18) {
  const key = thickness + '_' + color;
  if (outlineCache.has(key)) return outlineCache.get(key);
  const m = new THREE.MeshBasicMaterial({ color, side: THREE.BackSide });
  const uniforms = { uThick: { value: thickness } };
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uThick = uniforms.uThick;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uThick;')
      .replace(
        '#include <project_vertex>',
        `vec4 mvPosition = modelViewMatrix * vec4( transformed, 1.0 );
         vec3 nView = normalize( normalMatrix * normal );
         float camDist = -mvPosition.z;
         mvPosition.xyz += nView * uThick * clamp( camDist * 0.09, 0.55, 2.6 );
         gl_Position = projectionMatrix * mvPosition;`
      );
  };
  m.customProgramCacheKey = () => 'toon-outline';
  outlineCache.set(key, m);
  return m;
}

export function addOutline(mesh, thickness = 0.012, color = 0x120e18) {
  const o = new THREE.Mesh(mesh.geometry, outlineMat(thickness, color));
  o.castShadow = false;
  o.receiveShadow = false;
  o.raycast = () => {};
  o.userData.isOutline = true;
  mesh.add(o);
  mesh.userData.outline = o;
  return o;
}

/** Convenience: toon mesh + outline + shadows. */
export function toonMesh(geo, mat, { outline = 0.012, outlineColor, cast = true, receive = true } = {}) {
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = cast;
  mesh.receiveShadow = receive;
  if (outline) addOutline(mesh, outline, outlineColor);
  return mesh;
}
