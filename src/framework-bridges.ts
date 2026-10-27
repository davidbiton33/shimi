/**
 * Offline, bounded framework dispatch bridges discovered from *actual source*
 * across local Git project files. They are syntax evidence, never a typechecker
 * or a claim that runtime DI picked the same implementation.
 */
import {maskSource} from './structural.js';
import type {GraphNode,GraphEdge} from './graph.js';
export type BridgeKind='flutter-command-dispatch'|'compose-viewmodel-reference'|'compose-callback-forwarding'|'compose-forwarded-widget'|'hilt-binds-repository'|'mediator-request-handler'|'spring-data-boundary';
export type FrameworkBridge={kind:BridgeKind;from:string;to:string;caller:string;target:string;evidence:string;certainty:'syntax-grounded'|'framework-boundary';};
export type BridgeReport={bridges:FrameworkBridge[];edges:GraphEdge[];limitations:string};
const esc=(s:string)=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
export function scanFrameworkBridges(nodes:GraphNode[],load:(p:string)=>string|null):BridgeReport{
 const files=nodes.filter(n=>/\.(?:dart|kt|java|cs)$/.test(n.path)).slice(0,3000);
 const source=new Map<string,string>();const code=new Map<string,string>();
 for(const file of files){const raw=load(file.path);if(raw===null||raw.length>262144)continue;
  const masked=maskSource(raw,file.path);if(masked.diagnostics)continue;
  source.set(file.path,raw);code.set(file.path,masked.masked);
 }
 const bridges:FrameworkBridge[]=[],edges:GraphEdge[]=[];
 const add=(bridge:FrameworkBridge)=>{
  if(bridges.length>=200||bridges.some(x=>x.kind===bridge.kind&&x.from===bridge.from&&x.to===bridge.to&&x.caller===bridge.caller&&x.target===bridge.target))return;
  bridges.push(bridge);if(!edges.some(e=>e.from===bridge.from&&e.to===bridge.to))edges.push({from:bridge.from,to:bridge.to,specifier:'framework:'+bridge.kind,symbols:[bridge.target],certainty:'heuristic'});
 };
 const locations=(ext:string,pattern:RegExp)=>[...code].filter(([p,s])=>p.endsWith(ext)&&pattern.test(s)).map(([p])=>p);
 // Flutter: direct command tear-off -> unique declared, initialized Command0/1 -> named callback body.
 for(const [from,c] of code){if(!from.endsWith('.dart')||!/\bonPressed\s*:/.test(c))continue;
  const viewType=[...c.matchAll(/\bfinal\s+([A-Za-z_]\w*)\s+viewModel\s*;/g)].map(x=>x[1]!);
  if(viewType.length!==1)continue;
  const type=viewType[0]!;const dests=locations('.dart',new RegExp(`\\bclass\\s+${esc(type)}\\b`));if(dests.length!==1)continue;
  const to=dests[0]!,v=code.get(to)!;
  const commands=[...c.matchAll(/\bonPressed\s*:\s*(?:[\s\w.!=?:]+?\?\s*)?widget\s*\.\s*viewModel\s*\.\s*([A-Za-z_]\w*)\s*\.\s*execute\b/g)].map(x=>x[1]!);
  for(const command of [...new Set(commands)]){
   const ctor=[...v.matchAll(new RegExp(`\\b${esc(command)}\\s*=\\s*Command[01]\\s*\\(\\s*([A-Za-z_]\\w*)\\s*\\)`,'g'))];
   if(ctor.length!==1||!new RegExp(`\\blate\\s+final\\s+Command[01](?:<[^>]+>)?\\s+${esc(command)}\\b`).test(v))continue;
   const method=ctor[0]![1]!;
   if(!new RegExp(`\\b${esc(method)}\\s*\\([^)]*\\)\\s*(?:async\\s*)?\\{`).test(v))continue;
   add({kind:'flutter-command-dispatch',from,to,caller:'onPressed:'+command+'.execute',target:type+'.'+method,evidence:'typed-widget-field+Command-constructor+named-method-body',certainty:'syntax-grounded'});
  }
 }
 // Jetpack Compose: a typed hiltViewModel() default parameter with direct method-reference
 // is different from arbitrary same-named methods elsewhere in the project.
 for(const [from,c] of code){if(!from.endsWith('.kt')||!/@Composable\b/.test(c))continue;
  for(const m of c.matchAll(/\bviewModel\s*:\s*([A-Za-z_]\w*)\s*=\s*(?:hiltViewModel|viewModel)\s*\(\s*\)/g)){
   const type=m[1]!,dests=locations('.kt',new RegExp(`\\bclass\\s+${esc(type)}\\b`));if(dests.length!==1)continue;
   for(const methodMatch of c.matchAll(/\bviewModel\s*::\s*([A-Za-z_]\w*)\b/g)){
    const method=methodMatch[1]!,to=dests[0]!,dest=code.get(to)!;
    if(!new RegExp(`\\bfun\\s+${esc(method)}\\s*\\(`).test(dest))continue;
    add({kind:'compose-viewmodel-reference',from,to,caller:'viewModel::'+method,target:type+'.'+method,evidence:'typed-hilt-viewmodel-parameter+method-reference+implementation',certainty:'syntax-grounded'});
   }
  }
 }
 // Compose can relay a ViewModel method reference through intermediate
 // @Composable callback parameters. Preserve the forwarding function so that
 // the complete UI path is visible, rather than an unrelated nearby callback.
 for(const [from,c] of code){if(!from.endsWith('.kt')||!/@Composable\b/.test(c))continue;
  const bound=[...c.matchAll(/\b(on[A-Za-z_]\w*)\s*=\s*viewModel\s*::\s*([A-Za-z_]\w*)/g)];
  for(const binding of bound){
   const callback=binding[1]!,method=binding[2]!;
   const re=new RegExp('\\bon[A-Za-z_]\\w*\\s*=\\s*\\{\\s*'+esc(callback)+'\\s*\\(','g');
   const forwarded=[...c.matchAll(re)];if(forwarded.length!==1)continue;
   const prefix=c.slice(0,forwarded[0]!.index!);
   const funcs=[...prefix.matchAll(/\bfun\s+([A-Za-z_]\w*)\s*\(/g)];
   const owner=funcs.at(-1)?.[1];if(!owner)continue;
   const open=prefix.lastIndexOf('{');if(open<0)continue;
   // The callback parameter must be declared on this function, not on a sibling.
   const definitionStart=funcs.at(-1)!.index!;
   const declaration=c.slice(definitionStart,open);
   if(!new RegExp('\\b'+esc(callback)+'\\s*:').test(declaration))continue;
   add({kind:'compose-callback-forwarding',from,to:from,caller:callback+'=viewModel::'+method,target:owner,evidence:'typed-callback-parameter+forwarded-closure+viewmodel-method-reference',certainty:'syntax-grounded'});
   const uses=[...prefix.matchAll(/\b([A-Za-z_]\w*)\s*\(/g)];
   const child=uses.at(-1)?.[1];
   if(child&&child!==owner&&new RegExp('\\bfun\\s+'+esc(child)+'\\s*\\(').test(c)){
    // The task callback is forwarded into an actual local Composable node.
    add({kind:'compose-forwarded-widget',from,to:from,caller:callback+'→'+child,target:child,evidence:'forwarded-callback+local-widget-call+widget-declaration',certainty:'syntax-grounded'});
   }

  }
 }
 // Kotlin Hilt: require a unique @Binds Interface <- Concrete declaration,
 // a local concrete class explicitly implementing Interface, and a VM field
 // of that interface which invokes the exact method.
 const regs:Array<{iface:string;impl:string;path:string}>=[];
 for(const [p,c] of code){if(!p.endsWith('.kt'))continue;
  for(const m of c.matchAll(/@Binds\s*(?:(?:@[A-Za-z_]\w*(?:\([^)]*\))?\s*)*)\s*abstract\s+fun\s+[A-Za-z_]\w*\s*\(\s*[A-Za-z_]\w*\s*:\s*([A-Za-z_]\w*)\s*\)\s*:\s*([A-Za-z_]\w*)/g))regs.push({iface:m[2]!,impl:m[1]!,path:p});
 }
 for(const reg of regs){if(regs.filter(x=>x.iface===reg.iface).length!==1)continue;
  const dests=locations('.kt',new RegExp(`\\bclass\\s+${esc(reg.impl)}\\b[\\s\\S]{0,550}?\\)\\s*:\\s*${esc(reg.iface)}\\b`));
  if(dests.length!==1)continue;
  for(const [from,c] of code){if(!from.endsWith('.kt')||from===dests[0])continue;
   const field=[...c.matchAll(new RegExp(`\\b(?:private\\s+)?val\\s+([A-Za-z_]\\w*)\\s*:\\s*${esc(reg.iface)}\\b`,'g'))];
   if(field.length!==1)continue;
   for(const invocation of c.matchAll(new RegExp(`\\b${esc(field[0]![1]!)}\\s*\\.\\s*([A-Za-z_]\\w*)\\s*\\(`,'g'))){
    const method=invocation[1]!,to=dests[0]!;
    if(!new RegExp(`\\boverride\\s+(?:suspend\\s+)?fun\\s+${esc(method)}\\s*\\(`).test(code.get(to)!))continue;
    add({kind:'hilt-binds-repository',from,to,caller:field[0]![1]!+'.'+method,target:reg.impl+'.'+method,evidence:'unique-Binds-registration+implements-interface+injected-receiver+method-implementation',certainty:'syntax-grounded'});
   }
  }
 }
 // MediatR/Mediator: typed command parameter + mediator.Send(param) in an
 // actual HTTP action, tied to uniquely declared Handler : IRequestHandler<Command,T>
 // in the SAME feature directory. Never infer across unrelated Create.cs files.
 for(const [from,c] of code){if(!from.endsWith('.cs')||!/\[Http(?:Post|Put|Delete|Get|Patch)\b/.test(c)||!/\bmediator\s*\.\s*Send\s*\(/.test(c))continue;
  const namespace=source.get(from)!.match(/\bnamespace\s+([A-Za-z_.]+)\s*;/)?.[1];if(!namespace)continue;
  const methodRe=/\[Http(?:Post|Put|Delete|Get|Patch)\b[^\]]*\](?:\s*\[[^\]]*\])*\s*(?:public|internal)\s+(?:(?:async|override|virtual)\s+)*[\w<>?,\[\]\s]+?\b([A-Za-z_]\w*)\s*\(([^)]{0,1000})\)\s*(?:=>|\{)/g;
  for(const m of c.matchAll(methodRe)){
   const action=m[1]!,params=m[2]!;
   const p=[...params.matchAll(/\b([A-Za-z_]\w*)\s*\.\s*Command\s+([A-Za-z_]\w*)\b/g)];if(p.length!==1)continue;
   const handlerOwner=p[0]![1]!,param=p[0]![2]!;
   // Must occur within the action's signature and near its actual body, not a sibling.
   const after=c.slice(m.index!+m[0].length,m.index!+m[0].length+5000);
   // Do not use a Send call from the following unrelated controller action.
   let actionBody='';
   if(m[0].trimEnd().endsWith('=>')){
    const semi=after.indexOf(';');if(semi<0)continue;actionBody=after.slice(0,semi+1);
   }else{
    let depth=1,end=-1;for(let i=0;i<after.length;i++){
     if(after[i]==='{')depth++;else if(after[i]==='}'&&--depth===0){end=i;break;}
    }
    if(end<0)continue;actionBody=after.slice(0,end);
   }
   if(!new RegExp(`\\bmediator\\s*\\.\\s*Send\\s*\\(\\s*${esc(param)}\\s*[,)]`).test(actionBody))continue;
   const sameDir=from.slice(0,from.lastIndexOf('/')+1);
   const dests=[...code].filter(([p,s])=>p.endsWith('.cs')&&p.startsWith(sameDir)&&
     source.get(p)?.match(/\bnamespace\s+([A-Za-z_.]+)\s*;/)?.[1]===namespace&&
     new RegExp(`\\bclass\\s+${esc(handlerOwner)}\\b`).test(s)&&
     /\bIRequestHandler\s*<\s*Command\s*,/.test(s)&&
     /\bclass\s+Handler\b/.test(s)&&/\bHandle\s*\(/.test(s)).map(([p])=>p);
   if(dests.length!==1)continue;
   add({kind:'mediator-request-handler',from,to:dests[0]!,caller:action+':mediator.Send('+param+')',target:handlerOwner+'.Handler.Handle',evidence:'http-action+typed-Command-parameter+mediator-Send+unique-IRequestHandler',certainty:'syntax-grounded'});
  }
 }
 // Spring Data repository boundaries are intentionally marked as EXTERNAL:
 // an interface extending Repository/JpaRepository has no method body in git.
 for(const [from,c] of code){if(!from.endsWith('.java')||!/@(?:Post|Get|Put|Delete|Patch|Request)Mapping\b/.test(c))continue;
  const fields=[...c.matchAll(/\b(?:private\s+)?(?:final\s+)?([A-Za-z_]\w*Repository)\s+([A-Za-z_]\w*)\s*;/g)];
  for(const f of fields){const iface=f[1]!,field=f[2]!;
   const dests=locations('.java',new RegExp(`\\binterface\\s+${esc(iface)}\\b[^\\{;]{0,400}\\bextends\\b`));if(dests.length!==1)continue;
   if(!new RegExp(`\\b(?:this\\s*\\.\\s*)?${esc(field)}\\s*\\.\\s*save\\s*\\(`).test(c))continue;
   add({kind:'spring-data-boundary',from,to:dests[0]!,caller:field+'.save',target:iface+'.save (inherited, external)',evidence:'typed-repository-field+save-call+repository-interface',certainty:'framework-boundary'});
  }
 }
 return{bridges:bridges.sort((a,b)=>a.kind.localeCompare(b.kind)||a.from.localeCompare(b.from)||a.target.localeCompare(b.target)),edges,
  limitations:'Conservative bounded static syntax; framework conventions are not runtime/compiled proof. Spring Data methods are external framework boundaries, not local implementations.'};
}
