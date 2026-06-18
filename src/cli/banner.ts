// CAMBRIAN wordmark banner (figlet "ANSI Shadow" font).
// Static string so the CLI keeps zero runtime dependencies.

const ART = [
  ' ██████╗ █████╗ ███╗   ███╗██████╗ ██████╗ ██╗ █████╗ ███╗   ██╗',
  '██╔════╝██╔══██╗████╗ ████║██╔══██╗██╔══██╗██║██╔══██╗████╗  ██║',
  '██║     ███████║██╔████╔██║██████╔╝██████╔╝██║███████║██╔██╗ ██║',
  '██║     ██╔══██║██║╚██╔╝██║██╔══██╗██╔══██╗██║██╔══██║██║╚██╗██║',
  '╚██████╗██║  ██║██║ ╚═╝ ██║██████╔╝██║  ██║██║██║  ██║██║ ╚████║',
  ' ╚═════╝╚═╝  ╚═╝╚═╝     ╚═╝╚═════╝ ╚═╝  ╚═╝╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝',
];

const RESET = '\x1b[0m';
const fg = (r: number, g: number, b: number) => `\x1b[38;2;${r};${g};${b}m`;

// Cambrian brand palette (sampled from cambrian.org).
const LEAF = fg(95, 168, 74); // bright leaf green (logo / primary button)
const CREAM = fg(232, 224, 196); // warm cream accent
// Vertical forest→leaf ramp for the gradient style.
const RAMP = [
  fg(46, 84, 38),
  fg(58, 108, 46),
  fg(72, 132, 56),
  fg(88, 156, 68),
  fg(104, 176, 80),
  fg(120, 196, 92),
];

const FILL = '█';

export type BannerStyle = 'leaf' | 'duo' | 'gradient' | 'none';

/** Solid brand green. */
function styleLeaf(): string {
  return `${LEAF}${ART.join('\n')}${RESET}`;
}

/** Green fill glyphs + cream shadow glyphs (plays to the ANSI Shadow font). */
function styleDuo(): string {
  return ART
    .map((line) =>
      Array.from(line)
        .map((ch) => {
          if (ch === ' ') return ch;
          return ch === FILL ? `${LEAF}${ch}` : `${CREAM}${ch}`;
        })
        .join(''),
    )
    .join('\n') + RESET;
}

/** Vertical forest→leaf gradient, one shade per row. */
function styleGradient(): string {
  return ART.map((line, i) => `${RAMP[i] ?? LEAF}${line}`).join('\n') + RESET;
}

/**
 * The CAMBRIAN wordmark. Pass `'none'` (or set when NO_COLOR / non-TTY) for
 * the plain uncolored art.
 */
export function banner(style: BannerStyle = 'gradient'): string {
  switch (style) {
    case 'none':
      return ART.join('\n');
    case 'leaf':
      return styleLeaf();
    case 'duo':
      return styleDuo();
    case 'gradient':
    default:
      return styleGradient();
  }
}
