import {today,type Lot,type EnvRow,type Observation} from './lot-types';
import {summarizeEnvironment} from './lot-analysis';
export function shiftDate(day:string,n:number){const d=new Date(day+'T12:00:00+09:00');d.setUTCDate(d.getUTCDate()+n);return d.toLocaleDateString('sv-SE',{timeZone:'Asia/Seoul'});}
export function demoLots():Lot[]{const now=today();return [
 {id:'demo-a',name:'후지 A · 입구 구역',location:'1호 저장고 / 입구',sensor_id:'T-01',quantity:420,storage:'일반 저온',mcp:'미처리',firmness:72,brix:14.2,weight:285,acidity:0.38},
 {id:'demo-b',name:'후지 B · 안쪽 구역',location:'1호 저장고 / 안쪽',sensor_id:'T-02',quantity:680,storage:'일반 저온',mcp:'미처리',firmness:75,brix:14.8,weight:302,acidity:0.40},
 {id:'demo-c',name:'후지 C · 처리 물량',location:'2호 저장고 / 중단',sensor_id:'T-03',quantity:350,storage:'CA',mcp:'처리',firmness:null,brix:13.8,weight:null,acidity:null},
 ].map(l=>({...l,variety:'후지',harvest_date:shiftDate(now,-29),intake_date:shiftDate(now,-28),packaging:'통기성 상자',notes:'기능 확인용 가상 물량입니다. 실제 농가의 데이터가 아닙니다.',created_at:shiftDate(now,-28)}));}
export function demoAnalysis(lot:Lot,asOf:string){const rows:EnvRow[]=[];const base=Date.parse(lot.intake_date+'T00:00:00+09:00');const a=lot.id==='demo-a';for(let i=0;i<31*24;i++){if(a&&i>=380&&i<386)continue;rows.push({timestamp:new Date(base+i*3600000).toISOString(),sensor_id:lot.sensor_id??'',temperature:Math.round((a?2.4+Math.sin(i/12)*1.5+(i>450?1.0:0):0.3+Math.sin(i/18)*0.35)*100)/100,humidity:Math.round((a?86+Math.sin(i/8)*3:93+Math.sin(i/14))*100)/100});}
 const observations:Observation[]=[7,14,21,27].filter(d=>shiftDate(lot.intake_date,d)<=asOf).map((d,i)=>({id:lot.id+'-'+d,lot_id:lot.id,date:shiftDate(lot.intake_date,d),firmness:lot.firmness===null?null:Math.round((lot.firmness-(a?i*2.8+2:i*0.9+0.8))*10)/10,brix:lot.brix,weight:lot.weight===null?null:Math.round(lot.weight*(1-(a?0.008:0.002)*(i+1))*10)/10,defects:a&&d===27?'주름':'없음',sample_count:5,notes:'가상 표본 관측 · 화면 시연용'}));
 return {lot,asOf,stats:summarizeEnvironment(rows,lot,asOf),observations,photos:[],prediction:null};}
