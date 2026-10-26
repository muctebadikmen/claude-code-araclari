/**
 * otomatik-devir v2: one chat's handoff record, kept in `$.store` under
 * `sohbet:<session id>` so it survives the chat's own compactions, a hot
 * reload of the mod and an app restart (same session id).
 */

/** idle: watching the fill · winding: the wind-down runs · paused: stopped after a failure, no auto trigger. */
export type OtomatikDevirPhase = 'idle' | 'winding' | 'paused'

export type OtomatikDevirChat = {
  /** On in this chat (`/devir ac`); off by default. */
  isOn: boolean
  /** Context percent (20-90) that starts the wind-down. */
  threshold: number
  phase: OtomatikDevirPhase
  /**
   * The lowest fill measured since the last handoff (absent before the first):
   * the next wind-down needs the fill at max(threshold, floor + gap).
   */
  floor?: number
  /** When the running wind-down began (epoch ms); the handoff file must be newer. */
  startedAt?: number
  /** The handoff file's absolute path, fixed when the wind-down began. */
  file?: string
  /** True once this wind-down's message reached the model (reset by a compaction meanwhile). */
  isDelivered?: boolean
  /** Re-sends after a turn ended without the file (at most 1). */
  resends?: number
  /** Since when the wind-down waits on sub-agents / background work (epoch ms). */
  waitingSince?: number
  /** The last time running work was seen (epoch ms). */
  workSeenAt?: number
  /** The "all work finished, end your turn" prompt was sent. */
  isNudged?: boolean
  /** The "file written, end your turn" reminder was given. */
  isEndReminded?: boolean
  /** Compaction attempts that were refused in this wind-down. */
  compactFails?: number
  /** The model must hear once that the wind-down was cancelled or paused. */
  isResumeNoteDue?: boolean
  /** A continuation file whose prompt could not be submitted after the compaction. */
  undeliveredFile?: string
  /** Completed handoffs in this chat. */
  handoffs?: number
}
