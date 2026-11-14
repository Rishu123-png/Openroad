/**
 * The DOM overlay drawn on top of the 3D canvas: a status line, a controls
 * hint and a full-screen error message. It knows nothing about Babylon.js.
 */
export class Overlay {
  private readonly status: HTMLDivElement;
  private readonly detail: HTMLDivElement;
  private readonly help: HTMLDivElement;
  private readonly speed: HTMLDivElement;
  private readonly legend: HTMLDivElement;
  private readonly credit: HTMLDivElement;
  private readonly labels: HTMLDivElement;
  private readonly labelPool: HTMLDivElement[] = [];
  private readonly error: HTMLDivElement;
  private readonly errorDetail: HTMLParagraphElement;

  constructor(root: HTMLElement) {
    const doc = root.ownerDocument;

    this.status = doc.createElement("div");
    this.status.className = "or-status";
    this.status.textContent = "Loading OPENROAD…";

    this.detail = doc.createElement("div");
    this.detail.className = "or-detail";

    this.help = doc.createElement("div");
    this.help.className = "or-help";

    this.speed = doc.createElement("div");
    this.speed.className = "or-speed";
    this.speed.hidden = true;

    this.legend = doc.createElement("div");
    this.legend.className = "or-legend";

    this.credit = doc.createElement("div");
    this.credit.className = "or-credit";

    this.labels = doc.createElement("div");
    this.labels.className = "or-labels";

    this.error = doc.createElement("div");
    this.error.className = "or-error";
    this.error.setAttribute("role", "alert");
    this.error.hidden = true;
    const title = doc.createElement("h1");
    title.textContent = "OPENROAD could not start";
    this.errorDetail = doc.createElement("p");
    this.error.append(title, this.errorDetail);

    root.append(this.labels, this.status, this.detail, this.help, this.speed, this.legend, this.credit, this.error);
  }

  setStatus(text: string): void {
    // Avoid touching the DOM when nothing changed.
    if (this.status.textContent !== text) this.status.textContent = text;
  }

  /** Smaller line under the status, for rendering statistics. */
  setDetail(text: string): void {
    if (this.detail.textContent !== text) this.detail.textContent = text;
  }

  /** Speedometer. Whole kilometres per hour, so the DOM changes only when the number does. */
  setSpeed(kmh: number, note = ""): void {
    const text = `${Math.round(kmh)} km/h${note ? ` · ${note}` : ""}`;
    if (this.speed.hidden) this.speed.hidden = false;
    if (this.speed.textContent !== text) this.speed.textContent = text;
  }

  /** Title and colour key of the active debug view; empty hides it. */
  setLegend(text: string): void {
    if (this.legend.textContent !== text) this.legend.textContent = text;
  }

  /** Data credit and data-quality notice, always visible while map data is shown. */
  setCredit(text: string, warning = false): void {
    this.credit.textContent = text;
    this.credit.classList.toggle("or-credit-warning", warning);
  }

  setHelp(text: string): void {
    this.help.textContent = text;
  }

  /**
   * Names of mapped places, floated over the view. `x` and `y` run from 0 to 1
   * across the canvas. Elements are reused, so a steady view costs no DOM work
   * beyond moving them.
   */
  setLabels(labels: ReadonlyArray<{ text: string; kind: string; x: number; y: number; distance: number }>): void {
    for (let i = 0; i < labels.length; i++) {
      const label = labels[i]!;
      let el = this.labelPool[i];
      if (!el) {
        el = this.labels.ownerDocument.createElement("div");
        this.labelPool.push(el);
        this.labels.append(el);
      }
      if (el.textContent !== label.text) el.textContent = label.text;
      const cls = `or-label or-label-${label.kind}`;
      if (el.className !== cls) el.className = cls;
      el.style.left = `${(label.x * 100).toFixed(2)}%`;
      el.style.top = `${(label.y * 100).toFixed(2)}%`;
      el.style.opacity = (label.distance < 120 ? 1 : Math.max(0.25, 1 - (label.distance - 120) / 130)).toFixed(2);
      if (el.hidden) el.hidden = false;
    }
    for (let i = labels.length; i < this.labelPool.length; i++) if (!this.labelPool[i]!.hidden) this.labelPool[i]!.hidden = true;
  }

  showError(message: string): void {
    this.errorDetail.textContent = message;
    this.error.hidden = false;
  }

  hideError(): void {
    this.error.hidden = true;
  }

  dispose(): void {
    this.status.remove();
    this.detail.remove();
    this.help.remove();
    this.speed.remove();
    this.legend.remove();
    this.credit.remove();
    this.labels.remove();
    this.error.remove();
  }
}
