/** QA-only SCIP generator, driven by the REAL TypeScript TypeChecker.
 * Not scip-typescript, not bundled as part of AgentOS's runtime. Offline.
 * Invoke: node qa/typescript-compiler-scip.mjs <ts-project> <output.scip>
 */
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
const require=createRequire(import.meta.url);
const ts=require('../vendor/typescript.cjs');
const [r,o]=process.argv.slice(2);
if(!r||!o)throw new Error('Usage: node qa/typescript-compiler-scip.mjs <root> <out.scip>');
const root=resolve(r),output=resolve(o);
const cfgPath=ts.findConfigFile(root,ts.sys.fileExists,'tsconfig.json');
if(!cfgPath)throw new Error('No tsconfig.json: '+root);
const cfg=ts.readConfigFile(cfgPath,ts.sys.readFile);
if(cfg.error)throw new Error(ts.flattenDiagnosticMessageText(cfg.error.messageText,'\n'));
const parsed=ts.parseJsonConfigFileContent(cfg.config,ts.sys,dirname(cfgPath));
const program=ts.createProgram({rootNames:parsed.fileNames,options:{...parsed.options,noEmit:true}});
const checker=program.getTypeChecker();
const files=new Set(execFileSync('git',['ls-files','-z','--cached','--others','--exclude-standard'],{cwd:root}).toString('utf8').split('\0').filter(Boolean));
const toRel=(p)=>relative(root,p).split(sep).join('/');
const local=(p)=>files.has(toRel(p)) && /^[\w./-]+\.[mc]?[jt]sx?$/.test(toRel(p));
const v=(n)=>{let out=[];do{let b=n%128;n=Math.floor(n/128);out.push(n?b|128:b)}while(n);return Buffer.from(out)};
const str=(n,s)=>blob(n,Buffer.from(s,'utf8'));
const blob=(n,b)=>Buffer.concat([v(n*8+2),v(b.length),b]);
const integer=(n,i)=>Buffer.concat([v(n*8),v(i)]);
const message=(...xs)=>Buffer.concat(xs);
const rootUrl=pathToFileURL(root).href;
const metadata=blob(1,message(blob(2,message(str(1,'agentos-ts-compiler-qa'),str(2,ts.version))),str(3,rootUrl)));
const docs=[];let defs=0,refs=0,filesIndexed=0;
for(const sf of program.getSourceFiles()){
 if(sf.isDeclarationFile||!local(sf.fileName))continue;
 const path=toRel(sf.fileName);const occ=[];const seen=new Set();
 const visit=(node)=>{
  if(ts.isIdentifier(node)||ts.isPrivateIdentifier(node)){
   let sym=checker.getSymbolAtLocation(node);
   if(sym && (sym.flags & ts.SymbolFlags.Alias)){
    try{sym=checker.getAliasedSymbol(sym);}catch{sym=undefined;}
   }
   if(sym){
    const declarations=(sym.declarations||[]).filter(d=>local(d.getSourceFile().fileName));
    if(declarations.length){
     const d=declarations.sort((a,b)=>toRel(a.getSourceFile().fileName).localeCompare(toRel(b.getSourceFile().fileName))||a.getStart()-b.getStart())[0];
     const declName=d.name&&ts.isIdentifier(d.name)?d.name:d;
     const id=`scip npm typechecker 1 ${toRel(d.getSourceFile().fileName)}#${declName.getStart()}.`;
     const start=sf.getLineAndCharacterOfPosition(node.getStart(sf));
     const end=sf.getLineAndCharacterOfPosition(node.getEnd());
     if(start.line===end.line){
      const isDefinition=declarations.some(d=>d.getSourceFile()===sf && d.name===node);
      const key=`${node.getStart()}:${id}`;
      if(!seen.has(key)){
       seen.add(key);
       occ.push(blob(2,message(blob(8,message(integer(1,start.line),integer(2,start.character),integer(3,end.character))),str(2,id),...(isDefinition?[integer(3,1)]:[]))));
       if(isDefinition)defs++;else refs++;
      }
     }
    }
   }
  }
  ts.forEachChild(node,visit);
 };
 visit(sf);
 if(occ.length){docs.push(blob(2,message(str(1,path),...occ,integer(6,2))));filesIndexed++;}
}
mkdirSync(dirname(output),{recursive:true});
writeFileSync(output,message(metadata,...docs));
console.log(JSON.stringify({root,output,indexer:'TypeScript TypeChecker 5.8.3 (QA-only, not official scip-typescript)',indexedFiles:filesIndexed,definitions:defs,references:refs,indexBytes:readFileSync(output).length}));
