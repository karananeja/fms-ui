import { useEffect, useRef } from 'react';
import { themeStore } from '@/shared/theme/theme-store';

/** Must match the `street-grid` minor line spacing (index.css). */
const CELL = 48;
const TRAIL = 56;
const TURN_CHANCE = 0.3;
const MAX_DPR = 2;

interface Dot {
  /** Current position in CSS px. */
  x: number;
  y: number;
  /** Unit direction along a grid line: one of (±1, 0) / (0, ±1). */
  dx: number;
  dy: number;
  speed: number;
  /** Index into the current colour list (recoloured in place on a theme change, DS3 §3). */
  tone: number;
  trail: { x: number; y: number }[];
  /** Distance travelled since the last intersection. */
  run: number;
}

const DIRS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

function spawn(w: number, h: number, tones: number): Dot {
  const [dx, dy] = DIRS[Math.floor(Math.random() * 4)]!;
  const x = Math.round((Math.random() * w) / CELL) * CELL;
  const y = Math.round((Math.random() * h) / CELL) * CELL;
  return {
    x,
    y,
    dx,
    dy,
    speed: 40 + Math.random() * 70,
    tone: Math.floor(Math.random() * tones),
    trail: [],
    run: Math.random() * CELL,
  };
}

/**
 * DS2 / D-108: "live ops" backdrop for the auth screens. Vehicle dots travel along the
 * street-grid lines (turning at intersections) and leave fading trails. Canvas 2D, ≤ 26 dots,
 * colours from the DS1 tokens. With `prefers-reduced-motion` it draws one still frame.
 */
export function AuthBackdrop() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    // jsdom (unit tests) has neither matchMedia nor a canvas implementation.
    if (!canvas || typeof window.matchMedia !== 'function') return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let colors: string[] = [];
    const readColors = () => {
      const css = getComputedStyle(document.documentElement);
      const token = (name: string, fallback: string) =>
        css.getPropertyValue(name).trim() || fallback;
      colors = [
        token('--accent', 'teal'),
        token('--accent', 'teal'),
        token('--accent-2', 'skyblue'),
      ];
    };
    readColors();

    let w = 0;
    let h = 0;
    let dots: Dot[] = [];
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const count = Math.max(10, Math.min(26, Math.round((w * h) / 42_000)));
      dots = Array.from({ length: count }, () => spawn(w, h, colors.length));
    };

    const step = (dot: Dot, dt: number) => {
      const d = dot.speed * dt;
      dot.x += dot.dx * d;
      dot.y += dot.dy * d;
      dot.run += d;
      if (dot.run >= CELL) {
        // Snap to the intersection, then maybe turn onto the crossing line.
        dot.run -= CELL;
        dot.x = Math.round(dot.x / CELL) * CELL;
        dot.y = Math.round(dot.y / CELL) * CELL;
        if (Math.random() < TURN_CHANCE) {
          const sign = Math.random() < 0.5 ? 1 : -1;
          [dot.dx, dot.dy] = dot.dx !== 0 ? [0, sign] : [sign, 0];
        }
      }
      dot.trail.push({ x: dot.x, y: dot.y });
      if (dot.trail.length > TRAIL) dot.trail.shift();
      const off = CELL * 2;
      if (dot.x < -off || dot.x > w + off || dot.y < -off || dot.y > h + off) {
        Object.assign(dot, spawn(w, h, colors.length));
      }
    };

    const draw = () => {
      ctx.clearRect(0, 0, w, h);
      ctx.lineCap = 'round';
      for (const dot of dots) {
        const t = dot.trail;
        const color = colors[dot.tone]!;
        for (let k = 1; k < t.length; k++) {
          ctx.globalAlpha = (k / t.length) ** 2 * 0.7;
          ctx.strokeStyle = color;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(t[k - 1]!.x, t[k - 1]!.y);
          ctx.lineTo(t[k]!.x, t[k]!.y);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
        ctx.shadowColor = color;
        ctx.shadowBlur = 12;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(dot.x, dot.y, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
      }
    };

    resize();
    window.addEventListener('resize', resize);
    // DS3: recolour the live dots in place when the theme changes (no respawn).
    const offTheme = themeStore().subscribe(() => {
      readColors();
      if (reduce) draw();
    });
    if (reduce) {
      draw();
      return () => {
        offTheme();
        window.removeEventListener('resize', resize);
      };
    }

    let raf = 0;
    let last = performance.now();
    const frame = (now: number) => {
      // Clamp so a background tab doesn't teleport every dot on return.
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      for (const dot of dots) step(dot, dt);
      draw();
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      offTheme();
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
    };
  }, []);

  return (
    <>
      <canvas
        ref={ref}
        aria-hidden
        data-testid="auth-backdrop"
        className="pointer-events-none fixed inset-0 size-full"
      />
      <div aria-hidden className="auth-radar pointer-events-none fixed inset-0" />
    </>
  );
}
