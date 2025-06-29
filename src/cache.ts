import * as cache from '@actions/cache'
import * as core from '@actions/core'
import * as glob from '@actions/glob'
import * as crypto from 'crypto'
import * as fs from 'fs'
import { miseDir, getSystemInfo } from './utils'

/**
 * Restore mise cache based on configuration files
 */
export async function restoreMiseCache(): Promise<string | undefined> {
  core.startGroup('Restoring mise cache')

  try {
    const version = core.getInput('version')
    const installArgs = core.getInput('install_args')
    const { MISE_ENV } = process.env
    const cachePath = miseDir()

    const fileHash = await generateConfigHash()
    const systemInfo = await getSystemInfo()
    const prefix = core.getInput('cache_key_prefix') || 'mise-v0'

    let primaryKey = `${prefix}-${systemInfo.target}-${fileHash}`

    if (version) {
      primaryKey = `${primaryKey}-${version}`
    }

    if (MISE_ENV) {
      primaryKey = `${primaryKey}-${MISE_ENV}`
    }

    if (installArgs) {
      const toolsHash = generateToolsHash(installArgs)
      primaryKey = `${primaryKey}-${toolsHash}`
    }

    // Save state for later use
    core.saveState('PRIMARY_KEY', primaryKey)
    core.saveState('MISE_DIR', cachePath)

    const cacheKey = await cache.restoreCache([cachePath], primaryKey)
    core.setOutput('cache-hit', Boolean(cacheKey))

    if (!cacheKey) {
      core.info(`mise cache not found for ${primaryKey}`)
      return primaryKey
    }

    core.info(`mise cache restored from key: ${cacheKey}`)
    return cacheKey
  } catch (error) {
    core.warning(`Failed to restore mise cache: ${error}`)
    core.setOutput('cache-hit', false)
    return undefined
  } finally {
    core.endGroup()
  }
}

/**
 * Save mise cache
 */
export async function saveMiseCache(cacheKey: string): Promise<void> {
  return core.group('Saving mise cache', async () => {
    const cachePath = miseDir()

    if (!fs.existsSync(cachePath)) {
      throw new Error(`Cache folder path does not exist on disk: ${cachePath}`)
    }

    try {
      const cacheId = await cache.saveCache([cachePath], cacheKey)
      if (cacheId === -1) {
        core.info('Cache not saved (already exists)')
        return
      }

      core.info(`Cache saved from ${cachePath} with key: ${cacheKey}`)
    } catch (error) {
      core.warning(`Failed to save mise cache: ${error}`)
    }
  })
}

/**
 * Generate hash from configuration files
 */
async function generateConfigHash(): Promise<string> {
  const configPatterns = [
    `**/.config/mise/config.toml`,
    `**/.config/mise/config.lock`,
    `**/.config/mise/config.*.toml`,
    `**/.config/mise/config.*.lock`,
    `**/.config/mise.toml`,
    `**/.config/mise.lock`,
    `**/.config/mise.*.toml`,
    `**/.config/mise.*.lock`,
    `**/.mise/config.toml`,
    `**/.mise/config.lock`,
    `**/.mise/config.*.toml`,
    `**/.mise/config.*.lock`,
    `**/mise/config.toml`,
    `**/mise/config.lock`,
    `**/mise/config.*.toml`,
    `**/mise/config.*.lock`,
    `**/.mise.toml`,
    `**/.mise.lock`,
    `**/.mise.*.toml`,
    `**/.mise.*.lock`,
    `**/mise.toml`,
    `**/mise.lock`,
    `**/mise.*.toml`,
    `**/mise.*.lock`,
    `**/.tool-versions`
  ]

  return await glob.hashFiles(configPatterns.join('\n'))
}

/**
 * Generate hash from tools in install arguments
 */
function generateToolsHash(installArgs: string): string {
  const tools = installArgs
    .split(' ')
    .filter((arg: string) => !arg.startsWith('-'))
    .sort()
    .join(' ')

  if (!tools) return ''

  return crypto.createHash('sha256').update(tools).digest('hex')
}
