// The game itself: a surface module drawn by the `Client` the band holds.
// It runs on the drawing thread with its own frame clock, keys and pointer,
// so play never waits on the hooks module; it posts a run's start and its
// score, which the hooks module keeps as the best.
//
// The field is cells: a HUD row, the sky, a ground row. The bird is Claude's
// spark, spinning through the spinner's glyphs; physics is in rows per tick.

import type {
  ClientKeyEvent,
  ClientModule,
  ClientPointerEvent,
  ClientSurface,
  RenderElement,
  RenderNode,
} from 'claude-code'

import type { FlappyPost, FlappyProps } from '../types'

const TICK_MS = 50
const GRAVITY = 0.11
const FLAP = -0.68
const MAX_FALL = 0.85
const PIPE_WIDTH = 4
const PIPE_SPACING = 22
const BIRD_X = 8
const FIRST_PIPE = 30
const COOLDOWN_TICKS = 12
const SPARKS = ['✢', '✳', '✶', '✻', '✽', '✻', '✶', '✳']
const FLAP_KEYS = new Set([' ', 'space', 'up', 'return', 'w', 'k'])

const PIPE_SHADES = ['#9be26a', '#5fb236', '#4c9a2a', '#3a7a1f']
const CAP = '#7ccc4a'
const SAND = '#d6b26b'
const STRIPE = '#a8823f'

type Phase = 'ready' | 'playing' | 'over'
type Pipe = { x: number; gapTop: number; isScored: boolean }

type Game = {
  phase: Phase
  tick: number
  y: number
  vy: number
  spin: number
  pipes: readonly Pipe[]
  score: number
  best: number
  seed: number
  overAt: number
  scrolled: number
}

type State = { game: Game }
type Field = { width: number; sky: number; gap: number }
type Cell = { ch: string; fg?: string; bg?: string; bold?: boolean; dim?: boolean }

function field(surface: ClientSurface<State>, props: FlappyProps): Field {
  const width = Math.max(20, surface.columns || props.columns)
  const sky = Math.max(4, (surface.rows || props.rows) - 2)

  return { width, sky, gap: Math.max(3, Math.round(sky * 0.42)) }
}

// mulberry32: the next value in [0, 1) and the next seed.
function random(seed: number): [number, number] {
  const next = (seed + 0x6d2b79f5) | 0
  let r = Math.imul(next ^ (next >>> 15), 1 | next)
  r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r

  return [((r ^ (r >>> 14)) >>> 0) / 4294967296, next]
}

function fresh(best: number, f: Field, seed: number): Game {
  return {
    phase: 'ready',
    tick: 0,
    y: f.sky / 2 - 0.5,
    vy: 0,
    spin: 0,
    pipes: [],
    score: 0,
    best,
    seed,
    overAt: 0,
    scrolled: 0,
  }
}

function withPipe(g: Game, x: number, f: Field): Game {
  const [r, seed] = random(g.seed)
  const low = 1
  const high = Math.max(low, f.sky - f.gap - 1)
  const previous = g.pipes.at(-1)?.gapTop
  const from = previous === undefined ? low : Math.max(low, previous - 3)
  const to = previous === undefined ? high : Math.min(high, previous + 3)
  const gapTop = from + Math.floor(r * (to - from + 1))

  return { ...g, seed, pipes: [...g.pipes, { x, gapTop, isScored: false }] }
}

function launch(g: Game, f: Field): Game {
  const started = { ...fresh(g.best, f, g.seed), phase: 'playing' as const, vy: FLAP, y: g.y }

  return withPipe(started, Math.min(f.width + 1, BIRD_X + FIRST_PIPE), f)
}

type Hit = 'cap' | number | undefined

// What pipe covers a cell: a cap, a body column's shade index, or nothing.
function pipeAt(pipes: readonly Pipe[], col: number, row: number, f: Field): Hit {
  for (const pipe of pipes) {
    const left = Math.round(pipe.x)
    const isGap = row >= pipe.gapTop && row < pipe.gapTop + f.gap
    if (isGap) continue
    const isCapRow = row === pipe.gapTop - 1 || row === pipe.gapTop + f.gap
    if (isCapRow && col >= left - 1 && col <= left + PIPE_WIDTH) return 'cap'
    if (col >= left && col < left + PIPE_WIDTH) return col - left
  }

  return undefined
}

