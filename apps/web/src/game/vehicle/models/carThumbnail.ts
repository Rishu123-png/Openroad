import { profileAt, type CarSpec, type Rgb3 } from "./carSpecs";

/** A linear-RGB colour as a CSS colour. */
export function cssColor(c: Rgb3): string {
  const channel = (v: number): number => Math.round(Math.pow(Math.max(0, Math.min(1, v)), 1 / 2.2) * 255);
  return `rgb(${channel(c[0])}, ${channel(c[1])}, ${channel(c[2])})`;
}

/**
 * A side view of a vehicle as an SVG drawing, for the garage list.
 *
 * It is drawn from the same profile, belt line, window and wheel figures the
 * 3D model is built from, so the thumbnail cannot show a different vehicle
 * from the one that is driven. Nothing is downloaded.
 */
export function carThumbnail(spec: CarSpec, paint: Rgb3 = spec.paint): string {
  const extra = spec.rearExtra ?? 0;
  const bodyLength = spec.length - extra;
  const scale = 100 / 4.8; // every vehicle at the same scale, so sizes compare
  const X = (metres: number): string => ((metres + (4.8 - spec.length) / 2) * scale).toFixed(1);
  const Y = (metres: number): string => ((1.95 - metres) * scale).toFixed(1);
  const xAt = (t: number): number => extra + t * bodyLength;
  const frontAxle = spec.length - spec.frontOverhang, rearAxle = frontAxle - spec.wheelbase;
  const R = spec.wheelRadius;

  const samples = 48;
  const outline: string[] = [];
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    outline.push(`${X(xAt(t))},${Y(profileAt(spec.top, t))}`);
  }
  const floor = spec.clearance + 0.04;
  outline.push(`${X(xAt(1))},${Y(floor + 0.1)}`, `${X(xAt(1) - 0.12)},${Y(floor)}`, `${X(xAt(0) + 0.12)},${Y(floor)}`, `${X(xAt(0))},${Y(floor + 0.1)}`);

  const upper: string[] = [], lower: string[] = [];
  const [w0, w1] = spec.sideWindows;
  for (let i = 0; i <= 24; i++) {
    const t = w0 + ((w1 - w0) * i) / 24;
    const top = profileAt(spec.top, t);
    const belt = Math.min(profileAt(spec.belt, t), top - 0.035);
    const glassTop = Math.max(belt, top - 0.14);
    upper.push(`${X(xAt(t))},${Y(glassTop)}`);
    lower.push(`${X(xAt(t))},${Y(belt)}`);
  }
  const pillars = spec.pillars.map((t) => {
    const top = profileAt(spec.top, t), belt = profileAt(spec.belt, t);
    return `<line x1="${X(xAt(t))}" y1="${Y(belt)}" x2="${X(xAt(t))}" y2="${Y(top - 0.14)}" stroke="${cssColor(paint)}" stroke-width="1.6"/>`;
  });
  const wheel = (x: number): string =>
    `<circle cx="${X(x)}" cy="${Y(R)}" r="${((R + 0.06) * scale).toFixed(1)}" fill="#0b0f15"/>` +
    `<circle cx="${X(x)}" cy="${Y(R)}" r="${(R * scale).toFixed(1)}" fill="#1c2026"/>` +
    `<circle cx="${X(x)}" cy="${Y(R)}" r="${(R * 0.62 * scale).toFixed(1)}" fill="${spec.wheelStyle === "steel" ? "#4b5158" : "#a9b1ba"}"/>`;
  const spare = spec.spare ? `<rect x="${X(0)}" y="${Y(profileAt(spec.belt, 0) - 0.02)}" width="${(extra * scale).toFixed(1)}" height="${(R * 1.9 * scale).toFixed(1)}" rx="1.5" fill="#1c2026"/>` : "";
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 ${(1.95 * scale).toFixed(1)}" role="img" aria-label="${spec.name}, side view">` +
    spare +
    `<polygon points="${outline.join(" ")}" fill="${cssColor(paint)}" stroke="rgba(255,255,255,0.35)" stroke-width="0.5" stroke-linejoin="round"/>` +
    `<polygon points="${[...upper, ...lower.reverse()].join(" ")}" fill="#141b24"/>` +
    pillars.join("") +
    wheel(rearAxle) + wheel(frontAxle) +
    `</svg>`
  );
}
