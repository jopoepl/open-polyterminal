import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { AiProvider } from '@/types'

export interface AiRunResult {
  response: string
  success: boolean
  provider: AiProvider
  error?: string
}

export type McpMode = 'env' | 'http' | 'stdio' | 'disabled'
export type McpServerName = 'weather' | 'polymarket' | 'news'

export interface AiMcpServerOverride {
  mode?: McpMode
  url?: string | null
}

export interface AiRunOptions {
  timeoutMs?: number
  enableWebSearch?: boolean
  onOutput?: (event: AiOutputEvent) => void
  mcp?: Partial<Record<McpServerName, AiMcpServerOverride>>

  // Backward compatibility for existing callsites.
  weatherMcpMode?: McpMode
  weatherMcpUrl?: string | null
}

export interface AiOutputEvent {
  stream: 'stdout' | 'stderr'
  text: string
}

interface CliExecution {
  stdout: string
  stderr: string
  code: number | null
  timedOut: boolean
  spawnError?: NodeJS.ErrnoException
}

interface McpServerSpec {
  name: McpServerName
  envPrefix: 'WEATHER_MCP' | 'POLYMARKET_MCP' | 'NEWS_MCP'
  scriptFile: string
}

interface ResolvedMcpServerConfig {
  name: McpServerName
  startupTimeoutSec: number
  toolTimeoutSec: number
  url: string | null
  command: string | null
  args: string[]
  cwd: string | null
}

const MCP_SERVER_SPECS: McpServerSpec[] = [
  {
    name: 'weather',
    envPrefix: 'WEATHER_MCP',
    scriptFile: 'weather-mcp-server.mjs'
  },
  {
    name: 'polymarket',
    envPrefix: 'POLYMARKET_MCP',
    scriptFile: 'polymarket-mcp-server.mjs'
  },
  {
    name: 'news',
    envPrefix: 'NEWS_MCP',
    scriptFile: 'news-mcp-server.mjs'
  }
]

function normalizeUrl(raw?: string | null) {
  const value = raw?.trim()
  if (!value) return null
  try {
    return new URL(value).toString()
  } catch {
    return null
  }
}

function envEnabled(prefix: McpServerSpec['envPrefix']) {
  return process.env[`${prefix}_ENABLED`] !== '0'
}

function envUrl(prefix: McpServerSpec['envPrefix']) {
  return normalizeUrl(process.env[`${prefix}_URL`])
}

function mcpServerPath(spec: McpServerSpec) {
  return path.join(process.cwd(), 'scripts', spec.scriptFile)
}

function mcpNodeBin(prefix: McpServerSpec['envPrefix']) {
  return process.env[`${prefix}_NODE_BIN`]?.trim() || process.execPath || 'node'
}

function mcpStartupTimeoutSec(prefix: McpServerSpec['envPrefix']) {
  const parsed = Number(process.env[`${prefix}_STARTUP_TIMEOUT_SEC`])
  if (Number.isFinite(parsed) && parsed >= 5) return Math.round(parsed)
  return 45
}

function mcpToolTimeoutSec(prefix: McpServerSpec['envPrefix']) {
  const parsed = Number(process.env[`${prefix}_TOOL_TIMEOUT_SEC`])
  if (Number.isFinite(parsed) && parsed >= 5) return Math.round(parsed)
  return 45
}

