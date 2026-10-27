import { existsSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { ProjectProfile } from './types.js';
import { gitPaths } from './git.js';
import { adapterFor } from './languages.js';
import { now, pathFor, readJson, readText, saveJson, writeAtomic } from './utils.js';

const has=(root:string,p:string)=>existsSync(join(root,p));
const scan=(root:string,paths:string[]):ProjectProfile=>{
  const pkg=readJson<{name?:string; dependencies?:Record<string,string>;devDependencies?:Record<string,string>}>(join(root,'package.json'),{});
  const deps={...pkg.dependencies,...pkg.devDependencies};
  const frameworks=new Set<string>();const languages=new Set<string>();
  if(has(root,'next.config.js')||has(root,'next.config.mjs')||has(root,'next.config.ts')||deps.next)frameworks.add('Next.js');
  if(has(root,'vite.config.ts')||has(root,'vite.config.js')||has(root,'vite.config.mts')||deps.vite) frameworks.add('Vite');
  if(deps.react)frameworks.add('React');
  if(deps.angular || deps['@angular/core'])frameworks.add('Angular');
  if(deps['@nestjs/core']||has(root,'nest-cli.json'))frameworks.add('NestJS');
  if(deps.express||paths.some(p=>/^((src|server)\/)?(routes|app)\.(js|ts)$/.test(p)))frameworks.add('Express');
  if(has(root,'pyproject.toml') || has(root,'requirements.txt'))frameworks.add('Python');
  if(has(root,'Cargo.toml'))frameworks.add('Rust');
  if(has(root,'go.mod'))frameworks.add('Go');
  if(has(root,'pom.xml')||has(root,'build.gradle'))frameworks.add('Java');
  const monorepo=has(root,'pnpm-workspace.yaml')||has(root,'turbo.json')||has(root,'nx.json')||has(root,'lerna.json');
  if(monorepo) frameworks.add('Monorepo');
  for(const p of paths){
    const adapter=adapterFor(p);
    if(!adapter)continue;
    const id=adapter.id;
    const label:Record<string,string>={
      'javascript-typescript':/\.[cm]?tsx?$/.test(p)?'TypeScript':'JavaScript',
      python:'Python',go:'Go',rust:'Rust',java:'Java',csharp:'C#',ruby:'Ruby',php:'PHP',cpp:/\.(?:c|h)$/.test(p)?'C':'C++',kotlin:'Kotlin',dart:'Dart'
    };
    if(label[id])languages.add(label[id]);
  }
  const include=['package.json','README.md','src/**/*','app/**/*','pages/**/*','server/**/*','apps/**/*','packages/**/*','lib/**/*','tests/**/*','*.config.*'];
  if(languages.has('Python')) include.push('**/*.py','pyproject.toml');
  if(languages.has('Go')) include.push('**/*.go','go.mod');
  if(languages.has('Rust')) include.push('**/*.rs','Cargo.toml');
  if(languages.has('Java'))include.push('**/*.java','pom.xml');
  if(languages.has('C#'))include.push('**/*.cs','*.sln','*.csproj');
  if(languages.has('Ruby'))include.push('**/*.rb','Gemfile');
  if(languages.has('PHP'))include.push('**/*.php','composer.json');
  if(languages.has('C')||languages.has('C++'))include.push('**/*.c','**/*.cpp','**/*.h','**/*.hpp','CMakeLists.txt');
  if(languages.has('Kotlin'))include.push('**/*.kt','**/*.kts');
  if(languages.has('Dart'))include.push('**/*.dart','pubspec.yaml');
  const packageManager=has(root,'pnpm-lock.yaml')?'pnpm':has(root,'yarn.lock')?'yarn':has(root,'bun.lockb')||has(root,'bun.lock')?'bun':has(root,'package-lock.json')?'npm':null;
  return {generatedAt:now(),root,name:pkg.name||basename(root),frameworks:[...frameworks].sort(),languages:[...languages].sort(),monorepo,include:[...new Set(include)],packageManager};
};
export function detectProject(root:string):ProjectProfile {return scan(root,gitPaths(root));}
export function updateProject(root:string) {
  const profile=detectProject(root); saveJson(pathFor(root,'PROJECT_PROFILE.json'),profile);
  const files=gitPaths(root);
  const directories=new Map<string,number>();
  for(const p of files){const parts=p.split('/');for(let i=0;i<parts.length-1;i++){const k=parts.slice(0,i+1).join('/');directories.set(k,(directories.get(k)||0)+1);}}
  const summary=[`# Project Map`,``,`Project: ${profile.name}`,`Detected: ${profile.frameworks.join(', ')||'No framework detected'}`,`Languages: ${profile.languages.join(', ')||'Unknown'}`,`Tracked / visible files: ${files.length}`,``,`## Directories`,...([...directories].sort((a,b)=>a[0].localeCompare(b[0])).slice(0,200).map(([p,n])=>`- ${p}/ (${n} files)`)),``,`## Important files`,...files.filter(p=>p.split('/').length<=2 || /(^|\/)(package.json|tsconfig.json|README.md|Dockerfile|go.mod|pyproject.toml)$/.test(p)).slice(0,150).map(p=>`- ${p}`),``];
  writeAtomic(pathFor(root,'PROJECT_MAP.md'),summary.join('\n'));
  return profile;
}
