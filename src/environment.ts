import * as core from '@actions/core'
import * as path from 'path'
import { MiseConfig } from './types'
import { miseDir } from './utils'

/**
 * Set up all mise-related environment variables
 */
export async function setupEnvironmentVariables(
  config: MiseConfig
): Promise<void> {
  core.startGroup('Setting env vars')

  const set = (key: string, value: string): void => {
    if (!process.env[key]) {
      core.info(`Setting ${key}=${value}`)
      core.exportVariable(key, value)
    }
  }

  // Set experimental flag if enabled
  if (config.experimental) {
    set('MISE_EXPERIMENTAL', '1')
  }

  // Set log level if provided
  if (config.logLevel) {
    set('MISE_LOG_LEVEL', config.logLevel)
  }

  // Set GitHub token if provided
  if (config.githubToken) {
    set('GITHUB_TOKEN', config.githubToken)
  } else {
    core.warning(
      'No GITHUB_TOKEN provided. You may hit GitHub API rate limits when installing tools from GitHub.'
    )
  }

  // Set mise-specific environment variables
  set('MISE_TRUSTED_CONFIG_PATHS', process.cwd())
  set('MISE_YES', '1')

  // Add shims directory to PATH
  const shimsDir = path.join(miseDir(), 'shims')
  core.info(`Adding ${shimsDir} to PATH`)
  core.addPath(shimsDir)

  core.endGroup()
}
