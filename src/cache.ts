import * as cache from '@actions/cache'
import * as core from '@actions/core'
import * as fs from 'fs'
import * as path from 'path'
import { Tool, ToolCacheInfo, CacheResult } from './types'
import { miseDir, getSystemInfo } from './utils'
import { generateToolHash } from './tools'

/**
 * Restore both global mise cache and individual tool caches
 */
export async function restoreAllCaches(tools: Tool[]): Promise<CacheResult> {
  core.startGroup('Restoring caches')

  try {
    const systemInfo = await getSystemInfo()
    const version = core.getInput('version') || 'latest'
    const keyPrefix = core.getInput('cache_key_prefix') || 'mise-v1'

    // Restore global mise cache
    const globalCacheHit = await restoreGlobalMiseCache(
      systemInfo.target,
      version,
      keyPrefix
    )

    // Restore individual tool caches
    const toolCacheResults = await restoreToolCaches(
      tools,
      systemInfo.target,
      keyPrefix
    )

    const cachedTools = toolCacheResults.filter(t => t.isRestored).length
    const missingTools = toolCacheResults
      .filter(t => !t.isRestored)
      .map(t => t.tool)

    const result: CacheResult = {
      globalCacheHit,
      toolCacheResults,
      totalTools: tools.length,
      cachedTools,
      missingTools
    }

    // Set outputs for GitHub Actions
    setOutputs(result)
    logCacheResults(result)

    return result
  } catch (error) {
    core.warning(`Failed to restore caches: ${error}`)
    return {
      globalCacheHit: false,
      toolCacheResults: tools.map(tool => ({
        tool,
        cacheKey: '',
        cachePath: '',
        isRestored: false
      })),
      totalTools: tools.length,
      cachedTools: 0,
      missingTools: tools
    }
  } finally {
    core.endGroup()
  }
}

/**
 * Restore global mise binary cache
 */
async function restoreGlobalMiseCache(
  target: string,
  version: string,
  keyPrefix: string
): Promise<boolean> {
  const globalCacheKey = `${keyPrefix}-${target}-${version}-global`
  const miseCachePath = path.join(miseDir(), 'bin')

  core.info(`Checking global mise cache: ${globalCacheKey}`)

  try {
    const cacheKey = await cache.restoreCache([miseCachePath], globalCacheKey)
    const hit = Boolean(cacheKey)

    if (hit) {
      core.info(`✓ Global mise cache restored: ${cacheKey}`)
    } else {
      core.info(`✗ Global mise cache not found`)
    }

    return hit
  } catch (error) {
    core.warning(`Failed to restore global mise cache: ${error}`)
    return false
  }
}

/**
 * Restore individual tool caches
 */
async function restoreToolCaches(
  tools: Tool[],
  target: string,
  keyPrefix: string
): Promise<ToolCacheInfo[]> {
  const results = await Promise.all(
    tools.map(async tool => {
      const toolHash = generateToolHash(tool)
      const toolCacheKey = `${keyPrefix}-${target}-tool-${toolHash}`
      const toolCachePath = path.join(
        miseDir(),
        'installs',
        tool.name,
        tool.version
      )

      core.info(`Checking tool cache: ${tool.name}@${tool.version}`)

      try {
        const cacheKey = await cache.restoreCache([toolCachePath], toolCacheKey)
        const isRestored = Boolean(cacheKey)

        if (isRestored) {
          core.info(`  ✓ Restored from cache: ${cacheKey}`)
        } else {
          core.info(`  ✗ Not found in cache`)
        }

        return {
          tool,
          cacheKey: toolCacheKey,
          cachePath: toolCachePath,
          isRestored
        }
      } catch (error) {
        core.warning(`Failed to restore cache for ${tool.name}: ${error}`)
        return {
          tool,
          cacheKey: toolCacheKey,
          cachePath: toolCachePath,
          isRestored: false
        }
      }
    })
  )

  return results
}

/**
 * Save caches for newly installed tools and global mise
 */
