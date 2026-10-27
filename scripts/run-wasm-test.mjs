/** Cross-platform runner for strict, real WASM integration tests. */
import {spawnSync} from 'node:child_process';
const result=spawnSync(process.execPath,['--test','dist/tests/wasm.integration.test.js'],{stdio:'inherit',env:{...process.env,AGENTOS_REQUIRE_WASM:'1'}});
if(result.error)throw result.error;
process.exitCode=result.status??1;
