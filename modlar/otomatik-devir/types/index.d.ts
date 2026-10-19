export type OtomatikDevirPhase =
  | 'idle'
  | 'warned'
  | 'handoff_running'
  /** otomatik: the handoff waits for the person's next typed message (no mod message turn). */
  | 'deferred'
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
  /** Clock ms when the handoff message (or its one reminder) was sent. */
  handoffAt?: number
  /** Main turns completed since then without a handoff prompt. */
  handoffTurns?: number
  /** The one reminder went out; the next miss gives up (phase done). */
  isReminded?: boolean
  /**
   * How the handoff instruction reached the model: `message` = the mod's own
   * message turn (sor mode); `turn` = context inside a turn the person typed
   * (otomatik), where the model itself calls start_session; `scheduled` =
   * otomatik with no typed turn open, where the model writes the prompt file
   * and runs one of this folder's two ad-hoc scheduled tasks; `relay` (v0.5)
   * = the chain took the hop: this chat's own mod runs the task (a regular
   * chat), or the relay does (a run chat's request in the shared store).
   */
  via?: 'message' | 'turn' | 'scheduled' | 'relay'
  /** otomatik, phase deferred: a ready prompt the next typed message starts. */
  heldPrompt?: string
  /** The prompt the model passed to a start_session the app refused. */
  startPrompt?: string
  /** The one carry-over of a ready prompt to the next typed message was used. */
  isRetried?: boolean
  /** The continuation chat's title ("<this title> (devam)") and this chat's id. */
  title?: string
  selfId?: string
  /** The session the model started for this handoff. */
  startedId?: string
  /** The scheduled-task path was used for this handoff (once per handoff). */
  scheduledTried?: boolean
  /** run_scheduled_task calls of the model in this handoff (at most two). */
  runTries?: number
  /** This chat's own scheduled task (it is a run of it), when it is one. */
  selfTaskId?: string
  /** This chat's effort, model and permission mode, for the continuation chat. */
  effort?: string
  model?: string
  permissionMode?: string
  /**
   * otomatik: the main turn the handoff instruction was delivered in. A
   * person's turn other than this one is not read for the prompt (review H2).
   */
  instructedTurn?: string
  /** The instruction rides on a submitted message: the next main turn is the instructed one. */
  instructNext?: boolean
  /** A start_session or task run of the model's is in flight (one at a time, review M6). */
  starting?: string
  /** The person's (b) message, kept for a fallback built from the held prompt (review M7). */
  pendingMessage?: string
  /** Deferred by /devir simdi: a fill measured under the threshold does not cancel it (review L2). */
  isForced?: boolean
  /**
   * otomatik: the handoff was given up (no prompt in time). The model's late
   * gate call or task run of this handoff still counts (re-review N1, N2).
   */
  isGivenUp?: boolean
  /**
   * The carry-over flags as they stood before a typed message claimed (b);
   * restored when that message turns out not to be the person's (re-review N3).
   */
  carryFrom?: { isReminded: boolean }
  /** v0.5: the chain (own dispatch or relay) was tried for this handoff (once per handoff). */
  chainTried?: boolean
  /** v0.5: clock ms after which a chain hop still open falls back to (b) (review M5). */
  chainUntil?: number
}

declare module 'claude-code' {
  interface PluginState {
    'otomatik-devir': { conv: OtomatikDevirConv | null }
  }
}
