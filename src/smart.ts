/**
 * Smart Context Engine. TypeScript's full JS/JSX/TS/TSX parser is vendored in
 * the distribution and loaded OFFLINE: no runtime npm modules or network.
 * All file reading and security checks remain the responsibility of pack.ts.
 */
import { createRequire } from 'node:module';
import { analyzeStructured, STRUCTURAL_LANGUAGES } from './structural.js';
import { ParserRegistry } from './parser.js';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const requireLocal=createRequire(import.meta.url);
const ts:any=requireLocal(join(dirname(fileURLToPath(import.meta.url)),'..','vendor','typescript.cjs'));

export type Segment={name:string;kind:string;startLine:number;endLine:number;start:number;end:number;signature:string;body:string;refs:string[];calls?:string[];score:number;parent?:string;role?:string};
export type Analysis={parser:'typescript-ast'|'tree-sitter-wasm'|'structural-lexer'|'plain';segments:Segment[];imports:string[];importLines:string[];exports:string[];diagnostics:number;sourceBytes:number};
const JS_TS=/\.(?:[mc]?[jt]sx?)$/i;
const line=(source:any,pos:number)=>source.getLineAndCharacterOfPosition(pos).line+1;
const words=(s:string)=>new Set((s.match(/[\p{L}_$][\p{L}\p{N}_$]*/gu)||[]).filter(x=>x.length>2).map(s=>s.toLowerCase()));
export function queryTerms(text:string):Set<string>{return words(text.replace(/([a-z])([A-Z])/g,'$1 $2'));}
/** Task intent, not conversational boilerplate. Small language-neutral morphological normalization. */
const TASK_STOPWORDS=new Set(['analyze','analyse','review','find','identify','locate','trace','relevant','potential','where','what','when','which','there','their','these','those','with','from','into','only','please','without','code','source','files','file','functions','function','project','goal','goals','task','constraints','report','flow','current','following','important','changes','bugs','bug','inconsistencies','managing']);
const rootWord=(w:string)=>w.endsWith('ies')&&w.length>5?w.slice(0,-3)+'y':w.endsWith('s')&&!w.endsWith('ss')&&w.length>4?w.slice(0,-1):w;
export function taskKeywords(text:string):Set<string>{return new Set([...queryTerms(text)].map(rootWord).filter(w=>!TASK_STOPWORDS.has(w)));}
/** A UI that merely calls products.update should not become a cart-task root
 * because "products" and "updates" appear somewhere in the prompt. Exact
 * qualified-method mentions are intentional and are always allowed. Otherwise
 * require two independent overlapping terms, at least one discriminative.
 * This remains lexical evidence; it does not establish runtime reachability.
 */
export function taskSpecificApiMember(qualifiedName:string,task:string,terms:ReadonlySet<string>=taskKeywords(task)):boolean{
 for(let index=task.indexOf(qualifiedName);index>=0;index=task.indexOf(qualifiedName,index+1)){
  const before=index>0?task[index-1]:'';
  const after=task[index+qualifiedName.length]||'';
  if(!/[\w$.]/.test(before)&&!/[\w$.]/.test(after))return true;
 }
 const shared=[...taskKeywords(qualifiedName.replace(/\./g,' '))].filter(word=>terms.has(word));
 const generic=new Set(['get','list','by','all','id','db','api','product','item','data','page','user',
  'update','create','delete','save','load','fetch','set','add','remove','change','manage']);
 return shared.length>=2&&shared.some(word=>!generic.has(word));
}


function kind(node:any):string{
 if(ts.isFunctionDeclaration(node)||ts.isMethodDeclaration(node)||ts.isConstructorDeclaration(node))return 'function';
 if(ts.isClassDeclaration(node))return 'class';
 if(ts.isInterfaceDeclaration(node))return 'interface';
 if(ts.isTypeAliasDeclaration(node))return 'type';
 if(ts.isEnumDeclaration(node))return 'enum';
 if(ts.isVariableStatement(node))return 'variable';
 if(ts.isExportAssignment(node))return 'export';
 if(ts.isImportDeclaration(node))return 'import';
 return 'other';
}
function nodeName(node:any):string{
 if(ts.isVariableStatement(node))return node.declarationList.declarations.map((d:any)=>d.name.getText()).join(', ');
 if(ts.isExportAssignment(node))return 'default';
 return node.name?.getText?.()||'anonymous';
}
function compactSignature(node:any,source:any,text:string):string{
 const original=node.getText(source);
 if(!node.body) {
   if(ts.isClassDeclaration(node))return `class ${nodeName(node)} { /* members summarized separately */ }`;
   if(ts.isInterfaceDeclaration(node))return original.length>400?original.slice(0,400)+' /* outline truncated */':original;
   if(ts.isVariableStatement(node)){
     if(original.length>160){
       const declaration=node.declarationList.declarations?.[0];
       const assignment=declaration?.initializer;
       if(assignment){
         const start=assignment.getStart(source)-node.getStart(source);
         return original.slice(0,Math.min(start,170)).trimEnd()+'/* initializer omitted */;';
       }
     }
     return original;
   }
   return original.length>350?original.slice(0,350)+' /* declaration truncated */':original;
 }
 const head=text.slice(node.getStart(source),node.body.getStart(source));
 return head.trimEnd().slice(0,300)+' { /* body omitted */ }';
}
function collectRefs(node:any):string[]{
 const refs=new Set<string>(); let visited=0;
 const visit=(n:any)=>{if(++visited>30000)return;
   if(ts.isIdentifier(n)&&n.text.length>2)refs.add(n.text);
   ts.forEachChild(n,visit);
 };
 visit(node);return [...refs].sort();
}
function collectUnits(n:any,source:any,text:string,parent?:string):Segment[]{
 const name=(parent?parent+'.':'')+nodeName(n);
 const st=n.getStart(source),end=n.getEnd();
 const segment:Segment={name,kind:kind(n),startLine:line(source,st),endLine:line(source,Math.max(st,end-1)),start:st,end,signature:compactSignature(n,source,text),body:text.slice(st,end),refs:collectRefs(n),score:0};
 if(ts.isClassDeclaration(n)&&n.members?.length){
   const result:Segment[]=[{...segment,signature:segment.signature,body:segment.signature,refs:[],kind:'class'}];
   for(const member of n.members){if(ts.isMethodDeclaration(member)||ts.isConstructorDeclaration(member)||ts.isGetAccessorDeclaration(member)||ts.isSetAccessorDeclaration(member))result.push(...collectUnits(member,source,text,nodeName(n)));
   }
   return result;
 }
 return [segment];
}

/** Split large exported object APIs (e.g. db.orders.create) into exact AST members.
 * These are annotated extracts: a single object method is not standalone TS.
 * We intentionally ignore computed/nonliteral property names rather than guess.
 */
