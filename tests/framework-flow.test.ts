import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {execFileSync} from 'node:child_process';
import {initializeTreeSitter} from '../src/treesitter.js';
import {parserRegistry} from '../src/smart.js';
import {discoverFrameworkEvents} from '../src/framework-flow.js';
import {init,pack} from '../src/commands.js';

async function project(files:Record<string,string>,task:string){
 await initializeTreeSitter();const root=mkdtempSync(join(tmpdir(),'agentos-framework-'));
 try{
  for(const [file,body] of Object.entries(files)){const path=join(root,file);mkdirSync(dirname(path),{recursive:true});writeFileSync(path,body);}
  execFileSync('git',['init','-q'],{cwd:root});execFileSync('git',['config','user.name','QA'],{cwd:root});execFileSync('git',['config','user.email','qa@example.test'],{cwd:root});execFileSync('git',['add','.'],{cwd:root});execFileSync('git',['commit','-qm','fixture'],{cwd:root});
  init(root);writeFileSync(join(root,'.ai/AI_TASK.md'),task);
  assert.equal(pack(root).status,'ready');
  const manifest=JSON.parse(readFileSync(join(root,'.ai/packs/current-task.manifest.json'),'utf8'));
  const context=readFileSync(join(root,'.ai/packs/current-task.md'),'utf8');
  return {manifest,context};
 }finally{rmSync(root,{recursive:true,force:true});}
}
const huge='BANNER_DECOY_'+ 'Z'.repeat(12000);

test('Flutter named onPressed callback becomes AST-rooted action and retains exact imported service',async()=>{
 const f=await project({
  'lib/checkout.dart':`import 'pricing.dart';\nclass CheckoutPage { void build() { ElevatedButton(onPressed: submit, child: Text('Buy')); } void submit(){ final service = Pricing(); service.applyDiscount(10); } }\n`,
  'lib/pricing.dart':`class Pricing { int applyDiscount(int n){return n-5;} String publishBanner(){return '${huge}';} }\n`,
 },'Investigate checkout button flow in lib/checkout.dart and retain imported pricing implementation.');
 const r=f.manifest.frameworkFlowCoverage;
 assert.equal(r.discovered,1,JSON.stringify(r));assert.equal(r.verified,1,JSON.stringify(r));
 assert.equal(r.items[0].handler,'CheckoutPage.submit');
 assert.match(f.context,/return n-5/);assert.doesNotMatch(f.context,/BANNER_DECOY_/);
 assert.ok(f.manifest.crossLanguageSymbolCoverage.items.some((x:any)=>x.evidence.startsWith('framework-action+')&&x.name==='Pricing.applyDiscount'));
});

test('Jetpack Compose onClick inline restricts imported calls to callback body',async()=>{
 const f=await project({
  'app/src/main/kotlin/lab/Checkout.kt':`package lab\nimport lab.Pricing\n@Composable fun CheckoutScreen(){ val service = Pricing(); Button(onClick = { service.applyDiscount(10) }) { Text("Buy") }; service.publishBanner() }\n`,
  'app/src/main/kotlin/lab/Pricing.kt':`package lab\nclass Pricing {\n fun applyDiscount(n: Int): Int {\n  return n - 3\n }\n fun publishBanner(): String {\n  return "${huge}"\n }\n}\n`,
 },'Analyze checkout button onClick in app/src/main/kotlin/lab/Checkout.kt and imported service.');
 const r=f.manifest.frameworkFlowCoverage;
 assert.equal(r.discovered,1,JSON.stringify(r));assert.equal(r.verified,1,JSON.stringify(r));
 assert.match(f.context,/return n - 3/);assert.doesNotMatch(f.context,/BANNER_DECOY_/);
 assert.deepEqual(f.manifest.crossLanguageSymbolCoverage.items.map((x:any)=>x.name),['Pricing.applyDiscount']);
});

