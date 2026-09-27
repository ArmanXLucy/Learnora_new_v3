import { getGroq, getAIModel } from '../config/ai.js';
import { SKILLS, TOPIC_META, catalog, difficultyLevel } from './curriculumService.js';

function parseJson(text){
  let t=String(text||'').trim().replace(/^```json\s*/i,'').replace(/^```\s*/,'').replace(/\s*```$/,'');
  try{return JSON.parse(t);}catch(e){const a=t.indexOf('{'),b=t.lastIndexOf('}'); if(a>=0&&b>a){try{return JSON.parse(t.slice(a,b+1));}catch{}} const c=t.indexOf('['),d=t.lastIndexOf(']'); if(c>=0&&d>c)return JSON.parse(t.slice(c,d+1)); throw new Error('AI returned malformed JSON.');}
}
async function chat(messages,{maxTokens=800,json=true}={}){
  const groq=getGroq();
  const response=await groq.chat.completions.create({model:getAIModel(),messages,max_completion_tokens:maxTokens,temperature:0.1,...(json?{response_format:{type:'json_object'}}:{})});
  const text=response.choices?.[0]?.message?.content||''; if(!text.trim()) throw new Error('AI returned an empty response.'); return parseJson(text);
}
function compactSyllabusText(text, skillId) {
  const raw = String(text || '').replace(/\r/g, '');
  if (!raw) return '';

  // Keep the prompt comfortably below Groq's input-token-per-minute limit.
  // Prefer lines that mention existing Learnora topics, units/chapters,
  // and common syllabus headings, then fill with evenly sampled text.
  const skill = SKILLS[skillId];
  const topicMeta = skill?.topics?.map(id => TOPIC_META[id]).filter(Boolean) || [];
  const needles = [];
  for (const t of topicMeta) {
    needles.push(String(t.display || '').toLowerCase());
    for (const k of (t.keywords || [])) needles.push(String(k).toLowerCase());
  }
  for (const a of (skill?.aliases || [])) needles.push(String(a).toLowerCase());

  const lines = raw.split(/\n+/).map(x => x.trim()).filter(Boolean);
  const selected = [];
  const seen = new Set();
  for (const line of lines) {
    const lower = line.toLowerCase();
    const useful = needles.some(n => n && lower.includes(n)) ||
      /^(unit|module|chapter|section|topic|syllabus|course|week)\b/i.test(line) ||
      /\b(sql|database|dbms|relational|normalization|transaction|index|join|er model)\b/i.test(line);
    if (useful && !seen.has(line)) { selected.push(line); seen.add(line); }
  }

  let compact = selected.join('\n');
  const LIMIT = 15000;
  if (compact.length < 1800) {
    // If keyword extraction is too sparse, sample from the full syllabus so
    // later units are not systematically lost.
    const sampleSize = Math.floor(LIMIT / 3);
    compact = [
      raw.slice(0, sampleSize),
      raw.slice(Math.max(0, Math.floor((raw.length - sampleSize) / 2)), Math.max(0, Math.floor((raw.length - sampleSize) / 2)) + sampleSize),
      raw.slice(-sampleSize)
    ].join('\n...\n');
  }
  return compact.slice(0, LIMIT);
}

export async function analyzeSyllabus({skillId,text='',imageDataUrl=''}){
  const s=SKILLS[skillId];
  if(!s) throw new Error('Unknown Learnora course.');

  const curriculum=catalog(skillId).map(({id,title,difficulty,keywords})=>({
    id,
    title,
    difficulty,
    keywords
  }));

  const aliases=Array.isArray(s.aliases)?s.aliases:[];
  const prompt=`You are Learnora's syllabus validation and course-matching assistant.

The student has already selected/enrolled in this specific course:
SELECTED COURSE:
${s.display_name}

COURSE ALIASES:
${JSON.stringify(aliases)}

LEARNORA STANDARD CURRICULUM:
${JSON.stringify(curriculum)}

TASK:
Read and analyze the uploaded/pasted syllabus carefully. First determine the actual academic subject represented by the document. Then decide whether it substantially belongs to the selected course.

IMPORTANT VALIDATION RULES:
- Do not assume an academic document belongs to the selected course.
- Focus on the overall academic content, units/modules, concepts, terminology, and curriculum structure.
- Common names, abbreviations, university course codes, and laboratory naming differences are acceptable.
- For example, DBMS, Database Management Systems, Database Systems, Databases & SQL, and a DBMS laboratory may refer to the same broader subject when the actual content supports that conclusion.
- A few unrelated topics are acceptable when the majority of the document clearly belongs to the selected course.
- Do not mark VALID because of one or two matching keywords.
- If the main subject is clearly different, the majority of topics belong to another discipline, or evidence is insufficient, mark INVALID.
- Confidence must be between 0 and 1.
- A confidence below 0.70 should normally be INVALID unless strong contextual evidence supports the match.
- Do not invent information that is not supported by the uploaded syllabus or the supplied Learnora curriculum.

IF VALID:
- Extract the main units/modules from the uploaded syllabus.
- Preserve terminology used in the uploaded syllabus where practical.
- Extract topics and subtopics from the document.
- Compare the uploaded syllabus with Learnora's standard curriculum.
- matched_topics = use the exact Learnora topic titles from the supplied curriculum that are clearly supported by the uploaded syllabus.
- additional_topics = topics clearly present in the uploaded syllabus but not represented by the supplied Learnora curriculum; preserve the syllabus wording.
- missing_topics = use the exact Learnora topic titles from the supplied curriculum that are not represented in the uploaded syllabus.
- Do not invent missing or additional topics.
- The roadmap may continue only when status is VALID.

IF INVALID:
- Do not create a roadmap.
- Identify the subject the uploaded document appears to represent.
- Explain briefly why it does not substantially match the selected course.
- Return empty matched_topics.

RETURN ONLY VALID JSON with exactly this structure:
{
  "status":"VALID" or "INVALID",
  "selected_course":"${s.display_name.replace(/"/g,'\\"')}",
  "detected_subject":"...",
  "confidence":0.0,
  "reason":"...",
  "units":[
    {
      "unit":"Unit 1",
      "title":"...",
      "topics":["..."],
      "subtopics":["..."]
    }
  ],
  "mapping":{
    "matched_topics":[],
    "additional_topics":[],
    "missing_topics":[]
  },
  "message":"..."
}

