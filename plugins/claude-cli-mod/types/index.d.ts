export type Panel = 'main' | 'zen' | 'themes' | 'mode' | 'status' | 'accounts'

export type ZenTheme = 'blue' | 'dark' | 'light' | 'green' | 'rainbow' | 'custom'

export type ZenColors = { bar: string; text: string; border: string }

export type StepStatus = 'pending' | 'in_progress' | 'completed'

export type ZenStep = { id: string; text: string; status: StepStatus }

export type ZenTask = {
  title: string
  startedAt: number
  doneAt: number | null
  steps: ZenStep[]
}

// colors: the theme's eight normal ANSI colors, drawn as its swatch.
export type ThemeEntry = { slug: string; name: string; colors: string[] }

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

export type Lang = 'en' | 'pt'

export type RateLimit = { label: string; percent: number; resetsAt: number | null }

// What the status line draws, refreshed after each model response and on a timer.
export type StatusSnapshot = {
  model: string
  dir: string
  branch: string
  ctxPercent: number | null
  ctxTokens: number | null
  ctxWindow: number | null
  limits: RateLimit[]
}

// How this session is signed in: a claude-contas token (`cc` hands it over as
// CLAUDE_CODE_OAUTH_TOKEN), the person's own /login, or an API key.
export type AccountKind = 'token' | 'login' | 'api-key' | 'none'

// name: the claude-contas account it is, when one matches; email and org: the
// /login record's (never read under a token, whose account the record is not).
export type CurrentAccount = { kind: AccountKind; name: string | null; email: string | null; org: string | null }

export type AccountWindow = { key: string; percent: number; resetsAt: number | null }

export type AccountState = 'available' | 'warning' | 'limit' | 'error'

// isLive: the windows are this session's own reading, not the last probe.
export type AccountRow = { name: string; error: string | null; state: AccountState; windows: AccountWindow[]; isLive: boolean }

export type AccountsSnapshot = { updatedAt: number; best: string | null; rows: AccountRow[] }

declare module 'claude-code' {
  interface PluginState {
    'claude-cli-mod': {
      menu: Panel | null
      zenOn: boolean
      zenTheme: ZenTheme
      zenCustom: ZenColors
      zenCollapsed: boolean
      task: ZenTask | null
      now: number
      themes: ThemeEntry[]
      themeName: string | null
      themeQuery: string
      themeScroll: number
      themeStatus: string
      effort: Effort | null
      mode: string | null
      defaultMode: string | null
      isDownloading: boolean
      statusOn: boolean
      status: StatusSnapshot | null
      lastResponseAt: number | null
      statusClock: number
      sessionEffort: Effort | null
      sessionModel: string | null
      paneBg: string | null
      defaultModeChosen: boolean
      lang: Lang
      account: CurrentAccount | null
      accounts: AccountsSnapshot | null
      accountsNote: string
      isRefreshingAccounts: boolean
    }
  }
}