test('Spring MVC PostMapping endpoint roots handler even if method name not in task',async()=>{
 const f=await project({
  'src/main/java/lab/CheckoutController.java':`package lab;\nimport lab.Pricing;\n@RestController public class CheckoutController { @PostMapping("/checkout") int placeOrder(int sum) { Pricing service = new Pricing(); return service.applyDiscount(sum); } @GetMapping("/health") int health() { return 200; } }\n`,
  'src/main/java/lab/Pricing.java':`package lab;\npublic class Pricing { int applyDiscount(int n) { return n-9; } String publishBanner(){return "${huge}";} }\n`,
 },'Analyze POST checkout endpoint in src/main/java/lab/CheckoutController.java, including imported Pricing.');
 assert.equal(f.manifest.frameworkFlowCoverage.discovered,1,JSON.stringify(f.manifest.frameworkFlowCoverage));
 assert.equal(f.manifest.frameworkFlowCoverage.verified,1,JSON.stringify(f.manifest.frameworkFlowCoverage));
 assert.equal(f.manifest.frameworkFlowCoverage.items[0].handler,'CheckoutController.placeOrder');
 assert.match(f.context,/return n-9/);assert.doesNotMatch(f.context,/BANNER_DECOY_/);
});

test('ASP.NET Core HttpPost endpoint roots handler',async()=>{
 const f=await project({
  'Controllers/CheckoutController.cs':`using Lab.Services;\n[ApiController] public class CheckoutController : ControllerBase { [HttpPost("checkout")] public int PlaceOrder(int sum) { var service = new Pricing(); return service.ApplyDiscount(sum); } [HttpGet("health")] public int Health(){return 200;} }\n`,
  'Services/Pricing.cs':`namespace Lab.Services; public class Pricing { public int ApplyDiscount(int n){return n-12;} public string PublishBanner(){return "${huge}";} }\n`,
 },'Investigate ASP.NET POST checkout endpoint in Controllers/CheckoutController.cs.');
 assert.equal(f.manifest.frameworkFlowCoverage.discovered,1,JSON.stringify(f.manifest.frameworkFlowCoverage));
 assert.equal(f.manifest.frameworkFlowCoverage.verified,1,JSON.stringify(f.manifest.frameworkFlowCoverage));
 assert.match(f.context,/return n-12/);assert.doesNotMatch(f.context,/BANNER_DECOY_/);
});

test('framework markers in comments/strings never create action roots',async()=>{
 await initializeTreeSitter();
 const code=`class CheckoutPage { void build() { // onPressed: fake\n final note = 'onPressed: fake'; } void fake() { } }`;
 const segments=parserRegistry.analyze('lib/checkout.dart',code).segments;
 assert.deepEqual(discoverFrameworkEvents('lib/checkout.dart',code,segments,'Analyze lib/checkout.dart button'),[]);
 const code2=`package lab; class CheckoutController { /* @PostMapping("checkout") */ int submit(){return 1;} }`;
 assert.deepEqual(discoverFrameworkEvents('src/main/java/lab/CheckoutController.java',code2,parserRegistry.analyze('src/main/java/lab/CheckoutController.java',code2).segments,'checkout'),[]);
});

test('Spring MVC constructor-injected concrete field links POST handler to service implementation',async()=>{
 const f=await project({
  'src/main/java/lab/CheckoutController.java':`package lab;\nimport lab.Pricing;\n@RestController public class CheckoutController {\n private final Pricing pricing;\n public CheckoutController(Pricing service) { this.pricing = service; }\n @PostMapping("/checkout") int placeOrder(int sum) { return pricing.applyDiscount(sum); }\n @GetMapping("/health") int health(){return 200;}\n}\n`,
  'src/main/java/lab/Pricing.java':'package lab; public class Pricing { int applyDiscount(int n){return n-20;} }',
 },'Analyze checkout POST endpoint in src/main/java/lab/CheckoutController.java.');
 assert.equal(f.manifest.frameworkFlowCoverage.verified,1,JSON.stringify(f.manifest.frameworkFlowCoverage));
 assert.ok(f.manifest.crossLanguageSymbolCoverage.items.some((x:any)=>x.evidence.includes('constructor-injected-field')));
 assert.match(f.context,/return n-20/);
});

