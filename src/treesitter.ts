/**
 * Optional, BUNDLED, offline Tree-sitter WASM bridge. It NEVER downloads an
 * executable, resolves an asset from the user's repository or runs project code.
 * If vendor assets have not been bundled, the structural lexer remains active.
 * This code does not claim the optional WASM grammars are present by default.
 */
import { lstatSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parserRegistry, type Analysis, type Segment } from './smart.js';
import { analyzeStructured } from './structural.js';

const assetsRoot=join(dirname(fileURLToPath(import.meta.url)),'..','vendor','tree-sitter');
const families:Record<string,string[]>={
 python:['.py','.pyi'],go:['.go'],java:['.java'],c_sharp:['.cs'],rust:['.rs'],
 kotlin:['.kt','.kts'],dart:['.dart'],php:['.php'],ruby:['.rb'],
 c:['.c','.h'],cpp:['.cc','.cpp','.cxx','.hpp','.hxx']
};
const supported=new Set([
 'function_definition','function_declaration','function_item','method_declaration','method_definition','method_signature',
 'class_definition','class_declaration','class_specifier','interface_declaration','interface_definition',
 'struct_item','struct_specifier','struct_declaration','enum_declaration','enum_item',
 'trait_item','trait_declaration','impl_item','object_declaration','constructor_declaration',
 'method','function','class','module'
]);
const containers=new Set(['class_definition','class_declaration','class_specifier','interface_declaration','struct_item','struct_specifier','trait_item','object_declaration','impl_item','class','module']);
type TreeNode={type:string;isNamed?:boolean;hasError?:(()=>boolean)|boolean;startIndex:number;endIndex:number;startPosition:{row:number};endPosition:{row:number};namedChildren:TreeNode[];nextNamedSibling?:TreeNode|null;childForFieldName:(name:string)=>TreeNode|null;text?:string};
type RuntimeStatus={enabled:boolean;runtime:'missing'|'ready'|'invalid';grammars:string[];failed:Record<string,string>};
let state:RuntimeStatus={enabled:false,runtime:'missing',grammars:[],failed:{}};
let inFlight:Promise<RuntimeStatus>|undefined;
function trustedAsset(path:string,maxBytes:number):boolean{
 try {const s=lstatSync(path);return !s.isSymbolicLink()&&s.isFile()&&s.size>4&&s.size<=maxBytes;}catch{return false;}
}
function isWasmFile(path:string):boolean{
 return trustedAsset(path,12*1024*1024)&&readFileSync(path).subarray(0,4).equals(Buffer.from([0,97,115,109]));
}
function verifiedAsset(file:string,relative:string,maxBytes:number):boolean{
 if(!trustedAsset(file,maxBytes))return false;
 try{
  const manifest=JSON.parse(readFileSync(join(assetsRoot,'asset-manifest.json'),'utf8')) as
   {assets?:{path:string;sha256:string;bytes:number}[]};
  const entry=manifest.assets?.find(x=>x.path===relative);
  if(!entry||!/^[a-f0-9]{64}$/.test(entry.sha256))return false;
  const data=readFileSync(file);
  return data.length===entry.bytes&&createHash('sha256').update(data).digest('hex')===entry.sha256;
 }catch{return false;}
}
function nodeText(node:TreeNode,text:string){return text.slice(node.startIndex,node.endIndex);}
function nameFor(node:TreeNode,text:string):string|undefined{
 if(node.type==='method_signature'){
  const child=node.namedChildren.find(c=>c.type==='function_signature');
  if(child)return nameFor(child,text);
 }
 const n=node.childForFieldName('name')||node.childForFieldName('declarator');
 const first=n?nodeText(n,text):undefined;
 const candidate=(first||node.namedChildren.find(c=>['identifier','type_identifier','simple_identifier','constant','field_identifier','name','property_identifier'].includes(c.type))?.text||'').trim();
 const match=candidate.match(/[A-Za-z_$][\w$]*/);
 return match?.[0];
}
/** Safe extraction from Tree-sitter's typed nodes, with source offsets and an AST identifier walk. */
export function analyzeTree(root:TreeNode,path:string,text:string):Analysis{
 const segments:Segment[]=[],MAX_NODES=45000,MAX_DECLS=2000;let visited=0;
 const refs=(node:TreeNode)=>{
  const names=new Set<string>(),todo=[node];let seen=0;
  while(todo.length&&seen++<12000){const cur=todo.pop()!;
   if(['identifier','type_identifier','field_identifier','property_identifier'].includes(cur.type)){
     const name=nodeText(cur,text);if(name.length>2&&name.length<160)names.add(name);
   }else if(cur.type!=='comment'&&!cur.type.includes('string'))todo.push(...(cur.namedChildren||[]));
  }
  return [...names].sort();
 };
 // AST call sites only: comments, strings and plain mentions never count.
 // Grammar field names are different (Python: function, Java: name,
 // Ruby: method). Preserve terminal identity; dynamic dispatch is not solved.
 const callTargets=(node:TreeNode):string[]=>{
  const found=new Set<string>(),todo=[node];let count=0;
  const callTypes=new Set(['call','call_expression','method_invocation','invocation_expression','function_call_expression','function_call','call_suffix']);
  while(todo.length&&++count<12000){
   const n=todo.pop()!;
   if(n!==node&&(supported.has(n.type)||n.type==='function_definition'))continue;
   if(n.type==='return_statement'||n.type==='expression_statement'||n.type==='assignment_expression'||n.type==='function_expression_body'){
    for(let i=0;i<n.namedChildren.length-1;i++){
     const head=n.namedChildren[i]!,tail=n.namedChildren[i+1]!;
     if(head.type!=='identifier'||tail.type!=='selector')continue;
     const name=nodeText(head,text);
     if(!/^[\p{L}_$][\p{L}\p{N}_$]*$/u.test(name))continue;
     // Dart splits a method call into identifier, dotted selector, argument
     // selector siblings: helper .applyDiscount (x). Prove all three nodes.
     const args=n.namedChildren[i+2];
     const property=nodeText(tail,text).match(/^\.([\p{L}_$][\p{L}\p{N}_$]*)$/u)?.[1];
     if(property&&args?.type==='selector'&&args.namedChildren.some(c=>c.type==='argument_part'))found.add(name+'.'+property);
     else if(tail.namedChildren.some(c=>c.type==='argument_part'))found.add(name);
    }
   }
   if(callTypes.has(n.type)){
    const invoked=n.childForFieldName('function')||n.childForFieldName('name')||n.childForFieldName('method')||
      n.namedChildren.find(c=>/identifier|member_expression|selector_expression|field_expression|navigation_expression/.test(c.type));
    if(invoked){const object=n.childForFieldName('object');const raw=(object?nodeText(object,text)+'.':'')+nodeText(invoked,text);
      const ids=raw.match(/[\p{L}_$][\p{L}\p{N}_$]*/gu)||[];
      if(ids.length){const sym=ids.at(-1)!;if(sym.length<160)found.add(raw.length<160?raw:sym);}
    }
   }
   if(n.type!=='comment'&&!n.type.includes('string'))todo.push(...(n.namedChildren||[]));
  }
  return [...found].sort();
 };
 const visit=(node:TreeNode,parent='')=>{
  if(++visited>MAX_NODES||segments.length>=MAX_DECLS)return;
  let scope=parent;
  const isDartTopLevel=path.endsWith('.dart')&&node.type==='function_signature'&&node.nextNamedSibling?.type==='function_body';
  const isCPrototype=(path.endsWith('.h')||path.endsWith('.hpp')||path.endsWith('.hxx'))&&node.type==='declaration'&&node.childForFieldName('declarator')?.type==='function_declarator';
  if((supported.has(node.type)||isCPrototype||isDartTopLevel)&&(node.type!=='module'||path.endsWith('.rb'))){
    const name=nameFor(node,text);
    if(name){
      // Dart puts the method signature and body in adjacent sibling nodes.
      // Preserve the full method body, rather than silently emitting a signature only.
      const adjacentBody=(node.type==='method_signature'||isDartTopLevel)&&node.nextNamedSibling?.type==='function_body'?node.nextNamedSibling:null;
      const start=node.startIndex,end=adjacentBody?.endIndex??node.endIndex;
      if(Number.isInteger(start)&&Number.isInteger(end)&&end>start&&start>=0&&end<=text.length){
       const isContainer=containers.has(node.type),bodyNode=node.childForFieldName('body')||adjacentBody;
       const bodyStart=bodyNode?.startIndex??Math.min(end,text.indexOf('\n',start)<0?end:text.indexOf('\n',start)+1);
       const namePath=parent?`${parent}.${name}`:name;
       const header=text.slice(start,Math.max(start,Math.min(end,bodyStart))).trimEnd().slice(0,450);
       const signature=header+(path.endsWith('.py')||path.endsWith('.rb')?'\n    # body omitted':' { /* body omitted */ }');
       segments.push({name:namePath,kind:isContainer?'class':'function',start,end,startLine:node.startPosition.row+1,endLine:(adjacentBody||node).endPosition.row+1,
        signature,body:isContainer?signature:text.slice(start,end),refs:isContainer?[]:[...new Set([...refs(node),...(adjacentBody?refs(adjacentBody):[])])].sort(),calls:isContainer?[]:[...new Set([...callTargets(node),...(adjacentBody?callTargets(adjacentBody):[])])].sort(),score:0});
       if(isContainer)scope=namePath;
      }
    }
  }
  for(const child of node.namedChildren||[])visit(child,scope);
 };
 visit(root);
 const parseError=typeof root.hasError==='function'?root.hasError():Boolean(root.hasError);
 const invalid=parseError||visited>MAX_NODES;
 // Never truncate silently on damaged syntax or an oversized AST.
 return {parser:'tree-sitter-wasm',segments:invalid?[]:segments,imports:[],importLines:[],exports:[],diagnostics:invalid?1:0,sourceBytes:Buffer.byteLength(text)};
}
export function treeSitterStatus():RuntimeStatus{return {...state,grammars:[...state.grammars],failed:{...state.failed}};}
export function initializeTreeSitter():Promise<RuntimeStatus>{
 if(inFlight)return inFlight;
 inFlight=(async()=>{
  const runtime=join(assetsRoot,'tree-sitter.js'),wasm=join(assetsRoot,'tree-sitter.wasm');
  if(!trustedAsset(runtime,2*1024*1024)||!isWasmFile(wasm))return treeSitterStatus();
  if(!verifiedAsset(runtime,'tree-sitter.js',2*1024*1024)||!verifiedAsset(wasm,'tree-sitter.wasm',12*1024*1024)){
   state={enabled:false,runtime:'invalid',grammars:[],failed:{runtime:'bundled asset checksum mismatch or missing manifest'}};
   return treeSitterStatus();
  }
  const failed:Record<string,string>={},grammars:string[]=[];
  try {
   // The imported module is shipped under dist/vendor, NEVER from target repo.
   const mod:any=await import(pathToFileURL(runtime).href);
   const Parser=mod.Parser,Language=mod.Language;
   if(typeof Parser?.init!=='function'||typeof Language?.load!=='function')throw new Error('unsupported Tree-sitter runtime API');
   await Parser.init({locateFile:()=>wasm});
   for(const [name,exts] of Object.entries(families)){
    const grammar=join(assetsRoot,`tree-sitter-${name}.wasm`);
    if(!isWasmFile(grammar)){failed[name]='grammar not bundled';continue;}
    if(!verifiedAsset(grammar,`tree-sitter-${name}.wasm`,12*1024*1024)){failed[name]='grammar checksum mismatch or absent manifest entry';continue;}
    try {
     const language=await Language.load(grammar);const parser=new Parser();parser.setLanguage(language);
     parserRegistry.register({id:`tree-sitter-${name}`,quality:'ast',extensions:exts,analyze:(file,source)=>{
       try {const tree=parser.parse(source);if(!tree)return analyzeStructured(file,source);
         try { const parsed=analyzeTree(tree.rootNode,file,source);
           return parsed.diagnostics||!parsed.segments.length?analyzeStructured(file,source):parsed;
         } finally { tree.delete?.(); }
       }catch{return analyzeStructured(file,source);}
     }},{replace:true});
     grammars.push(name);
    }catch(e){failed[name]=String(e);}
   }
   state={enabled:grammars.length>0,runtime:'ready',grammars,failed};
  }catch(e){state={enabled:false,runtime:'invalid',grammars:[],failed:{runtime:String(e)}};}
  return treeSitterStatus();
 })();return inFlight;
}
