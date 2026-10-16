import type { On, RenderElement } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

// What a session beneath the plugin answers: its start, the command it
// registers, and an empty band where the engine draws nothing of its own.
function session(on: On, store: Record<string, unknown> = {}) {
  mock.store(on, store)
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('ui.render', { component: 'AbovePrompt' }, () => h('Box', { key: 'engine' }) as RenderElement)

  return mock.clock(on)
}

const SURFACES = ['terminal', 'desktop'] as const

const band = (isWorking: boolean) => ({
  plugin: 'flappy-claude',
  component: 'AbovePrompt' as const,
  props: {
    hasSurvey: false,
    isWorking,
    maxRows: 20,
    bodyColumns: 80,
    scroll: { offset: 0, bodyRows: 19 },
    view: {},
  },
})

const GAME = { type: 'Client', key: 'flappy' }

const flappy = (args: string) => ({
  command: 'flappy',
  args,
  origin: { kind: 'composer' as const },
  presentation: { isFullscreen: true, columns: 120 },
})

test('the game flies above the prompt while Claude works, and not after', async ($, on) => {
  session(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  for (const surface of SURFACES) {
    const working = await $.ui.mount({ ...band(true), surface })
    expect(await working.find(GAME)).toBeDefined()
    expect(await working.find({ in: 'flappy', text: /Flappy Claude/ })).toBeDefined()
    await working.unmount()

    const idle = await $.ui.mount({ ...band(false), surface })
    expect(await idle.find(GAME)).toBeUndefined()
    await idle.unmount()
  }
})

test('space flaps, and a bird left alone lands and ends the run', async ($, on) => {
  session(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...band(true), surface })
    await ui.key({ key: ' ', in: 'flappy' })
    expect(await ui.find({ in: 'flappy', text: /^score 0/ })).toBeDefined()

    await ui.advance(3000)
    expect(await ui.find({ in: 'flappy', text: /✕ score/ })).toBeDefined()
    expect(await ui.find({ in: 'flappy', text: /space to fly again/ })).toBeDefined()

    await ui.key({ key: ' ', in: 'flappy' })
    expect(await ui.find({ in: 'flappy', text: /^score 0/ })).toBeDefined()
    await ui.unmount()
  }
})

test('a click flaps too', async ($, on) => {
  session(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({ ...band(true), surface: 'terminal' })
  await ui.pointer({ type: 'down', x: 10, y: 4, button: 'left', in: 'flappy' })
  expect(await ui.find({ in: 'flappy', text: /^score 0/ })).toBeDefined()
  await ui.unmount()
})

test('a run in the air when the turn ends keeps the band up until it lands', async ($, on) => {
  const clock = session(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({ ...band(true), surface: 'terminal' })
  await ui.post({ kind: 'start' }, { in: 'flappy' })
  await ui.redraw(band(false).props)
  expect(await ui.find(GAME)).toBeDefined()
  expect(await ui.find({ in: 'flappy', text: /Claude is done/ })).toBeDefined()

  await ui.post({ kind: 'over', score: 3 }, { in: 'flappy' })
  expect(await ui.find(GAME)).toBeDefined()
  await clock.advance(2500)
  expect(await ui.find(GAME)).toBeUndefined()
  await ui.unmount()
})

test('the best score comes from the store and only goes up', async ($, on) => {
  session(on, { best: 12 })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({ ...band(true), surface: 'terminal' })
  expect(await ui.find({ in: 'flappy', text: 'best 12' })).toBeDefined()
  await ui.post({ kind: 'start' }, { in: 'flappy' })
  await ui.post({ kind: 'over', score: 15 }, { in: 'flappy' })
  expect(await ui.find({ in: 'flappy', text: 'best 15' })).toBeDefined()
  await ui.post({ kind: 'over', score: 4 }, { in: 'flappy' })
  expect(await ui.find({ in: 'flappy', text: 'best 15' })).toBeDefined()
  await ui.unmount()
})

test('/flappy turns it off and on', async ($, on) => {
  session(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const off = await $.command.run(flappy('off'))
  expect(off.text).toMatch(/off/)
  const hidden = await $.ui.mount({ ...band(true), surface: 'terminal' })
  expect(await hidden.find(GAME)).toBeUndefined()
  await hidden.unmount()

  await $.command.run(flappy(''))
  const shown = await $.ui.mount({ ...band(true), surface: 'terminal' })
  expect(await shown.find(GAME)).toBeDefined()
  await shown.unmount()
})

test('/flappy play shows the game while idle until the run ends', async ($, on) => {
  const clock = session(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  await $.command.run(flappy('play'))
  const ui = await $.ui.mount({ ...band(false), surface: 'terminal' })
  expect(await ui.find(GAME)).toBeDefined()
  await ui.post({ kind: 'start' }, { in: 'flappy' })
  await ui.post({ kind: 'over', score: 1 }, { in: 'flappy' })
  await clock.advance(2500)
  expect(await ui.find(GAME)).toBeUndefined()
  await ui.unmount()
})
