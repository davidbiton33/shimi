import { mergeManaged } from './ignore.js';
import { readText, writeAtomic, safeProjectPath } from './utils.js';

const instructions=`SHIMI runs as a low-friction model-independent continuity layer. For ordinary agent work, run shimi work --json (or MCP agentos_work) once on entry. The user does not need to memorize checkpoints, packs or start commands. Read:
1. .ai/AI_RULES.md
2. .ai/AI_CONTEXT.md
3. .ai/AI_TASK.md
4. .ai/SESSION.md
5. .ai/AI_HANDOFF.md (if present)
6. .ai/packs/current-task.md (if present)
Use project files and Git for verification; do not invent past session results.
If the current task pack lacks an exact source function, file or dependency, call 'shimi context --symbol NAME --json' or 'shimi context --file PATH --json'. For conceptual clues, use '--query WORDS'. Use '--deps' to get last-pack dependency navigation hints, then request the specific missing symbol or file.
If a symbol is ambiguous, ask for a specific '--file'; do not guess which definition is used. Repeat context requests only as needed, and keep outputs bounded with '--max-tokens'. The returned source/graph evidence is not compiler-verified runtime dispatch.
For focused child work use 'shimi subtask create --title TITLE', then pass its id via 'shimi context --subtask ID'; complete using 'shimi subtask complete --id ID --result SUMMARY'. Preserve the original .ai/AI_TASK.md and current-task.md.
When a decision, blocker, progress milestone, or next step is reached, call 'shimi session capture --kind decision|blocker|progress|next --text TEXT'. For durable verified project knowledge, use 'shimi memory add --kind fact|decision --text TEXT --source ORIGIN'; search via 'shimi memory search --query WORDS'. These are explicit assertions, not automatically inferred from chat.
Use 'shimi subtask ready' to find actionable leaf work; 'shimi subtask depend --id TASK --on BLOCKER' to record dependency order. Never complete a blocked task.
For evidence based handoff use 'shimi resume --verify --json' to compare declared test inputs with saved SHIMI-executed checks; never automatically run untrusted repo commands. 'shimi guard status --json' reports acceptance gates; 'shimi stall status --json' reports identical repeated failures only from recorded check runs. For branches, use 'shimi radar compare --base BASE --left A --right B --json'; warnings are heuristics, not proof of runtime conflicts.
Before handing work to a different agent, capture actionable decisions and next steps as session notes; confirm .ai/AI_TASK.md describes outstanding work. 'shimi mcp serve' provides an opt-in local MCP interface with handoff/context/tasks/memory tools.
Only the USER initiates changing agents: after quota exhaustion they run 'shimi switch' in a terminal, then 'shimi continue' in the new agent with the same Git worktree and .ai. Do not execute either transfer command automatically. For normal task completion, leave session/watch to continue until explicitly ended by user. Never commit secrets or generated packs.
SHIMI is model-independent and must never launch an AI model on its own.`;
const adapters:Record<string,string>={
  cursor:'.cursor/rules/agentos.mdc',
  claude:'CLAUDE.md',
  windsurf:'.windsurf/rules/agentos.md',
  cline:'.clinerules/agentos.md',
  roo:'.roo/rules/agentos.md',
  kiro:'.kiro/steering/agentos.md',
  trae:'.trae/rules/agentos.md',
  generic:'AGENTS.md'
};
export function generateRules(root:string, editors:string[]){
  const written:string[]=[];
  for(const tool of new Set([...editors,'generic'])){
    const rel=adapters[tool];if(!rel)continue;
    const dest=safeProjectPath(root,rel);
    const existing=readText(dest);
    // Cursor requires YAML front matter at byte 0 of its .mdc file.
    const frontmatter='---\ndescription: SHIMI continuity protocol\nalwaysApply: true\n---\n\n';
    const base=tool==='cursor' && !existing.startsWith('---\n')?frontmatter+existing:existing;
    writeAtomic(dest,mergeManaged(base,[instructions]));
    written.push(rel);
  }
  return written;
}
export const supportedAdapters=Object.keys(adapters);
