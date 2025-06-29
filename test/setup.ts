import { vi, beforeEach } from 'vitest'
import type { Tool, CacheResult } from '../src/types'

// Mock environment variables
process.env.GITHUB_WORKSPACE = '/tmp/test-workspace'
process.env.RUNNER_TEMP = '/tmp/test-temp'
process.env.HOME = '/tmp/test-home'

// Global mocks for GitHub Actions modules
vi.mock('@actions/core', () => ({
  info: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  setFailed: vi.fn(),
  setOutput: vi.fn(),
  exportVariable: vi.fn(),
  addPath: vi.fn(),
  getInput: vi.fn(),
  getBooleanInput: vi.fn(),
  isDebug: vi.fn().mockReturnValue(false),
  startGroup: vi.fn(),
  endGroup: vi.fn(),
  group: vi.fn((name, fn) => fn()),
  saveState: vi.fn(),
  getState: vi.fn()
}))

vi.mock('@actions/exec', () => ({
  exec: vi.fn(),
  getExecOutput: vi.fn()
}))

vi.mock('@actions/cache', () => ({
  restoreCache: vi.fn(),
  saveCache: vi.fn()
}))

vi.mock('@actions/glob', () => ({
  create: vi.fn(),
  hashFiles: vi.fn()
}))

vi.mock('@actions/io', () => ({
  mv: vi.fn(),
  cp: vi.fn(),
  rmRF: vi.fn()
}))

// Mock Node.js modules
vi.mock('fs', async () => {
  const actual = await vi.importActual('fs')
  return {
    ...actual,
    existsSync: vi.fn(),
    promises: {
      readFile: vi.fn(),
      writeFile: vi.fn(),
      mkdir: vi.fn(),
      stat: vi.fn(),
      readdir: vi.fn()
    }
  }
})

vi.mock('os', () => ({
  homedir: vi.fn().mockReturnValue('/tmp/test-home'),
  tmpdir: vi.fn().mockReturnValue('/tmp/test-temp'),
  platform: vi.fn().mockReturnValue('linux')
}))

vi.mock('crypto', () => ({
  createHash: vi.fn().mockReturnValue({
    update: vi.fn().mockReturnThis(),
    digest: vi.fn().mockReturnValue('mock-hash')
  })
}))

// Global test utilities
Object.assign(globalThis, {
  createMockTool: (name: string, version: string, source: Tool['source'] = 'mise.toml'): Tool => ({
    name,
    version,
    source
  }),

  createMockCacheResult: (overrides: Partial<CacheResult> = {}): CacheResult => ({
    globalCacheHit: false,
    toolCacheResults: [],
    totalTools: 0,
    cachedTools: 0,
    missingTools: [],
    ...overrides
  })
})

// Reset all mocks before each test
beforeEach(() => {
  vi.clearAllMocks()
})