function tomlString(value: string) {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

function effectiveOverride(spec: McpServerSpec, options: AiRunOptions): AiMcpServerOverride {
  const override = options.mcp?.[spec.name]
  if (override) return override

  if (spec.name === 'weather' && (options.weatherMcpMode || options.weatherMcpUrl)) {
    return {
      mode: options.weatherMcpMode,
      url: options.weatherMcpUrl
    }
  }

  return {}
}

function resolveMcpServerState(spec: McpServerSpec, options: AiRunOptions) {
  const override = effectiveOverride(spec, options)
  const mode = override.mode || 'env'

  if (mode === 'disabled') {
    return { enabled: false, url: null as string | null }
  }

  if (mode === 'http') {
    const url = normalizeUrl(override.url) || envUrl(spec.envPrefix)
    return { enabled: true, url: url || null }
  }

  if (mode === 'stdio') {
    return { enabled: true, url: null as string | null }
  }

  if (!envEnabled(spec.envPrefix)) {
    return { enabled: false, url: null as string | null }
  }

  return {
    enabled: true,
    url: envUrl(spec.envPrefix)
  }
}

function resolveMcpConfigs(options: AiRunOptions) {
  const projectRoot = process.cwd()
  const configs: ResolvedMcpServerConfig[] = []

  for (const spec of MCP_SERVER_SPECS) {
    const state = resolveMcpServerState(spec, options)
    if (!state.enabled) continue

    configs.push({
      name: spec.name,
      url: state.url,
      command: state.url ? null : mcpNodeBin(spec.envPrefix),
      args: state.url ? [] : [mcpServerPath(spec)],
      cwd: state.url ? null : projectRoot,
      startupTimeoutSec: mcpStartupTimeoutSec(spec.envPrefix),
      toolTimeoutSec: mcpToolTimeoutSec(spec.envPrefix)
    })
  }

  return configs
}

function codexMcpConfigArgs(options: AiRunOptions) {
  const configs = resolveMcpConfigs(options)
  if (!configs.length) return []

  const args: string[] = []

  for (const config of configs) {
    const baseKey = `mcp_servers.${config.name}`

    if (config.url) {
      args.push('-c', `${baseKey}.url=${tomlString(config.url)}`)
    } else {
      if (config.command) {
        args.push('-c', `${baseKey}.command=${tomlString(config.command)}`)
      }
      if (config.args.length) {
        args.push('-c', `${baseKey}.args=[${config.args.map((entry) => tomlString(entry)).join(',')}]`)
      }
      if (config.cwd) {
        args.push('-c', `${baseKey}.cwd=${tomlString(config.cwd)}`)
      }
    }

    args.push('-c', `${baseKey}.startup_timeout_sec=${config.startupTimeoutSec}`)
    args.push('-c', `${baseKey}.tool_timeout_sec=${config.toolTimeoutSec}`)
  }

  return args
}

async function writeClaudeMcpConfig(tempDir: string, options: AiRunOptions) {
  const configs = resolveMcpConfigs(options)
  if (!configs.length) return null

  const configPath = path.join(tempDir, 'claude-mcp.json')
  const mcpServers: Record<string, unknown> = {}

  for (const config of configs) {
    mcpServers[config.name] = config.url
      ? {
          type: 'http',
          url: config.url
        }
      : {
          command: config.command,
          args: config.args,
          cwd: config.cwd
        }
  }

  const payload = { mcpServers }
  await writeFile(configPath, JSON.stringify(payload), 'utf8')
  return configPath
}

function parseTimeout(options: AiRunOptions) {
  const value = options.timeoutMs
  if (!value || Number.isNaN(value) || value <= 0) return 30_000
  return Math.round(value)
}

function executeCli(
  command: string,
  args: string[],
  timeoutMs: number,
  onOutput?: (event: AiOutputEvent) => void
): Promise<CliExecution> {
  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''
    let timedOut = false
    let spawnError: NodeJS.ErrnoException | undefined

    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe']
    })

    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, timeoutMs)

    child.stdout.on('data', (chunk) => {
      const text = chunk.toString()
      stdout += text
      onOutput?.({ stream: 'stdout', text })
    })

    child.stderr.on('data', (chunk) => {
      const text = chunk.toString()
      stderr += text
      onOutput?.({ stream: 'stderr', text })
    })

    child.on('error', (error) => {
      spawnError = error
    })

    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({
        stdout,
        stderr,
        code,
        timedOut,
        spawnError
      })
    })
  })
}

function normalizeErrorMessage(stderr: string, fallback: string) {
  const cleaned = stderr.trim()
  if (!cleaned) return fallback
  const line = cleaned.split('\n').find((part) => part.trim()) || cleaned
  return line.trim()
}