function collectObjectApiUnits(n:any,source:any,text:string,minBytes=2200):Segment[]|null{
 if(!ts.isVariableStatement(n)||n.declarationList.declarations.length!==1)return null;
 const decl=n.declarationList.declarations[0];
 if(!ts.isIdentifier(decl.name)||!decl.initializer||!ts.isObjectLiteralExpression(decl.initializer))return null;
 if(n.getWidth(source)<minBytes)return null;
 const container=collectUnits(n,source,text)[0]!;
 const result:Segment[]=[{...container,role:'api-container',signature:`${decl.name.text} = { /* member methods shown as separate extracts */ }`,body:container.signature}];
 const traverse=(obj:any,parts:string[],depth:number)=>{
   if(depth>5)return;
   for(const member of obj.properties){
     if(!member.name)continue;
     const raw=member.name;
     if(!ts.isIdentifier(raw)&&!ts.isStringLiteral(raw))continue;
     const key=raw.text;
     if(!/^[A-Za-z_$][\w$]*$/.test(key))continue;
     const path=[...parts,key];
     if(ts.isPropertyAssignment(member)&&ts.isObjectLiteralExpression(member.initializer)){
       traverse(member.initializer,path,depth+1);continue;
     }
     const callable=ts.isMethodDeclaration(member)||ts.isGetAccessorDeclaration(member)||ts.isSetAccessorDeclaration(member)||
       (ts.isPropertyAssignment(member)&&(
         ts.isArrowFunction(member.initializer)||ts.isFunctionExpression(member.initializer)||
         ts.isCallExpression(member.initializer)));
     if(!callable)continue;
     const start=member.getStart(source),end=member.getEnd();
     const body=text.slice(start,end);
     result.push({name:path.join('.'),kind:'function',role:'api-member',parent:parts[0],
       startLine:line(source,start),endLine:line(source,Math.max(start,end-1)),start,end,
       signature:body.length>180?body.slice(0,140).trimEnd()+' /* method body omitted */':body,
       body,refs:collectRefs(member),score:0});
   }
 };
 traverse(decl.initializer,[decl.name.text],0);
 return result.length>1?result:null;
}

/** AST-only imported member invocations. Does not treat a bare imported object
 * identifier as a request for all its sibling methods. */
export type ImportedMemberCall={qualifiedName:string;caller:string;line:number;start:number;end:number;owner:string};
export function discoverImportedMemberCalls(path:string,text:string,specifier:string):ImportedMemberCall[]{
 if(!JS_TS.test(path))return [];
 const mode=/\.tsx$/i.test(path)?ts.ScriptKind.TSX:/\.jsx$/i.test(path)?ts.ScriptKind.JSX:ts.ScriptKind.TS;
 const source=ts.createSourceFile(path,text,ts.ScriptTarget.Latest,true,mode);
 if(source.parseDiagnostics.length)return [];
 const locals=new Map<string,{exported:string;namespace:boolean}>();
 for(const stmt of source.statements){
   if(!ts.isImportDeclaration(stmt)||stmt.moduleSpecifier?.text!==specifier||stmt.importClause?.isTypeOnly)continue;
   const imports=stmt.importClause?.namedBindings;
   if(imports&&ts.isNamedImports(imports))for(const el of imports.elements){
     if(el.isTypeOnly)continue;
     locals.set(el.name.text,{exported:el.propertyName?.text||el.name.text,namespace:false});
   }
   if(imports&&ts.isNamespaceImport(imports))locals.set(imports.name.text,{exported:'',namespace:true});
 }
 if(!locals.size)return [];
 const memberChain=(node:any):string[]|null=>{
   if(ts.isIdentifier(node))return [node.text];
   if(ts.isPropertyAccessExpression(node)){
     const base=memberChain(node.expression);return base?[...base,node.name.text]:null;
   }
   if(ts.isElementAccessExpression(node)&&node.argumentExpression&&ts.isStringLiteral(node.argumentExpression)){
     const base=memberChain(node.expression);return base?[...base,node.argumentExpression.text]:null;
   }
   return null;
 };
 const found=new Map<string,ImportedMemberCall>();
 // Avoid treating calls through a locally shadowed identifier as calls through
 // the imported binding. This is a bounded lexical guard, not TS type checking.
 const binds=(name:any,target:string):boolean=>{
   if(!name)return false;
   if(ts.isIdentifier(name))return name.text===target;
   if(ts.isBindingElement(name))return binds(name.name,target);
   if(ts.isArrayBindingPattern(name)||ts.isObjectBindingPattern(name))return name.elements.some((x:any)=>binds(x,target));
   return false;
 };
 const shadowed=(node:any,binding:string):boolean=>{
   let parent=node.parent;
   while(parent&&parent!==source){
     if(ts.isFunctionLike(parent)&&parent.parameters?.some((x:any)=>binds(x.name,binding)))return true;
     if(ts.isCatchClause(parent)&&binds(parent.variableDeclaration?.name,binding))return true;
     if(ts.isBlock(parent))for(const stmt of parent.statements){
       if(ts.isFunctionDeclaration(stmt)&&stmt.name?.text===binding)return true;
       if(ts.isVariableStatement(stmt)&&stmt.declarationList.declarations.some((d:any)=>binds(d.name,binding)))return true;
     }
     if((ts.isForOfStatement(parent)||ts.isForInStatement(parent)||ts.isForStatement(parent))&&
       parent.initializer&&ts.isVariableDeclarationList(parent.initializer)&&
       parent.initializer.declarations.some((d:any)=>binds(d.name,binding)))return true;
     parent=parent.parent;
   }
   return false;
 };
 const visit=(node:any)=>{
   if(ts.isCallExpression(node)){
     const chain=memberChain(node.expression);
     if(chain&&chain.length>=2&&locals.has(chain[0]!)&&!shadowed(node,chain[0]!)){
       const info=locals.get(chain[0]!)!;
       const qualifiedName=[...(info.namespace?[]:[info.exported]),...chain.slice(1)].join('.');
       if(qualifiedName.split('.').length>=2){
         let owner='module';let n=node.parent;
         while(n&&n!==source){
           if(ts.isFunctionDeclaration(n)&&n.name){owner=n.name.text;break;}
           if(ts.isVariableDeclaration(n)&&ts.isIdentifier(n.name)&&n.initializer&&
             (ts.isArrowFunction(n.initializer)||ts.isFunctionExpression(n.initializer))){owner=n.name.text;break;}
           if(ts.isMethodDeclaration(n)&&n.name){owner=n.name.getText(source);break;}
           n=n.parent;
         }
         const ln=line(source,node.getStart(source));
         found.set(`${qualifiedName}:${ln}:${owner}`,{qualifiedName,caller:`${path}:${ln}:${owner}`,line:ln,start:node.getStart(source),end:node.getEnd(),owner});
       }
     }
   }
   ts.forEachChild(node,visit);
 };visit(source);
 return [...found.values()].sort((a,b)=>a.qualifiedName.localeCompare(b.qualifiedName)||a.line-b.line);
}


/** Task-rooted imported-member selection. All calls are discovered for diagnostics,
 * but only those reachable from a task-named action, a protected JSX event,
 * or a task-labeled UI handler may promote source from the imported module.
 * This is a bounded local AST call graph, not interprocedural type checking.
 */
