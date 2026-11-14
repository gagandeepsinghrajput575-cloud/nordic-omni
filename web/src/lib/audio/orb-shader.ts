/**
 * Orb shader math, isolated from React.
 *
 * The drawing code lives here so it can be executed head-lessly against a mock
 * CanvasRenderingContext2D (see `web/test/orb-shader.test.ts`). Keeping it out
 * of the component also means the component only owns lifecycle concerns:
 * analyser attachment, motion preference, frame pacing and teardown.
 */

export type VisualizerState = 'idle' | 'speaking' | 'listening' | 'dire_hold' | 'consulting';

export type RGB = readonly [number, number, number];

export interface OrbPalette {
  core: RGB;
  halo: RGB;
  rim: RGB;
  /** Iridescent ramp sampled around the ring. */
  ramp: readonly RGB[];
  /** Baseline energy with no analyser attached, 0..1. */
  rest: number;
}

export const AMBER: RGB = [255, 201, 120];
export const ROSE: RGB = [255, 155, 147];
export const CYAN: RGB = [91, 227, 255];
export const VIOLET: RGB = [169, 140, 255];
export const MINT: RGB = [107, 227, 164];
export const STEEL: RGB = [166, 174, 190];

/** Decorative pigments only. Text never uses these; see the globals.css one. */
export const STATE_PALETTES: Record<VisualizerState, { ramp: readonly RGB[]; rest: number }> = {
  idle: { ramp: [STEEL, VIOLET, STEEL], rest: 0.1 },
  listening: { ramp: [CYAN, VIOLET, MINT], rest: 0.34 },
  speaking: { ramp: [CYAN, VIOLET, [255, 134, 211], MINT], rest: 0.52 },
  consulting: { ramp: [AMBER, VIOLET, AMBER], rest: 0.42 },
  dire_hold: { ramp: [ROSE, AMBER, ROSE], rest: 0.46 },
};

export const TAU = Math.PI * 2;

/**
 * Clamp a value into `[min, max]`.
 *
 * Non-finite input resolves to `min`: a NaN amplitude or a NaN size would
 * otherwise propagate into every `lineTo` on the canvas and blank the frame.
 */
export function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

/** Parse a hex or rgb() custom property. Falls back to the supplied colour. */
export function parseColor(input: string, fallback: RGB): RGB {
  const value = input.trim();
  if (value.startsWith('#')) {
    const hex = value.slice(1);
    const expand = hex.length === 3 ? hex.split('').map((c) => c + c).join('') : hex;
    if (expand.length < 6) return fallback;
    const r = Number.parseInt(expand.slice(0, 2), 16);
    const g = Number.parseInt(expand.slice(2, 4), 16);
    const b = Number.parseInt(expand.slice(4, 6), 16);
    if ([r, g, b].some((channel) => Number.isNaN(channel))) return fallback;
    return [r, g, b];
  }
  const match = value.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i);
  if (match) {
    return [Math.round(Number(match[1])), Math.round(Number(match[2])), Math.round(Number(match[3]))];
  }
  return fallback;
}

export function css(color: RGB, alpha = 1): string {
  return alpha >= 1
    ? `rgb(${color[0]}, ${color[1]}, ${color[2]})`
    : `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${alpha.toFixed(3)})`;
}

export function mix(a: RGB, b: RGB, t: number): RGB {
  const w = clamp(t, 0, 1);
  return [
    Math.round(a[0] + (b[0] - a[0]) * w),
    Math.round(a[1] + (b[1] - a[1]) * w),
    Math.round(a[2] + (b[2] - a[2]) * w),
  ];
}

/** Sample the ramp in 0..1 with wrap-around, so the ring closes seamlessly. */
export function rampAt(ramp: readonly RGB[], t: number): RGB {
  const stops = ramp.length;
  if (stops === 0) return VIOLET;
  const wrapped = ((t % 1) + 1) % 1;
  const scaled = wrapped * stops;
  const index = Math.floor(scaled);
  return mix(ramp[index % stops], ramp[(index + 1) % stops], scaled - index);
}

/**
 * Resolve the palette for a state from already-read theme tokens.
 * Pure, so the component can memoise it on `[state, theme]`.
 */
export function resolvePalette(
  state: VisualizerState,
  tokens: { accent: RGB; secondary: RGB; danger: RGB; warning: RGB; muted: RGB },
): OrbPalette {
  const { accent, secondary, danger, warning, muted } = tokens;
  const base = STATE_PALETTES[state];
  // The first two stops are always theme tokens; any additional decorative
  // stops are carried over from the state's base ramp, which keeps the ramp
  // length (and therefore the ring's gradient cadence) identical to the
  // canonical palette.
  const tail = base.ramp.slice(2);
  let ramp: readonly RGB[];
  switch (state) {
    case 'dire_hold':
      ramp = [danger, warning, ...tail];
      break;
    case 'consulting':
      ramp = [warning, accent, ...tail];
      break;
    case 'idle':
      ramp = [muted, accent, ...tail];
      break;
    case 'listening':
      ramp = [secondary, accent, ...tail];
      break;
    default:
      ramp = [secondary, accent, ...tail];
  }
  return {
    core: ramp[0],
    halo: ramp[1] ?? ramp[0],
    rim: ramp[2] ?? ramp[0],
    ramp,
    rest: base.rest,
  };
}

