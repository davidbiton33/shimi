/** Conservative, bounded receiver identity evidence for non-JS call graphs.
 * This is *not* a type checker or arbitrary alias analysis. It requires exactly
 * one syntactic constructor binding before the call in the same callable and
 * rejects reassigned receivers, conflicting constructors and ambiguous types.
 * Strings and comments are masked before examining variable declarations.
 */
import { maskSource } from './structural.js';
import type { BoundImport } from './symbols.js';

const identifier=(value:string)=>/^[A-Za-z_$][\w$]*$/.test(value);
const escaped=(value:string)=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
export type ReceiverProof={kind:'constructed-local'|'namespace-import'|'constructor-injected-field'|'registered-interface-injection'|'compose-viewmodel-binding';type:string};

/** Static receiver for direct calls to imported *module functions* (not methods). */
export function resolveModuleReceiver(receiver:string, fileSpecifier:string, imports:BoundImport[]):ReceiverProof|null {
 if(!identifier(receiver))return null;
 const basename=fileSpecifier.split(/[/.]/).filter(Boolean).at(-1);
 const names=new Set<string>([
  ...(basename?[basename]:[]),
  ...imports.filter(x=>x.specifier===fileSpecifier&&x.kind==='namespace').map(x=>x.local),
 ]);
 return names.has(receiver)?{kind:'namespace-import',type:receiver}:null;
}

/** Return evidence ONLY if receiver is bound to an instance of a target type.
 * Source is a single, AST-extracted function body and not arbitrary project text.
 */
export function resolveConstructedReceiver(
 path:string, callableBody:string, receiver:string, targetType:string, imports:BoundImport[], specifier:string, member?:string,
):ReceiverProof|null {
 if(!identifier(receiver)||!identifier(targetType)||callableBody.length>120_000)return null;
 const clean=maskSource(callableBody,path);
 if(clean.diagnostics)return null;
 const code=clean.masked;
 const compatible=new Set([targetType]);
 for(const item of imports){
  if(item.specifier===specifier && item.kind==='named' && item.imported===targetType)compatible.add(item.local);
 }
 const candidates:Array<{type:string;index:number}>=[];
 const local=escaped(receiver);
 // Do not claim a binding if an unrelated variable with this name is reassigned.
 // Every accepted form must include a complete constructor invocation or struct literal.
 const forms:RegExp[]=[
  // Java/C#/Dart typed instance and C#/Dart var/final/late local instances.
  new RegExp(`\\b(?:[A-Za-z_$][\\w$<>?.]*|var|final|late|const)\\s+${local}\\s*=\\s*new\\s+([A-Za-z_$][\\w$]*)\\s*\\(`,'g'),
  new RegExp(`\\b(?:var|final|late|const|val|let|mutable|immutable)\\s+${local}\\s*=\\s*([A-Za-z_$][\\w$]*)\\s*\\(`,'g'),
  // Python's assignment and Dart's untyped local. A declaration form is
  // preferred above; both matching the SAME constructor are not ambiguity.
  new RegExp(`(?:^|[;\\n\\r{])\\s*${local}\\s*=\\s*([A-Za-z_$][\\w$]*)\\s*\\(`,'g'),
  // Rust named struct constructor local binding.
  new RegExp(`\\b(?:let(?:\\s+mut)?|const)\\s+${local}(?:\\s*:\\s*[A-Za-z_$][\\w$]*)?\\s*=\\s*([A-Za-z_$][\\w$]*)\\s*\\{`,'g'),
  // Go package-qualified struct value, e.g. service := pricing.Service{}.
  new RegExp(`\\b${local}\\s*:=\\s*(?:[A-Za-z_$][\\w$]*\\s*\\.\\s*)?([A-Za-z_$][\\w$]*)\\s*\\{`,'g'),
 ];
 for(const pattern of forms)for(const match of code.matchAll(pattern)){
  const ctor=match[1]!;
  if(!compatible.has(ctor))return null; // conflicting known construction
  candidates.push({type:ctor,index:match.index!});
 }
 if(!candidates.length)return null;
 if(member && identifier(member)){
  const callsite=new RegExp(`\\b${escaped(receiver)}\\s*(?:\\.|->)\\s*${escaped(member)}\\s*\\(`).exec(code);
  if(!callsite || candidates.some(x=>x.index>=callsite.index))return null;
 }
 // Prevent claiming stable type when the same variable is reassigned later.
 const mutations=[
   new RegExp(`\\b${local}\\s*(?:=|\\+=|-=|\\*=|\\/=|\\?=|:=)`,'g'),
 ];
 const occurrences=[...code.matchAll(mutations[0]!)];
 if(occurrences.length!==1)return null;
 // A constructor must be seen before the call and cannot appear solely in a
 // conditional-looking decoy string/comment (those are masked above).
 return {kind:'constructed-local',type:targetType};
}

