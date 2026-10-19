import test from 'node:test';
import assert from 'node:assert/strict';
import {initialBase,effectiveState,stage,setAvailability,bulkStage,changePlan,keyOf} from '../src/model.js';

test('批量项目停用保留全局文件与其他项目配置',()=>{
 const base=initialBase();base[keyOf('music','code-review','claude')]='enable';
 const result=bulkStage(base,{},['music'],['code-review'],['claude'],'withdraw');
 assert.equal(effectiveState(base,result.drafts,'music','code-review','claude'),'excluded');
 assert.equal(effectiveState(base,result.drafts,'hub','code-review','claude'),'inherited');
 assert.deepEqual(changePlan(base,result.drafts).map(p=>p.target),['music']);
});
test('已有全局配置跳过，批量分配仅产生指定项目与 Agent 的缺失配置',()=>{
 const base=initialBase();const result=bulkStage(base,{},['music','hub'],['code-review','react-best-practices'],['claude','codex'],'enable');
 assert.equal(result.skipped,7);
 assert.deepEqual(Object.keys(result.drafts),[keyOf('music','react-best-practices','codex')]);
});
test('切回原状态取消草稿；独立项目配置互不覆盖',()=>{
 const base=initialBase();let draft=stage(base,{},'music','react-best-practices','codex','enable');
 draft=stage(base,draft,'music','react-best-practices','codex','inherit');
 assert.deepEqual(draft,{});
 assert.equal(effectiveState(base,draft,'hub','react-best-practices','codex'),'enabled');
});
test('来源不明受阻，项目 Codex 排除可执行',()=>{
 const base=initialBase();let draft=stage(base,{},'music','pdf','codex','enable');
 draft=stage(base,draft,'music','code-review','codex','disable');
 draft=stage(base,draft,'music','react-best-practices','codex','enable');
 const plan=changePlan(base,draft);assert.equal(plan.filter(p=>p.blocked).length,1);
 assert.deepEqual(plan.filter(p=>!p.blocked).map(p=>p.skill),['code-review','react-best-practices']);
 assert.equal(changePlan(base,draft,true).filter(p=>!p.blocked).length,0);
});
test('撤回全局不会删除显式项目添加；组合分配不生成空操作',()=>{
 const base=initialBase();base[keyOf('music','code-review','claude')]='enable';
 const draft=stage(base,{},'global','code-review','claude','off');
 assert.equal(effectiveState(base,draft,'music','code-review','claude'),'enabled');
 assert.equal(effectiveState(base,draft,'hub','code-review','claude'),'absent');
 assert.equal(Object.keys(bulkStage(base,{},['music'],['react-best-practices'],['claude'],'enable').drafts).length,0);
});
test('取消全局来源勾选只排除当前项目，重新勾选撤销草稿',()=>{
 const base=initialBase();const off=setAvailability(base,{},'hub','code-review','claude',false);
 assert.equal(off.blocked,null);
 assert.equal(effectiveState(base,off.drafts,'hub','code-review','claude'),'excluded');
 assert.equal(effectiveState(base,off.drafts,'music','code-review','claude'),'inherited');
 assert.equal(effectiveState(base,off.drafts,'global','code-review','claude'),'enabled');
 const on=setAvailability(base,off.drafts,'hub','code-review','claude',true);
 assert.deepEqual(on.drafts,{});
});
test('全局后来撤回时，重新勾选会添加有效项目配置',()=>{
 const base=initialBase();base[keyOf('global','code-review','claude')]='off';base[keyOf('hub','code-review','claude')]='disable';
 const on=setAvailability(base,{},'hub','code-review','claude',true);
 assert.equal(effectiveState(base,on.drafts,'hub','code-review','claude'),'enabled');
 assert.equal(effectiveState(base,on.drafts,'music','code-review','claude'),'absent');
});
test('Codex 项目停用允许草稿，未知来源仍受阻',()=>{
 const base=initialBase();const draft=stage(base,{},'hub','api-design','claude','enable');
 const unsupported=setAvailability(base,draft,'hub','code-review','codex',false);
 assert.equal(unsupported.blocked,null);assert.equal(unsupported.drafts[keyOf('hub','code-review','codex')],'disable');
 const unknown=setAvailability(base,draft,'music','pdf','claude',false);
 assert.match(unknown.blocked,/来源/);assert.deepEqual(unknown.drafts,draft);
});
test('同时存在全局与项目添加时，取消再勾选保留原项目归属',()=>{
 const base=initialBase();base[keyOf('hub','code-review','claude')]='enable';
 const off=setAvailability(base,{},'hub','code-review','claude',false);
 assert.equal(effectiveState(base,off.drafts,'hub','code-review','claude'),'excluded');
 const on=setAvailability(base,off.drafts,'hub','code-review','claude',true);
 assert.deepEqual(on.drafts,{});assert.equal(base[keyOf('hub','code-review','claude')],'enable');
});
