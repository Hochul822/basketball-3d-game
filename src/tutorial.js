import * as THREE from 'three';
import { RIM, distXZ } from './constants.js';

// Each step: what to show, how to set the court up, and what completes it.
// keys: [keyboard label, touch label]
const STEPS = [
  { id: 'move', title: '이동', text: '바닥에 빛나는 링까지 이동하세요.', keys: [['W A S D', '왼쪽 스틱']], setup: 'offense', target: [-3.6, 6.2] },
  { id: 'sprint', title: '스프린트', text: 'Shift를 누른 채로 달려서 다음 링까지 가세요. 드리블하면서도 빠르게 움직일 수 있어요.', keys: [['Shift', 'RUN'], ['W A S D', '스틱']], target: [3.8, 3.2], needSprint: true },
  { id: 'cross', title: '크로스오버', text: '공을 몸 앞으로 튕겨 반대 손으로 옮기는 기술이에요. 수비수 앞에서 쓰면 중심을 무너뜨릴 수 있어요.', keys: [['Q', 'CROSS']], setup: 'offense', action: ['crossover'] },
  { id: 'behind', title: '비하인드 백', text: '등 뒤로 공을 돌려 반대 손으로 받아요. 스틸을 피하기 좋아요.', keys: [['R', 'BEHIND']], action: ['behindBack'] },
  { id: 'legs', title: '레그스루', text: '다리 사이로 공을 통과시켜요. 한 발을 앞으로 내딛으며 방향을 바꿀 준비를 해요.', keys: [['C', '—']], action: ['betweenLegs'], keyboardOnly: true },
  { id: 'spin', title: '스핀무브', text: '공을 보호하며 360도 회전해 수비수를 돌파해요. 이동키를 누른 채 쓰면 그 방향으로 빠져나가요.', keys: [['E', 'SPIN']], action: ['spin'] },
  { id: 'step', title: '스텝백', text: '뒤로 크게 물러나 슛 공간을 만들어요. 스텝백 직후 J를 누르면 바로 슛으로 이어져요.', keys: [['F', 'STEP']], action: ['stepBack'] },
  { id: 'shot', title: '점프슛', text: 'J를 꾹 누르면 점프해요. 머리 옆 게이지가 초록 선에 닿을 때 떼면 PERFECT! 한 골을 넣어보세요.', keys: [['J 누르고 있다가 떼기', 'SHOOT 길게']], setup: 'shooter', score: true, maxTries: 4 },
  { id: 'drive', title: '레이업 · 덩크', text: '골대를 향해 Shift로 달리다가 가까이에서 J! 속도가 붙어 있으면 덩크, 아니면 레이업이 나가요.', keys: [['Shift + W', 'RUN + 스틱'], ['J', 'SHOOT']], setup: 'drive', action: ['layup', 'dunk'], waitAfter: 1.6 },
  { id: 'pass', title: '패스', text: 'K로 팀원에게 패스하세요. 이동키로 받을 팀원 쪽 방향을 누르면 그 팀원에게 가요. 패스하면 조작이 받은 선수로 넘어가요.', keys: [['K', 'PASS']], setup: 'offense', event: 'catch' },
  { id: 'oop', title: '앨리웁', text: 'L로 골밑에 높이 띄워주면 팀원이 공중에서 잡아 그대로 덩크해요.', keys: [['L', 'OOP']], setup: 'oop', event: 'oop', waitAfter: 1.4 },
  { id: 'steal', title: '스틸', text: '이제 수비! 공을 가진 상대에게 가까이 붙어 K로 공을 쳐내세요. 스틸을 시도하면 통과예요.', keys: [['K', 'STEAL'], ['W A S D', '스틱']], setup: 'defense', action: ['steal'] },
  { id: 'block', title: '블록', text: '상대가 곧 슛을 쏴요. 슛 모션이 보이면 J로 점프해 막으세요. 블록을 시도하면 통과예요.', keys: [['J', 'BLOCK']], setup: 'blockDrill', action: ['block'], waitAfter: 1.0 },
  { id: 'special', title: '스페셜 기술', text: 'STREET POWER 게이지가 가득 찼어요! SPACE로 스페셜을 써보세요. 골대 가까이에선 METEOR SLAM, 수비가 붙어 있으면 ANKLE BREAKER, 외곽에서 오픈이면 SUPERNOVA SHOT이 나가요.', keys: [['SPACE', 'SP']], setup: 'special', event: 'special', waitAfter: 3.6 },
];

const _v = new THREE.Vector3();

