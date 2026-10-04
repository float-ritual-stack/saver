export type SaverPiece = string
export type SaverMode = 'pick' | 'play'

declare module 'claude-code' {
  interface PluginState {
    saver: { piece: SaverPiece; mode: SaverMode }
  }
}
