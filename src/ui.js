import * as THREE from 'three';
import { TEAM_COLORS } from './constants.js';

const $ = (s) => document.querySelector(s);
const _v = new THREE.Vector3();

export class UI {
  constructor(camera) {
    this.camera = camera;
    this.el = {
      hud: $('#hud'),
      s0: $('#score0'), s1: $('#score1'),
      n0: $('#name0'), n1: $('#name1'),
      clock: $('#clock'), shot: $('#shotclock'),
      p0: $('#power0 .fill'), p1: $('#power1 .fill'),
      pw0: $('#power0'), pw1: $('#power1'),
      msg: $('#msg'), big: $('#big'), special: $('#special'),
      pops: $('#pops'), meter: $('#meter'), meterFill: $('#meter .fill'), meterMark: $('#meter .mark'),
      wipe: $('#wipe'), over: $('#over'), poss: $('#poss'), ready: $('#ready'), timing: $('#timing'),
    };
    this.el.n0.textContent = TEAM_COLORS[0].name;
    this.el.n1.textContent = TEAM_COLORS[1].name;
    this.msgT = 0;
    this.pops = [];
    this.meterA = null;
    this.last = {};
  }

  set(k, el, v) {
    if (this.last[k] !== v) { this.last[k] = v; el.textContent = v; }
  }

  message(text, dur = 1.5) {
    const m = this.el.msg;
    m.textContent = text;
    m.classList.remove('show');
    void m.offsetWidth;
    m.classList.add('show');
    this.msgT = dur;
  }

  bigText(text, kind = 'score') {
    const b = this.el.big;
    const span = document.createElement('div');
    span.className = 'bigtext ' + kind;
    span.textContent = text;
    span.dataset.text = text;
    b.appendChild(span);
    setTimeout(() => span.remove(), 1700);
  }

  special(name, team) {
    const s = this.el.special;
    s.innerHTML = '';
    const bar = document.createElement('div');
    bar.className = 'cutin team' + team;
    bar.innerHTML = `<div class="stripe"></div><div class="label"><small>SPECIAL MOVE</small><span data-text="${name}">${name}</span></div>`;
    s.appendChild(bar);
    setTimeout(() => bar.remove(), 1500);
  }

  popText(text, player) {
    const d = document.createElement('div');
    d.className = 'pop';
    d.textContent = text;
    this.el.pops.appendChild(d);
    this.pops.push({ d, p: player, t: 0 });
  }

  scorePop(team, pts) {
    const el = team === 0 ? this.el.s0 : this.el.s1;
    el.classList.remove('bump');
    void el.offsetWidth;
    el.classList.add('bump');
    const d = document.createElement('div');
    d.className = 'scorepop team' + team;
    d.textContent = '+' + pts;
    el.parentElement.appendChild(d);
    setTimeout(() => d.remove(), 1200);
  }

  shotMeter(a) {
    this.meterA = a;
    this.el.meter.classList.add('show');
    this.el.meter.classList.remove('perfect', 'good', 'bad');
    this.el.meterMark.style.bottom = '78%';
  }

  shotResult(timing, q) {
    const m = this.el.meter;
    const cls = timing === 'perfect' ? 'perfect' : q > 0.55 ? 'good' : 'bad';
    m.classList.add(cls);
    const t = this.el.timing;
    t.textContent = timing === 'perfect' ? 'PERFECT!' : timing === 'early' ? (q > 0.55 ? '살짝 빠름' : 'EARLY') : q > 0.55 ? '살짝 늦음' : 'LATE';
    t.className = 'timing show ' + cls;
    setTimeout(() => { m.classList.remove('show'); this.meterA = null; }, 650);
    setTimeout(() => t.classList.remove('show'), 900);
  }

  wipe(cb) {
    const w = this.el.wipe;
    w.classList.remove('run');
    void w.offsetWidth;
    w.classList.add('run');
    setTimeout(cb, 380);
  }

  gameOver(game, win) {
    const o = this.el.over;
    const userWon = win === game.userTeam;
    o.querySelector('.result').textContent = game.demo ? `${TEAM_COLORS[win].name} WIN` : userWon ? 'YOU WIN!' : 'YOU LOSE';
    o.querySelector('.final').textContent = `${game.teams[0].score} : ${game.teams[1].score}`;
    o.classList.toggle('lose', !userWon && !game.demo);
    setTimeout(() => o.classList.add('show'), 1200);
  }

  project(pos) {
    _v.copy(pos).project(this.camera);
    return [(_v.x * 0.5 + 0.5) * window.innerWidth, (-_v.y * 0.5 + 0.5) * window.innerHeight, _v.z < 1];
  }

  update(game, rdt) {
    if (game.state === 'menu') return;
    const t0 = game.teams[0], t1 = game.teams[1];
    this.set('s0', this.el.s0, String(t0.score));
    this.set('s1', this.el.s1, String(t1.score));
    const c = Math.max(0, game.gameClock);
    const clock = game.overtime && c <= 0 ? 'OT' : `${Math.floor(c / 60)}:${String(Math.floor(c % 60)).padStart(2, '0')}`;
    this.set('clock', this.el.clock, clock);
    const sc = Math.max(0, Math.ceil(game.shotClock));
    this.set('shot', this.el.shot, String(sc));
    this.el.shot.classList.toggle('low', sc <= 4 && game.state === 'live');
    this.el.p0.style.width = t0.power * 100 + '%';
    this.el.p1.style.width = t1.power * 100 + '%';
    this.el.pw0.classList.toggle('full', t0.power >= 1);
    this.el.pw1.classList.toggle('full', t1.power >= 1);
    this.el.ready.classList.toggle('show', t0.power >= 1 && !game.demo);
    this.set('poss', this.el.poss, game.offense === 0 ? '◀ 공격' : '공격 ▶');
    this.el.poss.className = 'poss team' + game.offense;

    if (this.msgT > 0) {
      this.msgT -= rdt;
      if (this.msgT <= 0) this.el.msg.classList.remove('show');
    }
    // floating pops
    for (let i = this.pops.length - 1; i >= 0; i--) {
      const p = this.pops[i];
      p.t += rdt;
      _v.copy(p.p.pos);
      _v.y += 2.3 * p.p.S + p.t * 0.8;
      const [x, y, vis] = this.project(_v);
      p.d.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%) scale(${1 + Math.max(0, 0.3 - p.t) * 2})`;
      p.d.style.opacity = vis ? String(Math.max(0, 1 - p.t / 1.1)) : '0';
      if (p.t > 1.1) { p.d.remove(); this.pops.splice(i, 1); }
    }
    // shot meter
    const a = this.meterA;
    const u = game.user;
    if (a && u) {
      _v.copy(u.pos);
      _v.y += 2.3 * u.S;
      const [x, y] = this.project(_v);
      this.el.meter.style.transform = `translate(${x + 46}px, ${y - 20}px)`;
      const fill = Math.min(1, a.t / (a.ideal / 0.78));
      if (!a.released) this.el.meterFill.style.height = fill * 100 + '%';
    }
  }
}
