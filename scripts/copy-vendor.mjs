import { copyFileSync,mkdirSync,existsSync,readdirSync,lstatSync } from 'node:fs';
import { resolve } from 'node:path';
mkdirSync('dist/vendor',{recursive:true});
copyFileSync(resolve('vendor/typescript.cjs'),'dist/vendor/typescript.cjs');
copyFileSync(resolve('vendor/TYPESCRIPT_LICENSE.txt'),'dist/vendor/TYPESCRIPT_LICENSE.txt');

// Optional offline Tree-sitter runtime and pinned WASM grammars. A missing
// vendor directory is intentional and leaves structural parsing enabled.
if(existsSync('vendor/tree-sitter')){
 mkdirSync('dist/vendor/tree-sitter',{recursive:true});
 for(const file of readdirSync('vendor/tree-sitter')){
  const from=resolve('vendor/tree-sitter',file);
  if(!lstatSync(from).isFile()||lstatSync(from).isSymbolicLink())continue;
  if(!/^(?:tree-sitter\.(?:js|wasm)|tree-sitter-[a-z_]+\.wasm|LICENSE(?:-[a-z0-9_-]+)?\.txt|asset-manifest\.json)$/.test(file))continue;
  copyFileSync(from,resolve('dist/vendor/tree-sitter',file));
 }
}
