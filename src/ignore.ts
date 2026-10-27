import { readText, writeAtomic, safeProjectPath } from './utils.js';

const BEGIN='# >>> AGENTOS MANAGED >>>';
const END='# <<< AGENTOS MANAGED <<<';
export const safeIgnores=[
  '.ai/**','node_modules/**','dist/**','build/**','coverage/**','.git/**',
  '.env','.env.*','**/.env','**/.env.*','**/*secret*','**/*credential*',
  '**/*.pem','**/*.key','**/*.p12','**/*.pfx','**/id_rsa*','**/.ssh/**',
  '**/*.lock','**/*.log','**/.next/**','**/.turbo/**','**/.cache/**'
];
export function managedBlock(lines:string[]) {return `${BEGIN}\n${lines.join('\n')}\n${END}`;}
export function mergeManaged(original:string, lines:string[]) {
  const block=managedBlock(lines);
  const start=original.indexOf(BEGIN), end=original.indexOf(END);
  if((start<0)!==(end<0)) throw new Error('Managed section markers are incomplete; refusing to overwrite');
  if(start>=0){if(end<start)throw new Error('Managed section markers out of order');return original.slice(0,start)+block+original.slice(end+END.length);}
  return (original.trimEnd()?original.trimEnd()+'\n\n':'')+block+'\n';
}
export function syncIgnores(root:string, user:string[]) {
  const path=safeProjectPath(root,'.agentosignore');
  const contents=mergeManaged(readText(path),safeIgnores);
  writeAtomic(path,contents);
  return [...new Set([...safeIgnores,...user,...readText(path).split(/\r?\n/).filter(l=>l.trim()&&!l.trim().startsWith('#'))])];
}
export function syncGitignore(root:string){
  const path=safeProjectPath(root,'.gitignore');
  const lines=['.ai/packs/','.ai/checkpoints/','.ai/journal/','.ai/runtime/','.ai/exports/','.ai/cache/','.ai/session-notes/','.ai/evidence/'];
  writeAtomic(path,mergeManaged(readText(path),lines));
}
