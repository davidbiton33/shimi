export type Stage = 'idle' | 'active' | 'ended';
export type PackStatus = 'ready' | 'disabled' | 'error' | 'repomix-missing';
export type ProjectProfile = { generatedAt: string; root: string; name: string; frameworks: string[]; languages: string[]; monorepo: boolean; include: string[]; packageManager: string | null; };
export type GitSnapshot = { timestamp: string; branch: string; head: string | null; changed: string[]; staged: string[]; untracked: string[]; fingerprint: string; };
export type Session = { id: string; state: Stage; startedAt: string; updatedAt: string; endedAt?: string; branch: string; head: string | null; task: string; lastCheckpoint: string | null; packStatus: PackStatus; lastError?: string; };
export type Checkpoint = { id: string; createdAt: string; reason: string; sessionId: string; branch: string; head: string | null; changed: string[]; staged: string[]; untracked: string[]; fingerprint: string; taskHash: string; packStatus: PackStatus; };
export type Config = {
  version: number;
  watcher: { intervalSeconds: number; checkpointSeconds: number; packDebounceSeconds: number; autoStart: boolean };
  checkpoints: { keep: number };
  packer: { enabled: boolean; include: string[]; ignore: string[]; maxFiles:number; maxFileBytes:number; maxTotalBytes:number; maxOutputBytes:number; smart:{ mode:"smart"|"full"; maxEstimatedTokens:number; minSymbolScore:number; fullFileThresholdBytes:number; fileBudgetBytes:number } };
  editorOrder: string[];
  customIgnore: string[];
};
export type WatcherInfo = { pid: number; sessionId: string; nonce?: string; startedAt: string; updatedAt: string };
