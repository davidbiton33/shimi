/** Remove compiler output before rebuild to prevent stale modules from entering npm packages. */
import {rmSync, lstatSync, existsSync} from 'node:fs';
import {resolve, join, sep} from 'node:path';
const root = resolve('.');
const out = resolve(root, 'dist');
if (out !== join(root, 'dist') || !out.startsWith(root + sep)) throw new Error('Unsafe output path');
if (existsSync(out)) {
  if (lstatSync(out).isSymbolicLink()) throw new Error('Refusing symlinked dist directory');
  rmSync(out, {recursive:true, force:true});
}