/**
 * A pre-rendered bloom sprite.
 *
 * Radial gradients are expensive to rebuild, and building one inside a 60fps
 * loop is the classic canvas jank source. This bakes a single soft disc per
 * palette and blits it scaled, which makes the glow free at runtime.
 */
export function createBloom(colour: RGB, resolution = 128): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;
  const sprite = document.createElement('canvas');
  sprite.width = resolution;
  sprite.height = resolution;
  const ctx = sprite.getContext('2d');
  if (!ctx) return null;
  const half = resolution / 2;
  const gradient = ctx.createRadialGradient(half, half, 0, half, half, half);
  gradient.addColorStop(0, css(colour, 0.9));
  gradient.addColorStop(0.32, css(colour, 0.42));
  gradient.addColorStop(0.68, css(colour, 0.12));
  gradient.addColorStop(1, css(colour, 0));
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, resolution, resolution);
  return sprite;
}

export interface OrbFrame {
  size: number;
  dpr: number;
  state: VisualizerState;
  palette: OrbPalette;
  /** 0..1 envelope, already spring-damped by the caller. */
  amplitude: number;
  /** Phase accumulator in radians. */
  phase: number;
  /** Ring rotation in radians. */
  spin: number;
  /** When false, time-varying decoration (needle arc) is omitted. */
  animate: boolean;
  /** Per-band smoothing state; mutated in place across frames. */
  ring: Float32Array;
  /** Raw 0..255 frequency bins, or null when no analyser is attached. */
  bands: Uint8Array | null;
  /** Cached bloom sprite for `palette.halo`. */
  bloom: HTMLCanvasElement | null;
  /** Exponential smoothing factor for this frame's delta. */
  smoothing: number;
}

/**
 * Draw one frame of the orb. Pure with respect to React: all state arrives in
 * `frame`, and every path is closed so a thrown AudioContext or a missing
 * sprite cannot leave a half-drawn canvas.
 */