export type RootedMemberDecision={call:ImportedMemberCall;rooted:boolean;root:string|null;reason:'task-symbol'|'task-event'|'task-labeled-event'|'local-call-chain'|'task-semantic-fallback'|'outside-task-roots'};
export function classifyTaskRootedMembers(path:string,text:string,task:string,actionTargets:string[],
  calls:ImportedMemberCall[],protectedEvents:Array<{attributeStart:number;attributeEnd:number;handler:string|null}>=[]):RootedMemberDecision[]{
 if(!JS_TS.test(path)||!calls.length)return calls.map(call=>({call,rooted:false,root:null,reason:'outside-task-roots'}));
 const kind=/\.tsx$/i.test(path)?ts.ScriptKind.TSX:/\.jsx$/i.test(path)?ts.ScriptKind.JSX:ts.ScriptKind.TS;
 const source=ts.createSourceFile(path,text,ts.ScriptTarget.Latest,true,kind);
 if(source.parseDiagnostics.length)return calls.map(call=>({call,rooted:false,root:null,reason:'outside-task-roots'}));
 const terms=taskKeywords(task);
 const targets=new Set(actionTargets.map(x=>x.toLowerCase()));
 const generic=new Set(['product','item','page','store','data','component','user','order','process']);
 const rootReason=new Map<string,RootedMemberDecision['reason']>();
 const isTaskAction=(name:string)=>{
   if(targets.has(name.toLowerCase()))return true;
   // React components are containers, not task action roots.
   if(/^[A-Z]/.test(name))return false;
   const matching=[...taskKeywords(name)].filter(w=>terms.has(w)&&!generic.has(w));
   return matching.length>=1;
 };
 // Only recognized callable declarations are entry points. An entire React
 // component body is never a root merely because the component is an anchor.
 const functionRefs=new Map<string,Set<string>>();
 const functionTaskEvidence=new Map<string,Set<string>>();
 const addFn=(name:string,body:any)=>{
   if(!name||name==='module'||!body)return;
   const refs=new Set<string>();
   const scan=(n:any)=>{
     if(ts.isCallExpression(n)){
       if(ts.isIdentifier(n.expression))refs.add(n.expression.text);
       else if(ts.isPropertyAccessExpression(n.expression)&&n.expression.expression.kind===ts.SyntaxKind.ThisKeyword)refs.add(n.expression.name.text);
     }
     ts.forEachChild(n,scan);
   };
   scan(body); functionRefs.set(name,refs);
   // Use identifiers actually referenced by a callable, never an entire
   // component body or a coincidental filename match. The fallback is
   // intentionally limited and marked HEURISTIC in the manifest.
   const identifiers=new Set<string>();
   const collect=(node:any)=>{if(ts.isIdentifier(node))for(const term of taskKeywords(node.text))if(terms.has(term))identifiers.add(term);ts.forEachChild(node,collect)};
   collect(body); functionTaskEvidence.set(name,identifiers);
   if(isTaskAction(name))rootReason.set(name,'task-symbol');
 };
 const inspect=(n:any)=>{
   if(ts.isFunctionDeclaration(n)&&n.name)addFn(n.name.text,n.body);
   if(ts.isMethodDeclaration(n)&&n.name&&ts.isIdentifier(n.name))addFn(n.name.text,n.body);
   if(ts.isVariableDeclaration(n)&&ts.isIdentifier(n.name)&&n.initializer&&
     (ts.isArrowFunction(n.initializer)||ts.isFunctionExpression(n.initializer)))addFn(n.name.text,n.initializer.body);
   if(ts.isJsxAttribute(n)&&n.initializer&&ts.isJsxExpression(n.initializer)){
     const eventName=n.name.getText(source);
     if(/^on[A-Z]/.test(eventName)){
       const expr=n.initializer.expression;
       const handler=expr&&ts.isIdentifier(expr)?expr.text:null;
       if(handler){
         // Only rendered text and accessible labels count as user-facing task
         // evidence. Source code within the JSX element is NOT a label.
         const opening=n.parent?.parent;const element=opening?.parent;
         let label='';
         if(element&&ts.isJsxElement(element)){
           const walkText=(child:any)=>{
             if(ts.isJsxText(child))label+=' '+child.text;
             else if(ts.isJsxElement(child))for(const nested of child.children)walkText(nested);
           };
           for(const child of element.children)walkText(child);
         }
         for(const attr of opening?.attributes?.properties||[]){
           if(ts.isJsxAttribute(attr)&&/^(?:aria-label|title)$/.test(attr.name.getText(source))&&
             attr.initializer&&ts.isStringLiteral(attr.initializer))label+=' '+attr.initializer.text;
         }
         const matches=[...taskKeywords(label.slice(0,400))].filter(w=>terms.has(w)&&!generic.has(w));
         // Require two independent task words to prevent generic 'cart' labels
         // from promoting checkout/payment flows on the same page.
         if(matches.length>=2&&!rootReason.has(handler))rootReason.set(handler,'task-labeled-event');
       }
     }
   }
   ts.forEachChild(n,inspect);
 }; inspect(source);
 // Preserve direct calls inside a protected event expression, but do not
 // promote an entire unrelated checkout handler merely because it *mentions*
 // a task action (for example getItemPrice within processOrder). Named
 // handlers must independently qualify by action name or rendered UI label.
 const reached=new Map<string,{root:string;reason:RootedMemberDecision['reason']} >();
 const queue=[...rootReason].map(([name,reason])=>({name,root:name,reason,depth:0}));
 while(queue.length){
   const item=queue.shift()!;
   if(reached.has(item.name))continue;
   reached.set(item.name,{root:item.root,reason:item.reason});
   if(item.depth>=2||reached.size>=40)continue;
   for(const callee of functionRefs.get(item.name)||[]){
     if(functionRefs.has(callee)&&!reached.has(callee))queue.push({name:callee,root:item.root,reason:'local-call-chain' as const,depth:item.depth+1});
   }
 }
 // Fall back conservatively when an imported API call belongs to a local
 // callable that touches task data, but uses a domain-neutral name such as
 // validateStock or fetchProduct. This addresses the Naya zero-root failure.
 // A matching member name is not a proof of runtime reachability; select at
 // most TWO candidates per caller file, and retain the heuristic reason.
 const probable=calls.map((call,index)=>{
   const memberTerms=taskKeywords(call.qualifiedName.replace(/\./g,' '));
   const shared=[...memberTerms].filter(t=>terms.has(t)&&!new Set(['get','list','by','api','db','create','update','data']).has(t));
   const evidence=functionTaskEvidence.get(call.owner);
   const routine=functionRefs.has(call.owner)&&call.owner!=='module'&&!/^[A-Z]/.test(call.owner);
   const neighbors=calls.filter(other=>other.owner===call.owner).length;
   // Root only a specific callable's API use. Never expand a component's
   // entire body, a layout loader with no shared task subject, or a broad
   // checkout pipeline through unrelated coupon/order methods.
   const eligible=routine&&shared.length>0&&!!evidence?.size;
   const score=shared.length*4+(evidence?.size||0)*2-Math.max(0,neighbors-1)*2;
   return {index,eligible,score};
 }).filter(x=>x.eligible).sort((a,b)=>b.score-a.score||a.index-b.index);
 const fallback=new Set(probable.slice(0,2).map(x=>x.index));
 return calls.map((call,index)=>{
   const directEvent=protectedEvents.some(e=>call.start>=e.attributeStart&&call.end<=e.attributeEnd);
   if(directEvent)return {call,rooted:true,root:`${path}:${call.line}:task-event`,reason:'task-event'};
   const match=reached.get(call.owner);
   if(match)return {call,rooted:true,root:match.root,reason:match.reason};
   if(fallback.has(index))return {call,rooted:true,root:`${path}:${call.owner}:task-data-reference`,reason:'task-semantic-fallback'};
   return {call,rooted:false,root:null,reason:'outside-task-roots'};
 });
}