/**
 * Limited framework constructor-injection evidence (Spring / ASP.NET).
 * A controller field is statically bound only when its declared concrete type
 * matches the resolved implementation AND a unique constructor parameter of
 * that same concrete type is explicitly assigned to the field. Interfaces,
 * IoC registrations and dynamic dispatch are intentionally NOT inferred.
 */
export function resolveInjectedReceiver(
 path:string, classSource:string, receiver:string, targetType:string,
 methodName:string,
):ReceiverProof|null{
 if(!/\.(?:java|cs)$/i.test(path)||!identifier(receiver)||!identifier(targetType)||!identifier(methodName)||classSource.length>120_000)return null;
 const parsed=maskSource(classSource,path);if(parsed.diagnostics)return null;
 const code=parsed.masked;
 const escape=escaped;
 // Check that the method invocation occurs in the selected AST caller;
 // this function must never establish a callsite on text search alone.
 // All source offsets remain inside a single class declaration.
 const klass=code.match(/\bclass\s+([A-Za-z_$][\w$]*)/);
 if(!klass)return null;
 const className=klass[1]!;
 const fieldNames=new Set<string>();
 const fieldPattern=new RegExp(`\\b${escape(targetType)}\\s+([A-Za-z_$][\\w$]*)\\s*;`,'g');
 for(const m of code.matchAll(fieldPattern))fieldNames.add(m[1]!);
 if(!fieldNames.has(receiver))return null;
 const constructorPattern=new RegExp(`\\b${escape(className)}\\s*\\(([^)]{0,1000})\\)\\s*(?::[^\\{]{0,300})?\\{`,'g');
 const constructors=[...code.matchAll(constructorPattern)];
 if(constructors.length!==1)return null;
 const ctor=constructors[0]!,open=ctor.index!+ctor[0].length-1;
 let depth=0,end=-1;
 for(let i=open;i<code.length&&i<open+12000;i++){
  if(code[i]==='{')depth++;else if(code[i]==='}'&&--depth===0){end=i;break;}
 }
 if(end<0)return null;
 const params=ctor[1]!.split(',').map(p=>p.trim());
 const candidates=params.map(p=>p.match(new RegExp(`\\b${escape(targetType)}\\s+([A-Za-z_$][\\w$]*)\\s*$`))).filter((x):x is RegExpMatchArray=>!!x);
 if(candidates.length!==1)return null;
 const param=candidates[0]![1]!;
 const body=code.slice(open,end+1);
 const assigned=new RegExp(`\\b(?:this\\s*\\.\\s*)?${escape(receiver)}\\s*=\\s*${escape(param)}\\s*;`,'g');
 const assignments=[...body.matchAll(assigned)];if(assignments.length!==1)return null;
 const relevant=[...code.matchAll(new RegExp(`\\b(?:this\\s*\\.\\s*)?${escape(receiver)}\\s*(?:\\.|->)\\s*${escape(methodName)}\\s*\\(`,'g'))];
 if(!relevant.length)return null;
 // Reject a later reassignment of the field (we do not prove mutable DI).
 const writes=[...code.matchAll(new RegExp(`\\b(?:this\\s*\\.\\s*)?${escape(receiver)}\\s*=(?!=)`,'g'))];
 if(writes.length!==1)return null;
 return {kind:'constructor-injected-field',type:targetType};
}
