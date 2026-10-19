export const agents = [
  {id:'claude', name:'Claude Code', logo:'claude-code.svg'},
  {id:'codex', name:'Codex', logo:'codex.svg'},
  {id:'gemini', name:'Gemini CLI', logo:'google-gemini.svg'},
  {id:'opencode', name:'OpenCode', logo:'opencode.svg'},
];
export const projects = [
  {id:'music', name:'识谱小课堂', path:'/workspaces/music-class'},
  {id:'hub', name:'agent-config-hub', path:'/workspaces/ac-hub'},
  {id:'notes', name:'research-notes', path:'/workspaces/research'},
];
const rows = [
 ['code-review','审阅代码与回归风险','agent-tools/skills','代码质量'],
 ['git-workflow','Git 工作流与提交规范','community/skills','代码质量'],
 ['frontend-design','界面设计与前端实现','anthropics/skills','前端开发'],
 ['react-best-practices','React 最佳实践与常见陷阱','vercel-labs/skills','前端开发'],
 ['webapp-testing','浏览器交互与页面验证','anthropics/skills','前端开发'],
 ['project-conventions','项目约定与代码规范','本地来源','项目规范'],
 ['pdf','PDF 读取与内容提取','本地来源','文档处理'],
 ['database-review','数据库结构与查询优化','community/skills','数据开发'],
 ['typescript-patterns','TypeScript 类型与代码模式','community/skills','前端开发'],
 ['accessibility-check','可访问性检查与改进建议','community/skills','前端开发'],
 ['api-design','API 设计与接口约定','community/skills','后端开发'],
 ['test-driven-development','用测试推动行为实现','agent-tools/skills','代码质量'],
 ['performance-audit','性能诊断与测量计划','community/skills','代码质量'],
 ['security-review','应用安全检查','agent-tools/skills','代码质量'],
 ['documentation','编写与维护项目文档','anthropics/skills','文档处理'],
 ['spreadsheet-analysis','电子表格分析与整理','anthropics/skills','文档处理'],
 ['presentation-design','演示文稿结构与排版','anthropics/skills','文档处理'],
 ['research-synthesis','整理研究来源与结论','community/skills','研究工作'],
 ['swiftui-patterns','SwiftUI 视图与状态组织','community/skills','移动开发'],
 ['python-testing','Python 测试与错误排查','community/skills','后端开发'],
 ['docker-workflow','容器开发与运行排查','community/skills','后端开发'],
 ['release-checklist','版本交付前的检查流程','本地来源','代码质量'],
 ['sql-optimization','SQL 查询分析与优化','community/skills','数据开发'],
 ['technical-writing','清晰准确的技术写作','community/skills','文档处理'],
];
export const skills = rows.map(([id,description,source,tag])=>({id,name:id,description,source,tag,pending:id==='pdf'}));
export const keyOf = (target,skill,agent) => `${target}|${skill}|${agent}`;
export const splitKey = key => { const [target,skill,agent] = key.split('|'); return {target,skill,agent}; };
export const targetLabel = id => id==='global'?'全局配置':projects.find(p=>p.id===id)?.name||id;
export const rawState = (base,key) => base[key] || (key.startsWith('global|')?'off':'inherit');
export function initialBase() {
 const result = {};
 for (const skill of ['code-review','git-workflow','frontend-design']) for (const a of agents) result[keyOf('global',skill,a.id)]='on';
 const local = {
  music:{'react-best-practices':['claude'],'webapp-testing':['claude','opencode'],'project-conventions':['codex'],pdf:['claude'],'database-review':['gemini']},
  hub:{'react-best-practices':['claude','codex'],'test-driven-development':['claude','codex'],'project-conventions':['claude'],'api-design':['codex']},
  notes:{'research-synthesis':['claude'],'technical-writing':['codex']},
 };
 for (const [target,entries] of Object.entries(local)) for (const [skill,list] of Object.entries(entries)) for (const agent of list) result[keyOf(target,skill,agent)]='enable';
 return result;
}
export function currentRaw(base,drafts,key) { return Object.hasOwn(drafts,key)?drafts[key]:rawState(base,key); }
export function effectiveState(base,drafts,target,skill,agent) {
 const value=currentRaw(base,drafts,keyOf(target,skill,agent));
 if (target==='global') return value==='on'?'enabled':'absent';
 if (value==='disable') return 'excluded';
 if (value==='enable') return 'enabled';
 return currentRaw(base,drafts,keyOf('global',skill,agent))==='on'?'inherited':'absent';
}
export const stateLabels = {enabled:'启用',absent:'未配置',inherited:'来自全局',excluded:'本项目停用'};
export function stage(base,drafts,target,skill,agent,value) {
 const key=keyOf(target,skill,agent); const next={...drafts};
 if (value===rawState(base,key)) delete next[key]; else next[key]=value;
 return next;
}
export function setAvailability(base,drafts,target,skill,agent,checked) {
 if (target!=='global'&&agent==='opencode'&&skill==='frontend-design') return {drafts,blocked:'OpenCode 角色设置了精细权限，请在原生角色中管理。'};
 if (skills.find(s=>s.id===skill)?.pending) return {drafts,blocked:'来源尚未确认，请先核对与接管。'};
 const globalOn=currentRaw(base,drafts,keyOf('global',skill,agent))==='on';
 let value;
 if(target==='global') value=checked?'on':'off';
 else if(checked) value=globalOn?(rawState(base,keyOf(target,skill,agent))==='enable'?'enable':'inherit'):'enable';
 else value=globalOn||['codex','opencode'].includes(agent)?'disable':'inherit';
 return {drafts:stage(base,drafts,target,skill,agent,value),blocked:null};
}
export function bulkStage(base,drafts,targets,skillIds,agentIds,action) {
 let result={...drafts}; let skipped=0;
 for (const target of targets) for (const skill of skillIds) for (const agent of agentIds) {
  const key=keyOf(target,skill,agent); const raw=currentRaw(base,result,key); let desired;
  if(target==='global') desired=action==='enable'?'on':'off';
  else if(action==='enable') desired=currentRaw(base,result,keyOf('global',skill,agent))==='on'?'inherit':'enable';
  else desired=['enabled','inherited'].includes(effectiveState(base,result,target,skill,agent))?(currentRaw(base,result,keyOf('global',skill,agent))==='on'||['codex','opencode'].includes(agent)?'disable':'inherit'):raw;
  if(raw===desired) skipped++; else result=stage(base,result,target,skill,agent,desired);
 }
 return {drafts:result,skipped};
}
export function changePlan(base,drafts,stale=false) {
 return Object.entries(drafts).map(([key,value])=>{
  const {target,skill,agent}=splitKey(key); const item=skills.find(s=>s.id===skill);
  const blocked=item.pending?'来源尚未确认，请先核对与接管':target!=='global'&&agent==='opencode'&&skill==='frontend-design'?'OpenCode 角色精细权限须在原生配置中管理':stale?'文件已发生变化，请重新读取并核对':null;
  return {key,target,skill,agent,value,before:rawState(base,key),blocked};
 });
}
export function modeLabel(value,target) {
 if(target==='global') return value==='on'?'全局启用':'撤回全局配置';
 return value==='enable'?'本项目启用':value==='disable'?'本项目停用':'跟随全局／不额外配置';
}
