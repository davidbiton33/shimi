/** Model-free entrypoint and explicit agent-transfer workflow.
 * Daily orchestration is safe/idempotent. Switching agents is ALWAYS user-initiated.
 */
import {existsSync} from 'node:fs';
import {join} from 'node:path';
import {init,start,end,handoff,status,rules,requireGit} from './commands.js';
import {installSkill,installMcp,clientsFor} from './onboarding.js';
import {verifiedResume,stallStatus} from './guardrails.js';
import {readySubtasks,blockedSubtasks} from './context-requests.js';
import {tryEvidenceStatus} from './evidence.js';
import {getSession} from './state.js';
import {pathFor,readText} from './utils.js';
import type {AgentClient} from './onboarding.js';

export type LocalMcpServer = {command:string;args:string[]};

export function projectSetup(root:string, clients:AgentClient[],server:LocalMcpServer,dryRun=false){
 requireGit(root);
 const initialized=existsSync(join(root,'agentos.yml'));
 // All onboarding files are preflight-checked before init or a first write.
 const skillPlan=installSkill(root,clients,true);
 const mcpPlan=installMcp(root,clients,server,true);
 if(dryRun)return {dryRun:true,initialized,wouldInitialize:!initialized,skill:skillPlan,mcp:mcpPlan,
   note:'Dry run does not create, update, or execute project files.'};
 const setup=initialized?null:init(root);
 const instructionFiles=rules(root);
 const skills=installSkill(root,clients,false);
 const mcp=installMcp(root,clients,server,false);
 return {dryRun:false,initialized:true,createdProject:!initialized,initialization:setup,instructionFiles,skills,mcp,
  next:'Reload your AI client and approve/trust its project MCP connection. Ask your agent to use SHIMI work; do not switch agents until you explicitly run `shimi switch`.'};
}

export async function work(root:string,background=true){
 requireGit(root);
 const boot=await start(root,background);
 // The watcher refreshes changed-file context; no expensive full pack on each agent turn.
 // START refreshes the pack for a new session; an active session keeps the same pack.
 const state=status(root);
 const evidence=tryEvidenceStatus(root);
 const ready=readySubtasks(root);
 const blocked=blockedSubtasks(root);
 const stall=stallStatus(root);
 return {mode:'work',session:state.session?.id,sessionReused:boot.reused,watcher:state.watcher,
  packAvailable:state.pack,ready,blocked,evidence,stall,
  nextActions:[
   'Read .ai/AI_TASK.md and relevant pack, use agentos_context for missing exact code.',
   'Record significant decisions and next steps via session capture or MCP; do not record secrets.',
   'Evidence run is explicitly opt-in: do not execute project scripts automatically.',
   'Only the user initiates agent transfer with `shimi switch`, followed by `shimi continue` in the new agent.'
  ]};
}

export async function switchAgent(root:string){
 requireGit(root);
 const session=getSession(root);
 if(!session)throw Error('No SHIMI session exists. Run `shimi work` first.');
 // Human-invoked explicit transfer: stop watcher and create final pack/checkpoint when active.
 const completed=session.state==='active'?await end(root):null;
 const exported=completed?.exported??handoff(root);
 const verification=verifiedResume(root);
 const source=readText(pathFor(root,'AI_TASK.md'));
 return {mode:'switch',userInitiated:true,previousSession:session.id,sessionClosed:!!completed,
  watcherStopped:completed?.watcherStopped??true,handoff:exported,verification,
  warnings:[...(completed?.warning?[completed.warning]:[]),
   'The transfer does not copy your AI chat transcript. Explicit next steps/decisions must be saved by the agent before quota ends.',
   'Checkpoints do not back up uncommitted source. Keep the same Git worktree and .ai directory available to the next agent.',
   ...(source.includes('Describe the active task')?['AI_TASK.md still contains the default placeholder. The receiving agent may need task clarification.']:[])],
  next:'Open the other AI agent with access to this same project and run `shimi continue` there. No conversation history is required.'};
}

export async function continueAgent(root:string,background=true){
 requireGit(root);
 const previous=getSession(root);
 if(!previous)throw Error('No saved session to continue. Run `shimi work` to start new work.');
 if(previous.state==='active')throw Error('An SHIMI session is still active. Run `shimi switch` from the terminal first; continue will not silently end another agent session.');
 // Read/verify prior session BEFORE starting a new one; starting would replace SESSION.md.
 const exportPath=handoff(root);
 const handoffText=readText(exportPath);
 const verification=verifiedResume(root);
 const boot=await start(root,background);
 return {mode:'continue',userInitiated:true,fromSession:previous.id,session:boot.session.id,
  watcherPid:boot.watcherPid,handoffPath:exportPath,handoff:handoffText.slice(0,60000),verification,
  nextActions:['Confirm pending work from the handoff and inspect live Git diff.',
   'Read source and tests rather than treating agent-written claims as verified.',
   'Work can continue normally; use SHIMI context, memory and session capture through MCP/Skill.',
   'If the handoff is incomplete, ask the user; do not invent a missing decision.'],
  note:'No project tests ran automatically. Old evidence may be stale. Session capture is not a recording of the former AI chat.'};
}