/** Split a large React component into independently rankable AST-level units.
 * Snippets are annotated extracts, NOT claimed to be independently compilable TSX.
 * The component's outer declaration becomes an outline; individual hooks,
 * callbacks and targeted JSX elements preserve original source line ranges.
 */
function collectReactUnits(n:any,source:any,text:string,minBytes=9000):Segment[]|null{
 let fn:any,component:string;
 if(ts.isFunctionDeclaration(n) && n.name && /^[A-Z]/.test(n.name.text)){
   fn=n;component=n.name.text;
 }else if(ts.isVariableStatement(n)&&n.declarationList.declarations.length===1){
   const declaration=n.declarationList.declarations[0];
   if(!ts.isIdentifier(declaration.name)||!/^[A-Z]/.test(declaration.name.text))return null;
   let init=declaration.initializer;
   if(init&&ts.isCallExpression(init)&&/^(?:React\.)?(?:memo|forwardRef)$/.test(init.expression.getText(source))){
     init=init.arguments.find((arg:any)=>ts.isArrowFunction(arg)||ts.isFunctionExpression(arg));
   }
   if(!init||!(ts.isArrowFunction(init)||ts.isFunctionExpression(init)))return null;
   fn=init;component=declaration.name.text;
 }else return null;
 if(!fn.body||!ts.isBlock(fn.body)||Buffer.byteLength(n.getText(source))<minBytes)return null;
 let hasJsx=false;
 const inspect=(node:any)=>{
   if(hasJsx)return;
   if(ts.isJsxElement(node)||ts.isJsxSelfClosingElement(node)||ts.isJsxFragment(node)){hasJsx=true;return;}
   ts.forEachChild(node,inspect);
 };
 inspect(fn.body);
 if(!hasJsx)return null;
 const start=n.getStart(source),end=n.getEnd();
 const original=n.getText(source);
 const header=original.slice(0,Math.min(original.indexOf('{')>0?original.indexOf('{')+1:160,240));
 const container:Segment={name:component,kind:'component',startLine:line(source,start),endLine:line(source,Math.max(start,end-1)),start,end,
   signature:`${header.trimEnd()} /* component body split into independently ranked AST statements and JSX fragments */`,
   body:`${header.trimEnd()} /* component body split into independently ranked AST statements and JSX fragments */`,refs:[],score:0,role:'component'};
 const children:Segment[]=[];
 const push=(name:string,kindName:string,node:any,role:string,signature?:string)=>{
   const st=node.getStart(source),ed=node.getEnd();
   const body=text.slice(st,ed);
   if(!body.trim())return;
   children.push({name:`${component}.${name}`,kind:kindName,startLine:line(source,st),endLine:line(source,Math.max(st,ed-1)),start:st,end:ed,
     signature:signature??(role==='statement'&&ts.isVariableStatement(node)&&body.length>105
       ?`${node.declarationList.declarations.map((d:any)=>d.name.getText(source)).join(', ')} = /* initializer omitted */;`
       :body.length>260?body.slice(0,200).trimEnd()+' /* body omitted */':body),body,refs:collectRefs(node),score:0,parent:component,role});
 };
 for(const stmt of fn.body.statements){
   if(ts.isReturnStatement(stmt)){
     push('render','jsx',stmt,'render','return /* JSX render tree omitted; selected JSX fragments follow */;');
     continue;
   }
   if(ts.isVariableStatement(stmt)){
     const decls=stmt.declarationList.declarations;
     const label=decls.map((d:any)=>d.name.getText(source)).join(', ').slice(0,100);
     const calls=decls.map((d:any)=>d.initializer).filter(Boolean);
     const hook=calls.some((x:any)=>ts.isCallExpression(x)&&/^use[A-Z]/.test(x.expression.getText(source)));
     const callback=calls.some((x:any)=>ts.isArrowFunction(x)||ts.isFunctionExpression(x)||ts.isCallExpression(x)&&['useCallback','useMemo'].some(t=>x.expression.getText(source).endsWith(t)));
     push(label||`statement_L${line(source,stmt.getStart(source))}`,callback?'function':'variable',stmt,hook?'hook':callback?'callback':'statement');
   }else if(ts.isFunctionDeclaration(stmt))push(stmt.name?.text||`fn_L${line(source,stmt.getStart(source))}`,'function',stmt,'callback');
   else if(ts.isExpressionStatement(stmt)){
     const expr=stmt.expression;
     const display=ts.isCallExpression(expr)?expr.expression.getText(source).slice(0,60):'expression';
     push(`${display}_L${line(source,stmt.getStart(source))}`,'expression',stmt,/^use[A-Z]/.test(display)?'hook':'statement');
   }else push(`statement_L${line(source,stmt.getStart(source))}`,'statement',stmt,'statement');
 }
 // UI events also occur inside useMemo, array maps and locally defined render
 // functions, not only in the component's top-level return statement. Retain
 // the precise opening JSX element: it contains the actual event attribute,
 // but not an unrelated (possibly enormous) descendant subtree.
 const jsxCandidates:any[]=[];let inspected=0;
 const scanJsx=(node:any)=>{
   if(++inspected>20000)return;
   if(ts.isJsxElement(node)||ts.isJsxSelfClosingElement(node)){
     const opening=ts.isJsxElement(node)?node.openingElement:node;
     const events=(opening.attributes?.properties||[]).filter((a:any)=>ts.isJsxAttribute(a)&&/^on[A-Z]/.test(a.name.getText(source)));
     const providerValue=/\.Provider$/.test(opening.tagName.getText(source)) && opening.attributes?.properties.some((a:any)=>ts.isJsxAttribute(a)&&a.name.getText(source)==='value');
     if(events.length||providerValue)jsxCandidates.push({node:opening,events,providerValue});
     else if(ts.isJsxElement(node)&&node.getWidth(source)<=2200&&node.children.some((c:any)=>ts.isJsxExpression(c)&&!!c.expression))
       jsxCandidates.push({node,events:[]});
   }
   ts.forEachChild(node,scanJsx);
 };
 scanJsx(fn.body);
 // Keep distinct event openings, including nested events. Only non-action
 // expression fragments are deduplicated against overlapping chosen fragments.
 const kept:any[]=[];
 for(const candidate of jsxCandidates.sort((a,b)=>Number(!!b.events.length)-Number(!!a.events.length)||a.node.getWidth(source)-b.node.getWidth(source))){
   const st=candidate.node.getStart(source),ed=candidate.node.getEnd();
   if(kept.some(k=>k.node.getStart(source)===st&&k.node.getEnd()===ed))continue;
   if(!candidate.events.length && kept.some(k=>st<k.node.getEnd()&&ed>k.node.getStart(source)))continue;
   kept.push(candidate);
   if(kept.length>=1000)break;
 }
 for(const candidate of kept){
   const node=candidate.node,opening=ts.isJsxElement(node)?node.openingElement:node;
   const tag=opening.tagName.getText(source).replace(/[^\w.-]/g,'').slice(0,45)||'element';
   const events=candidate.events.map((e:any)=>e.name.getText(source)).join('-');
   const location=source.getLineAndCharacterOfPosition(node.getStart(source));
   push(`jsx_${tag}_${events}_L${location.line+1}_C${location.character}`,'jsx',node,candidate.providerValue?'jsx-wiring':events?'jsx-action':'jsx-expression');
 }
 return children.length?[container,...children]:null;
}

