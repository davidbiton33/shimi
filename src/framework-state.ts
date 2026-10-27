/** Offline syntactic framework-state relationships. No runtime or typechecker claims.
 * Only unique local AST-verifiable classes and provider registrations are
 * eligible; action linkage is gated by framework callbacks at packing time.
 */
import type {GraphNode,GraphEdge} from './graph.js';
import {maskSource} from './structural.js';
export type StateBinding={from:string;to:string;kind:'compose-viewmodel'|'riverpod-provider'|'flutter-bloc'|'flutter-cubit';
 receiver?:string;provider?:string;event?:string;method:string;owner:string;evidence:string};
export type StateScan={bindings:StateBinding[];edges:GraphEdge[];unresolved:Array<{path:string;reason:string}>};
const esc=(s:string)=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
export function scanFrameworkState(nodes:GraphNode[],load:(path:string)=>string|null):StateScan{
 const files=nodes.filter(n=>/\.(?:dart|kt)$/.test(n.path));const clean=new Map<string,string>();
 for(const file of files){const raw=load(file.path);if(raw===null||raw.length>262144)continue;const masked=maskSource(raw,file.path);if(!masked.diagnostics)clean.set(file.path,masked.masked);}
 const classLocations=new Map<string,string[]>();
 for(const [p,code] of clean)for(const m of code.matchAll(/\bclass\s+([A-Za-z_]\w*)\b/g)){
  const arr=classLocations.get(m[1]!)||[];arr.push(p);classLocations.set(m[1]!,arr);
 }
 const uniqueClass=(name:string):string|undefined=>{const arr=classLocations.get(name)||[];return arr.length===1?arr[0]:undefined;};
 const providers=new Map<string,Array<{owner:string;path:string}>>();
 for(const [p,code] of clean){if(!p.endsWith('.dart'))continue;
  for(const m of code.matchAll(/\b(?:final|const)\s+([A-Za-z_]\w*)\s*=\s*(?:StateNotifierProvider|NotifierProvider|AsyncNotifierProvider|ChangeNotifierProvider)\s*<\s*([A-Za-z_]\w*)\b/g)){
   const arr=providers.get(m[1]!)||[];arr.push({owner:m[2]!,path:p});providers.set(m[1]!,arr);
  }
 }
 const bindings:StateBinding[]=[],unresolved:StateScan['unresolved']=[];
 const add=(x:StateBinding)=>{if(!bindings.some(b=>b.from===x.from&&b.to===x.to&&b.kind===x.kind&&b.method===x.method&&b.receiver===x.receiver))bindings.push(x);};
 for(const [from,code] of clean){
  if(from.endsWith('.kt')&&/@Composable\b/.test(code)&&/\bonClick\s*=/.test(code)){
   // Explicitly typed local viewModel()/hiltViewModel(), NOT arbitrary locals.
   for(const m of code.matchAll(/\bval\s+([A-Za-z_]\w*)\s*:\s*([A-Za-z_]\w*)\s*=\s*(?:hiltViewModel|viewModel)\s*\(\s*\)/g)){
    const receiver=m[1]!,owner=m[2]!,to=uniqueClass(owner);
    if(!to){unresolved.push({path:from,reason:'viewmodel-class-ambiguous:'+owner});continue;}
    for(const call of code.matchAll(new RegExp(`\\b${esc(receiver)}\\s*\\.\\s*([A-Za-z_]\\w*)\\s*\\(`,'g'))){
     add({from,to,kind:'compose-viewmodel',receiver,owner,method:call[1]!,evidence:'typed-local-viewmodel-factory'});
    }
   }
  }
  if(!from.endsWith('.dart')||!/(?:onPressed|onTap)\s*:/.test(code))continue;
  // Flutter Riverpod: ref.read(provider.notifier).method(...).
  for(const m of code.matchAll(/\bref\s*\.\s*read\s*\(\s*([A-Za-z_]\w*)\s*\.\s*notifier\s*\)\s*\.\s*([A-Za-z_]\w*)\s*\(/g)){
   const [provider,method]=[m[1]!,m[2]!];const regs=providers.get(provider)||[];
   if(regs.length!==1){unresolved.push({path:from,reason:'riverpod-provider-ambiguous:'+provider});continue;}
   const owner=regs[0]!.owner,to=uniqueClass(owner);
   if(!to){unresolved.push({path:from,reason:'riverpod-notifier-ambiguous:'+owner});continue;}
   add({from,to,kind:'riverpod-provider',provider,owner,method,evidence:'unique-provider-registration+notifier-read'});
  }
  // BLoC dispatch: context.read<CartBloc>().add(CartAdded(...)) -> on<CartAdded>(_onAdded).
  for(const m of code.matchAll(/\bcontext\s*\.\s*read\s*<\s*([A-Za-z_]\w*)\s*>\s*\(\s*\)\s*\.\s*add\s*\(\s*([A-Za-z_]\w*)\s*\(/g)){
   const owner=m[1]!,event=m[2]!,to=uniqueClass(owner);if(!to){unresolved.push({path:from,reason:'bloc-class-ambiguous:'+owner});continue;}
   const bloc=clean.get(to)||'';
   const handler=[...bloc.matchAll(new RegExp(`\\bon\\s*<\\s*${esc(event)}\\s*>\\s*\\(\\s*([A-Za-z_]\\w*)\\s*[,)]`,'g'))];
   if(handler.length!==1){unresolved.push({path:from,reason:'bloc-event-handler-not-unique:'+event});continue;}
   add({from,to,kind:'flutter-bloc',owner,event,method:handler[0]![1]!,evidence:'bloc-add-event+unique-registered-handler'});
  }
  // Cubit has method-based dispatch with a concrete explicitly named class.
  for(const m of code.matchAll(/\bcontext\s*\.\s*read\s*<\s*([A-Za-z_]\w*Cubit)\s*>\s*\(\s*\)\s*\.\s*([A-Za-z_]\w*)\s*\(/g)){
   const owner=m[1]!,method=m[2]!,to=uniqueClass(owner);
   if(!to){unresolved.push({path:from,reason:'cubit-class-ambiguous:'+owner});continue;}
   add({from,to,kind:'flutter-cubit',owner,method,evidence:'typed-bloc-provider-read'});
  }
 }
 const edges:GraphEdge[]=[];
 for(const x of bindings)if(!edges.some(e=>e.from===x.from&&e.to===x.to))edges.push({from:x.from,to:x.to,specifier:`state:${x.kind}:${x.owner}`,symbols:[x.method],certainty:'heuristic'});
 return {bindings:bindings.sort((a,b)=>a.from.localeCompare(b.from)||a.method.localeCompare(b.method)),edges,unresolved};
}
/** Returns a proof only for a known exact syntactic link. */
export function frameworkStateBindingForCall(bindings:StateBinding[],from:string,to:string,callerBody:string,method:string):StateBinding|undefined{
 const relevant=bindings.filter(b=>b.from===from&&b.to===to&&b.method===method);
 if(relevant.length!==1)return undefined;
 const binding=relevant[0]!;
 const source=maskSource(callerBody,from);if(source.diagnostics)return undefined;
 const code=source.masked;
 if(binding.kind==='compose-viewmodel')return new RegExp(`\\b${esc(binding.receiver!)}\\s*\\.\\s*${esc(method)}\\s*\\(`).test(code)?binding:undefined;
 if(binding.kind==='riverpod-provider')return new RegExp(`\\bref\\s*\\.\\s*read\\s*\\(\\s*${esc(binding.provider!)}\\s*\\.\\s*notifier\\s*\\)\\s*\\.\\s*${esc(method)}\\s*\\(`).test(code)?binding:undefined;
 if(binding.kind==='flutter-bloc')return new RegExp(`\\bcontext\\s*\\.\\s*read\\s*<\\s*${esc(binding.owner)}\\s*>\\s*\\(\\s*\\)\\s*\\.\\s*add\\s*\\(\\s*${esc(binding.event!)}\\s*\\(`).test(code)?binding:undefined;
 return new RegExp(`\\bcontext\\s*\\.\\s*read\\s*<\\s*${esc(binding.owner)}\\s*>\\s*\\(\\s*\\)\\s*\\.\\s*${esc(method)}\\s*\\(`).test(code)?binding:undefined;
}

/** Extract the exact braced callback of an inline event, preserving source
 * offsets and rejecting braces present only in comments/strings. */
export function inlineEventScope(source:string,offset:number):string|null{
 const parsed=maskSource(source,'inline.dart');if(parsed.diagnostics)return null;
 const code=parsed.masked;
 const attribute=code.slice(offset,offset+100).match(/^\b(?:onPressed|onTap|onClick|onChanged|onValueChange|onCheckedChange)\b\s*[:=]\s*/);
 if(!attribute)return null;
 const pos=offset+attribute[0].length;
 const tail=code.slice(pos,pos+32);
 const start=tail.match(/^\s*(?:\(\s*\)\s*(?:=>\s*)?)?\{/);
 if(!start)return null;
 const opening=pos+start[0].lastIndexOf('{');let depth=0;
 for(let i=opening;i<code.length&&i<opening+12000;i++){
   if(code[i]==='{')depth++;
   else if(code[i]==='}'&&--depth===0)return source.slice(opening,i+1);
 }
 return null;
}

export type StatePropagation={framework:StateBinding['kind'];read:string;write:string;channel:string;proof:'paired-state-syntax';};
/**
 * Static paired read/write channel evidence. A linked action and the consumer
 * use the same recognized state holder. This proves neither emitted values nor
 * subscriptions at runtime and is never presented as dynamic data flow.
 */
export function statePropagationEvidence(binding:StateBinding,consumerSource:string,producerSource:string,selectedMethodSource:string):StatePropagation|null{
 const consumer=maskSource(consumerSource,binding.from);
 const producer=maskSource(producerSource,binding.to);
 if(consumer.diagnostics||producer.diagnostics)return null;
 const selected=maskSource(selectedMethodSource,binding.to);if(selected.diagnostics)return null;
 const [read,write,handler]=[consumer.masked,producer.masked,selected.masked];
 if(binding.kind==='compose-viewmodel'){
  const receiver=esc(binding.receiver!);
  const observed=[...read.matchAll(new RegExp(`\\b${receiver}\\s*\\.\\s*([A-Za-z_]\\w*)\\s*\\.\\s*collectAsState\\s*\\(`,'g'))];
  for(const m of observed){
   const publicName=m[1]!;
   const backing='_'+publicName;
   if(new RegExp(`\\b(?:val|var)\\s+${esc(publicName)}\\s*=\\s*${esc(backing)}\\s*\\.\\s*asStateFlow\\s*\\(`).test(write)&&
      new RegExp(`\\b${esc(backing)}\\s*\\.\\s*value\\s*(?:=|\\+=|-=|\\+\\+|--)`).test(handler))
    return {framework:binding.kind,read:`${binding.receiver}.${publicName}.collectAsState`,write:`${backing}.value`,channel:publicName,proof:'paired-state-syntax'};
  }
 }
 if(binding.kind==='riverpod-provider'){
  if(new RegExp(`\\bref\\s*\\.\\s*watch\\s*\\(\\s*${esc(binding.provider!)}\\s*\\)`).test(read)&&
     new RegExp(`\\bstate\\s*(?:=|\\+=|-=|\\+\\+|--)`).test(handler))
   return {framework:binding.kind,read:`ref.watch(${binding.provider})`,write:'state mutation',channel:binding.provider!,proof:'paired-state-syntax'};
 }
 if(binding.kind==='flutter-bloc'||binding.kind==='flutter-cubit'){
  if(new RegExp(`\\b(?:BlocBuilder|BlocConsumer|BlocListener)\\s*<\\s*${esc(binding.owner)}\\s*,`).test(read)&&
    /\bemit\s*\(/.test(handler))return {framework:binding.kind,read:`BlocBuilder<${binding.owner}>`,write:'emit()',channel:binding.owner,proof:'paired-state-syntax'};
 }
 return null;
}