test('ASP.NET Core constructor-injected concrete service links controller action',async()=>{
 const f=await project({
  'Controllers/CheckoutController.cs':`using Lab.Services;\n[ApiController] public class CheckoutController : ControllerBase {\n private readonly Pricing _pricing;\n public CheckoutController(Pricing pricing) { _pricing = pricing; }\n [HttpPost("checkout")] public int PlaceOrder(int sum) { return _pricing.ApplyDiscount(sum); }\n [HttpGet("health")] public int Health(){return 200;}\n}\n`,
  'Services/Pricing.cs':'namespace Lab.Services; public class Pricing { public int ApplyDiscount(int n){return n-22;} }',
 },'Audit POST checkout in Controllers/CheckoutController.cs.');
 assert.equal(f.manifest.frameworkFlowCoverage.verified,1,JSON.stringify(f.manifest.frameworkFlowCoverage));
 assert.ok(f.manifest.crossLanguageSymbolCoverage.items.some((x:any)=>x.evidence.includes('constructor-injected-field')));
 assert.match(f.context,/return n-22/);
});

test('unresolved interface injection does not claim concrete implementation without binding proof',async()=>{
 const f=await project({
  'Controllers/CheckoutController.cs':`using Lab.Services;\n[ApiController] public class CheckoutController : ControllerBase {\n private readonly IPricing _pricing;\n public CheckoutController(IPricing pricing) { _pricing = pricing; }\n [HttpPost("checkout")] public int PlaceOrder(int sum) { return _pricing.ApplyDiscount(sum); }\n}\n`,
  'Services/Pricing.cs':'namespace Lab.Services; public class Pricing { public int ApplyDiscount(int n){return n-22;} }',
 },'Audit checkout POST in Controllers/CheckoutController.cs.');
 assert.equal(f.manifest.frameworkFlowCoverage.discovered,1);
 assert.equal(f.manifest.frameworkFlowCoverage.verified,0,JSON.stringify(f.manifest.frameworkFlowCoverage));
 assert.equal(f.manifest.crossLanguageSymbolCoverage.discovered,0);
});

test('Flutter arrow callback to named action is not lost',async()=>{
 const f=await project({
 'lib/checkout.dart':`import 'pricing.dart';\nclass CheckoutPage { void build(){ ElevatedButton(onPressed: () => submit(), child: Text('Buy')); } void submit(){ final service = Pricing(); service.applyDiscount(10); } }\n`,
 'lib/pricing.dart':'class Pricing { int applyDiscount(int n){return n-18;} }',
 },'Review checkout button in lib/checkout.dart.');
 assert.equal(f.manifest.frameworkFlowCoverage.verified,1,JSON.stringify(f.manifest.frameworkFlowCoverage));
 assert.match(f.context,/return n-18/);
});

test('Flutter inline arrow callback restricts API promotion to its receiver call',async()=>{
 const f=await project({
 'lib/checkout.dart':`import 'pricing.dart';\nclass CheckoutPage { void build(){ final service = Pricing(); ElevatedButton(onPressed: () => service.applyDiscount(10), child: Text('Buy')); service.publishBanner(); } }\n`,
 'lib/pricing.dart':'class Pricing { int applyDiscount(int n){return n-8;} String publishBanner(){return "BAD_BANNER_SENTINEL";} }',
 },'Review checkout button in lib/checkout.dart.');
 assert.equal(f.manifest.frameworkFlowCoverage.verified,1,JSON.stringify(f.manifest.frameworkFlowCoverage));
 assert.ok(f.manifest.crossLanguageSymbolCoverage.items.every((x:any)=>x.name!=='Pricing.publishBanner'));
});

