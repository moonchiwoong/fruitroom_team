import type {Lot,EnvRow,Stats,Observation,Prediction} from './lot-types';
import {parseOptionalNumber, restrictLegacyLoss} from './quality-policy';
export class InputError extends Error{rows?:string[];constructor(message:string,rows?:string[]){super(message);this.rows=rows;}}
export function numberOrNull(v:unknown,min:number,max:number,label:string){const p=parseOptionalNumber(v);if(p.status==='missing')return null;if(p.status==='invalid')throw new InputError(`${label}: ${p.reason}`);if(p.value<min||p.value>max)throw new InputError(`${label}: 단위와 소수점을 확인해 주세요. 기존 시스템의 저장 허용 범위는 ${min}~${max}이며 정상 품질이나 모델 적용 범위를 뜻하지 않습니다.`);return p.value;}
export function validDate(v:unknown,label='날짜'){if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v)||!Number.isFinite(Date.parse(v+'T00:00:00Z'))||new Date(v+'T00:00:00Z').toISOString().slice(0,10)!==v)throw new InputError(`${label}를 확인해 주세요.`);return v;}
export function endOfKoreanDay(day:string){validDate(day);return new Date(day+'T23:59:59.999+09:00').toISOString();}
export function startOfKoreanDay(day:string){validDate(day);return new Date(day+'T00:00:00+09:00').toISOString();}
export function parseCsv(text:string,sensorId:string){
 const s=text.replace(/^\uFEFF/,'');const rows:string[][]=[];let row:string[]=[],cell='',quote=false;
 for(let i=0;i<s.length;i++){const ch=s[i];if(ch==='"'){if(quote&&s[i+1]==='"'){cell+='"';i++;}else quote=!quote;}else if(ch===','&&!quote){row.push(cell.trim());cell='';}else if((ch==='\n'||ch==='\r')&&!quote){if(ch==='\r'&&s[i+1]==='\n')i++;row.push(cell.trim());if(row.some(Boolean))rows.push(row);row=[];cell='';}else cell+=ch;}
 if(quote)throw new InputError('닫히지 않은 따옴표가 있습니다. CSV 형식을 확인해 주세요.');row.push(cell.trim());if(row.some(Boolean))rows.push(row);
 if(rows.length<2)throw new InputError('헤더와 최소 1개 기록이 필요합니다.');if(rows.length>3001)throw new InputError('한 번에 최대 3,000개 기록을 올릴 수 있습니다.');
 const aliases:Record<string,string>={'측정시각':'timestamp','측정일시':'timestamp','datetime':'timestamp','센서번호':'sensor_id','센서':'sensor_id','온도':'temperature','습도':'humidity'};
 const headers=rows[0].map(x=>aliases[x]??x.toLowerCase());for(const h of ['timestamp','sensor_id','temperature','humidity'])if(!headers.includes(h))throw new InputError(`필수 열이 없습니다: ${h}`);
 const parsed:EnvRow[]=[];const issues:string[]=[];let mismatched=0,duplicates=0;const seen=new Set<string>();
 for(let r=1;r<rows.length;r++){
  const get=(key:string)=>rows[r][headers.indexOf(key)]??'';
  if(get('sensor_id')!==sensorId){mismatched++;continue;}
  let t=get('timestamp').replace(' ','T');if(!/(Z|[+-]\d\d:\d\d)$/.test(t))t+='+09:00';const ms=Date.parse(t);
  try{validDate(t.slice(0,10),'측정일시');if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/.test(t))throw new InputError('ISO 날짜 형식이 필요합니다.');if(!Number.isFinite(ms)||!get('temperature')||!get('humidity'))throw new InputError('날짜 또는 값 누락');const temperature=numberOrNull(get('temperature'),-15,50,'온도')!,humidity=numberOrNull(get('humidity'),0,100,'습도')!;const timestamp=new Date(ms).toISOString();if(seen.has(timestamp)){duplicates++;continue;}seen.add(timestamp);parsed.push({timestamp,sensor_id:sensorId,temperature,humidity});}catch(e){issues.push(`${r+1}행: ${e instanceof InputError?e.message:'날짜·온도·습도를 확인해 주세요.'} (${rows[r].join(', ').slice(0,80)})`);}
 }
 if(issues.length)throw new InputError(`오류 ${issues.length}개 행 때문에 전체 업로드를 취소했습니다. 아래 행을 고친 뒤 다시 올려 주세요.`,issues.slice(0,100));
 if(!parsed.length)throw new InputError(`센서 ${sensorId}와 일치하는 유효한 기록이 없습니다.`);
 return {rows:parsed.sort((a,b)=>a.timestamp.localeCompare(b.timestamp)),mismatched,duplicates};
}
export function summarizeEnvironment(allRows:EnvRow[],lot:Lot,asOf:string):Stats{
 const cutoff=new Date(Math.min(Date.parse(endOfKoreanDay(asOf)),Date.now())).toISOString(),start=startOfKoreanDay(lot.intake_date);
 const relevant=allRows.filter(r=>r.sensor_id===lot.sensor_id&&r.timestamp>=start);
 const rows=relevant.filter(r=>r.timestamp<=cutoff).sort((a,b)=>a.timestamp.localeCompare(b.timestamp));
 const mean=(values:number[])=>values.reduce((a,b)=>a+b,0)/values.length;
 const sd=(values:number[])=>{const m=mean(values);return Math.sqrt(mean(values.map(x=>(x-m)**2)));};
 const diffs=rows.slice(1).map((r,i)=>(Date.parse(r.timestamp)-Date.parse(rows[i].timestamp))/60000).filter(x=>x>0).sort((a,b)=>a-b);
 const interval=diffs.length?diffs[Math.floor(diffs.length/2)]:null;
 let gapCount=0,missingSlots=0,outOfRangeHours=0,coverageHours=0;
 rows.slice(0,-1).forEach((r,i)=>{const minutes=(Date.parse(rows[i+1].timestamp)-Date.parse(r.timestamp))/60000;if(interval&&minutes>interval*1.5){gapCount++;missingSlots+=Math.max(0,Math.round(minutes/interval)-1);}else {coverageHours+=minutes/60;if(r.temperature>1||r.temperature< -1||r.humidity<90||r.humidity>95)outOfRangeHours+=minutes/60;}});
 const ts=rows.map(r=>r.temperature),hs=rows.map(r=>r.humidity);const last=rows.at(-1)?.timestamp??null;
 return {count:rows.length,meanTemperature:rows.length?mean(ts):null,sdTemperature:rows.length?sd(ts):null,meanHumidity:rows.length?mean(hs):null,sdHumidity:rows.length?sd(hs):null,minTemperature:rows.length?Math.min(...ts):null,maxTemperature:rows.length?Math.max(...ts):null,gapCount,missingSlots,expectedIntervalMinutes:interval,outOfRangeHours,coverageHours,futureExcluded:relevant.filter(r=>r.timestamp>cutoff).length,lastRecorded:last,stale:!last||Date.parse(cutoff)-Date.parse(last)>86400000,rows};
}
export function reviewLot(lot:Lot,stats?:Stats,observations:Observation[]=[]){
 const reasons:string[]=[];let priority=0;
 const latest=observations.at(-1);
 if(latest&&!['없음','미확인'].includes(latest.defects)){reasons.push(`최근 표본에서 ${latest.defects} 관찰`);priority=3;}
 if(!stats?.count){reasons.push('환경 이력 미등록');priority=Math.max(priority,2);}
 else {if(stats.stale){reasons.push('최근 24시간 내 환경 기록 없음');priority=Math.max(priority,2);}if(stats.gapCount){reasons.push(`환경 기록 공백 ${stats.gapCount}구간`);priority=Math.max(priority,2);}if(stats.outOfRangeHours>0){reasons.push(`참고 온습도 범위 이탈 ${stats.outOfRangeHours.toFixed(1)}시간`);priority=Math.max(priority,2);}}
 if(lot.firmness===null&&!observations.some(x=>x.firmness!==null)){reasons.push('경도 미측정');priority=Math.max(priority,1);}
 if(lot.storage==='CA'||lot.mcp==='처리'){reasons.push('저장·처리 조건별 모델 검증 필요');priority=Math.max(priority,1);}
 return {priority,label:priority===3?'우선 점검':priority===2?'기록·환경 확인':priority===1?'추가 확인':'정기 관찰',reasons:reasons.length?reasons:['등록된 기준 내에서 관찰 중 · 안전 판정 아님']};
}
export function demoPrediction(lot:Lot,stats:Stats,observations:Observation[],asOf:string):Prediction{
 const latest=[...observations].reverse().find(x=>x.firmness!==null);const initial=latest?.firmness??lot.firmness;
 const temp=stats.meanTemperature??0,humidity=stats.meanHumidity??92;
 const base={asOf,horizonDays:7,assumedTemperature:temp,assumedHumidity:humidity,errorRange:null,modelVersion:'연결 확인용 예시 v2',sampleOnly:true as const,limitations:['학습·검증된 예측 모델 미연결','신뢰구간과 예측 오차 미검증','사진으로 경도·당도를 추정하지 않음','표본값은 전체 물량의 확정 상태가 아님']};
 if(initial===null||!stats.count||lot.storage!=='일반 저온'||lot.mcp!=='미처리')return {...base,mode:'unavailable',firmness:null,weightLoss:null,reason:initial===null?'초기 또는 최근 경도 측정이 필요합니다.':!stats.count?'분석 시점까지의 환경 기록이 필요합니다.':'CA·기타 저장, 1-MCP 처리 또는 미확인 조건은 예시 모델의 적용 범위 밖입니다.'};
 const days=Math.max(0,(Date.parse(asOf)-Date.parse(latest?.date??lot.intake_date))/86400000)+7;const heat=Math.pow(2,temp/10),loss=7*0.012*heat*(1+Math.max(0,90-humidity)*0.08);
 return restrictLegacyLoss({...base,mode:'demo_only' as const,firmness:Math.max(0,initial-days*0.18*heat),weightLoss:loss});
}
