/** What the game posts to the hooks module (`surface.post`). */
export type FlappyPost = { kind: 'start' } | { kind: 'over'; score: number }

/** What the hooks module hands the game (`Client` props): the region's size until the surface measures it. */
export type FlappyProps = { best: number; isWorking: boolean; columns: number; rows: number }

declare module 'claude-code' {
  interface PluginState {
    'flappy-claude': {
      /** The `/flappy` switch, kept in `$.store` across sessions. */
      isOn: boolean
      /** Best score, kept in `$.store` across sessions. */
      best: number
      /** A run is in the air: the band stays up after the turn until it ends. */
      isPlaying: boolean
    }
  }
}
