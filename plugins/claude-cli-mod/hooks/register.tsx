import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderChildren, RenderInput, Timer } from 'claude-code'

import type { Effort, Lang, Panel, RateLimit, StatusSnapshot, ThemeEntry, ZenColors, ZenStep, ZenTask, ZenTheme } from '../types'
import { EFFORT_HEAT, EFFORTS, type Mode, MODELS, MODES, modeLabel, modelFamily } from './lib/modes'
import { isLang, LANGS, modeName, phrase, type Phrase } from './lib/i18n'
import {
  backgroundPill,
  BAR_WIDTH,
  barFill,
  cacheState,
  colorFor,
  type Detail,
  fmtDuration,
  fmtTokens,
  LIMIT_LABELS,
  STATUS_CYAN,
  STATUS_GREEN,
  STATUS_RED,
  statsWidth,
} from './lib/status'
import {
  findProfile,
  matchAll,
  oscFor,
  type Palette,
  parseJsonc,
  targetProfile,
  toPalette,
  toClaudeTheme,
  withProfileTheme,
  WT_SCHEME,
  type WtSettings,
} from './lib/palette'
import {
  asStatus,
  barCells,
  colorsFor,
  elapsed,
  percentOf,
  RAINBOW,
  stepLabel,
  ZEN_PROMPT,
  ZEN_TOOL_DESCRIPTION,
  ZEN_TOOL_NAME,
  ZEN_TOOL_SCHEMA,
  ZEN_THEMES,
} from './lib/zen'

// Every value the drawings read. Settings worth keeping across sessions are
// mirrored to $.store under the same key.
const menu = atom({ plugin: 'claude-cli-mod', key: 'menu' } as const, null)
const zenOn = atom({ plugin: 'claude-cli-mod', key: 'zenOn' } as const, false)
const zenTheme = atom({ plugin: 'claude-cli-mod', key: 'zenTheme' } as const, 'green')
const zenCustom = atom(
  { plugin: 'claude-cli-mod', key: 'zenCustom' } as const,
  { bar: '#3b82f6', text: '#e2e8f0', border: '#3b82f6' } satisfies ZenColors,
)
const zenCollapsed = atom({ plugin: 'claude-cli-mod', key: 'zenCollapsed' } as const, false)
const task = atom({ plugin: 'claude-cli-mod', key: 'task' } as const, null)
const now = atom({ plugin: 'claude-cli-mod', key: 'now' } as const, 0)
const themes = atom({ plugin: 'claude-cli-mod', key: 'themes' } as const, [])
const themeName = atom({ plugin: 'claude-cli-mod', key: 'themeName' } as const, null)
const themeQuery = atom({ plugin: 'claude-cli-mod', key: 'themeQuery' } as const, '')
const themeScroll = atom({ plugin: 'claude-cli-mod', key: 'themeScroll' } as const, 0)
const themeStatus = atom({ plugin: 'claude-cli-mod', key: 'themeStatus' } as const, '')
const effort = atom({ plugin: 'claude-cli-mod', key: 'effort' } as const, null)
const mode = atom({ plugin: 'claude-cli-mod', key: 'mode' } as const, null)
const defaultMode = atom({ plugin: 'claude-cli-mod', key: 'defaultMode' } as const, null)
const isDownloading = atom({ plugin: 'claude-cli-mod', key: 'isDownloading' } as const, false)
const sessionEffort = atom({ plugin: 'claude-cli-mod', key: 'sessionEffort' } as const, null)
const sessionModel = atom({ plugin: 'claude-cli-mod', key: 'sessionModel' } as const, null)
const paneBg = atom({ plugin: 'claude-cli-mod', key: 'paneBg' } as const, null)
const defaultModeChosen = atom({ plugin: 'claude-cli-mod', key: 'defaultModeChosen' } as const, false)
const statusOn = atom({ plugin: 'claude-cli-mod', key: 'statusOn' } as const, false)
const status = atom({ plugin: 'claude-cli-mod', key: 'status' } as const, null)
const lastResponseAt = atom({ plugin: 'claude-cli-mod', key: 'lastResponseAt' } as const, null)
const lang = atom({ plugin: 'claude-cli-mod', key: 'lang' } as const, 'en')
const statusClock = atom({ plugin: 'claude-cli-mod', key: 'statusClock' } as const, 0)

// The menu's pane: a sidebar in the fullscreen layout, a block above the prompt otherwise.
// Claude's progress tool, as the model calls it.
const ZEN_TOOL = 'mcp__claude-cli-mod__zen_progress'

const PANE = 'claude-tools'
const PANE_SIZE = { rows: 15, columns: 48 }
// The menu's content is no wider than this, left-aligned in the pane's frame.
const CONTENT_COLUMNS = 56
// Body rows each page needs, so the pane is no taller than its content.
const PAGE_ROWS: Record<Panel, number> = { main: 8, zen: 8, mode: 14, themes: 15, status: 10 }
const paneSize = (panel: Panel) => ({ rows: PAGE_ROWS[panel], columns: PANE_SIZE.columns })
// Used until the terminal's own background is known: just short of pure black.
const PANE_BACKGROUND = '#0b0b0b'
const MENU_NAME = 'claude-cli-mod'
// Room the engine's own mode label takes left of the hint row (⏵⏵ auto mode on · ).
const MODE_LABEL_COLUMNS = 22
// The slug of the Claude Code theme the mod writes: ~/.claude/themes/claude-cli-mod.json.
const CLAUDE_THEME = 'claude-cli-mod'

// Windows Terminal's built-in schemes, by name: their backgrounds.
const WT_BUILTIN_BACKGROUNDS: Record<string, string> = {
  Campbell: '#0C0C0C',
  'Campbell Powershell': '#012456',
  'Dark+': '#1E1E1E',
  Dimidium: '#141414',
  'One Half Dark': '#282C34',
  'One Half Light': '#FFFFFF',
  Ottosson: '#000000',
  'Solarized Dark': '#002B36',
  'Solarized Light': '#FDF6E3',
  'Tango Dark': '#000000',
  'Tango Light': '#FFFFFF',
  Vintage: '#000000',
}

// Each permission mode in the color Claude Code draws it with.
const MODE_COLORS: Record<string, string> = {
  default: 'text',
  plan: 'planMode',
  acceptEdits: 'autoAccept',
  auto: 'warning',
  dontAsk: 'warning',
  bypassPermissions: 'error',
}

const SITE = 'https://terminalcolors.com'
const HEX = /^#[0-9a-f]{6}$/i

// Paths and platform --------------------------------------------------------

async function homeDir($: EngineInterface) {
  const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? '.'
  return home.replaceAll('\\', '/')
}

async function themesDir($: EngineInterface) {
  return `${await homeDir($)}/.claude/claude-cli-mod/themes`
}

async function isWindows($: EngineInterface) {
  return (await $.env.get('OS')) === 'Windows_NT'
}

// Zen settings ---------------------------------------------------------------

async function setZenOn($: EngineInterface, isOn: boolean) {
  await update($, zenOn, () => isOn)
  await $.store.set('zenOn', isOn)
  if (!isOn) await update($, task, () => null)
}

// Hides or shows the subtasks inside the band; the band itself stays.
async function setZenCollapsed($: EngineInterface, isCollapsed: boolean) {
  await update($, zenCollapsed, () => isCollapsed)
  await $.store.set('zenCollapsed', isCollapsed)
}

async function setZenTheme($: EngineInterface, theme: ZenTheme) {
  await update($, zenTheme, () => theme)
  await $.store.set('zenTheme', theme)
  await fitPane($)
}

async function setZenColor($: EngineInterface, part: keyof ZenColors, value: string) {
  if (!HEX.test(value.trim())) {
    $.ui.toast(`${value} is not a hex color like #3b82f6`)
    return
  }
  const colors = await update($, zenCustom, c => ({ ...c, [part]: value.trim() }))
  await $.store.set('zenCustom', colors)
}

// Themes ---------------------------------------------------------------------

async function fetchText($: EngineInterface, url: string) {
  const res = await $.http.fetch(url)
  if (!res.ok) throw new Error(`${res.status} for ${url}`)
  return res.text
}

async function sayTheme($: EngineInterface, text: string) {
  await update($, themeStatus, () => text)
}

// Reads the saved YAML files into the list the picker shows.
async function indexThemes($: EngineInterface) {
  const dir = await themesDir($)
  const list: ThemeEntry[] = []
  if (await $.fs.exists(dir)) {
    for (const entry of await $.fs.list(dir)) {
      if (entry.kind !== 'file' || !entry.name.endsWith('.yaml')) continue
      const palette = toPalette(await $.fs.read(`${dir}/${entry.name}`))
      if (palette !== null) list.push({ slug: entry.name.replace(/\.yaml$/, ''), name: palette.name, colors: palette.normal })
    }
  }
  list.sort((a, b) => a.name.localeCompare(b.name))
  await update($, themes, () => list)
  return list
}

