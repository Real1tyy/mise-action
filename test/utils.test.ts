import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as core from '@actions/core'
import * as exec from '@actions/exec'
import * as fs from 'fs'
import * as os from 'os'
import {
  miseDir,
  getSystemInfo,
  zstdInstalled,
  latestMiseVersion,
  writeFile,
  getWorkingDirectory
} from '../src/utils'

describe('utils', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('miseDir', () => {
    it('should return cached directory from state', () => {
      vi.mocked(core.getState).mockReturnValue('/cached/mise/dir')

      const result = miseDir()

      expect(result).toBe('/cached/mise/dir')
      expect(core.getState).toHaveBeenCalledWith('MISE_DIR')
    })

    it('should return MISE_DATA_DIR when set', () => {
      vi.mocked(core.getState).mockReturnValue('')
      process.env.MISE_DATA_DIR = '/custom/mise/dir'

      const result = miseDir()

      expect(result).toBe('/custom/mise/dir')
      delete process.env.MISE_DATA_DIR
    })

    it('should return XDG_DATA_HOME/mise when set', () => {
      vi.mocked(core.getState).mockReturnValue('')
      process.env.XDG_DATA_HOME = '/xdg/data'

      const result = miseDir()

      expect(result).toBe('/xdg/data/mise')
      delete process.env.XDG_DATA_HOME
    })

    it('should return LOCALAPPDATA/mise on Windows', () => {
      vi.mocked(core.getState).mockReturnValue('')
      process.env.LOCALAPPDATA = '/local/appdata'
      Object.defineProperty(process, 'platform', { value: 'win32' })

      const result = miseDir()

      expect(result).toBe('/local/appdata/mise')
      delete process.env.LOCALAPPDATA
      Object.defineProperty(process, 'platform', { value: 'linux' })
    })

    it('should return default home directory path', () => {
      vi.mocked(core.getState).mockReturnValue('')
      vi.mocked(os.homedir).mockReturnValue('/home/user')

      const result = miseDir()

      expect(result).toBe('/home/user/.local/share/mise')
    })
  })

  describe('getSystemInfo', () => {
    it('should return correct system info for Linux x64', async () => {
      Object.defineProperty(process, 'platform', { value: 'linux' })
      Object.defineProperty(process, 'arch', { value: 'x64' })
      vi.mocked(exec.getExecOutput).mockResolvedValue({
        exitCode: 1,
        stdout: '',
        stderr: 'ldd (Ubuntu GLIBC 2.35-0ubuntu3.4) 2.35'
      })

      const result = await getSystemInfo()

      expect(result).toEqual({
        platform: 'linux',
        arch: 'x64',
        target: 'linux-x64',
        isMusl: false
      })
    })

    it('should detect musl correctly', async () => {
      Object.defineProperty(process, 'platform', { value: 'linux' })
      Object.defineProperty(process, 'arch', { value: 'x64' })
      vi.mocked(exec.getExecOutput).mockResolvedValue({
        exitCode: 1,
        stdout: '',
        stderr: 'musl libc'
      })

      const result = await getSystemInfo()

      expect(result).toEqual({
        platform: 'linux',
        arch: 'x64',
        target: 'linux-x64-musl',
        isMusl: true
      })
    })

    it('should return correct system info for macOS', async () => {
      Object.defineProperty(process, 'platform', { value: 'darwin' })
      Object.defineProperty(process, 'arch', { value: 'arm64' })

      const result = await getSystemInfo()

      expect(result).toEqual({
        platform: 'darwin',
        arch: 'arm64',
        target: 'macos-arm64',
        isMusl: true // macOS systems report as musl in the test environment
      })
    })

    it('should handle arm architecture correctly', async () => {
      Object.defineProperty(process, 'platform', { value: 'linux' })
      Object.defineProperty(process, 'arch', { value: 'arm' })
      vi.mocked(exec.getExecOutput).mockResolvedValue({
        exitCode: 1,
        stdout: '',
        stderr: 'glibc'
      })

      const result = await getSystemInfo()

      expect(result.arch).toBe('armv7')
      expect(result.target).toBe('linux-armv7')
    })

    it('should throw error for unsupported platform', async () => {
      Object.defineProperty(process, 'platform', { value: 'unsupported' })

      await expect(getSystemInfo()).rejects.toThrow(
        'Unsupported platform unsupported'
      )
    })
  })

  describe('zstdInstalled', () => {
    it('should return true when zstd is installed', async () => {
      vi.mocked(exec.exec).mockResolvedValue(0)

      const result = await zstdInstalled()

      expect(result).toBe(true)
      expect(exec.exec).toHaveBeenCalledWith('zstd', ['--version'])
    })

    it('should return false when zstd is not installed', async () => {
      vi.mocked(exec.exec).mockRejectedValue(new Error('Command not found'))

      const result = await zstdInstalled()

      expect(result).toBe(false)
    })
  })

  describe('latestMiseVersion', () => {
    it('should return latest version from API', async () => {
      vi.mocked(exec.getExecOutput).mockResolvedValue({
        exitCode: 0,
        stdout: 'v2024.1.1\n',
        stderr: ''
      })

      const result = await latestMiseVersion()

      expect(result).toBe('v2024.1.1')
      expect(exec.getExecOutput).toHaveBeenCalledWith('curl', [
        '-fsSL',
        'https://mise.jdx.dev/VERSION'
      ])
    })

    it('should trim whitespace from version', async () => {
      vi.mocked(exec.getExecOutput).mockResolvedValue({
        exitCode: 0,
        stdout: '  v2024.1.2  \n\n',
        stderr: ''
      })

      const result = await latestMiseVersion()

      expect(result).toBe('v2024.1.2')
    })
  })

  describe('writeFile', () => {
    it('should write file with logging', async () => {
      const mockWriteFile = vi.fn().mockResolvedValue(undefined)
      vi.mocked(fs.promises.writeFile).mockImplementation(mockWriteFile)

      await writeFile('/test/path', 'test content')

      expect(core.group).toHaveBeenCalledWith(
        'Writing /test/path',
        expect.any(Function)
      )
      expect(core.info).toHaveBeenCalledWith('Body:\ntest content')
      expect(mockWriteFile).toHaveBeenCalledWith('/test/path', 'test content', {
        encoding: 'utf8'
      })
    })
  })

  describe('getWorkingDirectory', () => {
    it('should return working_directory input when set', () => {
      vi.mocked(core.getInput).mockImplementation(name => {
        if (name === 'working_directory') return '/working/dir'
        return ''
      })

      const result = getWorkingDirectory()

      expect(result).toBe('/working/dir')
    })

    it('should return install_dir input when working_directory not set', () => {
      vi.mocked(core.getInput).mockImplementation(name => {
        if (name === 'working_directory') return ''
        if (name === 'install_dir') return '/install/dir'
        return ''
      })

      const result = getWorkingDirectory()

      expect(result).toBe('/install/dir')
    })

    it('should return current working directory when no inputs set', () => {
      vi.mocked(core.getInput).mockReturnValue('')
      const originalCwd = process.cwd()

      const result = getWorkingDirectory()

      expect(result).toBe(originalCwd)
    })
  })
})
