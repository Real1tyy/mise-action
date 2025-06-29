export interface MiseConfig {
  version?: string
  experimental?: boolean
  logLevel?: string
  githubToken?: string
  workingDirectory?: string
  installDir?: string
  installArgs?: string
  toolVersions?: string
  miseToml?: string
}

export interface CacheConfig {
  enabled: boolean
  saveCacheEnabled: boolean
  keyPrefix?: string
  primaryKey?: string
  cachePath?: string
}

export interface SystemInfo {
  platform: string
  arch: string
  target: string
  isMusl: boolean
}

export interface Tool {
  name: string
  version: string
  source: 'mise.toml' | '.tool-versions' | 'install_args'
}

export interface ToolCacheInfo {
  tool: Tool
  cacheKey: string
  cachePath: string
  isRestored: boolean
}

export interface CacheResult {
  globalCacheHit: boolean
  toolCacheResults: ToolCacheInfo[]
  totalTools: number
  cachedTools: number
  missingTools: Tool[]
}
