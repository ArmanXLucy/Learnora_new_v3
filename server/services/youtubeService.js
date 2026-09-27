import { CREATORS, FLAGSHIP_VIDEOS, PLAYLISTS, SKILLS, TOPIC_META } from './curriculumService.js';

export const LANGUAGES=[
  ['en','English'],['hi','Hindi'],['bn','Bengali'],['es','Spanish'],['fr','French'],['de','German'],
  ['zh-Hans','Chinese (Simplified)'],['ar','Arabic'],['pt','Portuguese'],['ru','Russian'],['ja','Japanese'],
  ['ta','Tamil'],['te','Telugu'],['mr','Marathi'],['ur','Urdu']
];

function q(s){return encodeURIComponent(String(s||''));}

function decodeHtml(s){
  return String(s||'')
    .replace(/<[^>]+>/g,'')
    .replace(/&amp;/g,'&')
    .replace(/&#39;/g,"'")
    .replace(/&quot;/g,'"')
    .replace(/&lt;/g,'<')
    .replace(/&gt;/g,'>')
    .replace(/&#x27;/gi,"'")
    .replace(/&#x2F;/gi,'/')
    .replace(/\n/g,' ')
    .trim();
}

function fetchWithTimeout(url, options={}, ms=7000){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),ms);
  return fetch(url,{...options,signal:controller.signal}).finally(()=>clearTimeout(timer));
}

function parseISODuration(value){
  const m=String(value||'').match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/i);
  if(!m)return null;
  return (Number(m[1]||0)*3600)+(Number(m[2]||0)*60)+Number(m[3]||0);
}

