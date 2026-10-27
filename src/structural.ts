/**
 * Conservative multi-language structural parser. NOT a compiler AST.
 * It only extracts a declaration when the lexer can bound its complete body.
 * No source execution, native modules or external npm dependencies.
 */
import { extname } from 'node:path';
import type { Analysis, Segment } from './smart.js';

export type StructuralMode='python-indent'|'braced'|'ruby-end';
export const STRUCTURAL_LANGUAGES:Readonly<Record<string,StructuralMode>>={
 '.py':'python-indent','.pyi':'python-indent',
 '.go':'braced','.java':'braced','.cs':'braced','.rs':'braced','.php':'braced',
 '.kt':'braced','.kts':'braced','.dart':'braced',
 '.c':'braced','.h':'braced','.cc':'braced','.cpp':'braced','.cxx':'braced','.hpp':'braced','.hxx':'braced',
 '.rb':'ruby-end'
};
const ident=/[\p{L}_][\p{L}\p{N}_]*/gu;
export function supportsStructure(path:string){return STRUCTURAL_LANGUAGES[extname(path).toLowerCase()]!==undefined;}
function refs(text:string):string[]{return [...new Set([...text.matchAll(ident)].map(m=>m[0]).filter(w=>w.length>2))].sort();}
function ln(starts:number[],offset:number):number{
 let lo=0,hi=starts.length;
 while(lo<hi){const mid=(lo+hi)>>>1;if(starts[mid]<=offset)lo=mid+1;else hi=mid;}
 return lo;
}
/** Mask strings and comments while preserving UTF-16 positions/newlines.
 * Handles slash-style comments, hash comments, and Python triple quotes. Does not
 * attempt interpolated-string evaluation or macro expansion.
 */