For INVALID responses, units must be [] and mapping must contain empty arrays. The message must say that the uploaded syllabus does not appear to belong to the selected course and ask for a syllabus for the selected course.

UPLOADED SYLLABUS:
${String(text||'').slice(0,18000)}`;

  const content=imageDataUrl
    ? [
        {type:'text',text:prompt+'\n\nThe uploaded document is an image. Read all visible syllabus content carefully before deciding.'},
        {type:'image_url',image_url:{url:imageDataUrl}}
      ]
    : prompt;

  let result;
  try {
    result=await chat([
      {role:'system',content:"You validate course-syllabus matches for Learnora. Academic-content evidence determines the result. Output valid JSON only."},
      {role:'user',content}
    ],{maxTokens:1800});
  } catch (err) {
    if (err?.status === 429 || /tokens per minute|ITPM|OTPM|Request too large/i.test(String(err?.message||''))) {
      throw new Error("The AI free-tier limit was exceeded. Please wait a few seconds and try again.");
    }
    throw err;
  }

  const status=String(result?.status||'').toUpperCase()==='VALID'?'VALID':'INVALID';
  const confidence=Number(result?.confidence);
  const safeConfidence=Number.isFinite(confidence)?Math.max(0,Math.min(1,confidence)):0;
  const units=Array.isArray(result?.units)?result.units.map((u,i)=>({
    unit:String(u?.unit||`Unit ${i+1}`),
    title:String(u?.title||'').trim(),
    topics:Array.isArray(u?.topics)?u.topics.map(x=>String(x).trim()).filter(Boolean):[],
    subtopics:Array.isArray(u?.subtopics)?u.subtopics.map(x=>String(x).trim()).filter(Boolean):[]
  })).filter(u=>u.title||u.topics.length||u.subtopics.length):[];

  const mapping=result?.mapping&&typeof result.mapping==='object'?result.mapping:{};
  const normalizedMapping={
    matched_topics:Array.isArray(mapping.matched_topics)?mapping.matched_topics.map(x=>String(x).trim()).filter(Boolean):[],
    additional_topics:Array.isArray(mapping.additional_topics)?mapping.additional_topics.map(x=>String(x).trim()).filter(Boolean):[],
    missing_topics:Array.isArray(mapping.missing_topics)?mapping.missing_topics.map(x=>String(x).trim()).filter(Boolean):[]
  };

  const normalized={
    status,
    selected_course:s.display_name,
    detected_subject:String(result?.detected_subject||'Unknown').trim(),
    confidence:safeConfidence,
    reason:String(result?.reason||'').trim(),
    units:status==='VALID'?units:[],
    mapping:status==='VALID'?normalizedMapping:{matched_topics:[],additional_topics:[],missing_topics:[]},
    message:String(result?.message||'The uploaded syllabus does not appear to belong to the selected course. Please upload a syllabus for the selected course.').trim()
  };

  if(status==='VALID' && safeConfidence<0.70){
    normalized.status='INVALID';
    normalized.units=[];
    normalized.mapping={matched_topics:[],additional_topics:[],missing_topics:[]};
    normalized.message='The uploaded syllabus does not have enough evidence to validate it against the selected course. Please upload a syllabus for the selected course.';
  }

  if(normalized.status==='INVALID'){
    throw Object.assign(new Error(normalized.reason||normalized.message),{
      code:'SYLLABUS_MISMATCH',
      validation:normalized
    });
  }

  // Map only the standard Learnora topic IDs that the AI explicitly matched.
  const selectedTopicIds=[];
  const lowerMatched=new Set(normalized.mapping.matched_topics.map(x=>x.toLowerCase()));
  for(const item of curriculum){
    if(lowerMatched.has(item.id.toLowerCase()) || lowerMatched.has(item.title.toLowerCase())) selectedTopicIds.push(item.id);
  }

  // If the model described matches using natural-language topic names, make a
  // second conservative pass against the supplied topic titles/keywords.
  if(!selectedTopicIds.length){
    const textForMatch=normalized.mapping.matched_topics.join(' ').toLowerCase();
    for(const item of curriculum){
      const hay=`${item.title} ${item.keywords}`.toLowerCase();
      if(item.title && (textForMatch.includes(item.title.toLowerCase()) || item.keywords.split(' ').some(k=>k.length>3 && textForMatch.includes(k.toLowerCase())))) selectedTopicIds.push(item.id);
    }
  }

  if(!selectedTopicIds.length) throw new Error('The syllabus was validated, but no supported Learnora curriculum topics could be mapped from it. Please provide a clearer syllabus.');

  const selected=[...new Set(selectedTopicIds)];
  return {
    ...normalized,
    title:normalized.selected_course,
    summary:normalized.reason,
    source:'uploaded',
    selected_topic_ids:selected,
    roadmap:selected.map((topic_id,i)=>({topic_id,reason:'Matched to the validated syllabus.',priority:i+1}))
  };
}

export async function generateDiagnostic({skillId,topicIds,summary=''}){
  const allTopics=catalog(skillId)
    .filter(x=>topicIds.includes(x.id))
    .map(({id,title,difficulty})=>({id,title,difficulty}));
  const validTopicIds=new Set(topicIds);

  // Groq free-tier limits are tight, so generate one compact question at a time.
  // The response schema is intentionally tiny so JSON can complete within the
  // per-request output-token limit while 7 calls stay below the 1000 OTPM cap.
  const difficulties=['basic','basic','intermediate','intermediate','intermediate','advanced','advanced'];
  const questions=[];

  function validate(q, expectedDifficulty){
    return q && validTopicIds.has(q.topic_id) &&
      Array.isArray(q.o) && q.o.length===4 && q.o.every(x=>String(x||'').trim()) &&
      Number.isInteger(q.a) && q.a>=0 && q.a<=3 && String(q.q||'').trim() &&
      String(q.difficulty||expectedDifficulty).toLowerCase()===expectedDifficulty;
  }

  async function oneQuestion(difficulty, position){
    const prompt=`Create ONE concise ${difficulty} multiple-choice question for ${SKILLS[skillId].display_name}. Position ${position}/7. Use only the supplied topic IDs. Return JSON only with this exact shape: {"q":"question","o":["A","B","C","D"],"a":0,"topic_id":"id","difficulty":"${difficulty}"}. Exactly 4 short options. a must be 0-3. No explanation, markdown, or extra text. Keep the JSON under 110 tokens. Syllabus: ${String(summary||'').slice(0,450)} Topics: ${JSON.stringify(allTopics)}`;
    const result=await chat([
      {role:'system',content:"You generate compact Learnora diagnostic questions. Output valid JSON only."},
      {role:'user',content:prompt}
    ],{maxTokens:140});
    return result;
  }

  for(let i=0;i<difficulties.length;i++){
    const difficulty=difficulties[i];
    const q=await oneQuestion(difficulty,i+1);
    if(!validate(q,difficulty)){
      throw new Error(`AI could not generate a valid ${difficulty} diagnostic question. Please try the assessment again.`);
    }
    questions.push({
      topic_id:q.topic_id,
      difficulty,
      question:String(q.q).trim(),
      options:q.o.map(x=>String(x).trim()),
      answer:q.a,
      explanation:'Review the concept behind the correct answer and compare it with the other options.'
    });
  }

  return questions.map((q,i)=>({...q,id:i+1}));
}
export function evaluateDiagnostic(questions,answers){
  const rows=questions.map(q=>({...q,correct:Number(answers[q.id])===q.answer})); const score=rows.length?rows.filter(x=>x.correct).length/rows.length*100:0;
  const rate=d=>{const a=rows.filter(x=>x.difficulty===d);return a.length?a.filter(x=>x.correct).length/a.length:0;};
  const b=rate('basic'),i=rate('intermediate'),a=rate('advanced'); let level='basic';
  if(a>=0.5&&i>=0.67&&b>=0.5)level='advanced'; else if(b>=0.67&&i>=0.5)level='intermediate';
  return {score:Number(score.toFixed(1)),level,reason:`Basic ${Math.round(b*100)}%, Intermediate ${Math.round(i*100)}%, Advanced ${Math.round(a*100)}%.`,rows};
}
export async function generateRoadmap({skillId,selectedTopicIds,learnerLevel,diagnosticRows,summary=''}){
  const allowed=new Set(selectedTopicIds); const eligible=selectedTopicIds.filter(id=>TOPIC_META[id] && TOPIC_META[id].difficulty>={basic:1,intermediate:2,advanced:3}[learnerLevel]);
  const prompt=`Create a personalized Learnora roadmap using ONLY these exact topic IDs and preserve prerequisites. Learner level: ${learnerLevel}. Return JSON {"topics":[{"topic_id":"...","reason":"...","priority":1}]}. Do not invent IDs. Topic catalog: ${JSON.stringify(catalog(skillId).filter(x=>eligible.includes(x.id)).map(({id,title,difficulty})=>({id,title,difficulty})))} Diagnostic: ${JSON.stringify((diagnosticRows||[]).map(x=>({topic_id:x.topic_id,difficulty:x.difficulty,correct:!!x.correct})))} Summary: ${summary}`;
  try{
    const result=await chat([{role:'system',content:"You are Learnora's roadmap planner. Existing curriculum is the source of truth."},{role:'user',content:prompt}],{maxTokens:650});
    const topics=(Array.isArray(result.topics)?result.topics:[]).filter(x=>x&&allowed.has(x.topic_id)&&eligible.includes(x.topic_id));
    if(!topics.length) throw new Error('AI roadmap was empty.');
    return {source:'ai',topics};
  }catch(err){
    // Deterministic prerequisite roadmap remains grounded in the existing curriculum.
    const { buildRoadmap }=await import('./curriculumService.js');
    const road=buildRoadmap(skillId,new Set(selectedTopicIds.filter(id=>TOPIC_META[id]?.difficulty<{basic:1,intermediate:2,advanced:3}[learnerLevel]))).filter(x=>eligible.includes(x.topic_id));
    return {source:'curriculum',topics:road.map((x,i)=>({topic_id:x.topic_id,reason:x.status==='ready'?'Prerequisites are satisfied.':'Prerequisite-aware course order.',priority:i+1}))};
  }
}
export async function generateLearningExplanation({topic,context=''}){return (await chat([{role:'system',content:"You are Learnora's learning assistant. Explain only the supplied topic and context, clearly and practically."},{role:'user',content:`Topic: ${topic.display}\nKeywords: ${topic.keywords}\nContext: ${context}\nReturn JSON {"explanation":"...","examples":["..."],"key_points":["..."]}`}],{maxTokens:500}));}
