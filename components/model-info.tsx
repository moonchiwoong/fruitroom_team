'use client';
import {useMemo, useState} from 'react';
import dynamic from 'next/dynamic';
import {AlertTriangle, BookOpen, CheckCircle2, ChevronDown, CircleHelp, Database} from 'lucide-react';
import {KindBadge} from '@/components/tracker-parts';
import {inputInfo, inputKeys, metricInfo, metricKeys, regionIds, regions, regionSummary, samples, storageFormula, storageIds, storageMetricInfo, type StorageMetric} from '@/lib/initial-quality';
import {MODEL_RANGE, MODEL_VERSION, modelLabel, STORAGE_MODEL_VERIFIED} from '@/lib/tracker';

const InitialQuality = dynamic(() => import('@/components/initial-quality'), {ssr: false, loading: () => <div className="loading-strip">계산 도구를 불러오는 중…</div>});

/** 저장 모델의 거동을 수식에서 직접 계산해 보여 줍니다(보정 없음). */
function storageChecks() {
  const a = 0.002288, b = 0.00002365, tMin = a / (2 * b), tBack = a / b;
  const f = (t: number) => -a * t + b * t * t;
  return {tMin, minChange: f(tMin), tBack, at300: f(MODEL_RANGE.displayDays)};
}

export default function ModelInfo() {
  const [openCalc, setOpenCalc] = useState(false);
  const chk = storageChecks();
  const dataCheck = useMemo(() => regionIds.map(r => {
    const s = samples(r), years = [...new Set(s.map(x => x.year))];
    const perYear = years.map(y => { const rows = s.filter(x => x.year === y); return {y, n: rows.length, uniq: new Set(rows.map(x => inputKeys.map(k => x.inputs[k]).join('|'))).size}; });
    return {r, n: s.length, years, allUnique: perYear.every(p => p.n === p.uniq), perYear};
  }), []);
  const metrics: StorageMetric[] = ['firmness', 'brix', 'acidity', 'loss'];

  return <div className="mi">
    <nav className="mi-toc" aria-label="모델 정보 목차">
      <a href="#mi-kinds">데이터 종류 표시</a><a href="#mi-storage">저장 중 변화 모델</a><a href="#mi-check">수식 점검 결과</a><a href="#mi-regression">기상 기반 회귀식(상세)</a>
    </nav>

    <section className="mi-card" id="mi-kinds">
      <h2>데이터 종류 표시</h2>
      <div className="mi-kinds">
        <div><KindBadge kind="실측" /><p>사용자가 직접 측정해 입력·저장한 값</p></div>
        <div><KindBadge kind="모델 계산" verified={false} /><p>수식으로 계산한 값. 검증 여부를 따로 표시합니다. 지금은 모두 <b>시연용 계산</b>입니다.</p></div>
        <div><KindBadge kind="예시" /><p>기능 확인용으로 넣은 가상의 값. 실제 측정이 아닙니다.</p></div>
        <div><KindBadge kind="미측정" /><p>측정하지 않은 항목. 0이나 예시값으로 바꾸지 않습니다.</p></div>
      </div>
      <p className="qt-help">그래프에서 실측은 점, 모델 계산은 선, 분석 기준일 이후 미래 가정은 점선입니다. 오차 범위는 검증한 경우에만 표시하며, 지금은 ‘오차 범위 미검증’입니다.</p>
    </section>

    <section className="mi-card" id="mi-storage">
      <h2>저장 중 품질 변화 모델 <KindBadge kind="모델 계산" verified={false} /></h2>
      <dl className="mi-dl">
        <div><dt>출처</dt><dd>첨부 자료 <code>data/storage-quality-model.xlsx</code> (변수·저장방법·모형 유형·초기값 변수·동적 예측 수식·비고) · 모델 식별: <code>{MODEL_VERSION}</code></dd></div>
        <div><dt>검증 상태</dt><dd><b>{STORAGE_MODEL_VERIFIED}</b> → 화면에서는 ‘시연용 계산’으로 표시 · 오차 범위 미검증</dd></div>
        <div><dt>적용 기간</dt><dd>원자료에 관측·검증 기간이 없어 <b>미확인</b>. 화면 표시 범위는 0~{MODEL_RANGE.displayDays}일이며 검증된 적용 범위가 아닙니다.</dd></div>
        <div><dt>품종 · 온습도 · 처리 조건</dt><dd className="mi-missing"><CircleHelp size={14} />원자료에 기재 없음 — 확인 필요 (1-MCP 농도·처리 시간, CA 산소·이산화탄소 농도 포함)</dd></div>
        <div><dt>경도 지표</dt><dd>원자료 표기 ‘경도 (N)’ — 힘(N). 측정 기기·탐침·껍질 제거 여부는 기재 없음.</dd></div>
        <div><dt>조건 → 모델</dt><dd>일반 저온 + 1-MCP 미처리 → {modelLabel.cold} · 일반 저온 + 1-MCP 처리 → {modelLabel.mcp} · CA + 미처리 → {modelLabel.ca} · <b>CA + 1-MCP 처리, 기타 저장, 1-MCP 미확인 → 모델 없음(수치 예측 제한)</b></dd></div>
        <div><dt>온습도</dt><dd>식에 온습도 입력이 없어, 센서 이력은 화면에 보여 주기만 하고 계산에 반영하지 않습니다(고정 조건 가정).</dd></div>
        <div><dt>조건 비교</dt><dd>저장 방식 간 효과를 검증한 모델이 없어 ‘체험용 비교’로만 제공합니다. 분석 기준일까지는 기록된 조건의 식, 이후는 선택한 조건의 식의 일별 변화를 이어 붙입니다.</dd></div>
        <div><dt>감모율</dt><dd>식의 감모율은 저장 시작 0%에서 출발하는 시연용 계산입니다. 실측 감모율은 같은 추적 표본의 초기·후속 중량이 있을 때만 계산합니다.</dd></div>
      </dl>
      <div className="qt-table-wrap"><table className="qt-table mi-formula">
        <thead><tr><th>지표</th>{storageIds.map(s => <th key={s}>{modelLabel[s]}</th>)}</tr></thead>
        <tbody>{metrics.map(m => <tr key={m}><td>{storageMetricInfo[m].label} <small>({storageMetricInfo[m].unit})</small></td>{storageIds.map(s => <td key={s}><code>{storageFormula[m][s]}</code></td>)}</tr>)}</tbody>
      </table></div>
      <p className="qt-help">t는 저장 경과일(저장 시작일 = 0), y₀·S₀는 계산 시작점의 값입니다. 초기 측정일이 저장 시작일보다 늦으면 그날부터 계산하고, 경도·당도·감모율은 차이를, 산도는 비율을 이어 붙입니다.</p>
    </section>

    <section className="mi-card" id="mi-check">
      <h2>수식 점검 결과</h2>
      <ul className="mi-checks">
        <li className="ok"><CheckCircle2 size={16} /><div><b>시작값 일치</b> — 모든 저장 방식·지표에서 0일차 계산값이 입력한 초기값과 같습니다(자동 테스트).</div></li>
        <li className="ok"><CheckCircle2 size={16} /><div><b>구간 경계 연속</b> — 당도 구간선형식은 100·200일 경계에서 끊기지 않습니다(차이 10⁻¹¹ 이하).</div></li>
        <li className="warn"><AlertTriangle size={16} /><div><b>1-MCP 경도식의 장기 증가</b> — <code>y₀ − 0.002288t + 0.00002365t²</code>는 {chk.tMin.toFixed(1)}일에 최저(초기값 {chk.minChange.toFixed(3)} N)가 된 뒤 다시 올라가 {chk.tBack.toFixed(1)}일에 초기값으로 돌아오고, {MODEL_RANGE.displayDays}일에는 초기값보다 {chk.at300.toFixed(2)} N 높습니다. 실제 자료 특성인지 관측 기간을 넘어선 외삽인지 <b>원자료 확인이 필요</b>합니다. 증가 구간을 자르거나 보정하지 않았습니다.</div></li>
        <li className="warn"><AlertTriangle size={16} /><div><b>1-MCP·CA 산도식의 100일 이후 정체</b> — <code>y₀·(1 − ⅓·min(t/100, 1))</code>는 식의 구조상 100일 이후 초기값의 2/3로 고정됩니다(원자료 비고: ‘호흡억제’). 관측 자료에서 확인된 특성인지는 미확인입니다.</div></li>
        <li className="warn"><AlertTriangle size={16} /><div><b>검증 자료 없음</b> — 별도 평가 자료와 오차가 없어 예측구간·신뢰구간을 표시하지 않습니다.</div></li>
      </ul>
    </section>

    <section className="mi-card" id="mi-regression">
      <h2>기상 기반 초기 품질 회귀식 <small>상세 정보 · 기본 사용 흐름에는 쓰지 않습니다</small></h2>
      <dl className="mi-dl">
        <div><dt>출처</dt><dd><code>data/initial-quality-regression.hwpx</code>(회귀계수·R²), 학습 자료 <code>data/initial-quality/*.csv</code></dd></div>
        <div><dt>입력</dt><dd>{inputKeys.map(k => `${inputInfo[k].label}(${inputInfo[k].code}, ${inputInfo[k].unit})`).join(' · ')} — 변수 이름은 자료의 약어로부터 붙인 것으로, 정의 확인이 필요합니다.</dd></div>
        <div><dt>출력</dt><dd>{metricKeys.map(m => `${metricInfo[m].label}(${metricInfo[m].unit})`).join(' · ')} — 경도는 <b>N/mm(강성)</b>으로, 실측 입력·저장 모델의 N(힘)과 다른 지표입니다.</dd></div>
        <div><dt>별도 평가 성능</dt><dd><b>평가 자료 없음 — 표시하지 않음.</b> 아래 수치는 모두 학습 자료에서 잰 적합도입니다.</dd></div>
      </dl>
      <div className="qt-table-wrap"><table className="qt-table">
        <thead><tr><th>산지</th>{metricKeys.map(m => <th key={m}>{metricInfo[m].label}</th>)}</tr></thead>
        <tbody>{regionIds.map(r => { const sm = regionSummary(r); return <tr key={r}><td>{regions[r].name}<small> · {sm.count}건</small></td>
          {metricKeys.map(m => <td key={m}><small>학습 R² {regions[r].equations[m].r2.toFixed(2)}</small><br />학습 RMSE: {sm.rmse[m].toFixed(metricInfo[m].digits)} {metricInfo[m].unit}</td>)}</tr>; })}</tbody>
      </table></div>
      <div className="mi-datacheck">
        <h3><Database size={16} />학습 자료 점검</h3>
        <ul>
          {dataCheck.map(d => <li key={d.r}><b>{regions[d.r].name}</b> {d.n}건 · {d.years[0]}~{d.years.at(-1)}년 · 연도당 {d.perYear[0].n}건 내외 — {d.allUnique ? '같은 연도 안에서도 과실마다 기상값 조합이 모두 다릅니다.' : '같은 연도 안에 같은 기상값을 공유하는 과실이 있습니다.'}</li>)}
        </ul>
        <p>한 산지·한 해의 월 강수량·적산온도는 보통 과원 단위로 공유되는 값입니다. 과실마다 기상값이 모두 다르다는 것은 과원별 관측값이거나 합성·보간된 자료일 수 있다는 뜻이므로, <b>실측·합성 여부 확인이 필요</b>합니다. 같은 기상값을 공유하는 과실이 있다면 서로 독립인 기상 조건으로 볼 수 없고, 같은 연도·과원·로트의 기록이 학습과 평가에 섞이지 않게 나눠야 합니다.</p>
      </div>
      <button className="btn btn-outline mi-open" aria-expanded={openCalc} onClick={() => setOpenCalc(v => !v)}><ChevronDown size={16} className={openCalc ? 'rot' : ''} />{openCalc ? '기상 기반 계산 닫기' : '기상 기반 계산 열기(상세 기능)'}</button>
      {openCalc && <div className="mi-calc"><InitialQuality /></div>}
    </section>
    <p className="qt-help"><BookOpen size={13} /> 근거 자료가 추가되면(관측·검증 기간, 평가 자료) 이 페이지와 계산 범위를 함께 갱신합니다.</p>
  </div>;
}
