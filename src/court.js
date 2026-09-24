import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { toonMat, toonMesh, addOutline } from './toon.js';
import { asphaltTexture, courtTexture, COURT_TEX, graffitiWallTexture, chainLinkTexture, windowsTexture, brickTexture } from './textures.js';
import { RIM, RIM_R, BOARD, POLE_Z, rand } from './constants.js';

export class Court {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.lampLights = [];
    this.buildSky();
    this.buildGround();
    this.buildHoop();
    this.buildFences();
    this.buildWall();
    this.buildCity();
    this.buildLights();
    this.buildProps();
    this.buildCrowd();
    this.rimShake = 0;
    this.rimVel = 0;
    this.boardGlow = 0;
  }

  buildSky() {
    const geo = new THREE.SphereGeometry(180, 32, 16);
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        top: { value: new THREE.Color(0x07061c) },
        mid: { value: new THREE.Color(0x3b1a5e) },
        hor: { value: new THREE.Color(0xff6b3d) },
        time: { value: 0 },
      },
      vertexShader: `varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `uniform vec3 top; uniform vec3 mid; uniform vec3 hor; uniform float time; varying vec3 vP;
        float hash(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,45.164)))*43758.5453); }
        void main(){
          float h = vP.y;
          vec3 c = mix(hor, mid, smoothstep(-0.02, 0.22, h));
          c = mix(c, top, smoothstep(0.2, 0.75, h));
          // stars
          vec3 q = floor(vP * 260.0);
          float s = hash(q);
          float tw = 0.6 + 0.4*sin(time*2.0 + s*50.0);
          c += vec3(1.0,0.95,0.85) * step(0.9975, s) * smoothstep(0.15, 0.5, h) * tw * 1.4;
          // horizon haze
          c += vec3(1.0,0.45,0.2) * exp(-abs(h)*18.0) * 0.35;
          gl_FragColor = vec4(c, 1.0);
          #include <colorspace_fragment>
        }`,
    });
    this.sky = new THREE.Mesh(geo, mat);
    this.scene.add(this.sky);
    // big moon
    const moon = new THREE.Mesh(new THREE.CircleGeometry(6, 32), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 1.4, 1.2), fog: false }));
    moon.position.set(-60, 55, -120);
    moon.lookAt(0, 0, 0);
    this.scene.add(moon);
  }

  buildGround() {
    const asphalt = toonMat(0xffffff, { map: asphaltTexture(), rim: 0, steps: 4 });
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), asphalt);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.group.add(ground);

    const w = COURT_TEX.maxX - COURT_TEX.minX, h = COURT_TEX.maxZ - COURT_TEX.minZ;
    const courtMat = toonMat(0xffffff, { map: courtTexture(), rim: 0, steps: 4 });
    const court = new THREE.Mesh(new THREE.PlaneGeometry(w, h), courtMat);
    court.rotation.x = -Math.PI / 2;
    court.position.set((COURT_TEX.maxX + COURT_TEX.minX) / 2, 0.004, (COURT_TEX.maxZ + COURT_TEX.minZ) / 2);
    court.receiveShadow = true;
    this.group.add(court);

    // curb around court
    const curbMat = toonMat(0x8a8794, { rim: 0.1 });
    const mk = (sx, sz, x, z) => {
      const m = toonMesh(new THREE.BoxGeometry(sx, 0.12, sz), curbMat, { outline: 0.01 });
      m.position.set(x, 0.06, z);
      this.group.add(m);
    };
    mk(w + 0.4, 0.2, 0, COURT_TEX.minZ - 0.1);
    mk(w + 0.4, 0.2, 0, COURT_TEX.maxZ + 0.1);
    mk(0.2, h, COURT_TEX.minX - 0.1, (COURT_TEX.maxZ + COURT_TEX.minZ) / 2);
    mk(0.2, h, COURT_TEX.maxX + 0.1, (COURT_TEX.maxZ + COURT_TEX.minZ) / 2);
  }

  buildHoop() {
    const g = new THREE.Group();
    this.hoop = g;
    this.group.add(g);
    const poleMat = toonMat(0x2b2f3a, { rim: 0.4, rimColor: 0x9fb8ff });
    const padMat = toonMat(0xe23b3b);
    // pole
    const pole = toonMesh(new THREE.CylinderGeometry(0.12, 0.14, 3.6, 16), poleMat, { outline: 0.014 });
    pole.position.set(0, 1.8, POLE_Z);
    g.add(pole);
    const pad = toonMesh(new RoundedBoxGeometry(0.42, 1.8, 0.42, 3, 0.08), padMat, { outline: 0.014 });
    pad.position.set(0, 0.9, POLE_Z);
    g.add(pad);
    const base = toonMesh(new RoundedBoxGeometry(1.2, 0.3, 1.4, 2, 0.06), poleMat, { outline: 0.014 });
    base.position.set(0, 0.15, POLE_Z - 0.3);
    g.add(base);
    // arm
    const armLen = Math.abs(BOARD.front - BOARD.thick - POLE_Z);
    const arm = toonMesh(new THREE.BoxGeometry(0.14, 0.18, armLen), poleMat, { outline: 0.012 });
    arm.position.set(0, 3.45, POLE_Z + armLen / 2);
    g.add(arm);
    const brace = toonMesh(new THREE.BoxGeometry(0.1, 0.1, armLen * 1.05), poleMat, { outline: 0.012 });
    brace.position.set(0, 3.1, POLE_Z + armLen / 2);
    brace.rotation.x = 0.35;
    g.add(brace);

    // backboard
    const bw = BOARD.halfW * 2, bh = BOARD.top - BOARD.bottom;
    const boardGeo = new RoundedBoxGeometry(bw, bh, BOARD.thick, 2, 0.02);
    const boardMat = new THREE.MeshPhysicalMaterial({ color: 0xcfe8ff, transparent: true, opacity: 0.35, roughness: 0.1, metalness: 0.0, depthWrite: false });
    const board = new THREE.Mesh(boardGeo, boardMat);
    board.position.set(0, (BOARD.top + BOARD.bottom) / 2, BOARD.front - BOARD.thick / 2);
    g.add(board);
    const frameMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.boardFrameMat = frameMat;
    const frame = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(bw, bh, BOARD.thick)), new THREE.LineBasicMaterial({ color: 0xffffff }));
    board.add(frame);
    // border & target square (thin boxes)
    const stripe = (w, h, x, y) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.012), frameMat);
      m.position.set(x, y, BOARD.front + 0.004);
      g.add(m);
    };
    const cy = (BOARD.top + BOARD.bottom) / 2;
    stripe(bw, 0.05, 0, BOARD.top - 0.025);
    stripe(bw, 0.05, 0, BOARD.bottom + 0.025);
    stripe(0.05, bh, -BOARD.halfW + 0.025, cy);
    stripe(0.05, bh, BOARD.halfW - 0.025, cy);
    stripe(0.59, 0.045, 0, BOARD.bottom + 0.15 + 0.45);
    stripe(0.045, 0.45, -0.295 + 0.0225, BOARD.bottom + 0.15 + 0.225);
    stripe(0.045, 0.45, 0.295 - 0.0225, BOARD.bottom + 0.15 + 0.225);
    // neon glow strip around board (blooms)
    const glowMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff5a1f).multiplyScalar(2.2), toneMapped: false });
    this.boardGlowMat = glowMat;
    const glow = new THREE.Mesh(new THREE.BoxGeometry(bw + 0.06, 0.03, 0.03), glowMat);
    glow.position.set(0, BOARD.bottom - 0.02, BOARD.front - 0.02);
    g.add(glow);

    // rim
    const rimGroup = new THREE.Group();
    rimGroup.position.set(0, RIM.y, BOARD.front);
    g.add(rimGroup);
    this.rimGroup = rimGroup;
    const rimMat = toonMat(0xff4a12, { rim: 0.5, rimColor: 0xffd0a0, emissive: 0x3a0800 });
    this.rimMat = rimMat;
    const ring = toonMesh(new THREE.TorusGeometry(RIM_R, 0.011, 10, 40), rimMat, { outline: 0.006 });
    ring.rotation.x = Math.PI / 2;
    ring.position.set(0, 0, RIM.z - BOARD.front);
    rimGroup.add(ring);
    const conn = toonMesh(new THREE.BoxGeometry(0.1, 0.03, 0.16), rimMat, { outline: 0.006 });
    conn.position.set(0, -0.01, 0.07);
    rimGroup.add(conn);
    // net hooks
    this.buildNet();
  }

  buildNet() {
    // Node grid: rings x around
    const rings = 7, around = 12, len = 0.44;
    this.net = { rings, around, len, nodes: [], rest: [], vel: [] };
    for (let r = 0; r < rings; r++) {
      const t = r / (rings - 1);
      const rad = RIM_R * (1 - t * 0.42) - 0.004;
      const y = RIM.y - t * len;
      for (let a = 0; a < around; a++) {
        const ang = ((a + (r % 2) * 0.5) / around) * Math.PI * 2;
        const p = new THREE.Vector3(RIM.x + Math.cos(ang) * rad, y, RIM.z + Math.sin(ang) * rad);
        this.net.nodes.push(p.clone());
        this.net.rest.push(p.clone());
        this.net.vel.push(new THREE.Vector3());
      }
    }
    const idx = [];
    for (let r = 0; r < rings - 1; r++) {
      for (let a = 0; a < around; a++) {
        const i = r * around + a;
        const odd = r % 2;
        const j1 = (r + 1) * around + ((a + (odd ? 1 : 0)) % around);
        const j2 = (r + 1) * around + ((a - (odd ? 0 : 1) + around) % around);
        idx.push(i, j1, i, j2);
      }
    }
    this.net.idx = idx;
    this.netPositions = new Float32Array(idx.length * 3);
    const geo = new LineSegmentsGeometry();
    geo.setPositions(this.netPositions);
    const mat = new LineMaterial({ color: 0xf6f6f6, linewidth: 2.2, worldUnits: false });
    this.netLine = new LineSegments2(geo, mat);
    this.netLine.frustumCulled = false;
    this.group.add(this.netLine);
    this.updateNetGeometry();
  }

  updateNetGeometry() {
    const { idx, nodes } = this.net;
    const arr = this.netPositions;
    for (let k = 0; k < idx.length; k++) {
      const p = nodes[idx[k]];
      arr[k * 3] = p.x; arr[k * 3 + 1] = p.y; arr[k * 3 + 2] = p.z;
    }
    const geo = this.netLine.geometry;
    const buf = geo.attributes.instanceStart.data;
    buf.array.set(arr);
    buf.needsUpdate = true;
    geo.computeBoundingSphere();
  }

  /** Push net nodes away from the ball. */
  netPush(ball, radius, vel) {
    const { nodes, vel: nv } = this.net;
    for (let i = this.net.around; i < nodes.length; i++) {
      const p = nodes[i];
      const dx = p.x - ball.x, dy = p.y - ball.y, dz = p.z - ball.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d < radius + 0.03) {
        const k = (radius + 0.03 - d) / Math.max(d, 1e-4);
        p.x += dx * k; p.z += dz * k; p.y += dy * k * 0.5;
        nv[i].x += vel.x * 0.12 + dx * 2;
        nv[i].y += vel.y * 0.18;
        nv[i].z += vel.z * 0.12 + dz * 2;
      }
    }
  }

  kickNet(power) {
    const { nodes, vel } = this.net;
    for (let i = this.net.around; i < nodes.length; i++) {
      vel[i].x += (Math.random() - 0.5) * power;
      vel[i].z += (Math.random() - 0.5) * power;
      vel[i].y -= Math.random() * power * 0.6;
    }
  }

  buildFences() {
    const tex = chainLinkTexture();
    const makeFence = (len, h, pos, rotY) => {
      const t = tex.clone();
      t.needsUpdate = true;
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(len / 0.45, h / 0.45);
      const m = new THREE.MeshToonMaterial({ map: t, alphaTest: 0.45, side: THREE.DoubleSide, color: 0xffffff });
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(len, h), m);
      plane.position.copy(pos);
      plane.position.y = h / 2;
      plane.rotation.y = rotY;
      plane.castShadow = true;
      this.group.add(plane);
      // posts & top rail
      const postMat = toonMat(0x6b7280, { rim: 0.3 });
      const n = Math.round(len / 3);
      for (let i = 0; i <= n; i++) {
        const post = toonMesh(new THREE.CylinderGeometry(0.05, 0.05, h + 0.1, 8), postMat, { outline: 0.008 });
        const off = -len / 2 + (i / n) * len;
        post.position.set(pos.x + Math.cos(rotY) * off, (h + 0.1) / 2, pos.z - Math.sin(rotY) * off);
        this.group.add(post);
      }
      const rail = toonMesh(new THREE.CylinderGeometry(0.035, 0.035, len, 8), postMat, { outline: 0.006 });
      rail.rotation.z = Math.PI / 2;
      rail.rotation.y = rotY;
      rail.position.set(pos.x, h, pos.z);
      this.group.add(rail);
    };
    makeFence(19, 4, new THREE.Vector3(-10, 0, 4.2), Math.PI / 2);
    makeFence(19, 4, new THREE.Vector3(10, 0, 4.2), -Math.PI / 2);
    makeFence(20, 4, new THREE.Vector3(0, 0, 13.8), Math.PI);
  }

  buildWall() {
    const wallMat = toonMat(0xffffff, { map: graffitiWallTexture(), rim: 0, steps: 3 });
    const wall = new THREE.Mesh(new THREE.BoxGeometry(32, 8, 0.6), [
      toonMat(0x6a3a32, { rim: 0 }), toonMat(0x6a3a32, { rim: 0 }), toonMat(0x4a2a24, { rim: 0 }),
      toonMat(0x4a2a24, { rim: 0 }), wallMat, toonMat(0x4a2a24, { rim: 0 }),
    ]);
    wall.position.set(0, 4, -5.8);
    wall.receiveShadow = true;
    wall.castShadow = true;
    this.group.add(wall);
    addOutline(wall, 0.02);
    // side buildings
    const bmat = toonMat(0xffffff, { map: brickTexture(), rim: 0 });
    for (const s of [-1, 1]) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(10, 14, 12), [bmat, bmat, toonMat(0x2a1a22, { rim: 0 }), bmat, bmat, bmat]);
      b.position.set(s * 21, 7, -3);
      b.receiveShadow = true;
      this.group.add(b);
      addOutline(b, 0.03);
    }
  }

  buildCity() {
    const cols = [0x1b1834, 0x231c3f, 0x161329, 0x2a2048];
    for (let i = 0; i < 46; i++) {
      const a = (i / 46) * Math.PI * 1.25 - Math.PI * 1.12;
      const r = 55 + rand(0, 35);
      const w = rand(6, 14), h = rand(14, 48), d = rand(6, 12);
      const wt = windowsTexture();
      wt.wrapS = wt.wrapT = THREE.RepeatWrapping;
      wt.repeat.set(Math.max(1, w / 8), Math.max(1, h / 16));
      const m = new THREE.MeshToonMaterial({ color: cols[i % cols.length], emissive: 0xffffff, emissiveMap: wt, emissiveIntensity: 1.25 });
      const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
      b.position.set(Math.cos(a) * r, h / 2, Math.sin(a) * r);
      b.lookAt(0, h / 2, 0);
      this.group.add(b);
      if (Math.random() < 0.3) {
        // rooftop beacon
        const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.4, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 0.3, 0.3), toneMapped: false }));
        beacon.position.set(b.position.x, h + 0.6, b.position.z);
        this.group.add(beacon);
      }
    }
  }

  buildLights() {
    const poleMat = toonMat(0x3a3f4b, { rim: 0.3 });
    const spots = [[-9.2, -3.5], [9.2, -3.5], [-9.2, 12.5], [9.2, 12.5]];
    for (const [x, z] of spots) {
      const pole = toonMesh(new THREE.CylinderGeometry(0.09, 0.12, 8, 10), poleMat, { outline: 0.012 });
      pole.position.set(x, 4, z);
      this.group.add(pole);
      const armDir = new THREE.Vector3(-x, 0, 4 - z).normalize();
      const head = toonMesh(new RoundedBoxGeometry(0.9, 0.22, 0.45, 2, 0.06), poleMat, { outline: 0.012, cast: false });
      head.position.set(x + armDir.x * 0.6, 8.05, z + armDir.z * 0.6);
      head.lookAt(head.position.x + armDir.x, 8.05, head.position.z + armDir.z);
      this.group.add(head);
      const bulb = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.05, 0.32), new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 3.2, 2.2), toneMapped: false }));
      bulb.position.copy(head.position);
      bulb.position.y -= 0.12;
      bulb.quaternion.copy(head.quaternion);
      this.group.add(bulb);
      const light = new THREE.SpotLight(0xffc98a, 60, 26, 0.75, 0.6, 1.6);
      light.position.copy(bulb.position);
      light.target.position.set(x * 0.3, 0, z * 0.4 + 2.5);
      this.group.add(light);
      this.group.add(light.target);
      this.lampLights.push(light);
    }
    // neon sign on the wall
    const neon = new THREE.Group();
    const neonMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff2fa8).multiplyScalar(3), toneMapped: false });
    const neon2 = new THREE.MeshBasicMaterial({ color: new THREE.Color(0x35e3ff).multiplyScalar(3), toneMapped: false });
    const t1 = new THREE.Mesh(new THREE.TorusGeometry(0.9, 0.05, 8, 40), neonMat);
    t1.position.set(-8.5, 5.9, -5.45);
    neon.add(t1);
    const t2 = new THREE.Mesh(new THREE.TorusGeometry(0.9, 0.05, 8, 4), neon2);
    t2.position.set(8.5, 5.9, -5.45);
    t2.rotation.z = Math.PI / 4;
    neon.add(t2);
    this.group.add(neon);
    const pl1 = new THREE.PointLight(0xff2fa8, 12, 10, 1.8);
    pl1.position.set(-8.5, 5, -4.5);
    const pl2 = new THREE.PointLight(0x35e3ff, 12, 10, 1.8);
    pl2.position.set(8.5, 5, -4.5);
    this.group.add(pl1, pl2);
    this.neonMats = [neonMat, neon2];
  }

  buildProps() {
    const benchMat = toonMat(0x7b4a2a);
    const metal = toonMat(0x4b5563, { rim: 0.35 });
    for (const [x, z, ry] of [[-9.1, 2, Math.PI / 2], [-9.1, 7, Math.PI / 2], [9.1, 5, -Math.PI / 2]]) {
      const b = new THREE.Group();
      const seat = toonMesh(new RoundedBoxGeometry(2.2, 0.08, 0.45, 2, 0.02), benchMat, { outline: 0.01 });
      seat.position.y = 0.48;
      b.add(seat);
      const back = toonMesh(new RoundedBoxGeometry(2.2, 0.35, 0.06, 2, 0.02), benchMat, { outline: 0.01 });
      back.position.set(0, 0.8, -0.22);
      b.add(back);
      for (const lx of [-0.95, 0.95]) {
        const leg = toonMesh(new THREE.BoxGeometry(0.06, 0.48, 0.4), metal, { outline: 0.008 });
        leg.position.set(lx, 0.24, 0);
        b.add(leg);
      }
      b.position.set(x, 0, z);
      b.rotation.y = ry;
      this.group.add(b);
    }
    // trash can
    const can = toonMesh(new THREE.CylinderGeometry(0.35, 0.3, 0.95, 16), toonMat(0x2f6b3a), { outline: 0.012 });
    can.position.set(9.2, 0.475, -1.5);
    this.group.add(can);
    // boombox on bench
    const boom = new THREE.Group();
    const body = toonMesh(new RoundedBoxGeometry(0.6, 0.32, 0.18, 2, 0.04), toonMat(0x1c1c22), { outline: 0.008 });
    boom.add(body);
    for (const sx of [-0.17, 0.17]) {
      const sp = toonMesh(new THREE.CylinderGeometry(0.09, 0.09, 0.03, 18), toonMat(0x9aa0ad), { outline: 0.005 });
      sp.rotation.x = Math.PI / 2;
      sp.position.set(sx, -0.02, 0.1);
      boom.add(sp);
    }
    boom.position.set(-9.05, 0.7, 6.2);
    boom.rotation.y = Math.PI / 2;
    this.group.add(boom);
    this.boombox = boom;
    // cones
    for (const [x, z] of [[8.6, 10.5], [8.9, 10.9], [-8.7, -1.5]]) {
      const cone = toonMesh(new THREE.ConeGeometry(0.16, 0.45, 14), toonMat(0xff6a00), { outline: 0.008 });
      cone.position.set(x, 0.225, z);
      this.group.add(cone);
    }
    // spare balls rack
    const ballMat = toonMat(0xe8661e);
    for (let i = 0; i < 3; i++) {
      const b = toonMesh(new THREE.SphereGeometry(0.12, 16, 12), ballMat, { outline: 0.008 });
      b.position.set(-8.9 + i * 0.26, 0.12, 10.8);
      this.group.add(b);
    }
  }

  buildCrowd() {
    // Simplified spectators behind the side fences: merged body + two arms
    this.crowd = [];
    const skins = [0x8d5524, 0xc68642, 0xf1c27d, 0x5a3825, 0xe0ac69];
    const shirts = [0xff4d6d, 0x3a86ff, 0xffbe0b, 0x8338ec, 0x06d6a0, 0xf8f9fa, 0x222222];
    const positions = [];
    for (let i = 0; i < 7; i++) positions.push([-11.2 - Math.random() * 1.2, 0.5 + i * 1.8 + Math.random() * 0.6, Math.PI / 2]);
    for (let i = 0; i < 7; i++) positions.push([11.2 + Math.random() * 1.2, 0.2 + i * 1.8 + Math.random() * 0.6, -Math.PI / 2]);
    for (let i = 0; i < 5; i++) positions.push([-6 + i * 3 + Math.random(), 14.8 + Math.random(), Math.PI]);
    for (const [x, z, ry] of positions) {
      const g = new THREE.Group();
      const skin = toonMat(skins[(Math.random() * skins.length) | 0]);
      const shirt = toonMat(shirts[(Math.random() * shirts.length) | 0]);
      const pants = toonMat([0x1f2937, 0x374151, 0x1e3a8a][(Math.random() * 3) | 0]);
      const sc = 0.9 + Math.random() * 0.2;
      const legs = toonMesh(new THREE.CapsuleGeometry(0.13, 0.7, 4, 8), pants, { outline: 0, cast: false });
      legs.position.y = 0.48;
      legs.scale.set(1.2, 1, 0.9);
      g.add(legs);
      const torso = toonMesh(new THREE.CapsuleGeometry(0.2, 0.42, 4, 10), shirt, { outline: 0.012, cast: false });
      torso.position.y = 1.22;
      torso.scale.set(1.05, 1, 0.75);
      g.add(torso);
      const head = toonMesh(new THREE.SphereGeometry(0.13, 14, 10), skin, { outline: 0, cast: false });
      head.position.y = 1.72;
      g.add(head);
      const arms = [];
      for (const s of [-1, 1]) {
        const pivot = new THREE.Group();
        pivot.position.set(s * 0.26, 1.48, 0);
        const arm = toonMesh(new THREE.CapsuleGeometry(0.055, 0.55, 4, 8), shirt, { outline: 0, cast: false });
        arm.position.y = -0.3;
        pivot.add(arm);
        g.add(pivot);
        arms.push(pivot);
      }
      g.position.set(x, 0, z);
      g.rotation.y = ry + (Math.random() - 0.5) * 0.5;
      g.scale.setScalar(sc);
      this.group.add(g);
      this.crowd.push({ g, arms, phase: Math.random() * 10, excite: 0 });
    }
    this.crowdExcite = 0;
  }

  update(dt, time) {
    this.sky.material.uniforms.time.value = time;
    // rim spring
    this.rimVel += (-this.rimShake * 260 - this.rimVel * 9) * dt;
    this.rimShake += this.rimVel * dt;
    this.rimGroup.rotation.x = this.rimShake;
    // board glow
    this.boardGlow = Math.max(0, this.boardGlow - dt * 1.5);
    const gl = 2.2 + this.boardGlow * 6;
    this.boardGlowMat.color.setRGB((1.0) * gl, 0.35 * gl, 0.12 * gl);
    this.rimMat.emissive.setRGB(0.23 + this.boardGlow * 1.6, 0.03 + this.boardGlow * 0.6, 0.0);
    // net physics
    const { nodes, rest, vel, around } = this.net;
    for (let i = around; i < nodes.length; i++) {
      const p = nodes[i], r = rest[i], v = vel[i];
      v.x += (r.x - p.x) * 140 * dt;
      v.y += (r.y - p.y) * 140 * dt;
      v.z += (r.z - p.z) * 140 * dt;
      v.multiplyScalar(Math.exp(-7 * dt));
      p.addScaledVector(v, dt);
    }
    // rim rotation affects top ring: skip for simplicity, update geometry
    this.updateNetGeometry();
    // neon flicker
    const f = 3 * (0.85 + 0.15 * Math.sin(time * 23) * Math.sin(time * 7.1));
    this.neonMats[0].color.setRGB(1 * f, 0.18 * f, 0.66 * f);
    // crowd
    this.crowdExcite = Math.max(0, this.crowdExcite - dt * 0.35);
    for (const c of this.crowd) {
      c.phase += dt * (2 + this.crowdExcite * 8);
      const e = this.crowdExcite;
      c.g.position.y = Math.abs(Math.sin(c.phase)) * (0.03 + e * 0.25);
      c.arms[0].rotation.z = -0.2 - e * 2.6 - Math.sin(c.phase * 1.3) * (0.1 + e * 0.5);
      c.arms[1].rotation.z = 0.2 + e * 2.6 + Math.sin(c.phase * 1.1) * (0.1 + e * 0.5);
    }
  }

  setResolution(w, h) {
    this.netLine.material.resolution.set(w, h);
  }
}
