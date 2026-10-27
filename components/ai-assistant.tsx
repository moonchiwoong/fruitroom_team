'use client';
import {useEffect,useRef,useState} from 'react';
import {AlertTriangle,ArrowRight,CheckCircle2,Info,Loader2,MessageCircle,RefreshCw,Send,Square,X} from 'lucide-react';
import {Dialog,DialogContent,DialogDescription,DialogTitle} from '@/components/ui/dialog';
import type {TrackerAIContext} from '@/components/quality-tracker';
import {today,type Lot,type Observation,type Stats} from '@/lib/lot-types';
import {summarizeAll,summarizeForm,summarizeLot,type StatusSummary} from '@/lib/status-summary';

export type AssistantContext = TrackerAIContext | {mode:'real';scope:'all'|'lot';lotId?:string|null};
type Answer = {answer:string;retrievedAt:string;scopeLabel:string;evidence?:{title:string;summary?:string;fields?:{label:string;value:string|number|null;unit?:string;date?:string;kind?:string;verification?:string}[]}[];links?:{label:string;lotId?:string;page:'track'|'lots'|'model'}[]};
type Message = {id:string;question:string;answer?:Answer;error?:string;cancelled?:boolean;scope:string;askedAt:string};
type Availability={available:boolean;reason?:string;requiredSettings?:string[]};
const questions=['내 물량의 최근 측정값을 요약해 줘.','최근 실측값과 같은 날짜의 계산값을 비교해 줘.','이 예측에는 어떤 조건이 반영됐어?'];
type StatusState={loading:true}|{loading:false;summary?:StatusSummary;error?:string};
const toneIcon={ok:CheckCircle2,warn:AlertTriangle,info:Info};
const time=(d:string)=>{const date=new Date(d);return Number.isNaN(date.getTime())?'조회 시각 미확인':date.toLocaleString('ko-KR',{timeZone:'Asia/Seoul',hour12:false});};

