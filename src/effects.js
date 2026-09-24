import * as THREE from 'three';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { crackDecalTexture } from './textures.js';
import { rand } from './constants.js';

// ---------------------------------------------------------------------------
// GPU point particles (CPU simulated)
// ---------------------------------------------------------------------------
class Particles {
  constructor(scene, max, additive) {
    this.max = max;
    this.cursor = 0;
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.shape = new Float32Array(max);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aShape', new THREE.BufferAttribute(this.shape, 1).setUsage(THREE.DynamicDrawUsage));
    this.p = [];
    for (let i = 0; i < max; i++) {
      this.p.push({ life: 0, max: 1, vx: 0, vy: 0, vz: 0, s0: 0, s1: 0, c0: new THREE.Color(), c1: new THREE.Color(), grav: 0, drag: 0, shape: 0, spin: 0 });
    }
    this.uniforms = { uScale: { value: 600 } };
    const m = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      vertexColors: true,
      vertexShader: `
        attribute float aSize; attribute float aAlpha; attribute float aShape;
        varying vec3 vCol; varying float vA; varying float vShape;
        uniform float uScale;
        void main(){
          vCol = color; vA = aAlpha; vShape = aShape;
          vec4 mv = modelViewMatrix * vec4(position,1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = aAlpha <= 0.0 ? 0.0 : aSize * uScale / max(0.1, -mv.z);
        }`,
      fragmentShader: `
        varying vec3 vCol; varying float vA; varying float vShape;
        void main(){
          vec2 p = gl_PointCoord * 2.0 - 1.0;
          float r = length(p);
          float a;
          if (vShape < 0.5) { a = smoothstep(1.0, 0.0, r); a *= a; }
          else if (vShape < 1.5) {
            float ang = atan(p.y, p.x);
            float star = 0.35 + 0.65 * pow(abs(cos(ang * 2.0)), 18.0);
            a = smoothstep(star, star * 0.2, r) + smoothstep(0.35, 0.0, r);
          }
          else if (vShape < 2.5) { a = smoothstep(1.0, 0.7, r) * smoothstep(0.2, 0.6, r) * 1.5; }
          else { a = step(r, 1.0) * (1.0 - r * 0.3); }
          if (a <= 0.001) discard;
          gl_FragColor = vec4(vCol, a * vA);
        }`,
    });
    this.points = new THREE.Points(g, m);
    this.points.frustumCulled = false;
    this.points.renderOrder = 10;
    scene.add(this.points);
  }

  emit(o) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.max;
    const p = this.p[i];
    p.life = p.max = o.life ?? 1;
    this.pos[i * 3] = o.x; this.pos[i * 3 + 1] = o.y; this.pos[i * 3 + 2] = o.z;
    p.vx = o.vx ?? 0; p.vy = o.vy ?? 0; p.vz = o.vz ?? 0;
    p.s0 = o.size ?? 0.2; p.s1 = o.size1 ?? p.s0 * 0.2;
    p.c0.copy(o.color ?? WHITE);
    p.c1.copy(o.color1 ?? o.color ?? WHITE);
    p.grav = o.grav ?? 0;
    p.drag = o.drag ?? 1;
    p.shape = o.shape ?? 0;
    this.shape[i] = p.shape;
  }

  update(dt) {
    const P = this.pos;
    for (let i = 0; i < this.max; i++) {
      const p = this.p[i];
      if (p.life <= 0) { this.alpha[i] = 0; continue; }
      p.life -= dt;
      const t = 1 - Math.max(0, p.life) / p.max;
      const d = Math.exp(-p.drag * dt);
      p.vx *= d; p.vy *= d; p.vz *= d;
      p.vy -= p.grav * dt;
      P[i * 3] += p.vx * dt; P[i * 3 + 1] += p.vy * dt; P[i * 3 + 2] += p.vz * dt;
      if (P[i * 3 + 1] < 0.02) { P[i * 3 + 1] = 0.02; p.vy *= -0.3; }
      this.size[i] = p.s0 + (p.s1 - p.s0) * t;
      this.alpha[i] = p.life > 0 ? Math.min(1, (1 - t) * 1.6) : 0;
      this.col[i * 3] = p.c0.r + (p.c1.r - p.c0.r) * t;
      this.col[i * 3 + 1] = p.c0.g + (p.c1.g - p.c0.g) * t;
      this.col[i * 3 + 2] = p.c0.b + (p.c1.b - p.c0.b) * t;
    }
    const a = this.points.geometry.attributes;
    a.position.needsUpdate = true; a.color.needsUpdate = true; a.aSize.needsUpdate = true; a.aAlpha.needsUpdate = true; a.aShape.needsUpdate = true;
  }
}
const WHITE = new THREE.Color(1, 1, 1);