// Scrapes every theme page on terminalcolors.com and saves each theme's YAML.
async function downloadThemes($: EngineInterface) {
  const dir = await themesDir($)
  await sayTheme($, 'Reading terminalcolors.com…')
  const homePage = await fetchText($, `${SITE}/`)
  const variants = new Set(matchAll(homePage, /href="(\/themes\/[\w-]+\/[\w-]+\/)"/g))
  // A family page can list variants the home page leaves out.
  for (const family of new Set(matchAll(homePage, /href="(\/themes\/[\w-]+\/)"/g))) {
    try {
      for (const v of matchAll(await fetchText($, SITE + family), /href="(\/themes\/[\w-]+\/[\w-]+\/)"/g)) {
        variants.add(v)
      }
    } catch {}
  }

  const pages = [...variants]
  let done = 0
  let saved = 0
  // Six downloads at a time.
  for (let i = 0; i < pages.length; i += 6) {
    await Promise.all(
      pages.slice(i, i + 6).map(async page => {
        try {
          const yamlPath = matchAll(await fetchText($, SITE + page), /href="(\/downloads\/warp\/[^"]+\.ya?ml)"/g)[0]
          if (yamlPath === undefined) return
          const yaml = await fetchText($, SITE + yamlPath)
          if (toPalette(yaml) === null) return
          const file = yamlPath.split('/').pop()!.replace(/\.yml$/, '.yaml')
          await $.fs.write(`${dir}/${file}`, yaml)
          saved++
        } catch {
        } finally {
          done++
        }
      }),
    )
    await sayTheme($, `Downloading themes… ${done}/${pages.length}`)
  }

  await indexThemes($)
  await sayTheme($, `Saved ${saved} themes to ${dir}`)
}

async function wtSettingsPath($: EngineInterface, profileId: string | null) {
  const local = ((await $.env.get('LOCALAPPDATA')) ?? '').replaceAll('\\', '/')
  const candidates = [
    `${local}/Packages/Microsoft.WindowsTerminal_8wekyb3d8bbwe/LocalState/settings.json`,
    `${local}/Packages/Microsoft.WindowsTerminalPreview_8wekyb3d8bbwe/LocalState/settings.json`,
    `${local}/Microsoft/Windows Terminal/settings.json`,
  ]
  let first: string | null = null
  for (const path of candidates) {
    if (local === '' || !(await $.fs.exists(path))) continue
    first ??= path
    const text = await $.fs.read(path)
    if (profileId !== null && text.toLowerCase().includes(profileId.toLowerCase())) return path
  }
  return first
}

// The background of the terminal Claude Code runs in: Windows Terminal's
// profile and scheme, else the kept theme's.
async function terminalBackground($: EngineInterface): Promise<string | null> {
  if (await isWindows($)) {
    const profileId = (await $.env.get('WT_PROFILE_ID')) ?? null
    const path = await wtSettingsPath($, profileId)
    if (path === null) return null
    const settings = parseJsonc(await $.fs.read(path)) as WtSettings
    const profile = targetProfile(settings, profileId) as { background?: unknown; colorScheme?: unknown }
    if (typeof profile.background === 'string') return profile.background
    const defaults = (Array.isArray(settings.profiles) ? undefined : settings.profiles?.defaults) as
      | { background?: unknown; colorScheme?: unknown }
      | undefined
    if (typeof defaults?.background === 'string') return defaults.background
    const raw = profile.colorScheme ?? defaults?.colorScheme ?? 'Campbell'
    const name = typeof raw === 'string' ? raw : ((raw as { dark?: string }).dark ?? 'Campbell')
    const scheme = (settings.schemes ?? []).find(sc => sc.name === name) as { background?: unknown } | undefined
    if (typeof scheme?.background === 'string') return scheme.background
    return WT_BUILTIN_BACKGROUNDS[name] ?? null
  }
  const kept = (await $.store.get('theme')) as { slug: string } | undefined
  if (kept === undefined) return null
  return toPalette(await $.fs.read(`${await themesDir($)}/${kept.slug}.yaml`))?.background ?? null
}

async function refreshPaneBg($: EngineInterface) {
  try {
    const bg = await terminalBackground($)
    await update($, paneBg, () => bg)
  } catch {}
}

// The `theme` in ~/.claude/settings.json, written directly: /config's theme row
// takes only the built-in themes ("For custom themes, use /theme"), so a custom
// one can only be chosen here. Claude Code reads it once, at startup, and loads
// ~/.claude/themes/ at startup only when that theme is a custom one.
async function writeThemeSetting($: EngineInterface, value: string): Promise<boolean> {
  const path = `${await homeDir($)}/.claude/settings.json`
  const text = (await $.fs.exists(path)) ? await $.fs.read(path) : '{}'
  const settings = JSON.parse(text) as { theme?: unknown }
  if (settings.theme === value) return false
  const backup = `${path}.claude-cli-mod.bak`
  if (!(await $.fs.exists(backup))) await $.fs.write(backup, text)
  settings.theme = value
  await $.fs.write(path, `${JSON.stringify(settings, null, 2)}\n`)
  return true
}

// Selects a Claude Code theme by its /theme value (`dark`, `custom:<slug>`),
// first keeping the one it replaces, so a reset can put it back.
async function selectClaudeTheme($: EngineInterface, value: string) {
  const row = (await $.config.list()).find(r => r.key === 'theme')
  if (row === undefined) throw new Error('Claude Code has no theme setting to change')
  if (row.value === value) return
  if (value === `custom:${CLAUDE_THEME}` && (await $.store.get('themeBefore')) === undefined) {
    await $.store.set('themeBefore', row.value)
  }
  if (!value.startsWith('custom:') || row.options?.includes(value)) {
    const set = await $.config.set({ key: 'theme', value })
    if (set.deny === undefined) return
    if (!value.startsWith('custom:')) throw new Error(set.deny)
  }
  if (await writeThemeSetting($, value)) {
    $.ui.toast(`Restart Claude Code once to switch to the ${CLAUDE_THEME} theme; after that, themes change live`)
  }
}

// Windows: the kept theme, background included, on the Windows Terminal
// profile this tab runs in. Windows Terminal reloads its settings live, so the
// tab repaints at once; other open tabs on the same profile take the theme too
// while the session runs. The profile's own scheme is kept in the store before
// the first change and goes back with null, at session end; a session that
// crashed leaves it there, and the next session's end puts it back.
async function paintWindowsTerminal($: EngineInterface, palette: Palette | null) {
  const profileId = (await $.env.get('WT_PROFILE_ID')) ?? null
  if (profileId === null) return
  const path = await wtSettingsPath($, profileId)
  if (path === null) return
  const text = await $.fs.read(path)
  const settings = parseJsonc(text) as WtSettings
  const profile = findProfile(settings, profileId)
  if (profile === undefined) return
  const key = profileId.toLowerCase()
  const originals = ((await $.store.get('wtOriginal')) ?? {}) as Record<string, { colorScheme?: unknown }>
  if (palette === null && originals[key] === undefined) return
  if (originals[key] === undefined) {
    originals[key] = profile.colorScheme === undefined || profile.colorScheme === WT_SCHEME ? {} : { colorScheme: profile.colorScheme }
    await $.store.set('wtOriginal', originals)
  }
  withProfileTheme(settings, profile, palette, originals[key].colorScheme)
  const out = JSON.stringify(settings, null, 4)
  if (out !== JSON.stringify(parseJsonc(text), null, 4)) {
    const backup = `${path}.claude-cli-mod.bak`
    if (!(await $.fs.exists(backup))) await $.fs.write(backup, text)
    await $.fs.write(path, out)
  }
  if (palette === null) {
    delete originals[key]
    await $.store.set('wtOriginal', originals)
  }
  await refreshPaneBg($)
}

// The terminal device Claude Code draws on (/dev/ttys002, /dev/pts/3): the
// first process up the tree that has one. A command the engine runs has no
// terminal of its own, so /dev/tty is not there for it.
const FIND_TTY = `p=$$
while [ "$p" -gt 1 ]; do
  t=$(ps -o tty= -p "$p" | tr -d ' ')
  case "$t" in ''|'?'|'??') ;; *) printf '/dev/%s' "$t"; exit 0 ;; esac
  p=$(ps -o ppid= -p "$p" | tr -d ' ')
done
exit 1`

let ttyPath: string | null | undefined

async function findTty($: EngineInterface) {
  if (ttyPath !== undefined) return ttyPath
  const ran = await $.process.run(['sh', '-c', FIND_TTY])
  ttyPath = ran.exitCode === 0 && ran.stdout.startsWith('/dev/') ? ran.stdout : null
  return ttyPath
}

// macOS and Linux: the theme's colors, background included, sent to the
// terminal as OSC sequences (Ghostty, iTerm2, kitty, WezTerm, Terminal.app);
// null gives the terminal its own colors back.
async function paintOsc($: EngineInterface, palette: Palette | null) {
  const tty = await findTty($)
  if (tty === null) return
  await $.process.run(['sh', '-c', 'printf "%s" "$1" > "$2"', 'sh', oscFor(palette), tty])
}

