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
