export type OtomatikDevirPhase =
  | 'idle'
  /** The threshold tripped: running work drains, the handoff file gets written, the child starts. */
  | 'handoff_running'
  /** The file is written but no typed turn was open: the person's next message opens the child. */
  | 'ready'
  /** The child started; `devredildi:<sid>` keeps a second one from starting. */
  | 'done'

export type OtomatikDevirConv = {
  /** The conversation (session id) this record belongs to; a /clear mints a new one. */
  sid: string
  phase: OtomatikDevirPhase
  /** This handoff's id: `<sid first 8>-<clock ms base36>`. */
  handoffId?: string
  /** Clock ms when the handoff was claimed; the file must be newer. */
  handoffAt?: number
  /** The handoff file, `<cwd>/.workflow/handoff/<sid>.md`. */
  file?: string
  /** The continuation chat's title ("<this title> (devam)") and this chat's id. */
  title?: string
  selfId?: string
  /** This chat's effort, model and permission mode (noted, never passed to start_session). */
  effort?: string
  model?: string
  permissionMode?: string
  /** The session the model started for this handoff. */
  startedId?: string
  /** A start_session of the model's is in flight (one at a time). */
  starting?: string
  /** The main turn the handoff instruction rode on through a typed message. */
  instructedTurn?: string
  /** The instruction rides on a submitted message: the next main turn is the instructed one. */
  instructNext?: boolean
  /** No typed turn is open for the handoff: start_session cannot run until the person types. */
  isGateClosed?: boolean
  /** `/devir simdi`: due whatever the fill. */
  isForced?: boolean
  /** The person's message that opens the child; appended to its prompt as its first job. */
  pendingMessage?: string
  /** The machine turn that got the closed-turn text (once per turn). */
  notedTurn?: string
  /** `/devir dene <n>`: this chat's own threshold, over the store's `esik`. */
  testThreshold?: number
  /** The person's latest typed message (composer/bridge/sdk), read to tell a user-asked handoff from the model's own. */
  lastTyped?: string
}

declare module 'claude-code' {
  interface PluginState {
    'otomatik-devir': { conv: OtomatikDevirConv | null }
  }
}
