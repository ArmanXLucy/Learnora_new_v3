import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
export const CURRICULUM=JSON.parse(fs.readFileSync(path.join(root,'data/curriculum.json'),'utf8'));
export const KB=JSON.parse(fs.readFileSync(path.join(root,'data/knowledge_base.json'),'utf8'));
export const SKILLS=CURRICULUM.skills;
export const TOPIC_META=CURRICULUM.topic_meta;
export const PREREQS=CURRICULUM.prerequisites;
export const COLD_START_QUESTIONS=CURRICULUM.cold_start_questions;
export const CREATORS=CURRICULUM.creators || [];
export const FLAGSHIP_VIDEOS=CURRICULUM.flagship_videos || {};
export const PLAYLISTS=CURRICULUM.playlists || {};

export function topicOrder(skillId){
  const topics=SKILLS[skillId].topics; const indeg=new Map(topics.map(t=>[t,0])); const out=new Map(topics.map(t=>[t,[]]));
  for(const t of topics){ for(const p of PREREQS[t]||[]){ if(indeg.has(p)){out.get(p).push(t);indeg.set(t,indeg.get(t)+1);} } }
  const q=topics.filter(t=>indeg.get(t)===0); const result=[]; while(q.length){const n=q.shift();result.push(n);for(const m of out.get(n)||[]){indeg.set(m,indeg.get(m)-1);if(indeg.get(m)===0)q.push(m);}}
  return result.length===topics.length?result:topics;
}
export function isReady(topicId, mastered){return (PREREQS[topicId]||[]).every(p=>mastered.has(p));}
export function buildRoadmap(skillId, masteredSet){
  const mastered=new Set(masteredSet); return topicOrder(skillId).map(topicId=>{const m=TOPIC_META[topicId]; return {topic_id:topicId,display:m.display,difficulty:m.difficulty,hours:m.hours,keywords:m.keywords,status:mastered.has(topicId)?'mastered':(isReady(topicId,mastered)?'ready':'locked')};});
}
export function catalog(skillId){return SKILLS[skillId].topics.map(id=>({id,title:TOPIC_META[id].display,difficulty:TOPIC_META[id].difficulty,keywords:TOPIC_META[id].keywords}));}
export function generalPlan(skillId){const s=SKILLS[skillId],topics=catalog(skillId);return {title:s.display_name,summary:s.description,source:'general',selected_topic_ids:topics.map(x=>x.id),topics,roadmap:topics.map((x,i)=>({topic_id:x.id,reason:'General course sequence',priority:i+1}))};}
export function threshold(level){return {basic:1,intermediate:2,advanced:3}[String(level||'basic').toLowerCase()]||1;}
export function difficultyLevel(d){return d<=1?'basic':d<=2?'intermediate':'advanced';}
