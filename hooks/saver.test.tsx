import { expect, mock, test } from 'claude-code/testing'

// What a docked pane in a fullscreen terminal measures.
const PANE_PROPS = {
  title: 'saver', isFocused: false, bodyColumns: 48, placement: 'dock' as const,
  scroll: { offset: 0, bodyRows: 30 }, view: {},
}

const decode = (b64: string) => {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  const clean = b64.replace(/=+$/, '')
  const bytes = new Uint8Array(Math.floor((clean.length * 3) / 4))
  let o = 0
  for (let i = 0; i < clean.length; i += 4) {
    const n = (A.indexOf(clean[i]!) << 18) | (A.indexOf(clean[i + 1]!) << 12) | (A.indexOf(clean[i + 2] ?? 'A') << 6) | A.indexOf(clean[i + 3] ?? 'A')
    if (o < bytes.length) bytes[o++] = (n >> 16) & 255
    if (o < bytes.length) bytes[o++] = (n >> 8) & 255
    if (o < bytes.length) bytes[o++] = n & 255
  }
  return new Uint32Array(bytes.buffer)
}

test('a bare pane lists every piece to pick from', async ($, on) => {
  mock.clock(on)
  const drawn = await $.ui.mount({ plugin: 'saver', surface: 'terminal', component: 'Pane', requestId: 'saver', props: PANE_PROPS })
  for (const name of ['lattice', 'mandala', 'eclipse', 'venn', 'columns', 'plusfield', 'loom', 'canopy', 'seed', 'gargantua', 'cycle']) {
    expect(await drawn.find({ type: 'Button', key: name })).toBeDefined()
  }
  expect(await drawn.find({ type: 'Raster' })).toBeUndefined()
})

test('picking a piece turns the list into the animation', async ($, on) => {
  mock.clock(on)
  const drawn = await $.ui.mount({ plugin: 'saver', surface: 'terminal', component: 'Pane', requestId: 'saver', props: PANE_PROPS })
  await drawn.press({ key: 'lattice' })
  expect(await drawn.find({ type: 'Raster', key: 'view' })).toBeDefined()
  expect(await drawn.find({ type: 'Button', key: 'pick' })).toBeDefined()
})

test('the pane draws a Raster of single-width glyphs sized to the pane', async ($, on) => {
  mock.clock(on)
  const drawn = await $.ui.mount({ plugin: 'saver', surface: 'terminal', component: 'Pane', requestId: 'saver', props: PANE_PROPS })
  await drawn.press({ key: 'mandala' })
  const raster = await drawn.find({ type: 'Raster', key: 'view' })
  expect(raster).toBeDefined()
  const { columns, rows, cells } = raster!.props as { columns: number; rows: number; cells: string }
  const words = decode(cells)
  expect(words.length).toBe(columns * rows * 3)
  for (let i = 0; i < words.length; i += 3) {
    expect(words[i]! >= 32 && words[i]! <= 0xffff).toBe(true)
  }
})

test('frames keep coming on the clock', async ($, on) => {
  const clock = mock.clock(on)
  const drawn = await $.ui.mount({ plugin: 'saver', surface: 'terminal', component: 'Pane', requestId: 'saver', props: PANE_PROPS })
  await drawn.press({ key: 'gargantua' })
  await clock.advance(2000)
  await clock.settle()
})