export async function saveAllCaches(
  cacheResult: CacheResult,
  installedTools: Tool[]
): Promise<void> {
  if (!core.getBooleanInput('cache_save')) {
    core.info('Cache saving disabled, skipping...')
    return
  }

  core.startGroup('Saving caches')

  try {
    // Save global mise cache if it wasn't restored
    if (!cacheResult.globalCacheHit) {
      await saveGlobalMiseCache()
    }

    // Save caches for newly installed tools
    const savePromises = installedTools.map(async tool => {
      const toolCacheInfo = cacheResult.toolCacheResults.find(
        t => t.tool.name === tool.name && t.tool.version === tool.version
      )

      if (toolCacheInfo && !toolCacheInfo.isRestored) {
        await saveToolCache(toolCacheInfo)
      }
    })

    await Promise.all(savePromises)
  } catch (error) {
    core.warning(`Failed to save caches: ${error}`)
  } finally {
    core.endGroup()
  }
}

/**
 * Save global mise binary cache
 */
async function saveGlobalMiseCache(): Promise<void> {
  const systemInfo = await getSystemInfo()
  const version = core.getInput('version') || 'latest'
  const keyPrefix = core.getInput('cache_key_prefix') || 'mise-v1'
  const globalCacheKey = `${keyPrefix}-${systemInfo.target}-${version}-global`
  const miseCachePath = path.join(miseDir(), 'bin')

  if (!fs.existsSync(miseCachePath)) {
    core.warning(`Global mise path does not exist: ${miseCachePath}`)
    return
  }

  try {
    const cacheId = await cache.saveCache([miseCachePath], globalCacheKey)
    if (cacheId !== -1) {
      core.info(`✓ Global mise cache saved: ${globalCacheKey}`)
    } else {
      core.info(`Global mise cache already exists: ${globalCacheKey}`)
    }
  } catch (error) {
    core.warning(`Failed to save global mise cache: ${error}`)
  }
}

/**
 * Save individual tool cache
 */
async function saveToolCache(toolCacheInfo: ToolCacheInfo): Promise<void> {
  const { tool, cacheKey, cachePath } = toolCacheInfo

  if (!fs.existsSync(cachePath)) {
    core.warning(
      `Tool cache path does not exist for ${tool.name}@${tool.version}: ${cachePath}`
    )
    return
  }

  try {
    const cacheId = await cache.saveCache([cachePath], cacheKey)
    if (cacheId !== -1) {
      core.info(`✓ Tool cache saved: ${tool.name}@${tool.version}`)
    } else {
      core.info(`Tool cache already exists: ${tool.name}@${tool.version}`)
    }
  } catch (error) {
    core.warning(`Failed to save tool cache for ${tool.name}: ${error}`)
  }
}

/**
 * Set GitHub Actions outputs based on cache results
 */
function setOutputs(result: CacheResult): void {
  const { totalTools, cachedTools, globalCacheHit } = result

  // Traditional cache-hit output (true only if ALL tools were cached)
  const fullCacheHit = globalCacheHit && cachedTools === totalTools
  core.setOutput('cache-hit', fullCacheHit)

  // New enhanced outputs
  core.setOutput('global-cache-hit', globalCacheHit)
  core.setOutput('partial-cache-hit', cachedTools > 0)
  core.setOutput('tools-cache-hit-ratio', `${cachedTools}/${totalTools}`)
  core.setOutput('cached-tools-count', cachedTools)
  core.setOutput('missing-tools-count', totalTools - cachedTools)
}

/**
 * Log detailed cache results
 */
function logCacheResults(result: CacheResult): void {
  const { totalTools, cachedTools, globalCacheHit, missingTools } = result

  core.info(`\n📊 Cache Results Summary:`)
  core.info(`  Global mise cache: ${globalCacheHit ? '✓ Hit' : '✗ Miss'}`)
  core.info(`  Tool caches: ${cachedTools}/${totalTools} restored`)

  if (cachedTools > 0) {
    core.info(`\n✅ Restored from cache:`)
    result.toolCacheResults
      .filter(t => t.isRestored)
      .forEach(t => core.info(`  - ${t.tool.name}@${t.tool.version}`))
  }

  if (missingTools.length > 0) {
    core.info(`\n⚠️  Need to install:`)
    missingTools.forEach(tool => core.info(`  - ${tool.name}@${tool.version}`))
  }

  const cacheEfficiency = totalTools > 0 ? (cachedTools / totalTools) * 100 : 0
  core.info(`\n🎯 Cache efficiency: ${cacheEfficiency.toFixed(1)}%`)
}
