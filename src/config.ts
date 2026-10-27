import { join } from 'node:path';
import { Config } from './types.js';
import { readText, writeAtomic, safeProjectPath } from './utils.js';

// Intentionally strict YAML subset: nested maps + JSON-format inline arrays/scalars.
// This makes config deterministic without a runtime YAML dependency.
export const defaults: Config = {
  version: 1,
  watcher: { intervalSeconds: 10, checkpointSeconds: 120, packDebounceSeconds: 20, autoStart: true },
  checkpoints: { keep: 30 },
  packer: { enabled: true, include: [], ignore: [], maxFiles: 200, maxFileBytes: 131072, maxTotalBytes: 2097152, maxOutputBytes: 1048576, smart:{mode:"smart",maxEstimatedTokens:200000,minSymbolScore:30,fullFileThresholdBytes:800,fileBudgetBytes:65536} },
  editorOrder: ['cursor','claude','windsurf','cline','roo','kiro','trae'],
  customIgnore: []
};
function scalar(v:string):unknown {
  const t=v.trim();
  if (/^(true|false|null|-?\d+(?:\.\d+)?)$/.test(t) || t.startsWith('[') || t.startsWith('"')) {
    try { return JSON.parse(t); }catch{ throw new Error(`Bad YAML scalar: ${t}`); }
  }
  if (t.startsWith("'") && t.endsWith("'")) return t.slice(1,-1);
  if (t.startsWith('{') || t.startsWith('- ')) throw new Error('Unsupported YAML syntax; use JSON arrays, e.g. ["src/**"]');
  return t;
}
export function parseConfig(input:string): Config {
  const obj: Record<string,any>={}; let section:string|null=null;
  for (const [i,line] of input.split(/\r?\n/).entries()) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const m=line.match(/^(  )?([A-Za-z][\w]*):(?:\s+(.*))?\s*$/);
    if (!m) throw new Error(`Unsupported agentos.yml syntax at line ${i+1}`);
    const [,indent,key,raw] = m;
    if (!indent) {
      if (raw === undefined) { section=key;obj[key]={}; }
      else { obj[key]=scalar(raw); section=null; }
    } else {
      if (!section || Array.isArray(obj[section])) throw new Error(`Unexpected indentation at line ${i+1}`);
      obj[section][key]=scalar(raw??'');
    }
  }
  const allowed=['version','watcher','checkpoints','packer','repomix','editorOrder','customIgnore','smart'];
  for (const key of Object.keys(obj)) if(!allowed.includes(key)) throw new Error(`Unknown config key: ${key}`);
  // v0.2 migration: keep existing agentos.yml working without requiring Repomix.
  const legacy=obj.repomix;
  if(legacy && obj.packer) throw new Error("Use either packer or legacy repomix configuration, not both");
  const rawPacker=legacy?{enabled:legacy.enabled,include:legacy.include,ignore:legacy.ignore}:obj.packer;
  const rawSmart=obj.smart;
  delete obj.repomix; delete obj.smart;
  const merged: Config = {
    ...defaults, ...obj,
    watcher:{...defaults.watcher,...obj.watcher},
    checkpoints:{...defaults.checkpoints,...obj.checkpoints},
    packer:{...defaults.packer,...rawPacker,smart:{...defaults.packer.smart,...rawSmart}}
  };
  for(const [label,n,min,max] of [
    ['version',merged.version,1,1],
    ['watcher.intervalSeconds',merged.watcher.intervalSeconds,1,3600],
    ['watcher.checkpointSeconds',merged.watcher.checkpointSeconds,1,86400],
    ['watcher.packDebounceSeconds',merged.watcher.packDebounceSeconds,0,3600],
    ['checkpoints.keep',merged.checkpoints.keep,1,10000],
    ['packer.maxFiles',merged.packer.maxFiles,1,10000],
    ['packer.maxFileBytes',merged.packer.maxFileBytes,256,10485760],
    ['packer.maxTotalBytes',merged.packer.maxTotalBytes,1024,104857600],
    ['packer.maxOutputBytes',merged.packer.maxOutputBytes,1024,104857600],
    ['packer.smart.maxEstimatedTokens',merged.packer.smart.maxEstimatedTokens,256,10000000],
    ['packer.smart.minSymbolScore',merged.packer.smart.minSymbolScore,0,200],
    ['packer.smart.fullFileThresholdBytes',merged.packer.smart.fullFileThresholdBytes,0,10485760],
    ['packer.smart.fileBudgetBytes',merged.packer.smart.fileBudgetBytes,512,10485760]
  ] as const) if(!Number.isInteger(n) || n<min || n>max)throw new Error(`${label} must be an integer between ${min} and ${max}`);
  if(!['smart','full'].includes(merged.packer.smart.mode))throw new Error('packer.smart.mode must be smart or full');
  for(const [k,v] of Object.entries({autoStart:merged.watcher.autoStart,enabled:merged.packer.enabled})) if(typeof v!=='boolean') throw new Error(`${k} must be boolean`);
  for(const [k,v] of Object.entries({editorOrder:merged.editorOrder,customIgnore:merged.customIgnore,'packer.include':merged.packer.include,'packer.ignore':merged.packer.ignore}))
    if(!Array.isArray(v)||!v.every(x=>typeof x==='string' && x.length<400 && !x.includes('\0')))throw new Error(`${k} must be a string array`);
  return merged;
}
export function configText(c:Config=defaults):string {
  return `# AgentOS: strict YAML subset. Inline arrays use JSON syntax.\nversion: ${c.version}\nwatcher:\n  intervalSeconds: ${c.watcher.intervalSeconds}\n  checkpointSeconds: ${c.watcher.checkpointSeconds}\n  packDebounceSeconds: ${c.watcher.packDebounceSeconds}\n  autoStart: ${c.watcher.autoStart}\ncheckpoints:\n  keep: ${c.checkpoints.keep}\npacker:\n  enabled: ${c.packer.enabled}\n  include: ${JSON.stringify(c.packer.include)}\n  ignore: ${JSON.stringify(c.packer.ignore)}\n  maxFiles: ${c.packer.maxFiles}\n  maxFileBytes: ${c.packer.maxFileBytes}\n  maxTotalBytes: ${c.packer.maxTotalBytes}\n  maxOutputBytes: ${c.packer.maxOutputBytes}\nsmart:\n  mode: ${c.packer.smart.mode}\n  maxEstimatedTokens: ${c.packer.smart.maxEstimatedTokens}\n  minSymbolScore: ${c.packer.smart.minSymbolScore}\n  fullFileThresholdBytes: ${c.packer.smart.fullFileThresholdBytes}\n  fileBudgetBytes: ${c.packer.smart.fileBudgetBytes}\neditorOrder: ${JSON.stringify(c.editorOrder)}\ncustomIgnore: ${JSON.stringify(c.customIgnore)}\n`;
}
export function loadConfig(root:string):Config {
  const input=readText(safeProjectPath(root,'agentos.yml'));
  if(!input) throw new Error('agentos.yml missing. Run `agentos init` first.');
  return parseConfig(input);
}
export function saveDefaultConfig(root:string) { writeAtomic(safeProjectPath(root,'agentos.yml'), configText()); }