export function maskSource(source:string,path:string):{masked:string;diagnostics:number}{
 const ext=extname(path).toLowerCase(),python=ext==='.py'||ext==='.pyi',ruby=ext==='.rb',hash=python||ruby||ext==='.php';
 const chars=source.split('');let state:'plain'|'line'|'block'|'quote'|'triple'='plain';let quote='',escape=false,errors=0;
 const wipe=(p:number)=>{if(chars[p]!=='\n'&&chars[p]!=='\r')chars[p]=' ';};
 for(let i=0;i<source.length;i++){
  const a=source[i],b=source[i+1],c=source[i+2];
  if(state==='line') {if(a==='\n')state='plain';else wipe(i);continue;}
  if(state==='block') {if(a==='*'&&b==='/'){wipe(i);wipe(i+1);i++;state='plain';}else wipe(i);continue;}
  if(state==='triple') {
   if(a===quote && b===quote && c===quote){wipe(i);wipe(i+1);wipe(i+2);i+=2;state='plain';}
   else wipe(i);
   continue;
  }
  if(state==='quote'){
   if(escape){escape=false;wipe(i);continue;}
   if(a==='\\'){escape=true;wipe(i);continue;}
   if(a===quote){wipe(i);state='plain';continue;}
   // In most languages ordinary quotes cannot span lines.
   if(a==='\n'&&quote!=='`'){errors++;state='plain';continue;}
   wipe(i);continue;
  }
  if((!python&&!ruby)&&a==='/'&&b==='/'){wipe(i);wipe(i+1);i++;state='line';continue;}
  if((!python&&!ruby)&&a==='/'&&b==='*'){wipe(i);wipe(i+1);i++;state='block';continue;}
  if(hash&&a==='#'){wipe(i);state='line';continue;}
  if((a==='"'||a==="'"||a==='`')){
   if(python && (a==='"'||a==="'") && b===a&&c===a){state='triple';quote=a;wipe(i);wipe(i+1);wipe(i+2);i+=2;continue;}
   state='quote';quote=a;wipe(i);continue;
  }
 }
 if(state==='block'||state==='triple'||state==='quote')errors++;
 return {masked:chars.join(''),diagnostics:errors};
}
function bracePairs(masked:string):{pairs:Map<number,number>;errors:number}{
 const stack:number[]=[],pairs=new Map<number,number>();let errors=0;
 for(let i=0;i<masked.length;i++){
  const ch=masked[i];if(ch==='{')stack.push(i);
  else if(ch==='}'){
   const start=stack.pop();if(start===undefined){errors++;continue;}
   pairs.set(start,i);
  }
 }
 // Don't refuse all source when it is only an unfinished function being edited.
 errors+=stack.length;
 return {pairs,errors};
}
function languagePattern(path:string):RegExp{
 const ext=extname(path).toLowerCase();
 if(ext==='.go')return /^\s*(?:(?:func\s+(?:\([^\n)]*\)\s*)?([\w]+))|(?:type\s+([\w]+)\s+(?:struct|interface)))(?=\b|\()/;
 if(ext==='.rs')return /^\s*(?:(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?(?:unsafe\s+)?(?:fn|struct|enum|trait|impl|mod)\s+([\w]+))/;
 if(ext==='.kt'||ext==='.kts')return /^\s*(?:(?:public|private|internal|protected|open|data|suspend|override|inline|abstract|final|sealed|enum)\s+)*(?:fun\s+(?:(?:[\w<>?.]+\.)?([\w]+))|(?:class|interface|object)\s+([\w]+))/;
 if(ext==='.php')return /^\s*(?:(?:public|private|protected|static|abstract|final|readonly)\s+)*(?:function\s+&?\s*([\w]+)|(?:class|trait|interface|enum)\s+([\w]+))/;
 if(ext==='.c'||ext==='.h'||['.cc','.cpp','.cxx','.hpp','.hxx'].includes(ext))
  return /^\s*(?:(?:class|struct|enum|namespace)\s+([\w]+)|(?:[\w:*&<>~]+\s+)+([\w:~]+)\s*\()/;
 if(ext==='.dart')return /^\s*(?:(?:abstract|final|sealed|base|interface|mixin|static|external)\s+)*(?:(?:class|mixin|enum|extension)\s+([\w]+)|(?:[\w<>?]+\s+)+([\w]+)\s*\()/;
 // Java / C#: declarations or methods with return type; exclude if/for/while/switch.
 return /^\s*(?:(?:@\w+(?:\([^)]*\))?\s*)?(?:(?:public|private|protected|internal|abstract|static|sealed|final|partial|async|virtual|override|new|readonly|record|synchronized)\s+)*)(?:(?:class|interface|enum|struct|record)\s+([\w]+)|(?:[\w.<>?,\[\]]+\s+)+([\w]+)\s*\()/;
}
function createSegment(path:string,source:string,masked:string,starts:number[],start:number,end:number,name:string,kind:string,open:number):Segment{
 const signature=source.slice(start,Math.min(open+1,end)).trim().slice(0,420).replace(/\s+$/,'')+' /* body omitted */';
 return {name,kind,start,end,startLine:ln(starts,start),endLine:ln(starts,Math.max(start,end-1)),signature,body:source.slice(start,end),refs:refs(masked.slice(open,end)),score:0};
}
function parsePython(path:string,source:string,masked:string,starts:number[]):Segment[]{
 const lines=source.split('\n'),masks=masked.split('\n');const result:Segment[]=[];
 const offsets:number[]=[];let pos=0;for(const s of lines){offsets.push(pos);pos+=s.length+1;}
 const ind=(s:string)=>{const m=s.match(/^[ \t]*/)?.[0]||'';return [...m].reduce((n,c)=>n+(c==='\t'?8:1),0);};
 for(let i=0;i<lines.length;i++){
  const m=masks[i].match(/^([ \t]*)(async\s+def|def|class)\s+([A-Za-z_]\w*)\s*(?:\(|\:)/);
  if(!m)continue;
  const indent=ind(m[1]);let colon=-1,headerEnd=i;
  // Def signatures may span multiple lines. Find the final ':' at paren-depth zero.
  let depth=0;
  for(let j=i;j<Math.min(lines.length,i+18);j++){
   for(let k=0;k<masks[j].length;k++){
    const c=masks[j][k];if(c==='('||c==='[')depth++;if(c===')'||c===']')depth--;
    if(c===':' && depth===0)colon=k;
   }
   if(colon>=0){headerEnd=j;break;}
  }
  if(colon<0)continue;
  let end=lines.length;
  for(let j=headerEnd+1;j<lines.length;j++){
   if(!masks[j].trim())continue;
   if(ind(lines[j])<=indent){end=j;break;}
  }
  const start=offsets[i],finish=end<lines.length?offsets[end]:source.length;
  if(finish<=start)continue;
  const open=offsets[headerEnd]+colon;
  const kind=m[2]==='class'?'class':'function';
  const name=m[3];
  const signature=source.slice(start,Math.min(open+1,finish)).trim().slice(0,420)+' # body omitted';
  const seg:Segment={name,kind,start,end:finish,startLine:i+1,endLine:ln(starts,Math.max(start,finish-1)),signature,body:source.slice(start,finish),refs:refs(masked.slice(open,finish)),score:0};
  result.push(seg);
 }
 return filterAndNest(result);
}
/** Ruby's `end` matches many other constructs; we only outline simple flat defs.
 * Complex constructs deliberately fall back to uncompressed file mode.
 */
function parseRuby(_path:string,source:string,masked:string,starts:number[]):Segment[]{
 const lines=masked.split('\n'),offsets:number[]=[];let p=0;for(const ln of source.split('\n')){offsets.push(p);p+=ln.length+1;}
 const stack:{kind:string;start:number;name:string;depth:number}[]=[];const result:Segment[]=[];
 for(let i=0;i<lines.length;i++){
  const s=lines[i].trim();
  if(/^(?:def|class|module)\s+/.test(s)){
   const match=s.match(/^(def|class|module)\s+([\w!?]+)/);
   if(match)stack.push({kind:match[1],name:match[2],start:offsets[i],depth:0});
  } else if(/^(?:if|unless|case|begin|while|until|for|do)\b/.test(s)){
   // Nested Ruby syntax requires the complete grammar. Don't take risks.
   if(stack.length)stack[stack.length-1].depth++;
  } else if(/^end\b/.test(s)&&stack.length){
   const current=stack[stack.length-1];if(current.depth>0){current.depth--;continue;}
   stack.pop();const end=Math.min(source.length,offsets[i]+source.split('\n')[i].length);
   if(!stack.length&&end>current.start){
    const header=source.slice(current.start,source.indexOf('\n',current.start)===-1?end:source.indexOf('\n',current.start));
    result.push({name:current.name,kind:current.kind==='def'?'function':'class',start:current.start,end,startLine:ln(starts,current.start),endLine:i+1,signature:header.trim()+' # body omitted',body:source.slice(current.start,end),refs:refs(masked.slice(current.start,end)),score:0});
   }
  }
 }
 return stack.length?[]:result;
}
function filterAndNest(items:Segment[]):Segment[]{
 const sorted=[...items].sort((a,b)=>a.start-b.start||b.end-a.end);
 const chosen:Segment[]=[];
 for(const s of sorted){
  const covers=chosen.filter(p=>p.start<=s.start&&p.end>=s.end);
  const nearest=covers.at(-1);
  if(nearest){if(nearest.kind!=='class')continue;s.name=nearest.name+'.'+s.name;}
  chosen.push(s);
 }
 return chosen.map(s=>s.kind==='class'&&chosen.some(child=>child!==s&&child.start>s.start&&child.end<=s.end)?{...s,body:s.signature,refs:[]}:s);
}
function parseBraced(path:string,source:string,masked:string,starts:number[]):{segments:Segment[];diagnostics:number}{
 const pairs=bracePairs(masked),re=languagePattern(path),result:Segment[]=[];
 let cursor=0;
 for(const row of masked.split('\n')){
  const m=re.exec(row);
  if(m){
   const name=m[1]||m[2];if(!name){cursor+=row.length+1;continue;}
   const start=cursor+row.indexOf(m[0].trimStart());
   // A body opening must be within a short, bounded declaration header. For a
   // method declaration, braces must be after the full parameter list.
   let open=-1,paren=0;
   const cap=Math.min(masked.length,cursor+row.length+1500);
   for(let p=start;p<cap;p++){
    const c=masked[p];if(c==='(')paren++;else if(c===')')paren--;
    else if(c===';'&&paren===0)break;
    else if(c==='{'&&paren===0){open=p;break;}
   }
   if(open>=0&&pairs.pairs.has(open)){
    const end=pairs.pairs.get(open)!+1;
    const kind=/\b(class|struct|interface|trait|enum|record|object|module|impl|namespace|mixin|extension)\b/.test(masked.slice(start,open))?'class':'function';
    result.push(createSegment(path,source,masked,starts,start,end,name,kind,open));
   }
  }
  cursor+=row.length+1;
 }
 return {segments:filterAndNest(result),diagnostics:pairs.errors};
}
export function analyzeStructured(path:string,source:string):Analysis{
 const mode=STRUCTURAL_LANGUAGES[extname(path).toLowerCase()];
 const empty:Analysis={parser:'plain',segments:[],imports:[],importLines:[],exports:[],diagnostics:0,sourceBytes:Buffer.byteLength(source)};
 if(!mode)return empty;
 const maskedResult=maskSource(source,path),starts=[0];for(let i=0;i<source.length;i++)if(source[i]==='\n')starts.push(i+1);
 const parsed=mode==='python-indent'?{segments:parsePython(path,source,maskedResult.masked,starts),diagnostics:0}:
  mode==='ruby-end'?{segments:parseRuby(path,source,maskedResult.masked,starts),diagnostics:0}:parseBraced(path,source,maskedResult.masked,starts);
 return {...empty,parser:'structural-lexer',segments:parsed.segments,diagnostics:maskedResult.diagnostics+parsed.diagnostics};
}
