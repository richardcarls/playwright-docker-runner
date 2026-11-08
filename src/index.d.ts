export interface Mount {
  source: string;
  target: string;
  readOnly?: boolean;
}

export interface RunnerConfig {
  installMode?: 'isolated' | 'host-pnp';
  image?: string;
  memory?: string;
  shmSize?: string;
  network?: string;
  mounts?: Mount[];
  fontDirs?: string[];
  passEnv?: string[];
  timezone?: string;
  locale?: string;
}

export function defineConfig(config: RunnerConfig): RunnerConfig;
export const DEFAULT_MEMORY: string;
export const DEFAULT_SHM_SIZE: string;
export function packageManager(root: string): { name: string; lockfile: string };
export function playwrightVersion(root: string): string;
export function workspaceDirectories(root: string, manager: string): string[];
export function cacheKey(root: string, manager: { name: string; lockfile: string }, image: string, directories: string[]): string;
export function loadConfig(root: string): Promise<RunnerConfig>;
export function forwardedEnv(hostEnv: Record<string, string | undefined>, names?: string[]): Record<string, string>;
export function dockerPlan(options: {
  root: string;
  manager: { name: string; lockfile: string };
  version: string;
  command: 'run' | 'exec';
  args?: string[];
  config?: RunnerConfig;
  env?: Record<string, string | undefined>;
  platform?: string;
  home?: string;
  uid?: number;
  gid?: number;
  tty?: boolean;
  freshInstall?: boolean;
}): { args: string[]; image: string; volumes: string[]; containerEnv: Record<string, string> };
export const CONTAINER_SCRIPT: string;
