import type { Tool, CacheResult } from '../src/types'

declare global {
  function createMockTool(
    name: string,
    version: string,
    source?: 'mise.toml' | '.tool-versions' | 'install_args'
  ): Tool

  function createMockCacheResult(overrides?: Partial<CacheResult>): CacheResult
}

export {}