// Paints Claude Code with a saved theme: written as the custom theme
// ~/.claude/themes/claude-cli-mod.json, which Claude Code reloads live, and
// selected. On Windows this tab's Windows Terminal profile takes the theme
// too, background included. null selects the theme that was in use before
// the mod's first one, and gives the profile its own colors back.
async function paintTerminal($: EngineInterface, slug: string | null) {
  if (slug === null) {
    const before = (await $.store.get('themeBefore')) as string | undefined
    await selectClaudeTheme($, before ?? 'dark')
    await $.store.delete('themeBefore')
    if (await isWindows($)) await paintWindowsTerminal($, null)
    else await paintOsc($, null)
    return null
  }
  const palette = toPalette(await $.fs.read(`${await themesDir($)}/${slug}.yaml`))
  if (palette === null) throw new Error(`${slug}.yaml is not a theme this mod can read`)
  const dir = `${await homeDir($)}/.claude/themes`
  await $.fs.write(`${dir}/${CLAUDE_THEME}.json`, `${JSON.stringify(toClaudeTheme(palette), null, 2)}\n`)
  await selectClaudeTheme($, `custom:${CLAUDE_THEME}`)
  if (await isWindows($)) await paintWindowsTerminal($, palette)
  else await paintOsc($, palette)
  return palette
}

// Keeps a theme (null: the terminal's own colors) for this and later sessions.
// The menu's pane takes its background too.
async function applyTheme($: EngineInterface, slug: string | null) {
  const palette = await paintTerminal($, slug)
  await update($, themeName, () => palette?.name ?? null)
  if (palette === null) await $.store.delete('theme')
  else await $.store.set('theme', { slug: slug!, name: palette.name })
  await refreshPaneBg($)
  await sayTheme($, '')
}

// The first look at the themes downloads them; once, however often it is asked.
async function ensureThemes($: EngineInterface) {
  if ((await read($, themes)).length > 0 || (await read($, isDownloading))) return
  await update($, isDownloading, () => true)
  try {
    await downloadThemes($)
  } catch (error) {
    await sayTheme($, `Download failed: ${error instanceof Error ? error.message : String(error)}`)
  } finally {
    await update($, isDownloading, () => false)
  }
}

// Runs a theme action from a button, reporting a failure in the panel.
function themeAction($: EngineInterface, work: () => Promise<unknown>) {
  return () => {
    void work().catch((error: unknown) =>
      sayTheme($, `Failed: ${error instanceof Error ? error.message : String(error)}`),
    )
  }
}

async function loadThemes($: EngineInterface) {
  const list = await indexThemes($)
  const saved = (await $.store.get('theme')) as { slug: string; name: string } | undefined
  if (saved === undefined) return
  if (!list.some(t => t.slug === saved.slug)) return
  await update($, themeName, () => saved.name)
  // This tab's Windows Terminal profile, or elsewhere the terminal itself,
  // takes the kept theme for the session.
  try {
    const palette = toPalette(await $.fs.read(`${await themesDir($)}/${saved.slug}.yaml`))
    if (await isWindows($)) await paintWindowsTerminal($, palette)
    else await paintOsc($, palette)
  } catch {}
}

// Mode and effort --------------------------------------------------------------

// The effort every request of this session is sent with. When /config has an
// effort row, it is changed too, so Claude Code's own display agrees.
async function setEffort($: EngineInterface, level: Effort) {
  await update($, effort, () => level)
  await $.store.set('effort', level)
  try {
    const row = (await $.config.list()).find(r => /effort/i.test(r.key) && r.options?.includes(level))
    if (row !== undefined) await $.config.set({ key: row.key, value: level })
  } catch {}
  $.ui.toast(`Effort: ${level}`)
}

// Switches the session's model through Claude Code's own `/model`, so /model,
// the status line and the requests all agree. It runs once the session is idle.
async function setModel($: EngineInterface, alias: string) {
  await $.command.run({ command: 'model', args: alias })
  const id = await $.session.model()
  await update($, sessionModel, () => id)
  if (await read($, statusOn)) void refreshStatus($).catch(() => {})
  $.ui.toast(`Model: ${prettyModel(id)}`)
}

async function trackModel($: EngineInterface, id: string) {
  if (id !== (await read($, sessionModel))) await update($, sessionModel, () => id)
}

// permissions.defaultMode in ~/.claude/settings.json: the mode new sessions
// start in. A running session's mode is shift+tab's; a mod cannot set it.
async function setDefaultMode($: EngineInterface, next: Mode) {
  const path = `${await homeDir($)}/.claude/settings.json`
  const text = (await $.fs.exists(path)) ? await $.fs.read(path) : '{}'
  const backup = `${path}.claude-cli-mod.bak`
  if (!(await $.fs.exists(backup))) await $.fs.write(backup, text)
  const settings = JSON.parse(text) as { permissions?: Record<string, unknown> }
  settings.permissions = { ...settings.permissions, defaultMode: next }
  await $.fs.write(path, `${JSON.stringify(settings, null, 2)}\n`)
  await update($, defaultMode, () => next)
  await update($, defaultModeChosen, () => true)
  await fitPane($)
  $.ui.toast(`New sessions start in ${modeLabel(next)} mode`)
}

async function trackMode($: EngineInterface, current: string | undefined) {
  if (current !== undefined && current !== (await read($, mode))) await update($, mode, () => current)
}

// The session's own effort level before any request. First match wins: a
// /config row, the effortLevel setting, CLAUDE_EFFORT, the last level seen.
async function loadSessionEffort($: EngineInterface) {
  const found: unknown[] = []
  try {
    found.push((await $.config.list()).find(r => /effort/i.test(r.key))?.value)
  } catch {}
  try {
    found.push(((await $.settings.read()) as { effortLevel?: unknown }).effortLevel)
  } catch {}
  found.push(await $.env.get('CLAUDE_EFFORT'))
  found.push(await $.store.get('lastSessionEffort'))
  const level = found.find((v): v is Effort => typeof v === 'string' && EFFORTS.includes(v as Effort))
  if (level !== undefined) await update($, sessionEffort, () => level)
}

// Records the level a request actually ran at, as the engine reports it.
async function trackEffort($: EngineInterface, level: unknown) {
  if (typeof level !== 'string' || !EFFORTS.includes(level as Effort)) return
  const own = level as Effort
  if (own === (await read($, sessionEffort))) return
  await update($, sessionEffort, () => own)
  await $.store.set('lastSessionEffort', own)
}

async function loadSettings($: EngineInterface) {
  const saved = {
    zenOn: (await $.store.get('zenOn')) as boolean | undefined,
    zenTheme: (await $.store.get('zenTheme')) as ZenTheme | undefined,
    zenCustom: (await $.store.get('zenCustom')) as ZenColors | undefined,
    zenCollapsed: (await $.store.get('zenCollapsed')) as boolean | undefined,
    effort: (await $.store.get('effort')) as Effort | undefined,
    lang: await $.store.get('lang'),
  }
  if (saved.zenOn !== undefined) await update($, zenOn, () => saved.zenOn!)
  // Green is the default; 'blue' was the old default, so a saved 'blue' is not a choice.
  if (saved.zenTheme !== undefined && saved.zenTheme !== 'blue' && ZEN_THEMES.includes(saved.zenTheme)) {
    await update($, zenTheme, () => saved.zenTheme!)
  }
  if (saved.zenCollapsed === true) await update($, zenCollapsed, () => true)
  if (saved.zenCustom !== undefined) await update($, zenCustom, () => saved.zenCustom!)
  if (saved.effort !== undefined && EFFORTS.includes(saved.effort)) await update($, effort, () => saved.effort!)
  if (isLang(saved.lang)) await update($, lang, () => saved.lang as Lang)
  try {
    const { permissions } = await $.settings.read({ source: 'user' })
    const configured = (permissions as { defaultMode?: string } | undefined)?.defaultMode
    await update($, defaultMode, () => configured ?? 'default')
  } catch {}
}

// Status line -------------------------------------------------------------------

// Gathers what the status line draws: the model, the folder and branch, the
// context window and the rate limits, as Claude Code's own status line has them.
async function refreshStatus($: EngineInterface) {
  const [model, cwd, usage] = await Promise.all([$.session.model(), $.session.cwd(), $.session.usage()])
  let branch = ''
  try {
    const ran = await $.process.run(['git', '-C', cwd, 'branch', '--show-current'])
    if (ran.exitCode === 0) branch = ran.stdout.trim()
  } catch {}
  const limits: RateLimit[] = usage.rateLimits
    .filter(l => LIMIT_LABELS[l.kind] !== undefined)
    .map(l => ({
      label: LIMIT_LABELS[l.kind]!,
      percent: Math.round(l.percentUsed),
      resetsAt: l.resetsAt === undefined ? null : Date.parse(l.resetsAt),
    }))
  const snapshot: StatusSnapshot = {
    model,
    dir: cwd.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || cwd,
    branch,
    ctxPercent: usage.context.percent ?? null,
    ctxTokens: usage.context.tokens ?? null,
    ctxWindow: usage.context.window,
    limits,
  }
  await update($, status, () => snapshot)
}

type SavedStatusLine = { statusLine: unknown }

