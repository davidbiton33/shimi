import {releaseVersion} from './release-version.mjs';
/** Offline acceptance against five user-provided PUBLIC repo snapshots.
 * Does not execute project code, fetch network resources, install project deps,
 * or ship upstream source in results. Usage:
 * node qa/realworld-acceptance.mjs /path/to/fixtures /path/to/cli.js /path/to/results
 */
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {resolve,join,dirname} from 'node:path';
import {spawnSync} from 'node:child_process';
const [rootArg,cliArg,resultArg]=process.argv.slice(2);
if(!rootArg||!cliArg||!resultArg)throw Error('Provide fixture root, compiled CLI, results destination');
const root=resolve(rootArg),cli=resolve(cliArg),resultDir=resolve(resultArg);mkdirSync(resultDir,{recursive:true});
const cases={
 flutter:{
  task:'Trace booking creation in Flutter from BookingScreen onPressed and Command0.execute to BookingViewModel._createBooking, BookingCreateUseCase.createFrom, repository.createBooking, and progress/error state. Avoid unrelated login and search.',
  paths:['lib/ui/booking/widgets/booking_screen.dart','lib/ui/booking/view_models/booking_viewmodel.dart','lib/domain/use_cases/booking/booking_create_use_case.dart','lib/utils/command.dart'],
  spans:[['lib/ui/booking/widgets/booking_screen.dart','_BookingScreenState.build'],['lib/ui/booking/view_models/booking_viewmodel.dart','BookingViewModel._createBooking'],['lib/domain/use_cases/booking/booking_create_use_case.dart','BookingCreateUseCase.createFrom'],['lib/utils/command.dart','Command0.execute']],
  exact:['onPressed: widget.viewModel.createBooking.execute','createBooking = Command0(_createBooking)','_createUseCase.createFrom('],
  bridges:[['flutter-command-dispatch','BookingViewModel._createBooking','body-preserved']]
 },
 compose:{
  task:'Trace completing a to-do task in Jetpack Compose from TasksScreen through onTaskCheckedChange, TaskItem Checkbox, TasksViewModel.completeTask, Hilt TaskRepository binding to DefaultTaskRepository.completeTask and DAO persistence; exclude statistics.',
  paths:['app/src/main/java/com/example/android/architecture/blueprints/todoapp/tasks/TasksScreen.kt','app/src/main/java/com/example/android/architecture/blueprints/todoapp/tasks/TasksViewModel.kt','app/src/main/java/com/example/android/architecture/blueprints/todoapp/data/DefaultTaskRepository.kt','app/src/main/java/com/example/android/architecture/blueprints/todoapp/di/DataModules.kt'],
  spans:[['app/src/main/java/com/example/android/architecture/blueprints/todoapp/tasks/TasksScreen.kt','TasksScreen'],['app/src/main/java/com/example/android/architecture/blueprints/todoapp/tasks/TasksScreen.kt','TasksContent'],['app/src/main/java/com/example/android/architecture/blueprints/todoapp/tasks/TasksScreen.kt','TaskItem'],['app/src/main/java/com/example/android/architecture/blueprints/todoapp/tasks/TasksViewModel.kt','TasksViewModel.completeTask'],['app/src/main/java/com/example/android/architecture/blueprints/todoapp/data/DefaultTaskRepository.kt','DefaultTaskRepository.completeTask'],['app/src/main/java/com/example/android/architecture/blueprints/todoapp/di/DataModules.kt','bindTaskRepository']],
  exact:['onTaskCheckedChange = viewModel::completeTask','onCheckedChange = { onTaskCheckedChange(task, it) }','onCheckedChange = onCheckedChange','taskRepository.completeTask(task.id)'],
  bridges:[['compose-viewmodel-reference','TasksViewModel.completeTask','body-preserved'],['hilt-binds-repository','DefaultTaskRepository.completeTask','body-preserved'],['compose-callback-forwarding','TasksContent','body-preserved'],['compose-forwarded-widget','TaskItem','body-preserved']]
 },
 spring:{
  task:'Trace Spring MVC creation of an Owner with POST /owners/new. Find OwnerController.processCreationForm validation, OwnerRepository.save and Spring Data repository definition, redirect and Owner data model. Exclude vet routes.',
  paths:['src/main/java/org/springframework/samples/petclinic/owner/OwnerController.java','src/main/java/org/springframework/samples/petclinic/owner/OwnerRepository.java','src/main/java/org/springframework/samples/petclinic/owner/Owner.java'],
  spans:[['src/main/java/org/springframework/samples/petclinic/owner/OwnerController.java','OwnerController.processCreationForm']],
  exact:['@PostMapping("/owners/new")','this.owners.save(owner)'],
  bridges:[['spring-data-boundary','OwnerRepository.save (inherited, external)','declaration-only']]
 },
 aspnet:{
  task:'Trace HTTP POST /articles through ArticlesController.Create and mediator.Send(Create.Command) to MediatR IRequestHandler<Create.Command, ArticleEnvelope> in Create.Handler.Handle, request validation and ConduitContext persistence. Exclude users, comments and feed routes.',
  paths:['src/Conduit/Features/Articles/ArticlesController.cs','src/Conduit/Features/Articles/Create.cs','src/Conduit/Infrastructure/ConduitContext.cs'],
  spans:[['src/Conduit/Features/Articles/Create.cs','Create.Handler.Handle']],
  exact:['[HttpPost]','public async ValueTask<IActionResult> Create(','mediator.Send(command, cancellationToken)','IRequestHandler<Command, ArticleEnvelope>','await context.Articles.AddAsync(article, cancellationToken)'],
  bridges:[['mediator-request-handler','Create.Handler.Handle','body-preserved']]
 },
 react:{
  task:'Trace toggle favorite article in React TypeScript, ArticleMeta click via useTogglefavoriteArticle and toggleCallback, articleService.favorite/unfavorite API call, request state and article updating. Exclude registration.',
  paths:['src/app/article/Article/ArticleMeta.tsx','src/app/article/Article/use-toggle-favorite-article.hook.ts','src/application/api/article.service.ts'],
  spans:[['src/app/article/Article/ArticleMeta.tsx','ArticleMeta'],['src/app/article/Article/use-toggle-favorite-article.hook.ts','useTogglefavoriteArticle'],['src/app/article/Article/use-toggle-favorite-article.hook.ts','togglefavoriteArticle'],['src/application/api/article.service.ts','ArticleService.favorite']],
  exact:['toggleCallback','useTogglefavoriteArticle','togglefavoriteArticle'],bridges:[]
 }
};
const results=[];
for(const [name,spec] of Object.entries(cases)){
 if(process.env.AGENTOS_REALWORLD_SCENARIOS&&!process.env.AGENTOS_REALWORLD_SCENARIOS.split(',').includes(name))continue;
 const dir=join(root,name),taskFile=join(dir,'.ai/AI_TASK.md');
 if(!existsSync(taskFile)){results.push({name,passed:false,error:'fixture-not-initialized'});continue;}
 const original=readFileSync(taskFile,'utf8');let failure='';
 try{
  writeFileSync(taskFile,'# Task\n'+spec.task+'\n');
  const p=spawnSync(process.execPath,[cli,'pack','--cwd',dir,'--json'],{encoding:'utf8',timeout:110_000,maxBuffer:4_000_000});
  if(p.error||p.status!==0)failure=(p.error||p.stderr||'unknown pack error').toString().slice(0,180);
 }finally{writeFileSync(taskFile,original);}
 if(failure){results.push({name,passed:false,error:failure});continue;}
 const manifest=JSON.parse(readFileSync(join(dir,'.ai/packs/current-task.manifest.json'),'utf8'));
 const pack=readFileSync(join(dir,'.ai/packs/current-task.md'),'utf8');
 const files=new Set(manifest.entries.map(e=>e.path));const missingPaths=spec.paths.filter(p=>!files.has(p));
 const missingSpans=[];
 for(const [path,symbol] of spec.spans){
  const entry=manifest.entries.find(e=>e.path===path),seg=entry?.segments?.find(s=>s.name===symbol&&s.mode==='full');
  const source=readFileSync(join(dir,path),'utf8');
  const span=seg?source.slice(seg.startOffset,seg.endOffset):'';
  if(!span||!pack.includes(span))missingSpans.push(path+':'+symbol);
 }
 const missingEvidence=spec.exact.filter(s=>!pack.includes(s));
 const missingBridges=spec.bridges.filter(([kind,target,mode])=>!manifest.frameworkBridgeCoverage?.items.some(x=>x.kind===kind&&x.target===target&&x.mode===mode));
 const passed=!missingPaths.length&&!missingSpans.length&&!missingEvidence.length&&!missingBridges.length;
 const result={name,passed,estimatedTokens:manifest.estimatedTokens,packedFiles:manifest.entries.length,frameworkBridgeDiscovered:manifest.frameworkBridgeCoverage?.discovered||0,frameworkBridgeBodies:manifest.frameworkBridgeCoverage?.bodyPreserved||0,
  missingPaths,missingSpans,missingEvidence,missingBridges,notes:name==='spring'?'Spring Data save implementation is external to this repository; declaration-only is intentional.':name==='aspnet'?'C# primary-constructor HTTP action preserved by exact source excerpt, not C# compiler semantic model.':undefined};
 results.push(result);writeFileSync(join(resultDir,name+'.json'),JSON.stringify(result,null,2)+'\n');
 console.log(`${name}: ${passed?'PASS':'FAIL'} — ${manifest.estimatedTokens} estimated tokens; missing ${missingPaths.length+missingSpans.length+missingEvidence.length+missingBridges.length}`);
}
const summary={version:releaseVersion,suite:'five user-supplied real-world repositories',total:results.length,passed:results.filter(x=>x.passed).length,results,
 coverageInterpretation:'A pass means defined source spans and syntax-grounded links are retained in emitted context; not compiler proof, application runtime tests, or full framework semantic parity.'};
writeFileSync(join(resultDir,'summary.json'),JSON.stringify(summary,null,2)+'\n');
console.log(`TOTAL ${summary.passed}/${summary.total}`);
if(summary.passed!==summary.total&&!process.env.AGENTOS_REALWORLD_COMPARE)process.exitCode=1;