test('generic Kotlin callback named onClick is not falsely reported as Jetpack Compose UI',async()=>{
 await initializeTreeSitter();
 const code='fun setup(){ val onClick = { service.applyDiscount(10) }; onClick() }';
 const segments=parserRegistry.analyze('app/worker.kt',code).segments;
 assert.deepEqual(discoverFrameworkEvents('app/worker.kt',code,segments,'Investigate app/worker.kt handler'),[]);
});

test('generic Dart named argument is not promoted as Flutter event without Widget AST evidence',async()=>{
 await initializeTreeSitter();
 const code='void setup(){ registerAction(onPressed: submit); } void submit() {}';
 const segments=parserRegistry.analyze('lib/worker.dart',code).segments;
 assert.deepEqual(discoverFrameworkEvents('lib/worker.dart',code,segments,'Investigate lib/worker.dart callback'),[]);
});

test('Compose inline state write without a function call is a root-only event, not fake cross-file flow',async()=>{
 const f=await project({
  'app/src/main/kotlin/lab/Checkout.kt':`package lab\nimport lab.Pricing\n@Composable fun CheckoutScreen(){ var count = 0; Button(onClick = { count++ }) { Text("Buy") }; val service=Pricing(); service.publishBanner() }\n`,
  'app/src/main/kotlin/lab/Pricing.kt':`package lab\nclass Pricing {\n fun publishBanner(): String { return "UNRELATED_BANNER" }\n}\n`,
 },'Review checkout button state update in app/src/main/kotlin/lab/Checkout.kt.');
 const r=f.manifest.frameworkFlowCoverage;
 assert.equal(r.discovered,1,JSON.stringify(r));
 assert.equal(r.rootOnly,1,JSON.stringify(r));
 assert.deepEqual(r.items[0].observedWrites,['count']);
 assert.equal(f.manifest.crossLanguageSymbolCoverage.discovered,0);
});

test('Flutter onPressed setState is retained as a UI action with observed state API but not fabricated backend link',async()=>{
 const f=await project({
  'lib/checkout.dart':`class CheckoutPage { int count=0; void build(){ ElevatedButton(onPressed: update, child: Text('Buy')); } void update(){ setState(() { count++; }); } }`,
 },'Analyze checkout button and state update in lib/checkout.dart.');
 const r=f.manifest.frameworkFlowCoverage;
 assert.equal(r.discovered,1,JSON.stringify(r));
 assert.equal(r.rootOnly,1);assert.deepEqual(r.items[0].observedStateApi,['setState']);
});

test('two Compose click handlers do not inherit another handler imported service evidence',async()=>{
 const f=await project({
  'app/src/main/kotlin/lab/Checkout.kt':`package lab\nimport lab.Pricing\n@Composable fun CheckoutScreen(){ val service=Pricing(); var count=0; Button(onClick = { service.applyDiscount(10) }) { Text("Buy") }; Button(onClick = { count++ }) { Text("More") } }\n`,
  'app/src/main/kotlin/lab/Pricing.kt':`package lab\nclass Pricing {\n fun applyDiscount(n: Int): Int {\n  return n-42\n }\n}\n`,
 },'Investigate checkout button actions in app/src/main/kotlin/lab/Checkout.kt.');
 const r=f.manifest.frameworkFlowCoverage;
 assert.equal(r.discovered,2,JSON.stringify(r));
 assert.equal(r.verified,1,JSON.stringify(r));
 assert.equal(r.rootOnly,1,JSON.stringify(r));
 assert.ok(r.items.some((x:any)=>x.observedWrites?.includes('count')&&x.linkedDefinitions.length===0));
});