// On: the mod draws the status line, so Claude Code's own statusLine command is
// taken out of ~/.claude/settings.json (kept, to put back when it goes off).
async function setStatusOn($: EngineInterface, isOn: boolean) {
  const path = `${await homeDir($)}/.claude/settings.json`
  const text = (await $.fs.exists(path)) ? await $.fs.read(path) : '{}'
  const backup = `${path}.claude-cli-mod.bak`
  if (!(await $.fs.exists(backup))) await $.fs.write(backup, text)
  const settings = JSON.parse(text) as { statusLine?: unknown }
  const saved = (await $.store.get('savedStatusLine')) as SavedStatusLine | undefined
  if (isOn && settings.statusLine !== undefined) {
    await $.store.set('savedStatusLine', { statusLine: settings.statusLine } satisfies SavedStatusLine)
    delete settings.statusLine
    await $.fs.write(path, `${JSON.stringify(settings, null, 2)}\n`)
  } else if (!isOn && saved !== undefined && settings.statusLine === undefined) {
    settings.statusLine = saved.statusLine
    await $.fs.write(path, `${JSON.stringify(settings, null, 2)}\n`)
    await $.store.delete('savedStatusLine')
  }
  await update($, statusOn, () => isOn)
  await $.store.set('statusOn', isOn)
  if (isOn) await refreshStatus($)
}

async function loadStatus($: EngineInterface) {
  const isOn = (await $.store.get('statusOn')) as boolean | undefined
  if (isOn === true) await update($, statusOn, () => true)
  // Never chosen: on, so the button shares the stats row (the status line
  // command, if any, is kept and comes back with Off).
  if (isOn === undefined) await setStatusOn($, true).catch(() => {})
  await update($, statusClock, () => Date.now())
  try {
    await refreshStatus($)
  } catch {}
}

// Drawing ----------------------------------------------------------------------

// Zen's progress band; null when there is nothing to show.
async function drawZenBand($: EngineInterface, e: RenderInput<'AbovePrompt'>) {
  const t = await read($, task)
  if (!(await read($, zenOn)) || t === null) return null

  const theme = await read($, zenTheme)
  const colors = colorsFor(theme, await read($, zenCustom))
  const isCollapsed = await read($, zenCollapsed)
  const clock = await read($, now)
  const { Box, Text } = $.ui.resolve(e)

  const lng = await read($, lang)
  const percent = percentOf(t)
  const isDone = t.doneAt !== null
  const mark = isDone ? '✓' : '✶'
  // The same color the menu's swatch shows; rainbow paints the title letter by letter.
  const accent = theme === 'rainbow' ? undefined : colors.bar
  const { filled, runs } = barCells(theme, colors.bar, 10, percent)
  const meter = (
    <Text>
      {runs.map(r => (
        <Text color={r.color}>{'▰'.repeat(r.cells)}</Text>
      ))}
      <Text dimColor>{'▱'.repeat(10 - filled)}</Text>
    </Text>
  )
  // No title yet means Claude has not named the task: say it is thinking. A long
  // title is cut, so the band stays one short line.
  const name = t.title === '' ? phrase(lng, 'thinking') : t.title.length > 48 ? `${t.title.slice(0, 47)}…` : t.title
  const hasPlan = t.steps.length > 0 || isDone
  const title =
    theme === 'rainbow' ? (
      <Text bold wrap="truncate">
        {mark}{' '}
        {rainbow(name).map(({ ch, color }) => (
          <Text color={color}>{ch}</Text>
        ))}
      </Text>
    ) : (
      <Text color={accent} bold wrap="truncate">
        {mark} {name}
      </Text>
    )
  const detail = [hasPlan ? stepLabel(t) : '', elapsed((t.doneAt ?? clock) - t.startedAt)]
    .filter(part => part !== '')
    .join(' · ')
  // Every step still to do is listed; only a long plan is cut, with a count of
  // what is left. Finished steps are in the step label, and a finished task is one line.
  const todo = isDone || isCollapsed ? [] : t.steps.filter(step => step.status !== 'completed')
  const rest = todo.length > 6 ? todo.slice(0, 5) : todo
  const hidden = todo.length - rest.length
  return (
    <Box flexDirection="column" paddingX={1}>
      <Box gap={1}>
        <Box flexShrink={1}>{title}</Box>
        {hasPlan && <Box flexShrink={0}>{meter}</Box>}
        {hasPlan && (
          <Box flexShrink={0}>
            <Text color={accent} bold>{`${percent}%`}</Text>
          </Box>
        )}
        <Box flexShrink={0}>
          <Text dimColor>{detail}</Text>
        </Box>
      </Box>
      {rest.map(step => {
        const isNow = step.status === 'in_progress'
        return (
          <Text key={`step-${step.id}`} color={isNow ? accent : undefined} bold={isNow} dimColor={!isNow} wrap="truncate">
            {isNow ? '◉' : '○'} {step.text}
          </Text>
        )
      })}
      {hidden > 0 && <Text dimColor>{phrase(lng, 'moreTasks', { n: hidden })}</Text>}
    </Box>
  )
}

// Diagnostic: the last key events the menu received, in ~/.claude/claude-cli-mod/keys.log.
const keyLog: string[] = []
async function logKey($: EngineInterface, line: string) {
  keyLog.push(`${new Date().toISOString().slice(11, 23)} ${line}`)
  if (keyLog.length > 60) keyLog.shift()
  try {
    await $.fs.write(`${await homeDir($)}/.claude/claude-cli-mod/keys.log`, `${keyLog.join('\n')}\n`)
  } catch {}
}

// The visual row a focusable element sits in. Elements drawn side by side share
// one; every other element is a row of its own.
function rowOf(key: string) {
  if (key.startsWith('tab-')) return 'tabs'
  if (key.startsWith('model-')) return 'models'
  if (key.startsWith('effort-')) return 'efforts'
  if (key.startsWith('default-mode-')) return 'default-modes'
  if (key.startsWith('zen-theme-')) return 'zen-themes'
  if (key === 'zen-on' || key === 'zen-off') return 'zen-onoff'
  if (key === 'status-on' || key === 'status-off') return 'status-onoff'
  if (key.startsWith('lang-')) return 'languages'
  if (key === 'themes-reset' || key === 'themes-refresh') return 'theme-actions'
  return key
}

// Up and down walk the rows, keeping the column: the element above or below, not
// the next one in Tab order.
function neighbour(order: readonly string[], from: string | null, by: number) {
  const rows: string[][] = []
  for (const key of order) {
    const last = rows[rows.length - 1]
    if (last !== undefined && rowOf(last[0]!) === rowOf(key)) last.push(key)
    else rows.push([key])
  }
  const at = from === null ? -1 : rows.findIndex(r => r.includes(from))
  if (at === -1) return (by > 0 ? rows[0] : rows[rows.length - 1])?.[0]
  const column = rows[at]!.indexOf(from!)
  const row = rows[Math.max(0, Math.min(rows.length - 1, at + Math.sign(by)))]!
  return row[Math.min(column, row.length - 1)]
}

// Moves the menu to another tab.
async function goTo($: EngineInterface, panel: Panel) {
  await update($, menu, () => panel)
  if (panel === 'themes') {
    await revealKept($)
    void ensureThemes($)
  }
  await fitPane($)
}

// Each page asks for its own height (no focus flag: the keyboard stays put).
async function fitPane($: EngineInterface) {
  const panel = await read($, menu)
  if (panel === null) return
  // Rows a page gains: the custom color inputs, the bypass-permissions warning.
  const customInputs = panel === 'zen' && (await read($, zenTheme)) === 'custom' ? 3 : 0
  const chosen = (await read($, defaultModeChosen)) ? await read($, defaultMode) : ((await read($, mode)) ?? (await read($, defaultMode)))
  const warning = panel === 'mode' && chosen === 'bypassPermissions' ? 1 : 0
  const size = paneSize(panel)
  await $.ui
    .open({ id: PANE, title: MENU_NAME, closeOnEscape: true, holdToasts: true, rows: size.rows + customInputs + warning, columns: size.columns })
    .catch(() => {})
}

async function closeMenu($: EngineInterface) {
  paneWasFocused = false
  // A plugin's own close skips its own ui.close hook, so reset here too.
  await $.ui.close({ id: PANE }).catch(() => {})
  await update($, menu, () => null)
  focusedKey = null
}

// Gives the open menu the keyboard back and puts the focus ring on the current
// tab, so the arrows work again after a second /tools.
async function refocusPane($: EngineInterface, panel: Panel) {
  focusedKey = null
  const opened = await $.ui.open({ id: PANE, title: MENU_NAME, focus: true, closeOnEscape: true, holdToasts: true, ...paneSize(panel) })
  if (!opened.isPlaced) return
  const key = `tab-${panel === 'main' ? 'zen' : panel}`
  const moved = await $.ui.focus({ requestId: PANE, key }).catch(() => ({ deny: 'focus unavailable' }))
  if (moved.deny === undefined) focusedKey = key
}

// Opens the menu in its pane with the keyboard, or closes it.
async function toggleMenu($: EngineInterface, panel: Panel = 'zen') {
  if ((await read($, menu)) !== null) {
    await closeMenu($)
    return
  }
  await update($, menu, () => panel)
  if (panel === 'themes') {
    await revealKept($)
    void ensureThemes($)
  }
  // focus + closeOnEscape + holdToasts make the pane behave as a dialog: it takes
  // the keys, Tab and the arrows walk its buttons, Esc closes it.
  await $.ui.open({ id: PANE, title: MENU_NAME, focus: true, closeOnEscape: true, holdToasts: true, ...paneSize(panel) })
}

