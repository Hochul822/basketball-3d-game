// Keyboard + touch input. Actions are named; `pressed` is edge-triggered per frame.
const KEYMAP = {
  KeyW: 'up', ArrowUp: 'up',
  KeyS: 'down', ArrowDown: 'down',
  KeyA: 'left', ArrowLeft: 'left',
  KeyD: 'right', ArrowRight: 'right',
  ShiftLeft: 'sprint', ShiftRight: 'sprint',
  KeyJ: 'shoot',
  KeyK: 'pass',
  KeyL: 'oop',
  KeyQ: 'cross',
  KeyE: 'spin',
  KeyR: 'behind',
  KeyC: 'legs',
  KeyF: 'stepback',
  Space: 'special',
  Tab: 'switch',
  KeyP: 'pause', Escape: 'pause',
  KeyM: 'music',
  KeyH: 'help',
};

export class Input {
  constructor() {
    this.down = new Set();
    this.pressedSet = new Set();
    this.releasedSet = new Set();
    this.stick = { x: 0, y: 0, active: false };
    this.enabled = true;
    window.addEventListener('keydown', (e) => {
      const a = KEYMAP[e.code];
      if (!a) return;
      if (['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
      if (!this.down.has(a)) this.pressedSet.add(a);
      this.down.add(a);
    });
    window.addEventListener('keyup', (e) => {
      const a = KEYMAP[e.code];
      if (!a) return;
      if (this.down.has(a)) this.releasedSet.add(a);
      this.down.delete(a);
    });
    window.addEventListener('blur', () => {
      for (const a of this.down) this.releasedSet.add(a);
      this.down.clear();
    });
  }

  isDown(a) { return this.down.has(a); }
  pressed(a) { return this.pressedSet.has(a); }
  released(a) { return this.releasedSet.has(a); }

  endFrame() {
    this.pressedSet.clear();
    this.releasedSet.clear();
  }

  /** Movement vector in screen space: x right, y up. */
  axis() {
    let x = 0, y = 0;
    if (this.down.has('left')) x -= 1;
    if (this.down.has('right')) x += 1;
    if (this.down.has('up')) y += 1;
    if (this.down.has('down')) y -= 1;
    if (this.stick.active) { x += this.stick.x; y += this.stick.y; }
    const l = Math.hypot(x, y);
    if (l > 1) { x /= l; y /= l; }
    return { x, y };
  }

  // ---- touch controls ----
  bindTouch(root) {
    const stickEl = root.querySelector('#stick');
    const knob = root.querySelector('#stick-knob');
    let stickId = null, cx = 0, cy = 0;
    const R = 55;
    const moveStick = (x, y) => {
      let dx = x - cx, dy = y - cy;
      const l = Math.hypot(dx, dy);
      if (l > R) { dx = (dx / l) * R; dy = (dy / l) * R; }
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
      this.stick.x = dx / R;
      this.stick.y = -dy / R;
    };
    stickEl.addEventListener('touchstart', (e) => {
      e.preventDefault();
      const t = e.changedTouches[0];
      stickId = t.identifier;
      const r = stickEl.getBoundingClientRect();
      cx = r.left + r.width / 2;
      cy = r.top + r.height / 2;
      this.stick.active = true;
      moveStick(t.clientX, t.clientY);
    }, { passive: false });
    stickEl.addEventListener('touchmove', (e) => {
      e.preventDefault();
      for (const t of e.changedTouches) if (t.identifier === stickId) moveStick(t.clientX, t.clientY);
    }, { passive: false });
    const end = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === stickId) {
          stickId = null;
          this.stick.active = false;
          this.stick.x = this.stick.y = 0;
          knob.style.transform = '';
        }
      }
    };
    stickEl.addEventListener('touchend', end);
    stickEl.addEventListener('touchcancel', end);
    root.querySelectorAll('[data-act]').forEach((btn) => {
      const a = btn.dataset.act;
      btn.addEventListener('touchstart', (e) => {
        e.preventDefault();
        if (!this.down.has(a)) this.pressedSet.add(a);
        this.down.add(a);
        btn.classList.add('on');
      }, { passive: false });
      const up = (e) => {
        e.preventDefault();
        if (this.down.has(a)) this.releasedSet.add(a);
        this.down.delete(a);
        btn.classList.remove('on');
      };
      btn.addEventListener('touchend', up, { passive: false });
      btn.addEventListener('touchcancel', up, { passive: false });
    });
  }
}
