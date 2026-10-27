#!/usr/bin/env node
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, existsSync } from 'node:fs';
import { checkpoint, doctor, end, findRoot, handoff, init, pack, rules, start, status } from './commands.js';
import { loadConfig } from './config.js';
import { getSession } from './state.js';
import { gitTop } from './git.js';
import { runWatchLoop } from './watcher.js';
import { parserRegistry } from './smart.js';
import { initializeTreeSitter, treeSitterStatus } from './treesitter.js';

const HELP=`SHIMI — persistent project memory for any AI coding agent

Usage: shimi <command> [--cwd PATH] [--json]

Commands:
  setup        One-time project onboarding: init, rules, skills and MCP (--client all|claude|cursor|codex)
  work         One command for agent to start/reuse a session and inspect current state
  switch       USER command: checkpoint, finalize and hand off to another agent
  continue     USER command: read/verify old handoff and start a new session
  init         Initialize memory, config, rules and ignore files (non-destructive)
  start        Start or recover a session and spawn background watcher
  start --no-watch   Start without background process
  end          Stop watcher; create final checkpoint, pack and handoff
  status       Show session and watcher state
  doctor       Check dependencies, integrity and health
  checkpoint   Create immediate checkpoint
  pack         Refresh smart context pack using AST or structural extraction
  context      Request missing source context: --symbol/--symbol-id/--file/--query [--deps]
  scip         Import/status/refresh a SCIP index, or enable opt-in TypeScript auto refresh
  subtask      Nested tasks: create/list/get/complete/ready/blocked/depend/undepend
  memory       Persistent project facts/decisions: add/list/get/search
  session      Capture session events: capture/list/ingest/timeline
  evidence     Explicit check init/run/status/list; tests are NEVER run automatically
  guard        Acceptance status for recorded check evidence
  radar        Compare two Git revisions for file and dependency overlaps
  stall        Detect repeated identical failures in recorded checks
  resume --verify  Show evidence freshness, changes and continuation risks
  mcp          MCP stdio integration: serve/config/install [--client all|claude|cursor|codex] [--dry-run]
  skill install  Install portable SKILL.md files for Claude, Cursor and Codex
  task prompt  Print an agent-ready task briefing in Hebrew or English (--lang he|en)
  explain      Show file/symbol selection, cross-file graph and token accounting
  graph        Show project-wide dependency graph report
  parsers      List language parsers and optional WASM status
  symbols      Show resolved/ambiguous cross-file symbol bindings
  handoff      Export standalone handoff document
  resume       Show continuation status and export latest handoff
  rules        Sync agent-specific instruction files
  watch        Run watcher in foreground for active session
  help         Show this help

Quick transfer: shimi switch  →  shimi continue  (the user initiates both)
Legacy: agentos remains an alias; .ai and agentos.yml remain compatible.
No AI models, network APIs, credentials, vector DB, or editor vendor lock-in.
`;
type CliArgs = {command:string;action:string;cwd:string;json:boolean;noWatch:boolean;session:string;options:Record<string,string|boolean>};
function inputSafeEvidenceOptionError(action:string,options:Record<string,string|boolean>):boolean {
 return (!!options['dry-run']&&action!=='init')||('check' in options&&action!=='run');
}
function flags(args:string[]):CliArgs {
  const positionals:string[]=[];let cwd=process.cwd(),json=false,noWatch=false,session='';
  const options:Record<string,string|boolean>={};
  const optionNames=new Set(['symbol','symbol-id','file','query','index','indexer','subtask','max-tokens','title','description','parent','id','result','request','lang','kind','text','tags','source','on','client','manifest','check','base','left','right']);
  for(let i=0;i<args.length;i++){
    const a=args[i];
    if(a==='--cwd'){if(!args[i+1])throw new Error('--cwd requires a path');cwd=resolve(args[++i]);}
    else if(a==='--json')json=true;
    else if(a==='--version'||a==='-v')positionals.push('version');
    else if(a==='--no-watch')noWatch=true;
    else if(a==='--session'){if(!args[i+1])throw new Error('--session requires a value');session=args[++i];}
    else if(a==='--deps')options.deps=true;
    else if(a==='--dry-run')options['dry-run']=true;
    else if(a==='--verify')options['verify']=true;
    else if(a.startsWith('--') && optionNames.has(a.slice(2))){
      if(args[i+1]===undefined||args[i+1].startsWith('--'))throw new Error(`${a} requires a value`);
      if(a.slice(2) in options)throw new Error('Duplicate option: '+a);
      options[a.slice(2)]=args[++i];
    }
    else if(a.startsWith('-'))throw new Error('Unknown option: '+a);
    else positionals.push(a);
  }
  if(positionals.length>2)throw new Error('Unexpected extra arguments');
  const [command='help',action='']=positionals;
  if(action==='--verify')throw new Error('Use flag --verify, not positional text');
  if(action && !( (command==='context'&&action==='get') || (command==='scip'&&['import','status','refresh','auto-enable','auto-disable'].includes(action)) || (command==='subtask'&&['create','list','get','complete','ready','blocked','depend','undepend'].includes(action)) || (command==='memory'&&['add','list','get','search'].includes(action)) || (command==='session'&&['capture','list','ingest','timeline'].includes(action)) || (command==='mcp'&&['serve','config','install'].includes(action)) || (command==='skill'&&action==='install') || (command==='task'&&action==='prompt') || (command==='evidence'&&['init','run','status','list'].includes(action)) || (command==='guard'&&action==='status') || (command==='radar'&&action==='compare') || (command==='stall'&&action==='status') ))throw new Error('Unexpected extra argument: '+action);
  if(command!=='setup'&&command!=='context'&&command!=='subtask'&&command!=='scip'&&command!=='task'&&command!=='session'&&command!=='memory'&&command!=='mcp'&&command!=='skill'&&command!=='evidence'&&command!=='guard'&&command!=='radar'&&command!=='stall'&&command!=='resume'&&Object.keys(options).length)throw new Error('Options are not supported for this command');
  if(command==='setup'&&Object.keys(options).some(k=>!['client','dry-run'].includes(k)))throw new Error('Unsupported setup option');
  if((command==='switch'||command==='continue'||command==='work')&&Object.keys(options).length)throw new Error('Unsupported orchestration option');
  if(command==='resume'&&Object.keys(options).some(k=>k!=='verify'))throw new Error('Unsupported resume option');
  if(command==='evidence'&&Object.keys(options).some(k=>!['manifest','check','dry-run'].includes(k)))throw new Error('Unsupported evidence option');
  if(command==='evidence'&&inputSafeEvidenceOptionError(action,options))throw Error('Evidence --dry-run is only valid with init; --check is only valid with run');
  if(command==='guard'&&Object.keys(options).some(k=>k!=='manifest'))throw new Error('Unsupported guard option');
  if(command==='radar'&&Object.keys(options).some(k=>!['base','left','right'].includes(k)))throw new Error('Unsupported radar option');
  if(command==='stall'&&Object.keys(options).length)throw new Error('Unsupported stall option');
  if(command==='context' && Object.keys(options).some(k=>!['symbol','symbol-id','file','query','subtask','max-tokens','deps'].includes(k)))throw new Error('Unsupported context option');
  if(command==='scip' && Object.keys(options).some(k=>!['index','indexer'].includes(k)))throw new Error('Unsupported scip option');
  if(command==='subtask' && Object.keys(options).some(k=>!['title','description','parent','id','result','on'].includes(k)))throw new Error('Unsupported subtask option');
  if(command==='task' && Object.keys(options).some(k=>!['request','lang'].includes(k)))throw new Error('Unsupported task option');
  if(command==='memory'&&Object.keys(options).some(k=>!['kind','text','tags','source','id','query'].includes(k)))throw new Error('Unsupported memory option');
  if(command==='session'&&Object.keys(options).some(k=>!['kind','text','source','file'].includes(k)))throw new Error('Unsupported session option');
  if(command==='mcp' && Object.keys(options).some(k=>!(action==='install'&&['client','dry-run'].includes(k))))throw new Error('MCP options are only supported for install');
  if(command==='skill' && Object.keys(options).some(k=>!['client','dry-run'].includes(k)))throw new Error('Unsupported skill option');
  return {command,action,cwd,json,noWatch,session,options};
}
function optionString(args:CliArgs,name:string):string|undefined{
  const x=args.options[name];return typeof x==='string'?x:undefined;
}
function requiredOption(args:CliArgs,name:string):string{
  const value=optionString(args,name);if(!value)throw new Error(`--${name} is required`);return value;
}
async function main(){
  const input=flags(process.argv.slice(2));const root=input.command==='setup'?(existsSync(resolve(findRoot(input.cwd),'agentos.yml'))?findRoot(input.cwd):(gitTop(input.cwd)||input.cwd)):
    (['init','parsers','version','help'].includes(input.command)?input.cwd:findRoot(input.cwd));
  if(['memory','session','mcp','skill'].includes(input.command)&&!existsSync(resolve(root,'agentos.yml')))throw new Error('Project is not initialized. Run shimi init first.');
  if(['pack','start','end','watch','__watch','parsers','doctor','context','work','switch','continue'].includes(input.command))await initializeTreeSitter();
  let result:unknown;
  switch(input.command){
    case 'help':console.log(HELP);return;
    case 'version': console.log(JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version);return;
    case 'parsers':result={adapters:parserRegistry.describe(),treeSitter:treeSitterStatus()};break;
    case 'init':result=init(root);break;
    case 'setup':{
      const {projectSetup}=await import('./orchestrator.js');
      const {clientsFor}=await import('./onboarding.js');
      result=projectSetup(root,clientsFor(optionString(input,'client')),
        {command:process.execPath,args:[fileURLToPath(import.meta.url),'mcp','serve','--cwd',root]},input.options['dry-run']===true);
      break;
    }
    case 'work':{
      const {work}=await import('./orchestrator.js');result=await work(root,!input.noWatch);break;
    }
    case 'switch':{
      const {switchAgent}=await import('./orchestrator.js');result=await switchAgent(root);break;
    }
    case 'continue':{
      const {continueAgent}=await import('./orchestrator.js');result=await continueAgent(root,!input.noWatch);break;
    }
    case 'start':result=await start(root,!input.noWatch);break;
    case 'end':result=await end(root);break;
    case 'status':result=status(root);break;
    case 'doctor':result=doctor(root);break;
    case 'checkpoint':result={checkpoint:checkpoint(root)};break;
    case 'pack':result=pack(root);break;
    case 'scip':{
      const {importScip,scipStatus}=await import('./scip.js');
      const {runScipIndexer,allowedIndexer,configureAutoScip,autoScipStatus}=await import('./scip-refresh.js');
      if(input.action==='import')result=importScip(root,resolve(input.cwd,requiredOption(input,'index')));
      else if(input.action==='status')result={...scipStatus(root),auto:autoScipStatus(root)};
      else if(input.action==='refresh')result=runScipIndexer(root,allowedIndexer(requiredOption(input,'indexer')));
      else if(input.action==='auto-enable')result=configureAutoScip(root,true);
      else if(input.action==='auto-disable')result=configureAutoScip(root,false);
      else throw new Error('Use shimi scip import|status|refresh --indexer TYPE|auto-enable|auto-disable');
      break;
    }
    case 'context':{
      const {requestContext}=await import('./context-requests.js');
      const max=optionString(input,'max-tokens');
      if(max!==undefined && !/^[0-9]+$/.test(max))throw new Error('--max-tokens must be an integer');
      result=requestContext(root,{
        file:optionString(input,'file'),symbol:optionString(input,'symbol'),symbolId:optionString(input,'symbol-id'),query:optionString(input,'query'),
        subtaskId:optionString(input,'subtask'),maxTokens:max?Number(max):undefined,
        includeDependencies:input.options.deps===true
      });break;
    }
    case 'evidence':{
      const {runChecks,evidenceRuns,evidenceStatus,initEvidenceManifest}=await import('./evidence.js');
      const manifest=optionString(input,'manifest')||'.agentos-evidence.json';
      if(input.action==='init')result=initEvidenceManifest(root,manifest,input.options['dry-run']===true);
      else if(input.action==='run')result=runChecks(root,manifest,optionString(input,'check'));
      else if(input.action==='status')result=evidenceStatus(root,manifest);
      else if(input.action==='list')result=evidenceRuns(root);
      else throw Error('Use shimi evidence init|run|status|list');
      break;
    }
    case 'guard':{
      if(input.action!=='status')throw Error('Use shimi guard status');
      const {evidenceStatus}=await import('./evidence.js');result=evidenceStatus(root,optionString(input,'manifest')||'.agentos-evidence.json');break;
    }
    case 'radar':{
      if(input.action!=='compare')throw Error('Use shimi radar compare');
      const {conflictRadar}=await import('./guardrails.js');
      result=conflictRadar(root,requiredOption(input,'base'),requiredOption(input,'left'),requiredOption(input,'right'));break;
    }
    case 'stall':{
      if(input.action!=='status')throw Error('Use shimi stall status');
      const {stallStatus}=await import('./guardrails.js');result=stallStatus(root);break;
    }
    case 'task':{
      if(input.action!=='prompt')throw new Error('Use shimi task prompt [--request TEXT] [--lang he|en]');
      const {taskPrompt}=await import('./task-prompt.js');
      const task=taskPrompt({language:optionString(input,'lang')??'he',request:optionString(input,'request')});
      if(!input.json){console.log(task.prompt);return;}
      result=task;
      break;
    }
    case 'subtask':{
      const {createSubtask,finishSubtask,listSubtasks,subtaskLineage,readySubtasks,blockedSubtasks,addSubtaskDependency,removeSubtaskDependency}=await import('./context-requests.js');
      if(input.action==='create')result=createSubtask(root,{title:requiredOption(input,'title'),description:optionString(input,'description'),parentId:optionString(input,'parent')});
      else if(input.action==='list')result=listSubtasks(root,optionString(input,'parent'));
      else if(input.action==='get')result=subtaskLineage(root,requiredOption(input,'id'));
      else if(input.action==='complete')result=finishSubtask(root,requiredOption(input,'id'),requiredOption(input,'result'));
      else if(input.action==='ready')result=readySubtasks(root);
      else if(input.action==='blocked')result=blockedSubtasks(root);
      else if(input.action==='depend')result=addSubtaskDependency(root,requiredOption(input,'id'),requiredOption(input,'on'));
      else if(input.action==='undepend')result=removeSubtaskDependency(root,requiredOption(input,'id'),requiredOption(input,'on'));
      else throw new Error('Use shimi subtask create|list|get|complete|ready|blocked|depend|undepend');
      break;
    }
    case 'memory':{
      const {addMemory,listMemories,getMemory,searchMemories}=await import('./memory.js');
      const kind=optionString(input,'kind');
      if(input.action==='add')result=addMemory(root,{kind:requiredOption(input,'kind'),text:requiredOption(input,'text'),tags:optionString(input,'tags')?.split(',').map(s=>s.trim()).filter(Boolean),source:optionString(input,'source')});
      else if(input.action==='list')result=listMemories(root,kind);
      else if(input.action==='get')result=getMemory(root,requiredOption(input,'id'));
      else if(input.action==='search')result=searchMemories(root,requiredOption(input,'query'),kind);
      else throw Error('Use shimi memory add|list|get|search');
      break;
    }
    case 'session':{
      const {captureNote,listNotes,captureStructuredTranscript,sessionTimeline}=await import('./session-notes.js');
      if(input.action==='capture')result=captureNote(root,{kind:requiredOption(input,'kind'),text:requiredOption(input,'text'),source:optionString(input,'source')});
      else if(input.action==='list')result=listNotes(root);
      else if(input.action==='ingest')result=captureStructuredTranscript(root,requiredOption(input,'file'));
      else if(input.action==='timeline')result=sessionTimeline(root);
      else throw Error('Use shimi session capture|list|ingest|timeline');
      break;
    }
    case 'skill':{
      if(input.action!=='install')throw Error('Use shimi skill install');
      const {installSkill,clientsFor}=await import('./onboarding.js');
      result=installSkill(root,clientsFor(optionString(input,'client')),input.options['dry-run']===true);break;
    }
    case 'mcp':{
      if(input.action==='serve'){
        const {serveMcp}=await import('./mcp.js');
        await serveMcp(root);return;
      }
      if(input.action==='install'){
        const {installMcp,clientsFor}=await import('./onboarding.js');
        result=installMcp(root,clientsFor(optionString(input,'client')),{command:process.execPath,args:[fileURLToPath(import.meta.url),'mcp','serve','--cwd',root]},input.options['dry-run']===true);break;
      }
      if(input.action==='config'){
        result={mcpServers:{shimi:{command:process.execPath,args:[fileURLToPath(import.meta.url),'mcp','serve','--cwd',root]}}};
        break;
      }
      throw Error('Use shimi mcp serve|config|install');
    }
    case 'symbols':{const {readFileSync}=await import('node:fs');const {join}=await import('node:path');result=JSON.parse(readFileSync(join(root,'.ai','packs','dependency-graph.json'),'utf8')).symbols||{error:'Regenerate pack to build symbols'};break;}
    case 'graph':{
      const {readFileSync}=await import('node:fs');const {join}=await import('node:path');
      const data=JSON.parse(readFileSync(join(root,'.ai','packs','dependency-graph.json'),'utf8'));
      const {scipStatus}=await import('./scip.js');const status=scipStatus(root);
      if(status.status!=='ready' && (data.semanticReferences?.length||data.scipCallsites?.length)){
        // Cached graph was produced before source/config changed: never present stale links as current.
        data.semanticReferences=[];data.scipCallsites=[];
        if(data.scipCoverage)data.scipCoverage={...data.scipCoverage,status:'stale',links:0,staticCallsites:0};
        data.packSnapshotStale=true;data.warning='Previously packed SCIP evidence is stale; rerun shimi pack';
      }
      result=data;break;
    }
    case 'explain':{
      const {readFileSync}=await import('node:fs');const {join}=await import('node:path');
      const data=JSON.parse(readFileSync(join(root,'.ai','packs','current-task.manifest.json'),'utf8'));
      const {scipStatus}=await import('./scip.js');const status=scipStatus(root);
      if(data.scip?.status==='imported'&&status.status!=='ready'){
        data.packSnapshotStale=true;data.warning='SCIP evidence in the saved pack may be stale; rerun shimi pack';
        data.scip={...data.scip,status:'stale',limitations:[...(data.scip.limitations||[]),'Stale snapshot: SCIP evidence from this saved manifest must not be used as current proof']};
      }
      result=data;break;
    }
    case 'handoff':result={path:handoff(root)};break;
    case 'resume':{
      const resultBase={status:status(root),handoff:handoff(root)};
      if(input.options['verify']===true){const {verifiedResume}=await import('./guardrails.js');result={...resultBase,verification:verifiedResume(root)};}
      else result=resultBase;
      break;
    }
    case 'rules':result={files:rules(root)};break;
    case 'watch':case '__watch':{
      const session=getSession(root);
      const id=input.session||session?.id;
      if(!id)throw new Error('No session to watch');
      await runWatchLoop(root,loadConfig(root),id);return;
    }
    default:throw new Error(`Unknown command: ${input.command}. Use shimi help.`);
  }
  if(input.json)console.log(JSON.stringify(result,null,2));
  else {
    if(input.command==='doctor'){
      const d=result as ReturnType<typeof doctor>;
      for(const c of d.checks)console.log(`${c.ok?'✓':'!'} ${c.name}: ${c.message}`);
      console.log(d.healthy?'Core health: OK':'Core health: FAILED');
      if(!d.healthy)process.exitCode=1;
    } else console.log(JSON.stringify(result,null,2));
  }
}
main().catch(e=>{console.error(`SHIMI error: ${e instanceof Error?e.message:String(e)}`);process.exitCode=1;});