// The theme list scrolls on its own, inside a pane exactly the body's height,
// so the tabs above it stay where they are.
// Rows the themes page takes besides the list: the title and tab strip (2),
// the kept theme, the search, the actions, a status line while there is one,
// and one spare in case a row wraps.
const listRows = (bodyRows: number, hasStatus: boolean) => Math.max(3, bodyRows - (2 + 3 + (hasStatus ? 1 : 0) + 1))

async function foundThemes($: EngineInterface) {
  const query = (await read($, themeQuery)).trim().toLowerCase()
  return (await read($, themes)).filter(th => th.name.toLowerCase().includes(query))
}

// Moves the list's window to `top`, kept inside the list.
async function scrollThemes($: EngineInterface, top: number, bodyRows: number) {
  const rows = listRows(bodyRows, (await read($, themeStatus)) !== '')
  const last = Math.max(0, (await foundThemes($)).length - rows)
  const at = Math.max(0, Math.min(last, top))
  if (at !== (await read($, themeScroll))) await update($, themeScroll, () => at)
}

// Opens the list with the kept theme in view, a few rows down from the top.
async function revealKept($: EngineInterface) {
  const kept = ((await $.store.get('theme')) as { slug: string } | undefined)?.slug
  const at = kept === undefined ? -1 : (await foundThemes($)).findIndex(th => th.slug === kept)
  await update($, themeScroll, () => Math.max(0, at - 3))
}

async function setLang($: EngineInterface, next: Lang) {
  await update($, lang, () => next)
  await $.store.set('lang', next)
}

const TABS: readonly { panel: Exclude<Panel, 'main'>; name: Phrase }[] = [
  { panel: 'zen', name: 'tabZen' },
  { panel: 'mode', name: 'tabMode' },
  { panel: 'themes', name: 'tabThemes' },
  { panel: 'status', name: 'tabStatus' },
]

// Text in the rainbow, one color a letter.
const rainbow = (text: string) => [...text].map((ch, i) => ({ ch, color: RAINBOW[i % RAINBOW.length]! }))

