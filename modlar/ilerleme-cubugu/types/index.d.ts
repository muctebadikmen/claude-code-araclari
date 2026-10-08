export type IlerlemeCubuguDurum = 'pending' | 'in_progress' | 'completed'

export type IlerlemeCubuguAdim = {
  id: string
  content: string
  activeForm: string
  status: IlerlemeCubuguDurum
}

export type IlerlemeCubuguIs = { startedAt: number | null; doneAt: number | null }

declare module 'claude-code' {
  interface PluginState {
    'ilerleme-cubugu': {
      tasks: IlerlemeCubuguAdim[]
      plan: IlerlemeCubuguAdim[]
      job: IlerlemeCubuguIs
      isHidden: boolean
      isExpanded: boolean
      /** the session id of the conversation that engaged the plan-file bar */
      engagedSid: string | null
    }
  }
}
