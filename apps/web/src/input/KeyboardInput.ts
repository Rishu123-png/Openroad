import { DEFAULT_KEY_BINDINGS, type InputAction } from "./InputActions";

type ActionListener = () => void;

/** The parts of a KeyboardEvent this class reads. */
interface KeyEventLike {
  code?: string;
  repeat?: boolean;
  preventDefault?: () => void;
}

/**
 * Translates keyboard events into game actions.
 *
 * - `isDown(action)` reports held state, for continuous controls.
 * - `onPressed(action, fn)` fires once per key press, for one-shot controls.
 *
 * It listens on any EventTarget, so it can be tested without a browser.
 */
export class KeyboardInput {
  /** Key codes currently held, per action (two keys can map to one action). */
  private readonly held = new Map<InputAction, Set<string>>();
  private readonly listeners = new Map<InputAction, Set<ActionListener>>();
  private disposed = false;

  constructor(
    private readonly target: EventTarget,
    private readonly bindings: Readonly<Record<string, InputAction>> = DEFAULT_KEY_BINDINGS,
  ) {
    target.addEventListener("keydown", this.handleKeyDown);
    target.addEventListener("keyup", this.handleKeyUp);
    // Losing focus means we will never see the keyup, so release everything.
    target.addEventListener("blur", this.releaseAll);
  }

  isDown(action: InputAction): boolean {
    return (this.held.get(action)?.size ?? 0) > 0;
  }

  /** @returns a function that removes the listener. */
  onPressed(action: InputAction, listener: ActionListener): () => void {
    let set = this.listeners.get(action);
    if (!set) {
      set = new Set();
      this.listeners.set(action, set);
    }
    set.add(listener);
    return () => set.delete(listener);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.target.removeEventListener("keydown", this.handleKeyDown);
    this.target.removeEventListener("keyup", this.handleKeyUp);
    this.target.removeEventListener("blur", this.releaseAll);
    this.held.clear();
    this.listeners.clear();
  }

  private readonly handleKeyDown = (event: Event): void => {
    const key = event as KeyEventLike;
    const action = key.code ? this.bindings[key.code] : undefined;
    if (!action || !key.code) return;

    // Stop bound keys (arrows, space) from scrolling the page.
    key.preventDefault?.();
    if (key.repeat) return;

    let codes = this.held.get(action);
    if (!codes) {
      codes = new Set();
      this.held.set(action, codes);
    }
    const wasDown = codes.size > 0;
    codes.add(key.code);
    if (!wasDown) {
      for (const listener of this.listeners.get(action) ?? []) listener();
    }
  };

  private readonly handleKeyUp = (event: Event): void => {
    const key = event as KeyEventLike;
    const action = key.code ? this.bindings[key.code] : undefined;
    if (!action || !key.code) return;
    this.held.get(action)?.delete(key.code);
  };

  private readonly releaseAll = (): void => {
    this.held.clear();
  };
}
