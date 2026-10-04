# saver

Generative textmode art for Claude Code and the terminal.

`/saver` opens a side panel that plays an animation while Claude works.
What happens in the session changes it:

- each tool call
- each running subagent
- each message you type while Claude is mid-turn

The same pieces also run as a full-screen terminal screen saver.

## Install

In Claude Code:

```
/plugin marketplace add float-ritual-stack/saver
/plugin install saver@saver
```

Or from a shell:

```sh
claude plugin marketplace add float-ritual-stack/saver
claude plugin install saver@saver
```

## Use

| Command | What it does |
| --- | --- |
| `/saver` | Opens a list of the pieces. Press a piece's key (1–9, 0, then letters) to play it. |
| `/saver <piece>` | Plays that piece straight away. |
| `/saver on` | Plays the last piece again. |
| `/saver off` | Closes the panel. |

While a piece plays, `p` goes back to the list and `x` closes the panel.
The panel needs the keyboard for those keys: click it, or press ctrl+x tab.

The panel draws in the terminal only.
In fullscreen mode, 110 columns or wider, it docks beside the transcript.
Narrower, it sits above the prompt.

## Pieces

| Piece | What it is |
| --- | --- |
| lattice | Echoes grow outward from seeds, dot to dot, mirrored. |
| mandala | A mirrored mandala of hatched bands, inked stroke by stroke. Wide bands hold charms: bracketed diamonds, forks, and letters that mirror into b d p q. |
| eclipse | Ruled lines that break and shift around drifting shapes. |
| venn | Dotted circles, hatching, and a field of plus marks. |
| columns | Graduated boxes and bundles of coloured lines. |
| plusfield | Plus marks over drifting colour regions. Pluses on a border lose the arms that cross it. |
| loom | Outlined bars, filled solid, with a window of boxes rolling along them as a wave. |
| canopy | Op-art stripes in square rings flowing into a drifting vanishing point, woven with a zigzag and lit magenta, blue and red. |
| seed | A flower of life drawn circle by circle, with dotwork shading, a nested triangle frame and a turning triskele. |
| gargantua | A black hole, ray-traced one character cell at a time. |
| cycle | Each of the others in turn, a minute and a half apiece. |

Most pieces come from dot-grid marker drawings in a journal; canopy and seed come from tattoos and a striped canopy.
They keep the drawings' rules: the pen moves dot to dot, lines echo lines, and everything mirrors.

## What changes them

| Piece | A tool call | Each running subagent | Your message mid-turn |
| --- | --- | --- | --- |
| lattice | plants a seed | adds a pen: faster echoes and more sprouts | recolours the drawing and plants a star |
| mandala, columns | the pen speeds up briefly | the pen draws faster | starts a new page |
| eclipse, venn | the wandering shape jumps | adds a drifting shape | changes the inks |
| plusfield | the regions swell | adds a colour region | changes the colours |
| loom | the wave speeds up | adds another wave | re-inks the loom |
| canopy | the stripes flow faster | adds a vanishing point whose rings interfere | turns the lights |
| seed | scatters fresh dotwork | opens another ring of circles | reverses the triskele and changes its colour |
| gargantua | the disk flares | the disk spins faster and hotter | the camera swings |

## Terminal screen saver

`tty/saver.ts` runs any piece full-screen, with [Bun](https://bun.sh):

```sh
bun tty/saver.ts                     # cycle through every piece; any key exits
bun tty/saver.ts --piece gargantua   # one piece
bun tty/saver.ts --play              # p: tool call, a/A: subagents, m: message, space: new seed, q: quit
bun tty/saver.ts --text              # never use graphics
```

Strokes stay real terminal text, in the terminal's own font.
Where the terminal supports the Kitty graphics protocol (kitty, Ghostty, Herdr with `kitty_graphics` on), a soft glow image sits under the text.
Elsewhere, the glow becomes tinted cell backgrounds.

To start it when tmux has been idle for five minutes:

```
set -g lock-after-time 300
set -g lock-command "bun /path/to/saver/tty/saver.ts --text"
```

## Layout

| Path | What it holds |
| --- | --- |
| `hooks/pieces/` | The pieces. Plain TypeScript with no Node or DOM, shared by the panel and the terminal saver. |
| `hooks/register.tsx` | The Claude Code mod: the panel, the picker, and the session events. |
| `tty/saver.ts` | The terminal screen saver. |

## Tests

```sh
bun test tty/pieces.spec.ts       # every piece, through every event, draws only cells the panel accepts
claude plugin test .              # the panel and the picker
claude plugin validate .
```
