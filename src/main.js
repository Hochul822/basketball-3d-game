import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { Court } from './court.js';
import { Effects, ScreenFXShader } from './effects.js';
import { Audio } from './audio.js';
import { Input } from './input.js';
import { UI } from './ui.js';
import { Game } from './game.js';
import { Tutorial } from './tutorial.js';
import './style.css';

const params = new URLSearchParams(location.search);
const quality = params.get('q') || (matchMedia('(pointer: coarse)').matches ? 'mid' : 'high');

const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, quality === 'high' ? 2 : 1.5));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
document.getElementById('app').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x2a1840, 45, 140);
const camera = new THREE.PerspectiveCamera(48, window.innerWidth / window.innerHeight, 0.1, 400);
camera.position.set(0, 6, 16);

// ---- lights ----
const hemi = new THREE.HemisphereLight(0x9c8cff, 0x3a2430, 1.25);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffd7b0, 2.3);
sun.position.set(-9, 16, 11);
sun.target.position.set(0, 0, 3);
sun.castShadow = true;
sun.shadow.mapSize.set(quality === 'high' ? 4096 : 2048, quality === 'high' ? 4096 : 2048);
sun.shadow.camera.left = -14;
sun.shadow.camera.right = 14;
sun.shadow.camera.top = 14;
sun.shadow.camera.bottom = -14;
sun.shadow.camera.near = 2;
sun.shadow.camera.far = 50;
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.025;
sun.shadow.radius = 2.5;
scene.add(sun, sun.target);
const rimLight = new THREE.DirectionalLight(0x6fb6ff, 1.4);
rimLight.position.set(6, 8, -12);
scene.add(rimLight);

const court = new Court(scene);
const effects = new Effects(scene, camera);
const audio = new Audio();
const input = new Input();
const ui = new UI(camera);
const game = new Game({ scene, camera, court, effects, audio, ui, input });
window.__game = game;
window.__renderer = renderer;