/** Concrete JSX event to task-action links, from TypeScript AST, never comments or strings.
 * Finds direct inline calls AND local handler indirection, e.g. onClick={handleAdd}
 * where handleAdd calls addToCart. No project code is executed.
 */
export type TaskPathCallsite={target:string;handler:string|null;line:number;column:number;attributeStart:number;attributeEnd:number};
export function discoverJsxTaskCallsites(path:string,text:string,targetNames:ReadonlySet<string>):TaskPathCallsite[]{
 if(!/\.[jt]sx$/i.test(path)||targetNames.size===0)return [];
 const source=ts.createSourceFile(path,text,ts.ScriptTarget.Latest,true,/\.tsx$/i.test(path)?ts.ScriptKind.TSX:ts.ScriptKind.JSX);
 if(source.parseDiagnostics.length)return [];
 const handlers=new Map<string,any>();
 const declarations=(n:any)=>{
   if(ts.isFunctionDeclaration(n)&&n.name)handlers.set(n.name.text,n);
   if(ts.isVariableDeclaration(n)&&ts.isIdentifier(n.name)&&n.initializer){
     const init=n.initializer;
     if(ts.isArrowFunction(init)||ts.isFunctionExpression(init))handlers.set(n.name.text,init);
     else if(ts.isCallExpression(init)&&/(?:^|\.)(?:useCallback|useMemo)$/.test(init.expression.getText(source))){
       const callback=init.arguments.find((arg:any)=>ts.isArrowFunction(arg)||ts.isFunctionExpression(arg));
       if(callback)handlers.set(n.name.text,callback);
     }
   }
   ts.forEachChild(n,declarations);
 };declarations(source);
 const invoked=(n:any):Set<string>=>{
   const names=new Set<string>();let visited=0;
   const walk=(x:any)=>{if(++visited>12000)return;
     if(ts.isCallExpression(x)){
       if(ts.isIdentifier(x.expression))names.add(x.expression.text);
       else if(ts.isPropertyAccessExpression(x.expression))names.add(x.expression.name.text);
     }
     ts.forEachChild(x,walk);
   };walk(n);return names;
 };
 const results:TaskPathCallsite[]=[];
 const visit=(n:any)=>{
   if(ts.isJsxOpeningElement(n)||ts.isJsxSelfClosingElement(n)){
     for(const attr of n.attributes.properties){
       if(!ts.isJsxAttribute(attr)||!/^on[A-Z]/.test(attr.name.getText(source)))continue;
       const expr=attr.initializer&&ts.isJsxExpression(attr.initializer)?attr.initializer.expression:null;
       if(!expr)continue;
       const direct=invoked(expr);
       const referenced=new Set<string>();
       if(ts.isIdentifier(expr))referenced.add(expr.text);
       if(ts.isPropertyAccessExpression(expr))referenced.add(expr.name.text);
       // onClick={() => handleAdd()} is another common indirection.
       for(const name of direct)referenced.add(name);
       const hits=new Map<string,string|null>();
       for(const target of targetNames)if(direct.has(target)||referenced.has(target))hits.set(target,referenced.has(target)&&handlers.has(target)?target:null);
       for(const via of referenced){
         const fn=handlers.get(via);if(!fn)continue;
         const calls=invoked(fn);
         for(const target of targetNames)if(calls.has(target))hits.set(target,via);
       }
       const pos=source.getLineAndCharacterOfPosition(n.getStart(source));
       for(const [target,handler] of hits)results.push({target,handler,line:pos.line+1,column:pos.character,attributeStart:attr.getStart(source),attributeEnd:attr.getEnd()});
     }
   }
   ts.forEachChild(n,visit);
 };visit(source);
 return [...new Map(results.map(c=>[`${c.attributeStart}|${c.attributeEnd}|${c.target}|${c.handler||''}`,c])).values()].sort((a,b)=>a.line-b.line||a.target.localeCompare(b.target));
}

export function analyzeSource(path:string,text:string,opts?:{forceReactSplit?:boolean;forceApiSplit?:boolean}):Analysis{
 if(!JS_TS.test(path))return {parser:'plain',segments:[],imports:[],importLines:[],exports:[],diagnostics:0,sourceBytes:Buffer.byteLength(text)};
 const mode=/\.tsx$/i.test(path)?ts.ScriptKind.TSX:/\.jsx$/i.test(path)?ts.ScriptKind.JSX:/\.m?[jt]s$/i.test(path)?(/\.js$/i.test(path)?ts.ScriptKind.JS:ts.ScriptKind.TS):ts.ScriptKind.TS;
 const source=ts.createSourceFile(path,text,ts.ScriptTarget.Latest,true,mode);
 const segments:Segment[]=[],imports:string[]=[],importLines:string[]=[],exports:string[]=[];
 for(const n of source.statements){
   if(ts.isImportDeclaration(n)){
     const spec=n.moduleSpecifier?.text;
     if(typeof spec==='string')imports.push(spec);
     importLines.push(n.getText(source));
     continue;
   }
   if(ts.isExportDeclaration(n)){
     const spec=n.moduleSpecifier?.text;
     if(typeof spec==='string')imports.push(spec);
     importLines.push(n.getText(source));
     continue;
   }
   if(ts.isFunctionDeclaration(n)||ts.isClassDeclaration(n)||ts.isInterfaceDeclaration(n)||ts.isEnumDeclaration(n)||ts.isTypeAliasDeclaration(n)||ts.isVariableStatement(n)||ts.isExportAssignment(n)){
     const units=collectReactUnits(n,source,text,opts?.forceReactSplit?0:9000)||(opts?.forceApiSplit?collectObjectApiUnits(n,source,text,0):null)||collectUnits(n,source,text);segments.push(...units);
     const exported=(n.modifiers||[]).some((m:any)=>m.kind===ts.SyntaxKind.ExportKeyword||m.kind===ts.SyntaxKind.DefaultKeyword);
     if(exported)exports.push(...units.map(x=>x.name));
   }
 }
 return {parser:'typescript-ast',segments,imports,importLines,exports,diagnostics:source.parseDiagnostics.length,sourceBytes:Buffer.byteLength(text)};
}
export const parserRegistry=new ParserRegistry();
parserRegistry.register({id:'typescript-ast',quality:'ast',extensions:['.js','.mjs','.cjs','.jsx','.ts','.mts','.cts','.tsx'],analyze:analyzeSource});
for(const [ext,mode] of Object.entries(STRUCTURAL_LANGUAGES)){
 // One adapter per family avoids hidden platform-dependent parser selection.
 parserRegistry.register({id:`structural-${ext.slice(1)}`,quality:'structural',extensions:[ext],analyze:analyzeStructured});
}
export function rankSegments(analysis:Analysis,query:Set<string>,changed:boolean,explicitPath:boolean):Segment[]{
 const q=[...query].map(rootWord).filter(w=>!TASK_STOPWORDS.has(w));
 return analysis.segments.map(s=>{
   const sym=new Set([...queryTerms(s.name.split('.').at(-1)!)].map(rootWord)),sig=new Set([...queryTerms(s.signature)].map(rootWord));
   let score=changed?5:0;
   // A path being mentioned is a file-level hint, not evidence every symbol matters.
   if(explicitPath)score+=8;
   const direct=q.filter(w=>sym.has(w)).length;
   const surface=q.filter(w=>sig.has(w)).length;
   const refs=q.filter(w=>s.refs.some(r=>[...queryTerms(r)].map(rootWord).includes(w))).length;
   score+=direct*32+surface*5+Math.min(refs,8)*3;
   if((s.role==='jsx-action'||s.role==='jsx-expression')&&refs>0)score+=24;
   return {...s,score};
 }).sort((a,b)=>b.score-a.score||a.start-b.start);
}
export type SemanticGrounding='explicit-task-file'|'task-path'|'task-anchor'|'direct-dependency'|'unverified';
export type SemanticDependency={name:string;reason:'provider-wiring'|'local-reference'|'state-update-ui'|'state-update-handler'|'imported-member-call'|'cross-language-call';mode:'full'|'outline'|'omitted';startLine:number;endLine:number;
  /** Deterministic AST evidence, not a claim of runtime dataflow. */
  seed:string;trace:string[];grounding:SemanticGrounding};
