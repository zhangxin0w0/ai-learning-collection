const fs = require('fs');
const vm = require('vm');

let code = fs.readFileSync(__dirname + '/_real.js', 'utf8');
// expose internals for testing
code += `\n;globalThis.__T = { STATE, compute, allItems, wgs84togcj02, isToilet, haversine, getSpot, userPos, merged, drawLive, refreshLiveData, navigateTo, decodeQQPolyline, drawRoute, getRouteLayer:()=>routeLayer };`;

// ---- minimal browser mocks ----
function makeEl(){
  const el = {
    style:{}, dataset:{}, _children:[],
    classList:{ toggle(){}, add(){}, remove(){}, contains(){ return false; } },
    appendChild(c){ this._children.push(c); return c; }, remove(){},
    addEventListener(){}, removeEventListener(){},
    querySelector(){ return makeEl(); },
    querySelectorAll(){ return []; },
    setAttribute(){}, getAttribute(){ return null; },
    getElementById(){ return makeEl(); },
    onclick:null, onchange:null, oninput:null,
    value:'', innerHTML:'', textContent:'', checked:false,
    get clientWidth(){ return 560; }, get clientHeight(){ return 400; },
    getBoundingClientRect(){ return {left:0,top:0,width:560,height:400}; },
  };
  return el;
}
const documentMock = {
  getElementById(){ return makeEl(); },
  createElement(){ return makeEl(); },
  querySelector(){ return makeEl(); },
  querySelectorAll(){ return []; },
  addEventListener(){}, body:makeEl(), head:makeEl(),
};
const localStorageMock = { _d:{}, getItem(k){ return this._d[k]??null; }, setItem(k,v){ this._d[k]=v; } };
const windowMock = {
  TMap: undefined,
  addEventListener(){}, open(u){ this._opened=u; }, location:{ hostname:'test.host' }, alert(){},
};
const sandbox = {
  document: documentMock, window: windowMock, localStorage: localStorageMock,
  navigator: { geolocation: { getCurrentPosition(){} } },
  location: { hostname:'test.host' },
  console,   setTimeout, clearTimeout, Math, Date, JSON, Set, Map, Object, Array, parseInt, parseFloat, isNaN,
  encodeURIComponent, decodeURIComponent, encodeURI,
  btoa:function(s){ return Buffer.from(s,'binary').toString('base64'); },
  atob:function(s){ return Buffer.from(s,'base64').toString('binary'); },
  unescape:global.unescape, escape:global.escape,
  alert(){}, confirm(){ return true; },
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(code, sandbox, { filename:'jicshi-real.js' });

const T = sandbox.__T;
let pass = 0, fail = 0;
function ok(name, cond, extra){ if(cond){ pass++; console.log('  PASS', name); } else { fail++; console.log('  FAIL', name, extra!==undefined?JSON.stringify(extra):''); } }

console.log('--- 1) WGS84 -> GCJ02 坐标转换（解决定位不准）---');
const g = T.wgs84togcj02(39.9087, 116.3975);
ok('返回长度为2', Array.isArray(g) && g.length===2);
ok('纬度偏移在合理范围(0~0.01)', g[0] > 39.9087 && g[0] - 39.9087 < 0.01, g[0]);
ok('经度偏移在合理范围(0~0.01)', g[1] > 116.3975 && g[1] - 116.3975 < 0.01, g[1]);

console.log('--- 2) isToilet 厕所判定增强 ---');
ok('命中“公厕”', T.isToilet({ title:'某某公厕', category:'' }) === true);
ok('命中“卫生间”', T.isToilet({ title:'卫生间', category:'生活服务' }) === true);
ok('命中英文 toilet', T.isToilet({ title:'Public Toilet', category:'' }) === true);
ok('命中“第三卫生间”', T.isToilet({ title:'第三卫生间', category:'' }) === true);
ok('排除“餐厅”', T.isToilet({ title:'海底捞餐厅', category:'美食' }) === false);
ok('排除“酒店”', T.isToilet({ title:'如家酒店', category:'酒店' }) === false);
ok('排除无关键词', T.isToilet({ title:'星巴克', category:'咖啡' }) === false);

console.log('--- 3) allItems 示例默认不展示（需求④）---');
T.STATE.spotChosen = false; T.STATE.live = false; T.STATE.liveItems = []; T.STATE.trip.active = false;
ok('默认返回空（示例不污染真实数据）', T.allItems().length === 0);
T.STATE.spotChosen = true; T.STATE.spot = 'gugong';
ok('手动选景区后展示示例', T.allItems().length === 5);

console.log('--- 4) compute 半径过滤（需求⑤）---');
T.STATE.spotChosen = true; T.STATE.spot = 'gugong'; T.STATE.live = false; T.STATE.liveItems = [];
T.STATE.filters = { baby:false, old:false, female:false };
T.STATE.radius = 500;
let arr = T.compute();
ok('500m 半径下结果 <= 全部5个', arr.length <= 5, arr.length);
ok('所有结果距离 <= 500m', arr.every(x => x.d <= 500));
T.STATE.radius = 3000;
arr = T.compute();
ok('3000m 半径下能列出更多', arr.length >= 5, arr.length);

console.log('--- 5) 优先级：有真实数据时不显示示例（需求④）---');
T.STATE.live = true;
T.STATE.liveItems = [{ id:'live_1', name:'真实公厕', pos:[39.9150,116.3975], type:'实时' }];
ok('live 且有数据 -> 只返回真实数据', T.allItems().length === 1 && T.allItems()[0].live === true);
T.STATE.live = false;

console.log(`\n逻辑测试: ${pass} passed, ${fail} failed`);

// ---- Part 6: marker rendering (需求①②③) via mocked TMap.MultiMarker ----
console.log('\n--- 6) drawLive 生成 MultiMarker 地图标记 ---');
let pass6 = 0, fail6 = 0;
function ok6(name, cond, extra){ if(cond){ pass6++; console.log('  PASS', name); } else { fail6++; console.log('  FAIL', name, extra!==undefined?JSON.stringify(extra):''); } }

let lastMarker=null, lastPolyline=null;
function FakeMarkerStyle(o){ Object.assign(this,o); }
function FakeMultiMarker(o){ this.opts=o; this.geoms=o.geometries||[]; this.styles=o.styles||{}; this._click=null; lastMarker=this; }
FakeMultiMarker.prototype.on=function(ev,cb){ if(ev==='click') this._click=cb; };
FakeMultiMarker.prototype.setMap=function(m){ this.map=m; };
function FakeLatLng(a,b){ this.lat=a; this.lng=b; }
function FakePolylineStyle(o){ Object.assign(this,o); }
function FakeMultiPolyline(o){ this.opts=o; this.geoms=o.geometries||[]; lastPolyline=this; }
FakeMultiPolyline.prototype.setGeometries=function(g){ this.geoms=g; };
FakeMultiPolyline.prototype.setMap=function(m){ this.map=m; };
function FakeLatLngBounds(pts){ this.pts=pts; }
const TMapMock = {
  LatLng: FakeLatLng,
  MarkerStyle: FakeMarkerStyle,
  MultiMarker: FakeMultiMarker,
  PolylineStyle: FakePolylineStyle,
  MultiPolyline: FakeMultiPolyline,
  LatLngBounds: FakeLatLngBounds,
  Map: function(){ this.removeControl=function(){}; this.zoomIn=function(){}; this.zoomOut=function(){}; this.setCenter=function(){}; this.fitBounds=function(){}; },
  constants: { DEFAULT_CONTROL_ID: { ZOOM:'ZOOM', ROTATION:'ROTATION', SCALE:'SCALE' } },
  service: { Search: function(){ } },
};
sandbox.TMap = TMapMock;
windowMock.TMap = TMapMock;

const T6 = sandbox.__T;
T6.STATE.live = true; T6.STATE.mapKey='TESTKEY';
T6.STATE.map = new TMapMock.Map();
T6.STATE.user = [39.9150, 116.3975];
T6.STATE.emergency = true;
T6.STATE.spotChosen = true; T6.STATE.spot='gugong'; T6.STATE.filters={baby:false,old:false,female:false}; T6.STATE.radius=3000;
T6.STATE.liveItems = [
  {id:'live_a', name:'附近公厕A', pos:[39.9155,116.3980], type:'实时·公厕'},
  {id:'live_b', name:'卫生间B', pos:[39.9145,116.3960], type:'实时·卫生间'},
];
T6.STATE.trip = {active:false, stops:[]};

const arr6 = T6.compute();
T6.drawLive(arr6);
ok6('drawLive 创建了 MultiMarker', !!lastMarker);
ok6('标记数量 = 2厕所 + 1用户 = 3', lastMarker && lastMarker.geoms.length === 3, lastMarker && lastMarker.geoms.length);
ok6('包含 1 个“我”标记(__user)', lastMarker && lastMarker.geoms.some(g=>g.id==='__user'));
ok6('紧急模式下存在 emergency 样式标记', lastMarker && lastMarker.geoms.some(g=>g.styleId==='emergency'));
ok6('厕所标记样式为 toilet/emergency', lastMarker && lastMarker.geoms.filter(g=>g.id!=='__user').every(g=>g.styleId==='toilet'||g.styleId==='emergency'));

// 模拟点击厕所标记，确保回调不抛错（点击应打开详情）
let clickOk = true;
try { if(lastMarker._click) lastMarker._click({ geometry:{ properties:{ id:'live_a' } } }); } catch(e){ clickOk = false; console.log('  click error:', e.message); }
ok6('点击厕所标记回调不抛错', clickOk);

console.log('--- 7) decodeQQPolyline 路线解码（导航）---');
const dec = T6.decodeQQPolyline([39.900000,116.300000, 100, 200, -50, 300]);
ok6('解码后点数为 3', dec.length===3, dec.length);
ok6('首点还原正确', Math.abs(dec[0][0]-39.9)<1e-9 && Math.abs(dec[0][1]-116.3)<1e-9);
ok6('差分点偏移量级正确(米级)', Math.abs(dec[1][0]-39.9) < 0.001 && Math.abs(dec[2][0]-dec[1][0]) < 0.001);

console.log('--- 8) drawRoute 在当前地图绘制步行路线 ---');
lastPolyline=null;
const path = dec.map(p=>new FakeLatLng(p[0],p[1]));
T6.drawRoute(path);
ok6('drawRoute 创建了 MultiPolyline', !!lastPolyline);
ok6('路线几何数量 = 1', lastPolyline && lastPolyline.geoms.length===1, lastPolyline && lastPolyline.geoms.length);

console.log('--- 9) navigateTo 生成步行路线 JSONP 请求（不再 window.open）---');
windowMock._opened=null;
T6.STATE.live=true; T6.STATE.mapKey='TESTKEY'; T6.STATE.map=new TMapMock.Map(); T6.STATE.user=[39.9150,116.3975];
let lastScriptSrc=null;
const origCreate = documentMock.createElement;
documentMock.createElement = function(tag){ const el=origCreate(tag); if(tag==='script'){ Object.defineProperty(el,'src',{ set(v){ lastScriptSrc=v; }, get(){ return lastScriptSrc; }, configurable:true }); } return el; };
T6.navigateTo({name:'测试厕', pos:[39.9,116.4]});
ok6('未使用 window.open 跳转', windowMock._opened===null);
ok6('注入了步行路线 WebService JSONP 请求', !!lastScriptSrc && lastScriptSrc.indexOf('ws/direction/v1/walking')>=0 && lastScriptSrc.indexOf('output=jsonp')>=0, lastScriptSrc);
const fnKey = Object.keys(windowMock).find(k=>k.indexOf('__nav_')===0);
ok6('注册了 JSONP 回调', !!fnKey);
if(fnKey){ windowMock[fnKey]({status:0, result:{routes:[{polyline:[39.900000,116.300000, 100, 200]}]}});
  const rl = T6.getRouteLayer();
  ok6('回调后绘制/更新了步行路线 MultiPolyline', !!rl && rl.geoms.length===1, rl && rl.geoms.length); }

console.log(`\n标记/路线测试: ${pass6} passed, ${fail6} failed`);
process.exit((fail + fail6) ? 1 : 0);
