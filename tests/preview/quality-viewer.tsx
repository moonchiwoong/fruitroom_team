import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import QualityAppleViewer from '../../components/quality-apple-viewer';
import {predictAllQuality} from '../../lib/quality-models';

function QualityViewerFixture() {
  const [day, setDay] = useState(0), [cultivar, setCultivar] = useState('hongro'), [temperature, setTemperature] = useState(0);
  const [reference, setReference] = useState(false), [failed, setFailed] = useState(false), [mobile, setMobile] = useState(false);
  const metrics = predictAllQuality({cultivar, storage:'cold', mcp:'untreated', temperature, day, allowFujiReference:reference, anchors:{firmness:{day:0,value:68},brix:{day:0,value:14},acidity:{day:0,value:0.18}}});
  return <main style={{maxWidth:mobile?360:900, margin:'20px auto', padding:12, fontFamily:'system-ui,sans-serif'}}>
    <h1 style={{fontSize:20}}>애플트랙 실제 3D 컴포넌트 검증</h1>
    <p style={{fontSize:12}}>테스트용 입력값입니다. 운영 데이터에 연결하지 않습니다.</p>
    <div style={{display:'flex',gap:12,flexWrap:'wrap',marginBottom:16,fontSize:14}}>
      <label>품종 <select value={cultivar} onChange={event=>setCultivar(event.target.value)}><option value="hongro">홍로</option><option value="fuji">후지</option></select></label>
      <label>온도 <select value={temperature} onChange={event=>setTemperature(Number(event.target.value))}><option value={0}>0℃</option><option value={2}>2℃ (미지원)</option><option value={4}>4℃</option></select></label>
      <label>저장일 <input aria-label="저장일" type="number" min={0} max={300} value={day} onChange={event=>setDay(Number(event.target.value))} style={{width:60}}/></label>
      <label><input type="checkbox" checked={reference} onChange={event=>setReference(event.target.checked)}/>후지 참고 추정</label>
      <label><input type="checkbox" checked={failed} onChange={event=>setFailed(event.target.checked)}/>GLB 로딩 실패</label>
      <label><input type="checkbox" checked={mobile} onChange={event=>setMobile(event.target.checked)}/>모바일 폭 360px</label>
    </div>
    <div style={{display:'flex',gap:10,marginBottom:12}}>{[0,60,120,121].map(value=><button key={value} onClick={()=>setDay(value)}>{value}일</button>)}</div>
    <QualityAppleViewer day={day} cultivar={cultivar} metrics={metrics} modelUrl={failed?'/models/missing-apple.glb':'/models/hongro-apple.glb'}/>
  </main>;
}

createRoot(document.getElementById('root')!).render(<QualityViewerFixture/>);
