/**
 * Conservative project-local DI mapping. Registration expressions are masked
 * for comments/strings before interpretation; only uniquely registered types
 * with a uniquely identified local implementation yield graph edges.
 * This is a syntactic binding proof, NOT container/runtime execution.
 */
import {maskSource} from './structural.js';
import type {GraphNode,GraphEdge} from './graph.js';

export type DIRegistration={framework:'aspnet-core'|'spring-mvc';interface:string;implementation:string;registrationPath:string;implementationPath:string;kind:'explicit-service-registration'|'service-annotation';};
export type DIBinding={controllerPath:string;implementationPath:string;interface:string;implementation:string;field:string;method:string;registrationPath:string;kind:DIRegistration['kind']};
export type DIReport={registrations:DIRegistration[];bindings:DIBinding[];ambiguous:Array<{interface:string;reason:string}>;edges:GraphEdge[]};
const esc=(s:string)=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const id=(s:string)=>/^[A-Za-z_]\w*$/.test(s);
function masked(text:string,path:string):string|null{
 const result=maskSource(text,path);return result.diagnostics?null:result.masked;
}
/** A class must explicitly implement the interface, not merely share a method name. */
function implementsType(code:string,path:string,impl:string,iface:string):boolean{
 if(!id(impl)||!id(iface))return false;
 if(path.endsWith('.cs'))return new RegExp(`\\bclass\\s+${esc(impl)}\\s*:\\s*[^\\{;\\n]{0,250}\\b${esc(iface)}\\b`).test(code);
 if(path.endsWith('.java'))return new RegExp(`\\bclass\\s+${esc(impl)}\\b[^\\{;]{0,250}\\bimplements\\s+[^\\{;]{0,200}\\b${esc(iface)}\\b`).test(code);
 return false;
}
/** Matches constructor field assignment with stable receiver, independent of DI implementation. */
export function injectedInterface(codeSource:string,path:string,field:string,iface:string,method:string):boolean{
 if(!id(field)||!id(iface)||!id(method))return false;
 const code=masked(codeSource,path);if(!code)return false;
 const className=code.match(/\bclass\s+([A-Za-z_]\w*)/)?.[1];if(!className)return false;
 if(!new RegExp(`\\b(?:readonly\\s+|final\\s+|private\\s+|protected\\s+|public\\s+)*${esc(iface)}\\s+${esc(field)}\\s*;`).test(code))return false;
 const ctor=new RegExp(`\\b${esc(className)}\\s*\\(([^)]{0,1200})\\)\\s*(?::[^\\{]{0,300})?\\{`,'g');
 const matches=[...code.matchAll(ctor)];if(matches.length!==1)return false;
 const params=matches[0]![1]!.split(',').map(x=>x.trim());
 const matching=params.map(x=>x.match(new RegExp(`\\b${esc(iface)}\\s+([A-Za-z_]\\w*)\\s*$`))).filter(Boolean);
 if(matching.length!==1)return false;
 const parameter=matching[0]![1]!;
 const opening=matches[0]!.index!+matches[0]![0].length-1;let depth=0,end=-1;
 for(let i=opening;i<code.length&&i<opening+12000;i++){
  if(code[i]==='{')depth++;else if(code[i]==='}'&&--depth===0){end=i;break;}
 }
 if(end<0)return false;
 const assignments=[...code.slice(opening,end+1).matchAll(new RegExp(`\\b(?:this\\s*\\.\\s*)?${esc(field)}\\s*=\\s*${esc(parameter)}\\s*;`,'g'))];
 if(assignments.length!==1)return false;
 const writes=[...code.matchAll(new RegExp(`\\b(?:this\\s*\\.\\s*)?${esc(field)}\\s*=(?!=)`,'g'))];
 if(writes.length!==1)return false;
 return new RegExp(`\\b(?:this\\s*\\.\\s*)?${esc(field)}\\s*\\.\\s*${esc(method)}\\s*\\(`).test(code);
}
export function scanDI(nodes:GraphNode[],load:(path:string)=>string|null):DIReport{
 const files=nodes.filter(n=>/\.(?:cs|java)$/.test(n.path)).slice(0,3000);
 const sources=new Map<string,string>();
 for(const n of files){const raw=load(n.path);if(raw!==null&&raw.length<262144){const code=masked(raw,n.path);if(code!==null)sources.set(n.path,code);}}
 const candidateRegs:Array<{framework:DIRegistration['framework'];interface:string;implementation:string;registrationPath:string;kind:DIRegistration['kind']}>=[];
 for(const [path,code] of sources){
  if(path.endsWith('.cs')){
   // Require an actual DI collection receiver, not any unrelated method
   // that happens to be named AddScoped<>.
   for(const m of code.matchAll(/\b(?:services|Services)\s*\.\s*Add(?:Scoped|Transient|Singleton)\s*<\s*([A-Za-z_]\w*)\s*,\s*([A-Za-z_]\w*)\s*>\s*\(/g)){
    candidateRegs.push({framework:'aspnet-core',interface:m[1]!,implementation:m[2]!,registrationPath:path,kind:'explicit-service-registration'});
   }
   for(const m of code.matchAll(/\b(?:services|Services)\s*\.\s*Add(?:Scoped|Transient|Singleton)\s*\(\s*typeof\s*\(\s*([A-Za-z_]\w*)\s*\)\s*,\s*typeof\s*\(\s*([A-Za-z_]\w*)\s*\)\s*\)/g)){
    candidateRegs.push({framework:'aspnet-core',interface:m[1]!,implementation:m[2]!,registrationPath:path,kind:'explicit-service-registration'});
   }
   for(const m of code.matchAll(/\b(?:services|Services)\s*\.\s*AddSingleton\s*<\s*([A-Za-z_]\w*)\s*>\s*\(\s*new\s+([A-Za-z_]\w*)\s*\(/g)){
    candidateRegs.push({framework:'aspnet-core',interface:m[1]!,implementation:m[2]!,registrationPath:path,kind:'explicit-service-registration'});
   }
  }else if(path.endsWith('.java')){
   // Require a real Spring-managed class declaration with an explicit interface.
   for(const m of code.matchAll(/@(?:Service|Component|Repository)\b(?:\s*\([^)]*\))?\s*(?:(?:public|final)\s+)*class\s+([A-Za-z_]\w*)\b[^\{;]{0,250}\bimplements\s+([^\{;]{1,200})/g)){
    for(const iface of m[2]!.split(',').map(x=>x.trim()).filter(x=>id(x))){
     candidateRegs.push({framework:'spring-mvc',interface:iface,implementation:m[1]!,registrationPath:path,kind:'service-annotation'});
    }
   }
   // Explicit @Configuration @Bean method: a unique typed return is stronger
   // than a guessed component scan. Do not follow factories or expressions.
   if(/@Configuration\b/.test(code))for(const m of code.matchAll(/@Bean\b(?:\s*\([^)]*\))?\s*(?:(?:public|protected)\s+)?([A-Za-z_]\w*)\s+[A-Za-z_]\w*\s*\(\s*\)\s*\{\s*return\s+new\s+([A-Za-z_]\w*)\s*\(/g)){
    candidateRegs.push({framework:'spring-mvc',interface:m[1]!,implementation:m[2]!,registrationPath:path,kind:'service-annotation'});
   }
  }
 }
 const registries=new Map<string,DIRegistration[]>();const ambiguous:DIReport['ambiguous']=[];
 for(const item of candidateRegs){
  if(!id(item.interface)||!id(item.implementation))continue;
  const matching=[...sources].filter(([p,code])=>p.endsWith(item.framework==='aspnet-core'?'.cs':'.java')&&implementsType(code,p,item.implementation,item.interface));
  if(matching.length!==1){ambiguous.push({interface:item.interface,reason:'implementation-type-not-unique-or-not-declared'});continue;}
  const entry:DIRegistration={...item,implementationPath:matching[0]![0]};
  const registryKey=item.framework+':'+item.interface;
  const registrations=registries.get(registryKey)||[];registrations.push(entry);registries.set(registryKey,registrations);
 }
 const registrations=[...registries.values()].filter(v=>v.length===1).flat();
 for(const [key,values] of registries)if(values.length!==1)ambiguous.push({interface:key,reason:'multiple-registrations'});
 const bindings:DIBinding[]=[],edges:GraphEdge[]=[];
 for(const [path,code] of sources){
  if(!/\bclass\s+\w+/.test(code))continue;
  const framework=path.endsWith('.cs')?'aspnet-core':'spring-mvc';
  const injected=[...code.matchAll(/\b(?:private\s+|public\s+|protected\s+|readonly\s+|final\s+)*\b(I[A-Z][A-Za-z0-9_]*)\s+([A-Za-z_]\w*)\s*;/g)];
  for(const reg of registrations.filter(x=>x.framework===framework))for(const field of injected.filter(m=>m[1]===reg.interface)){
   const called=[...new Set([...code.matchAll(new RegExp(`\\b(?:this\\s*\\.\\s*)?${esc(field[2]!)}\\s*\\.\\s*([A-Za-z_]\\w*)\\s*\\(`,'g'))].map(m=>m[1]!))];
   for(const method of called){
    const original=load(path);if(original===null||!injectedInterface(original,path,field[2]!,reg.interface,method))continue;
    // No runtime dispatch claims: exact concrete implementation and method
    // membership are rechecked by the packer's AST declaration resolver.
    bindings.push({controllerPath:path,implementationPath:reg.implementationPath,interface:reg.interface,implementation:reg.implementation,field:field[2]!,method,registrationPath:reg.registrationPath,kind:reg.kind});
    if(!edges.some(e=>e.from===path&&e.to===reg.implementationPath))edges.push({from:path,to:reg.implementationPath,specifier:`di:${reg.interface}:${reg.implementation}`,symbols:[method],certainty:'heuristic'});
   }
  }
 }
 return {registrations:registrations.sort((a,b)=>a.interface.localeCompare(b.interface)||a.implementationPath.localeCompare(b.implementationPath)),bindings:bindings.sort((a,b)=>a.controllerPath.localeCompare(b.controllerPath)||a.method.localeCompare(b.method)),ambiguous,edges};
}
