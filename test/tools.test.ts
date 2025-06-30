import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as core from '@actions/core'
import * as glob from '@actions/glob'
import * as fs from 'fs'
import { getAllTools, generateToolHash, toolsToInstallArgs } from '../src/tools'
import type { Globber } from '@actions/glob'

describe('tools', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('getAllTools', () => {
    it('should parse tools from install_args', async () => {
      vi.mocked(core.getInput).mockImplementation(name => {
        if (name === 'install_args') return 'node@18.17.0 python@3.11.0'
        return ''
      })

      vi.mocked(glob.create).mockResolvedValue({
        glob: vi.fn().mockResolvedValue([])
      } as unknown as Globber)

      const result = await getAllTools()

      expect(result).toHaveLength(2)
      expect(result[0]).toEqual({
        name: 'node',
        version: '18.17.0',
        source: 'install_args'
      })
      expect(result[1]).toEqual({
        name: 'python',
        version: '3.11.0',
        source: 'install_args'
      })
    })

    it('should parse tools from .tool-versions files', async () => {
      vi.mocked(core.getInput).mockReturnValue('')

      const mockGlobber = {
        glob: vi.fn().mockResolvedValue(['.tool-versions'])
      }
      vi.mocked(glob.create).mockResolvedValue(
        mockGlobber as unknown as Globber
      )

      vi.mocked(fs.promises.readFile).mockResolvedValue(
        'node 18.17.0\npython 3.11.0\n# comment line\nruby 3.2.0'
      )

      const result = await getAllTools()

      expect(result).toHaveLength(3)
      expect(result).toContainEqual({
        name: 'node',
        version: '18.17.0',
        source: '.tool-versions'
      })
      expect(result).toContainEqual({
        name: 'python',
        version: '3.11.0',
        source: '.tool-versions'
      })
      expect(result).toContainEqual({
        name: 'ruby',
        version: '3.2.0',
        source: '.tool-versions'
      })
    })

    it('should parse tools from mise.toml files', async () => {
      vi.mocked(core.getInput).mockReturnValue('')

      const mockGlobber = {
        glob: vi
          .fn()
          .mockResolvedValueOnce([]) // .tool-versions
          .mockResolvedValueOnce(['mise.toml']) // mise.toml
      }
      vi.mocked(glob.create).mockResolvedValue(
        mockGlobber as unknown as Globber
      )

      vi.mocked(fs.promises.readFile).mockResolvedValue(`
[tools]
node = "18.17.0"
python = {version = "3.11.0"}
# comment
go = "1.21.0"

[env]
NODE_ENV = "development"
      `)

      const result = await getAllTools()

      expect(result).toHaveLength(3)
      expect(result).toContainEqual({
        name: 'node',
        version: '18.17.0',
        source: 'mise.toml'
      })
      expect(result).toContainEqual({
        name: 'python',
        version: '3.11.0',
        source: 'mise.toml'
      })
      expect(result).toContainEqual({
        name: 'go',
        version: '1.21.0',
        source: 'mise.toml'
      })
    })

    it('should deduplicate tools with preference order', async () => {
      vi.mocked(core.getInput).mockImplementation(name => {
        if (name === 'install_args') return 'node@20.0.0'
        return ''
      })

      const mockGlobber = {
        glob: vi
          .fn()
          .mockResolvedValueOnce(['.tool-versions'])
          .mockResolvedValueOnce(['mise.toml'])
      }
      vi.mocked(glob.create).mockResolvedValue(
        mockGlobber as unknown as Globber
      )

      vi
        .mocked(fs.promises.readFile)
        .mockResolvedValueOnce('node 18.17.0\npython 3.11.0') // .tool-versions
        .mockResolvedValueOnce(`
[tools]
node = "19.0.0"
go = "1.21.0"
        `) // mise.toml

      const result = await getAllTools()

      expect(result).toHaveLength(3)
      // install_args should have highest priority
      expect(result.find(t => t.name === 'node')).toEqual({
        name: 'node',
        version: '20.0.0',
        source: 'install_args'
      })
      expect(result.find(t => t.name === 'python')).toEqual({
        name: 'python',
        version: '3.11.0',
        source: '.tool-versions'
      })
      expect(result.find(t => t.name === 'go')).toEqual({
        name: 'go',
        version: '1.21.0',
        source: 'mise.toml'
      })
    })

    it('should handle empty configurations gracefully', async () => {
      vi.mocked(core.getInput).mockReturnValue('')
      vi.mocked(glob.create).mockResolvedValue({
        glob: vi.fn().mockResolvedValue([])
      } as unknown as Globber)

      const result = await getAllTools()

      expect(result).toHaveLength(0)
    })

    it('should handle file read errors gracefully', async () => {
      vi.mocked(core.getInput).mockReturnValue('')

      const mockGlobber = {
        glob: vi.fn().mockResolvedValue(['.tool-versions'])
      }
      vi.mocked(glob.create).mockResolvedValue(
        mockGlobber as unknown as Globber
      )

      vi.mocked(fs.promises.readFile).mockRejectedValue(
        new Error('File not found')
      )

      const result = await getAllTools()

      expect(result).toHaveLength(0)
      expect(core.warning).toHaveBeenCalledWith(
        expect.stringContaining('Failed to parse .tool-versions')
      )
    })

    it('should skip invalid tool specifications', async () => {
      vi.mocked(core.getInput).mockImplementation(name => {
        if (name === 'install_args') return 'node@18.17.0 invalid-spec python'
        return ''
      })

      vi.mocked(glob.create).mockResolvedValue({
        glob: vi.fn().mockResolvedValue([])
      } as unknown as Globber)

      const result = await getAllTools()

      expect(result).toHaveLength(1)
      expect(result[0]).toEqual({
        name: 'node',
        version: '18.17.0',
        source: 'install_args'
      })
    })

    it('should sort tools alphabetically', async () => {
      vi.mocked(core.getInput).mockImplementation(name => {
        if (name === 'install_args') return 'zebra@1.0.0 alpha@2.0.0 beta@3.0.0'
        return ''
      })

      vi.mocked(glob.create).mockResolvedValue({
        glob: vi.fn().mockResolvedValue([])
      } as unknown as Globber)

      const result = await getAllTools()

      expect(result.map(t => t.name)).toEqual(['alpha', 'beta', 'zebra'])
    })
  })

  describe('generateToolHash', () => {
    it('should generate consistent hash for tool', () => {
      const tool = createMockTool('node', '18.17.0')

      const hash = generateToolHash(tool)

      expect(hash).toBe('node-18.17.0')
    })

    it('should generate different hashes for different tools', () => {
      const tool1 = createMockTool('node', '18.17.0')
      const tool2 = createMockTool('python', '3.11.0')

      const hash1 = generateToolHash(tool1)
      const hash2 = generateToolHash(tool2)

      expect(hash1).not.toBe(hash2)
    })

    it('should generate different hashes for same tool with different versions', () => {
      const tool1 = createMockTool('node', '18.17.0')
      const tool2 = createMockTool('node', '20.0.0')

      const hash1 = generateToolHash(tool1)
      const hash2 = generateToolHash(tool2)

      expect(hash1).not.toBe(hash2)
    })
  })

  describe('toolsToInstallArgs', () => {
    it('should convert tools to install arguments', () => {
      const tools = [
        createMockTool('node', '18.17.0'),
        createMockTool('python', '3.11.0'),
        createMockTool('go', '1.21.0')
      ]

      const result = toolsToInstallArgs(tools)

      expect(result).toBe('node@18.17.0 python@3.11.0 go@1.21.0')
    })

    it('should handle empty tools array', () => {
      const result = toolsToInstallArgs([])

      expect(result).toBe('')
    })

    it('should handle single tool', () => {
      const tools = [createMockTool('node', '18.17.0')]

      const result = toolsToInstallArgs(tools)

      expect(result).toBe('node@18.17.0')
    })
  })

  describe('TOML parsing edge cases', () => {
    it('should handle complex TOML structure', async () => {
      vi.mocked(core.getInput).mockReturnValue('')

      const mockGlobber = {
        glob: vi
          .fn()
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce(['mise.toml'])
      }
      vi.mocked(glob.create).mockResolvedValue(
        mockGlobber as unknown as Globber
      )

      vi.mocked(fs.promises.readFile).mockResolvedValue(`
[other_section]
key = "value"

[tools]
node = "18.17.0"
python = { version = "3.11.0", source = "conda" }

[env]
NODE_ENV = "production"

[another_section]
[tools.nested]
something = "value"
      `)

      const result = await getAllTools()

      expect(result).toHaveLength(2)
      expect(result).toContainEqual({
        name: 'node',
        version: '18.17.0',
        source: 'mise.toml'
      })
      expect(result).toContainEqual({
        name: 'python',
        version: '3.11.0',
        source: 'mise.toml'
      })
    })

    it('should handle malformed TOML gracefully', async () => {
      vi.mocked(core.getInput).mockReturnValue('')

      const mockGlobber = {
        glob: vi
          .fn()
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce(['mise.toml'])
      }
      vi.mocked(glob.create).mockResolvedValue(
        mockGlobber as unknown as Globber
      )

      vi.mocked(fs.promises.readFile).mockResolvedValue(`
[tools]
node =
invalid_line_without_value
python = "3.11.0"
      `)

      const result = await getAllTools()

      expect(result).toHaveLength(1)
      expect(result[0]).toEqual({
        name: 'python',
        version: '3.11.0',
        source: 'mise.toml'
      })
    })
  })
})
