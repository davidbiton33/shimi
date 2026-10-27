import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync, existsSync, statSync, lstatSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

export const now = () => new Date().toISOString();
export const uid = () => randomUUID().slice(0, 12);
export const sha = (s: string) => createHash('sha256').update(s).digest('hex');
/**
 * Resolve only project-owned paths and reject links at every existing component.
 * This prevents an untrusted repository from redirecting generated files outside
 * the project through .ai/packs, .ai/runtime, editor adapter directories, etc.
 * The project root itself is the caller's trusted working directory.
 */
export function safeProjectPath(root:string, relativePath:string):string {
  const base=resolve(root);
  const target=resolve(base,relativePath);
  if(!inRoot(base,target)||target===base)throw new Error(`Unsafe project path: ${relativePath}`);
  let cursor=base;
  for(const part of relative(base,target).split(sep)){
    cursor=join(cursor,part);
    try {
      if(lstatSync(cursor).isSymbolicLink())throw new Error(`Unsafe symlink in project path: ${cursor}`);
    }catch(e){ if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e; }
  }
  return target;
}
export const pathFor=(root:string,...parts:string[])=>safeProjectPath(root,join('.ai',...parts));
export function writeAtomic(path: string, data: string) {
  mkdirSync(dirname(path), {recursive:true});
  const temp = join(dirname(path), `.${randomUUID()}.tmp`);
  try { writeFileSync(temp, data, {encoding:'utf8', mode:0o600}); renameSync(temp, path); }
  catch(e) { rmSync(temp, {force:true}); throw e; }
}
export function readText(path: string, fallback = ''): string { try { return readFileSync(path, 'utf8'); } catch(e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return fallback; throw e; } }
export function readJson<T>(path: string, fallback: T): T {
  const text = readText(path);
  if (!text) return fallback;
  try { return JSON.parse(text) as T; } catch { throw new Error(`Invalid JSON: ${path}`); }
}
export function saveJson(path:string, value:unknown){ writeAtomic(path, JSON.stringify(value, null, 2) + '\n'); }
export function command(cmd: string, args: string[], cwd: string, timeout=10000) {
  const result = spawnSync(cmd, args, {cwd, encoding:'utf8', timeout, maxBuffer:20 * 1024 * 1024, windowsHide:true});
  return { ok: result.status === 0 && !result.error, stdout: result.stdout||'', stderr: result.stderr||'', error: result.error?.message||'' };
}
export function inRoot(root:string, candidate:string) {
  const r=relative(resolve(root), resolve(candidate)); return r === '' || (r !== '..' && !r.startsWith(`..${sep}`) && !r.startsWith('/') && !r.startsWith('\\'));
}
export function normalizeFile(root:string, file:string):string|null {
  if (!file || file.includes('\0')) return null;
  const dest=resolve(root, file);
  if (!inRoot(root,dest)) return null;
  const norm=relative(root,dest).split(sep).join('/');
  if (!norm || norm === '.ai' || norm.startsWith('.ai/') || norm.startsWith('.git/')) return null;
  try { if (existsSync(dest) && statSync(dest).isDirectory()) return null; } catch {}
  return norm;
}
export function epoch(value:string|undefined) { const t=Date.parse(value||'');return Number.isFinite(t)?t:0; }
