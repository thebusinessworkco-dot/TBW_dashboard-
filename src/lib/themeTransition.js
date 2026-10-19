/* ------------------------------------------------------------------
   Liquid theme switch — the new theme spills out of the toggle as an
   organic, wobbling blob (the same reveal as the reference video).

   It rides on the View Transitions API: the browser snapshots the old
   page, we flip the theme, then grow a morphing clip-path blob on the
   new snapshot. Every keyframe is a closed path with the same number
   of curve commands, so the browser can tween between them smoothly.
   ------------------------------------------------------------------ */

const POINTS = 10
const FRAMES = 30
const WOBBLE = 0.24

const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)

/** Catmull-Rom spline through the points, written as cubic Béziers. */
const smoothClosedPath = (pts) => {
  const n = pts.length
  const f = (v) => v.toFixed(1)
  let d = `M ${f(pts[0][0])} ${f(pts[0][1])}`
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n]
    const p1 = pts[i]
    const p2 = pts[(i + 1) % n]
    const p3 = pts[(i + 2) % n]
    const c1x = p1[0] + (p2[0] - p0[0]) / 6
    const c1y = p1[1] + (p2[1] - p0[1]) / 6
    const c2x = p2[0] - (p3[0] - p1[0]) / 6
    const c2y = p2[1] - (p3[1] - p1[1]) / 6
    d += ` C ${f(c1x)} ${f(c1y)} ${f(c2x)} ${f(c2y)} ${f(p2[0])} ${f(p2[1])}`
  }
  return `${d} Z`
}

export const blobFrames = (x, y, w, h) => {
  const far = Math.max(Math.hypot(x, y), Math.hypot(w - x, y), Math.hypot(x, h - y), Math.hypot(w - x, h - y))
  // the smallest lobe still has to clear the farthest corner on the last frame
  const R = far / (1 - WOBBLE) + 60
  const phase = Array.from({ length: POINTS }, () => Math.random() * Math.PI * 2)
  const spin = Math.random() * Math.PI * 2

  const frames = []
  for (let s = 0; s <= FRAMES; s++) {
    const p = s / FRAMES
    const r = Math.max(2, R * easeInOut(p))
    const t = p * Math.PI * 2.2
    const pts = []
    for (let i = 0; i < POINTS; i++) {
      const a = (i / POINTS) * Math.PI * 2 + spin + p * 0.9
      const k =
        1 +
        WOBBLE *
          (0.55 * Math.sin(2 * a + phase[i] + t) +
            0.3 * Math.sin(3 * a - t * 1.4 + phase[(i + 3) % POINTS]) +
            0.15 * Math.sin(5 * a + t * 0.7))
      pts.push([x + Math.cos(a) * r * k, y + Math.sin(a) * r * k])
    }
    frames.push({ clipPath: `path("${smoothClosedPath(pts)}")` })
  }
  return frames
}

const prefersReducedMotion = () =>
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ||
  document.documentElement.dataset.motion === 'reduced'

/**
 * Run `apply` (which must update the DOM synchronously) inside a liquid
 * reveal centred on (x, y). Falls back to a soft colour cross-fade.
 */
export const liquidSwitch = (x, y, apply) => {
  const root = document.documentElement
  if (!document.startViewTransition || prefersReducedMotion()) {
    root.classList.add('theme-fade')
    apply()
    window.setTimeout(() => root.classList.remove('theme-fade'), 600)
    return
  }

  root.classList.add('liquid-switching')
  const vt = document.startViewTransition(apply)
  vt.ready
    .then(() => {
      root.animate(blobFrames(x, y, window.innerWidth, window.innerHeight), {
        duration: 1150,
        easing: 'linear',
        pseudoElement: '::view-transition-new(root)',
      })
    })
    .catch(() => {})
  vt.finished.finally(() => root.classList.remove('liquid-switching'))
}
