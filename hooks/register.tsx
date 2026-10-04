// A side panel that plays generative textmode art while you work.
//   /saver            a list of the pieces to choose from (1-7 to pick)
//   /saver <piece>    play that piece; /saver on plays the last one; /saver off closes the panel
// The session feeds it: tool calls, running subagents, and messages typed while Claude works each
// change the piece (on Echo Lattice: a seed, another pen, a new palette).
import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import { PIECES, encodeRaster } from './pieces/index'
import type { PieceInstance } from './pieces/index'
import type { SaverMode } from '../types'

const PANE = 'saver'
const KEY = 'view'
const FRAME_MS = 33
const NAMES = Object.keys(PIECES)
const piece = atom({ plugin: 'saver', key: 'piece' } as const, 'cycle')
const mode = atom({ plugin: 'saver', key: 'mode' } as const, 'pick' as SaverMode)

// The running animation is regenerable, so it lives in the module: a reload starts it afresh.
let agents = 0
let running: { name: string; cols: number; rows: number; art: PieceInstance; timer: { cancel(): void } } | null = null

function stop() {
  running?.timer.cancel()
  running = null
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'saver',
      description: `Generative art in a side panel. /saver to choose, or /saver ${NAMES.join('|')}|off`,
    })
    return next(e)
  })

  on('command.run', { command: 'saver' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg === 'off') {
      stop()
      try {
        await $.ui.close({ id: PANE })
      } catch (err) {
        return { text: `The saver stopped, but the panel would not close: ${err instanceof Error ? err.message : String(err)}` }
      }
      const still = (await $.ui.panes()).some(p => p.id === PANE)
      return { text: still ? 'The saver stopped, but its panel is still open: close it with ctrl+x x.' : 'Saver closed.' }
    }
    if (arg && arg !== 'on' && !PIECES[arg]) return { text: `No piece "${arg}". Pieces: ${NAMES.join(', ')}.` }
    if (arg && arg !== 'on') await update($, piece, () => arg)
    // Bare /saver shows the list, with the keyboard on it so 1-7 pick straight away.
    await update($, mode, () => (arg ? 'play' : 'pick'))
    await $.ui.open({ id: PANE, title: 'saver', ...(arg ? {} : { focus: true as const }) })
    return { text: arg ? `Saver: ${await read($, piece)}.` : 'Saver: pick a piece with 1-7.' }
  })

  // Claude working is what the drawing feeds on.
  on('tool.call', async ($, e, next) => {
    running?.art.react?.({ kind: 'tool' })
    return next(e)
  })

  on('classic.SubagentStart', async ($, e, next) => {
    agents++
    running?.art.react?.({ kind: 'agents', running: agents })
    return next(e)
  })

  on('classic.SubagentStop', async ($, e, next) => {
    agents = Math.max(0, agents - 1)
    running?.art.react?.({ kind: 'agents', running: agents })
    return next(e)
  })

  // A message typed while a turn runs carries that turn's id.
  on('prompt.submit', async ($, e, next) => {
    if (e.turnId) running?.art.react?.({ kind: 'message' })
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    if (e.surface !== 'terminal') {
      const { Text } = $.ui.resolve(e)
      return <Text dimColor>The saver draws in the terminal only.</Text>
    }
    const { Box, Button, Raster, Text } = $.ui.resolve(e)
    const name = await read($, piece)
    const shown = await read($, mode)
    const close = async () => { stop(); await $.ui.close({ id: PANE }) }

    if (shown === 'pick') {
      stop()
      const choose = (n: string) => async () => {
        await update($, piece, () => n)
        await update($, mode, () => 'play')
      }
      return (
        <Box flexDirection="column">
          <Text bold>Pick a piece</Text>
          <Text dimColor>Tool calls, subagents and your messages while Claude works all change it.</Text>
          <Text> </Text>
          {NAMES.map((n, i) => (
            <Box flexDirection="row">
              <Button key={n} plain hotkey={String(i + 1)} variant={n === name ? 'primary' : undefined} onPress={choose(n)}>{n}</Button>
              <Text dimColor>  {PIECES[n]!.blurb}</Text>
            </Box>
          ))}
          <Text> </Text>
          <Button key="close" plain hotkey="x" dimColor onPress={close}>close</Button>
        </Box>
      )
    }

    // Fill the pane's body, less one row for the controls: tall when docked, short inline above the prompt.
    const cols = Math.max(8, Math.min(512, e.props.bodyColumns))
    const tall = e.props.scroll.bodyRows > 0 ? e.props.scroll.bodyRows : (e.viewport?.rows ?? 30) - 4
    const rows = Math.max(4, Math.min(256, (e.props.placement === 'dock' ? tall : Math.min(tall, 14)) - 1))

    if (!running || running.name !== name || running.cols !== cols || running.rows !== rows) {
      stop()
      const art = (PIECES[name] ?? PIECES.cycle!).create(cols, rows, Math.floor(Math.random() * 1e9), { tint: true, quality: 0.4 })
      art.react?.({ kind: 'agents', running: agents })
      let last = Date.now()
      const timer = $.clock.every(FRAME_MS, () => {
        const now = Date.now()
        art.tick(Math.min((now - last) / 1000, 0.1))
        last = now
        // A refused blit means the pane is gone or redrawn at another size: stop until the next render.
        const gone = () => { if (running?.art === art) stop() }
        void $.ui.blit({ requestId: PANE, key: KEY, cells: encodeRaster(art.cells()) }).then(r => {
          if ('deny' in r && r.deny) gone()
        }, gone)
      })
      running = { name, cols, rows, art, timer }
    }

    return (
      <Box flexDirection="column">
        <Raster key={KEY} columns={cols} rows={rows} cells={encodeRaster(running.art.cells())} />
        <Box flexDirection="row">
          <Button key="pick" plain hotkey="p" dimColor onPress={() => update($, mode, () => 'pick')}>pick</Button>
          <Text dimColor>  </Text>
          <Button key="close" plain hotkey="x" dimColor onPress={close}>close</Button>
          <Text dimColor>   {name}</Text>
        </Box>
      </Box>
    )
  })
}
