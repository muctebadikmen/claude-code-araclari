export type OtomatikDevirPhase =
  | 'idle'
  | 'warned'
  | 'handoff_running'
  | 'awaiting_choice'
  | 'done'

export type OtomatikDevirConv = {
  /** The conversation (session id) this record belongs to; a /clear mints a new one. */
  sid: string
  phase: OtomatikDevirPhase
  /** The continuation prompt taken from the handoff reply. */
  prompt?: string
  /** True after [Bekle]: the band is hidden, the prompt kept for /devir gec. */
  bandHidden?: boolean
  /** True for the continuation turn in a fresh chat: it never triggers. */
  grace?: boolean
  /**
   * The exact title of the continuation chat proposed as a card (own_initiative)
   * when the app refused to start it directly; the mod watches for the person
   * to start it and then moves it to top level.
   */
  proposalTitle?: string
}

declare module 'claude-code' {
  interface PluginState {
    'otomatik-devir': { conv: OtomatikDevirConv | null }
  }
}