// ---------------------------------------------------------------------------
// Ribbon trail
// ---------------------------------------------------------------------------
export class Trail {
  constructor(scene, { length = 26, width = 0.22, color = 0xffffff, color2, intensity = 2.5 } = {}) {
    this.len = length;
    this.width = width;
    this.pts = [];
    this.active = false;
    this.fade = 0;
    const geo = new THREE.BufferGeometry();
    this.posArr = new Float32Array(length * 2 * 3);
    this.tArr = new Float32Array(length * 2);
    const idx = [];
    for (let i = 0; i < length - 1; i++) {
      const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
      idx.push(a, b, c, b, d, c);
    }
    geo.setIndex(idx);
    geo.setAttribute('position', new THREE.BufferAttribute(this.posArr, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aT', new THREE.BufferAttribute(this.tArr, 1));
    for (let i = 0; i < length; i++) { this.tArr[i * 2] = i / (length - 1); this.tArr[i * 2 + 1] = i / (length - 1); }
    this.uniforms = {
      uColor: { value: new THREE.Color(color).multiplyScalar(intensity) },
      uColor2: { value: new THREE.Color(color2 ?? color).multiplyScalar(intensity) },
      uFade: { value: 1 },
      uSide: { value: 0 },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      vertexShader: `attribute float aT; varying float vT; varying float vSide;
        void main(){ vT = aT; vSide = float(gl_VertexID % 2); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `uniform vec3 uColor; uniform vec3 uColor2; uniform float uFade; varying float vT; varying float vSide;
        void main(){
          float edge = 1.0 - abs(vSide * 2.0 - 1.0);
          float a = pow(1.0 - vT, 1.5) * uFade * (0.35 + 0.65 * smoothstep(0.0, 0.6, edge));
          vec3 c = mix(uColor, uColor2, vT);
          gl_FragColor = vec4(c * a, a);
        }`,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.mesh.renderOrder = 9;
    scene.add(this.mesh);
    this._a = new THREE.Vector3();
    this._b = new THREE.Vector3();
    this._c = new THREE.Vector3();
  }

  setColors(c1, c2, intensity = 2.5) {
    this.uniforms.uColor.value.set(c1).multiplyScalar(intensity);
    this.uniforms.uColor2.value.set(c2 ?? c1).multiplyScalar(intensity);
  }

  start(pos) {
    this.active = true;
    this.fade = 1;
    this.pts.length = 0;
    for (let i = 0; i < this.len; i++) this.pts.push(pos.clone());
    this.mesh.visible = true;
  }

  stop() { this.active = false; }

  update(dt, head, camera) {
    if (!this.mesh.visible) return;
    if (this.active && head) {
      // shift
      const last = this.pts.pop();
      last.copy(head);
      this.pts.unshift(last);
    } else {
      this.fade -= dt * 3;
      if (this.fade <= 0) { this.mesh.visible = false; return; }
      const last = this.pts.pop();
      last.copy(this.pts[0]);
      this.pts.unshift(last);
    }
    this.uniforms.uFade.value = Math.max(0, this.fade);
    const cam = camera.position;
    for (let i = 0; i < this.len; i++) {
      const p = this.pts[i];
      const n = this.pts[Math.min(i + 1, this.len - 1)];
      const pr = this.pts[Math.max(i - 1, 0)];
      const tan = this._a.subVectors(pr, n);
      if (tan.lengthSq() < 1e-8) tan.set(0, 1, 0);
      const view = this._b.subVectors(cam, p);
      const side = this._c.crossVectors(tan, view).normalize();
      const w = this.width * (1 - i / this.len * 0.85);
      this.posArr[i * 6] = p.x + side.x * w; this.posArr[i * 6 + 1] = p.y + side.y * w; this.posArr[i * 6 + 2] = p.z + side.z * w;
      this.posArr[i * 6 + 3] = p.x - side.x * w; this.posArr[i * 6 + 4] = p.y - side.y * w; this.posArr[i * 6 + 5] = p.z - side.z * w;
    }
    this.mesh.geometry.attributes.position.needsUpdate = true;
  }
}

// ---------------------------------------------------------------------------
// Effects manager
// ---------------------------------------------------------------------------
export class Effects {
  constructor(scene, camera) {
    this.scene = scene;
    this.camera = camera;
    this.add = new Particles(scene, 5000, true);
    this.dust = new Particles(scene, 1200, false);
    this.rings = [];
    this.bolts = [];
    this.ghosts = [];
    this.decals = [];
    this.stars = [];
    this.pillars = [];
    this.flashes = [];
    this.trails = [];
    this.lineRes = new THREE.Vector2(1280, 720);
    this.crackTex = crackDecalTexture();
    this.ringGeo = new THREE.PlaneGeometry(2, 2);
    this.tmp = new THREE.Vector3();
    this.light = new THREE.PointLight(0xffa040, 0, 12, 1.5);
    scene.add(this.light);
    this.lightI = 0;
    this.shake = 0;
    this.screen = { flash: 0, aberr: 0, speed: 0, tint: new THREE.Color(1, 1, 1), tintAmt: 0, zoom: 0 };
    const starShape = new THREE.Shape();
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * Math.PI * 2 - Math.PI / 2;
      const r = k % 2 ? 0.035 : 0.08;
      if (k === 0) starShape.moveTo(Math.cos(a) * r, Math.sin(a) * r); else starShape.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    this.starGeo = new THREE.ShapeGeometry(starShape);
  }

  newTrail(opts) {
    const t = new Trail(this.scene, opts);
    this.trails.push(t);
    return t;
  }

  setSize(w, h, pixelRatio, fov) {
    const s = (h * pixelRatio) / (2 * Math.tan((fov * Math.PI) / 360));
    this.add.uniforms.uScale.value = s;
    this.dust.uniforms.uScale.value = s;
    this.lineRes.set(w, h);
    for (const b of this.bolts) b.line.material.resolution.copy(this.lineRes);
  }

  // ---- particle recipes ----
  burst(pos, { n = 40, speed = 5, color = 0xffaa33, color1, size = 0.18, life = 0.8, grav = 4, shape = 0, drag = 2.5, up = 0, spread = 1 } = {}) {
    const c0 = new THREE.Color(color).multiplyScalar(3);
    const c1 = new THREE.Color(color1 ?? color).multiplyScalar(color1 ? 2 : 0.6);
    for (let i = 0; i < n; i++) {
      const v = randDir(this.tmp).multiplyScalar(speed * rand(0.3, 1));
      v.y = v.y * spread + up;
      this.add.emit({ x: pos.x, y: pos.y, z: pos.z, vx: v.x, vy: v.y, vz: v.z, life: life * rand(0.5, 1.1), size: size * rand(0.6, 1.3), size1: 0.01, color: c0, color1: c1, grav, drag, shape });
    }
  }

  sparks(pos, n = 30, color = 0xffd27a, speed = 7) {
    this.burst(pos, { n, speed, color, color1: 0xff4010, size: 0.09, life: 0.6, grav: 12, shape: 3, drag: 1.2 });
  }

  dustPuff(pos, n = 8, strength = 1) {
    const c = new THREE.Color(0x9a93a8);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = rand(0.4, 1.4) * strength;
      this.dust.emit({ x: pos.x + Math.cos(a) * 0.1, y: 0.06, z: pos.z + Math.sin(a) * 0.1, vx: Math.cos(a) * sp, vy: rand(0.2, 0.9) * strength, vz: Math.sin(a) * sp, life: rand(0.4, 0.8), size: rand(0.18, 0.32) * strength, size1: 0.5 * strength, color: c, color1: c, grav: -0.3, drag: 3, shape: 0 });
    }
  }

  fire(pos, n = 3, scale = 1, colA = 0xffd070, colB = 0xff2a00) {
    for (let i = 0; i < n; i++) {
      this.add.emit({
        x: pos.x + rand(-0.08, 0.08) * scale, y: pos.y + rand(-0.08, 0.08) * scale, z: pos.z + rand(-0.08, 0.08) * scale,
        vx: rand(-0.4, 0.4), vy: rand(0.8, 2.2) * scale, vz: rand(-0.4, 0.4),
        life: rand(0.25, 0.5), size: rand(0.18, 0.34) * scale, size1: 0.02,
        color: new THREE.Color(colA).multiplyScalar(3), color1: new THREE.Color(colB).multiplyScalar(1.5), grav: -1, drag: 2, shape: 0,
      });
    }
  }

  aura(pos, color, n = 2, radius = 0.5, h = 2) {
    const c = new THREE.Color(color).multiplyScalar(2.6);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      this.add.emit({ x: pos.x + Math.cos(a) * radius, y: pos.y + Math.random() * h, z: pos.z + Math.sin(a) * radius, vx: -Math.cos(a) * 0.3, vy: rand(1.2, 2.6), vz: -Math.sin(a) * 0.3, life: rand(0.35, 0.7), size: rand(0.08, 0.16), size1: 0.01, color: c, color1: c, grav: 0, drag: 1, shape: Math.random() < 0.3 ? 1 : 0 });
    }
  }

  confetti(pos, n = 80) {
    const cols = [0xff3b6b, 0xffd23f, 0x3bceff, 0x7dff6b, 0xb65bff];
    for (let i = 0; i < n; i++) {
      const c = new THREE.Color(cols[i % cols.length]).multiplyScalar(1.4);
      const v = randDir(this.tmp).multiplyScalar(rand(2, 7));
      this.dust.emit({ x: pos.x, y: pos.y, z: pos.z, vx: v.x, vy: Math.abs(v.y) + 2, vz: v.z, life: rand(1.2, 2.2), size: rand(0.06, 0.1), size1: 0.06, color: c, color1: c, grav: 5, drag: 1.8, shape: 3 });
    }
  }

  firework(pos, color = 0xffffff) {
    const cols = [0xff4fd8, 0x3bf0ff, 0xffe45c, 0x8cff6b];
    for (let k = 0; k < 3; k++) {
      const col = cols[(Math.random() * cols.length) | 0];
      const c = pos.clone().add(new THREE.Vector3(rand(-1.2, 1.2), rand(0.5, 1.8), rand(-0.6, 0.6)));
      this.burst(c, { n: 70, speed: 6, color: col, color1: color, size: 0.12, life: 1.1, grav: 3, shape: 1, drag: 2 });
    }
  }

  // ---- geometric effects ----
  shockwave(pos, { color = 0xffa040, radius = 4, life = 0.6, thick = 0.12, vertical = false, normal } = {}) {
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { uColor: { value: new THREE.Color(color).multiplyScalar(3) }, uT: { value: 0 }, uThick: { value: thick } },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);} `,
      fragmentShader: `uniform vec3 uColor; uniform float uT; uniform float uThick; varying vec2 vUv;
        void main(){ float r = length(vUv*2.0-1.0);
          float ring = smoothstep(uThick, 0.0, abs(r - 0.9)) ;
          float inner = smoothstep(0.9, 0.0, r) * 0.25 * (1.0-uT);
          float a = (ring + inner) * (1.0 - uT) * step(r, 1.0);
          gl_FragColor = vec4(uColor * a, a); }`,
    });
    const m = new THREE.Mesh(this.ringGeo, mat);
    m.position.copy(pos);
    if (normal) m.lookAt(pos.clone().add(normal));
    else if (!vertical) m.rotation.x = -Math.PI / 2;
    else m.lookAt(this.camera.position);
    m.renderOrder = 8;
    this.scene.add(m);
    this.rings.push({ m, t: 0, life, radius });
  }

  pillar(pos, color = 0xffa040, h = 8, life = 0.9, r = 0.8) {
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { uColor: { value: new THREE.Color(color).multiplyScalar(2.5) }, uT: { value: 0 } },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);} `,
      fragmentShader: `uniform vec3 uColor; uniform float uT; varying vec2 vUv;
        void main(){ float a = (1.0 - vUv.y) * (1.0 - uT) * (0.5 + 0.5*sin(vUv.x*40.0 + uT*20.0));
          gl_FragColor = vec4(uColor * a, a); }`,
    });
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.2, h, 32, 1, true), mat);
    m.position.set(pos.x, h / 2, pos.z);
    this.scene.add(m);
    this.pillars.push({ m, t: 0, life });
  }

  lightning(from, to, color = 0x9fe8ff, life = 0.3, jag = 0.35) {
    const pts = zigzag(from, to, jag);
    const geo = new LineGeometry();
    geo.setPositions(pts);
    const mat = new LineMaterial({ color: new THREE.Color(color).multiplyScalar(3.5), linewidth: 3.5, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
    mat.resolution.copy(this.lineRes);
    const line = new Line2(geo, mat);
    line.computeLineDistances();
    line.frustumCulled = false;
    this.scene.add(line);
    this.bolts.push({ line, t: 0, life, from: from.clone(), to: to.clone(), jag });
  }

  crack(pos, size = 5, life = 3) {
    const mat = new THREE.MeshBasicMaterial({ map: this.crackTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -4 });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size), mat);
    m.rotation.x = -Math.PI / 2;
    m.rotation.z = Math.random() * Math.PI;
    m.position.set(pos.x, 0.012, pos.z);
    this.scene.add(m);
    this.decals.push({ m, t: 0, life });
  }

  ghost(rig, color = 0xffffff, life = 0.35) {
    const g = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(1.8), transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false });
    for (const m of rig.meshes) {
      if (!m.visible) continue;
      const c = new THREE.Mesh(m.geometry, mat);
      c.matrixAutoUpdate = false;
      c.matrix.copy(m.matrixWorld);
      g.add(c);
    }
    this.scene.add(g);
    this.ghosts.push({ g, mat, t: 0, life });
  }

  dizzy(getPos, duration = 2) {
    const group = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 2.6, 0.5), side: THREE.DoubleSide, toneMapped: false });
    for (let i = 0; i < 4; i++) group.add(new THREE.Mesh(this.starGeo, mat));
    this.scene.add(group);
    this.stars.push({ group, getPos, t: 0, life: duration });
  }

  flashLight(pos, color = 0xffa040, intensity = 60) {
    this.light.position.copy(pos);
    this.light.color.set(color);
    this.lightI = intensity;
  }

  update(dt, rdt) {
    this.add.update(dt);
    this.dust.update(dt);
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.t += dt;
      const k = r.t / r.life;
      const s = r.radius * (0.15 + 0.85 * (1 - Math.pow(1 - Math.min(k, 1), 3)));
      r.m.scale.set(s, s, s);
      r.m.material.uniforms.uT.value = Math.min(k, 1);
      if (k >= 1) { this.scene.remove(r.m); r.m.material.dispose(); this.rings.splice(i, 1); }
    }
    for (let i = this.pillars.length - 1; i >= 0; i--) {
      const r = this.pillars[i];
      r.t += dt;
      const k = r.t / r.life;
      r.m.material.uniforms.uT.value = Math.min(k, 1);
      r.m.scale.x = r.m.scale.z = 1 + k * 0.6;
      if (k >= 1) { this.scene.remove(r.m); r.m.geometry.dispose(); r.m.material.dispose(); this.pillars.splice(i, 1); }
    }
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const b = this.bolts[i];
      b.t += dt;
      if (Math.random() < 0.5) b.line.geometry.setPositions(zigzag(b.from, b.to, b.jag));
      b.line.material.opacity = 1 - b.t / b.life;
      if (b.t >= b.life) { this.scene.remove(b.line); b.line.geometry.dispose(); b.line.material.dispose(); this.bolts.splice(i, 1); }
    }
    for (let i = this.decals.length - 1; i >= 0; i--) {
      const d = this.decals[i];
      d.t += dt;
      d.m.material.opacity = Math.min(1, 2 * (1 - d.t / d.life));
      if (d.t >= d.life) { this.scene.remove(d.m); d.m.geometry.dispose(); d.m.material.dispose(); this.decals.splice(i, 1); }
    }
    for (let i = this.ghosts.length - 1; i >= 0; i--) {
      const g = this.ghosts[i];
      g.t += dt;
      g.mat.opacity = 0.45 * (1 - g.t / g.life);
      if (g.t >= g.life) { this.scene.remove(g.g); g.mat.dispose(); this.ghosts.splice(i, 1); }
    }
    for (let i = this.stars.length - 1; i >= 0; i--) {
      const s = this.stars[i];
      s.t += dt;
      const p = s.getPos();
      s.group.children.forEach((m, k) => {
        const a = s.t * 6 + (k / 4) * Math.PI * 2;
        m.position.set(p.x + Math.cos(a) * 0.25, p.y + 0.22 + Math.sin(s.t * 8 + k) * 0.03, p.z + Math.sin(a) * 0.25);
        m.lookAt(this.camera.position);
      });
      if (s.t >= s.life) { this.scene.remove(s.group); this.stars.splice(i, 1); }
    }
    for (const t of this.trails) t.update(dt, t.headFn ? t.headFn() : null, this.camera);
    this.lightI *= Math.exp(-dt * 6);
    this.light.intensity = this.lightI;
    const sc = this.screen;
    sc.flash *= Math.exp(-rdt * 7);
    sc.aberr *= Math.exp(-rdt * 3);
    sc.speed = Math.max(0, sc.speed - rdt * 1.2);
    sc.tintAmt *= Math.exp(-rdt * 2);
    sc.zoom *= Math.exp(-rdt * 4);
    this.shake *= Math.exp(-rdt * 5);
  }
}

function randDir(v) {
  const u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2;
  const s = Math.sqrt(1 - u * u);
  return v.set(s * Math.cos(a), u, s * Math.sin(a));
}

function zigzag(a, b, jag) {
  const pts = [];
  const n = 12;
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const off = i === 0 || i === n ? 0 : jag * len * 0.15;
    pts.push(
      a.x + dir.x * t + (Math.random() - 0.5) * off * 2,
      a.y + dir.y * t + (Math.random() - 0.5) * off * 2,
      a.z + dir.z * t + (Math.random() - 0.5) * off * 2,
    );
  }
  return pts;
}

// ---------------------------------------------------------------------------
// Screen-space FX pass (vignette, chromatic aberration, speed lines, flash)
// ---------------------------------------------------------------------------
export const ScreenFXShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uFlash: { value: 0 },
    uAberr: { value: 0 },
    uSpeed: { value: 0 },
    uTint: { value: new THREE.Color(1, 1, 1) },
    uTintAmt: { value: 0 },
    uZoom: { value: 0 },
    uAspect: { value: 1.7 },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uTime; uniform float uFlash; uniform float uAberr; uniform float uSpeed;
    uniform vec3 uTint; uniform float uTintAmt; uniform float uZoom; uniform float uAspect;
    varying vec2 vUv;
    float hash(float n){ return fract(sin(n)*43758.5453); }
    void main(){
      vec2 c = vUv - 0.5;
      // radial zoom blur
      vec3 col = vec3(0.0);
      float total = 0.0;
      for (int i = 0; i < 8; i++) {
        float f = float(i) / 7.0;
        vec2 uv = 0.5 + c * (1.0 - uZoom * 0.045 * f);
        float ab = uAberr * 0.012 * length(c);
        vec2 dir = normalize(c + 1e-5);
        vec3 s;
        s.r = texture2D(tDiffuse, uv + dir * ab).r;
        s.g = texture2D(tDiffuse, uv).g;
        s.b = texture2D(tDiffuse, uv - dir * ab).b;
        float w = 1.0 - f * 0.6;
        col += s * w; total += w;
        if (uZoom < 0.01 && i == 0) { total = w; break; }
      }
      col /= total;
      // speed lines
      if (uSpeed > 0.001) {
        vec2 p = c * vec2(uAspect, 1.0);
        float ang = atan(p.y, p.x);
        float r = length(p);
        float id = floor(ang * 60.0 / 3.14159);
        float h = hash(id + floor(uTime * 18.0) * 13.0);
        float line = step(0.72, h) * smoothstep(0.28, 0.75, r) * smoothstep(0.0, 0.02, fract(ang * 60.0 / 3.14159) ) ;
        col = mix(col, vec3(1.0), line * uSpeed * 0.55);
      }
      col = mix(col, col * uTint, uTintAmt);
      // vignette
      float v = smoothstep(0.95, 0.35, length(c * vec2(uAspect * 0.8, 1.0)));
      col *= mix(0.72, 1.0, v);
      col += vec3(1.0, 0.95, 0.9) * uFlash;
      gl_FragColor = vec4(col, 1.0);
    }`,
};
