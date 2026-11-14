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

    this.error = doc.createElement("div");
    this.error.className = "or-error";
    this.error.setAttribute("role", "alert");
    this.error.hidden = true;
    const title = doc.createElement("h1");
    title.textContent = "OPENROAD could not start";
    this.errorDetail = doc.createElement("p");
    this.error.append(title, this.errorDetail);

    root.append(this.status, this.detail, this.help, this.speed, this.legend, this.credit, this.error);
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
    this.error.remove();
  }
}
