/**
 * Colour + contrast utilities.
 *
 * The design brief calls for at least 4.5:1 on normal text and stronger
 * contrast on small text. Rather than eyeballing it, we compute WCAG 2.1
 * relative luminance at runtime for the handful of places where a colour is
 * chosen dynamically (event chips over an arbitrary category tint), and we
 * ship a script that asserts the static token pairs in `styles/theme.css`.
 */

export interface RGB {
  r: number;
  g: number;
  b: number;
}

export function hexToRgb(hex: string): RGB {
  let h = hex.replace('#', '').trim();
  if (h.length === 3) {
    h = h
      .split('')
      .map((c) => c + c)
      .join('');
  }
  const n = parseInt(h, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function rgbToHex({ r, g, b }: RGB): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

function channel(v: number): number {
  const s = v / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

/** WCAG 2.1 relative luminance. */
export function luminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG contrast ratio, 1…21. */
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

export function meetsAA(fg: string, bg: string, large = false): boolean {
  return contrastRatio(fg, bg) >= (large ? 3 : 4.5);
}

export function meetsAAA(fg: string, bg: string, large = false): boolean {
  return contrastRatio(fg, bg) >= (large ? 4.5 : 7);
}

/**
 * Pick black or white text for an arbitrary background, biased towards the
 * option with the better ratio.
 */
export function readableOn(bg: string): '#FFFFFF' | '#0A0A0C' {
  return contrastRatio('#FFFFFF', bg) >= contrastRatio('#0A0A0C', bg) ? '#FFFFFF' : '#0A0A0C';
}

/** Mix a hex colour towards white/black by `amount` (0–1). */
export function mix(hex: string, target: string, amount: number): string {
  const a = hexToRgb(hex);
  const b = hexToRgb(target);
  return rgbToHex({
    r: a.r + (b.r - a.r) * amount,
    g: a.g + (b.g - a.g) * amount,
    b: a.b + (b.b - a.b) * amount,
  });
}

export function withAlpha(hex: string, alpha: number): string {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * Build a chip pair from a category's solid colour, guaranteeing AA text.
 * Dark theme: dark tinted fill + light tinted text.
 * Light theme: light tinted fill + dark tinted text.
 */
export function chipColors(solid: string, theme: 'dark' | 'light'): { bg: string; fg: string } {
  if (theme === 'dark') {
    const bg = mix(solid, '#0A0A0C', 0.78);
    let fg = mix(solid, '#FFFFFF', 0.62);
    let guard = 0;
    while (contrastRatio(fg, bg) < 4.6 && guard++ < 12) fg = mix(fg, '#FFFFFF', 0.18);
    return { bg, fg };
  }
  const bg = mix(solid, '#FFFFFF', 0.84);
  let fg = mix(solid, '#0A0A0C', 0.52);
  let guard = 0;
  while (contrastRatio(fg, bg) < 4.6 && guard++ < 12) fg = mix(fg, '#0A0A0C', 0.18);
  return { bg, fg };
}

/** Deterministic accent from a hue (0–360) with AA-safe text pairing. */
export function accentFromHue(hue: number, theme: 'dark' | 'light'): string {
  const l = theme === 'dark' ? 62 : 42;
  return hslToHex(hue, theme === 'dark' ? 92 : 88, l);
}

export function hslToHex(h: number, s: number, l: number): string {
  const sn = s / 100;
  const ln = l / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = sn * Math.min(ln, 1 - ln);
  const f = (n: number) => ln - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return rgbToHex({ r: 255 * f(0), g: 255 * f(8), b: 255 * f(4) });
}
