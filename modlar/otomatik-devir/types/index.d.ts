export type OtomatikDevirPhase =
  | 'idle'
  /** The threshold tripped: running work drains, the handoff file gets written, the child starts. */
  | 'handoff_running'
  /** The file is written but no typed turn was open: the person's next message opens the child. */
  | 'ready'
  /** The child started; `devredildi:<sid>` keeps a second one from starting. */
  | 'done'

/** This chat's part in an orchestration: the main chat, a child, or none. */
export type OrkestraRole = 'ana' | 'alt' | 'yok'

/** Why a chain ended: finished, hit the limit, stopped by the person, stalled, closed by `/devir kapat`, or the main chat's own context full. */
export type OrkestraEnd = 'bitti' | 'sinir' | 'durduruldu' | 'durdu' | 'kapatildi' | 'dolu'

/** The main chat's orchestration record, keyed by its local id. */
export type OrkestraAna = {
  /** Marks the main chat's record. */
  role: 'ana'
  /** The main chat's conversation (transcript) id. */
  sid: string
  /** The main chat's local session id; the record's key. */
  localId: string
  /** The task the person gave the orchestration. */
  task: string
  /** The main chat's title; children are titled from it. */
  title: string
  /** How many children have been started so far. */
  n: number
  /** The latest child's local id. */
  childId?: string
  /** True while a start of the next child is in flight. */
  starting?: true
  /** Clock ms when the in-flight start began; an old one counts as stale. */
  startingAt?: number
  /** The main chat is held: its turns end without finishing until the chain ends. */
  isHeld: boolean
  /** The person asked the chain to stop. */
  isStopRequested?: boolean
  /** Set when the chain ended, with the reason. */
  ended?: OrkestraEnd
  /** Consecutive Stop cycles that found the child not running. */
  stallCount?: number
  /** Clock ms of the last stall check. */
  stallAt?: number
  /** The person's message waiting to be handed to the next child. */
  pendingMessage?: string
  /** This chain's own threshold, copied from the chat's `testThreshold`. */
  testThreshold?: number
  /** Clock ms when the orchestration started. */
  startedAt: number
  /** Clock ms of the last write to this record. */
  at: number
}

/** A child chat's orchestration record, keyed by its local id. */
export type OrkestraAlt = {
  /** Marks a child's record. */
  role: 'alt'
  /** The parent's local id. */
  parent: string
  /** This child's number in the chain (1-based). */
  n: number
  /** The child's conversation (transcript) id. */
  sid: string
  /** The child's local session id; the record's key. */
  localId: string
  /** Where the child stands: working, handoff file ready, the whole task finished, or its handoff cancelled by `/devir kapat` (never relayed). */
  status: 'working' | 'ready' | 'finished' | 'cancelled'
  /** The handoff file the child wrote, once ready. */
  file?: string
  /** The child's final report, once finished. */
  report?: string
  /** The child was aborted before it could hand off. */
  isAborted?: boolean
  /** Clock ms of the last write to this record. */
  at: number
}

/** A chain's settings (Decision 22), keyed by the main chat's local id; shared by the main chat and its sub-chats. */
export type OrkestraAyar = {
  /** This chain's threshold; unset is the default (60). */
  esik?: number
  /** This chain's limit of sub-chats; unset is the default (100). */
  limit?: number
  /** `/devir kapat` in this chain: its emergency stop. */
  isClosed?: true
  /** Clock ms of the last write to this record. */
  at: number
}

/** Either side of an orchestration record. */
export type OrkestraRecord = OrkestraAna | OrkestraAlt

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
  /** This chat's orchestration role; unset is the same as `yok`. */
  role?: OrkestraRole
  /** This chat's local session id (the key of its orchestration record). */
  localId?: string
  /** A child's parent, as a local id. */
  parentId?: string
  /** The main chat's count of children started. */
  childN?: number
  /** The main chat is paused: the chain does not start a new child until resumed. */
  isPaused?: boolean
  /** The main chat's running count of stalled-child Stop cycles. */
  stalledN?: number
}

declare module 'claude-code' {
  interface PluginState {
    'otomatik-devir': { conv: OtomatikDevirConv | null }
  }
}
