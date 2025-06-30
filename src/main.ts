import * as core from '@actions/core'
import * as path from 'path'
import { MiseConfig, Tool, CacheResult } from './types'
import { setupEnvironmentVariables } from './environment'
import {
  setupMise,
  setupToolVersions,
  setupMiseToml,
  testMise,
  installSpecificTools,
  installAllConfiguredTools,
  listTools,
  reshimTools,
  trustCurrentDirectory
} from './setup'
import { restoreAllCaches, saveAllCaches } from './cache'
import { getAllTools } from './tools'
import { miseDir } from './utils'

/**
 * Main entry point for the mise action
 */
export async function run(): Promise<void> {
  try {
    // Parse configuration from inputs
    const config = parseConfiguration()

    // Set up configuration files first
    await setupConfigurationFiles(config)

    // Parse all tools from various sources
    const allTools = await getAllTools()
    core.info(`Discovered ${allTools.length} tools to manage`)

    // Handle caching - restore both global and per-tool caches
    let cacheResult
    if (core.getBooleanInput('cache')) {
      cacheResult = await restoreAllCaches(allTools)
    } else {
      core.setOutput('cache-hit', false)
      core.setOutput('global-cache-hit', false)
      core.setOutput('partial-cache-hit', false)
      core.setOutput('tools-cache-hit-ratio', '0/0')
      cacheResult = {
        globalCacheHit: false,
        toolCacheResults: [],
        totalTools: allTools.length,
        cachedTools: 0,
        missingTools: allTools
      }
    }

    // Set up mise binary (skip if restored from global cache)
    if (!cacheResult.globalCacheHit) {
      await setupMise(config.version)
    } else {
      core.info('Mise binary restored from cache, skipping installation')
      // Still need to add to PATH
      const miseBinDir = path.join(miseDir(), 'bin')
      core.addPath(miseBinDir)
    }

    // Set up environment variables
    await setupEnvironmentVariables(config)

    // Trust current directory for mise configuration
    await trustCurrentDirectory()

    // Test mise installation
    await testMise()

    // Reshim if requested (before installing new tools)
    if (core.getBooleanInput('reshim')) {
      await reshimTools()
    }

    // Install tools based on caching results
    let installedTools: Tool[] = []
    if (core.getBooleanInput('install')) {
      if (cacheResult.missingTools.length > 0) {
        core.info(
          `Installing ${cacheResult.missingTools.length} tools that weren't found in cache`
        )
        installedTools = await installSpecificTools(cacheResult.missingTools)
      } else {
        core.info('All tools were restored from cache, no installation needed')
      }

      // Fallback: if no tools were specified but install is requested
      if (allTools.length === 0 && core.getInput('install_args')) {
        core.info(
          'No tools found in configuration, falling back to install_args'
        )
        await installAllConfiguredTools()
      }

      // Save cache for newly installed tools
      if (core.getBooleanInput('cache') && installedTools.length > 0) {
        await saveAllCaches(cacheResult, installedTools)
      }
    }

    // Final reshim after installing new tools
    if (core.getBooleanInput('reshim') && installedTools.length > 0) {
      await reshimTools()
    }

    // List installed tools for verification
    await listTools()

    // Log final summary
    logExecutionSummary(cacheResult, installedTools.length)
  } catch (err) {
    if (err instanceof Error) {
      core.setFailed(err.message)
    } else {
      throw err
    }
  }
}

/**
 * Parse configuration from GitHub Actions inputs
 */
function parseConfiguration(): MiseConfig {
  return {
    version: core.getInput('version') || undefined,
    experimental: core.getBooleanInput('experimental'),
    logLevel: core.getInput('log_level') || undefined,
    githubToken: core.getInput('github_token') || undefined,
    workingDirectory: core.getInput('working_directory') || undefined,
    installDir: core.getInput('install_dir') || undefined,
    installArgs: core.getInput('install_args') || undefined,
    toolVersions: core.getInput('tool_versions') || undefined,
    miseToml: core.getInput('mise_toml') || undefined
  }
}

/**
 * Set up configuration files (.tool-versions and mise.toml)
 */
async function setupConfigurationFiles(config: MiseConfig): Promise<void> {
  await setupToolVersions(config)
  await setupMiseToml(config)
}

/**
 * Log execution summary
 */
function logExecutionSummary(
  cacheResult: CacheResult,
  installedCount: number
): void {
  core.info('\n🎉 Mise Action Execution Summary:')
  core.info(`  📦 Total tools managed: ${cacheResult.totalTools}`)
  core.info(`  ♻️  Tools restored from cache: ${cacheResult.cachedTools}`)
  core.info(`  ⬇️  Tools installed: ${installedCount}`)
  core.info(
    `  🚀 Cache efficiency: ${cacheResult.totalTools > 0 ? ((cacheResult.cachedTools / cacheResult.totalTools) * 100).toFixed(1) : 0}%`
  )

  if (cacheResult.totalTools > 0) {
    const timesSaved = cacheResult.cachedTools
    if (timesSaved > 0) {
      core.info(
        `  ⏱️  Estimated time saved: ~${timesSaved * 30}s (assuming 30s per tool)`
      )
    }
  }
}
