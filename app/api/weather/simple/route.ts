/** 간편 예측용 공공 관측자료. 키와 원본 오류 내용은 응답이나 로그에 포함하지 않는다. */
import {RDA_DAILY_URL, parseDailyXml} from '@/lib/rda-weather';
import {SIMPLE_STATIONS, computeSimpleWeather, estimateWeatherFromHistory, validCalendarDate, type SimpleRegion, type SimpleCultivar, type SimpleDailyObs, type SimpleWeatherKey} from '@/lib/simple-weather';

export const dynamic='force-dynamic';
const kstToday=()=>new Date(Date.now()+9*3600e3).toISOString().slice(0,10);
const MAX_CALLS=30, MAX_CONCURRENT=4, TOTAL_TIMEOUT_MS=20_000;
const MINIMUM_YEARS=3, HISTORY_YEARS=5;
type MonthTask={year:number;month:number};
const months:Record<SimpleWeatherKey,number[]>={min4:[4],lc56:[5,6],lc78:[7,8],rain9:[9]};

export async function GET(req:Request) {
  const query=new URL(req.url).searchParams;
  const region=query.get('region') as SimpleRegion | null;
  const cultivar=query.get('cultivar') as SimpleCultivar | null;
  const harvestDate=query.get('harvest_date')??'';
  if(!region || !Object.hasOwn(SIMPLE_STATIONS,region) || !cultivar || SIMPLE_STATIONS[region].cultivar!==cultivar || !validCalendarDate(harvestDate)) {
    return Response.json({error:'지원하는 품종·지역과 유효한 수확 예정일을 선택해 주세요.'},{status:400});
  }
  const year=Number(harvestDate.slice(0,4)), today=kstToday(), currentYear=Number(today.slice(0,4));
  if(year<2000 || year>currentYear+5) return Response.json({error:'조회할 수확 연도를 확인해 주세요.'},{status:400});
  const key=process.env.RDA_SERVICE_KEY;
  if(!key) return Response.json({error:'농업기상 자동 조회가 설정되지 않았어요.'},{status:503});
  const serviceKey: string = key;
  const station=SIMPLE_STATIONS[region], controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),TOTAL_TIMEOUT_MS);
  const onAbort=()=>controller.abort();
  req.signal.addEventListener('abort',onAbort,{once:true});
  if (req.signal.aborted) controller.abort();
  let calls=0, failed=0;
  const data=new Map<number,SimpleDailyObs[]>();

  /** Limited worker pool and a single request-wide deadline, including both phases. */
  async function fetchMonths(tasks:MonthTask[]) {
    let next=0;
    const worker=async()=>{
      while(next<tasks.length) {
        const task=tasks[next++];
        if(controller.signal.aborted || calls>=MAX_CALLS) {failed++;continue;}
        calls++;
        try {
          const params=new URLSearchParams({serviceKey,Page_No:'1',Page_Size:'31',search_Year:String(task.year),search_Month:String(task.month).padStart(2,'0'),obsr_Spot_Cd:station.code});
          const response=await fetch(`${RDA_DAILY_URL}?${params}`,{signal:controller.signal,next:{revalidate:task.year < currentYear ? 7*86400 : 3*3600}});
          if(!response.ok) throw new Error('weather request failed');
          const parsed=parseDailyXml(await response.text(),station.code);
          if(parsed.total>31) throw new Error('weather pagination not verified');
          // 일최고기온 필드는 공식 응답과 연결 여부가 확인되지 않아 추측하지 않는다.
          const rows=parsed.rows.map(row=>({...row,max:null}));
          data.set(task.year,[...(data.get(task.year)??[]),...rows]);
        } catch {failed++;}
      }
    };
    await Promise.all(Array.from({length:Math.min(MAX_CONCURRENT,tasks.length)},worker));
  }

  try {
    const currentTasks:MonthTask[]=[];
    for(let month=4;month<=9;month++) {
      const start=`${year}-${String(month).padStart(2,'0')}-01`;
      if(start<today && start<harvestDate) currentTasks.push({year,month});
    }
    await fetchMonths(currentTasks);
    const currentRows=data.get(year)??[];
    const current=computeSimpleWeather(region,harvestDate,today,currentRows);
    // 이미 끝난 구간의 결측을 과거값으로 채우거나 수확일 이후 관측을 쓰지 않는다.
    // 후지 일최고 API 필드와 min4 정의는 미확인이므로 조회를 늘려도 수치를 만들지 않는다.
    const eligible=current.filter(v=>v.value===null && v.period[1]>=today && v.period[1]<harvestDate && (region==='geochang'||v.key==='rain9'));
    const requiredMonths=[...new Set(eligible.flatMap(v=>months[v.key]))];
    const lastHistoryYear=Math.min(year-1,currentYear-1);
    const historyYears=Array.from({length:HISTORY_YEARS},(_,i)=>lastHistoryYear-i).filter(y=>y>=2000).sort((a,b)=>a-b);
    const pastTasks=historyYears.flatMap(historyYear=>requiredMonths.map(month=>({year:historyYear,month})));
    await fetchMonths(pastTasks);
    if(failed>0 && data.size===0) return Response.json({error:'농업기상 관측자료를 불러오지 못했어요.'},{status:502});
    const history=historyYears.map(historyYear=>({year:historyYear,stationCode:station.code,rows:data.get(historyYear)??[]}));
    const variables=estimateWeatherFromHistory({region,harvestDate,today,currentRows,history,minimumYears:MINIMUM_YEARS,method:'arithmetic-mean'});
    const limitations=[
      '미래 구간의 추정값은 최근 5개 완결 연도의 동일 기간 관측 중 완전한 자료가 최소 3년 있을 때만 단순평균으로 계산합니다. 실제 날씨 예보가 아니며 예측 정확도는 검증되지 않았습니다.',
      ...(region==='geochang'?['거창 홍로 초기품질 모델의 독립 검증은 완료되지 않았습니다.']:['후지 일최고기온 API 필드와 4월 최저기온 산출 방식은 아직 확인되지 않았습니다.']),
      ...(failed?['일부 관측자료 조회가 실패하거나 시간 제한에 도달해 해당 자료를 제외했습니다.']:[]),
    ];
    return Response.json({region,cultivar,harvestDate,station:{code:station.code,name:station.name},source:'농촌진흥청 농업날씨365 일자료',asOf:today,variables,
      ready:variables.every(v=>v.value!==null),historyPolicy:{years:historyYears,minimumYears:MINIMUM_YEARS,method:'arithmetic-mean'},
      retrieval:{requests:calls,incompleteRequests:failed},limitations,
    },{headers:{'Cache-Control':'private, no-store'}});
  } finally {
    clearTimeout(timeout);
    req.signal.removeEventListener('abort',onAbort);
  }
}
