/**
 * The DOM overlay drawn on top of the 3D canvas: a status line, a controls
 * hint and a full-screen error message. It knows nothing about Babylon.js.
 */
export class Overlay {
  private readonly status: HTMLDivElement;
  private readonly help: HTMLDivElement;
  private readonly error: HTMLDivElement;
  private readonly errorDetail: HTMLParagraphElement;

  constructor(root: HTMLElement) {
    const doc = root.ownerDocument;

    this.status = doc.createElement("div");
    this.status.className = "or-status";
    this.status.textContent = "Loading OPENROAD…";

    this.help = doc.createElement("div");
    this.help.className = "or-help";

    this.error = doc.createElement("div");
    this.error.className = "or-error";
    this.error.setAttribute("role", "alert");
    this.error.hidden = true;
    const title = doc.createElement("h1");
    title.textContent = "OPENROAD could not start";
    this.errorDetail = doc.createElement("p");
    this.error.append(title, this.errorDetail);

    root.append(this.status, this.help, this.error);
  }

  setStatus(text: string): void {
    // Avoid touching the DOM when nothing changed.
    if (this.status.textContent !== text) this.status.textContent = text;
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
    this.help.remove();
    this.error.remove();
  }
}