test('ASP.NET registered interface is resolved only through unique DI plus concrete interface implementation',async()=>{
 const f=await project({
 'Program.cs':'using Lab.Services; var builder=WebApplication.CreateBuilder(args); builder.Services.AddScoped<IPricing, Pricing>();',
 'Controllers/CheckoutController.cs':`using Lab.Services; [ApiController] public class CheckoutController : ControllerBase {
 private readonly IPricing _pricing;
 public CheckoutController(IPricing pricing){ _pricing = pricing; }
 [HttpPost("checkout")] public int PlaceOrder(int amount){ return _pricing.ApplyDiscount(amount); }
 [HttpGet("health")] public int Health(){ return 200; }
 }`,
 'Services/IPricing.cs':'namespace Lab.Services; public interface IPricing { int ApplyDiscount(int amount); }',
 'Services/Pricing.cs':'namespace Lab.Services; public class Pricing : IPricing { public int ApplyDiscount(int amount){ return amount-501; } public string PublishBanner(){ return "${huge}"; } }'
 },'Investigate checkout endpoint in Controllers/CheckoutController.cs and DI implementation.');
 assert.ok(f.manifest.diResolution.registrations>=1,JSON.stringify(f.manifest.diResolution));
 assert.ok(f.manifest.diResolution.verifiedBindings>=1,JSON.stringify(f.manifest.diResolution));
 assert.equal(f.manifest.frameworkFlowCoverage.verified,1,JSON.stringify(f.manifest.frameworkFlowCoverage));
 assert.ok(f.manifest.crossLanguageSymbolCoverage.items.some((x:any)=>x.evidence.includes('registered-interface-injection')));
 assert.match(f.context,/return amount-501/);assert.doesNotMatch(f.context,/BANNER_DECOY_/);
});

test('Spring @Service implements unique interface and controller constructor link is real',async()=>{
 const f=await project({
 'src/main/java/lab/IPricing.java':'package lab; public interface IPricing { int discount(int x); }',
 'src/main/java/lab/Pricing.java':'package lab; @Service public class Pricing implements IPricing { public int discount(int x){return x-601;} String advert(){return "${huge}";} }',
 'src/main/java/lab/CheckoutController.java':`package lab;
import lab.IPricing;
@RestController public class CheckoutController {
 private final IPricing pricing;
 public CheckoutController(IPricing pricing){ this.pricing = pricing; }
 @PostMapping("/checkout") int placeOrder(int amount) { return pricing.discount(amount); }
}`,
 },'Analyze POST checkout in src/main/java/lab/CheckoutController.java with injected service.');
 assert.equal(f.manifest.diResolution.verifiedBindings,1,JSON.stringify(f.manifest.diResolution));
 assert.match(f.context,/return x-601/);assert.doesNotMatch(f.context,/BANNER_DECOY_/);
});

test('multiple DI registrations must not bind an arbitrary service',async()=>{
 const f=await project({
 'Program.cs':`var b=WebApplication.CreateBuilder(args);
 b.Services.AddScoped<IPricing, Pricing>(); b.Services.AddSingleton<IPricing, OtherPricing>();`,
 'Controllers/CheckoutController.cs':`using Lab.Services;
[ApiController] public class CheckoutController : ControllerBase {
 private readonly IPricing _pricing;
 public CheckoutController(IPricing pricing){ _pricing = pricing; }
 [HttpPost("checkout")] public int PlaceOrder(int amount){return _pricing.ApplyDiscount(amount);}
}`,
 'Services/Pricing.cs':'namespace Lab.Services; public class Pricing : IPricing { public int ApplyDiscount(int amount){return amount-5;} }',
 'Services/OtherPricing.cs':'namespace Lab.Services; public class OtherPricing : IPricing { public int ApplyDiscount(int amount){return amount-9;} }',
 },'Review checkout endpoint in Controllers/CheckoutController.cs.');
 assert.equal(f.manifest.diResolution.verifiedBindings,0,JSON.stringify(f.manifest.diResolution));
 assert.equal(f.manifest.diResolution.ambiguous>0,true);
});

