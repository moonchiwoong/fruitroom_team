'use client';
import {useEffect, useRef, useState} from 'react';
import {SIMPLE_REGIONS, simplePrediction, type SimpleRegion, type SimpleWeather} from '@/lib/simple-prediction';
import styles from './simple-prediction.module.css';

/** Future API responses must distinguish actual observations from history-based estimates. */
type WeatherEvidenceKind = 'observed' | 'historical-estimate' | 'unavailable';
type Variable = {key:string; value:number|null; reason?:string|null; period?:[string,string]; kind?:WeatherEvidenceKind; historicalYears?:number[]; minimumYears?:number; method?:'arithmetic-mean'|null; source?:string};
type WeatherResponse = {region:string; cultivar:string; harvestDate:string; station:{name:string;code?:string}; source?:string; asOf?:string; variables:Variable[]; ready:boolean; limitations?:string[]; error?:string};
type Result = ReturnType<typeof simplePrediction>;
const METRICS = [{id:'firmness',name:'경도'}, {id:'brix',name:'당도'}, {id:'acidity',name:'산도'}, {id:'loss',name:'감모율'}] as const;
const format=(n:number|null, digits:number)=>n===null?'—':n.toLocaleString('ko-KR',{maximumFractionDigits:digits});
const WEATHER_NAMES:Record<string,string>={min4:'4월 최저기온',lc56:'5~6월 생장도일',lc78:'7~8월 생장도일',rain9:'9월 강수량'};
function validHistoricalProvenance(vars:Variable[], harvestYear:number):boolean {
  return vars.every(v=>{
    if(v.kind!=='historical-estimate') return true;
    const years=v.historicalYears, minimum=v.minimumYears;
    return v.method==='arithmetic-mean' && Array.isArray(years) && Number.isInteger(minimum) && (minimum ?? 0)>=3 && years.length >= (minimum ?? Infinity)
      && new Set(years).size===years.length && years.every(y=>Number.isInteger(y)&&y>=2000&&y<harvestYear);
  });
}
function extractWeather(variables: Variable[]): SimpleWeather | null {
  const get=(...keys:string[])=>variables.find(v=>keys.includes(v.key))?.value;
  const min4=get('min4','chang_min4'),lc56=get('lc56','chang_LC56'),lc78=get('lc78','chang_LC78'),rain9=get('rain9','chang_9rain');
  if ([min4,lc56,lc78,rain9].some(x=>typeof x!=='number' || !Number.isFinite(x))) return null;
  return {min4:min4 as number,lc56:lc56 as number,lc78:lc78 as number,rain9:rain9 as number};
}
export default function SimplePrediction() {
  const [region,setRegion]=useState<SimpleRegion|''>('');
  const [harvest,setHarvest]=useState('');
  const [pending,setPending]=useState(false);
  const [message,setMessage]=useState('');
  const [data,setData]=useState<{result:Result; weather:WeatherResponse; region:SimpleRegion; harvest:string}|null>(null);
  const controller=useRef<AbortController|null>(null);
  useEffect(()=>()=>{controller.current?.abort();},[]);
  const invalidate=()=>{controller.current?.abort();controller.current=null;setPending(false);setMessage('');setData(null);};
  const run=async()=>{
    invalidate();
    if (!region || !harvest) {setMessage('재배 지역과 수확 예정일을 선택해 주세요.');return;}
    const current=new AbortController(); controller.current=current; setPending(true);
    try {
      const cultivar=region==='geochang'?'hongro':'fuji';
      const query=new URLSearchParams({region,cultivar,harvest_date:harvest});
      const response=await fetch(`/api/weather/simple?${query}`,{signal:current.signal,cache:'no-store'});
      if (controller.current!==current || current.signal.aborted) return;
      // Netlify's rate limit response can be HTML, not the API's JSON envelope.
      if (response.status===429) {setMessage('요청이 많아요. 잠시 후 다시 시도해 주세요.');return;}
      const body=await response.json() as WeatherResponse;
      if (controller.current!==current || current.signal.aborted) return;
      if (!response.ok) {setMessage(body.error || '날씨 자료를 불러오지 못했어요.');return;}
      if(body.region!==region || body.cultivar!==cultivar || body.harvestDate!==harvest) {setMessage('조회 결과의 지역이나 날짜가 맞지 않아 계산하지 않았어요.');return;}
      if (!validHistoricalProvenance(body.variables ?? [],Number(harvest.slice(0,4)))) {setMessage('과거 기상자료의 사용 연도와 추정 방법을 확인할 수 없어 계산하지 않았어요.');return;}
      const weather=extractWeather(body.variables ?? []);
      if (!body.ready || !weather) {
        const reasons=[...new Set((body.variables ?? []).map(v=>v.reason).filter((x):x is string=>!!x))];
        setMessage(reasons.length ? reasons.join(' ') : '필요한 기상자료가 아직 준비되지 않아 예측을 계산할 수 없어요.');return;
      }
      setData({result:simplePrediction(region,weather),weather:body,region,harvest});
    } catch(e) {if(!current.signal.aborted) setMessage(e instanceof Error ? e.message : '예측 결과를 불러오지 못했어요.');}
    finally {if(controller.current===current) {controller.current=null;setPending(false);}}
  };
  return <section className={styles.wrap} aria-labelledby="simple-title">
    <div className={styles.intro}><span className={styles.eyebrow}>간편 예측</span><h2 id="simple-title">수확 후 품질을 미리 살펴보세요</h2><p>지역과 수확 예정일을 고르면 해당 지역의 품종과 기상자료를 바탕으로 가능한 저장 조건을 비교해요.</p></div>
    <div className={styles.inputs}>
      <label>재배 지역<select value={region} onChange={e=>{invalidate();setRegion(e.target.value as SimpleRegion|'');}}><option value="">지역 선택</option><option value="jangsu">장수</option><option value="yeongju">영주</option><option value="geochang">거창</option></select></label>
      <label>수확 예정일<input type="date" value={harvest} onChange={e=>{invalidate();setHarvest(e.target.value);}} /></label>
      <div className={styles.cultivar}><span>적용 품종</span><strong>{region ? SIMPLE_REGIONS[region].cultivar : '지역을 선택해 주세요'}</strong></div>
      <button type="button" onClick={()=>void run()} disabled={pending}>{pending?'기상자료 확인 중…':'예측 보기'}</button>
    </div>
    <p className={styles.small}>장수·영주는 후지, 거창은 홍로 연구 자료를 사용해요. 수확 당일 저장을 시작한다고 가정합니다. 아직 관측되지 않은 기간은 같은 관측소의 최근 5개 과거 연도 중 해당 기간 자료가 완전한 해가 3년 이상일 때 평균으로 추정해요. 추정값은 실제 날씨 예보가 아닙니다.</p>
    {region==='geochang' && <p className={styles.small}>거창 홍로의 초기 품질 회귀식은 합성자료로 만든 모델이며, 실제 과실에 대한 독립 검증이 완료되지 않았어요.</p>}
    {harvest && harvest.slice(5) <= '09-30' && <p className={styles.notice} role="status">이 예측식은 9월 한 달 강수량이 필요해요. 수확 예정일이 9월 30일 이전이면 수확 당일이나 이후의 비가 포함될 수 있어 계산을 보류합니다.</p>}
    {message && <p className={styles.notice} role="status">{message}</p>}
    {data && <div className={styles.result} aria-live="polite">
      <div className={styles.resultHead}><div><span className={styles.eyebrow}>기상 기반 추정</span><h3>{SIMPLE_REGIONS[data.region].name} {SIMPLE_REGIONS[data.region].cultivar} 저장 품질</h3><p>{data.harvest} 수확 예정 · {data.weather.station.name} 기상자료</p></div></div>
      <p className={styles.notice}>수확 시점 품질은 실제 측정값이 아닌 기상 회귀 추정입니다. 저장식과 연결한 결과의 정확도는 독립 검증되지 않았어요.{data.region==='geochang' && ' 거창 홍로의 초기 품질 회귀식은 합성자료를 기반으로 만들었습니다.'}</p>
      <details className={styles.small}><summary>기상자료 출처와 추정 기준</summary><p>{data.weather.source || '농촌진흥청 농업날씨365'} · {data.weather.station.name}{data.weather.asOf ? ` · 자료 확인일 ${data.weather.asOf}` : ''}</p><ul>{data.weather.variables.map(v=><li key={v.key}>{WEATHER_NAMES[v.key] ?? v.key}: {v.kind==='historical-estimate' ? `과거 관측 ${v.historicalYears?.join(', ')}년 단순평균 (예보나 해당 연도 실측 아님)` : v.kind==='observed' ? '해당 연도 관측' : v.kind==='unavailable' ? '자료 없음' : '농업날씨365 일자료'}{v.period ? ` · ${v.period[0]}~${v.period[1]}` : ''}</li>)}</ul></details>
      <p className={styles.small}>초기 경도 자료와 저장식의 단위 표기가 달라 저장 중 경도 예측은 표시하지 않아요. 단위와 측정법을 확인한 뒤 제공할게요.</p>
      <div className={styles.initial}><b>예상 초기 품질</b><span>경도 {format(data.result.initial.firmness,1)} <small>N/mm · 자료 표기</small></span><span>당도 {format(data.result.initial.brix,1)} °Brix</span><span>산도 {format(data.result.initial.acidity,3)} %</span></div>
      {data.result.conditions.map(condition=><article className={styles.card} key={condition.label}><h4>{condition.label}</h4><p>수확 당일부터 저장한 경우의 모델 계산</p><div className={styles.tableWrap}><table><thead><tr><th scope="col">저장 기간</th>{METRICS.map(m=><th key={m.id} scope="col">{m.name}</th>)}</tr></thead><tbody>{condition.rows.map(row=><tr key={row.day}><th scope="row">{row.day}일</th>{METRICS.map(m=>{const v=row.values[m.id];return <td key={m.id}>{format(v.value,m.id==='acidity'?3:m.id==='loss'?2:1)}{v.ok && <> <small>{m.id==='firmness'?'단위 확인':v.unit}</small></>}</td>;})}</tr>)}</tbody></table></div></article>)}
      <p className={styles.small}>표시 기간은 보관 가능 기간이나 안전을 보장하지 않으며, 조건의 우열을 확정하지 않습니다. 후지 저장식의 온도 및 일부 조건은 원자료에서 확인되지 않았습니다.</p>
      {(data.weather.limitations ?? []).map(x=><p className={styles.small} key={x}>{x}</p>)}
    </div>}
  </section>;
}
