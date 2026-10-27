/** Read the package's authoritative release version, avoiding stale QA metadata. */
import {readFileSync} from 'node:fs';
export const releaseVersion=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8')).version;
