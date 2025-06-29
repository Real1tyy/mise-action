import * as core from '@actions/core'
import { MiseConfig } from './types'
import { setupEnvironmentVariables } from './environment'
import {
  setupMise,
  setupToolVersions,
  setupMiseToml,
  testMise,
  installTools,
  listTools,
  reshimTools
} from './setup'
import { restoreMiseCache, saveMiseCache } from './cache'

/**
 * Main entry point for the mise action
 */
export async function run(): Promise<void> {
  try {
    // Parse configuration from inputs
    const config = parseConfiguration()

    // Set up configuration files
    await setupConfigurationFiles(config)

    // Handle caching
    let cacheKey: string | undefined
    if (core.getBooleanInput('cache')) {
      cacheKey = await restoreMiseCache()
    } else {
      core.setOutput('cache-hit', false)
    }

    // Set up mise binary
    await setupMise(config.version)

    // Set up environment variables
    await setupEnvironmentVariables(config)

    // Reshim if requested
    if (core.getBooleanInput('reshim')) {
      await reshimTools()
    }

    // Test mise installation
    await testMise()

    // Install tools if requested
    if (core.getBooleanInput('install')) {
      await installTools(config.installArgs)

      // Save cache if enabled and we have a cache key
      if (cacheKey && core.getBooleanInput('cache_save')) {
        await saveMiseCache(cacheKey)
      }
    }

    // List installed tools
    await listTools()
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