function step(g: Game, f: Field): Game {
  const tick = g.tick + 1

  if (g.phase === 'ready') {
    // The wait before the first flap stirs the seed, so no two runs match.
    const y = f.sky / 2 - 0.5 + Math.sin(tick / 4) * 0.6
    return { ...g, tick, y, seed: random(g.seed)[1], spin: g.spin + 0.25, scrolled: g.scrolled + 0.8 }
  }

  if (g.phase === 'over') {
    const floor = f.sky - 1
    const isSettled = g.y >= floor && tick - g.overAt > COOLDOWN_TICKS
    if (isSettled) return g
    const vy = Math.min(MAX_FALL, g.vy + GRAVITY)
    return { ...g, tick, vy, y: Math.min(floor, g.y + vy) }
  }

  const speed = 0.8 + Math.min(0.4, g.score * 0.02)
  const vy = Math.min(MAX_FALL, g.vy + GRAVITY)
  const rose = g.y + vy
  const y = Math.max(0, rose)
  let score = g.score
  const pipes = g.pipes
    .map(pipe => ({ ...pipe, x: pipe.x - speed }))
    .filter(pipe => pipe.x + PIPE_WIDTH + 1 >= 0)
    .map(pipe => {
      const isPast = !pipe.isScored && Math.round(pipe.x) + PIPE_WIDTH < BIRD_X
      if (isPast) score += 1
      return isPast ? { ...pipe, isScored: true } : pipe
    })
  let next: Game = {
    ...g,
    tick,
    y,
    vy: rose < 0 ? 0 : vy,
    spin: g.spin + (vy < 0 ? 1 : 0.34),
    pipes,
    score,
    scrolled: g.scrolled + speed,
  }
  const last = next.pipes.at(-1)
  if (last === undefined || last.x <= f.width - PIPE_SPACING) {
    next = withPipe(next, (last?.x ?? f.width) + PIPE_SPACING, f)
  }

  const isGrounded = y > f.sky - 1
  const isHit = pipeAt(next.pipes, BIRD_X, Math.round(Math.min(y, f.sky - 1)), f) !== undefined
  if (isGrounded || isHit) {
    return { ...next, phase: 'over', overAt: tick, best: Math.max(g.best, score), y: Math.min(y, f.sky - 1) }
  }

  return next
}

function flapped(g: Game, f: Field): Game {
  if (g.phase === 'ready') return launch(g, f)
  if (g.phase === 'playing') return { ...g, vy: FLAP }
  if (g.tick - g.overAt < COOLDOWN_TICKS) return g

  return launch({ ...g, y: f.sky / 2 - 0.5 }, f)
}

function sky(g: Game, f: Field, row: number, col: number): Cell {
  const hit = pipeAt(g.pipes, col, row, f)
  if (hit === 'cap') return { ch: ' ', bg: CAP }
  if (hit !== undefined) return { ch: ' ', bg: PIPE_SHADES[hit] }
  const far = col + Math.floor(g.scrolled * 0.25)
  let mix = Math.imul(far, 374761393) ^ Math.imul(row + 1, 668265263)
  mix = Math.imul(mix ^ (mix >>> 13), 1274126177)
  const isStar = ((mix ^ (mix >>> 16)) >>> 0) % 47 === 0

  return isStar ? { ch: '·', fg: 'subtle' } : { ch: ' ' }
}

function bird(g: Game, behind: Cell): Cell {
  const ch = g.phase === 'over' ? '✶' : (SPARKS[Math.floor(g.spin) % SPARKS.length] ?? '✻')

  return { ch, fg: g.phase === 'over' ? 'error' : 'claude', bg: behind.bg, bold: true }
}

function ground(g: Game, col: number): Cell {
  const isStripe = (col + Math.floor(g.scrolled)) % 3 === 0

  return { ch: isStripe ? '╱' : ' ', fg: STRIPE, bg: SAND }
}

function sameLook(a: Cell, b: Cell): boolean {
  return a.fg === b.fg && a.bg === b.bg && a.bold === b.bold && a.dim === b.dim
}

