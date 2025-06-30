import * as core from '@actions/core'
import * as exec from '@actions/exec'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { SystemInfo } from './types'

/**
 * Get the mise data directory path
 */
export function miseDir(): string {
  const dir = core.getState('MISE_DIR')
  if (dir) return dir

  const { MISE_DATA_DIR, XDG_DATA_HOME, LOCALAPPDATA } = process.env
  if (MISE_DATA_DIR) return MISE_DATA_DIR
  if (XDG_DATA_HOME) return path.join(XDG_DATA_HOME, 'mise')
  if (process.platform === 'win32' && LOCALAPPDATA)
    return path.join(LOCALAPPDATA, 'mise')

  return path.join(os.homedir(), '.local', 'share', 'mise')
}

/**
 * Get system target information for binary downloads
 */
export async function getSystemInfo(): Promise<SystemInfo> {
  let { arch } = process

  // quick overwrite to abide by release format
  if (arch === 'arm') arch = 'armv7' as NodeJS.Architecture

  const isMusl = await checkIsMusl()

  let target: string
  switch (process.platform) {
    case 'darwin':
      target = `macos-${arch}`
      break
    case 'win32':
      target = `windows-${arch}`
      break
    case 'linux':
      target = `linux-${arch}${isMusl ? '-musl' : ''}`
      break
    default:
      throw new Error(`Unsupported platform ${process.platform}`)
  }

  return {
    platform: process.platform,
    arch,
    target,
    isMusl
  }
}

/**
 * Check if system uses musl libc
 */
async function checkIsMusl(): Promise<boolean> {
  try {
    // `ldd --version` always returns 1 and print to stderr
    const { stderr } = await exec.getExecOutput('ldd', ['--version'], {
      failOnStdErr: false,
      ignoreReturnCode: true
    })
    return stderr.indexOf('musl') > -1
  } catch {
    return false
  }
}

/**
 * Check if zstd is installed on the system
 */
export async function zstdInstalled(): Promise<boolean> {
  try {
    await exec.exec('zstd', ['--version'])
    return true
  } catch {
    return false
  }
}

/**
 * Get the latest mise version from the release endpoint
 */
export async function latestMiseVersion(): Promise<string> {
  const rsp = await exec.getExecOutput('curl', [
    '-fsSL',
    'https://mise.jdx.dev/VERSION'
  ])
  return rsp.stdout.trim()
}

/**
 * Write content to a file with logging
 */
export async function writeFile(
  filePath: fs.PathLike,
  body: string
): Promise<void> {
  return core.group(`Writing ${filePath}`, async () => {
    core.info(`Body:\n${body}`)
    await fs.promises.writeFile(filePath, body, { encoding: 'utf8' })
  })
}

/**
 * Get current working directory based on inputs
 */
export function getWorkingDirectory(): string {
  return (
    core.getInput('working_directory') ||
    core.getInput('install_dir') ||
    process.cwd()
  )
}