export default function AIAssistant({initialContext,lots,onClose,onNavigate}:{initialContext:AssistantContext;lots:Lot[];onClose:()=>void;onNavigate:(page:'track'|'lots'|'model',lotId?:string)=>void}){
 const [context,setContext]=useState<AssistantContext>(initialContext),[question,setQuestion]=useState(''),[messages,setMessages]=useState<Message[]>([]),[busy,setBusy]=useState(false),[availability,setAvailability]=useState<Availability|null>(null);
 const controller=useRef<AbortController|null>(null),generation=useRef(0),busyRef=useRef(false),end=useRef<HTMLDivElement>(null);
 const isExample=context.mode==='example';
 const scopeLabel=isExample?'예시 물량 · 가상 데이터':context.scope==='all'?'내 전체 물량':lots.find(l=>l.id===context.lotId)?.name || (context.scope==='prediction'?'현재 예측 입력':'선택 물량');
 const scopeValue=isExample?'example':context.scope==='all'?'all':context.lotId || 'draft';
 useEffect(()=>{
   const ctl=new AbortController();setAvailability(null);
   fetch('/api/ai/status',{signal:ctl.signal,cache:'no-store'}).then(async r=>{const d=await r.json();if(!r.ok)throw new Error(d.error||'현재 AI 설명을 불러올 수 없습니다');return d as Availability;}).then(d=>{if(!ctl.signal.aborted)setAvailability(d);}).catch(()=>{if(!ctl.signal.aborted)setAvailability({available:false,reason:'현재 AI 설명을 불러올 수 없습니다. 기존 품질 예측과 물량 기록은 계속 사용할 수 있습니다.'});});
   return ()=>ctl.abort();
 },[]);
 const [status,setStatus]=useState<StatusState>({loading:true}),[statusReload,setStatusReload]=useState(0);
 const targetLot=context.mode==='real'&&context.scope!=='all'?context.lotId??null:null;
 useEffect(()=>{
   const day=today();
   if(context.mode==='example'){setStatus({loading:false,summary:summarizeForm(context.form,[],day,null,{example:true})});return;}
   if(context.scope==='all'){setStatus({loading:false,summary:summarizeAll(lots,day)});return;}
   if(!targetLot){if(context.scope==='prediction')setStatus({loading:false,summary:summarizeForm(context.form,[],day)});else setStatus({loading:false,error:'물량을 골라 주세요.'});return;}
   const ctl=new AbortController();setStatus({loading:true});
   fetch(`/api/lots/${encodeURIComponent(targetLot)}/analysis?asOf=${day}`,{signal:ctl.signal,cache:'no-store'}).then(async r=>{const d=await r.json();if(!r.ok)throw new Error(d.error||'기록을 불러오지 못했어요.');return d as {lot:Lot;observations:Observation[];stats:Stats};})
    .then(d=>{if(ctl.signal.aborted)return;const summary=context.scope==='prediction'?summarizeForm(context.form,d.observations??[],day,d.stats):summarizeLot(d.lot,d.observations??[],day,d.stats);setStatus({loading:false,summary});})
    .catch(e=>{if(!ctl.signal.aborted)setStatus({loading:false,error:(e as Error).message||'기록을 불러오지 못했어요.'});});
   return ()=>ctl.abort();
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[context,targetLot,statusReload]);
 useEffect(()=>()=>{generation.current++;controller.current?.abort();},[]);
 useEffect(()=>{end.current?.scrollIntoView({block:'nearest',behavior:'smooth'});},[messages,busy]);
 function changeScope(value:string){generation.current++;controller.current?.abort();busyRef.current=false;setBusy(false);setMessages([]);setQuestion('');setContext(value==='all'?{mode:'real',scope:'all'}:{mode:'real',scope:'lot',lotId:value});}
 function cancel(){generation.current++;controller.current?.abort();busyRef.current=false;setBusy(false);setMessages(m=>m.map((x,i)=>i===m.length-1&&!x.answer?{...x,cancelled:true}:x));}
 async function send(text=question){
  const value=text.trim();if(!value||value.length>2000||busyRef.current||!availability?.available)return;
  busyRef.current=true;setBusy(true);setQuestion('');const token=++generation.current,id=crypto.randomUUID(),ctl=new AbortController();controller.current=ctl;
  const message:Message={id,question:value,scope:scopeLabel,askedAt:new Date().toISOString()};setMessages(m=>[...m.slice(-19),message]);
  const timeout=setTimeout(()=>ctl.abort(),45000);
  try{const r=await fetch('/api/ai/chat',{method:'POST',signal:ctl.signal,headers:{'Content-Type':'application/json'},body:JSON.stringify({question:value,context,requestId:id})});const d=await r.json();if(!r.ok)throw new Error(d.error||'현재 AI 설명을 불러올 수 없습니다');if(typeof d.answer!=='string')throw new Error('현재 AI 설명을 불러올 수 없습니다');if(generation.current!==token)return;setMessages(m=>m.map(x=>x.id===id?{...x,answer:d}:x));}
  catch(e){if(generation.current!==token)return;setMessages(m=>m.map(x=>x.id===id?{...x,error:ctl.signal.aborted?'응답 시간이 초과되었습니다. 기존 기록은 변경되지 않았습니다.':(e as Error).message}:x));}
  finally{clearTimeout(timeout);if(generation.current===token){busyRef.current=false;setBusy(false);controller.current=null;}}
 }
 return <Dialog open onOpenChange={open=>{if(!open)onClose();}}><DialogContent className="ai-assistant-panel top-0 left-auto right-0 translate-x-0 translate-y-0 data-[state=open]:animate-none data-[state=closed]:animate-none" showCloseButton={false} onCloseAutoFocus={event=>{event.preventDefault();document.querySelector<HTMLButtonElement>('[data-ai-return]')?.focus();}}>
  <header className="ai-panel-header"><div className="ai-brand-icon"><MessageCircle size={23}/></div><div><span className="ai-eyebrow">지금 내 사과 상태</span><DialogTitle>애플트랙 도우미</DialogTitle></div><button className="ai-close" aria-label="도우미 닫기" onClick={onClose}><X size={21}/></button></header>
  <DialogDescription className="ai-description">저장된 측정 기록과 품질 계산식으로 지금 상태를 알려 드려요. 기록을 수정하거나 출하·안전을 판정하지 않습니다.</DialogDescription>
  <div className="ai-scope"><label htmlFor="assistant-scope">현재 조회 범위</label><select id="assistant-scope" value={scopeValue} disabled={isExample} onChange={e=>changeScope(e.target.value)}>{isExample?<option value="example">예시 물량 · 가상 데이터</option>:<><option value="all">내 전체 물량</option>{scopeValue==='draft'&&<option value="draft">현재 예측 입력 · 미저장 초안</option>}{lots.map(l=><option value={l.id} key={l.id}>{l.name}</option>)}</>}</select>{context.scope==='prediction'&&<span className="ai-context-note">{context.selectedDate} · {context.metric==='firmness'?'경도':context.metric==='brix'?'당도':context.metric==='acidity'?'산도':'감모율'} · 분석 기준 {context.asOf}</span>}{isExample&&<p>실제 고객 기록과 분리된 예시 범위입니다.</p>}</div>
  <div className="ai-transcript" aria-live="polite" aria-busy={busy}>
   {status.loading?<div className="ai-notice"><Loader2 className="spin" size={18}/>기록을 불러와 상태를 정리하고 있어요.</div>:status.error?<div className="ai-answer-error" role="alert"><p>{status.error}</p><button onClick={()=>setStatusReload(v=>v+1)}><RefreshCw size={14}/>다시 불러오기</button></div>:status.summary?<section className="st-card" aria-label="현재 사과 상태"><header><h3>{status.summary.title}</h3><p>{status.summary.sub}</p></header>{status.summary.blocks.map(b=><div className="st-block" key={b.heading}><h4>{b.heading}</h4><ul>{b.items.map((it,i)=>{const Icon=toneIcon[it.tone];return <li key={i} className={`st-${it.tone}`}><Icon size={16} aria-hidden/><span>{it.text}</span></li>;})}</ul></div>)}<p className="st-note">{status.summary.note}</p>{targetLot&&!isExample&&<div className="ai-related"><button className="btn btn-outline" onClick={()=>{onNavigate('lots',targetLot);onClose();}}>측정 기록 보기<ArrowRight size={14}/></button>{context.scope!=='prediction'&&<button className="btn btn-outline" onClick={()=>{onNavigate('track',targetLot);onClose();}}>품질 예측에서 보기<ArrowRight size={14}/></button>}</div>}</section>:null}
   {availability?.available&&messages.length===0&&<div className="ai-suggestions st-ask"><p>더 궁금한 점은 AI에게 물어볼 수 있어요.</p>{questions.map(q=><button key={q} onClick={()=>void send(q)}>{q}<ArrowRight size={16}/></button>)}</div>}
   {messages.map(m=><article key={m.id} className="ai-turn"><div className="ai-question">{m.question}</div><div className="ai-answer-meta">{m.scope} · 질문 {time(m.askedAt)}</div>{m.answer?<div className="ai-answer"><p className="ai-answer-text">{m.answer.answer}</p><p className="ai-answer-meta">조회 범위: {m.answer.scopeLabel} · 조회 {time(m.answer.retrievedAt)}</p>{!!m.answer.evidence?.length&&<details className="ai-evidence"><summary>근거 기록 {m.answer.evidence.length}개</summary>{m.answer.evidence.map((e,i)=><section key={i}><b>{e.title}</b>{e.summary&&<p>{e.summary}</p>}{!!e.fields?.length&&<dl>{e.fields.map((f,j)=><div key={j}><dt>{f.label}</dt><dd>{f.value??'미측정'} {f.unit||''}{f.date&&<small>{f.date}</small>}{(f.kind||f.verification)&&<small>{[f.kind,f.verification].filter(Boolean).join(' · ')}</small>}</dd></div>)}</dl>}</section>)}</details>}{m.answer.links?.length?<div className="ai-related">{m.answer.links.map((l,i)=><button key={i} className="btn btn-outline" onClick={()=>{onNavigate(l.page,l.lotId);onClose();}}>{l.label}<ArrowRight size={14}/></button>)}</div>:null}</div>:m.error?<div className="ai-answer-error" role="alert"><p>{m.error}</p><button disabled={busy} onClick={()=>void send(m.question)}><RefreshCw size={14}/>다시 질문하기</button></div>:m.cancelled?<p className="ai-answer-meta">답변 생성을 취소했습니다.</p>:<div className="ai-notice"><Loader2 className="spin" size={17}/>기록 조회·답변 생성 중…</div>}</article>)}<div ref={end}/>
  </div>
  {availability?.available&&<form className="ai-composer" onSubmit={e=>{e.preventDefault();void send();}}><label htmlFor="assistant-question" className="sr-only">물량에 관한 질문</label><textarea id="assistant-question" placeholder="물량이나 품질 기록에 대해 질문해 주세요" value={question} onChange={e=>setQuestion(e.target.value)} maxLength={2000} rows={2} disabled={!availability?.available} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();void send();}}}/><div className="ai-composer-footer"><span>{question.length}/2,000</span>{busy?<button type="button" className="btn btn-outline" onClick={cancel}><Square size={13}/>생성 취소</button>:<button type="submit" className="btn btn-primary" disabled={!question.trim()||!availability?.available}><Send size={15}/>보내기</button>}</div><p className="ai-retention">대화는 이 창을 닫거나 조회 범위를 바꾸면 삭제됩니다. 서버에 대화를 저장하지 않습니다.</p></form>}
 </DialogContent></Dialog>;
}
