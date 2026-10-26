/**
 * otomatik-devir v2: one chat's handoff record, kept in `$.store` under
 * `sohbet:<session id>` so it survives the chat's own compactions, a hot
 * reload of the mod and an app restart (same session id).
 */

/** idle: watching the fill · winding: the wind-down runs. */
export type OtomatikDevirPhase = 'idle' | 'winding'

export type OtomatikDevirChat = {
  /** On in this chat (`/devir ac`); off by default. */
  isOn: boolean
  /** Context percent (20-90) that starts the wind-down. */
  threshold: number
  phase: OtomatikDevirPhase
  /**
   * The lowest fill measured since the last handoff or give-up (absent before
   * the first): the next wind-down needs the fill at max(threshold, floor + gap).
   */
  floor?: number
  /** When the running wind-down began (epoch ms). */
  startedAt?: number
  /** The handoff file's absolute path, fixed when the wind-down began. */
  file?: string
  /** When the wind-down message last reached the model (epoch ms): the file must be newer. Absent: not delivered yet. */
  deliveredAt?: number
  /** The context percent at that delivery. */
  deliveredPercent?: number
  /** Deliveries in this wind-down (mid-turn and submitted). */
  deliveries?: number
  /** Re-sends as a prompt after a turn ended without the file (at most 1). */
  resends?: number
  /** When the "file written, end your turn" note was given (epoch ms). */
  endNoteAt?: number
  /** Main tool results since that note. */
  toolsSinceEndNote?: number
  /** Compaction attempts that were refused in this wind-down. */
  compactFails?: number
  /** The model must hear once that the wind-down was cancelled or given up. */
  isResumeNoteDue?: boolean
  /** Completed handoffs in this chat. */
  handoffs?: number
}
