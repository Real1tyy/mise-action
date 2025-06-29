import * as core from '@actions/core'
import * as exec from '@actions/exec'
import * as io from '@actions/io'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { MiseConfig } from './types'
import {
  miseDir,
  getSystemInfo,
  zstdInstalled,
  latestMiseVersion,
  writeFile,
  getWorkingDirectory
} from './utils'

/**
 * Install mise binary if not already present
 */
export async function setupMise(version?: string): Promise<void> {
  const miseBinDir = path.join(miseDir(), 'bin')
  const miseBinPath = path.join(
    miseBinDir,
    process.platform === 'win32' ? 'mise.exe' : 'mise'
  )

  if (fs.existsSync(miseBinPath)) {
    core.info('mise binary already exists, skipping installation')
    core.addPath(miseBinDir)
    return
  }

  core.startGroup(version ? `Download mise@${version}` : 'Setup mise')

  try {
    await fs.promises.mkdir(miseBinDir, { recursive: true })
    await downloadAndInstallMise(version, miseBinPath)
    core.addPath(miseBinDir)
    core.info('mise installation completed successfully')
  } catch (error) {
    throw new Error(`Failed to setup mise: ${error}`)
  } finally {
    core.endGroup()
  }
}

/**
 * Download and install mise binary
 */
async function downloadAndInstallMise(
  version: string | undefined,
  miseBinPath: string
): Promise<void> {
  const systemInfo = await getSystemInfo()
  const resolvedVersion = (version || (await latestMiseVersion())).replace(
    /^v/,
    ''
  )

  const ext = await getArchiveExtension(resolvedVersion)
  const url = `https://github.com/jdx/mise/releases/download/v${resolvedVersion}/mise-v${resolvedVersion}-${systemInfo.target}${ext}`
  const archivePath = path.join(os.tmpdir(), `mise${ext}`)

  core.info(`Downloading mise from: ${url}`)

  switch (ext) {
    case '.zip':
      await downloadAndExtractZip(url, archivePath, miseBinPath)
      break
    case '.tar.zst':
      await downloadAndExtractTarZst(url, miseBinPath)
      break
    case '.tar.gz':
      await downloadAndExtractTarGz(url, miseBinPath)
      break
    default:
      await downloadRawBinary(url, miseBinPath)
      break
  }
}

/**
 * Determine the appropriate archive extension
 */
async function getArchiveExtension(version: string): Promise<string> {
  if (process.platform === 'win32') {
    return '.zip'
  }

  if (version.startsWith('2024')) {
    return ''
  }

  return (await zstdInstalled()) ? '.tar.zst' : '.tar.gz'
}

/**
 * Download and extract ZIP archive
 */
async function downloadAndExtractZip(
  url: string,
  archivePath: string,
  miseBinPath: string
): Promise<void> {
  await exec.exec('curl', ['-fsSL', url, '--output', archivePath])
  await exec.exec('unzip', [archivePath, '-d', os.tmpdir()])
  await io.mv(path.join(os.tmpdir(), 'mise/bin/mise.exe'), miseBinPath)
}

/**
 * Download and extract tar.zst archive
 */
async function downloadAndExtractTarZst(
  url: string,
  miseBinPath: string
): Promise<void> {
  await exec.exec('sh', [
    '-c',
    `curl -fsSL ${url} | tar --zstd -xf - -C ${os.tmpdir()} && mv ${os.tmpdir()}/mise/bin/mise ${miseBinPath}`
  ])
}

/**
 * Download and extract tar.gz archive
 */
async function downloadAndExtractTarGz(
  url: string,
  miseBinPath: string
): Promise<void> {
  await exec.exec('sh', [
    '-c',
    `curl -fsSL ${url} | tar -xzf - -C ${os.tmpdir()} && mv ${os.tmpdir()}/mise/bin/mise ${miseBinPath}`
  ])
}

/**
 * Download raw binary
 */
async function downloadRawBinary(
  url: string,
  miseBinPath: string
): Promise<void> {
  await exec.exec('sh', ['-c', `curl -fsSL ${url} > ${miseBinPath}`])
  await exec.exec('chmod', ['+x', miseBinPath])
}

/**
 * Set up tool versions file if provided
 */
export async function setupToolVersions(config: MiseConfig): Promise<void> {
  if (config.toolVersions) {
    await writeFile('.tool-versions', config.toolVersions)
  }
}

/**
 * Set up mise.toml file if provided
 */
export async function setupMiseToml(config: MiseConfig): Promise<void> {
  if (config.miseToml) {
    await writeFile('mise.toml', config.miseToml)
  }
}

/**
 * Execute a mise command
 */
export async function executeMiseCommand(args: string[]): Promise<number> {
  return core.group(`Running mise ${args.join(' ')}`, async () => {
    const cwd = getWorkingDirectory()
    const env = core.isDebug()
      ? { ...process.env, MISE_LOG_LEVEL: 'debug' }
      : undefined

    if (args.length === 1) {
      return exec.exec(`mise ${args[0]}`, [], { cwd, env })
    } else {
      return exec.exec('mise', args, { cwd, env })
    }
  })
}

/**
 * Test mise installation
 */
export async function testMise(): Promise<number> {
  return executeMiseCommand(['--version'])
}

/**
 * Install tools using mise
 */
export async function installTools(installArgs?: string): Promise<number> {
  const args = installArgs ? `install ${installArgs}` : 'install'
  return executeMiseCommand([args])
}

/**
 * List installed tools
 */
export async function listTools(): Promise<number> {
  return executeMiseCommand(['ls'])
}

/**
 * Reshim all tools
 */
export async function reshimTools(): Promise<number> {
  return executeMiseCommand(['reshim', '--all'])
}