// ---- post processing ----
const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: quality === 'high' ? 4 : 0 });
const composer = new EffectComposer(renderer, rt);
composer.addPass(new RenderPass(scene, camera));
// Guard: a single NaN/Inf pixel would otherwise be smeared by bloom into a black box.
composer.addPass(new ShaderPass({
  uniforms: { tDiffuse: { value: null } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; varying vec2 vUv;
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      if (any(isnan(c)) || any(isinf(c))) c = vec4(0.0, 0.0, 0.0, 1.0);
      gl_FragColor = vec4(clamp(c.rgb, 0.0, 60.0), c.a);
    }`,
}));
const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.5, 0.45, 1.3);
composer.addPass(bloom);
composer.addPass(new OutputPass());
const fx = new ShaderPass(ScreenFXShader);
composer.addPass(fx);
let smaa = null;
if (quality !== 'high') {
  smaa = new SMAAPass(window.innerWidth, window.innerHeight);
  composer.addPass(smaa);
}

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h);
  composer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  effects.setSize(w, h, renderer.getPixelRatio(), camera.fov);
  court.setResolution(w, h);
  fx.uniforms.uAspect.value = w / h;
}
window.addEventListener('resize', resize);
resize();

// ---- menus ----
const title = document.getElementById('title');
let difficulty = 'normal';
document.querySelectorAll('[data-diff]').forEach((b) => {
  b.addEventListener('click', () => {
    difficulty = b.dataset.diff;
    document.querySelectorAll('[data-diff]').forEach((x) => x.classList.toggle('sel', x === b));
    audio.init();
    audio.ui();
  });
});
function startGame(demo = false) {
  audio.init();
  tutDone.classList.remove('show');
  title.classList.add('hide');
  document.getElementById('over').classList.remove('show');
  document.getElementById('hud').classList.add('show');
  document.body.classList.add('playing');
  game.start(difficulty, demo);
}
const TUT_KEY = 'street3on3.tutorialDone';
function tutorialDone() {
  try { return localStorage.getItem(TUT_KEY) === '1'; } catch { return false; }
}
function markTutorialDone() {
  try { localStorage.setItem(TUT_KEY, '1'); } catch { /* storage unavailable */ }
}
const tutDone = document.getElementById('tut-done');
function runTutorial() {
  audio.init();
  title.classList.add('hide');
  tutDone.classList.remove('show');
  document.getElementById('over').classList.remove('show');
  document.getElementById('hud').classList.add('show');
  document.body.classList.add('playing');
  const tut = new Tutorial(game, {
    isTouch,
    onFinish: (skipped) => {
      markTutorialDone();
      if (skipped) { startGame(false); return; }
      game.state = 'tutdone';
      for (const p of game.teams[0].players) if (!p.busy) p.startAction('celebrate');
      tutDone.classList.add('show');
    },
  });
  game.startTutorial(tut);
  ui.bigText('TUTORIAL', 'tip');
}
document.getElementById('tut-skip').addEventListener('click', () => {
  if (game.tutorial) game.tutorial.finish(true);
});
document.getElementById('tut-play').addEventListener('click', () => startGame(false));
document.getElementById('tut-menu').addEventListener('click', () => {
  tutDone.classList.remove('show');
  document.getElementById('tomenu').click();
});
document.getElementById('tutorial').addEventListener('click', () => runTutorial());
document.getElementById('start').addEventListener('click', () => (tutorialDone() ? startGame(false) : runTutorial()));
document.getElementById('demo').addEventListener('click', () => startGame(true));
document.getElementById('again').addEventListener('click', () => startGame(game.demo));
document.getElementById('tomenu').addEventListener('click', () => {
  document.getElementById('over').classList.remove('show');
  document.getElementById('hud').classList.remove('show');
  document.body.classList.remove('playing');
  title.classList.remove('hide');
  game.state = 'menu';
  game.layoutMenu();
});
const pauseEl = document.getElementById('pause');
document.getElementById('resume').addEventListener('click', () => togglePause(false));
function togglePause(v) {
  if (game.state === 'menu') return;
  game.paused = v ?? !game.paused;
  pauseEl.classList.toggle('show', game.paused);
}
const helpEl = document.getElementById('help');
document.getElementById('helpbtn').addEventListener('click', () => helpEl.classList.toggle('show'));

const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
if (isTouch) {
  document.body.classList.add('touch');
  input.bindTouch(document.getElementById('touch'));
}

if (params.get('demo') === '1') startGame(true);

// ---- loop ----
let lastT = performance.now();
let fpsAcc = 0, fpsN = 0;
function frame() {
  requestAnimationFrame(frame);
  const now = performance.now();
  const rdt = Math.min((now - lastT) / 1000, 0.1);
  lastT = now;
  if (input.pressed('pause')) togglePause();
  if (input.pressed('music')) ui.message(audio.toggleMusic() ? '♪ MUSIC ON' : '♪ MUSIC OFF', 0.9);
  if (input.pressed('help')) helpEl.classList.toggle('show');
  if (game.paused) input.endFrame();
  if (!window.__manual) game.update(rdt);
  audio.updateMusic();
  const s = effects.screen;
  fx.uniforms.uTime.value = game.time;
  fx.uniforms.uFlash.value = s.flash;
  fx.uniforms.uAberr.value = s.aberr;
  fx.uniforms.uSpeed.value = Math.min(1, s.speed);
  fx.uniforms.uTint.value.copy(s.tint);
  fx.uniforms.uTintAmt.value = s.tintAmt;
  fx.uniforms.uZoom.value = Math.min(2, s.zoom);
  bloom.strength = 0.5 + s.flash * 0.4;
  composer.render(rdt);
  fpsAcc += rdt; fpsN++;
  if (fpsAcc > 1) { window.__fps = fpsN / fpsAcc; fpsAcc = 0; fpsN = 0; }
}
frame();
