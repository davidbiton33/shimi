/**
 * Reproducible offline vendoring of developer-supplied, pinned Tree-sitter assets.
 * Does not download files and does not run input code. WASM integration tests
 * must run before packaging a release with these assets.
 *
 * Usage: node scripts/vendor-tree-sitter.mjs ./node_modules/web-tree-sitter ./node_modules/tree-sitter-wasms/out
 */
import {copyFileSync,existsSync,lstatSync,mkdirSync,readdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
const args=process.argv.slice(2);
if(args.length!==2){console.error('Usage: node scripts/vendor-tree-sitter.mjs RUNTIME_PACKAGE_DIR GRAMMARS_DIR');process.exit(2);}
const [runtimeDir, grammarDir] = args.map(arg => resolve(arg));
function regular(p){try{const s=lstatSync(p);return s.isFile()&&!s.isSymbolicLink();}catch{return false;}}
function validated(p,wasm=false){
 if(!regular(p))throw new Error(`Missing regular file: ${p}`);
 const b=readFileSync(p);
 if(b.length<8||b.length>12*1024*1024)throw new Error(`Invalid asset size: ${p}`);
 if(wasm&&!b.subarray(0,8).equals(Buffer.from([0,97,115,109,1,0,0,0])))throw new Error(`Not valid WebAssembly header: ${p}`);
 return b;
}
const output=resolve('vendor/tree-sitter');mkdirSync(output,{recursive:true});
const js=['tree-sitter.js','web-tree-sitter.js'].find(x=>regular(join(runtimeDir,x)));
const wasm=['tree-sitter.wasm','web-tree-sitter.wasm'].find(x=>regular(join(runtimeDir,x)));
if(!js||!wasm)throw new Error(`Missing Tree-sitter runtime JS/WASM in ${runtimeDir}`);
const manifest={format:1,assets:[],notes:['Verify grammar compatibility with npm run test:wasm before publishing','Licenses of individual grammar projects must be reviewed before distribution']};
function add(p,target,wasm=false){const content=validated(p,wasm);copyFileSync(p,join(output,target));manifest.assets.push({path:target,sha256:createHash('sha256').update(content).digest('hex'),bytes:content.length});}
add(join(runtimeDir,js),'tree-sitter.js');add(join(runtimeDir,wasm),'tree-sitter.wasm',true);
if(regular(join(runtimeDir,'LICENSE')))add(join(runtimeDir,'LICENSE'),'LICENSE-web-tree-sitter.txt');
const known=new Set(['python','go','java','c_sharp','rust','kotlin','dart','php','ruby','c','cpp']);
const grammars=readdirSync(grammarDir).filter(x=>/^tree-sitter-[a-z_]+\.wasm$/.test(x)).sort();
let count=0;
for(const filename of grammars){const language=filename.slice('tree-sitter-'.length,-'.wasm'.length);if(!known.has(language))continue;add(join(grammarDir,filename),filename,true);count++;}
if(!count)throw new Error('No supported grammars found. The runtime alone is insufficient.');
writeFileSync(join(output,'asset-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
console.log(`Bundled runtime + ${count} grammars. Execute npm run test:wasm to validate actual parsing.`);