export function drawOrbFrame(ctx: CanvasRenderingContext2D, frame: OrbFrame): void {
  const { size, dpr, state, palette, amplitude, phase, spin, animate, ring, bands, bloom, smoothing } = frame;
  const centre = size / 2;
  const base = size * 0.255;
  const pulse = 1 + amplitude * 0.13;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, size, size);

  // 1. Bloom, blitted from the cached sprite.
  if (bloom) {
    const glowSize = size * (1.36 + amplitude * 0.34);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.28 + amplitude * 0.5;
    ctx.drawImage(bloom, centre - glowSize / 2, centre - glowSize / 2, glowSize, glowSize);
    ctx.restore();
  }

  // 2. Hairline containment ring: a faint continuous orbit that gives the
  //    instrument its edge without ringing the orb in black.
  ctx.beginPath();
  ctx.arc(centre, centre, base * (1.09 + amplitude * 0.03), 0, TAU);
  ctx.strokeStyle = css(palette.halo, 0.12 + amplitude * 0.1);
  ctx.lineWidth = 1;
  ctx.stroke();

  // 3. Spectrum ring: one radial tick per band, rotating with the orb. Ticks sit
  //    outside the body and grow with real energy.
  ctx.lineCap = 'round';
  for (let i = 0; i < ring.length; i += 1) {
    const t = i / ring.length;
    const angle = t * TAU + spin;
    const falloff = 0.3 + 0.7 * Math.abs(Math.sin(t * Math.PI * 2 + phase * 0.5));
    const raw = bands ? bands[i % bands.length] / 255 : palette.rest * 0.5;
    ring[i] = ring[i] + (raw * falloff - ring[i]) * smoothing;
    const band = ring[i];

    const inner = base * (1.14 + amplitude * 0.06);
    const length = size * (0.014 + band * 0.075);
    const colour = rampAt(palette.ramp, t + spin * 0.05);
    ctx.beginPath();
    ctx.moveTo(centre + Math.cos(angle) * inner, centre + Math.sin(angle) * inner);
    ctx.lineTo(centre + Math.cos(angle) * (inner + length), centre + Math.sin(angle) * (inner + length));
    ctx.strokeStyle = css(colour, 0.2 + band * 0.7);
    ctx.lineWidth = Math.max(1, size * 0.005);
    ctx.stroke();
  }

  // 4. Core body: a closed spline whose radius is modulated per angle, filled
  //    with the full iridescent ramp so the glass actually shifts hue.
  const points = 64;
  ctx.beginPath();
  for (let i = 0; i <= points; i += 1) {
    const t = i / points;
    const angle = t * TAU;
    const wave = Math.sin(angle * 3 + phase * 1.6) * 0.5 + Math.sin(angle * 5 - phase * 1.05) * 0.3;
    const radius = base * pulse + wave * base * (0.028 + amplitude * 0.13);
    const x = centre + Math.cos(angle) * radius;
    const y = centre + Math.sin(angle) * radius;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();

  const body = ctx.createLinearGradient(centre - base, centre - base, centre + base, centre + base);
  body.addColorStop(0, css(rampAt(palette.ramp, 0.08), 0.97));
  body.addColorStop(0.38, css(rampAt(palette.ramp, 0.42), 0.95));
  body.addColorStop(0.72, css(rampAt(palette.ramp, 0.68), 0.93));
  body.addColorStop(1, css(rampAt(palette.ramp, 0.92), 0.9));
  ctx.save();
  ctx.shadowColor = css(palette.halo, 0.6);
  ctx.shadowBlur = size * (0.075 + amplitude * 0.09);
  ctx.fillStyle = body;
  ctx.globalAlpha = state === 'idle' ? 0.55 : 0.96;
  ctx.fill();
  ctx.restore();

  // 5. Depth: a gentle inner shading that reads as glass thickness. The outer
  //    edge stays luminous, so the orb never looks like a dark hole.
  const depth = ctx.createRadialGradient(
    centre - base * 0.32,
    centre - base * 0.4,
    base * 0.08,
    centre,
    centre,
    base * 1.02,
  );
  depth.addColorStop(0, 'rgba(255, 255, 255, 0.16)');
  depth.addColorStop(0.42, 'rgba(255, 255, 255, 0.02)');
  depth.addColorStop(0.8, 'rgba(8, 9, 12, 0.06)');
  depth.addColorStop(1, 'rgba(8, 9, 12, 0.2)');
  ctx.beginPath();
  ctx.arc(centre, centre, base * pulse, 0, TAU);
  ctx.fillStyle = depth;
  ctx.globalAlpha = 1;
  ctx.fill();

  // 6. Specular: a soft, gradient highlight rather than a hard sticker.
  const specular = ctx.createRadialGradient(
    centre - base * 0.34,
    centre - base * 0.42,
    0,
    centre - base * 0.34,
    centre - base * 0.42,
    base * 0.42,
  );
  specular.addColorStop(0, 'rgba(255, 255, 255, 0.42)');
  specular.addColorStop(0.45, 'rgba(255, 255, 255, 0.12)');
  specular.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.beginPath();
  ctx.ellipse(centre - base * 0.34, centre - base * 0.42, base * 0.42, base * 0.24, -Math.PI / 5, 0, TAU);
  ctx.fillStyle = specular;
  ctx.globalAlpha = 0.85;
  ctx.fill();
  ctx.globalAlpha = 1;

  // 7. Rim: a bright hairline that separates the orb from the glass ground.
  ctx.beginPath();
  ctx.arc(centre, centre, base * pulse, 0, TAU);
  ctx.strokeStyle = css(rampAt(palette.ramp, 0.3), 0.4 + amplitude * 0.35);
  ctx.lineWidth = Math.max(1, size * 0.0045);
  ctx.stroke();

  // 8. A second, softer rim just outside, plus a faint caustic lip: the lens
  //    edge that keeps the silhouette luminous against the black glass.
  ctx.beginPath();
  ctx.arc(centre, centre, base * pulse + size * 0.012, 0, TAU);
  ctx.strokeStyle = css(rampAt(palette.ramp, 0.55), 0.22 + amplitude * 0.16);
  ctx.lineWidth = 1;
  ctx.stroke();

  const lip = ctx.createRadialGradient(
    centre,
    centre,
    base * pulse * 0.86,
    centre,
    centre,
    base * pulse * 1.12,
  );
  lip.addColorStop(0, 'rgba(8, 9, 12, 0)');
  lip.addColorStop(0.62, css(rampAt(palette.ramp, 0.2), 0.1 + amplitude * 0.1));
  lip.addColorStop(1, 'rgba(8, 9, 12, 0)');
  ctx.beginPath();
  ctx.arc(centre, centre, base * pulse * 1.12, 0, TAU);
  ctx.fillStyle = lip;
  ctx.fill();

  // 9. A travelling arc: the instrument's needle. Motion only.
  if (animate) {
    const arcStart = spin * 1.9;
    ctx.beginPath();
    ctx.arc(centre, centre, base * pulse + size * 0.062, arcStart, arcStart + TAU * 0.22);
    ctx.strokeStyle = css(palette.core, 0.5);
    ctx.lineWidth = Math.max(1.2, size * 0.009);
    ctx.lineCap = 'round';
    ctx.stroke();
  }

  // 10. Dire hold is an alarm, so it gets a dashed containment ring.
  if (state === 'dire_hold') {
    ctx.save();
    ctx.setLineDash([size * 0.03, size * 0.045]);
    ctx.beginPath();
    ctx.arc(centre, centre, base * pulse + size * 0.1, 0, TAU);
    ctx.strokeStyle = css(ROSE, 0.5);
    ctx.lineWidth = 1.4;
    ctx.stroke();
    ctx.restore();
  }
}
