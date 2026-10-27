/** Universal Parser Registry — adapters can be added without changing packer. */
import { extname } from 'node:path';
import type { Analysis } from './smart.js';
export type Quality='ast'|'structural';
export type ParserAdapter={id:string;quality:Quality;extensions:readonly string[];analyze:(path:string,source:string)=>Analysis};
export class ParserRegistry{
 private readonly byExtension=new Map<string,ParserAdapter>();
 private readonly all=new Map<string,ParserAdapter>();
 register(adapter:ParserAdapter,options:{replace?:boolean}={}):void{
  if(!/^[\w.-]+$/.test(adapter.id)||!adapter.extensions.length)throw new Error('Invalid parser ID/extensions');
  for(const ext of adapter.extensions){
   if(!/^\.[a-z0-9]+$/.test(ext))throw new Error('Parser extension must be lowercase, like .py');
   if(this.byExtension.has(ext)&&!options.replace)throw new Error(`Parser already registered for ${ext}`);
  }
  if(options.replace){for(const ext of adapter.extensions){const previous=this.byExtension.get(ext);if(previous)this.all.delete(previous.id);}}
  for(const ext of adapter.extensions)this.byExtension.set(ext,adapter);
  this.all.set(adapter.id,adapter);
 }
 select(path:string):ParserAdapter|undefined{return this.byExtension.get(extname(path).toLowerCase());}
 analyze(path:string,source:string):Analysis{
  const adapter=this.select(path);
  return adapter?adapter.analyze(path,source):{parser:'plain',segments:[],imports:[],importLines:[],exports:[],diagnostics:0,sourceBytes:Buffer.byteLength(source)};
 }
 describe():Array<{id:string;quality:Quality;extensions:string[]}>{
  const adapters=new Map<string,{id:string;quality:Quality;extensions:string[]}>();
  for(const [ext,a] of this.byExtension){const current=adapters.get(a.id)||{id:a.id,quality:a.quality,extensions:[]};current.extensions.push(ext);adapters.set(a.id,current);}
  return [...adapters.values()].map(a=>({...a,extensions:a.extensions.sort()})).sort((a,b)=>a.id.localeCompare(b.id));
 }
}