test('Compose typed ViewModel callback resolves implementation and excludes sibling advertisement',async()=>{
 const f=await project({
 'app/src/main/kotlin/lab/Checkout.kt':`package lab
import lab.CheckoutViewModel
@Composable fun CheckoutScreen(){ val vm: CheckoutViewModel = viewModel(); Button(onClick = { vm.placeOrder(5) }) { Text("Go") } }`,
 'app/src/main/kotlin/lab/CheckoutViewModel.kt':`package lab
class CheckoutViewModel {
 fun placeOrder(amount: Int): Int { return amount-701 }
 fun publishBanner(): String { return "${huge}" }
}`,
 },'Analyze checkout click in app/src/main/kotlin/lab/Checkout.kt and ViewModel.');
 assert.equal(f.manifest.frameworkStateCoverage.verified,1,JSON.stringify(f.manifest.frameworkStateCoverage));
 assert.match(f.context,/return amount-701/);assert.doesNotMatch(f.context,/BANNER_DECOY_/);
});

test('Riverpod ref.read(provider.notifier).action uses unique registered notifier',async()=>{
 const f=await project({
 'lib/checkout.dart':`import 'cart_provider.dart';
class CheckoutPage { void build(){ ElevatedButton(onPressed: () { ref.read(cartProvider.notifier).addItem(5); }, child: Text('Go')); } }`,
 'lib/cart_provider.dart':`final cartProvider = StateNotifierProvider<CartNotifier, int>((ref) => CartNotifier());
class CartNotifier extends StateNotifier<int> {
 void addItem(int amount){ state += amount + 801; }
 String publishBanner(){ return "${huge}"; }
}`,
 },'Analyze checkout button and Riverpod state in lib/checkout.dart.');
 assert.equal(f.manifest.frameworkStateCoverage.verified,1,JSON.stringify(f.manifest.frameworkStateCoverage));
 assert.match(f.context,/state \+= amount \+ 801/);assert.doesNotMatch(f.context,/BANNER_DECOY_/);
});

test('Flutter BLoC event dispatch binds only the unique on<Event> callback',async()=>{
 const f=await project({
 'lib/checkout.dart':`import 'cart_bloc.dart';
class CheckoutPage { void build(){ ElevatedButton(onPressed: () { context.read<CartBloc>().add(CartAdded()); }, child: Text('Add')); } }`,
 'lib/cart_bloc.dart':`class CartAdded {}
class CartBloc extends Bloc<CartAdded, int> {
 CartBloc(){ on<CartAdded>(_onAdded); }
 void _onAdded(CartAdded event, Emitter<int> emit){ emit(902); }
 String publishBanner(){ return "${huge}"; }
}`,
 },'Trace checkout button in lib/checkout.dart via BLoC.');
 assert.equal(f.manifest.frameworkStateCoverage.verified,1,JSON.stringify(f.manifest.frameworkStateCoverage));
 assert.match(f.context,/emit\(902\)/);assert.doesNotMatch(f.context,/BANNER_DECOY_/);
});

test('Compose ViewModel StateFlow read/write channel is reported only when the clicked method writes backing flow',async()=>{
 const f=await project({
 'app/src/main/kotlin/lab/Checkout.kt':`package lab
import lab.CheckoutViewModel
@Composable fun CheckoutScreen(){ val vm: CheckoutViewModel = hiltViewModel(); val count by vm.uiState.collectAsState(); Button(onClick = { vm.placeOrder() }) { Text("Buy") } }`,
 'app/src/main/kotlin/lab/CheckoutViewModel.kt':`package lab
class CheckoutViewModel {
 private val _uiState = MutableStateFlow(0)
 val uiState = _uiState.asStateFlow()
 fun placeOrder() { _uiState.value = 1010 }
}`,
 },'Audit checkout click and state in app/src/main/kotlin/lab/Checkout.kt.');
 assert.equal(f.manifest.frameworkStateCoverage.verified,1,JSON.stringify(f.manifest.frameworkStateCoverage));
 assert.equal(f.manifest.frameworkStateCoverage.propagated,1,JSON.stringify(f.manifest.frameworkStateCoverage));
 assert.equal(f.manifest.frameworkStateCoverage.items[0].propagation.channel,'uiState');
 assert.match(f.context,/_uiState.value = 1010/);
});

