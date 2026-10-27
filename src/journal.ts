import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { pathFor, now } from './utils.js';
export function event(root:string, name:string, detail:Record<string,unknown>={}) {
  const p=pathFor(root,'journal','events.jsonl');mkdirSync(dirname(p),{recursive:true});
  appendFileSync(p,JSON.stringify({at:now(),event:name,...detail})+'\n',{encoding:'utf8',mode:0o600});
}
