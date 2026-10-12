/**
 * Keyboard + mouse input with Pointer Lock handling.
 * Gameplay reads polled state each frame; edges are cleared in endFrame().
 */
const GAME_KEYS = new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'ShiftLeft', 'ShiftRight', 'KeyR', 'KeyE', 'KeyC',
  'Digit1', 'Digit2', 'Digit3', 'Tab', 'KeyV', 'KeyF', 'ControlLeft', 'KeyQ', 'KeyM', 'KeyH',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
]);

export class Input {
  readonly keys = new Set<string>();
  private pressed = new Set<string>();
  private released = new Set<string>();
  mouseDX = 0;
  mouseDY = 0;
  wheel = 0;
  readonly buttons = [false, false, false];
  private buttonPressed = [false, false, false];
  private buttonReleased = [false, false, false];

  /** True while gameplay should consume input (set by Game). */
  gameplayActive = false;
  /** When true, mouse look works without pointer lock (automation / fallback). */
  allowUnlockedLook = false;
  locked = false;
  private lastUnlockTime = -10000;

  onPauseRequest: (() => void) | null = null;
  onLockChange: ((locked: boolean) => void) | null = null;
  onDebugToggle: (() => void) | null = null;

  private element: HTMLElement;
  private disposers: Array<() => void> = [];

  constructor(element: HTMLElement) {
    this.element = element;
    const on = <K extends keyof WindowEventMap>(
      target: Window | Document | HTMLElement,
      type: K | string,
      fn: (e: never) => void,
      opts?: AddEventListenerOptions,
    ) => {
      target.addEventListener(type, fn as EventListener, opts);
      this.disposers.push(() => target.removeEventListener(type, fn as EventListener, opts));
    };

    on(window, 'keydown', (e: KeyboardEvent) => {
      if (e.code === 'F3') {
        e.preventDefault();
        this.onDebugToggle?.();
        return;
      }
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA')) {
        if (e.code !== 'Tab' && e.code !== 'Escape') return;
      }
      if (this.gameplayActive && GAME_KEYS.has(e.code)) e.preventDefault();
      if (e.code === 'Tab') {
        e.preventDefault();
        if (!e.repeat) this.onPauseRequest?.();
        return;
      }
      if (e.code === 'Escape' && !this.locked && !e.repeat) {
        // When the pointer is locked the browser consumes Escape and we get pointerlockchange instead.
        this.onPauseRequest?.();
        return;
      }
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
    });
    on(window, 'keyup', (e: KeyboardEvent) => {
      if (this.keys.has(e.code)) this.released.add(e.code);
      this.keys.delete(e.code);
    });
    on(window, 'blur', () => this.releaseAll());
    on(document, 'visibilitychange', () => {
      if (document.hidden) this.releaseAll();
    });

    on(element, 'mousedown', (e: MouseEvent) => {
      if (e.button > 2) return;
      if (!this.locked && !this.allowUnlockedLook) return;
      e.preventDefault();
      if (!this.buttons[e.button]) this.buttonPressed[e.button] = true;
      this.buttons[e.button] = true;
    });
    on(window, 'mouseup', (e: MouseEvent) => {
      if (e.button > 2) return;
      if (this.buttons[e.button]) this.buttonReleased[e.button] = true;
      this.buttons[e.button] = false;
    });
    on(element, 'contextmenu', (e: MouseEvent) => e.preventDefault());
    on(window, 'mousemove', (e: MouseEvent) => {
      if (!this.locked && !this.allowUnlockedLook) return;
      // Ignore absurd spikes some browsers emit right after locking.
      if (Math.abs(e.movementX) > 400 || Math.abs(e.movementY) > 400) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    });
    on(element, 'wheel', (e: WheelEvent) => {
      if (!this.gameplayActive) return;
      e.preventDefault();
      this.wheel += Math.sign(e.deltaY);
    }, { passive: false });
    on(document, 'pointerlockchange', () => {
      const was = this.locked;
      this.locked = document.pointerLockElement === this.element;
      if (!this.locked) {
        this.lastUnlockTime = performance.now();
        this.releaseAll();
      }
      if (was !== this.locked) this.onLockChange?.(this.locked);
    });
    on(document, 'pointerlockerror', () => {
      this.locked = false;
      this.onLockChange?.(false);
    });
  }

  /** Ask the browser for pointer lock. Must be called from a user gesture. */
  requestLock(): Promise<boolean> {
    if (this.locked) return Promise.resolve(true);
    // Chrome refuses re-locking for ~1s after a user-initiated unlock.
    const since = performance.now() - this.lastUnlockTime;
    if (since < 1100) return Promise.resolve(false);
    try {
      const res = this.element.requestPointerLock?.({ unadjustedMovement: false } as never) as unknown;
      if (res && typeof (res as Promise<void>).then === 'function') {
        return (res as Promise<void>).then(() => true).catch(() => false);
      }
      return Promise.resolve(true);
    } catch {
      return Promise.resolve(false);
    }
  }

  exitLock(): void {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  isDown(code: string): boolean {
    return this.keys.has(code);
  }
  wasPressed(code: string): boolean {
    return this.pressed.has(code);
  }
  wasReleased(code: string): boolean {
    return this.released.has(code);
  }
  mouseDown(button: number): boolean {
    return this.buttons[button];
  }
  mousePressed(button: number): boolean {
    return this.buttonPressed[button];
  }

  /** Synthetic helpers used by automated tests / debug tooling. */
  injectLook(dx: number, dy: number): void {
    this.mouseDX += dx;
    this.mouseDY += dy;
  }
  injectButton(button: number, down: boolean): void {
    if (down && !this.buttons[button]) this.buttonPressed[button] = true;
    if (!down && this.buttons[button]) this.buttonReleased[button] = true;
    this.buttons[button] = down;
  }

  releaseAll(): void {
    for (const k of this.keys) this.released.add(k);
    this.keys.clear();
    for (let i = 0; i < 3; i++) {
      if (this.buttons[i]) this.buttonReleased[i] = true;
      this.buttons[i] = false;
    }
  }

  endFrame(): void {
    this.pressed.clear();
    this.released.clear();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.wheel = 0;
    for (let i = 0; i < 3; i++) {
      this.buttonPressed[i] = false;
      this.buttonReleased[i] = false;
    }
  }

  dispose(): void {
    this.exitLock();
    for (const d of this.disposers) d();
    this.disposers = [];
  }
}
