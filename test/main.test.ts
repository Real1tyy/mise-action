import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as core from '@actions/core'
import { run } from '../src/main'
import * as environment from '../src/environment'
import * as setup from '../src/setup'
import * as tools from '../src/tools'
import * as cache from '../src/cache'

vi.mock('../src/environment')
vi.mock('../src/setup')
vi.mock('../src/tools')
vi.mock('../src/cache')

describe('main', () => {
  const mockTools = [
    createMockTool('node', '18.17.0'),
    createMockTool('python', '3.11.0')
  ]

  const mockCacheResult = createMockCacheResult({
    globalCacheHit: false,
    toolCacheResults: [
      {
        tool: mockTools[0],
        cacheKey: 'test-key-1',
        cachePath: '/path/1',
        isRestored: true
      },
      {
        tool: mockTools[1],
        cacheKey: 'test-key-2',
        cachePath: '/path/2',
        isRestored: false
      }
    ],
    totalTools: 2,
    cachedTools: 1,
    missingTools: [mockTools[1]]
  })

  beforeEach(() => {
    vi.clearAllMocks()

    // Setup default input mocks
    vi.mocked(core.getBooleanInput).mockImplementation(name => {
      switch (name) {
        case 'cache':
          return true
        case 'install':
          return true
        case 'reshim':
          return false
        default:
          return false
      }
    })

    vi.mocked(core.getInput).mockImplementation(name => {
      switch (name) {
        case 'version':
          return 'v2024.1.1'
        default:
          return ''
      }
    })

    // Setup default successful mocks
    vi.mocked(tools.getAllTools).mockResolvedValue(mockTools)
    vi.mocked(cache.restoreAllCaches).mockResolvedValue(mockCacheResult)
    vi.mocked(setup.setupMise).mockResolvedValue()
    vi.mocked(setup.setupToolVersions).mockResolvedValue()
    vi.mocked(setup.setupMiseToml).mockResolvedValue()
    vi.mocked(setup.testMise).mockResolvedValue(0)
    vi.mocked(setup.trustCurrentDirectory).mockResolvedValue(0)
    vi.mocked(setup.installSpecificTools).mockResolvedValue([mockTools[1]])
    vi.mocked(setup.listTools).mockResolvedValue(0)
    vi.mocked(cache.saveAllCaches).mockResolvedValue()
    vi.mocked(environment.setupEnvironmentVariables).mockResolvedValue()
  })

  describe('run', () => {
    it('should execute full workflow successfully', async () => {
      await run()

      // Verify execution order and calls
      expect(tools.getAllTools).toHaveBeenCalledOnce()
      expect(cache.restoreAllCaches).toHaveBeenCalledWith(mockTools)
      expect(setup.setupMise).toHaveBeenCalledOnce()
      expect(environment.setupEnvironmentVariables).toHaveBeenCalledOnce()
      expect(setup.trustCurrentDirectory).toHaveBeenCalledOnce()
      expect(setup.testMise).toHaveBeenCalledOnce()
      expect(setup.installSpecificTools).toHaveBeenCalledWith(
        mockCacheResult.missingTools
      )
      expect(cache.saveAllCaches).toHaveBeenCalledWith(mockCacheResult, [
        mockTools[1]
      ])
      expect(setup.listTools).toHaveBeenCalledOnce()

      expect(core.setFailed).not.toHaveBeenCalled()
    })

    it('should handle empty tools list', async () => {
      vi.mocked(tools.getAllTools).mockResolvedValue([])
      vi.mocked(cache.restoreAllCaches).mockResolvedValue(
        createMockCacheResult({
          totalTools: 0,
          cachedTools: 0,
          missingTools: []
        })
      )

      await run()

      // No tools to install, so installSpecificTools shouldn't be called
      expect(setup.installSpecificTools).not.toHaveBeenCalled()
      expect(cache.saveAllCaches).not.toHaveBeenCalled() // No tools installed, so no cache saving
      expect(core.setFailed).not.toHaveBeenCalled()
    })

    it('should handle complete cache hit scenario', async () => {
      const fullCacheHit = createMockCacheResult({
        globalCacheHit: true,
        totalTools: 2,
        cachedTools: 2,
        missingTools: []
      })
      vi.mocked(cache.restoreAllCaches).mockResolvedValue(fullCacheHit)

      await run()

      // No missing tools, so installSpecificTools shouldn't be called
      expect(setup.installSpecificTools).not.toHaveBeenCalled()
      expect(cache.saveAllCaches).not.toHaveBeenCalled() // No tools installed
      expect(core.info).toHaveBeenCalledWith(
        expect.stringContaining('All tools were restored from cache')
      )
    })

    it('should handle tools parsing failure', async () => {
      const parseError = new Error('Failed to parse tools')
      vi.mocked(tools.getAllTools).mockRejectedValue(parseError)

      await run()

      expect(core.setFailed).toHaveBeenCalledWith(parseError.message)
      expect(cache.restoreAllCaches).not.toHaveBeenCalled()
    })

    it('should handle cache restore failure', async () => {
      const cacheError = new Error('Cache restore failed')
      vi.mocked(cache.restoreAllCaches).mockRejectedValue(cacheError)

      await run()

      expect(core.setFailed).toHaveBeenCalledWith(cacheError.message)
      expect(setup.setupMise).not.toHaveBeenCalled()
    })

    it('should handle mise setup failure', async () => {
      const setupError = new Error('Mise setup failed')
      vi.mocked(setup.setupMise).mockRejectedValue(setupError)

      await run()

      expect(core.setFailed).toHaveBeenCalledWith(setupError.message)
      expect(environment.setupEnvironmentVariables).not.toHaveBeenCalled()
    })

    it('should handle tool installation failure', async () => {
      const installError = new Error('Tool installation failed')
      vi.mocked(setup.installSpecificTools).mockRejectedValue(installError)

      await run()

      expect(core.setFailed).toHaveBeenCalledWith(installError.message)
      expect(cache.saveAllCaches).not.toHaveBeenCalled()
    })

    it('should handle environment setup failure', async () => {
      const envError = new Error('Environment setup failed')
      vi.mocked(environment.setupEnvironmentVariables).mockRejectedValue(
        envError
      )

      await run()

      expect(core.setFailed).toHaveBeenCalledWith(envError.message)
    })

    it('should handle cache save failure gracefully', async () => {
      // Force cache saving by having installed tools
      vi.mocked(setup.installSpecificTools).mockResolvedValue([mockTools[1]])
      const saveError = new Error('Cache save failed')
      vi.mocked(cache.saveAllCaches).mockRejectedValue(saveError)

      await run()

      // Since we're mocking saveAllCaches to throw, main will catch it and call setFailed
      expect(core.setFailed).toHaveBeenCalledWith(saveError.message)
    })

    it('should continue execution even if some tools fail to install', async () => {
      // Simulate partial installation success
      vi.mocked(setup.installSpecificTools).mockResolvedValue([]) // No tools successfully installed

      await run()

      expect(cache.saveAllCaches).not.toHaveBeenCalled() // No tools installed
      expect(core.setFailed).not.toHaveBeenCalled()
    })

    it('should log execution summary', async () => {
      await run()

      expect(core.info).toHaveBeenCalledWith(
        expect.stringContaining('🎉 Mise Action Execution Summary')
      )
      expect(core.info).toHaveBeenCalledWith(
        expect.stringContaining('📦 Total tools managed: 2')
      )
      expect(core.info).toHaveBeenCalledWith(
        expect.stringContaining('♻️  Tools restored from cache: 1')
      )
      expect(core.info).toHaveBeenCalledWith(
        expect.stringContaining('⬇️  Tools installed: 1')
      )
    })

    it('should handle workflow with no missing tools', async () => {
      const allCachedResult = createMockCacheResult({
        globalCacheHit: true,
        totalTools: 2,
        cachedTools: 2,
        missingTools: []
      })
      vi.mocked(cache.restoreAllCaches).mockResolvedValue(allCachedResult)

      await run()

      // No missing tools, so installation shouldn't be called
      expect(setup.installSpecificTools).not.toHaveBeenCalled()
      expect(cache.saveAllCaches).not.toHaveBeenCalled() // No new tools installed
      expect(core.info).toHaveBeenCalledWith(
        expect.stringContaining('All tools were restored from cache')
      )
    })

    it('should handle workflow with only some tools cached', async () => {
      const partialCacheResult = createMockCacheResult({
        globalCacheHit: false,
        totalTools: 3,
        cachedTools: 1,
        missingTools: [mockTools[0], mockTools[1]]
      })
      vi.mocked(cache.restoreAllCaches).mockResolvedValue(partialCacheResult)
      vi.mocked(setup.installSpecificTools).mockResolvedValue([mockTools[0]]) // Only one installed successfully

      await run()

      expect(setup.installSpecificTools).toHaveBeenCalledWith([
        mockTools[0],
        mockTools[1]
      ])
      expect(cache.saveAllCaches).toHaveBeenCalledWith(partialCacheResult, [
        mockTools[0]
      ])
      expect(core.info).toHaveBeenCalledWith(
        expect.stringContaining('⬇️  Tools installed: 1')
      )
    })

    it('should propagate unexpected errors', async () => {
      const unexpectedError = new Error('Unexpected error')
      vi.mocked(tools.getAllTools).mockImplementation(() => {
        throw unexpectedError
      })

      await run()

      expect(core.setFailed).toHaveBeenCalledWith(unexpectedError.message)
    })

    it('should handle async operation timing', async () => {
      const resolveOrder: string[] = []

      vi.mocked(tools.getAllTools).mockImplementation(async () => {
        await new Promise(resolve => setTimeout(resolve, 10))
        resolveOrder.push('getAllTools')
        return mockTools
      })

      vi.mocked(cache.restoreAllCaches).mockImplementation(async () => {
        await new Promise(resolve => setTimeout(resolve, 5))
        resolveOrder.push('restoreAllCaches')
        return mockCacheResult
      })

      vi.mocked(setup.setupMise).mockImplementation(async () => {
        resolveOrder.push('setupMise')
      })

      await run()

      expect(resolveOrder).toEqual([
        'getAllTools',
        'restoreAllCaches',
        'setupMise'
      ])
    })

    it('should handle complex error scenarios', async () => {
      // Test error in the middle of execution
      vi.mocked(setup.installSpecificTools).mockImplementation(async () => {
        throw new Error('Installation failed after cache restore')
      })

      await run()

      expect(cache.restoreAllCaches).toHaveBeenCalled() // This should succeed
      expect(setup.setupMise).toHaveBeenCalled() // This should succeed
      expect(environment.setupEnvironmentVariables).toHaveBeenCalled() // This happens before the error
      expect(cache.saveAllCaches).not.toHaveBeenCalled() // This should not be called
      expect(core.setFailed).toHaveBeenCalledWith(
        'Installation failed after cache restore'
      )
    })
  })

  describe('logging and output behavior', () => {
    it('should log discovery message', async () => {
      await run()

      expect(core.info).toHaveBeenCalledWith('Discovered 2 tools to manage')
    })

    it('should log execution summary on success', async () => {
      await run()

      expect(core.info).toHaveBeenCalledWith(
        expect.stringContaining('🎉 Mise Action Execution Summary')
      )
    })

    it('should log cache efficiency in summary', async () => {
      await run()

      expect(core.info).toHaveBeenCalledWith(
        expect.stringContaining('🚀 Cache efficiency:')
      )
    })

    it('should not log execution summary on failure', async () => {
      vi.mocked(tools.getAllTools).mockRejectedValue(new Error('Test error'))

      await run()

      expect(core.info).not.toHaveBeenCalledWith(
        expect.stringContaining('🎉 Mise Action Execution Summary')
      )
    })

    it('should set appropriate outputs through sub-modules', async () => {
      await run()

      // Verify that cache module would have set outputs
      expect(cache.restoreAllCaches).toHaveBeenCalled()
      // The actual output setting happens in the cache module, which we've mocked
    })
  })
})
