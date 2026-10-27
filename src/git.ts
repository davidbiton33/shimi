import { statSync } from 'node:fs';
import { resolve } from 'node:path';
import { GitSnapshot } from './types.js';
import { command, normalizeFile, now, sha } from './utils.js';

export function gitAvailable(root:string) {return command('git',['--version'],root).ok;}
export function isGitRepo(root:string) {return command('git',['rev-parse','--is-inside-work-tree'],root).stdout.trim()==='true';}
export function gitTop(root:string) {const r=command('git',['rev-parse','--show-toplevel'],root);return r.ok?resolve(r.stdout.trim()):null;}
export function gitPaths(root:string):string[] {
  const r=command('git',['ls-files','--cached','--others','--exclude-standard','-z'],root,30000);
  if(!r.ok) return [];
  return [...new Set(r.stdout.split('\0').map(x=>normalizeFile(root,x)).filter((x):x is string=>!!x))].sort();
}
export function gitSnapshot(root:string):GitSnapshot {
  const branch=command('git',['branch','--show-current'],root).stdout.trim()||'(detached)';
  const headResult=command('git',['rev-parse','HEAD'],root);
  const head=headResult.ok?headResult.stdout.trim():null;
  const result=command('git',['status','--porcelain=v1','-z','--untracked-files=all'],root,30000);
  if (!result.ok) throw new Error(`git status failed: ${result.stderr || result.error}`);
  const records=result.stdout.split('\0'); const changed:string[]=[]; const staged:string[]=[]; const untracked:string[]=[];
  for(let i=0;i<records.length;i++) {
    const s=records[i];if(s.length<4)continue;
    const code=s.slice(0,2), path=normalizeFile(root,s.slice(3));
    if(!path)continue;
    if(code==='??') untracked.push(path);
    else {changed.push(path); if(code[0]!==' ')staged.push(path);}
    if(code.includes('R')||code.includes('C')) i++; // porcelain -z adds an extra original path
  }
  const all=[...new Set([...changed,...untracked])].sort();
  const states=all.map(x=>{try{const s=statSync(resolve(root,x));return `${x}:${s.size}:${s.mtimeMs}`;}catch{return `${x}:deleted`;}});
  const stagedDiff=command('git',['diff','--cached','--raw'],root,30000).stdout;
  return {timestamp:now(),branch,head,changed:[...new Set(changed)].sort(),staged:[...new Set(staged)].sort(),untracked:[...new Set(untracked)].sort(),fingerprint:sha([branch,head,...states,...staged,stagedDiff].join('\n'))};
}