async function runClaudePrompt(prompt: string, options: AiRunOptions): Promise<AiRunResult> {
  const timeoutMs = parseTimeout(options)
  const claudeBin = process.env.CLAUDE_BIN || 'claude'
  const tempDir = await mkdtemp(path.join(tmpdir(), 'polyterminal-claude-'))
  const args = []

  try {
    const mcpConfigPath = await writeClaudeMcpConfig(tempDir, options)
    if (mcpConfigPath) {
      args.push('--mcp-config', mcpConfigPath, '--strict-mcp-config')
    }

    if (options.enableWebSearch) {
      args.push(
        '--append-system-prompt',
        'Web research is allowed only for evidence directly related to this scoped market question and Polymarket settlement context.'
      )
    }

    args.push('-p', prompt)
    const execution = await executeCli(claudeBin, args, timeoutMs, options.onOutput)

    if (execution.spawnError?.code === 'ENOENT') {
      return {
        response: '',
        success: false,
        provider: 'claude',
        error: 'Claude CLI is not installed or not in PATH'
      }
    }

    if (execution.timedOut) {
      return {
        response: '',
        success: false,
        provider: 'claude',
        error: `Claude timed out after ${Math.round(timeoutMs / 1000)}s`
      }
    }

    const response = execution.stdout.trim()
    if (execution.code === 0 && response) {
      return {
        response,
        success: true,
        provider: 'claude'
      }
    }

    return {
      response,
      success: false,
      provider: 'claude',
      error: normalizeErrorMessage(execution.stderr, `Claude exited with code ${execution.code ?? 'unknown'}`)
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {})
  }
}

function getCodexArgs(prompt: string, outputPath: string, options: AiRunOptions = {}) {
  const enableWebSearch = options.enableWebSearch
  const args = [
    ...codexMcpConfigArgs(options),
    ...(enableWebSearch ? ['--search'] : []),
    'exec',
    '--skip-git-repo-check',
    '--color',
    'never',
    '-C',
    process.cwd(),
    '-o',
    outputPath
  ]

  const model = process.env.CODEX_MODEL?.trim()
  if (model) {
    args.push('-m', model)
  }

  args.push(prompt)
  return args
}

async function runCodexPrompt(prompt: string, options: AiRunOptions): Promise<AiRunResult> {
  const timeoutMs = parseTimeout(options)
  const codexBin = process.env.CODEX_BIN || 'codex'
  const tempDir = await mkdtemp(path.join(tmpdir(), 'polyterminal-codex-'))
  const outputPath = path.join(tempDir, 'last-message.txt')

  try {
    const execution = await executeCli(
      codexBin,
      getCodexArgs(prompt, outputPath, options),
      timeoutMs,
      options.onOutput
    )

    if (execution.spawnError?.code === 'ENOENT') {
      return {
        response: '',
        success: false,
        provider: 'codex',
        error: 'Codex CLI is not installed or not in PATH'
      }
    }

    if (execution.timedOut) {
      return {
        response: '',
        success: false,
        provider: 'codex',
        error: `Codex timed out after ${Math.round(timeoutMs / 1000)}s`
      }
    }

    let response = ''

    try {
      response = (await readFile(outputPath, 'utf8')).trim()
    } catch {
      response = execution.stdout.trim()
    }

    if (execution.code === 0 && response) {
      return {
        response,
        success: true,
        provider: 'codex'
      }
    }

    return {
      response,
      success: false,
      provider: 'codex',
      error: normalizeErrorMessage(execution.stderr, `Codex exited with code ${execution.code ?? 'unknown'}`)
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {})
  }
}

export function resolveAiProvider(value?: string): AiProvider {
  const normalized = (value || 'codex').trim().toLowerCase()
  if (normalized === 'codex') return 'codex'
  return 'claude'
}

export async function runAiPrompt(prompt: string, provider: AiProvider, options: AiRunOptions = {}): Promise<AiRunResult> {
  if (provider === 'codex') {
    return runCodexPrompt(prompt, options)
  }

  return runClaudePrompt(prompt, options)
}
