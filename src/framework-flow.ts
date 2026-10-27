/**
 * Bounded, offline framework syntax hints to select AST-backed action roots.
 * Evidence is intentionally "framework-syntax" (NOT compiler-resolved flow).
 * A hint is eligible only if the enclosing declaration is parsed by Tree-sitter
 * and is in a task-named/explicit file. Comments and strings cannot trigger it.
 */
import type { Segment } from './smart.js';

export type FrameworkKind='flutter'|'jetpack-compose'|'spring-mvc'|'aspnet-core';
export type FrameworkEvent={
 framework:FrameworkKind;kind:'ui-event'|'http-route';path:string;line:number;offset:number;
 trigger:string;handler:string;root:string;onlyCalls?:string[];observedWrites?:string[];observedStateApi?:string[];evidence:'framework-syntax+ast-declaration';
};

/** Preserve source offsets; mask quoted strings and comments for syntax matching. */
function codeOnly(text:string):string {
 const chars=text.split('');let mode:'code'|'line'|'block'|'string'='code';let quote='';
 for(let i=0;i<chars.length;i++){
  const c=text[i]!,n=text[i+1];
  if(mode==='line') {if(c==='\n')mode='code';else chars[i]=' ';continue;}
  if(mode==='block') {if(c==='*'&&n==='/'){chars[i]=' ';chars[i+1]=' ';i++;mode='code';}else if(c!=='\n')chars[i]=' ';continue;}
  if(mode==='string'){
   if(c==='\\'&&i+1<chars.length){chars[i]=' ';i++;if(text[i]!=='\n')chars[i]=' ';continue;}
   if(c===quote)mode='code';
   if(c!=='\n')chars[i]=' ';
   continue;
  }
  if(c==='/'&&n==='/'){chars[i]=' ';chars[i+1]=' ';i++;mode='line';continue;}
  if(c==='/'&&n==='*'){chars[i]=' ';chars[i+1]=' ';i++;mode='block';continue;}
  if(c==='"'||c==="'"||c==='`'){quote=c;mode='string';chars[i]=' ';}
 }
 return chars.join('');
}
const simpleCalls=(body:string):string[]=>[...new Set([...body.matchAll(/\b([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?)(?:\s*<\s*[A-Za-z_$][\w$<>, ?]*>)?\s*\(/g)]
 .map(m=>m[1]!).filter(x=>!['if','for','while','switch','return','Text','Button'].includes(x)))];
const callbackWrites=(body:string)=>[...new Set([...body.matchAll(/\b([A-Za-z_$][\w$]*(?:\.(?:value|state))?)\s*(?:\+\+|--|(?:\+|-|\*|\/)?=(?!=))/g)]
 .slice(0,12).map(m=>m[1]!))];
const stateApiCalls=(calls:string[])=>calls.filter(x=>/^(?:setState|setValue|updateState|mutableStateOf|mutableIntStateOf|mutableLongStateOf|mutableFloatStateOf)$/.test(x));
const lineOf=(s:string,offset:number)=>s.slice(0,offset).split('\n').length;
const last=(name:string)=>name.split('.').at(-1)||name;
const methodFor=(segments:Segment[],start:number,end:number)=>segments.filter(s=>s.kind==='function'&&s.start<=start&&s.end>=end)
 .sort((a,b)=>(a.end-a.start)-(b.end-b.start))[0];
function namedHandler(segments:Segment[],name:string,owner:string|undefined):Segment|undefined{
 const matches=segments.filter(s=>s.kind==='function'&&last(s.name)===name);
 const scoped=owner?matches.filter(s=>s.name.startsWith(owner+'.')):[];
 return scoped.length===1?scoped[0]:matches.length===1?matches[0]:undefined;
}
function closingBrace(code:string,open:number):number{
 let depth=0;
 for(let i=open;i<code.length&&i<open+10000;i++){
  if(code[i]==='{')depth++;else if(code[i]==='}'&&--depth===0)return i;
 }
 return -1;
}
function keywordMatch(task:string,name:string):boolean{
 const pieces=name.replace(/([a-z\d])([A-Z])/g,'$1 $2').split(/[^A-Za-z\d]+/).filter(x=>x.length>=4)
  .map(x=>x.toLowerCase());
 const words=new Set((task.toLowerCase().match(/[a-z][a-z\d]{3,}/g)||[]));
 return pieces.some(x=>words.has(x));
}
function inTaskScope(path:string,sourceName:string,task:string,trigger:string):boolean{
 if(task.includes(path))return true;
 return keywordMatch(task,sourceName)||keywordMatch(task,trigger);
}

export function discoverFrameworkEvents(path:string,source:string,segments:Segment[],task:string):FrameworkEvent[]{
 const code=codeOnly(source),events:FrameworkEvent[]=[];
 const add=(event:FrameworkEvent)=>{if(events.length<36&&!events.some(e=>e.framework===event.framework&&e.path===event.path&&e.offset===event.offset))events.push(event);};
 const isFlutter=path.endsWith('.dart');
 const isCompose=/\.kts?$/.test(path);
 if(isFlutter||isCompose){
  const framework=isFlutter?'flutter' as const:'jetpack-compose' as const;
  const re=isFlutter?/\b(onPressed|onTap|onChanged|onSubmitted)\s*:\s*/g:/\b(onClick|onValueChange|onCheckedChange)\s*=\s*/g;
  let match:RegExpExecArray|null;
  while((match=re.exec(code))!==null&&events.length<36){
   const offset=match.index;const ownerMethod=methodFor(segments,offset,offset+match[0].length);
   if(!ownerMethod)continue;
   const callerNames=ownerMethod.calls||[];
   if(isFlutter && !callerNames.some(x=>/^(?:ElevatedButton|OutlinedButton|TextButton|IconButton|FilledButton|CupertinoButton|InkWell|GestureDetector|ListTile|TextField|Checkbox|Switch)$/.test(x)))continue;
   if(isCompose && !/@Composable\b/.test(code.slice(ownerMethod.start,ownerMethod.end)) &&
      !callerNames.some(x=>/^(?:Button|IconButton|TextButton|OutlinedButton|FloatingActionButton|Checkbox|Switch|TextField)$/.test(x)))continue;
   const owner=ownerMethod.name.split('.').length>1?ownerMethod.name.split('.').slice(0,-1).join('.'):undefined;
   const marker=match[1]!,remaining=code.slice(re.lastIndex,re.lastIndex+200);
   const fullRoot=ownerMethod.name;
   if(!inTaskScope(path,fullRoot,task,marker))continue;
   const prefix=/^\s*(?:\(\s*\)\s*(?:=>\s*)?)?/.exec(remaining)?.[0]||'';
   const valueStart=re.lastIndex+prefix.length;
   const next=code.slice(valueStart,valueStart+180);
   const named=/^([A-Za-z_$][\w$]*)\b(?!\s*\()/.exec(next);
   if(named){
    const handler=namedHandler(segments,named[1]!,owner);
    if(handler){add({framework,kind:'ui-event',path,line:lineOf(source,offset),offset,trigger:marker,handler:handler.name,root:handler.name,...(stateApiCalls(handler.calls||[]).length?{observedStateApi:stateApiCalls(handler.calls||[])}:{}),evidence:'framework-syntax+ast-declaration'});continue;}
   }
   // Dart also accepts onPressed: () => submit() or a direct service call.
   // Verify that the target exists as an AST call or a unique local method;
   // an arbitrary identifier in the following widget is not enough.
   if(isFlutter && prefix.includes('=>')){
    const arrowName=next.match(/^([A-Za-z_$][\w$]*)\s*\(/)?.[1];
    if(arrowName){
     const handler=namedHandler(segments,arrowName,owner);
     if(handler && (ownerMethod.calls||[]).some(call=>call===arrowName||call.endsWith('.'+arrowName))){
      add({framework,kind:'ui-event',path,line:lineOf(source,offset),offset,trigger:marker,handler:handler.name,root:handler.name,...(stateApiCalls(handler.calls||[]).length?{observedStateApi:stateApiCalls(handler.calls||[])}:{}),evidence:'framework-syntax+ast-declaration'});
      continue;
     }
    }
    const called=next.match(/^([A-Za-z_$][\w$]*\.[A-Za-z_$][\w$]*)\s*\(/)?.[1];
    if(called && (ownerMethod.calls||[]).includes(called)){
     add({framework,kind:'ui-event',path,line:lineOf(source,offset),offset,trigger:marker,handler:ownerMethod.name,root:ownerMethod.name,onlyCalls:[called],evidence:'framework-syntax+ast-declaration'});
     continue;
    }
   }
   const brace=code.indexOf('{',valueStart);
   // The callback body itself must immediately follow the event attribute;
   // never use unrelated braces elsewhere in the rendering method.
   if(brace<0||brace>valueStart+14)continue;
   const end=closingBrace(code,brace);
   if(end<0||end>ownerMethod.end)continue;
   const calls=simpleCalls(code.slice(brace+1,end)).filter(c=>(ownerMethod.calls||[]).some(ast=>ast===c||ast.endsWith('.'+c)));
   const writes=callbackWrites(code.slice(brace+1,end));
   if(calls.length||writes.length)add({framework,kind:'ui-event',path,line:lineOf(source,offset),offset,trigger:marker,handler:ownerMethod.name,root:ownerMethod.name,onlyCalls:calls,...(writes.length?{observedWrites:writes}:{}),...(stateApiCalls(calls).length?{observedStateApi:stateApiCalls(calls)}:{}),evidence:'framework-syntax+ast-declaration'});
  }
 }
 if(/\.java$|\.cs$/.test(path)){
  const framework=path.endsWith('.java')?'spring-mvc' as const:'aspnet-core' as const;
  const attribute=framework==='spring-mvc'?/@(?:Get|Post|Put|Delete|Patch|Request)Mapping\b/g:/\[(?:Http(?:Get|Post|Put|Delete|Patch)|Route)\b/g;
  for(const method of segments.filter(s=>s.kind==='function')){
   const span=code.slice(method.start,Math.min(method.end,method.start+550));
   const found=attribute.exec(span);attribute.lastIndex=0;
   if(!found)continue;
   // Require that the annotation is at the declaration start, rather than
   // nested inside a method body or attached to the preceding method.
   const declarationLead=span.slice(0,found.index);
   if(declarationLead.trim().length>40)continue;
   const marker=found[0]!.replace(/[@\[]/g,'');
   const routeMatch=source.slice(method.start+found.index,method.start+found.index+160).match(/^[^\n]*?["']([^"'\n]+)["']/);
   const route=routeMatch?.[1]||'';
   // An explicit controller path does not make every route relevant: a
   // checkout task must not promote a sibling /health or /metrics route.
   if(!keywordMatch(task,route)&&!keywordMatch(task,last(method.name)))continue;
   add({framework,kind:'http-route',path,line:method.startLine,offset:method.start+found.index,trigger:marker+(route?':'+route:''),handler:method.name,root:method.name,evidence:'framework-syntax+ast-declaration'});
  }
 }
 return events.sort((a,b)=>a.offset-b.offset||a.handler.localeCompare(b.handler));
}
