export interface GarageView {
  name: string;
  klass: string;
  /** Length, width, height in metres. */
  size: readonly [number, number, number];
  note: string;
  index: number;
  total: number;
  quality: string;
}

export interface GarageActions {
  previous(): void;
  next(): void;
  drive(): void;
  quality(value: "low" | "medium" | "high"): void;
}

/**
 * The vehicle-selection panel. The 3D preview is the real vehicle in the
 * world, circled by the camera; this panel only names it and offers choices.
 */
export class Garage {
  private readonly root: HTMLDivElement;
  private readonly name: HTMLHeadingElement;
  private readonly klass: HTMLParagraphElement;
  private readonly size: HTMLParagraphElement;
  private readonly note: HTMLParagraphElement;
  private readonly position: HTMLSpanElement;
  private readonly qualityButtons = new Map<string, HTMLButtonElement>();

  constructor(parent: HTMLElement, actions: GarageActions) {
    const doc = parent.ownerDocument;
    const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text = ""): HTMLElementTagNameMap[K] => {
      const node = doc.createElement(tag);
      node.className = className;
      node.textContent = text;
      return node;
    };
    const button = (text: string, className: string, onClick: () => void, label = text): HTMLButtonElement => {
      const b = el("button", className, text);
      b.type = "button";
      b.setAttribute("aria-label", label);
      b.addEventListener("click", () => {
        onClick();
        b.blur(); // keep the keyboard on the game
      });
      return b;
    };

    this.root = el("div", "or-garage");
    this.root.setAttribute("role", "dialog");
    this.root.setAttribute("aria-label", "Choose your vehicle");
    this.root.hidden = true;
    this.name = el("h2", "or-garage-name");
    this.klass = el("p", "or-garage-class");
    this.size = el("p", "or-garage-size");
    this.note = el("p", "or-garage-note");
    this.position = el("span", "or-garage-position");

    const chooser = el("div", "or-garage-row");
    chooser.append(button("◀", "or-button", actions.previous, "Previous vehicle"), this.position, button("▶", "or-button", actions.next, "Next vehicle"));
    const quality = el("div", "or-garage-row");
    quality.append(el("span", "or-garage-label", "Graphics"));
    for (const value of ["low", "medium", "high"] as const) {
      const b = button(value[0]!.toUpperCase() + value.slice(1), "or-button or-button-small", () => actions.quality(value), `${value} graphics`);
      this.qualityButtons.set(value, b);
      quality.append(b);
    }
    this.root.append(el("p", "or-garage-title", "Choose your vehicle"), this.name, this.klass, this.size, chooser, button("Drive", "or-button or-button-primary", actions.drive), quality, this.note, el("p", "or-garage-keys", "A / D: change · Enter: drive · G: garage"));
    parent.append(this.root);
  }

  show(view: GarageView): void {
    this.root.hidden = false;
    this.name.textContent = view.name;
    this.klass.textContent = view.klass;
    this.size.textContent = `${view.size[0].toFixed(2)} m long · ${view.size[1].toFixed(2)} m wide · ${view.size[2].toFixed(2)} m high`;
    this.note.textContent = view.note;
    this.position.textContent = `${view.index + 1} / ${view.total}`;
    for (const [value, b] of this.qualityButtons) b.setAttribute("aria-pressed", String(value === view.quality));
  }

  hide(): void {
    this.root.hidden = true;
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  dispose(): void {
    this.root.remove();
  }
}
