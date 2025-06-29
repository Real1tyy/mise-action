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

    // Setup default successful mocks
    vi.mocked(tools.getAllTools).mockResolvedValue(mockTools)
    vi.mocked(cache.restoreAllCaches).mockResolvedValue(mockCacheResult)
    vi.mocked(setup.setupMise).mockResolvedValue()
    vi.mocked(setup.setupToolVersions).mockResolvedValue()
    vi.mocked(setup.setupMiseToml).mockResolvedValue()
    vi.mocked(setup.testMise).mockResolvedValue(0)
    vi.mocked(setup.trustCurrentDirectory).mockResolvedValue(0)
    vi.mocked(setup.installSpecificTools).mockResolvedValue([mockTools[1]])
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
      expect(setup.setupToolVersions).toHaveBeenCalledOnce()
      expect(setup.setupMiseToml).toHaveBeenCalledOnce()
      expect(setup.installSpecificTools).toHaveBeenCalledWith(mockCacheResult.missingTools)
      expect(cache.saveAllCaches).toHaveBeenCalledWith(mockCacheResult, [mockTools[1]])
      expect(environment.setupEnvironmentVariables).toHaveBeenCalledOnce()

      expect(core.setFailed).not.toHaveBeenCalled()
    })

    it('should handle empty tools list', async () => {
      vi.mocked(tools.getAllTools).mockResolvedValue([])
      vi.mocked(cache.restoreAllCaches).mockResolvedValue(createMockCacheResult({
        totalTools: 0,
        cachedTools: 0,
        missingTools: []
      }))

      await run()

      expect(setup.installTools).toHaveBeenCalledWith([])
      expect(cache.saveAllCaches).toHaveBeenCalledWith(expect.any(Object), [])
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

      expect(setup.installTools).toHaveBeenCalledWith([])
      expect(cache.saveAllCaches).toHaveBeenCalledWith(fullCacheHit, [])
      expect(core.info).toHaveBeenCalledWith(
        expect.stringContaining('All tools restored from cache')
      )
    })

    it('should handle tools parsing failure', async () => {
      const parseError = new Error('Failed to parse tools')
      vi.mocked(tools.getAllTools).mockRejectedValue(parseError)

      await run()

      expect(core.setFailed).toHaveBeenCalledWith(`Action failed: ${parseError.message}`)
      expect(cache.restoreAllCaches).not.toHaveBeenCalled()
    })

    it('should handle cache restore failure', async () => {
      const cacheError = new Error('Cache restore failed')
      vi.mocked(cache.restoreAllCaches).mockRejectedValue(cacheError)

      await run()

      expect(core.setFailed).toHaveBeenCalledWith(`Action failed: ${cacheError.message}`)
      expect(setup.ensureMise).not.toHaveBeenCalled()
    })

    it('should handle mise setup failure', async () => {
      const setupError = new Error('Mise setup failed')
      vi.mocked(setup.ensureMise).mockRejectedValue(setupError)

      await run()

      expect(core.setFailed).toHaveBeenCalledWith(`Action failed: ${setupError.message}`)
      expect(setup.configMise).not.toHaveBeenCalled()
    })

    it('should handle mise config failure', async () => {
      const configError = new Error('Mise config failed')
      vi.mocked(setup.configMise).mockRejectedValue(configError)

      await run()

      expect(core.setFailed).toHaveBeenCalledWith(`Action failed: ${configError.message}`)
      expect(setup.installTools).not.toHaveBeenCalled()
    })

    it('should handle tool installation failure', async () => {
      const installError = new Error('Tool installation failed')
      vi.mocked(setup.installTools).mockRejectedValue(installError)

      await run()

      expect(core.setFailed).toHaveBeenCalledWith(`Action failed: ${installError.message}`)
      expect(cache.saveAllCaches).not.toHaveBeenCalled()
    })

    it('should handle cache save failure gracefully', async () => {
      const saveError = new Error('Cache save failed')
      vi.mocked(cache.saveAllCaches).mockRejectedValue(saveError)

      await run()

      expect(core.warning).toHaveBeenCalledWith(
        `Failed to save caches: ${saveError.message}`
      )
      expect(environment.setupEnvironment).toHaveBeenCalledOnce()
      expect(core.setFailed).not.toHaveBeenCalled()
    })

    it('should handle environment setup failure', async () => {
      const envError = new Error('Environment setup failed')
      vi.mocked(environment.setupEnvironment).mockRejectedValue(envError)

      await run()

      expect(core.setFailed).toHaveBeenCalledWith(`Action failed: ${envError.message}`)
    })

    it('should continue execution even if some tools fail to install', async () => {
      // Simulate partial installation success
      vi.mocked(setup.installTools).mockResolvedValue([]) // No tools successfully installed

      await run()

      expect(cache.saveAllCaches).toHaveBeenCalledWith(mockCacheResult, [])
      expect(environment.setupEnvironment).toHaveBeenCalledOnce()
      expect(core.setFailed).not.toHaveBeenCalled()
    })

    it('should log execution summary', async () => {
      await run()

      expect(core.info).toHaveBeenCalledWith(
        expect.stringContaining('mise-action completed successfully')
      )
      expect(core.info).toHaveBeenCalledWith(
        expect.stringContaining('Total tools: 2')
      )
      expect(core.info).toHaveBeenCalledWith(
        expect.stringContaining('Cached tools: 1')
      )
      expect(core.info).toHaveBeenCalledWith(
        expect.stringContaining('Installed tools: 1')
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
      vi.mocked(setup.installTools).mockResolvedValue([])

      await run()

      expect(setup.installTools).toHaveBeenCalledWith([])
      expect(cache.saveAllCaches).toHaveBeenCalledWith(allCachedResult, [])
      expect(core.info).toHaveBeenCalledWith(
        expect.stringContaining('All tools restored from cache')
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
      vi.mocked(setup.installTools).mockResolvedValue([mockTools[0]]) // Only one installed successfully

      await run()

      expect(setup.installTools).toHaveBeenCalledWith([mockTools[0], mockTools[1]])
      expect(cache.saveAllCaches).toHaveBeenCalledWith(partialCacheResult, [mockTools[0]])
      expect(core.info).toHaveBeenCalledWith(
        expect.stringContaining('Installed tools: 1')
      )
    })

    it('should propagate unexpected errors', async () => {
      const unexpectedError = new Error('Unexpected error')
      vi.mocked(tools.getAllTools).mockImplementation(() => {
        throw unexpectedError
      })

      await run()

      expect(core.setFailed).toHaveBeenCalledWith(`Action failed: ${unexpectedError.message}`)
    })

    it('should handle async operation timing', async () => {
      let resolveOrder: string[] = []

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

      vi.mocked(setup.ensureMise).mockImplementation(async () => {
        resolveOrder.push('ensureMise')
      })

      await run()

      expect(resolveOrder).toEqual(['getAllTools', 'restoreAllCaches', 'ensureMise'])
    })

    it('should handle complex error scenarios', async () => {
      // Test error in the middle of execution
      vi.mocked(setup.installTools).mockImplementation(async () => {
        throw new Error('Installation failed after cache restore')
      })

      await run()

      expect(cache.restoreAllCaches).toHaveBeenCalled() // This should succeed
      expect(setup.ensureMise).toHaveBeenCalled() // This should succeed
      expect(setup.configMise).toHaveBeenCalled() // This should succeed
      expect(cache.saveAllCaches).not.toHaveBeenCalled() // This should not be called
      expect(environment.setupEnvironment).not.toHaveBeenCalled() // This should not be called
      expect(core.setFailed).toHaveBeenCalledWith(
        'Action failed: Installation failed after cache restore'
      )
    })
  })

  describe('logging and output behavior', () => {
    it('should log start message', async () => {
      await run()

      expect(core.info).toHaveBeenCalledWith('Starting mise-action...')
    })

    it('should log completion message on success', async () => {
      await run()

      expect(core.info).toHaveBeenCalledWith(
        expect.stringContaining('mise-action completed successfully')
      )
    })

    it('should not log completion message on failure', async () => {
      vi.mocked(tools.getAllTools).mockRejectedValue(new Error('Test error'))

      await run()

      expect(core.info).not.toHaveBeenCalledWith(
        expect.stringContaining('mise-action completed successfully')
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