function normalizeText(s){
  return String(s||'')
    .toLowerCase()
    .replace(/&amp;/g,' and ')
    .replace(/[^a-z0-9+#.]+/g,' ')
    .replace(/\s+/g,' ')
    .trim();
}

function tokens(s){
  return normalizeText(s)
    .split(/\s+/)
    .filter(Boolean)
    .filter(x=>x.length>2);
}

function buildTopicTerms(meta){
  const display=String(meta?.display||'').trim();
  const keywords=String(meta?.keywords||'').trim();
  const terms=[display,...keywords.split(/[\s,;/|]+/)]
    .map(normalizeText)
    .filter(Boolean);
  return [...new Set(terms)];
}

function topicTokenSet(meta){
  return new Set(tokens(`${meta?.display||''} ${meta?.keywords||''}`));
}

function chapterTimestampRegex(){
  // Accept 0:00, 00:00, 1:02:03 with optional leading bullet/space.
  return /(?:^|\s)(?:[-*•]\s*)?((?:\d{1,2}:)?\d{1,2}:\d{2})(?:\s+[-–—:|.]?\s*)([^\n|]{2,120})/g;
}

export function parseDescriptionTimestamps(description=''){
  const out=[];
  const source=String(description||'').replace(/\r/g,'');
  const re=chapterTimestampRegex();
  let match;
  while((match=re.exec(source))){
    const label=String(match[2]||'').trim().replace(/\s+/g,' ');
    const start=parseTimestamp(match[1]);
    if(start===null || !label)continue;
    out.push({start,title:label});
  }
  const unique=[];
  const seen=new Set();
  for(const x of out){
    const key=`${x.start}|${x.title.toLowerCase()}`;
    if(!seen.has(key)){unique.push(x);seen.add(key);}
  }
  return unique.sort((a,b)=>a.start-b.start);
}

function parseTimestamp(value){
  const parts=String(value||'').trim().split(':').map(Number);
  if(parts.some(n=>!Number.isFinite(n)))return null;
  if(parts.length===2)return parts[0]*60+parts[1];
  if(parts.length===3)return parts[0]*3600+parts[1]*60+parts[2];
  return null;
}

function scoreTextAgainstTopic(text,meta){
  const hay=normalizeText(text);
  const topic=normalizeText(meta?.display||'');
  const topicTokens=topicTokenSet(meta);
  const terms=buildTopicTerms(meta);
  let score=0;

  if(topic && hay.includes(topic))score+=8;

  for(const term of terms){
    if(term.length>3 && hay.includes(term))score+=2.5;
  }

  const hitTokens=[...topicTokens].filter(t=>hay.includes(t));
  score+=Math.min(hitTokens.length,6)*1.2;

  // Small penalty for generic chapter/intro labels when only one weak token matches.
  if(score>0 && score<4 && /intro|introduction|overview|course|welcome|basics|beginner/i.test(hay))score-=1;
  return Math.max(0,score);
}

export function findChapterTimestamp(chapters,meta){
  if(!Array.isArray(chapters)||!chapters.length)return null;
  let best=null;
  for(const chapter of chapters){
    const score=scoreTextAgainstTopic(chapter.title,meta);
    if(!best || score>best.score){best={...chapter,score};}
  }
  // A real YouTube chapter should have a meaningful relationship to the
  // target topic. Direct topic/title matches score well above this floor;
  // generic words alone should not.
  if(!best || best.score<3.5)return null;
  return {
    start:best.start,
    target_subtopic:best.title,
    source:best.source==='chapterRenderer' || best.source==='macroMarkersListItemRenderer'
      ? 'youtube_chapter'
      : 'description_chapter',
    confidence:Number(Math.min(0.95,0.76+best.score/50).toFixed(2))
  };
}

export function findTranscriptTimestamp(lines,meta){
  if(!Array.isArray(lines)||!lines.length)return null;
  let best=null;
  const topicTokensSet=topicTokenSet(meta);
  const strongTerms=buildTopicTerms(meta).filter(x=>x.length>3);

  for(let i=0;i<lines.length;i++){
    const line=lines[i];
    const text=String(line?.text||'');
    const score=scoreTextAgainstTopic(text,meta);
    if(score<4)continue;

    // Prefer lines that start a teaching segment rather than a passing mention.
    const context=lines.slice(i,Math.min(lines.length,i+5)).map(x=>String(x?.text||'')).join(' ');
    const contextScore=scoreTextAgainstTopic(context,meta);
    const combined=score+(contextScore>=7?2:0);

    if(!best || combined>best.score || (combined===best.score && Number(line.start)<best.start)){
      best={start:Number(line.start)||0,text,target_subtopic:text,score:combined};
    }
  }

  if(!best)return null;

  const normalized=normalizeText(best.text);
  const exactDisplay=normalizeText(meta?.display||'');
  const hasExactDisplay=exactDisplay && normalized.includes(exactDisplay);
  const matchedStrong=strongTerms.filter(t=>normalized.includes(t)).length;
  const tokenHits=[...topicTokensSet].filter(t=>normalized.includes(t)).length;

  // Avoid treating a single incidental keyword as the start of teaching.
  if(!hasExactDisplay && matchedStrong===0 && tokenHits<2)return null;

  return {
    start:Math.max(0,Math.floor(best.start)),
    target_subtopic:best.text,
    source:'transcript',
    confidence:Number(Math.min(0.98,0.84+(hasExactDisplay?0.10:0)+(tokenHits>=3?0.04:0)).toFixed(2))
  };
}

function formatTimestamp(seconds){
  const total=Math.max(0,Math.floor(Number(seconds)||0));
  const h=Math.floor(total/3600);
  const m=Math.floor((total%3600)/60);
  const s=total%60;
  return h>0
    ? `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`
    : `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}

function youtubeWatchUrl(videoId,startSeconds=0){
  const base=`https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
  return Number(startSeconds)>0 ? `${base}&t=${Math.floor(startSeconds)}s` : base;
}

function youtubeEmbedUrl(videoId,startSeconds=0,origin=''){
  const u=new URL(`https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}`);
  u.searchParams.set('cc_load_policy','1');
  u.searchParams.set('enablejsapi','1');
  if(origin){
    u.searchParams.set('origin',origin);
    u.searchParams.set('widget_referrer',origin);
  }
  if(Number(startSeconds)>0)u.searchParams.set('start',String(Math.floor(startSeconds)));
  return u.toString();
}

// YouTube chapter data is not consistently returned by the public Data API.
// The watch page / WEB "next" response can expose the actual chapter markers,
// including automatic chapters. Keep this cache short so chapter changes do not
// linger and repeated topic-card loads do not hammer YouTube.
const watchDataCache = new Map();
const WATCH_CACHE_TTL_MS = 10 * 60 * 1000;
const WEB_CLIENT_VERSION = '2.20250919.01.00';

function chapterTitleValue(value){
  if(typeof value === 'string') return value;
  if(value?.simpleText) return String(value.simpleText);
  if(Array.isArray(value?.runs)) return value.runs.map(x => x?.text || '').join('');
  return '';
}

function timeDescriptionValue(value){
  const text = chapterTitleValue(value);
  const match = text.match(/(?:^|\s)((?:\d{1,2}:)?\d{1,2}:\d{2})(?:$|\s)/);
  return match ? match[1] : '';
}

function addChapter(out, start, title, source){
  const sec=Number(start);
  const clean=String(title||'').trim().replace(/\s+/g,' ');
  if(!Number.isFinite(sec) || sec<0 || !clean)return;
  out.push({start:Math.floor(sec),title:clean,source});
}

function collectChapterMarkers(node,out=[],seen=new Set(),depth=0){
  if(!node || typeof node!=='object' || depth>30)return out;
  if(seen.has(node))return out;
  seen.add(node);

  if(Array.isArray(node)){
    for(const item of node)collectChapterMarkers(item,out,seen,depth+1);
    return out;
  }

  const cr=node.chapterRenderer;
  if(cr){
    const startMs=Number(cr.timeRangeStartMillis);
    if(Number.isFinite(startMs)){
      addChapter(out,startMs/1000,chapterTitleValue(cr.title),'chapterRenderer');
    }
  }

  const macro=node.macroMarkersListItemRenderer;
  if(macro){
    const endpoint=macro?.onTap?.watchEndpoint || macro?.onTap?.commandMetadata?.webCommandMetadata || {};
    let start=null;
    if(Number.isFinite(Number(endpoint.startTimeSeconds))) start=Number(endpoint.startTimeSeconds);
    else if(Number.isFinite(Number(endpoint.startTimeMs))) start=Number(endpoint.startTimeMs)/1000;
    else {
      const td=timeDescriptionValue(macro.timeDescription);
      if(td)start=parseTimestamp(td);
    }
    addChapter(out,start,chapterTitleValue(macro.title),'macroMarkersListItemRenderer');
  }

  for(const value of Object.values(node))collectChapterMarkers(value,out,seen,depth+1);
  return out;
}

function dedupeChapters(chapters=[]){
  const sorted=[...chapters]
    .filter(x=>Number.isFinite(Number(x?.start)) && String(x?.title||'').trim())
    .sort((a,b)=>Number(a.start)-Number(b.start));
  const out=[];
  const seen=new Set();
  for(const c of sorted){
    const key=`${Math.floor(Number(c.start))}|${normalizeText(c.title)}`;
    if(seen.has(key))continue;
    seen.add(key);
    out.push({start:Math.floor(Number(c.start)),title:String(c.title).trim(),source:c.source||'youtube_watch_page'});
  }
  return out;
}

function extractAssignedJson(text,variableName){
  const source=String(text||'');
  const marker=new RegExp(String.raw`(?:var\s+|let\s+|const\s+)?${variableName}\s*=\s*`);
  const match=marker.exec(source);
  if(!match)return null;
  let i=match.index+match[0].length;
  while(i<source.length && /\s/.test(source[i]))i++;
  if(source[i]!=='{' && source[i]!=='[')return null;
  const start=i;
  let depth=0,quote=null,escape=false;
  for(;i<source.length;i++){
    const ch=source[i];
    if(quote){
      if(escape)escape=false;
      else if(ch==='\\')escape=true;
      else if(ch===quote)quote=null;
      continue;
    }
    if(ch==='"' || ch==="'"){quote=ch;continue;}
    if(ch==='{' || ch==='[')depth++;
    else if(ch==='}' || ch===']'){
      depth--;
      if(depth===0){
        try{return JSON.parse(source.slice(start,i+1));}catch{return null;}
      }
    }
  }
  return null;
}

function extractInnertubeBootstrap(html){
  const source=String(html||'');
  const apiKey=source.match(/INNERTUBE_API_KEY\"\s*:\s*\"([^\"]+)\"/)?.[1] ||
    source.match(/INNERTUBE_API_KEY\s*[:=]\s*[\"']([^\"']+)[\"']/)?.[1] || '';
  const version=source.match(/INNERTUBE_CLIENT_VERSION\"\s*:\s*\"([^\"]+)\"/)?.[1] ||
    source.match(/INNERTUBE_CLIENT_VERSION\s*[:=]\s*[\"']([^\"']+)[\"']/)?.[1] || WEB_CLIENT_VERSION;
  const visitor=source.match(/VISITOR_DATA\"\s*:\s*\"([^\"]+)\"/)?.[1] || '';
  return {apiKey,version,visitor};
}

async function fetchYouTubeWatchData(videoId){
  const id=String(videoId||'').trim();
  if(!id)return {description:'',duration_seconds:null,chapters:[],raw:null};
  const cached=watchDataCache.get(id);
  if(cached && Date.now()-cached.at<WATCH_CACHE_TTL_MS)return cached.data;

  let data={description:'',duration_seconds:null,chapters:[],raw:null,bootstrap:{}};
  try{
    const url=`https://www.youtube.com/watch?v=${encodeURIComponent(id)}&hl=en`;
    const r=await fetchWithTimeout(url,{
      headers:{
        'user-agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/153.0 Safari/537.36',
        'accept-language':'en-US,en;q=0.9'
      }
    },10000);
    if(r.ok){
      const html=await r.text();
      data.bootstrap=extractInnertubeBootstrap(html);
      const player=extractAssignedJson(html,'ytInitialPlayerResponse');
      const initial=extractAssignedJson(html,'ytInitialData');
      data.raw={player,initial};
      data.description=player?.videoDetails?.shortDescription || player?.microformat?.playerMicroformatRenderer?.description?.simpleText || '';
      const duration=Number(player?.videoDetails?.lengthSeconds);
      data.duration_seconds=Number.isFinite(duration)?duration:null;
      data.chapters=dedupeChapters(collectChapterMarkers(player));
      if(!data.chapters.length && initial){
        data.chapters=dedupeChapters(collectChapterMarkers(initial));
      }
    }
  }catch{}

  // The WEB "next" watch-page response is another place where YouTube exposes
  // actual chapter markers. It also covers cases where the initial HTML omits them.
  if(!data.chapters.length){
    try{
      const key=data.bootstrap?.apiKey || '';
      const u=new URL('https://www.youtube.com/youtubei/v1/next');
      u.searchParams.set('prettyPrint','false');
      if(key)u.searchParams.set('key',key);
      const version=data.bootstrap?.version || WEB_CLIENT_VERSION;
      const headers={
        'content-type':'application/json',
        'user-agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/153.0 Safari/537.36',
        'origin':'https://www.youtube.com',
        'referer':`https://www.youtube.com/watch?v=${encodeURIComponent(id)}`,
        'x-youtube-client-name':'1',
        'x-youtube-client-version':version
      };
      if(data.bootstrap?.visitor)headers['x-goog-visitor-id']=data.bootstrap.visitor;
      const payload={
        context:{client:{clientName:'WEB',clientVersion:version,hl:'en',gl:'US'}},
        videoId:id,
        contentCheckOk:true,
        racyCheckOk:true
      };
      const r=await fetchWithTimeout(u,{method:'POST',headers,body:JSON.stringify(payload)},10000);
      if(r.ok){
        const next=await r.json();
        data.raw={...(data.raw||{}),next};
        data.chapters=dedupeChapters(collectChapterMarkers(next));
        if(!data.description){
          data.description=next?.videoDetails?.shortDescription || '';
        }
        if(!data.duration_seconds){
          const duration=Number(next?.videoDetails?.lengthSeconds);
          if(Number.isFinite(duration))data.duration_seconds=duration;
        }
      }
    }catch{}
  }

  watchDataCache.set(id,{at:Date.now(),data});
  return data;
}

function unavailableTimestamp(){
  return {
    timestamp_available:false,
    start_seconds:0,
    start_timestamp:'00:00',
    timestamp_source:'unavailable',
    timestamp_confidence:0,
    is_estimate:false,
    target_subtopic:null
  };
}

function decodeXmlEntities(text){
  return String(text||'')
    .replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi,(_,n)=>String.fromCodePoint(parseInt(n,16)))
    .replace(/&nbsp;/gi,' ')
    .replace(/&amp;/g,'&')
    .replace(/&lt;/g,'<')
    .replace(/&gt;/g,'>')
    .replace(/&quot;/g,'"')
    .replace(/&#39;/g,"'");
}

function transcriptLinesFromJson3(data){
  const lines=[];
  for(const ev of Array.isArray(data?.events)?data.events:[]){
    const segs=Array.isArray(ev?.segs)?ev.segs:[];
    const text=segs.map(x=>x?.utf8||'').join('').replace(/\s+/g,' ').trim();
    const start=Number(ev?.tStartMs)/1000;
    if(text && Number.isFinite(start)){
      lines.push({start:Number(start.toFixed(1)),text});
    }
  }
  return lines;
}

function transcriptLinesFromXml(content){
  return [...String(content||'').matchAll(/<text\b[^>]*start="([^"]+)"[^>]*>([\s\S]*?)<\/text>/g)]
    .map(m=>({
      start:Number(Number(m[1]).toFixed(1)),
      text:decodeXmlEntities(m[2]).replace(/\s+/g,' ').trim()
    }))
    .filter(x=>x.text && Number.isFinite(x.start));
}

function captionTrackName(track){
  const name=track?.name;
  if(typeof name==='string')return name;
  if(name?.simpleText)return String(name.simpleText);
  if(Array.isArray(name?.runs))return name.runs.map(x=>x?.text||'').join('');
  return '';
}

function captionTrackLabel(track){
  const code=String(track?.languageCode||'').trim();
  const name=captionTrackName(track);
  return name || code || 'Unknown';
}

function normalizeCaptionTrackUrl(baseUrl,targetLang){
  const u=new URL(baseUrl);
  // JSON3 gives accurate timing and is easier to parse than XML. If YouTube
  // refuses JSON3, callers fall back to the original URL automatically.
  u.searchParams.set('fmt','json3');
  if(targetLang)u.searchParams.set('tlang',targetLang);
  return u.toString();
}

async function fetchCaptionTrackUrl(baseUrl,targetLang=''){
  if(!baseUrl)return {ok:false,lines:[],error:'Caption track URL was not available.'};
  const urls=[];
  try{urls.push(normalizeCaptionTrackUrl(baseUrl,targetLang));}catch{}
  urls.push(String(baseUrl));

  for(const url of urls){
    try{
      const r=await fetchWithTimeout(url,{
        headers:{'user-agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/153.0 Safari/537.36'}
      },10000);
      const content=await r.text();
      if(!r.ok || !content.trim())continue;

      let lines=[];
      try{lines=transcriptLinesFromJson3(JSON.parse(content));}catch{}
      if(!lines.length)lines=transcriptLinesFromXml(content);
      if(lines.length)return {ok:true,lines,error:null};
    }catch{}
  }
  return {ok:false,lines:[],error:'Caption track could not be read.'};
}

function getCaptionTracksFromPlayer(playerResponse){
  const tracks=playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
  return Array.isArray(tracks)?tracks.filter(x=>x?.baseUrl):[];
}

function chooseCaptionTrack(tracks,targetLang){
  if(!tracks.length)return null;
  const target=String(targetLang||'').toLowerCase();
  const exact=tracks.find(x=>String(x.languageCode||'').toLowerCase()===target);
  if(exact)return exact;
  const prefix=tracks.find(x=>String(x.languageCode||'').toLowerCase().startsWith(target+'-'));
  if(prefix)return prefix;
  const english=tracks.find(x=>String(x.languageCode||'').toLowerCase().startsWith('en'));
  return english||tracks[0];
}

async function getTranscriptFromPlayer(playerResponse,targetLang='en'){
  const tracks=getCaptionTracksFromPlayer(playerResponse);
  if(!tracks.length)return {ok:false,lines:[],error:'No caption tracks are available for this video.'};

  const requested=String(targetLang||'en').trim() || 'en';
  const source=chooseCaptionTrack(tracks,requested);
  const sourceCode=String(source?.languageCode||'').trim();

  // Prefer the requested native track. Otherwise ask YouTube to translate the
  // selected source captions into the requested language. If translation is
  // unavailable, return the actual source captions instead of fake text.
  let translated=requested && sourceCode && sourceCode.toLowerCase()!==requested.toLowerCase();
  if(translated){
    const translatedResult=await fetchCaptionTrackUrl(source.baseUrl,requested);
    if(translatedResult.ok){
      return {
        ok:true,
        lines:translatedResult.lines,
        error:null,
        language_code:requested,
        language_name:requested,
        source_language_code:sourceCode,
        source_language_name:captionTrackLabel(source),
        translated:true,
        available_languages:tracks.map(x=>({code:String(x.languageCode||''),name:captionTrackLabel(x)}))
      };
    }
  }

  const result=await fetchCaptionTrackUrl(source.baseUrl,'');
  if(!result.ok)return result;
  return {
    ok:true,
    lines:result.lines,
    error:null,
    language_code:sourceCode,
    language_name:captionTrackLabel(source),
    source_language_code:sourceCode,
    source_language_name:captionTrackLabel(source),
    translated:false,
    available_languages:tracks.map(x=>({code:String(x.languageCode||''),name:captionTrackLabel(x)}))
  };
}

async function fetchVideoMetadata(videoId,apiKey){
  if(!apiKey||!videoId)return null;
  try{
    const u=new URL('https://www.googleapis.com/youtube/v3/videos');
    u.searchParams.set('part','snippet,contentDetails,status');
    u.searchParams.set('id',videoId);
    u.searchParams.set('key',apiKey);
    const r=await fetchWithTimeout(u,{},7000);
    const d=await r.json();
    const item=d.items?.[0];
    if(!item)return null;
    return {
      title:item.snippet?.title||'',
      description:item.snippet?.description||'',
      duration_seconds:parseISODuration(item.contentDetails?.duration),
      embeddable:item.status?.embeddable!==false
    };
  }catch{return null;}
}


function extractRendererTitle(renderer){
  const title=renderer?.title;
  if(typeof title==='string')return title;
  if(title?.simpleText)return String(title.simpleText);
  if(Array.isArray(title?.runs))return title.runs.map(x=>x?.text||'').join('');
  return '';
}

function extractRendererText(value){
  if(typeof value==='string')return value;
  if(value?.simpleText)return String(value.simpleText);
  if(Array.isArray(value?.runs))return value.runs.map(x=>x?.text||'').join('');
  return '';
}

function collectSearchVideoRenderers(node,out=[],seen=new Set(),depth=0){
  if(!node || typeof node!=='object' || depth>35)return out;
  if(seen.has(node))return out;
  seen.add(node);

  if(Array.isArray(node)){
    for(const item of node)collectSearchVideoRenderers(item,out,seen,depth+1);
    return out;
  }

  for(const key of ['videoRenderer','gridVideoRenderer','compactVideoRenderer']){
    const r=node[key];
    if(r?.videoId){
      out.push(r);
      // A renderer is self-contained; still continue for nested renderers.
    }
  }

  for(const value of Object.values(node)){
    if(value && typeof value==='object')collectSearchVideoRenderers(value,out,seen,depth+1);
  }
  return out;
}

function creatorSearchAliases(creator=''){
  const n=normalizeText(creator);
  const aliases=[creator];
  if(n.includes('freecodecamp'))aliases.push('freeCodeCamp');
  if(n.includes('programming with mosh'))aliases.push('Mosh');
  if(n.includes('corey schafer'))aliases.push('Corey Schafer');
  if(n.includes('cs50'))aliases.push('CS50 Harvard');
  if(n.includes('traversy media'))aliases.push('Traversy Media');
  return [...new Set(aliases.filter(Boolean))];
}

function scoreSearchResult(result,meta,creator){
  const title=String(result?.title||'');
  const desc=String(result?.description||'');
  const owner=String(result?.channel_title||'');
  let score=scoreTextAgainstTopic(`${title} ${desc}`,meta);
  const creatorNorm=normalizeText(creator);
  const ownerNorm=normalizeText(owner);
  if(creatorNorm && ownerNorm){
    const creatorTokens=tokens(creatorNorm);
    const matched=creatorTokens.filter(t=>ownerNorm.includes(t)).length;
    score+=Math.min(4,matched)*3;
    if(ownerNorm.includes(creatorNorm))score+=10;
  }
  if(/tutorial|course|crash|guide|explained|lecture|sql|database/i.test(title))score+=1.5;
  return score;
}

async function searchYouTubeHtml(query,meta,creator){
  try{
    const url=`https://www.youtube.com/results?search_query=${q(query)}&hl=en&gl=US`;
    const r=await fetchWithTimeout(url,{
      headers:{
        'user-agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/153.0 Safari/537.36',
        'accept-language':'en-US,en;q=0.9',
        'accept':'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      }
    },10000);
    if(!r.ok)return null;
    const html=await r.text();
    const initial=extractAssignedJson(html,'ytInitialData');
    if(!initial)return null;

    const renderers=collectSearchVideoRenderers(initial);
    const candidates=[];
    const seen=new Set();
    for(const renderer of renderers){
      const id=String(renderer?.videoId||'').trim();
      if(!id || seen.has(id))continue;
      seen.add(id);
      const title=extractRendererTitle(renderer);
      if(!title)continue;
      const description=extractRendererText(renderer?.detailedMetadataSnippets?.[0]?.snippetText) ||
        extractRendererText(renderer?.descriptionSnippet?.runs);
      const channel_title=extractRendererText(renderer?.ownerText) || extractRendererText(renderer?.longBylineText) || extractRendererText(renderer?.shortBylineText);
      const length=extractRendererText(renderer?.lengthText);
      candidates.push({
        creator,
        mode:'embed',
        video_id:id,
        title,
        description,
        channel_title,
        duration_seconds:parseClockText(length),
        url:youtubeWatchUrl(id,0),
        source:'youtube_search_html',
        _score:scoreSearchResult({title,description,channel_title},meta,creator)
      });
    }

    candidates.sort((a,b)=>b._score-a._score);
    return candidates[0] || null;
  }catch{
    return null;
  }
}

function parseClockText(value){
  const text=String(value||'').trim();
  if(!text)return null;
  if(/^\d+:\d{2}:\d{2}$/.test(text)){
    const [h,m,s]=text.split(':').map(Number);
    return h*3600+m*60+s;
  }
  if(/^\d+:\d{2}$/.test(text)){
    const [m,s]=text.split(':').map(Number);
    return m*60+s;
  }
  return null;
}

async function findCreatorVideoFallback(creator,meta){
  const aliases=creatorSearchAliases(creator);
  for(const alias of aliases){
    const candidate=await searchYouTubeHtml(`${alias} ${queryForTopic(meta)} tutorial`,meta,creator);
    if(candidate)return candidate;
  }
  return null;
}

async function enrichVideo(video,meta,apiKey){
  const out={...video,...unavailableTimestamp()};
  if(!video.video_id)return out;

  // Public Data API metadata is optional. Always inspect the YouTube watch page
  // as well so chapters are discovered even when YOUTUBE_API_KEY is missing.
  const watchData=await fetchYouTubeWatchData(video.video_id);
  if(watchData?.description)out.description=watchData.description;
  if(Number.isFinite(watchData?.duration_seconds))out.duration_seconds=watchData.duration_seconds;

  const details=await fetchVideoMetadata(video.video_id,apiKey);
  if(details){
    out.title=details.title||out.title;
    out.description=details.description||out.description||'';
    out.duration_seconds=details.duration_seconds ?? out.duration_seconds;
    out.embeddable=details.embeddable;
  }

  const youtubeChapters=findChapterTimestamp(watchData?.chapters||[],meta);
  const descriptionChapters=findChapterTimestamp(parseDescriptionTimestamps(out.description),meta);

  // A real chapter boundary is already the best-known start of that section,
  // so do not make an extra transcript request when we have one.
  let transcriptHit=null;
  if(!youtubeChapters){
    let transcript=await getTranscript(video.video_id,'en');
    if(!transcript.ok && watchData?.raw?.player){
      transcript=await getTranscriptFromPlayer(watchData.raw.player);
    }
    transcriptHit=transcript.ok?findTranscriptTimestamp(transcript.lines,meta):null;
  }

  // Prefer an actual YouTube chapter boundary when the chapter itself matches
  // the target topic. Otherwise use the earliest trustworthy transcript match,
  // then explicit description timestamps.
  const selected=youtubeChapters||transcriptHit||descriptionChapters;
  if(selected){
    let start=Math.max(0,Math.floor(selected.start));
    if(Number.isFinite(out.duration_seconds))start=Math.min(start,Math.max(0,out.duration_seconds-1));
    out.timestamp_available=true;
    out.start_seconds=start;
    out.start_timestamp=formatTimestamp(start);
    out.timestamp_source=selected.source;
    out.timestamp_confidence=selected.confidence;
    out.is_estimate=false;
    out.target_subtopic=selected.target_subtopic;
  }

  return out;
}

function queryForTopic(meta){
  return `${meta.display} tutorial ${meta.keywords}`.trim();
}

export async function getVideos(skillId,topicId,apiKey,options={}){
  const meta=TOPIC_META[topicId];
  if(!meta)return [];

  const masteryMap=options?.masteryMap||{};
  const studentMastery=Number.isFinite(Number(masteryMap?.[topicId]))
    ? Number(masteryMap[topicId])
    : 0;
  const origin=String(options?.embedOrigin||'').trim();
  const query=queryForTopic(meta);
  const candidates=[];

  const flagship=FLAGSHIP_VIDEOS[skillId];
  if(flagship){
    candidates.push({
      creator:flagship.creator,
      mode:'embed',
      video_id:flagship.video_id,
      title:flagship.title,
      url:youtubeWatchUrl(flagship.video_id,0)
    });
  }

  const creatorList=CREATORS.slice(0,5).filter(c=>!(flagship&&String(c.name).toLowerCase()===String(flagship.creator).toLowerCase()));

  if(apiKey){
    const resolved=await Promise.all(creatorList.map(async c=>{
      try{
        const u=new URL('https://www.googleapis.com/youtube/v3/search');
        u.searchParams.set('part','snippet');
        u.searchParams.set('q',`${c.name} ${query}`);
        u.searchParams.set('type','video');
        u.searchParams.set('maxResults','1');
        u.searchParams.set('key',apiKey);
        const r=await fetchWithTimeout(u,{},7000);
        const d=await r.json();
        const item=d.items?.find(x=>x?.id?.videoId);
        if(item){
          return {
            creator:c.name,
            mode:'embed',
            video_id:item.id.videoId,
            title:item.snippet?.title||query,
            description:item.snippet?.description||'',
            url:youtubeWatchUrl(item.id.videoId,0)
          };
        }
      }catch{}
      return await findCreatorVideoFallback(c.name,meta);
    }));
    candidates.push(...resolved.filter(Boolean));
  }else{
    // No YouTube Data API key: resolve real creator videos by reading the
    // YouTube search page server-side instead of rendering empty search cards.
    const resolved=await Promise.all(creatorList.map(async c=>{
      const fallback=await findCreatorVideoFallback(c.name,meta);
      if(fallback)return fallback;
      // Only keep a search link when YouTube itself did not expose a usable
      // video result. This is the final fallback, not the normal path.
      return {
        creator:c.name,
        mode:'search_link',
        video_id:null,
        title:`Search "${query}" on ${c.name}`,
        url:`https://www.youtube.com/results?search_query=${q(c.name+' '+query)}`,
        ...unavailableTimestamp()
      };
    }));
    candidates.push(...resolved);
  }

  const seen=new Set();
  const unique=candidates.filter(v=>{
    if(!v.video_id)return true;
    if(seen.has(v.video_id))return false;
    seen.add(v.video_id);
    return true;
  }).slice(0,6);

  const enriched=await Promise.all(unique.map(v=>enrichVideo(v,meta,apiKey)));

  return enriched.map(v=>{
    const result={
      ...v,
      target_topic:meta.display,
      student_mastery:Number(studentMastery.toFixed(1)),
      embed_url:v.video_id?youtubeEmbedUrl(v.video_id,v.start_seconds,origin):null,
      url:v.video_id?youtubeWatchUrl(v.video_id,v.timestamp_available?v.start_seconds:0):v.url,
      reason:v.timestamp_available
        ? `Student mastery is ${studentMastery.toFixed(1)}% for ${meta.display}; this video section begins at ${v.start_timestamp}.`
        : `Student mastery is ${studentMastery.toFixed(1)}% for ${meta.display}, but no trustworthy topic timestamp was available for this video.`
    };
    return result;
  });
}

export async function getPlaylistJump(playlistId,topicDisplay,keywords,apiKey){
  if(!apiKey||!playlistId)return null;
  try{
    const items=[];
    let token='';
    for(let page=0;page<3;page++){
      const u=new URL('https://www.googleapis.com/youtube/v3/playlistItems');
      u.searchParams.set('part','snippet');
      u.searchParams.set('playlistId',playlistId);
      u.searchParams.set('maxResults','50');
      u.searchParams.set('key',apiKey);
      if(token)u.searchParams.set('pageToken',token);
      const d=await (await fetchWithTimeout(u,{},7000)).json();
      items.push(...(d.items||[]));
      token=d.nextPageToken||'';
      if(!token)break;
    }
    const words=new Set((topicDisplay+' '+keywords).toLowerCase().replace(/[^a-z0-9]+/g,' ').split(/\s+/).filter(x=>x.length>2));
    let best=null,bestScore=0;
    items.forEach((item,i)=>{
      const title=(item.snippet?.title||'').toLowerCase();
      let score=0;
      for(const w of words)if(title.includes(w))score++;
      if(score>bestScore)best={video_id:item.snippet.resourceId.videoId,title:item.snippet.title,index:i},bestScore=score;
    });
    return bestScore?best:null;
  }catch{return null;}
}

export async function getTranscript(videoId,targetLang='en'){
  const id=String(videoId||'').trim();
  if(!id)return {ok:false,lines:[],error:'Missing video id.'};

  try{
    const watchData=await fetchYouTubeWatchData(id);
    const player=watchData?.raw?.player;
    if(player){
      const direct=await getTranscriptFromPlayer(player,targetLang||'en');
      if(direct.ok)return direct;
    }

    // Legacy fallback for videos where timedtext still exposes tracks but the
    // watch-page player response did not expose them.
    const list=await fetchWithTimeout(`https://video.google.com/timedtext?type=list&v=${encodeURIComponent(id)}`,{
      headers:{'user-agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/153.0 Safari/537.36'}
    },9000);
    const xml=await list.text();
    const trackMatches=[...xml.matchAll(/<track\b[^>]*lang_code="([^"]+)"[^>]*>/g)];
    if(!trackMatches.length)return {ok:false,lines:[],error:'Transcript unavailable for this video.'};

    const target=String(targetLang||'en').toLowerCase();
    const sourceCode=(trackMatches.map(m=>m[1]).find(x=>String(x).toLowerCase()===target)
      ||trackMatches.map(m=>m[1]).find(x=>String(x).toLowerCase().startsWith('en'))
      ||trackMatches[0][1]);

    const u=new URL('https://video.google.com/timedtext');
    u.searchParams.set('v',id);
    u.searchParams.set('lang',sourceCode);
    u.searchParams.set('fmt','json3');
    if(targetLang && target.toLowerCase()!==String(sourceCode).toLowerCase())u.searchParams.set('tlang',targetLang);

    const r=await fetchWithTimeout(u,{
      headers:{'user-agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/153.0 Safari/537.36'}
    },9000);
    const cap=await r.text();
    let lines=[];
    try{lines=transcriptLinesFromJson3(JSON.parse(cap));}catch{}
    if(!lines.length)lines=transcriptLinesFromXml(cap);

    if(!lines.length)return {ok:false,lines:[],error:'Transcript unavailable for this video.'};
    return {
      ok:true,
      lines,
      error:null,
      language_code:targetLang||sourceCode,
      language_name:targetLang||sourceCode,
      source_language_code:sourceCode,
      source_language_name:sourceCode,
      translated:Boolean(targetLang && target.toLowerCase()!==String(sourceCode).toLowerCase()),
      available_languages:trackMatches.map(m=>({code:m[1],name:m[1]}))
    };
  }catch(e){
    return {ok:false,lines:[],error:'Transcript unavailable for this video.'};
  }
}

export function getDocs(topicId){
  const m=TOPIC_META[topicId],qq=q(`${m.display} ${m.keywords}`);
  return [
    {label:'MDN Web Docs',url:`https://developer.mozilla.org/en-US/search?q=${qq}`,blurb:'Official, precise reference docs — best for exact syntax and behavior.'},
    {label:'freeCodeCamp News',url:`https://www.freecodecamp.org/news/search/?query=${qq}`,blurb:'Friendly, example-heavy written tutorials and explainer articles.'},
    {label:'GeeksforGeeks',url:`https://www.geeksforgeeks.org/?s=${qq}`,blurb:'Practice problems, diagrams, and interview-style explanations.'},
    {label:'Stack Overflow',url:`https://stackoverflow.com/search?q=${qq}`,blurb:'Real questions and answers from other learners.'}
  ];
}