// One row of cells as one Text, a nested Text per run of one look.
function line(cells: readonly Cell[], surface: ClientSurface<State>, key: string): RenderNode {
  const { Text } = surface.elements
  const runs: { look: Cell; text: string }[] = []
  for (const cell of cells) {
    const run = runs.at(-1)
    if (run !== undefined && sameLook(run.look, cell)) run.text += cell.ch
    else runs.push({ look: cell, text: cell.ch })
  }

  return (
    <Text key={key} wrap="truncate">
      {runs.map(({ look, text }) =>
        look.fg === undefined && look.bg === undefined ? (
          text
        ) : (
          <Text color={look.fg} backgroundColor={look.bg} bold={look.bold} dimColor={look.dim}>
            {text}
          </Text>
        ),
      )}
    </Text>
  )
}

function hud(g: Game, f: Field, props: FlappyProps, surface: ClientSurface<State>): RenderNode {
  const { Box, Text } = surface.elements
  const best = Math.max(g.best, props.best)
  const hint = f.width >= 64 ? '  click to play · space flaps · esc to type' : '  click, then space'
  const left =
    g.phase === 'ready' ? (
      <Text>
        <Text color="claude" bold>
          ✻ Flappy Claude
        </Text>
        <Text dimColor>{hint}</Text>
      </Text>
    ) : g.phase === 'playing' ? (
      <Text bold>score {g.score}</Text>
    ) : (
      <Text>
        <Text color="error" bold>
          ✕ score {g.score}
        </Text>
        {g.score > 0 && g.score >= best ? <Text color="success">  new best!</Text> : ''}
        <Text dimColor>{g.tick - g.overAt >= COOLDOWN_TICKS ? '  space to fly again' : ''}</Text>
      </Text>
    )
  const right = (
    <Text>
      <Text dimColor>best {best}</Text>
      {props.isWorking ? '' : <Text color="success">  ✓ Claude is done</Text>}
    </Text>
  )

  return (
    <Box key="hud" flexDirection="row" justifyContent="space-between">
      {left}
      {right}
    </Box>
  )
}

function draw(g: Game, props: FlappyProps, surface: ClientSurface<State>): RenderElement {
  const { Box } = surface.elements
  const f = field(surface, props)
  const birdRow = Math.round(Math.min(g.y, f.sky - 1))
  const rows: RenderNode[] = []
  for (let row = 0; row < f.sky; row += 1) {
    const cells: Cell[] = []
    for (let col = 0; col < f.width; col += 1) {
      const cell = sky(g, f, row, col)
      cells.push(row === birdRow && col === BIRD_X ? bird(g, cell) : cell)
    }
    rows.push(line(cells, surface, `sky${row}`))
  }
  const soil: Cell[] = []
  for (let col = 0; col < f.width; col += 1) soil.push(ground(g, col))

  return (
    <Box flexDirection="column">
      {hud(g, f, props, surface)}
      {rows}
      {line(soil, surface, 'ground')}
    </Box>
  )
}

const FlappyClaude: ClientModule<FlappyProps, State> = (props, surface) => {
  if (surface.state === undefined) {
    const post = (data: FlappyPost) => surface.post(data)
    // The size props only stand in until the surface lays the region out.
    const act = (fn: (g: Game, f: Field) => Game) => {
      const before = surface.state?.game
      if (before === undefined) return
      const after = fn(before, field(surface, props))
      if (after === before) return
      if (after.phase === 'playing' && before.phase !== 'playing') post({ kind: 'start' })
      if (after.phase === 'over' && before.phase !== 'over') post({ kind: 'over', score: after.score })
      surface.setState({ game: after })
    }
    surface.every(TICK_MS, () => act(step))
    surface.onKey((event: ClientKeyEvent) => {
      if (FLAP_KEYS.has(event.key)) act(flapped)
    })
    surface.onPointer((event: ClientPointerEvent) => {
      if (event.type === 'down' && event.button !== 'right') act(flapped)
    })
    const seed = Math.floor(Math.random() * 2 ** 31)
    const game = fresh(props.best, field(surface, props), seed)
    surface.setState({ game })
    return draw(game, props, surface)
  }

  return draw(surface.state.game, props, surface)
}

export default FlappyClaude