// The menu: a tab row with its close, the tab's settings, the language row.
// Each setting is a chip, one per Button, so the arrow keys walk them.
async function drawPane($: EngineInterface, e: RenderInput<'Pane'>, panel: Panel) {
  if (e.surface !== 'terminal' && e.surface !== 'desktop') return null
  const { Box, Text, Button, Input } = $.ui.resolve(e)
  const tab: Exclude<Panel, 'main'> = panel === 'main' ? 'zen' : panel
  const lng = await read($, lang)
  const t = (key: Phrase, vars?: Record<string, string | number>) => phrase(lng, key, vars)
  const background = (await read($, paneBg)) ?? PANE_BACKGROUND
  const columns = Math.min(e.props.bodyColumns ?? PANE_SIZE.columns, CONTENT_COLUMNS)
  const rule = <Text dimColor>{'─'.repeat(Math.max(10, columns - 2))}</Text>

  // A chip: a framed button, the chosen one framed and written in the accent
  // color (or `frame`), the rest in a dim frame. The frame's key is the
  // Button's with `-box`.
  const framed = (key: string, isOn: boolean, button: RenderChildren, frame?: string) => (
    <Box key={`${key}-box`}>
      {button}
    </Box>
  )
  const chip = (key: string, label: string, isOn: boolean, onPress: () => unknown, color?: string) =>
    framed(
      key,
      isOn,
      <Button key={reg(key)} plain label={label} onPress={onPress}>
        <Text bold={isOn} dimColor={!isOn} color={isOn ? 'claude' : color}>
          {isOn ? ` ✓ ${label} ` : ` ${label} `}
        </Text>
      </Button>,
    )
  const chips = (key: string, items: RenderChildren[]) => (
    <Box key={key} flexWrap="wrap" columnGap={1}>
      {items}
    </Box>
  )
  const check = (isOn: boolean) => isOn && <Text color="claude">{' ✓'}</Text>
  // What is set now, written beside a section's heading.
  const current = (value: RenderChildren) => (
    <Text>
      <Text dimColor>{t('current')}: </Text>
      <Text bold color="claude">{value}</Text>
    </Text>
  )
  // Swatches: one square a color, a space between.
  const swatches = (colors: readonly string[]) => (
    <Text>
      {colors.map(c => (
        <Text color={c}>{'■ '}</Text>
      ))}
    </Text>
  )
  const heading = (text: string, extra?: RenderChildren) => (
    <Box key={`h-${text}`} marginTop={1} gap={1}>
      <Text dimColor bold>{`╴ ${text.toUpperCase()}`}</Text>
      {extra}
    </Box>
  )

  // Every focusable element, in the order it is drawn (see paneOrder).
  const order: string[] = []
  const reg = (key: string) => {
    order.push(key)
    return key
  }
  const rows: RenderChildren[] = []

  if (tab === 'zen') {
    const isZenOn = await read($, zenOn)
    const zenThemeNow = await read($, zenTheme)
    const custom = await read($, zenCustom)
    rows.push(
      heading(t('zenMode'), current(isZenOn ? t('on') : t('off'))),
      chips('zen-onoff', [
        chip('zen-on', t('on'), isZenOn, () => setZenOn($, true)),
        chip('zen-off', t('off'), !isZenOn, () => setZenOn($, false)),
      ]),
      heading(t('bandColor'), current(zenThemeNow)),
      <Box key="zen-themes" flexWrap="wrap" columnGap={2}>
        {ZEN_THEMES.map(theme => {
          const isOn = theme === zenThemeNow
          const dot = theme === 'rainbow' ? RAINBOW.slice(0, 3) : [colorsFor(theme, custom).bar]
          return (
            <Button key={reg(`zen-theme-${theme}`)} plain label={theme} onPress={() => setZenTheme($, theme)}>
              {swatches(dot)}
              <Text bold={isOn} dimColor={!isOn} underline={isOn} color={isOn ? 'claude' : undefined}>{isOn ? `${theme} ✓` : theme}</Text>
            </Button>
          )
        })}
      </Box>,
    )
    if (zenThemeNow === 'custom') {
      rows.push(
        <Box key="zen-custom" flexDirection="column">
          {(['bar', 'text', 'border'] as const).map(part => (
            <Input
              key={reg(`zen-color-${part}`)}
              label={`${part} ${t('colorSuffix')}`}
              value={custom[part]}
              placeholder="#3b82f6"
              submitLabel="set"
              onSubmit={value => setZenColor($, part, value)}
            />
          ))}
        </Box>,
      )
    }
  }

  if (tab === 'themes') {
    const list = await read($, themes)
    const query = await read($, themeQuery)
    const status = await read($, themeStatus)
    const busy = await read($, isDownloading)
    const kept = ((await $.store.get('theme')) as { slug: string } | undefined)?.slug ?? null
    const found = await foundThemes($)
    if (list.length === 0) {
      rows.push(
        <Text key="themes-wait" dimColor>
          {status || t('themesWait')}
        </Text>,
      )
      if (!busy) rows.push(<Button key={reg('themes-download')} plain label={t('themesRetry')} onPress={() => ensureThemes($)} />)
    } else {
      const top = await read($, themeScroll)
      const shown = listRows(e.props.scroll.bodyRows, status !== '')
      const below = Math.max(0, found.length - top - shown)
      rows.push(
        <Box key="themes-current" justifyContent="space-between" gap={1} flexShrink={0}>
          <Text wrap="truncate">
            <Text dimColor>{t('kept')} </Text>
            <Text bold>{(await read($, themeName)) ?? t('claudeDefault')}</Text>
          </Text>
          <Text dimColor>{top > 0 || below > 0 ? `${top + 1}–${Math.min(found.length, top + shown)}/${found.length}` : ''}</Text>
        </Box>,
        <Input
          key={reg('themes-search')}
          label={t('search')}
          value={query}
          placeholder={t('themesCount', { n: list.length })}
          onInput={value => update($, themeQuery, () => value).then(() => update($, themeScroll, () => 0))}
          onSubmit={value => update($, themeQuery, () => value).then(() => update($, themeScroll, () => 0))}
        />,
        <Box key="themes-actions" columnGap={2} flexWrap="wrap" flexShrink={0}>
          <Button key={reg('themes-reset')} plain label={t('defaultTheme')} onPress={themeAction($, () => applyTheme($, null))}>
            <Text bold={kept === null} dimColor={kept !== null} color={kept === null ? 'claude' : undefined}>
              {kept === null ? `✓ ${t('defaultTheme')}` : t('defaultTheme')}
            </Text>
          </Button>
          <Button key={reg('themes-refresh')} plain dimColor label={t('downloadAgain')} onPress={themeAction($, () => downloadThemes($))} />
        </Box>,
      )
      if (status !== '') {
        rows.push(
          <Text key="themes-status" color="claude" wrap="truncate">
            {status}
          </Text>,
        )
      }
      if (found.length === 0) {
        rows.push(
          <Text key="themes-none" dimColor>
            {t('themesNone', { q: query })}
          </Text>,
        )
      }
      // A window over the list, a little longer than the room so the focus
      // ring can step past its last row (the window then follows it).
      rows.push(
        ...found.slice(top, top + shown + 2).map(th => {
          const isKept = th.slug === kept
          return (
            <Button key={reg(`theme:${th.slug}`)} plain label={th.name} onPress={themeAction($, () => applyTheme($, th.slug))}>
              {swatches(th.colors)}
              <Text bold={isKept}>{th.name}</Text>
              {check(isKept)}
            </Button>
          )
        }),
      )
    }
  }

  if (tab === 'mode') {
    const running = await read($, mode)
    const family = modelFamily(await read($, sessionModel))
    const level = (await read($, effort)) ?? (await read($, sessionEffort))
    // Marked: what this session runs in, until a new-session mode is chosen here.
    const next = (await read($, defaultModeChosen)) ? await read($, defaultMode) : (running ?? (await read($, defaultMode)))
    const switchModel = (alias: string) => () =>
      setModel($, alias).catch((error: unknown) => $.ui.toast(`Could not switch the model: ${String(error)}`))
    const meter = (
      <Text>
        {EFFORTS.map((l, i) =>
          level !== null && i <= EFFORTS.indexOf(level) ? (
            <Text color={level === 'max' ? RAINBOW[i * 2] : (EFFORT_HEAT[l] ?? undefined)}>▰</Text>
          ) : (
            <Text dimColor>▱</Text>
          ),
        )}
      </Text>
    )
    rows.push(
      heading(t('model'), current(MODELS.find(m => m.alias === family)?.label ?? '—')),
      chips('models', [
        ...MODELS.map(m => chip(`model-${m.alias}`, m.label, m.alias === family, switchModel(m.alias))),
        <Button key={reg('model-default')} plain dimColor label={t('modelDefault')} onPress={switchModel('default')} />,
      ]),
      heading(
        t('effort'),
        <Box gap={1}>
          {current(level ?? '—')}
          {meter}
        </Box>,
      ),
      chips(
        'efforts',
        EFFORTS.map(l => {
          const heat = EFFORT_HEAT[l]
          const isOn = l === level
          const press = () => setEffort($, l)
          // Cool blue up to red hot; max is the whole rainbow.
          const label =
            heat === null ? (
              <Text bold={isOn}>
                {isOn && '✦ '}
                {rainbow(l).map(({ ch, color }) => (
                  <Text color={color}>{ch}</Text>
                ))}
              </Text>
            ) : isOn ? (
              <Text bold color={heat}>{` ✓ ${l} `}</Text>
            ) : (
              <Text dimColor>{` ${l} `}</Text>
            )
          return framed(
            `effort-${l}`,
            isOn,
            <Button key={reg(`effort-${l}`)} plain label={l} onPress={press}>
              {label}
            </Button>,
            heat ?? RAINBOW[7],
          )
        }),
      ),
      heading(t('runningIn')),
      <Text key="mode-running">
        {running === null ? t('runningUnknown') : <Text color={MODE_COLORS[running] ?? 'text'}>{modeName(lng, running)}</Text>}
        <Text dimColor> · {t('shiftTab')}</Text>
      </Text>,
      heading(t('newSessions'), current(modeName(lng, next))),
      chips(
        'default-modes',
        MODES.map(m =>
          framed(
            `default-mode-${m}`,
            m === next,
            <Button
              key={reg(`default-mode-${m}`)}
              plain
              label={modeName(lng, m)}
              onPress={() => setDefaultMode($, m).catch((error: unknown) => $.ui.toast(`Could not save the mode: ${String(error)}`))}
            >
              <Text color={MODE_COLORS[m] ?? 'text'} bold={m === next}>
                {m === next ? `✓ ${modeName(lng, m)}` : modeName(lng, m)}
              </Text>
              {m === running && <Text color={MODE_COLORS[m] ?? 'text'}>{` · ${t('now')}`}</Text>}
            </Button>,
          ),
        ),
      ),
    )
    if (next === 'bypassPermissions') {
      rows.push(
        <Text key="mode-warning" color="warning">
          {t('bypassWarning')}
        </Text>,
      )
    }
  }

  if (tab === 'status') {
    const isOn = await read($, statusOn)
    rows.push(
      heading(t('statusLine'), current(isOn ? t('on') : t('off'))),
      chips('status-onoff', [
        chip('status-on', t('on'), isOn, () =>
          setStatusOn($, true).catch((error: unknown) => $.ui.toast(`Could not turn it on: ${String(error)}`)),
        ),
        chip('status-off', t('off'), !isOn, () =>
          setStatusOn($, false).catch((error: unknown) => $.ui.toast(`Could not turn it off: ${String(error)}`)),
        ),
      ]),
      <Text key="status-note" dimColor>
        {t('statusNote')}
      </Text>,
      heading(t('language')),
      chips(
        'languages',
        LANGS.map(l => chip(`lang-${l.lang}`, l.label, l.lang === lng, () => setLang($, l.lang))),
      ),
    )
  }

  const rowKeys = order.splice(0)

  // Tabs: plain words, the chosen one in the accent color and underlined.
  const tabStrip = (
    <Box key="tabs" flexDirection="column">
      <Box columnGap={1}>
        <Text bold color="claude">{'✦'}</Text>
        {TABS.map(({ panel: p, name }) => {
          const isOn = p === tab
          return (
            <Button key={`tab-${p}`} plain label={t(name)} autoFocus={isOn ? true : undefined} onPress={() => goTo($, p)}>
              {isOn ? (
                <Text bold color="claude" underline>
                  {` ${t(name)} `}
                </Text>
              ) : (
                <Text dimColor>{` ${t(name)} `}</Text>
              )}
            </Button>
          )
        })}
      </Box>
      {rule}
    </Box>
  )

  // Top to bottom as drawn: the close mark, the tabs, the page, the language row.
  paneOrder = [...TABS.map(x => `tab-${x.panel}`), ...rowKeys, ...order.splice(0)]

  // The themes page is exactly the body's height, its list scrolling inside;
  // the other pages grow, the footer at the bottom while they fit.
  const isThemes = tab === 'themes'
  return (
    <Box
      flexDirection="column"
      paddingX={1}
      width={columns}
      height={isThemes ? e.props.scroll.bodyRows + 1 : undefined}
      minHeight={isThemes ? undefined : e.props.scroll.bodyRows + 1}
    >
      {tabStrip}
      <Box flexDirection="column" flexGrow={1} flexShrink={1} overflow={isThemes ? 'hidden' : undefined}>
        {rows}
      </Box>
      {/* One row taller than the window: the engine only turns an arrow key into a
          scroll (which the ui.scroll hook turns into a focus move) while the page
          has a row to scroll. The row is empty and never shown, the window stays put. */}
      <Box key="arrow-spacer" height={1} flexShrink={0} />
    </Box>
  )
}

// The row under the prompt: with the status line on, the status line with the
// claude-cli-mod button at its end, and under it, while Claude has a background
// shell or monitor running, the engine's pill for them; otherwise the hint and
// the button.
// The engine's hint, on one row: it can carry a second line holding only a
// separator, which drew as a stray dot under the hint.
function hintText(hint: string) {
  return hint
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => /[\p{L}\p{N}]/u.test(line))
    .join(' · ')
}

