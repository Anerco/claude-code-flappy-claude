// Flappy Claude: a game in the band above the prompt while a turn runs.
// The band draws a `Client` (game.tsx) that plays on its own; this module
// decides when it shows, keeps the best score and serves `/flappy`.
//
// A run that is in the air when the turn ends keeps the band up until the
// bird lands, then a moment more for the score.

import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { FlappyPost, FlappyProps } from '../types'

const isOn = atom({ plugin: 'flappy-claude', key: 'isOn' } as const, true)
const best = atom({ plugin: 'flappy-claude', key: 'best' } as const, 0)
const isPlaying = atom({ plugin: 'flappy-claude', key: 'isPlaying' } as const, false)

const MAX_COLUMNS = 96
const MAX_SKY = 10
const MIN_SKY = 6
const LINGER_MS = 2500

function asPost(data: unknown): FlappyPost | undefined {
  if (typeof data !== 'object' || data === null) return undefined
  const post = data as Record<string, unknown>
  if (post.kind === 'start') return { kind: 'start' }
  const isOver = post.kind === 'over' && typeof post.score === 'number' && Number.isFinite(post.score)

  return isOver ? { kind: 'over', score: Math.max(0, Math.floor(post.score as number)) } : undefined
}

export const register: Register = on => {
  let run = 0
  let fault: string | undefined

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'flappy',
      description: 'Turn Flappy Claude on or off: it flies above the prompt while Claude works',
      argumentHint: '[on|off|play]',
      immediate: true,
    })
    const stored = await $.store.get('best')
    const isStoredOn = await $.store.get('isOn')
    await update($, best, n => Math.max(n, typeof stored === 'number' ? stored : 0))
    await update($, isOn, () => isStoredOn !== false)

    return next(e)
  })

  on('command.run', { command: 'flappy' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg === 'play') {
      // Practice while idle: the band stays up until a run ends, as after a turn.
      await update($, isOn, () => true)
      await $.store.set('isOn', true)
      await update($, isPlaying, () => true)
      fault = undefined
      return { text: 'Flappy Claude is up above the prompt: click it, then space to flap.' }
    }
    const isNowOn = arg === 'on' ? true : arg === 'off' ? false : !(await read($, isOn))
    await update($, isOn, () => isNowOn)
    await $.store.set('isOn', isNowOn)
    if (!isNowOn) await update($, isPlaying, () => false)
    fault = undefined

    return {
      text: isNowOn
        ? 'Flappy Claude is on: it flies above the prompt while Claude works.'
        : 'Flappy Claude is off. /flappy turns it back on.',
    }
  })

  on('ui.message', async ($, e, next) => {
    const post = e.element === 'flappy' ? asPost(e.data) : undefined
    if (post?.kind === 'start') {
      run += 1
      await update($, isPlaying, () => true)
    }
    if (post?.kind === 'over') {
      const ended = run
      const score = post.score
      const record = await update($, best, n => Math.max(n, score))
      await $.store.set('best', record)
      $.clock.after(LINGER_MS, () => {
        if (run === ended) void update($, isPlaying, () => false)
      })
    }

    return next(e)
  })

  on('ui.fault', ($, e, next) => {
    if (e.element === 'flappy') {
      fault = e.reason
      $.ui.log(`flappy-claude: the game stopped (${e.reason}); /flappy tries again`)
    }

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const shown = await read($, isOn)
    const playing = await read($, isPlaying)
    const record = await read($, best)
    const sky = Math.min(MAX_SKY, e.props.maxRows - 2)
    const isQuiet =
      !shown ||
      fault !== undefined ||
      e.props.hasSurvey ||
      (!e.props.isWorking && !playing) ||
      sky < MIN_SKY ||
      (e.surface !== 'terminal' && e.surface !== 'desktop')
    if (isQuiet) return next(e)

    const { Box, Client } = $.ui.resolve(e)
    const below = await next(e)
    const columns = Math.min(MAX_COLUMNS, e.props.bodyColumns)
    const rows = sky + 2
    const props: FlappyProps = { best: record, isWorking: e.props.isWorking, columns, rows }

    return (
      <Box flexDirection="column">
        <Client key="flappy" module="./game.tsx" width={columns} height={rows} props={props} />
        {below}
      </Box>
    )
  })
}