test('Compose unrelated ViewModel method mutating state does not invent click-to-state propagation',async()=>{
 const f=await project({
 'app/src/main/kotlin/lab/Checkout.kt':`package lab
import lab.CheckoutViewModel
@Composable fun CheckoutScreen(){ val vm: CheckoutViewModel = viewModel(); val count by vm.uiState.collectAsState(); Button(onClick = { vm.placeOrder() }) { Text("Buy") } }`,
 'app/src/main/kotlin/lab/CheckoutViewModel.kt':`package lab
class CheckoutViewModel {
 private val _uiState = MutableStateFlow(0)
 val uiState = _uiState.asStateFlow()
 fun placeOrder(){ println("submit") }
 fun unrelated(){ _uiState.value = 500 }
}`,
 },'Audit checkout click in app/src/main/kotlin/lab/Checkout.kt.');
 assert.equal(f.manifest.frameworkStateCoverage.verified,1,JSON.stringify(f.manifest.frameworkStateCoverage));
 assert.equal(f.manifest.frameworkStateCoverage.propagated,0);
});

test('Riverpod ref.watch same provider plus retained notifier state write provides static paired state evidence',async()=>{
 const f=await project({
 'lib/checkout.dart':`import 'cart_provider.dart';
class CheckoutPage { void build(){ final count = ref.watch(cartProvider); ElevatedButton(onPressed: () { ref.read(cartProvider.notifier).addItem(5); }, child: Text('Add')); } }`,
 'lib/cart_provider.dart':`final cartProvider = StateNotifierProvider<CartNotifier, int>((ref) => CartNotifier());
class CartNotifier extends StateNotifier<int> { void addItem(int x){ state += x; } }`,
 },'Check Riverpod checkout button in lib/checkout.dart.');
 assert.equal(f.manifest.frameworkStateCoverage.verified,1,JSON.stringify(f.manifest.frameworkStateCoverage));
 assert.equal(f.manifest.frameworkStateCoverage.propagated,1,JSON.stringify(f.manifest.frameworkStateCoverage));
 assert.equal(f.manifest.frameworkStateCoverage.items[0].propagation.channel,'cartProvider');
});

test('Riverpod duplicated provider definitions are unresolved, never guessed',async()=>{
 const f=await project({
 'lib/checkout.dart':`import 'cart_provider.dart'; class CheckoutPage { void build(){ ElevatedButton(onPressed: () { ref.read(cartProvider.notifier).addItem(5); }, child: Text('Add')); } }`,
 'lib/cart_provider.dart':`final cartProvider = StateNotifierProvider<CartNotifier, int>((ref)=>CartNotifier()); class CartNotifier extends StateNotifier<int> { void addItem(int x){state += x;} }`,
 'lib/extra.dart':`final cartProvider = StateNotifierProvider<OtherNotifier, int>((ref)=>OtherNotifier()); class OtherNotifier extends StateNotifier<int> { void addItem(int x){state += x+999;} }`,
 },'Check Riverpod checkout button in lib/checkout.dart.');
 assert.equal(f.manifest.frameworkStateCoverage.verified,0,JSON.stringify(f.manifest.frameworkStateCoverage));
 assert.equal(f.manifest.frameworkStateCoverage.discovered,0);
});