async function drawPromptHint($: EngineInterface, e: RenderInput<'PromptHint'>) {
  const { Box, Text, Button } = $.ui.resolve(e)
  const isOpen = (await read($, menu)) !== null
  const shownEffort = (await read($, effort)) ?? (await read($, sessionEffort))
  const label = ' menu (/tools) '
  const button = <Button key="tools-toggle" plain label={label} onPress={() => toggleMenu($)} />
  const snapshot = (await read($, statusOn)) ? await read($, status) : null

  // The engine keeps its mode label (⏵⏵ auto mode on ·) in a column of its own
  // to the left of this tree, so the tree grows into the rest of one row: a
  // full-width or multi-row tree wraps that label and pushes everything right.
  if (snapshot === null) {
    return (
      <Box justifyContent="space-between" flexGrow={1} gap={1}>
        <Text dimColor wrap="truncate">
          {hintText(e.props.hint)}
        </Text>
        {button}
      </Box>
    )
  }

  const now = await read($, statusClock)
  const cache = cacheState(await read($, lastResponseAt), now)
  const columns = e.viewport?.columns ?? 120
  const sep = <Text dimColor>{'  │  '}</Text>
  const bar = (percent: number, color: string) => (
    <Text>
      <Text color={color}>{'█'.repeat(barFill(percent))}</Text>
      <Text dimColor>{'░'.repeat(BAR_WIDTH - barFill(percent))}</Text>{' '}
    </Text>
  )

  const ctxPercent = Math.round(snapshot.ctxPercent ?? 0)
  const ctxTokens =
    snapshot.ctxTokens === null ? '' : ` ${fmtTokens(snapshot.ctxTokens)}${snapshot.ctxWindow ? `/${fmtTokens(snapshot.ctxWindow)}` : ''}`
  const limits = snapshot.limits.map(l => ({
    ...l,
    percentText: `${l.percent}%`,
    resetText: l.resetsAt === null ? '' : ` (resets ${fmtDuration(l.resetsAt - now)})`,
  }))
  const cacheText = cache === null ? '' : `● cache ${cache}`
  const model = prettyModel(snapshot.model)
  const head = `${model}${shownEffort === null || shownEffort === undefined ? '' : ` ${shownEffort}`}${snapshot.branch === '' ? '' : ` · ${snapshot.branch}`}`
  // One row beside the engine's mode label (about MODE_LABEL_COLUMNS wide):
  // the most detailed level that leaves room for the button; past the least
  // detailed one, the model and folder go too.
  const room = columns - MODE_LABEL_COLUMNS - label.length - 4
  const fits = (d: Detail, withHead: boolean) =>
    statsWidth(`${ctxPercent}%${ctxTokens}`, limits, cacheText, d) + (withHead ? head.length + 5 : 0) <= room
  const showHead = fits(2, true)
  const detail: Detail = ([0, 1, 2] as const).find(d => fits(d, showHead)) ?? 2

  const stats = [
    showHead && (
      <Text key="head">
        <Text color={STATUS_CYAN}>{model}</Text>
        {shownEffort ? <Text color={STATUS_CYAN}>{` ${shownEffort}`}</Text> : null}
        {snapshot.branch !== '' && <Text dimColor> · </Text>}
        {snapshot.branch !== '' && <Text color={STATUS_GREEN}>{snapshot.branch}</Text>}
        {sep}
      </Text>
    ),
    <Text key="ctx">
      <Text>ctx </Text>
      {detail === 0 && bar(ctxPercent, colorFor(ctxPercent))}
      <Text bold color={colorFor(ctxPercent)}>{`${ctxPercent}%`}</Text>
      <Text dimColor>{ctxTokens}</Text>
    </Text>,
    ...limits.map(l => (
      <Text key={`limit-${l.label}`}>
        {sep}
        <Text>{l.label} </Text>
        {detail === 0 && bar(l.percent, colorFor(l.percent))}
        <Text bold color={colorFor(l.percent)}>{l.percentText}</Text>
        {detail < 2 && <Text dimColor>{l.resetText}</Text>}
      </Text>
    )),
    cache !== null && (
      <Text key="cache">
        {sep}
        <Text color={cache === 'ok' ? STATUS_GREEN : STATUS_RED}>●</Text>
        <Text dimColor> cache {cache}</Text>
      </Text>
    ),
  ]

  const statsRow = (
    <Box justifyContent="space-between" flexGrow={1} gap={1}>
      <Text wrap="truncate">{stats}</Text>
      <Text dimColor>│</Text>
      {button}
    </Box>
  )
  // The status line takes the hint's place, pill and all, so the pill gets a
  // row of its own under it. Still no wider than the space the label leaves.
  const pill = backgroundPill(e.props.hint)
  if (pill === null) return statsRow
  return (
    <Box flexDirection="column" flexGrow={1}>
      {statsRow}
      <Box gap={1}>
        <Button key="background-tasks" plain label={`⎿ ${pill}`} onPress={() => openTasks($)} />
        <Text dimColor wrap="truncate">
          · /tasks to manage
        </Text>
      </Box>
    </Box>
  )
}

async function openTasks($: EngineInterface) {
  try {
    await $.command.run({ command: 'tasks' })
  } catch (error) {
    $.ui.toast(`Could not open /tasks: ${String(error)}`)
  }
}

// `claude-opus-5-5` (what $.session.model() gives) as `Opus 5.5`; a name
// that is not a Claude model id stays as it is.
function prettyModel(id: string) {
  const match = id.match(/^claude-([a-z]+)-(\d+)(?:-(\d+))?/i)
  if (match === null) return id
  const [, family = '', major = '', minor] = match
  return `${family.charAt(0).toUpperCase()}${family.slice(1)} ${major}${minor === undefined ? '' : `.${minor}`}`
}

// The status line's clock: reset countdowns and the cache state move with it.
let statusTicker: Timer | undefined

// Zen's elapsed-time ticker, one per module load.
let ticker: Timer | undefined

function stopTicker() {
  ticker?.cancel()
  ticker = undefined
}

// Puts a fresh task on the band and starts its clock.
async function startTask($: EngineInterface, title: string) {
  const startedAt = await $.clock.now()
  const fresh: ZenTask = { title, startedAt, doneAt: null, steps: [] }
  await update($, task, () => fresh)
  await update($, now, () => startedAt)
  stopTicker()
  ticker = $.clock.every(1000, () => {
    void $.clock.now().then(t => update($, now, () => t))
  })
}

// The kept settings, back into the session's values: at the session's start,
// and after a /clear, which begins a new session with no session.start.
async function restore($: EngineInterface) {
  await loadSettings($)
  await loadThemes($)
  await loadStatus($)
  await loadSessionEffort($)
  try {
    await trackModel($, await $.session.model())
  } catch {}
  await refreshPaneBg($)
}

// Hooks ------------------------------------------------------------------------

// Watching hooks end in .catch(... next(e)): when one fails, the event goes on.

// The pane body's rows, as last drawn: the focus hook's measure of the list.
let paneRows: number | undefined

// The pane's focusable elements in Tab order, as last drawn, and the one holding the focus ring:
// the arrows (which the engine would scroll the body with) walk this list instead.
let paneOrder: string[] = []
let focusedKey: string | null = null
// True once the person has held the keyboard in the open menu: losing it later
// (back to the chat) closes the menu.
let paneWasFocused = false

