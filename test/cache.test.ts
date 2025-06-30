import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as cache from '@actions/cache'
import * as core from '@actions/core'
import * as fs from 'fs'
import { restoreAllCaches, saveAllCaches } from '../src/cache'
import * as utils from '../src/utils'
import * as tools from '../src/tools'

vi.mock('../src/utils')
vi.mock('../src/tools')

describe('cache', () => {
  const mockTools = [
    createMockTool('node', '18.17.0'),
    createMockTool('python', '3.11.0'),
    createMockTool('go', '1.21.0')
  ]

  beforeEach(() => {
    vi.clearAllMocks()

    // Setup default mocks
    vi.mocked(utils.getSystemInfo).mockResolvedValue({
      platform: 'linux',
      arch: 'x64',
      target: 'linux-x64',
      isMusl: false
    })
    vi.mocked(utils.miseDir).mockReturnValue('/mock/mise/dir')
    vi.mocked(tools.generateToolHash).mockImplementation(
      tool => `${tool.name}-${tool.version}`
    )
    vi.mocked(core.getInput).mockImplementation(name => {
      switch (name) {
        case 'version':
          return 'v2024.1.1'
        case 'cache_key_prefix':
          return 'mise-v1'
        default:
          return ''
      }
    })
  })

  describe('restoreAllCaches', () => {
    it('should restore global cache and all tool caches successfully', async () => {
      vi.mocked(cache.restoreCache)
        .mockResolvedValueOnce('mise-v1-linux-x64-v2024.1.1-global') // global cache
        .mockResolvedValueOnce('mise-v1-linux-x64-tool-node-18.17.0') // node cache
        .mockResolvedValueOnce('mise-v1-linux-x64-tool-python-3.11.0') // python cache
        .mockResolvedValueOnce('mise-v1-linux-x64-tool-go-1.21.0') // go cache

      const result = await restoreAllCaches(mockTools)

      expect(result).toEqual({
        globalCacheHit: true,
        toolCacheResults: [
          {
            tool: mockTools[0],
            cacheKey: 'mise-v1-linux-x64-tool-node-18.17.0',
            cachePath: '/mock/mise/dir/installs/node/18.17.0',
            isRestored: true
          },
          {
            tool: mockTools[1],
            cacheKey: 'mise-v1-linux-x64-tool-python-3.11.0',
            cachePath: '/mock/mise/dir/installs/python/3.11.0',
            isRestored: true
          },
          {
            tool: mockTools[2],
            cacheKey: 'mise-v1-linux-x64-tool-go-1.21.0',
            cachePath: '/mock/mise/dir/installs/go/1.21.0',
            isRestored: true
          }
        ],
        totalTools: 3,
        cachedTools: 3,
        missingTools: []
      })

      expect(core.setOutput).toHaveBeenCalledWith('cache-hit', true)
      expect(core.setOutput).toHaveBeenCalledWith('global-cache-hit', true)
      expect(core.setOutput).toHaveBeenCalledWith('partial-cache-hit', true)
      expect(core.setOutput).toHaveBeenCalledWith(
        'tools-cache-hit-ratio',
        '3/3'
      )
    })

    it('should handle partial cache hits', async () => {
      vi.mocked(cache.restoreCache)
        .mockResolvedValueOnce(undefined) // global cache miss
        .mockResolvedValueOnce('mise-v1-linux-x64-tool-node-18.17.0') // node cache hit
        .mockResolvedValueOnce(undefined) // python cache miss
        .mockResolvedValueOnce('mise-v1-linux-x64-tool-go-1.21.0') // go cache hit

      const result = await restoreAllCaches(mockTools)

      expect(result.globalCacheHit).toBe(false)
      expect(result.cachedTools).toBe(2)
      expect(result.missingTools).toHaveLength(1)
      expect(result.missingTools[0]).toEqual(mockTools[1]) // python

      expect(core.setOutput).toHaveBeenCalledWith('cache-hit', false)
      expect(core.setOutput).toHaveBeenCalledWith('global-cache-hit', false)
      expect(core.setOutput).toHaveBeenCalledWith('partial-cache-hit', true)
      expect(core.setOutput).toHaveBeenCalledWith(
        'tools-cache-hit-ratio',
        '2/3'
      )
    })

    it('should handle complete cache miss', async () => {
      vi.mocked(cache.restoreCache).mockResolvedValue(undefined)

      const result = await restoreAllCaches(mockTools)

      expect(result.globalCacheHit).toBe(false)
      expect(result.cachedTools).toBe(0)
      expect(result.missingTools).toEqual(mockTools)

      expect(core.setOutput).toHaveBeenCalledWith('cache-hit', false)
      expect(core.setOutput).toHaveBeenCalledWith('global-cache-hit', false)
      expect(core.setOutput).toHaveBeenCalledWith('partial-cache-hit', false)
      expect(core.setOutput).toHaveBeenCalledWith(
        'tools-cache-hit-ratio',
        '0/3'
      )
    })

    it('should handle empty tools array', async () => {
      vi.mocked(cache.restoreCache).mockResolvedValue(undefined)

      const result = await restoreAllCaches([])

      expect(result.totalTools).toBe(0)
      expect(result.cachedTools).toBe(0)
      expect(result.toolCacheResults).toHaveLength(0)
    })

    it('should handle cache errors gracefully', async () => {
      vi.mocked(cache.restoreCache).mockRejectedValue(
        new Error('Cache service unavailable')
      )

      const result = await restoreAllCaches(mockTools)

      expect(result.globalCacheHit).toBe(false)
      expect(result.cachedTools).toBe(0)
      expect(core.warning).toHaveBeenCalledWith(
        expect.stringContaining('Failed to restore global mise cache')
      )
    })

    it('should use correct cache keys with custom prefix', async () => {
      vi.mocked(core.getInput).mockImplementation(name => {
        switch (name) {
          case 'version':
            return 'v2024.2.0'
          case 'cache_key_prefix':
            return 'custom-prefix'
          default:
            return ''
        }
      })

      await restoreAllCaches([mockTools[0]])

      expect(cache.restoreCache).toHaveBeenCalledWith(
        ['/mock/mise/dir/bin'],
        'custom-prefix-linux-x64-v2024.2.0-global'
      )
      expect(cache.restoreCache).toHaveBeenCalledWith(
        ['/mock/mise/dir/installs/node/18.17.0'],
        'custom-prefix-linux-x64-tool-node-18.17.0'
      )
    })

    it('should use default version when not specified', async () => {
      vi.mocked(core.getInput).mockImplementation(name => {
        switch (name) {
          case 'cache_key_prefix':
            return 'mise-v1'
          default:
            return ''
        }
      })

      await restoreAllCaches([])

      expect(cache.restoreCache).toHaveBeenCalledWith(
        ['/mock/mise/dir/bin'],
        'mise-v1-linux-x64-latest-global'
      )
    })
  })

  describe('saveAllCaches', () => {
    const mockCacheResult = createMockCacheResult({
      globalCacheHit: false,
      toolCacheResults: [
        {
          tool: mockTools[0],
          cacheKey: 'mise-v1-linux-x64-tool-node-18.17.0',
          cachePath: '/mock/mise/dir/installs/node/18.17.0',
          isRestored: false
        },
        {
          tool: mockTools[1],
          cacheKey: 'mise-v1-linux-x64-tool-python-3.11.0',
          cachePath: '/mock/mise/dir/installs/python/3.11.0',
          isRestored: true // This was restored, shouldn't be saved again
        }
      ]
    })

    beforeEach(() => {
      vi.mocked(fs.existsSync).mockReturnValue(true)
      vi.mocked(cache.saveCache).mockResolvedValue(12345)
      vi.mocked(core.getBooleanInput).mockImplementation(name => {
        if (name === 'cache_save') return true
        return false
      })
    })

    it('should save global cache and new tool caches', async () => {
      await saveAllCaches(mockCacheResult, [mockTools[0]])

      // Should save global cache
      expect(cache.saveCache).toHaveBeenCalledWith(
        ['/mock/mise/dir/bin'],
        'mise-v1-linux-x64-v2024.1.1-global'
      )

      // Should save new tool cache
      expect(cache.saveCache).toHaveBeenCalledWith(
        ['/mock/mise/dir/installs/node/18.17.0'],
        'mise-v1-linux-x64-tool-node-18.17.0'
      )

      // Should not save restored tool cache
      expect(cache.saveCache).not.toHaveBeenCalledWith(
        ['/mock/mise/dir/installs/python/3.11.0'],
        expect.any(String)
      )
    })

    it('should skip saving when cache_save is disabled', async () => {
      vi.mocked(core.getBooleanInput).mockReturnValue(false)

      await saveAllCaches(mockCacheResult, [mockTools[0]])

      expect(cache.saveCache).not.toHaveBeenCalled()
      expect(core.info).toHaveBeenCalledWith(
        'Cache saving disabled, skipping...'
      )
    })

    it('should skip global cache when it was restored', async () => {
      const cacheResultWithGlobalHit = createMockCacheResult({
        globalCacheHit: true,
        toolCacheResults: [
          {
            tool: mockTools[0],
            cacheKey: 'mise-v1-linux-x64-tool-node-18.17.0',
            cachePath: '/mock/mise/dir/installs/node/18.17.0',
            isRestored: false
          }
        ]
      })

      await saveAllCaches(cacheResultWithGlobalHit, [mockTools[0]])

      // Should not save global cache since it was hit
      expect(cache.saveCache).not.toHaveBeenCalledWith(
        ['/mock/mise/dir/bin'],
        expect.any(String)
      )

      // Should still save new tool cache
      expect(cache.saveCache).toHaveBeenCalledWith(
        ['/mock/mise/dir/installs/node/18.17.0'],
        'mise-v1-linux-x64-tool-node-18.17.0'
      )
    })

    it('should handle missing cache paths gracefully', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false)

      await saveAllCaches(mockCacheResult, [mockTools[0]])

      expect(core.warning).toHaveBeenCalledWith(
        expect.stringContaining('Global mise path does not exist')
      )
      expect(core.warning).toHaveBeenCalledWith(
        expect.stringContaining(
          'Tool cache path does not exist for node@18.17.0'
        )
      )
    })

    it('should handle cache save errors gracefully', async () => {
      vi.mocked(cache.saveCache).mockRejectedValue(
        new Error('Cache save failed')
      )

      await saveAllCaches(mockCacheResult, [mockTools[0]])

      expect(core.warning).toHaveBeenCalledWith(
        expect.stringContaining('Failed to save global mise cache')
      )
    })

    it('should handle cache already exists scenario', async () => {
      vi.mocked(cache.saveCache).mockResolvedValue(-1)

      await saveAllCaches(mockCacheResult, [mockTools[0]])

      expect(core.info).toHaveBeenCalledWith(
        expect.stringContaining('Global mise cache already exists')
      )
    })

    it('should only save caches for newly installed tools', async () => {
      const installedTools = [mockTools[0]] // Only node was installed
      const allToolsResult = createMockCacheResult({
        globalCacheHit: false,
        toolCacheResults: [
          {
            tool: mockTools[0],
            cacheKey: 'mise-v1-linux-x64-tool-node-18.17.0',
            cachePath: '/mock/mise/dir/installs/node/18.17.0',
            isRestored: false
          },
          {
            tool: mockTools[1],
            cacheKey: 'mise-v1-linux-x64-tool-python-3.11.0',
            cachePath: '/mock/mise/dir/installs/python/3.11.0',
            isRestored: false
          }
        ]
      })

      await saveAllCaches(allToolsResult, installedTools)

      // Should only save cache for installed tool (node)
      expect(cache.saveCache).toHaveBeenCalledWith(
        ['/mock/mise/dir/installs/node/18.17.0'],
        'mise-v1-linux-x64-tool-node-18.17.0'
      )

      // Should not save cache for non-installed tool (python)
      expect(cache.saveCache).not.toHaveBeenCalledWith(
        ['/mock/mise/dir/installs/python/3.11.0'],
        expect.any(String)
      )
    })
  })

  describe('cache key generation', () => {
    it('should generate different keys for different architectures', async () => {
      vi.mocked(utils.getSystemInfo)
        .mockResolvedValueOnce({
          platform: 'linux',
          arch: 'x64',
          target: 'linux-x64',
          isMusl: false
        })
        .mockResolvedValueOnce({
          platform: 'linux',
          arch: 'arm64',
          target: 'linux-arm64',
          isMusl: false
        })

      await restoreAllCaches([mockTools[0]])
      await restoreAllCaches([mockTools[0]])

      const calls = vi.mocked(cache.restoreCache).mock.calls
      expect(calls[0][1]).toContain('linux-x64')
      expect(calls[2][1]).toContain('linux-arm64')
    })

    it('should generate different keys for different versions', async () => {
      // Clear previous mocks
      vi.clearAllMocks()

      vi.mocked(core.getInput).mockImplementationOnce(name => {
        switch (name) {
          case 'version':
            return 'v2024.1.0'
          case 'cache_key_prefix':
            return 'mise-v1'
          default:
            return ''
        }
      })

      await restoreAllCaches([])

      // Clear mocks and setup second call
      vi.clearAllMocks()
      vi.mocked(core.getInput).mockImplementationOnce(name => {
        switch (name) {
          case 'version':
            return 'v2024.2.0'
          case 'cache_key_prefix':
            return 'mise-v1'
          default:
            return ''
        }
      })

      await restoreAllCaches([])

      const calls = vi.mocked(cache.restoreCache).mock.calls
      expect(calls[0][1]).toContain('v2024.2.0')
    })
  })

  describe('logging and outputs', () => {
    it('should log detailed cache results', async () => {
      vi.mocked(cache.restoreCache)
        .mockResolvedValueOnce('global-key')
        .mockResolvedValueOnce('tool-key')
        .mockResolvedValueOnce(undefined)

      await restoreAllCaches([mockTools[0], mockTools[1]])

      expect(core.info).toHaveBeenCalledWith(
        expect.stringContaining('Cache Results Summary')
      )
      expect(core.info).toHaveBeenCalledWith(
        expect.stringContaining('Global mise cache: ✓ Hit')
      )
      expect(core.info).toHaveBeenCalledWith(
        expect.stringContaining('Tool caches: 1/2 restored')
      )
      expect(core.info).toHaveBeenCalledWith(
        expect.stringContaining('Cache efficiency: 50.0%')
      )
    })

    it('should set all required outputs', async () => {
      vi.mocked(cache.restoreCache).mockResolvedValue(undefined)

      await restoreAllCaches(mockTools)

      expect(core.setOutput).toHaveBeenCalledWith('cache-hit', false)
      expect(core.setOutput).toHaveBeenCalledWith('global-cache-hit', false)
      expect(core.setOutput).toHaveBeenCalledWith('partial-cache-hit', false)
      expect(core.setOutput).toHaveBeenCalledWith(
        'tools-cache-hit-ratio',
        '0/3'
      )
      expect(core.setOutput).toHaveBeenCalledWith('cached-tools-count', 0)
      expect(core.setOutput).toHaveBeenCalledWith('missing-tools-count', 3)
    })
  })
})
