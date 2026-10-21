// The accounts of claude-contas (its `status.mjs --json`): which one this session
// runs on and how much of each one's limits is used. Pure; the gathering is in register.tsx.

import type { AccountRow, AccountState, AccountsSnapshot, AccountWindow, CurrentAccount, RateLimit } from '../../types'

// One entry of claude-contas' contas.json.
export type AccountEntry = { name: string; file: string; email: string | null }

// The windows the menu shows, in its order.
export const ACCOUNT_WINDOWS = ['5h', '7d'] as const

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null

export function parseEntries(text: string): AccountEntry[] {
  const json = JSON.parse(text) as unknown
  const list = isRecord(json) && Array.isArray(json.contas) ? json.contas : []
  return list.filter(isRecord).flatMap(c =>
    typeof c.nome === 'string' && typeof c.arquivo === 'string'
      ? [{ name: c.nome, file: c.arquivo, email: typeof c.email === 'string' ? c.email : null }]
      : [],
  )
}

const stateOf = (error: string | null, status: string | null, windows: AccountWindow[]): AccountState => {
  if (error !== null) return 'error'
  if (status === 'rejected' || windows.some(w => w.percent >= 100)) return 'limit'
  if (status === 'allowed_warning' || windows.some(w => w.percent >= 90)) return 'warning'
  return 'available'
}

// status.mjs --json: { atualizadoEm, melhor, contas: [{ nome, erro?, status?, janelas?: [{ chave, pct, resetEm }] }] }.
export function parseSnapshot(text: string): AccountsSnapshot {
  const json = JSON.parse(text) as unknown
  if (!isRecord(json) || !Array.isArray(json.contas)) throw new Error('unexpected status.mjs output')
  const rows: AccountRow[] = json.contas.filter(isRecord).map(c => {
    const windows: AccountWindow[] = (Array.isArray(c.janelas) ? c.janelas : []).filter(isRecord).flatMap(j =>
      typeof j.chave === 'string' && typeof j.pct === 'number'
        ? [{ key: j.chave, percent: Math.round(j.pct), resetsAt: typeof j.resetEm === 'string' ? Date.parse(j.resetEm) : null }]
        : [],
    )
    const error = typeof c.erro === 'string' ? c.erro : null
    const status = typeof c.status === 'string' ? c.status : null
    return { name: String(c.nome), error, state: stateOf(error, status, windows), windows, isLive: false }
  })
  const updatedAt = typeof json.atualizadoEm === 'string' ? Date.parse(json.atualizadoEm) : Date.now()
  return { updatedAt, best: typeof json.melhor === 'string' ? json.melhor : null, rows }
}

// The session's own reading of its limits replaces the last probe of the account it runs on:
// it is newer, and it is what the status line shows.
export function withLive(snapshot: AccountsSnapshot, current: string | null, limits: readonly RateLimit[]): AccountsSnapshot {
  if (current === null || limits.length === 0) return snapshot
  const rows = snapshot.rows.map(row => {
    if (row.name !== current || row.error !== null) return row
    const windows = row.windows.map(w => {
      const live = limits.find(l => l.label === w.key)
      return live === undefined ? w : { key: w.key, percent: live.percent, resetsAt: live.resetsAt ?? w.resetsAt }
    })
    for (const l of limits) if (!windows.some(w => w.key === l.label)) windows.push({ key: l.label, percent: l.percent, resetsAt: l.resetsAt })
    return { ...row, windows, state: stateOf(null, null, windows), isLive: true }
  })
  return { ...snapshot, rows }
}

// The claude-contas account a /login email is: the one whose `email` it is, or
// whose name is the email's local part (work for work@example.com).
export function accountForEmail(entries: readonly AccountEntry[], email: string | null): string | null {
  if (email === null) return null
  const lower = email.toLowerCase()
  const local = lower.split('@')[0]
  return (
    entries.find(e => e.email?.toLowerCase() === lower)?.name ??
    entries.find(e => e.email === null && e.name.toLowerCase() === local)?.name ??
    null
  )
}

const percentIn = (row: AccountRow, key: string) => row.windows.find(w => w.key === key)?.percent ?? 0

// The usable account with the most room in the 5-hour window, the week breaking ties.
export function freest(snapshot: AccountsSnapshot, exclude: string | null): AccountRow | null {
  return (
    snapshot.rows
      .filter(r => r.name !== exclude && (r.state === 'available' || r.state === 'warning'))
      .sort((a, b) => percentIn(a, '5h') - percentIn(b, '5h') || percentIn(a, '7d') - percentIn(b, '7d'))[0] ?? null
  )
}

// What the status line writes for the account: `token work`, `login work@example.com`.
// `short` drops the email's domain.
export function accountTag(account: CurrentAccount, short = false): string {
  if (account.kind === 'token') return `token ${account.name ?? '?'}`
  if (account.kind === 'login') {
    const who = account.email ?? account.name ?? '?'
    return `login ${short ? who.split('@')[0] : who}`
  }
  if (account.kind === 'api-key') return 'API key'
  return 'no account'
}
