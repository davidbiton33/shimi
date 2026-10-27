import test from 'node:test';
import assert from 'node:assert/strict';
import {scanFrameworkBridges} from '../src/framework-bridges.js';
import type {GraphNode} from '../src/graph.js';
function scan(files:Record<string,string>){
 const nodes=Object.keys(files).map(path=>({path}) as GraphNode);
 return scanFrameworkBridges(nodes,path=>files[path]||null).bridges;
}
test('Flutter Command0 tear-off requires typed widget field and unique VM constructor binding',()=>{
 const files={
  'lib/booking_screen.dart':'class BookingScreen { final BookingViewModel viewModel; Widget build() { return Button(onPressed: widget.viewModel.createBooking.execute); } }',
  'lib/booking_viewmodel.dart':'class BookingViewModel { late final Command0 createBooking; BookingViewModel() {createBooking = Command0(_createBooking);} Future<void> _createBooking() async { return; }}'
 };
 const matches=scan(files);assert.equal(matches.length,1);assert.equal(matches[0]!.target,'BookingViewModel._createBooking');
 assert.equal(scan({...files,'duplicate.dart':'class BookingViewModel { }'}).length,0);
 assert.equal(scan({...files,'lib/booking_screen.dart':'class BookingScreen { final BookingViewModel viewModel; // onPressed: widget.viewModel.createBooking.execute\n }'}).length,0);
 assert.equal(scan({...files,'lib/booking_viewmodel.dart':files['lib/booking_viewmodel.dart'].replace('Command0(_createBooking)','Command0(_other)')}).length,0);
});
test('Compose typed hiltViewModel member reference requires real matching method',()=>{
 const files={
  'screens/TasksScreen.kt':'@Composable fun TasksScreen(viewModel: TasksViewModel = hiltViewModel()) { Content(onCheck = viewModel::completeTask) }',
  'model/TasksViewModel.kt':'class TasksViewModel { fun completeTask(task: Task) { } }'
 };
 assert.equal(scan(files).find(x=>x.kind==='compose-viewmodel-reference')?.target,'TasksViewModel.completeTask');
 assert.equal(scan({...files,'model/TasksViewModel.kt':'class TasksViewModel { fun otherTask(task: Task) { } }'}).length,0);
 assert.equal(scan({...files,'another.kt':'class TasksViewModel {}'}).length,0);
});
test('Hilt @Binds requires unique explicit implementation and typed VM receiver',()=>{
 const files={
  'di/Bindings.kt':'@Module abstract class Bindings { @Binds abstract fun bind(repo: DefaultTaskRepository): TaskRepository }',
  'data/DefaultTaskRepository.kt':'class DefaultTaskRepository @Inject constructor() : TaskRepository { override suspend fun completeTask(id: String) {} }',
  'tasks/TasksViewModel.kt':'class TasksViewModel @Inject constructor(private val taskRepository: TaskRepository) { fun completeTask() { taskRepository.completeTask("1") } }'
 };
 const found=scan(files).find(x=>x.kind==='hilt-binds-repository');assert.equal(found?.target,'DefaultTaskRepository.completeTask');
 assert.equal(scan({...files,'di/Another.kt':'@Binds abstract fun another(x: OtherTaskRepository): TaskRepository','data/OtherTaskRepository.kt':'class OtherTaskRepository() : TaskRepository {}'}).filter(x=>x.kind==='hilt-binds-repository').length,0);
 assert.equal(scan({...files,'tasks/TasksViewModel.kt':'class TasksViewModel { // taskRepository.completeTask("1")\n private val taskRepository: TaskRepository }'}).filter(x=>x.kind==='hilt-binds-repository').length,0);
});
test('C# MediatR validates typed param, same namespace and feature, real scoped Send',()=>{
 const files={
  'src/Articles/ArticlesController.cs':`namespace App.Articles; public class ArticlesController { [HttpPost] public async ValueTask<IActionResult> Create([FromBody] Create.Command command, CancellationToken ct) => await mediator.Send(command, ct); }`,
  'src/Articles/Create.cs':`namespace App.Articles; public class Create { public record Command() : IRequest<Result>; public class Handler : IRequestHandler<Command, Result> { public Result Handle(Command c) {} } }`
 };
 assert.equal(scan(files).find(x=>x.kind==='mediator-request-handler')?.target,'Create.Handler.Handle');
 assert.equal(scan({...files,'src/Articles/Create.cs':files['src/Articles/Create.cs'].replace('IRequestHandler<Command, Result>','IRequestHandler<Update, Result>')}).length,0);
 assert.equal(scan({...files,'src/Other/Create.cs':files['src/Articles/Create.cs'],'src/Articles/Create.cs':'namespace App.Other; class Create {}'}).length,0);
 // An unrelated sibling action must not provide the only Send evidence.
 assert.equal(scan({...files,'src/Articles/ArticlesController.cs':`namespace App.Articles; class ArticlesController { [HttpPost] public string Create(Create.Command command) => "ignored"; [HttpPut] public string Edit(Create.Command command) => mediator.Send(command); }`}).filter(x=>x.caller.startsWith('Create:')).length,0);
});
test('Spring Data inherited save is reported as framework boundary, never as local body',()=>{
 const files={
  'owner/OwnerController.java':'class OwnerController { private final OwnerRepository owners; @PostMapping("/owners/new") void processCreationForm(Owner owner) {this.owners.save(owner);} }',
  'owner/OwnerRepository.java':'interface OwnerRepository extends CrudRepository<Owner,Integer> {}'
 };
 const found=scan(files).find(x=>x.kind==='spring-data-boundary');
 assert.equal(found?.certainty,'framework-boundary');
 assert.equal(scan({...files,'owner/OwnerController.java':files['owner/OwnerController.java'].replace('this.owners.save(owner)','this.other.save(owner)')}).length,0);
});
