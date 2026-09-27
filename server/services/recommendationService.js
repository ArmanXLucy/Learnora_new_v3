import { TOPIC_META, PREREQS, buildRoadmap, isReady } from './curriculumService.js';

function clamp(n,min=0,max=100){
  const x=Number(n);
  return Number.isFinite(x)?Math.max(min,Math.min(max,x)):0;
}

function asPercent(value){
  const n=Number(value);
  if(!Number.isFinite(n)) return null;
  if(n>=0 && n<=1) return n*100;
  return clamp(n);
}

function latestBySource(rows){
  const out=new Map();
  for(const row of rows||[]){
    const source=String(row?.source||'unknown');
    const previous=out.get(source);
    if(!previous || String(row?.updated_at||'')>String(previous?.updated_at||'')){
      out.set(source,row);
    }
  }
  return out;
}

function rowScore(row){
  if(!row) return null;
  return asPercent(row.quiz_score);
}

/*
 * Real topic mastery.
 *
 * This deliberately does NOT use recommendation similarity, gap weight,
 * prerequisite readiness, difficulty, or the old completion model.
 *
 * Evidence sources currently produced by Learnora:
 *   diagnostic        -> assessment evidence
 *   post_video_test   -> quiz/application evidence
 *   api               -> lesson/content completion evidence
 *
 * Future practice/assignment/revision sources are also understood here.
 */
export function calculateTopicMastery(progressRows, skillId, topicId, memo=new Map(), stack=new Set()){
  if(memo.has(topicId)) return memo.get(topicId);
  if(stack.has(topicId)) return 0;
  stack.add(topicId);

  const rows=(progressRows||[]).filter(r=>r?.skill_id===skillId && r?.topic_id===topicId);
  const bySource=latestBySource(rows);

  const diagnostic=rowScore(bySource.get('diagnostic'));
  const postVideo=rowScore(bySource.get('post_video_test'));
  const learning=asPercent(bySource.get('api')?.quiz_score);

  const practiceRows=[...bySource.entries()]
    .filter(([source])=>/practice|assignment|project/i.test(source))
    .map(([,row])=>rowScore(row))
    .filter(v=>v!==null);
  const practice=practiceRows.length?practiceRows.reduce((a,b)=>a+b,0)/practiceRows.length:null;

  const revisionRows=[...bySource.entries()]
    .filter(([source])=>/revision|review/i.test(source))
    .map(([,row])=>rowScore(row))
    .filter(v=>v!==null);
  const revision=revisionRows.length?revisionRows.reduce((a,b)=>a+b,0)/revisionRows.length:null;

  const assessmentScores=[diagnostic,postVideo].filter(v=>v!==null);
  const assessmentQuiz=assessmentScores.length
    ? assessmentScores.reduce((a,b)=>a+b,0)/assessmentScores.length
    : null;

  const prereqs=(PREREQS[topicId]||[]);
  const prereqValues=[];
  for(const p of prereqs){
    const pRows=(progressRows||[]).filter(r=>r?.skill_id===skillId && r?.topic_id===p);
    if(pRows.some(r=>String(r?.source||'')!=='level_baseline')){
      prereqValues.push(calculateTopicMastery(progressRows,skillId,p,memo,stack));
    }
  }
  const prerequisite=prereqValues.length
    ? prereqValues.reduce((a,b)=>a+b,0)/prereqValues.length
    : null;

  const evidence=[];
  if(assessmentQuiz!==null) evidence.push([assessmentQuiz,40,'assessment_quiz']);
  if(learning!==null) evidence.push([learning,25,'learning_completion']);
  if(practice!==null) evidence.push([practice,20,'practice']);
  if(prerequisite!==null) evidence.push([prerequisite,10,'prerequisites']);
  if(revision!==null) evidence.push([revision,5,'revision']);

  let mastery=0;
  if(evidence.length){
    const totalWeight=evidence.reduce((sum,x)=>sum+x[1],0);
    mastery=evidence.reduce((sum,x)=>sum+x[0]*x[1],0)/totalWeight;

    // Conservative anti-inflation caps when the student has not demonstrated
    // enough independent evidence.
    const sources=rows.map(r=>String(r?.source||''));
    const hasOnlyDiagnostic=sources.length===1 && sources[0]==='diagnostic';
    const hasOnlyLearning=sources.every(s=>s==='api');
    const hasOnlyQuiz=sources.every(s=>s==='post_video_test');

    if(hasOnlyDiagnostic) mastery=Math.min(mastery,50);
    else if(hasOnlyLearning) mastery=Math.min(mastery,60);
    else if(hasOnlyQuiz) mastery=Math.min(mastery,85);
  }

  // A level_baseline record only means the learner tested above this topic's
  // level; it is not direct evidence of mastery.
  if(!rows.some(r=>String(r?.source||'')!=='level_baseline')) mastery=0;

  const rounded=Number(clamp(mastery).toFixed(1));
  memo.set(topicId,rounded);
  stack.delete(topicId);
  return rounded;
}

export function calculateMasteryMap(progressRows, skillId, topicIds){
  const memo=new Map();
  for(const topicId of topicIds||[]) calculateTopicMastery(progressRows,skillId,topicId,memo,new Set());
  return Object.fromEntries(memo.entries());
}

export function masteryStatus(mastery){
  const n=clamp(mastery);
  if(n===0) return 'NOT_STARTED';
  if(n<75) return 'IN_PROGRESS';
  if(n<90) return 'STRONG';
  return 'MASTERED';
}

function tokens(s){return new Set(String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').split(/\s+/).filter(Boolean));}
function jaccard(a,b){const A=tokens(a),B=tokens(b);let n=0;for(const x of A)if(B.has(x))n++;return n/Math.max(1,new Set([...A,...B]).size);}

export function recommend(skillId,masteredSet,hoursPerWeek=5,topK=5,masteryMap={}){
  const road=buildRoadmap(skillId,masteredSet).filter(x=>x.status!=='mastered');
  const mastered=new Set(masteredSet);
  const learner=mastered.size?Math.max(...[...mastered].map(t=>TOPIC_META[t]?.difficulty||1))/5:.1;

  return road.map((r,i)=>{
    const sim=jaccard([...mastered].map(t=>TOPIC_META[t]?.keywords).join(' '),r.keywords);
    const prereq=isReady(r.topic_id,mastered)?1:0.2;
    const diff=1-Math.min(1,Math.abs(r.difficulty-(learner*5))/4);
    const context_ok=r.hours<=Math.max(hoursPerWeek*2,1);
    const score=.35*sim+.30*(1-i/Math.max(1,road.length))+.20*prereq+.15*diff*(context_ok?1:.4);

    const mastery=clamp(masteryMap?.[r.topic_id] ?? 0);
    const status=masteryStatus(mastery);

    return {
      ...r,
      mastery,
      mastery_status:status,
      similarity_score:Number(sim.toFixed(3)),
      gap_weight:Number((1-i/Math.max(1,road.length)).toFixed(3)),
      prereq_score:Number(prereq.toFixed(3)),
      context_ok,
      final_score:Number(score.toFixed(4)),
      ai_match:Number(mastery.toFixed(1)),
      explanation:status==='NOT_STARTED'
        ? (r.status==='ready'
          ? 'This topic is ready to start because its prerequisites are satisfied.'
          : 'This topic has not been started yet.')
        : `Your current demonstrated mastery of this topic is ${mastery.toFixed(1)}%.`
    };
  }).sort((a,b)=>b.final_score-a.final_score).slice(0,topK);
}