export type SmartSnippet={semanticDependencies?:SemanticDependency[];text:string;segments:{name:string;kind:string;mode:'full'|'outline';startLine:number;endLine:number;startOffset:number;endOffset:number;score:number;bytesBefore:number;bytesAfter:number;reason?:string;critical?:boolean}[];includedBytes:number;originalBytes:number;mode:'smart'|'full';parser:string;diagnostics:number};
/** A deterministic, locally-scored extraction with one-hop intra-file symbol closure. */
export function makeSmartSnippet(path:string,text:string,task:string,opts:{budgetBytes:number;minScore:number;alwaysFull:boolean;changed:boolean;explicitPath:boolean;focusSymbols?:string[];callsiteTargets?:string[];semanticTargets?:string[];semanticGrounding?:SemanticGrounding;importedMembers?:Array<{qualifiedName:string;caller:string}>;crossLanguageTargets?:Array<{name:string;caller:string}>;precisionApiOnly?:boolean}):SmartSnippet{
 const originalBytes=Buffer.byteLength(text);
 const adapter=parserRegistry.select(path);
 const capable=!!adapter;
 if(opts.alwaysFull||!capable||originalBytes<500){
   return {text,segments:[],includedBytes:originalBytes,originalBytes,mode:'full',parser:adapter?.id.startsWith('tree-sitter-')?'tree-sitter-wasm':adapter?.quality==='ast'?'typescript-ast':adapter?'structural-lexer':'plain',diagnostics:0};
 }
 const splitForWiring=!!opts.semanticTargets?.length && text.includes('.Provider');
 const analysis=((opts.callsiteTargets?.length||splitForWiring||opts.importedMembers?.length||opts.precisionApiOnly) && JS_TS.test(path))
   ?analyzeSource(path,text,{forceReactSplit:!!(opts.callsiteTargets?.length||splitForWiring),forceApiSplit:!!(opts.importedMembers?.length||opts.precisionApiOnly)})
   :parserRegistry.analyze(path,text);
 if(!analysis.segments.length||analysis.diagnostics>0){return {text,segments:[],includedBytes:originalBytes,originalBytes,mode:'full',parser:analysis.parser,diagnostics:analysis.diagnostics};}
 const terms=taskKeywords(task);
 const ranked=rankSegments(analysis,terms,opts.changed,opts.explicitPath);
 const strong=ranked.filter(s=>s.score>=opts.minScore);
 // If an explicitly requested file has no identifiable symbol match, retain it
 // in full while it fits its budget; all-outline packs hide the work context.
 if(strong.length===0&&(opts.changed||opts.explicitPath)&&originalBytes<=opts.budgetBytes){
   return {text,segments:[],includedBytes:originalBytes,originalBytes,mode:'full',parser:analysis.parser,diagnostics:analysis.diagnostics};
 }
 const focus=new Set((opts.focusSymbols||[]).map(s=>s.toLowerCase()));
 // Component bodies are structural outlines. Prefer action statements under
 // them even when the parent component name matches the task.
 // Exact imported member evidence suppresses lexical promotion of siblings in
 // the target API module; a reference to `db.orders.create` is not `db.*`.
 const precisionMode=!!(opts.importedMembers?.length||opts.precisionApiOnly)&&ranked.some(s=>s.role==='api-member')&&!opts.explicitPath;
 const crossPrecision=!!opts.crossLanguageTargets?.length&&analysis.parser==='tree-sitter-wasm'&&!opts.explicitPath;
 const chosen=new Set<string>((precisionMode||crossPrecision?[]:strong).map(x=>x.name));
 for(const s of ranked){if(focus.has(s.name.toLowerCase())||focus.has(s.name.split('.').at(-1)!.toLowerCase()))chosen.add(s.name);}
 // Protect a small number of actual user-action callsites. Only event handlers
 // that reference a task action (directly or via a local callback) are critical.
 const targetNames=new Set(opts.callsiteTargets||[]);
 const callsiteLinks=discoverJsxTaskCallsites(path,text,targetNames);
 const linkedHandlers=new Set(callsiteLinks.map(c=>c.handler).filter((x):x is string=>!!x));
 const criticalSet=new Set<string>();
 // For each event, prefer the smallest *real* JSX segment containing its AST
 // attribute range. Parent JSX nodes and opening elements need not share the
 // event's exact source line or column, so suffix comparisons are unreliable.
 for(const call of callsiteLinks){
   const containing=ranked.filter(s=>s.role==='jsx-action'&&s.start<=call.attributeStart&&s.end>=call.attributeEnd)
     .sort((a,b)=>(a.end-a.start)-(b.end-b.start)||a.start-b.start);
   if(containing.length){chosen.add(containing[0]!.name);criticalSet.add(containing[0]!.name);}
 }
 for(const s of ranked){
   if(linkedHandlers.has(s.name.split('.').at(-1)!)&&s.role==='callback'){
     chosen.add(s.name);criticalSet.add(s.name);
   }
 }
 // Semantic dependencies are bounded AST-derived evidence, NOT a complete call graph.
 // Include a context Provider's value wiring only when it mentions a task action.
 // Avoid promoting Auth/Wishlist providers just because they share a component.
 const semanticTargets=new Set([...(opts.semanticTargets||[]),...(opts.callsiteTargets||[])].map(x=>x.toLowerCase()));
 const semanticReasons=new Map<string,SemanticDependency['reason']>();
 const semanticTrace=new Map<string,string[]>();
 const grounding=opts.semanticGrounding??'task-anchor';
 // Exact object member identity + source callsite is stronger evidence than a
 // whole imported namespace or coincidental task keyword in a helper's name.
 const verifiedMembers=new Set<string>();
 for(const member of opts.importedMembers||[]){
   const s=ranked.find(s=>s.role==='api-member'&&s.name===member.qualifiedName);
   if(!s)continue;
   chosen.add(s.name);criticalSet.add(s.name);
   verifiedMembers.add(s.name);
   semanticReasons.set(s.name,'imported-member-call');
   semanticTrace.set(s.name,[member.caller,s.name]);
 }
 // Tree-sitter imports get the same exact declaration priority as TS object APIs.
 // A reference must have originated inside a task-grounded AST callable,
 // not from scanning every identifier in the importing source file.
 const crossVerified=new Set<string>();
 for(const target of opts.crossLanguageTargets||[]){
   const s=ranked.find(x=>x.name===target.name&&x.kind==='function');
   if(!s)continue;
   chosen.add(s.name);criticalSet.add(s.name);crossVerified.add(s.name);
   semanticReasons.set(s.name,'cross-language-call');
   semanticTrace.set(s.name,[target.caller,s.name]);
 }
 // Semantic closure requires task evidence. A file merely imported by another
 // module (or an unrelated reverse dependent) is NOT a task-scoped seed.
 const grounded=grounding!=='unverified';
 for(const s of ranked){
   if(grounded && s.role==='jsx-wiring' && s.refs.some(ref=>semanticTargets.has(ref.toLowerCase()))){
     const cause=s.refs.find(ref=>semanticTargets.has(ref.toLowerCase()))!;
     chosen.add(s.name);criticalSet.add(s.name);semanticReasons.set(s.name,'provider-wiring');semanticTrace.set(s.name,[cause,s.name]);
   }
 }
 // Identify symbol declarations, including React state tuple bindings.
 // Only local declarations can participate: unrelated imported helpers are not guessed.
 const localSymbols=new Map<string,Segment>();
 for(const s of ranked){
   if(s.kind==='jsx'||s.kind==='component'||s.role==='render'||s.role==='api-member')continue;
   const local=s.name.split('.').at(-1)||'';
   if(/^[a-zA-Z_$][\w$]*$/.test(local))localSymbols.set(local.toLowerCase(),s);
   else if(s.kind==='variable')for(const name of local.match(/[A-Za-z_$][\w$]*/g)||[])localSymbols.set(name.toLowerCase(),s);
 }
 // A closure can only start from a justified task symbol. Direct dependencies
 // need stronger evidence than a generic term such as 'product' or 'category'.
 // Reverse dependents / multi-hop files may still supply ordinary ranked snippets,
 // but they cannot recursively spend context on their own unrelated state.
 const actionSet=new Set([...semanticTargets]);
 const termMatches=(name:string)=>[...terms].filter(t=>taskKeywords(name).has(t)).length;
 const seed=grounded?ranked.filter(s=>{
   if(precisionMode)return verifiedMembers.has(s.name);
   if(crossPrecision)return crossVerified.has(s.name);
   const localName=s.name.split('.').at(-1)||'';
   // Keep JSX action refs as focused seeds; generic checkout callbacks are
   // evidence for a click but do not justify a closure over all checkout state.
   if(criticalSet.has(s.name) && (s.role==='jsx-action'||s.role==='jsx-wiring'||
       [...actionSet].some(target=>localName.toLowerCase().includes(target))))return true;
   if(s.kind==='jsx'||s.kind==='component')return false;
   const local=s.name.split('.').at(-1)||'';
   if(actionSet.has(local.toLowerCase())||focus.has(s.name.toLowerCase())||focus.has(local.toLowerCase()))return true;
   const matches=termMatches(local);
   if(grounding==='direct-dependency')return s.score>=40&&matches>=2;
   return s.score>=opts.minScore&&matches>=1;
 }):[];
 const queue=seed.slice(0,24).map(s=>({s,depth:0,trace:[s.name]}));
 const visited=new Set<string>();
 let promoted=0;
 while(queue.length&&promoted<30){
   const current=queue.shift()!;
   if(visited.has(current.s.name))continue;
   visited.add(current.s.name);
   if(current.depth>=3)continue;
   let neighbors=0;
   for(const ref of current.s.refs){
     const dep=localSymbols.get(ref.toLowerCase());
     if(!dep||dep.name===current.s.name||visited.has(dep.name))continue;
     if(neighbors++>=10||promoted>=30)break;
     const trace=[...current.trace,dep.name];
     if(!chosen.has(dep.name)){
       chosen.add(dep.name);semanticReasons.set(dep.name,'local-reference');
       semanticTrace.set(dep.name,trace);promoted++;
     }
     queue.push({s:dep,depth:current.depth+1,trace});
   }
 }
 // When a protected UI action consumes local React state, retain a small number
 // of JSX writers of that state (e.g. a variation selector), not every button.
 const setters=new Set<string>();
 const setterSources=new Map<string,{seed:string;state:string}>();
 for(const s of grounded?ranked:[]){
   if(s.kind!=='variable'||!/^.*\.[[(]/.test(s.name))continue;
   const statePairs=s.name.match(/\[([^\]]+)\]/g)||[];
   for(const pair of statePairs){
     const names=pair.slice(1,-1).split(',').map(x=>x.trim());
     if(names.length<2)continue;
     const first=names[0]!,setter=names[1]!;
     if(!/^set[A-Z]/.test(setter))continue;
     const consumer=seed.find(x=>criticalSet.has(x.name)&&x.refs.includes(first));
     if(consumer){setters.add(setter);setterSources.set(setter,{seed:consumer.name,state:s.name});}
   }
 }
 const stateWriterHandlers=new Map<string,Segment>();
 for(const s of ranked){
   if(s.role!=='callback'||!s.refs.some(x=>setters.has(x)))continue;
   const short=s.name.split('.').at(-1)!;
   stateWriterHandlers.set(short,s);
 }
 let writers=0;
 for(const s of ranked.filter(x=>x.role==='jsx-action').sort((a,b)=>a.start-b.start)){
   if(writers>=5)break;
   if(criticalSet.has(s.name))continue;
   const related=s.refs.some(x=>setters.has(x)||stateWriterHandlers.has(x));
   if(related){
     const writingSetter=[...setters].find(setter=>s.refs.includes(setter)||
       s.refs.some(ref=>stateWriterHandlers.get(ref)?.refs.includes(setter)));
     const origin=writingSetter?setterSources.get(writingSetter):undefined;
     chosen.add(s.name);criticalSet.add(s.name);semanticReasons.set(s.name,'state-update-ui');
     semanticTrace.set(s.name,origin?[origin.seed,origin.state,s.name]:[s.name]);writers++;
     for(const ref of s.refs){
       const handler=stateWriterHandlers.get(ref);
       if(handler){chosen.add(handler.name);criticalSet.add(handler.name);semanticReasons.set(handler.name,'state-update-handler');semanticTrace.set(handler.name,[s.name,handler.name]);}
     }
   }
 }
 // One-hop supporting refs must also be attached to a grounded seed.
 // Otherwise this bypasses task gating and promotes generic file-local state.
 for(const s of seed){for(const ref of s.refs){
   const dep=localSymbols.get(ref.toLowerCase());
   if(dep&&dep.name!==s.name){chosen.add(dep.name);
     if(!semanticReasons.has(dep.name)&&dep.score<opts.minScore){
       semanticReasons.set(dep.name,'local-reference');semanticTrace.set(dep.name,[s.name,dep.name]);
     }
   }
 }}
 // Preserve complete import declarations, never truncate halfway through `from`.
 // A Router can have dozens of irrelevant routes: prioritize imports used by
 // task-relevant AST symbols and specific module-name hits before other imports.
 const selectedRefs=new Set(ranked.filter(x=>chosen.has(x.name)).flatMap(s=>s.refs.map(r=>r.toLowerCase())));
 const taskWords=taskKeywords(task);
 const prioritizedImports=analysis.importLines.map((text,index)=>{
   const spec=text.match(/(?:from\s*|import\s*)['"]([^'"]+)['"]/)?.[1]||'';
   const basename=spec.split('/').at(-1)||'';
   const matches=[...taskWords].filter(x=>taskKeywords(basename).has(x)).length;
   const importedIdentifiers=queryTerms(text.split(/\sfrom\s/)[0]||'');
   const used=[...importedIdentifiers].some(ref=>selectedRefs.has(ref));
   return {text,index,score:matches*10+(used?5:0)};
 }).sort((a,b)=>b.score-a.score||a.index-b.index);
 const importBudget=1500;
 let importBytes=0;const importLines:string[]=[];
 for(const entry of prioritizedImports){
   const size=Buffer.byteLength(entry.text+'\n');
   if(importBytes+size>importBudget)continue;
   importLines.push(entry.text);importBytes+=size;
 }
 const omittedImports=analysis.importLines.length-importLines.length;
 const top=analysis.importLines.length?`// Selected complete imports from original file (${omittedImports} omitted):\n${importLines.join('\n')}\n`:'';
 let used=Buffer.byteLength(top);const items:SmartSnippet['segments']=[];const out:string[]=[top];
 // Prioritize relevant symbols for budget, then include outlines only when capacity permits.
 const order=[...ranked].sort((a,b)=>Number(criticalSet.has(b.name))-Number(criticalSet.has(a.name))||Number(chosen.has(b.name))-Number(chosen.has(a.name))||b.score-a.score||a.start-b.start);
 const consumed=new Set<string>();
 // An outline for every tiny unrelated function can exceed the size of the
 // original source. Bound non-relevant outlines and report all omissions.
 const MAX_IRRELEVANT_OUTLINES=12;let irrelevantOutlines=0;
 // Limit repeated JSX actions/expressions: large navigation/layout components
 // can otherwise allocate most of the pack to generic buttons and footer links.
 // Highest-scored JSX survives first because `order` is relevance-sorted.
 const MAX_FOCUSED_JSX=18;const MAX_CRITICAL_JSX=12;let selectedJsx=0,criticalJsx=0;
 for(const s of order){
   if(consumed.has(s.name))continue;consumed.add(s.name);
   if(((precisionMode&&s.role==='api-member')||(crossPrecision&&s.kind==='function'))&&!chosen.has(s.name)){
     items.push({name:s.name,kind:s.kind,mode:'outline',startLine:s.startLine,endLine:s.endLine,
       startOffset:s.start,endOffset:s.end,score:s.score,bytesBefore:Buffer.byteLength(s.body),
       bytesAfter:0,reason:crossPrecision?'non-target-cross-language-function':'non-target-api-member'});
     continue;
   }
   const critical=criticalSet.has(s.name) && (s.role!=='jsx-action'||criticalJsx<MAX_CRITICAL_JSX);
   const preferredFull=chosen.has(s.name);
   if((s.role==='jsx-action'||s.role==='jsx-expression'||s.role==='jsx-wiring')&&preferredFull&&!critical&&selectedJsx>=MAX_FOCUSED_JSX){
     items.push({name:s.name,kind:s.kind,mode:'outline',startLine:s.startLine,endLine:s.endLine,startOffset:s.start,endOffset:s.end,score:s.score,bytesBefore:Buffer.byteLength(s.body),bytesAfter:0,reason:'jsx-focus-cap',...(criticalSet.has(s.name)?{critical:true}:{})});
     continue;
   }
   if(!preferredFull&&irrelevantOutlines>=MAX_IRRELEVANT_OUTLINES){
     items.push({name:s.name,kind:s.kind,mode:'outline',startLine:s.startLine,endLine:s.endLine,startOffset:s.start,endOffset:s.end,score:s.score,bytesBefore:Buffer.byteLength(s.body),bytesAfter:0,reason:'nonrelevant-outline-cap',...(criticalSet.has(s.name)?{critical:true}:{})});
     continue;
   }
   const wrap=(body:string,full:boolean,reason?:string)=>`// ${path}:${s.startLine}-${s.endLine} ${full?'FULL':'OUTLINE'} ${s.name}${reason?' [body omitted: '+reason+']':''}\n${body}\n`;
   let full=preferredFull;
   let display=wrap(full?s.body:s.signature,full);
   let size=Buffer.byteLength(display);
   let reason:string|undefined;
   if(s.role==='component'||s.role==='render'||s.role==='api-container'){full=false;reason='split-container';display=wrap(s.signature,false,reason);size=Buffer.byteLength(display);}
   if(used+size>opts.budgetBytes&&full){
     full=false;reason='per-file-budget';display=wrap(s.signature,false,reason);size=Buffer.byteLength(display);
   }
   if(used+size>opts.budgetBytes){
     items.push({name:s.name,kind:s.kind,mode:'outline',startLine:s.startLine,endLine:s.endLine,startOffset:s.start,endOffset:s.end,score:s.score,bytesBefore:Buffer.byteLength(s.body),bytesAfter:0,reason:'omitted-entirely-per-file-budget',...(criticalSet.has(s.name)?{critical:true}:{})});
     continue;
   }
   out.push(display);used+=size;
   if(preferredFull&&full&&(s.role==='jsx-action'||s.role==='jsx-expression'||s.role==='jsx-wiring')){if(critical)criticalJsx++;else selectedJsx++;}
   if(!preferredFull)irrelevantOutlines++;
   items.push({name:s.name,kind:s.kind,mode:full?'full':'outline',startLine:s.startLine,endLine:s.endLine,startOffset:s.start,endOffset:s.end,score:s.score,bytesBefore:Buffer.byteLength(s.body),bytesAfter:size,reason,...(criticalSet.has(s.name)?{critical:true}:{})});
 }
 // If nothing fits, caller can skip instead of disguising a truncated function as valid code.
 if(!items.some(x=>x.bytesAfter>0))return {text,segments:[],includedBytes:originalBytes,originalBytes,mode:'full',parser:analysis.parser,diagnostics:analysis.diagnostics};
 const content=out.filter(Boolean).join('\n');
 const semanticDependencies:SemanticDependency[]=[...semanticReasons].map(([name,reason])=>{
   const segment=items.find(x=>x.name===name)!;
   return {name,reason,mode:segment?.mode==='full'?'full':segment?.bytesAfter>0?'outline':'omitted',startLine:segment?.startLine||0,endLine:segment?.endLine||0,seed:(semanticTrace.get(name)||[name])[0]!,trace:semanticTrace.get(name)||[name],grounding};
 });
 return {text:content,semanticDependencies,segments:items,includedBytes:Buffer.byteLength(content),originalBytes,mode:'smart',parser:analysis.parser,diagnostics:analysis.diagnostics};
}

/** Conservative heuristic for LLM budget; not an exact provider tokenizer. */
export function tokenEstimate(text:string):number{
 // Multilingual and source-code content should not use the misleading 4-char rule.
 // A 2 UTF-8-byte/token planning rate keeps greater headroom for Hebrew/code.
 return Math.ceil(Buffer.byteLength(text)/2);
}
/** Exact language lexer token count, NOT an LLM model token count. */
export function exactSyntaxTokens(path:string,text:string):number|null{
 if(!JS_TS.test(path))return null;
 const scanner=ts.createScanner(ts.ScriptTarget.Latest,true,/\.tsx$/i.test(path)?ts.LanguageVariant.JSX:ts.LanguageVariant.Standard,text);
 let count=0;while(scanner.scan()!==ts.SyntaxKind.EndOfFileToken)count++;
 return count;
}
