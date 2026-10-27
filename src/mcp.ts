/** Local MCP server over newline-delimited JSON-RPC 2.0 stdio. No socket, network or AI calls. */
import {createInterface} from 'node:readline';
import {readFileSync} from 'node:fs';
import {readText,pathFor} from './utils.js';
import {status,handoff} from './commands.js';
import {requestContext,readySubtasks,blockedSubtasks} from './context-requests.js';
import {listNotes,captureNote,sessionTimeline} from './session-notes.js';
import {addMemory,searchMemories,listMemories} from './memory.js';
import {tryEvidenceStatus} from './evidence.js';
import {verifiedResume,conflictRadar,stallStatus} from './guardrails.js';
import {work} from './orchestrator.js';

const tools=[
 {name:'agentos_work',description:'Agent-controlled ordinary workflow bootstrap. Start/reuse a project session, ensure watcher, return ready tasks and existing evidence. Safe: never runs tests, never initiates an agent transfer.',inputSchema:{type:'object',properties:{},additionalProperties:false}},
 {name:'agentos_verified_resume',description:'Inspect recorded test evidence freshness and Git state without running any checks; never call a past passing check proof of current correctness.',inputSchema:{type:'object',properties:{},additionalProperties:false}},
 {name:'agentos_guard_status',description:'Read acceptance checks declared in .agentos-evidence.json and whether recorded check results still cover declared file inputs; no tests executed.',inputSchema:{type:'object',properties:{},additionalProperties:false}},
 {name:'agentos_conflict_radar',description:'Compare two local Git revisions against an explicit base. Reports changed file overlap and stale static dependency hints, not semantic correctness.',inputSchema:{type:'object',properties:{base:{type:'string'},left:{type:'string'},right:{type:'string'}},required:['base','left','right'],additionalProperties:false}},
 {name:'agentos_stall_status',description:'Flag repeated identical failure signatures from AgentOS-executed checks; does not see other agent tool activity.',inputSchema:{type:'object',properties:{},additionalProperties:false}},
 {name:'agentos_status',description:'Read the project Session, Watcher and checkpoint state',inputSchema:{type:'object',properties:{},additionalProperties:false}},
 {name:'agentos_handoff',description:'Read a portable handoff. Verify claims against Git before editing.',inputSchema:{type:'object',properties:{},additionalProperties:false}},
 {name:'agentos_context',description:'Request real source snippets by file, symbol or query. Graph edges are static hints.',inputSchema:{type:'object',properties:{symbol:{type:'string'},file:{type:'string'},query:{type:'string'},symbolId:{type:'string'},deps:{type:'boolean'},maxTokens:{type:'integer',minimum:128,maximum:12000}},additionalProperties:false}},
 {name:'agentos_tasks_ready',description:'List unblocked actionable leaf subtasks, plus reasons other tasks remain blocked',inputSchema:{type:'object',properties:{},additionalProperties:false}},
 {name:'agentos_memory_search',description:'Search explicit project facts and decisions; these are assertions, not independently verified truth',inputSchema:{type:'object',properties:{query:{type:'string'}},required:['query'],additionalProperties:false}},
 {name:'agentos_memory_add',description:'Persist an explicit project fact or decision, with a clear source label',inputSchema:{type:'object',properties:{kind:{type:'string',enum:['fact','decision']},text:{type:'string'},source:{type:'string'}},required:['kind','text'],additionalProperties:false}},
 {name:'agentos_session_timeline',description:'Read automatic Git/Watcher events together with explicit intent and decisions (no inferred intent)',inputSchema:{type:'object',properties:{},additionalProperties:false}},
 {name:'agentos_session_notes',description:'Read explicit intent, decisions, progress and next steps for this project',inputSchema:{type:'object',properties:{},additionalProperties:false}},
 {name:'agentos_session_capture',description:'Record an explicit in-session event (no model inference). Requires active session.',inputSchema:{type:'object',properties:{kind:{type:'string',enum:['intent','decision','progress','blocker','next','verification']},text:{type:'string'}},required:['kind','text'],additionalProperties:false}},
];
const validVersions=new Set(['2024-11-05','2025-03-26','2025-06-18']);
function str(o:Record<string,unknown>,key:string){return typeof o[key]==='string'?o[key] as string:undefined;}
function asObject(x:unknown):Record<string,unknown>{if(!x||typeof x!=='object'||Array.isArray(x))throw Error('Expected object arguments');return x as Record<string,unknown>;}
async function dispatch(root:string,name:string,args:Record<string,unknown>):Promise<unknown>{
 switch(name){
 case 'agentos_work':return await work(root);
 case 'agentos_verified_resume':return verifiedResume(root);
 case 'agentos_guard_status':return tryEvidenceStatus(root);
 case 'agentos_conflict_radar':return conflictRadar(root,str(args,'base')||'',str(args,'left')||'',str(args,'right')||'');
 case 'agentos_stall_status':return stallStatus(root);
 case 'agentos_status':return status(root);
 case 'agentos_handoff':{const file=handoff(root);return {text:readText(file),warning:'Handoff describes project state; Git and actual tests remain authoritative.'};}
 case 'agentos_context':return requestContext(root,{symbol:str(args,'symbol'),symbolId:str(args,'symbolId'),file:str(args,'file'),query:str(args,'query'),includeDependencies:args.deps===true,maxTokens:typeof args.maxTokens==='number'?args.maxTokens:undefined});
 case 'agentos_tasks_ready':return {ready:readySubtasks(root),blocked:blockedSubtasks(root)};
 case 'agentos_memory_search':return searchMemories(root,str(args,'query')||'');
 case 'agentos_memory_add':return addMemory(root,{kind:str(args,'kind')||'',text:str(args,'text')||'',source:str(args,'source')||'mcp-agent-explicit'});
 case 'agentos_session_timeline':return sessionTimeline(root);
 case 'agentos_session_notes':return listNotes(root);
 case 'agentos_session_capture':return captureNote(root,{kind:str(args,'kind')||'',text:str(args,'text')||'',source:'mcp-agent-explicit'});
 default:throw Error('Unknown MCP tool: '+name);
 }
}
function respond(id:unknown,result:unknown){process.stdout.write(JSON.stringify({jsonrpc:'2.0',id,result})+'\n');}
function error(id:unknown,code:number,message:string){process.stdout.write(JSON.stringify({jsonrpc:'2.0',id,error:{code,message}})+'\n');}
export async function serveMcp(root:string):Promise<void>{
 // read project-local-only, newline JSONRPC, one request per line (official MCP stdio framing).
 const rl=createInterface({input:process.stdin,crlfDelay:Infinity});
 for await(const line of rl){
  if(!line.trim())continue;
  let message:Record<string,unknown>;
  try{if(Buffer.byteLength(line)>1048576)throw Error('Request too large');message=asObject(JSON.parse(line));}
  catch{error(null,-32700,'Parse error');continue;}
  const id=message.id;
  if(message.jsonrpc!=='2.0'||typeof message.method!=='string'){if(id!==undefined)error(id??null,-32600,'Invalid request');continue;}
  if(id===undefined)continue; // notifications, including notifications/initialized
  try{
   const params=message.params===undefined?{}:asObject(message.params);
   switch(message.method){
   case 'initialize':{
    const requested=str(params,'protocolVersion')||'2025-03-26';
    respond(id,{protocolVersion:validVersions.has(requested)?requested:'2025-03-26',capabilities:{tools:{listChanged:false},resources:{listChanged:false}},serverInfo:{name:'shimi',version:JSON.parse(readFileSync(new URL('../../package.json',import.meta.url),'utf8')).version}});
    break;
   }
   case 'ping':respond(id,{});break;
   case 'tools/list':respond(id,{tools});break;
   case 'resources/list':respond(id,{resources:[
     {uri:'shimi://handoff',name:'Current handoff',mimeType:'text/markdown',description:'Project handoff; verify against Git'},
     {uri:'shimi://task',name:'Active task',mimeType:'text/markdown'},
     {uri:'shimi://pack',name:'Current context pack',mimeType:'text/markdown'}
   ]});break;
   case 'resources/read':{
    const uri=str(params,'uri');
    const file=(uri==='agentos://handoff'||uri==='shimi://handoff')?'AI_HANDOFF.md':(uri==='agentos://task'||uri==='shimi://task')?'AI_TASK.md':(uri==='agentos://pack'||uri==='shimi://pack')?'packs/current-task.md':null;
    if(!file)throw Error('Unknown resource');
    respond(id,{contents:[{uri,mimeType:'text/markdown',text:readText(pathFor(root,file)).slice(0,350000)}]});break;
   }
   case 'tools/call':{
    const name=str(params,'name');if(!name)throw Error('Missing tool name');
    try{const data=await dispatch(root,name,params.arguments===undefined?{}:asObject(params.arguments));
      const contents=typeof data==='string'?data:JSON.stringify(data,null,2);
      respond(id,{content:[{type:'text',text:contents.slice(0,350000)}],isError:false});
    }catch(e){respond(id,{content:[{type:'text',text:e instanceof Error?e.message:String(e)}],isError:true});}
    break;
   }
   default:error(id,-32601,'Method not found');
   }
  }catch(e){error(id,-32602,e instanceof Error?e.message:String(e));}
 }
}