export class Tutorial {
  constructor(game, { onFinish, isTouch }) {
    this.game = game;
    this.onFinish = onFinish;
    this.isTouch = isTouch;
    this.steps = STEPS.filter((s) => !(isTouch && s.keyboardOnly));
    this.i = -1;
    this.parked = new Set();
    this.frozen = new Set();
    this.el = {
      root: document.getElementById('tut'),
      step: document.querySelector('#tut .tut-step'),
      title: document.querySelector('#tut .tut-title'),
      text: document.querySelector('#tut .tut-text'),
      keys: document.querySelector('#tut .tut-keys'),
      bar: document.querySelector('#tut .tut-bar i'),
      card: document.querySelector('#tut .tut-card'),
      extra: document.querySelector('#tut .tut-extra'),
    };
    // floor target marker
    const col = new THREE.Color(0x7dff6b).multiplyScalar(2.2);
    this.marker = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.45, 0.62, 48), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.9, depthWrite: false, toneMapped: false, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.03;
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 3, 32, 1, true), new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { uColor: { value: col } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'uniform vec3 uColor; varying vec2 vUv; void main(){ float k = clamp(1.0 - vUv.y, 0.0, 1.0); float a = k * k * 0.45; gl_FragColor = vec4(uColor * a, a); }',
    }));
    beam.position.y = 1.5;
    this.marker.add(ring, beam);
    this.marker.visible = false;
    this.ringMesh = ring;
    game.scene.add(this.marker);
  }

  get step() { return this.steps[this.i]; }

  // ---------------------------------------------------------------------
  start() {
    this.el.root.classList.add('show');
    document.body.classList.add('tut');
    this.go(0);
  }

  go(i) {
    this.i = i;
    const s = this.step;
    this.doneT = null;
    this.progress = 0;
    this.tries = 0;
    this.lostT = 0;
    this.sprintT = 0;
    this.drillT = 0;
    if (s.setup) this.setup(s.setup);
    this.marker.visible = !!s.target;
    if (s.target) this.marker.position.set(s.target[0], 0, s.target[1]);
    this.render();
  }

  render() {
    const s = this.step;
    const el = this.el;
    el.step.textContent = `STEP ${this.i + 1} / ${this.steps.length}`;
    el.title.textContent = s.title;
    el.text.textContent = s.text;
    el.keys.innerHTML = s.keys
      .map(([k, t]) => `<kbd>${this.isTouch ? t : k}</kbd>`)
      .join('<span class="plus">+</span>');
    el.bar.style.width = `${(this.i / this.steps.length) * 100}%`;
    el.card.classList.remove('ok');
    el.card.classList.remove('enter');
    void el.card.offsetWidth;
    el.card.classList.add('enter');
    el.extra.textContent = '';
  }

  // ---------------------------------------------------------------------
  cast() {
    const g = this.game;
    const [flash, , kai] = g.teams[0].players;
    const ice = g.teams[1].players[0];
    return { g, flash, kai, ice };
  }

  park(p) {
    this.parked.add(p);
    const x = p.team === 0 ? -8 : 8;
    p.setPosition(x, 11.2 - p.slot * 0.8, 0);
    p.rig.root.visible = false;
    p.grabLock = 1e9;
    p.parked = true;
  }

  setup(kind) {
    const { g, flash, kai, ice } = this.cast();
    for (const p of g.players) { p.rig.root.visible = true; p.grabLock = 0; p.parked = false; }
    this.parked.clear();
    this.frozen.clear();
    for (const p of g.players) if (p !== flash && p !== kai && p !== ice) this.park(p);
    const face = (p) => Math.atan2(RIM.x - p.pos.x, RIM.z - p.pos.z);
    const put = (p, x, z) => { p.setPosition(x, z); p.facing = p.targetFacing = face(p); p.ai.decision = null; p.ai.spot = null; p.ai.spotT = 0; };
    g.ball.shot = null;
    g.ball.pass = null;
    g.offense = 0;
    ice.ai.man = flash;
    let holder = flash;
    let user = flash;
    if (kind === 'offense' || kind === 'special') {
      put(flash, kind === 'special' ? 0.8 : 0, kind === 'special' ? 4.6 : 8);
      put(kai, -4.8, 4.4);
      put(ice, flash.pos.x, flash.pos.z - 1.3);
      if (kind === 'special') g.teams[0].power = 1;
    } else if (kind === 'shooter') {
      put(flash, 0.6, 5.4);
      put(kai, -5, 3);
      put(ice, 5, 6.5);
      this.frozen.add(ice);
    } else if (kind === 'drive') {
      put(flash, 1.2, 8.6);
      put(kai, -5.5, 2);
      put(ice, 5.2, 7.4);
      this.frozen.add(ice);
    } else if (kind === 'oop') {
      put(flash, 0, 7.6);
      put(kai, -2.8, 3.2);
      put(ice, 4.6, 6.2);
      this.frozen.add(ice);
      kai.cutting = true;
    } else if (kind === 'defense' || kind === 'blockDrill') {
      put(ice, 0, kind === 'blockDrill' ? 5.8 : 7.4);
      put(flash, 0, ice.pos.z - 1.4);
      put(kai, -5, 4);
      this.frozen.add(ice);
      holder = ice;
      g.offense = 1;
    }
    g.ball.give(holder, 'dribble');
    g.ball.pos.copy(holder.pos).setY(1);
    g.ball.lastPos.copy(g.ball.pos);
    g.setUser(user);
    g.cam.cine = null;
  }

  /** Called for every player each frame; returns true if the tutorial drives it (no AI). */
  controls(p) {
    if (this.parked.has(p)) { p.move.set(0, 0, 0); return true; }
    if (this.frozen.has(p)) {
      p.move.set(0, 0, 0);
      p.defending = false;
      if (p.hasBall) p.faceTowards(RIM.x, RIM.z);
      else if (this.game.user) p.faceTowards(this.game.user.pos.x, this.game.user.pos.z);
      return true;
    }
    return false;
  }

  // ---------------------------------------------------------------------
  update(dt) {
    const g = this.game;
    const s = this.step;
    const u = g.user;
    const ball = g.ball;
    if (s.id === 'special' && this.doneT === null) g.teams[0].power = 1;
    else if (s.id !== 'special') g.teams[0].power = Math.min(g.teams[0].power, 0.6);
    // marker pulse
    if (this.marker.visible) {
      const k = 1 + 0.08 * Math.sin(g.time * 6);
      this.ringMesh.scale.set(k, k, k);
    }
    if (this.doneT !== null) {
      this.doneT -= g.rdt;
      if (this.doneT <= 0) {
        if (this.i + 1 >= this.steps.length) this.finish(false);
        else this.go(this.i + 1);
      }
      return;
    }
    // location steps
    if (s.target && u) {
      if (s.needSprint && u.sprint && Math.hypot(u.vel.x, u.vel.z) > 5.2) this.sprintT += dt;
      const d = distXZ(u.pos, { x: s.target[0], z: s.target[1] });
      if (d < 0.9 && (!s.needSprint || this.sprintT > 0.25)) this.complete();
      else if (d < 0.9 && s.needSprint) this.hint('Shift를 누른 채로 달려야 해요!');
    }
    // block drill: the shooter keeps shooting
    if (s.setup === 'blockDrill') {
      const ice = this.cast().ice;
      this.drillT += dt;
      if (ice.hasBall && !ice.busy && this.drillT > 2.4) {
        this.drillT = 0;
        g.startShotContext(ice, false);
      }
    }
    // get the ball back to the right player when it is lost
    const offense = s.setup !== 'defense' && s.setup !== 'blockDrill';
    const inFlight = ball.pass || (ball.shot && !ball.shot.scored && !ball.holder);
    const wantTeam = offense ? 0 : 1;
    const ok = ball.holder && ball.holder.team === wantTeam;
    if (ok && offense && ball.holder !== u && !ball.holder.busy && ball.holder.team === 0) {
      // teammate has it: hand control over
      g.setUser(ball.holder);
    }
    if (!ok && !inFlight && !(u && u.busy)) {
      this.lostT += g.rdt;
      if (this.lostT > 1.3) {
        this.lostT = 0;
        const kind = this.currentSetup();
        g.ui.wipe(() => { if (g.tutorial === this) this.setup(kind); });
      }
    } else this.lostT = 0;
  }

  currentSetup() {
    for (let k = this.i; k >= 0; k--) if (this.steps[k].setup) return this.steps[k].setup;
    return 'offense';
  }

  hint(text) {
    if (this.el.extra.textContent !== text) this.el.extra.textContent = text;
  }

  complete() {
    if (this.doneT !== null) return;
    const s = this.step;
    this.doneT = s.waitAfter ?? 0.9;
    this.el.card.classList.add('ok');
    this.el.bar.style.width = `${((this.i + 1) / this.steps.length) * 100}%`;
    this.marker.visible = false;
    this.game.audio.sparkle();
    this.game.ui.popText('NICE!', this.game.user || this.cast().flash);
  }

  onAction(p, name) {
    const s = this.step;
    if (!s || this.doneT !== null || !p.isUser) return;
    if (s.action && s.action.includes(name)) this.complete();
  }

  event(name, data = {}) {
    const s = this.step;
    if (!s || this.doneT !== null) return;
    if (name === 'shot' && s.score && data.p && data.p.isUser) {
      this.tries++;
      if (this.tries >= s.maxTries && !data.make) {
        this.hint('괜찮아요! 연습은 실전에서 계속해봐요.');
        setTimeout(() => this.step === s && this.complete(), 1400);
      }
    }
    if (name === 'score' && s.score) this.complete();
    if (name === 'catch' && s.event === 'catch' && data.pass) this.complete();
    if (name === 'dunk' && s.event === 'oop' && data.oop) this.complete();
    if (name === 'special' && s.event === 'special') this.complete();
  }

  // ---------------------------------------------------------------------
  finish(skipped) {
    const g = this.game;
    this.el.root.classList.remove('show');
    document.body.classList.remove('tut');
    this.marker.visible = false;
    g.scene.remove(this.marker);
    for (const p of g.players) { p.rig.root.visible = true; p.grabLock = 0; p.parked = false; }
    g.tutorial = null;
    this.onFinish?.(skipped);
  }
}