test('Spring explicit @Configuration @Bean interface mapping selects exact implementation',async()=>{
 const f=await project({
 'src/main/java/lab/Config.java':`package lab; @Configuration public class Config { @Bean public IPricing pricing(){ return new Pricing(); } }`,
 'src/main/java/lab/CheckoutController.java':`package lab;
import lab.IPricing;
@RestController public class CheckoutController { private final IPricing pricing;
public CheckoutController(IPricing pricing){this.pricing=pricing;}
@PostMapping("/checkout") int placeOrder(int sum){return pricing.discount(sum);}}`,
 'src/main/java/lab/Pricing.java':'package lab; public class Pricing implements IPricing { public int discount(int n){return n-1121;} }',
 'src/main/java/lab/IPricing.java':'package lab; public interface IPricing { int discount(int n); }',
 },'Review checkout in src/main/java/lab/CheckoutController.java.');
 assert.equal(f.manifest.diResolution.verifiedBindings,1,JSON.stringify(f.manifest.diResolution));
 assert.match(f.context,/return n-1121/);
});

test('ASP.NET typeof DI overload is recognized with source-grounded implementation',async()=>{
 const f=await project({
 'Program.cs':'var builder=WebApplication.CreateBuilder(args); builder.Services.AddTransient(typeof(IPricing), typeof(Pricing));',
 'Controllers/CheckoutController.cs':`using Lab.Services;
[ApiController] public class CheckoutController: ControllerBase { private readonly IPricing _service;
 public CheckoutController(IPricing service){_service=service;}
 [HttpPost("checkout")] public int PlaceOrder(int sum){return _service.ApplyDiscount(sum);} }`,
 'Services/Pricing.cs':'namespace Lab.Services; public class Pricing : IPricing { public int ApplyDiscount(int sum){return sum-1190;} }',
 },'Trace checkout action in Controllers/CheckoutController.cs.');
 assert.equal(f.manifest.diResolution.verifiedBindings,1,JSON.stringify(f.manifest.diResolution));
 assert.match(f.context,/return sum-1190/);
});

test('commented or string-embedded DI registration cannot resolve interface',async()=>{
 const f=await project({
 'Program.cs':`var note="builder.Services.AddScoped<IPricing, Pricing>()";
// builder.Services.AddScoped<IPricing, Pricing>();`,
 'Controllers/CheckoutController.cs':`using Lab.Services;
[ApiController] public class CheckoutController: ControllerBase { private readonly IPricing _service;
 public CheckoutController(IPricing service){_service=service;}
 [HttpPost("checkout")] public int PlaceOrder(int sum){return _service.ApplyDiscount(sum);} }`,
 'Services/Pricing.cs':'namespace Lab.Services; public class Pricing : IPricing { public int ApplyDiscount(int sum){return sum-1190;} }',
 },'Trace checkout in Controllers/CheckoutController.cs.');
 assert.equal(f.manifest.diResolution.registrations,0);
 assert.equal(f.manifest.diResolution.verifiedBindings,0);
});

test('two Flutter callbacks cannot inherit each other\'s Riverpod state implementation',async()=>{
 const f=await project({
 'lib/checkout.dart':`import 'cart_provider.dart';
class CheckoutPage { int count=0; void build(){ ElevatedButton(onPressed: () { ref.read(cartProvider.notifier).addItem(10); }, child: Text('Cart')); ElevatedButton(onPressed: () { count++; }, child: Text('Local')); } }`,
 'lib/cart_provider.dart':`final cartProvider = StateNotifierProvider<CartNotifier, int>((ref)=>CartNotifier()); class CartNotifier extends StateNotifier<int> { void addItem(int n){state += n;} }`,
 },'Trace checkout button and state in lib/checkout.dart.');
 assert.equal(f.manifest.frameworkFlowCoverage.discovered,2,JSON.stringify(f.manifest.frameworkFlowCoverage));
 assert.equal(f.manifest.frameworkFlowCoverage.verified,1,JSON.stringify(f.manifest.frameworkFlowCoverage));
 assert.equal(f.manifest.frameworkFlowCoverage.rootOnly,1,JSON.stringify(f.manifest.frameworkFlowCoverage));
});
