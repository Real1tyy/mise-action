import * as core from '@actions/core'
import * as fs from 'fs'
import * as glob from '@actions/glob'
import { Tool } from './types'

/**
 * Parse and collect all tools from various configuration sources
 */
export async function getAllTools(): Promise<Tool[]> {
  const tools: Tool[] = []

  // Parse from install_args parameter
  const installArgsTools = parseInstallArgs()
  tools.push(...installArgsTools)

  // Parse from .tool-versions files
  const toolVersionsTools = await parseToolVersionsFiles()
  tools.push(...toolVersionsTools)

  // Parse from mise.toml files
  const miseTomlTools = await parseMiseTomlFiles()
  tools.push(...miseTomlTools)

  // Remove duplicates, preferring more specific sources
  const uniqueTools = deduplicateTools(tools)

  core.info(`Found ${uniqueTools.length} tools to manage`)
  uniqueTools.forEach(tool => {
    core.info(`  - ${tool.name}@${tool.version} (from ${tool.source})`)
  })

  return uniqueTools
}

/**
 * Parse tools from install_args input parameter
 */
function parseInstallArgs(): Tool[] {
  const installArgs = core.getInput('install_args')
  if (!installArgs) return []

  const tools: Tool[] = []
  const args = installArgs
    .split(' ')
    .filter(arg => arg.trim() && !arg.startsWith('-'))

  for (const arg of args) {
    const tool = parseToolSpec(arg, 'install_args')
    if (tool) tools.push(tool)
  }

  return tools
}

/**
 * Parse tools from all .tool-versions files
 */
async function parseToolVersionsFiles(): Promise<Tool[]> {
  const tools: Tool[] = []

  try {
    const globber = await glob.create('**/.tool-versions', {
      followSymbolicLinks: false
    })
    const files = await globber.glob()

    for (const file of files) {
      const fileTools = await parseToolVersionsFile(file)
      tools.push(...fileTools)
    }
  } catch (error) {
    core.warning(`Failed to parse .tool-versions files: ${error}`)
  }

  return tools
}

/**
 * Parse a single .tool-versions file
 */
async function parseToolVersionsFile(filePath: string): Promise<Tool[]> {
  const tools: Tool[] = []

  try {
    const content = await fs.promises.readFile(filePath, 'utf8')
    const lines = content
      .split('\n')
      .filter(line => line.trim() && !line.startsWith('#'))

    for (const line of lines) {
      const [name, version] = line.trim().split(/\s+/)
      if (name && version) {
        tools.push({ name, version, source: '.tool-versions' })
      }
    }
  } catch (error) {
    core.warning(`Failed to parse ${filePath}: ${error}`)
  }

  return tools
}

/**
 * Parse tools from all mise.toml files
 */
async function parseMiseTomlFiles(): Promise<Tool[]> {
  const tools: Tool[] = []

  try {
    const globber = await glob.create('**/mise.toml', {
      followSymbolicLinks: false
    })
    const files = await globber.glob()

    for (const file of files) {
      const fileTools = await parseMiseTomlFile(file)
      tools.push(...fileTools)
    }
  } catch (error) {
    core.warning(`Failed to parse mise.toml files: ${error}`)
  }

  return tools
}

/**
 * Parse a single mise.toml file
 * This is a simplified parser that handles basic [tools] sections
 */
async function parseMiseTomlFile(filePath: string): Promise<Tool[]> {
  const tools: Tool[] = []

  try {
    const content = await fs.promises.readFile(filePath, 'utf8')
    const lines = content.split('\n')

    let inToolsSection = false

    for (const line of lines) {
      const trimmed = line.trim()

      // Check for [tools] section
      if (trimmed === '[tools]') {
        inToolsSection = true
        continue
      }

      // Check for new section
      if (trimmed.startsWith('[') && trimmed !== '[tools]') {
        inToolsSection = false
        continue
      }

      // Parse tool entries in [tools] section
      if (inToolsSection && trimmed && !trimmed.startsWith('#')) {
        const tool = parseTomlToolLine(trimmed)
        if (tool) tools.push(tool)
      }
    }
  } catch (error) {
    core.warning(`Failed to parse ${filePath}: ${error}`)
  }

  return tools
}

/**
 * Parse a single tool line from TOML format
 * Supports formats like: node = "18.17.0", python = {version = "3.11.0"}
 */
function parseTomlToolLine(line: string): Tool | null {
  try {
    const match = line.match(/^(\w+)\s*=\s*(.+)$/)
    if (!match) return null

    const [, name, value] = match
    let version: string

    // Handle simple string format: node = "18.17.0"
    const stringMatch = value.match(/^["']([^"']+)["']$/)
    if (stringMatch) {
      version = stringMatch[1]
    } else {
      // Handle object format: python = {version = "3.11.0"}
      const objectMatch = value.match(/version\s*=\s*["']([^"']+)["']/)
      if (objectMatch) {
        version = objectMatch[1]
      } else {
        return null
      }
    }

    return { name, version, source: 'mise.toml' }
  } catch {
    return null
  }
}

/**
 * Parse a tool specification (e.g., "node@18.17.0", "python@3.11")
 */
function parseToolSpec(spec: string, source: Tool['source']): Tool | null {
  try {
    const parts = spec.split('@')
    if (parts.length !== 2) return null

    const [name, version] = parts
    if (!name || !version) return null

    return { name: name.trim(), version: version.trim(), source }
  } catch {
    return null
  }
}

/**
 * Remove duplicate tools, preferring more specific sources
 * Priority: install_args > mise.toml > .tool-versions
 */
function deduplicateTools(tools: Tool[]): Tool[] {
  const toolMap = new Map<string, Tool>()

  const sourcePriority = {
    install_args: 3,
    'mise.toml': 2,
    '.tool-versions': 1
  }

  for (const tool of tools) {
    const key = tool.name
    const existing = toolMap.get(key)

    if (
      !existing ||
      sourcePriority[tool.source] > sourcePriority[existing.source]
    ) {
      toolMap.set(key, tool)
    }
  }

  return Array.from(toolMap.values()).sort((a, b) =>
    a.name.localeCompare(b.name)
  )
}

/**
 * Generate a stable hash for a tool based on name and version
 */
export function generateToolHash(tool: Tool): string {
  return `${tool.name}-${tool.version}`
}

/**
 * Convert tools list to mise install command arguments
 */
export function toolsToInstallArgs(tools: Tool[]): string {
  return tools.map(tool => `${tool.name}@${tool.version}`).join(' ')
}