export const register: Register = on => {

  on('session.end', async ($, e, next) => {
    // This tab's Windows Terminal profile, or the terminal, gets its own
    // colors back. A /clear goes on in the same process and tab, so it keeps the theme.
    try {
      if (e.reason !== 'clear') {
        if (await isWindows($)) await paintWindowsTerminal($, null)
        else await paintOsc($, null)
      }
    } catch {}
    return next(e)
  }).catch(($, e, next) => next(e))

  // /clear: a new session, with the engine's defaults in every value and no
  // session.start, so the kept settings (Zen, effort, the model's mark) come back here.
  on('classic.SessionStart', async ($, e, next) => {
    const ran = await next(e)
    if (e.source === 'clear') {
      // The menu's pane outlives the session it was opened in: close it.
      await $.ui.close({ id: PANE }).catch(() => {})
      await update($, menu, () => null)
      await restore($)
    }
    return ran
  }).catch(($, e, next) => next(e))

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await restore($)
    statusTicker?.cancel()
    statusTicker = $.clock.every(15_000, () => {
      void update($, statusClock, () => Date.now())
    })
    try {
      await $.tool.register({ name: ZEN_TOOL_NAME, description: ZEN_TOOL_DESCRIPTION, inputSchema: ZEN_TOOL_SCHEMA })
    } catch {}
    await $.command.register({
      name: 'tools',
      description: 'Open the claude-cli-mod menu: Zen mode, themes, mode and status line',
      argumentHint: '[zen|themes|mode|status|debug]',
      immediate: true,
    })
    await $.command.register({
      name: 'zen',
      description: 'Zen mode: /zen on or /zen off turns it on or off; /zen hide folds the subtasks, /zen show brings them back',
      argumentHint: '[on|off|hide|show]',
      immediate: true,
    })
    return started
  })

  // on / off turn the mode itself on and off (the ON / OFF chips of the menu); hide / show
  // only fold the subtasks inside the band. No argument toggles the mode.
  on('command.run', { command: 'zen' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    const hide = ['hide', 'ocultar', 'esconder', 'fold'].includes(arg)
    const show = ['show', 'mostrar', 'unfold'].includes(arg)
    if (hide || show) {
      await setZenCollapsed($, hide)
      return { text: hide ? 'Zen: subtasks hidden (/zen show to bring them back).' : 'Zen: subtasks shown (/zen hide to fold them).' }
    }
    const turnOn = ['on', 'ativar', 'ligar'].includes(arg) ? true : ['off', 'desativar', 'desligar'].includes(arg) ? false : !(await read($, zenOn))
    await setZenOn($, turnOn)
    return { text: turnOn ? 'Zen: on (/zen off to turn it off).' : 'Zen: off (/zen on to turn it back on).' }
  })

  on('command.run', { command: 'tools' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg === 'debug') {
      const rows = await $.config.list()
      return { text: rows.map(r => `${r.key} (${r.kind}) = ${JSON.stringify(r.value)}`).join('\n') }
    }
    const panel: Panel = arg === 'themes' || arg === 'mode' || arg === 'status' ? arg : 'zen'
    if ((await read($, menu)) !== null) {
      await goTo($, panel)
      await refocusPane($, panel)
    } else await toggleMenu($, panel)
    return { text: 'claude-cli-mod is open.' }
  })

  // The menu's pane.
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    paneRows = e.props.scroll.bodyRows
    // The keyboard went back to the chat: close the menu on its own.
    if (e.props.isFocused) paneWasFocused = true
    else if (paneWasFocused) void closeMenu($)
    const panel = await read($, menu)
    const drawn = panel === null ? null : await drawPane($, e, panel)
    return drawn ?? $.ui.resolve(e).Text({ children: '' })
  })

  // However the pane closes (esc, its close mark, the corner button), the menu resets.
  on('ui.close', { id: PANE }, async ($, e, next) => {
    paneWasFocused = false
    const closed = await next(e)
    await update($, menu, () => null)
    focusedKey = null
    return closed
  }).catch(($, e, next) => next(e))

  // Themes: the wheel and the scroll keys move the theme list's own window,
  // never the pane, so the tabs and the language row stay put.
  on('ui.scroll', { requestId: PANE }, async ($, e, next) => {
    void logKey($, `scroll by=${e.by} offset=${e.offset} pointer=${e.pointer === undefined ? 'none' : 'yes'} from=${focusedKey}`)
    // An arrow key reaches here as a one-row scroll with no pointer (a wheel tick
    // has one): walk the focus ring instead, up and down in Tab order.
    if (e.pointer === undefined && e.origin.kind === 'person' && Math.abs(e.by) === 1 && paneOrder.length > 0) {
      const to = neighbour(paneOrder, focusedKey, e.by)
      if (to === undefined) return {}
      const moved = await $.ui.focus({ requestId: PANE, key: to })
      if (moved.deny !== undefined) $.ui.toast(`Could not move: ${moved.deny}`)
      return {}
    }
    if ((await read($, menu)) !== 'themes' || e.by === 0) return next(e)
    await scrollThemes($, (await read($, themeScroll)) + e.by, e.bodyRows)
    return {}
  }).catch(($, e, next) => next(e))

  // Themes: the focus ring stepping onto a theme past either end of the
  // window brings it into view.
  on('ui.focus', { requestId: PANE }, async ($, e, next) => {
    void logKey($, `focus from=${focusedKey} to=${e.element ?? '(engine stop)'} origin=${e.origin.kind}`)
    const moved = await next(e)
    if (moved.deny === undefined) focusedKey = e.element ?? null
    const slug = e.element?.startsWith('theme:') ? e.element.slice('theme:'.length) : null
    if (slug === null || (await read($, menu)) !== 'themes') return moved
    const at = (await foundThemes($)).findIndex(th => th.slug === slug)
    const top = await read($, themeScroll)
    const bodyRows = paneRows ?? PANE_SIZE.rows
    const rows = listRows(bodyRows, (await read($, themeStatus)) !== '')
    if (at >= 0 && at < top) await scrollThemes($, at, bodyRows)
    else if (at >= top + rows) await scrollThemes($, at - rows + 1, bodyRows)
    return moved
  }).catch(($, e, next) => next(e))

  // The corner button and, when on, the status line, under the prompt.
  on('ui.render', { component: 'PromptHint' }, async ($, e) => drawPromptHint($, e))

  // The band above the prompt: Zen's progress.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    return (await drawZenBand($, e)) ?? next(e)
  })

  // Zen: tool rows draw nothing while it is on.
  on('ui.render', { component: 'ToolUse' }, async ($, e, next) =>
    (await read($, zenOn)) ? $.ui.resolve(e).Box({ display: 'none' }) : next(e),
  )
  on('ui.render', { component: 'ToolResult' }, async ($, e, next) =>
    (await read($, zenOn)) ? $.ui.resolve(e).Box({ display: 'none' }) : next(e),
  )
  on('ui.render', { component: 'ToolGroup' }, async ($, e, next) =>
    (await read($, zenOn)) ? $.ui.resolve(e).Box({ display: 'none' }) : next(e),
  )
  on('ui.render', { component: 'ToolProgress' }, async ($, e, next) =>
    (await read($, zenOn)) ? $.ui.resolve(e).Box({ display: 'none' }) : next(e),
  )

  // Zen: asks Claude to narrate and keep a task list the band can follow.
  // Zen: each prompt typed starts a new task on the band, and carries the Zen
  // instructions for Claude (read with the prompt, never shown).

  // While the menu is open and the chat box is empty the space bar does nothing: it
  // would type into the chat. Typing a letter closes the menu and goes to the chat.
  on('prompt.edit', async ($, e, next) => {
    if ((await read($, menu)) === null) return next(e)
    const isSpace = e.inputText === ' ' || e.key?.key === ' ' || e.key?.key === 'space'
    // A space with an empty chat box is the menu's own key: it does nothing.
    if (isSpace && e.text === '') return { text: e.text, cursor: e.cursor }
    // Typing anything else is going back to the chat: the menu closes, the text goes in.
    if (e.inputText !== '') await closeMenu($)
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    // Back to the chat: sending a prompt closes the menu.
    if ((await read($, menu)) !== null && !e.text.trim().startsWith('/tools')) await closeMenu($)
    const text = e.text.trim()
    const isTyped = e.origin.kind === 'composer' && text !== '' && !text.startsWith('/')
    if (!isTyped) return next(e)
    if (!(await read($, zenOn))) return next(e)
    // The title stays empty (the band says "thinking") until Claude names the task.
    await startTask($, '')
    return next({ ...e, context: [...(e.context ?? []), ZEN_PROMPT] })
  }).catch(($, e, next) => next(e))

  // Zen: Claude's own progress tool. Each call sends the whole step list.
  on('tool.call', { tool: ZEN_TOOL }, async ($, e) => {
    const input = e as unknown as { title?: unknown; steps?: unknown }
    const steps: ZenStep[] = (Array.isArray(input.steps) ? input.steps : []).flatMap((raw: unknown, i) => {
      const step = raw as { text?: unknown; status?: unknown }
      return typeof step.text === 'string' ? [{ id: `zen-${i}`, text: step.text, status: asStatus(step.status) }] : []
    })
    if ((await read($, task)) === null) await startTask($, '')
    await update($, task, t =>
      t === null ? t : { ...t, title: typeof input.title === 'string' && input.title !== '' ? input.title : t.title, steps },
    )
    const t = await read($, task)
    const done = steps.filter(s => s.status === 'completed').length
    return { result: `Progress band updated: ${done} of ${steps.length} steps done (${t === null ? 0 : percentOf(t)}%).` }
  })

  on('tool.call', { tool: 'TodoWrite' }, async ($, e, next) => {
    const steps: ZenStep[] = e.todos.map((todo, i) => ({
      id: `todo-${i}`,
      text: todo.status === 'in_progress' ? todo.activeForm || todo.content : todo.content,
      status: asStatus(todo.status),
    }))
    await update($, task, t => (t === null ? t : { ...t, steps }))
    return next(e)
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'TaskCreate' }, async ($, e, next) => {
    const ran = await next(e)
    const id = (ran.result as { task?: { id?: string } } | undefined)?.task?.id
    if (id !== undefined) {
      const step: ZenStep = { id, text: e.subject, status: 'pending' }
      await update($, task, t => (t === null ? t : { ...t, steps: [...t.steps.filter(s => s.id !== id), step] }))
    }
    return ran
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'TaskUpdate' }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny !== undefined || ran.isError === true) return ran
    await update($, task, t => {
      if (t === null) return t
      if (e.status === 'deleted') return { ...t, steps: t.steps.filter(s => s.id !== e.taskId) }
      const steps = t.steps.map(s =>
        s.id === e.taskId ? { ...s, text: e.subject ?? s.text, status: e.status ? asStatus(e.status) : s.status } : s,
      )
      return { ...t, steps }
    })
    return ran
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    stopTicker()
    const current = await read($, task)
    if (current !== null && current.doneAt === null) {
      const doneAt = await $.clock.now()
      await update($, task, t => (t === null ? t : { ...t, doneAt }))
      await update($, now, () => doneAt)
      // "Done" stays up for a moment, then the band clears.
      $.clock.after(8000, () => {
        void update($, task, t => (t !== null && t.doneAt === doneAt ? null : t))
      })
    }
    return next(e)
  })

  // Mode: the chosen effort rides on every model request of the session; the
  // main loop's model is noted for the Mode page.
  on('turn.step', async function* ($, e, next) {
    const level = await read($, effort)
    // The session's own level, as the engine would send it, before ours replaces it.
    if (e.agentId === undefined) {
      await trackEffort($, e.effort)
      await trackModel($, e.model)
    }
    const answered = yield* next(level !== null && e.effort !== undefined ? { ...e, effort: level } : e)
    // The main loop's responses keep the prompt cache warm; subagents' do not.
    if (e.agentId === undefined && answered.usage !== null) {
      const at = Date.now()
      await update($, lastResponseAt, () => at)
      await update($, statusClock, () => at)
      if (await read($, statusOn)) void refreshStatus($).catch(() => {})
    }
    return answered
  })

  // Mode: the running permission mode, as the engine reports it to hooks.
  on('classic.UserPromptSubmit', async ($, e, next) => {
    await trackMode($, e.permission_mode)
    return next(e)
  }).catch(($, e, next) => next(e))
  on('classic.PostToolUse', async ($, e, next) => {
    await trackMode($, e.permission_mode)
    // With an override of ours this reports ours, so only record without one.
    if ((await read($, effort)) === null) await trackEffort($, e.effort?.level)
    return next(e)
  }).catch(($, e, next) => next(e))
}
