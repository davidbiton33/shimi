/**
 * Language-neutral dependency extraction. JS/TS uses the bundled TypeScript AST;
 * other adapters are conservative static scanners, NOT advertised as AST parsers.
 * No source code execution or package installation occurs.
 */
import { createRequire } from 'node:module';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeSource } from './smart.js';
import { analyzeStructured, supportsStructure } from './structural.js';
import type { BoundImport, BoundExport } from './symbols.js';
const localRequire=createRequire(import.meta.url);
const ts:any=localRequire(join(dirname(fileURLToPath(import.meta.url)),'..','vendor','typescript.cjs'));

export type Link={specifier:string;symbols:string[];kind:'import'|'module';certainty:'ast'|'heuristic'};
export type LanguageAnalysis={language:string;parser:'typescript-ast'|'static-scan'|'plain';links:Link[];symbols:string[];namespace?:string;bindings?:BoundImport[];exports?:BoundExport[]};
export type LanguageAdapter={id:string;extensions:readonly string[];analyze:(path:string,text:string)=>LanguageAnalysis};
const unique=(items:string[])=>[...new Set(items.filter(Boolean))].sort();
const link=(specifier:string,symbols:string[]=[],kind:Link['kind']='import',certainty:Link['certainty']='heuristic'):Link=>({specifier,symbols:unique(symbols),kind,certainty});
const extract=(text:string,re:RegExp,group=1)=>[...text.matchAll(re)].map(m=>m[group]).filter((x):x is string=>!!x);
const unquote=(s:string)=>s.replace(/^["'`]|["'`]$/g,'');

function javascript(path:string,text:string):LanguageAnalysis{
 const ast=analyzeSource(path,text);const symbols=[...ast.exports];const links:Link[]=[],bindings:BoundImport[]=[],exports:BoundExport[]=[];
 const source=ts.createSourceFile(path,text,ts.ScriptTarget.Latest,true,/\.tsx$/i.test(path)?ts.ScriptKind.TSX:/\.jsx$/i.test(path)?ts.ScriptKind.JSX:/\.jsx?$/i.test(path)?ts.ScriptKind.JS:ts.ScriptKind.TS);
 const push=(name:string,local:string)=>exports.push({name,local,certainty:'ast'});
 for(const n of source.statements){
   if(ts.isImportDeclaration(n) && typeof n.moduleSpecifier?.text==='string'){
     const spec=n.moduleSpecifier.text,names:string[]=[];
     const b=n.importClause?.namedBindings;
     if(b && ts.isNamedImports(b))for(const item of b.elements){const imported=item.propertyName?.text||item.name.text;names.push(imported);bindings.push({specifier:spec,local:item.name.text,imported,kind:'named',certainty:'ast'});}
     if(b && ts.isNamespaceImport(b))bindings.push({specifier:spec,local:b.name.text,imported:'*',kind:'namespace',certainty:'ast'});
     if(n.importClause?.name){names.push('default');bindings.push({specifier:spec,local:n.importClause.name.text,imported:'default',kind:'default',certainty:'ast'});}
     links.push(link(spec,names,'import','ast'));
   } else if(ts.isExportDeclaration(n)){
     const spec=typeof n.moduleSpecifier?.text==='string'?n.moduleSpecifier.text:undefined;
     const names:string[]=[];
     if(n.exportClause && ts.isNamedExports(n.exportClause))for(const item of n.exportClause.elements){
       const imported=item.propertyName?.text||item.name.text;
       names.push(imported);
       exports.push({name:item.name.text,...(spec?{from:spec,imported}:{local:imported}),certainty:'ast'});
     } else if(n.exportClause && ts.isNamespaceExport(n.exportClause)){
       exports.push({name:n.exportClause.name.text,from:spec,imported:'*',certainty:'ast'});
     } else if(spec){exports.push({name:'*',star:true,from:spec,certainty:'ast'});}
     if(spec)links.push(link(spec,names,'import','ast'));
   } else if(ts.isExportAssignment(n)){
     if(ts.isIdentifier(n.expression))push('default',n.expression.text);
   } else {
     const mods=n.modifiers||[];
     const hasExport=mods.some((m:any)=>m.kind===ts.SyntaxKind.ExportKeyword);
     if(!hasExport)continue;
     const isDefault=mods.some((m:any)=>m.kind===ts.SyntaxKind.DefaultKeyword);
     if(ts.isVariableStatement(n)){for(const declaration of n.declarationList.declarations){if(ts.isIdentifier(declaration.name))push(declaration.name.text,declaration.name.text);}}
     else if(n.name && ts.isIdentifier(n.name)){push(n.name.text,n.name.text);if(isDefault)push('default',n.name.text);}
   }
 }
 for(const spec of extract(text,/\brequire\s*\(\s*['"]([^'"\n]+)['"]\s*\)/g))links.push(link(spec));
 for(const spec of extract(text,/\bimport\s*\(\s*['"]([^'"\n]+)['"]\s*\)/g))links.push(link(spec));
 return {language:/\.tsx?$|\.mts$|\.cts$/.test(path)?'TypeScript':'JavaScript',parser:'typescript-ast',links:dedupe(links),symbols:unique([...symbols,...exports.filter(e=>!e.star).map(e=>e.name)]),bindings,exports};
}
function dedupe(links:Link[]):Link[]{const result=new Map<string,Link>();for(const l of links){const k=l.kind+'|'+l.specifier;const prev=result.get(k);if(!prev)result.set(k,l);else result.set(k,{...prev,symbols:unique([...prev.symbols,...l.symbols]),certainty:prev.certainty==='ast'?'ast':l.certainty});}return [...result.values()];}
function python(_path:string,text:string):LanguageAnalysis{
 const links:Link[]=[];
 for(const row of text.split(/\r?\n/)){
   const from=row.match(/^\s*from\s+([.\w]+)\s+import\s+([^#\n]+)/);
   if(from)links.push(link(from[1],from[2].replace(/[()]/g,'').split(',').map(x=>x.trim().split(/\s+as\s+/)[0]).filter(x=>x!=='*')));
   else {const imp=row.match(/^\s*import\s+([^#\n]+)/);if(imp)for(const mod of imp[1].split(','))links.push(link(mod.trim().split(/\s+as\s+/)[0]));}
 }
 const symbols=unique(extract(text,/^(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(/gm).concat(extract(text,/^class\s+([A-Za-z_]\w*)\b/gm)));
 const bindings:BoundImport[]=[];
 for(const row of text.split(/\r?\n/)){
  const m=row.match(/^\s*from\s+([.\w]+)\s+import\s+([^#\n]+)/);
  if(m)for(const entry of m[2].replace(/[()]/g,'').split(',')){
   const match=entry.trim().match(/^([A-Za-z_]\w*)(?:\s+as\s+([A-Za-z_]\w*))?$/);
   if(match)bindings.push({specifier:m[1],imported:match[1],local:match[2]||match[1],kind:'named',certainty:'heuristic'});
  }
  else {
   const imp=row.match(/^\s*import\s+([^#\n]+)/);
   if(imp)for(const item of imp[1].split(',')){
    const mm=item.trim().match(/^([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)(?:\s+as\s+([A-Za-z_]\w*))?$/);
    if(mm)bindings.push({specifier:mm[1],imported:'*',local:mm[2]||mm[1].split('.')[0],kind:'namespace',certainty:'heuristic'});
   }
  }
 }
 return {language:'Python',parser:'static-scan',links:dedupe(links),symbols,bindings,exports:symbols.filter(x=>!x.startsWith('_')).map(x=>({name:x,local:x,certainty:'heuristic'}))};
}
function go(_path:string,text:string):LanguageAnalysis{
 const links:Link[]=[];
 for(const s of extract(text,/^\s*import\s+(?:[A-Za-z_.]+\s+)?"([^"\n]+)"/gm))links.push(link(s));
 const blocks=extract(text,/\bimport\s*\(([^)]+)\)/g);
 for(const block of blocks)for(const s of extract(block,/"([^"\n]+)"/g))links.push(link(s));
 return {language:'Go',parser:'static-scan',links:dedupe(links),symbols:unique(extract(text,/^func\s+(?:\([^\n]*?\)\s*)?([A-Za-z_]\w*)\s*\(/gm).concat(extract(text,/^type\s+([A-Za-z_]\w*)\b/gm)))};
}
function java(_path:string,text:string):LanguageAnalysis{
 const ns=text.match(/^\s*package\s+([\w.]+)\s*;/m)?.[1];
 const links=extract(text,/^\s*import\s+(?:static\s+)?([\w.*]+)\s*;/gm).map(s=>link(s));
 return {language:'Java',parser:'static-scan',links:dedupe(links),symbols:unique(extract(text,/\b(?:class|interface|enum|record)\s+([A-Za-z_]\w*)/g)),namespace:ns};
}
function csharp(_path:string,text:string):LanguageAnalysis{
 const ns=text.match(/\bnamespace\s+([\w.]+)/)?.[1];
 const links=extract(text,/^\s*(?:global\s+)?using\s+(?:static\s+)?([\w.]+)\s*;/gm).map(s=>link(s));
 return {language:'C#',parser:'static-scan',links:dedupe(links),symbols:unique(extract(text,/\b(?:class|interface|struct|record|enum)\s+([A-Za-z_]\w*)/g)),namespace:ns};
}
function rust(_path:string,text:string):LanguageAnalysis{
 const links=extract(text,/\buse\s+([\w:]+)(?:\s*;|\s*::\s*\{)/g).map(s=>link(s));
 for(const s of extract(text,/\bmod\s+([A-Za-z_]\w*)\s*;/g))links.push(link(s,[],'module'));
 return {language:'Rust',parser:'static-scan',links:dedupe(links),symbols:unique(extract(text,/\b(?:fn|struct|enum|trait)\s+([A-Za-z_]\w*)/g))};
}
function ruby(_path:string,text:string):LanguageAnalysis{
 return {language:'Ruby',parser:'static-scan',links:extract(text,/\brequire_relative\s*\(?\s*['"]([^'"\n]+)['"]/g).map(s=>link('./'+s)),symbols:unique(extract(text,/^\s*(?:def|class|module)\s+([A-Za-z_]\w*)/gm))};
}
function php(_path:string,text:string):LanguageAnalysis{
 const links=extract(text,/\b(?:include|require)(?:_once)?\s*\(?\s*['"]([^'"\n]+)['"]/g).map(s=>link('./'+s));
 return {language:'PHP',parser:'static-scan',links,symbols:unique(extract(text,/\b(?:function|class|trait|interface)\s+([A-Za-z_]\w*)/g))};
}
function cpp(_path:string,text:string):LanguageAnalysis{
 return {language:/\.(?:c|h)$/i.test(_path)?'C':'C++',parser:'static-scan',links:extract(text,/^\s*#\s*include\s*"([^"\n]+)"/gm).map(s=>link('./'+s)),symbols:[]};
}
function kotlin(_path:string,text:string):LanguageAnalysis{return {language:'Kotlin',parser:'static-scan',links:extract(text,/^\s*import\s+([\w.*]+)/gm).map(s=>link(s)),symbols:unique(extract(text,/\b(?:class|interface|object|fun)\s+([A-Za-z_]\w*)/g)),namespace:text.match(/^\s*package\s+([\w.]+)/m)?.[1]};}
function dart(_path:string,text:string):LanguageAnalysis{return {language:'Dart',parser:'static-scan',links:extract(text,/\b(?:import|export|part)\s+['"]([^'"\n]+)['"]/g).map(s=>link(s)),symbols:unique(extract(text,/\bclass\s+([A-Za-z_]\w*)/g))};}
export const adapters:readonly LanguageAdapter[]=[
 {id:'javascript-typescript',extensions:['.js','.cjs','.mjs','.jsx','.ts','.cts','.mts','.tsx'],analyze:javascript},
 {id:'python',extensions:['.py','.pyi'],analyze:python},
 {id:'go',extensions:['.go'],analyze:go},
 {id:'java',extensions:['.java'],analyze:java},
 {id:'csharp',extensions:['.cs'],analyze:csharp},
 {id:'rust',extensions:['.rs'],analyze:rust},
 {id:'ruby',extensions:['.rb'],analyze:ruby},
 {id:'php',extensions:['.php'],analyze:php},
 {id:'cpp',extensions:['.c','.cc','.cpp','.cxx','.h','.hpp','.hxx'],analyze:cpp},
 {id:'kotlin',extensions:['.kt','.kts'],analyze:kotlin},
 {id:'dart',extensions:['.dart'],analyze:dart}
];
const lookup=new Map(adapters.flatMap(a=>a.extensions.map(ext=>[ext,a] as const)));
export function adapterFor(path:string):LanguageAdapter|undefined{return lookup.get(extname(path).toLowerCase());}
export function analyzeLanguage(path:string,text:string):LanguageAnalysis{
 const adapter=adapterFor(path);if(!adapter)return {language:'Other',parser:'plain',links:[],symbols:[]};
 const base=adapter.analyze(path,text);
 if(!supportsStructure(path))return base;
 const structured=analyzeStructured(path,text);
 return structured.diagnostics===0?{...base,symbols:unique([...base.symbols,...structured.segments.map(s=>s.name)])}:base;
}
