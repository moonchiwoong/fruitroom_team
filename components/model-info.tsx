'use client';
import {useMemo, useState} from 'react';
import dynamic from 'next/dynamic';
import {AlertTriangle, BookOpen, CheckCircle2, ChevronDown, Database} from 'lucide-react';
import {KindBadge} from '@/components/tracker-parts';
import {inputInfo, inputKeys, metricInfo, metricKeys, regionIds, regions, regionSummary, samples} from '@/lib/initial-quality';
import {MODEL_RANGE, modelLabel, metricMeta, type MetricId} from '@/lib/tracker';
import {MODEL_REGISTRY, predictQuality, type PredictionResult} from '@/lib/quality-models';
import type {StorageId} from '@/lib/initial-quality';

const InitialQuality = dynamic(() => import('@/components/initial-quality'), {ssr: false, loading: () => <div className="loading-strip">계산 도구를 불러오는 중…</div>});

export type ModelInfoContext = {
  modelId: StorageId | null; metric: MetricId; cultivar: string; storage: string;
  temperature: string; mcp: string; initialSource: string;
  result: ReturnType<typeof predictQuality>; priorResult?: ReturnType<typeof predictQuality>; contextNote?: string; technicalNote?: string; weatherInitialInfo?: string; weatherUnitWarning?: boolean;
};

/** Use readable names on the summary; the exact file names remain in the technical section. */
function sourceNames(result: PredictionResult): string[] {
  return result.source.map(source => {
    if (source.includes('홍로_품질예측식_감모율포함')) return '제공된 홍로 감모율 식 자료';
    if (source.includes('거창_품질예측식')) return '제공된 거창 홍로 저장 품질 자료';
    if (source.includes('사과_품질예측_회귀식')) return '제공된 사과 저장 품질 회귀식 자료';
    if (source.includes('kjfp-25-7-779')) return '저온저장 온도처리가 홍로 사과의 저장 중 과실품질에 미치는 영향';
    if (source.includes('동일 추적 표본')) return '같은 표본의 중량 측정 기록';
    return '제공된 모델 근거 자료';
  }).filter((source, i, arr) => arr.indexOf(source) === i);
}

export default function ModelInfo({modelId, metric, context}: {modelId?: StorageId | null; metric?: MetricId; context?: ModelInfoContext}) {
  const currentResult = context;
  const [openCalc, setOpenCalc] = useState(false);
  const dataCheck = useMemo(() => regionIds.map(r => {
    const s = samples(r), years = [...new Set(s.map(x => x.year))];
    const perYear = years.map(y => { const rows = s.filter(x => x.year === y); return {y, n: rows.length, uniq: new Set(rows.map(x => inputKeys.map(k => x.inputs[k]).join('|'))).size}; });
    return {r, n: s.length, years, allUnique: perYear.every(p => p.n === p.uniq), perYear};
  }), []);
  const mcpFirmness = MODEL_REGISTRY.find(m => m.cultivar === 'fuji' && m.mcp === 'treated' && m.metric === 'firmness');
  function jumpTo(id: string) { const section = document.getElementById(id); let el: HTMLElement | null = section; while (el) { if (el instanceof HTMLDetailsElement) el.open = true; el = el.parentElement; } section?.scrollIntoView({block: 'start'}); }

  return <div className="mi mi-refresh">
    <section className="mi-intro" aria-labelledby="model-intro-title">
      <span className="section-label">계산 근거</span>
      <h2 id="model-intro-title">이 결과는 어떻게 계산했나요?</h2>
      <p>현재는 측정 기록과 계산 결과를 비교해 보는 체험 단계입니다. 예측 정확도와 오차 범위는 아직 독립적으로 검증되지 않았습니다. 출하 시점이나 안전한 보관 기간을 판정하지 않습니다.</p>
      {currentResult ? <div className="mi-current-model">
        <h3>현재 결과의 조건</h3>
        <p><b>{currentResult.cultivar} · {metricMeta[currentResult.metric].label}</b> · {currentResult.storage} · {currentResult.temperature ? `${currentResult.temperature}℃` : '저장 온도 미기록'} · 1-MCP {currentResult.mcp}</p>
        <p>{currentResult.result.ok ? (currentResult.result.kind === '실측' ? '같은 표본의 중량 기록으로 계산한 실측 감모율입니다.' : currentResult.result.kind === '참고 추정' ? '다른 품종의 식을 사용한 참고 추정이며, 이 품종에 대한 타당성은 확인되지 않았습니다.' : '입력값과 저장 모델로 만든 계산 결과입니다. 실측값과 다를 수 있습니다.') : `이 조건에서는 계산 결과를 제공하지 않습니다. ${currentResult.result.reason ?? '필요한 정보와 적용 조건을 확인해 주세요.'}`}</p>
        <p><b>사용한 초기 정보:</b> {currentResult.metric === 'loss' ? (currentResult.result.kind === '실측' ? '같은 표본의 초기·후속 중량 기록' : '저장 경과일 (초기 중량은 필요하지 않음)') : currentResult.initialSource}</p>
        {currentResult.contextNote && <p>{currentResult.contextNote}</p>}
        <p><b>검증 상태:</b> {currentResult.result.kind === '실측' ? '같은 표본의 측정 기록을 사용합니다. 출하·안전 판정은 아닙니다.' : currentResult.result.modelId ? '예측 정확도와 오차 범위의 독립 검증이 완료되지 않았습니다.' : '이 조건에 적용할 모델이나 입력값을 확인해 주세요.'}</p>
        <p><b>표시 기간:</b> {currentResult.result.range ? `저장 ${currentResult.result.range.min}~${currentResult.result.range.max}일` : '이 결과에 표시된 모델 기간 없음'} · 안전한 보관 기간을 뜻하지 않습니다.</p>
        <p><b>자료:</b> {[...new Set([...(currentResult.priorResult ? sourceNames(currentResult.priorResult) : []), ...sourceNames(currentResult.result)])].join(' · ') || '이 결과에 연결된 모델 자료 없음'}</p>
        {currentResult.weatherInitialInfo && <p><b>날씨 초기값:</b> {currentResult.weatherInitialInfo}</p>}
        {(currentResult.result.modelId === 'fuji-mcp-firmness' || currentResult.priorResult?.modelId === 'fuji-mcp-firmness') && <p><b>자료 확인 필요:</b> 후지 1-MCP 경도에 관한 제공 자료에서 수식과 설명이 서로 달라 어느 쪽이 맞는지 확인되지 않았습니다. 최신 자료의 명시된 수식을 사용하며, 결과의 신뢰도는 확인되지 않았습니다.</p>}
        {currentResult.result.modelId?.startsWith('hongro-') && currentResult.metric === 'brix' && <p><b>자료 확인 필요:</b> 홍로 당도는 제공된 수식에 따라 처음 값을 유지하지만, 자료의 설명에는 감소한다고 적혀 있어 서로 일치하지 않습니다. 실제 변화의 정확성은 확인되지 않았습니다.</p>}
        {currentResult.weatherUnitWarning && <p><b>단위 확인 필요:</b> 날씨로 추정한 초기 경도와 저장 모델의 경도는 단위가 다릅니다. 현재 변환 없이 연결하지만 서로 같은 값으로 쓸 수 있는지 확인되지 않아 결과 해석에 주의가 필요합니다.</p>}
      </div> : (modelId || metric) ? <p className="mi-current-model">선택한 결과: {modelId ? modelLabel[modelId] : '저장 조건 확인 필요'}{metric ? ` · ${metricMeta[metric].label}` : ''}. 품종과 상세 조건은 결과 화면에서 확인해 주세요.</p> : <p>결과 화면의 ‘이 결과의 계산 근거’를 누르면 선택한 결과의 조건을 함께 확인할 수 있습니다.</p>}
    </section>
    <nav className="mi-toc" aria-label="계산 근거 목차">
      <button type="button" onClick={() => jumpTo('mi-storage')}>반영 정보·적용 조건</button><button type="button" onClick={() => jumpTo('mi-formulas')}>수식과 연구 자료</button><button type="button" onClick={() => jumpTo('mi-regression')}>연구 중인 모델·참고 자료</button>
    </nav>

    <section className="mi-card" id="mi-storage">
      <h2>계산에 반영하는 정보</h2>
      <div className="mi-input-grid">
        <section><h3>반영합니다</h3><ul><li>품종, 저장 방식, 1-MCP 처리 여부와 저장 경과일</li><li>경도·당도·산도에 사용한 초기값과 측정일, 선택한 경우 최근 측정값</li><li>홍로 모델은 지정한 0℃ 또는 4℃ 조건을 구분합니다.</li><li>감모율 모델은 저장일수로 계산하며 초기 중량 입력이 필요하지 않습니다.</li><li>홍로의 날씨 기반 초기값을 선택하면 사용자가 선택한 날씨 정보도 초기값 추정에 쓰입니다.</li></ul></section>
        <section><h3>반영하지 않습니다</h3><ul><li>센서의 실제 온습도 이력과 산지별 저장 보정</li><li>사진·외관 관찰·포장 조건</li><li>처리 농도·시간과 CA 산소·이산화탄소 농도</li></ul></section>
      </div>
      <h2>적용 조건과 자료</h2>
      <p>후지는 일반 저온, 1-MCP 처리 후 저온, CA 저장에 제공된 식을 구분합니다. 후지 원자료에는 저장 온도가 명시되지 않아 선택한 온도에서의 적용 타당성은 확인되지 않았고, 온도 보정도 하지 않습니다.</p>
      <p>홍로는 일반 저온 0℃ 또는 4℃, 1-MCP 미처리 조건의 경도·당도·산도·감모율 식이 등록되어 있습니다. 다른 온도나 저장 조건은 보간하거나 자동으로 대체하지 않습니다. 모델이 등록된 것과 예측 정확도가 검증된 것은 별개입니다.</p>
      <p>홍로는 0~120일, 후지는 0~{MODEL_RANGE.displayDays}일을 표시합니다. 이는 안전한 보관 기간이나 예측 정확도가 검증된 기간이 아닙니다. 저장 방식 변경을 비교하는 기능도 실제 전환 효과가 검증된 모델은 아닙니다.</p>
      <p>근거는 제공된 품종별 회귀식 자료와 홍로 저장 연구 자료입니다. 홍로 논문은 저장 실측과 통계 비교를 다루며, 여기에 표시한 동적 수식이나 예측 정확도를 직접 검증한 자료로 확인되지 않았습니다. <a href="https://doi.org/10.11002/kjfp.2018.25.7.779" target="_blank" rel="noreferrer">‘저온저장 온도처리가 홍로 사과의 저장 중 과실품질에 미치는 영향’ 원문 보기</a></p>
      <p>후지 1-MCP 경도 자료에는 수식과 분류 설명 사이의 불일치가 있어 어떤 식이 맞는지 확인되지 않았습니다. 최신 자료의 명시 수식을 사용하며 정확도는 미확인입니다.</p>
    </section>

    <details className="mi-card mi-disclosure" id="mi-formulas">
      <summary>수식과 연구 자료</summary>
      {currentResult && <section className="mi-card" aria-label="선택한 결과의 기술 상세">
        <h2>선택한 결과의 수식과 자료</h2>
        <dl className="mi-dl">
          <div><dt>모델 식별자 · 버전</dt><dd>{currentResult.result.modelId || '없음'} · {currentResult.result.modelVersion || '없음'}</dd></div>
          <div><dt>수식 · 단위</dt><dd><code>{currentResult.result.formula || '자료 없음'}</code> · {currentResult.result.unit}</dd></div>
          <div><dt>출처</dt><dd>{currentResult.result.source.join(' · ') || '확인된 자료 없음'}</dd></div>
          <div><dt>표시 기간 · 검증 상태</dt><dd>{currentResult.result.range ? `${currentResult.result.range.min}~${currentResult.result.range.max}일` : '없음'} · {currentResult.result.validation}</dd></div>
          {!currentResult.result.ok && <div><dt>계산하지 못한 이유</dt><dd>{currentResult.result.reason}</dd></div>}
        </dl>
        {currentResult.priorResult && <div><h3>조건 변경 전 구간의 모델</h3><dl className="mi-dl">
          <div><dt>모델 식별자 · 버전</dt><dd>{currentResult.priorResult.modelId || '없음'} · {currentResult.priorResult.modelVersion || '없음'}</dd></div>
          <div><dt>수식 · 단위</dt><dd><code>{currentResult.priorResult.formula || '자료 없음'}</code> · {currentResult.priorResult.unit}</dd></div>
          <div><dt>출처</dt><dd>{currentResult.priorResult.source.join(' · ') || '확인된 자료 없음'}</dd></div>
          <div><dt>표시 기간 · 검증 상태</dt><dd>{currentResult.priorResult.range ? `${currentResult.priorResult.range.min}~${currentResult.priorResult.range.max}일` : '없음'} · {currentResult.priorResult.validation}</dd></div>
        </dl>{currentResult.priorResult.warnings.map((warning, index) => <p className="qt-help" key={index}>{warning}</p>)}</div>}
        {currentResult.result.warnings.map((warning, index) => <p className="qt-help" key={index}>{warning}</p>)}
        {currentResult.technicalNote && <p className="qt-help">{currentResult.technicalNote}</p>}
      </section>}
    <section className="mi-card" id="mi-technical-inputs">
      <h2>상세 계산 조건과 연결 방식</h2>
      <div className="mi-input-grid">
        <section><h3>사용하는 정보</h3><ul><li>초기 경도·당도·산도와 측정일</li><li>저장 시작일과 저장 경과일</li><li>품종·저장 방식·저장 온도·1-MCP 처리 여부에 따른 모델 선택</li><li>분석 기준일 이후 선택한 조건</li><li>선택한 경우 최근 측정값을 계산 시작점으로 사용</li></ul></section>
        <section><h3>현재 계산에 반영하지 않는 정보</h3><ul><li>산지별 계수(자료 미확보)</li><li>센서의 실제 온습도 이력</li><li>사진·외관 관찰·포장 조건</li><li>처리 농도·시간, CA 산소·이산화탄소 농도</li></ul></section>
      </div>
      <h2>적용 조건과 검증 상태 <KindBadge kind="모델 계산" verified={false} /></h2>
      <dl className="mi-dl">
        <div><dt>같은 모델 사용</dt><dd>숫자·그래프·CSV·3D 표시·이 계산 근거는 <code>lib/quality-models.ts</code>의 같은 모델 정의와 계산 결과를 사용합니다. 모델이 없거나 입력이 부족하면 값은 <code>null</code>이며 0으로 대체하지 않습니다.</dd></div>
        <div><dt>후지</dt><dd>일반 저온, 1-MCP 처리 후 저온, CA 저장의 제공 엑셀 모델을 구분합니다. 원자료에 없는 온도별 보정·CA+1-MCP 복합 효과는 적용하지 않습니다. 정확한 연구 조건과 독립 예측 정확도는 미확인입니다.</dd></div>
        <div><dt>홍로</dt><dd>일반 저온 0℃ 또는 4℃·1-MCP 미처리의 경도·당도·산도·감모율 식을 제공합니다. CA·1-MCP 처리·다른 온도는 <b>적용 모델 없음</b>입니다. 0℃와 4℃ 사이를 보간하지 않습니다.</dd></div>
        <div><dt>적용 기간</dt><dd>홍로는 저장 시작 후 <b>0~120일</b>의 근사 모델 표시 범위이며 121일부터 계산하지 않습니다. 후지의 표시 범위는 0~{MODEL_RANGE.displayDays}일입니다. 모두 상품성·안전한 보관 기간을 보장하지 않으며, 독립 검증된 기간과 구분합니다.</dd></div>
        <div><dt>측정일과 시간축</dt><dd>수확일·저장 시작일·초기 측정일·최근 측정일을 구분합니다. 저장 시작 후 t₀일의 측정값으로 연결할 때 변화량 모델은 g(t)−g(t₀)를 더하고 비율 모델은 g(t)/g(t₀)를 곱합니다. 최근 측정일에 저장일수를 0으로 되돌리지 않습니다.</dd></div>
        <div><dt>산지·센서</dt><dd>산지 입력만으로 예측값이 달라지지 않습니다. 센서 온습도 이력, 처리 농도·시간, CA 기체 농도는 검증된 보정식이 없어 계산에 반영하지 않습니다.</dd></div>
        <div><dt>조건 변경 시나리오</dt><dd>저장 방식 전환의 효과가 검증된 모델은 없습니다. 분석 기준일 전후 다른 식을 이어 붙이는 기능은 ‘조건 변경 시나리오’이며 실제 전환 처리의 효과를 예측·보장하지 않습니다.</dd></div>
        <div><dt>실측 감모율</dt><dd><code>L = 100 × (초기 중량 − 후속 중량) / 초기 중량</code>. 동일 추적 표본 ID, 초기·후속 중량과 측정 시점이 확인된 경우에만 제공합니다. 측정이 없는 날짜의 값을 만들어 내지 않습니다.</dd></div>
        <div><dt>모델 예측 감모율</dt><dd>저장일수로 계산하므로 초기 중량 입력은 필요하지 않습니다. 후지 일반 저온식의 결과 1.621은 <b>1.621%</b>입니다. 100을 다시 곱하지 않습니다.</dd></div>
        <div><dt>홍로 감모율</dt><dd>홍로 일반 저온 0℃·4℃, 1-MCP 미처리 조건에는 감모율 식이 등록되어 있습니다. 관측 근거와 독립 예측 정확도는 확인되지 않았습니다. 그 밖의 조건에는 현재 적용할 식이 없으며, 후지 식을 자동으로 대신 사용하지 않습니다.</dd></div>
        <div><dt>설명용 외관 시각화</dt><dd>감모율이 있을 때 별도 외관 설정으로 수축·주름을 연속 변형합니다. 감모율을 길이 감소율로 그대로 쓰지 않으며 실제 외관 자료로 보정하지 않았습니다. 감모율이 없으면 기본 형태와 자료 부족 안내를 표시합니다. 경도·당도·산도로 색상·부패를 결정하지 않습니다.</dd></div>
      </dl>
    </section>

    <section className="mi-card" id="mi-formula-table">
      <h2>품종·저장 조건별 수식과 출처</h2>
      <p>아래 내용은 계산 엔진의 모델 목록에서 직접 읽습니다. 홍로식은 제공 엑셀의 근사 모델입니다. 관련 논문 kjfp-25-7-779.pdf(2018, DOI: 10.11002/kjfp.2018.25.7.779)는 0℃·4℃ 저장 실측과 통계 비교를 다루며 아래 동적 수식이나 예측 정확도 검증 수치를 직접 제시하지 않습니다.</p>
      {(['fuji', 'hongro'] as const).map(cultivar => <section key={cultivar}>
        <h3>{cultivar === 'fuji' ? '후지' : '홍로'} · 모델 계산</h3>
        <div className="qt-table-wrap mi-table-wrap"><table className="qt-table mi-formula">
          <thead><tr><th>조건·항목</th><th>수식·단위</th><th>출처·버전</th><th>적용 기간·검증 상태</th></tr></thead>
          <tbody>{MODEL_REGISTRY.filter(model => model.cultivar === cultivar).map(model => <tr key={model.id}>
            <td data-label="조건·항목"><b>{model.label}</b><br />{model.storage === 'ca' ? 'CA 저장' : '일반 저온 저장'} · {model.temperature === null ? '온도별 조건 미확인' : `${model.temperature}℃`} · 1-MCP {model.mcp === 'treated' ? '처리' : '미처리'}<br />{metricMeta[model.metric].label}</td>
            <td data-label="수식·단위"><code>{model.formula}</code><br />단위: {model.unit}<br /><small>{model.connection === 'ratio' ? '비율 변화로 연결' : '변화량으로 연결'}</small></td>
            <td data-label="출처·버전">{model.source.map(source => <div key={source}>{source}</div>)}<small>{model.id}<br />{model.version}</small></td>
            <td data-label="적용 기간·검증 상태">{model.range.min}~{model.range.max}일<br /><small>{model.validation}</small>{model.warnings.map((warning, index) => <p className="qt-help" key={index}>{warning}</p>)}</td>
          </tr>)}</tbody>
        </table></div>
      </section>)}
      <p className="qt-help">t는 저장 시작일부터의 경과일입니다. F₀·S₀·A₀는 저장 시작 시 값이며, 늦게 측정한 값은 원래 시간축의 변화량 또는 비율로 연결합니다. A₀=0.18은 0.18%입니다. 홍로 당도는 S(t)=S₀로 고정하며 ‘완만한 감소’ 비고로 임의 계수를 만들지 않습니다.</p>
      <p className="qt-help">홍로 일반 저온 0℃·4℃, 1-MCP 미처리 조건에는 감모율 식이 등록되어 있습니다. 관측 근거와 독립 예측 정확도는 확인되지 않았습니다. 후지식 <code>L_F(t)=0.007807t+0.0000475t²</code>은 현재 홍로 결과에 자동 적용하지 않습니다.</p>
    </section>

    <section className="mi-card" id="mi-units">
      <h2>단위와 측정법</h2>
      <dl className="mi-dl">
        <div><dt>경도 N</dt><dd>저장 모델의 경도는 힘(N)입니다. 산지별 참고 기상 회귀식의 N/mm(강성), N/mm²(압력)은 기본 예측에 연결하지 않습니다. 다만 홍로 날씨 기반 초기 경도는 N/mm 수치를 변환 없이 저장 모델의 N 입력으로 연결하며 단위의 동일성은 확인되지 않았습니다.</dd></div>
        <div><dt>N ↔ kgf</dt><dd>1 kgf = 9.80665 N. 입력한 원측정값·단위와 화면의 환산값을 구분합니다.</dd></div>
        <div><dt>압력 환산</dt><dd>탐침의 유효 접촉 면적과 해당 측정법의 환산 타당성이 모두 확인되어야 합니다. 탐침 직경만 입력한 경우에는 kgf/cm² 등의 환산 수치를 제공하지 않습니다.</dd></div>
        <div><dt>비교 전 확인</dt><dd>기기, 탐침, 껍질 제거 여부, 측정 위치·과실 온도 등이 다르면 단순 비교에 제한이 있습니다. 기록되지 않은 조건은 미확인으로 남깁니다.</dd></div>
      </dl>
    </section>
    <section className="mi-card" id="mi-kinds">
      <h2>데이터 종류 표시</h2>
      <div className="mi-kinds">
        <div><KindBadge kind="실측" /><p>사용자가 직접 측정해 입력·저장한 값</p></div>
        <div><KindBadge kind="모델 계산" verified={false} /><p>수식으로 계산한 값. 검증 여부를 따로 표시합니다. 지금은 모두 <b>시연용 계산</b>입니다.</p></div>
        <div><KindBadge kind="예시" /><p>기능 확인용으로 넣은 가상의 값. 실제 측정이 아닙니다.</p></div>
        <div><span className="kind k-example">참고 추정</span><p>다른 품종의 식을 명시적으로 빌린 계산. 해당 품종에 대해 검증되지 않았습니다.</p></div>
        <div><KindBadge kind="미측정" /><p>측정하지 않은 항목 또는 자료 부족. 0이나 예시값으로 바꾸지 않습니다.</p></div>
      </div>
      <p className="qt-help">그래프에서 실측은 점, 모델 계산은 선, 분석 기준일 이후 미래 가정은 점선입니다. 오차 범위는 검증한 경우에만 표시하며, 지금은 ‘오차 범위 미검증’입니다.</p>
    </section>

    <details className="mi-card mi-disclosure" id="mi-check">
      <summary>수식 점검과 미확인 사항</summary>
      <p className="qt-help">수학적 거동에 대한 점검이며 실측 자료를 이용한 정확도 검증과 다릅니다.</p>
      <ul className="mi-checks">
        <li className="ok"><CheckCircle2 size={16} /><div><b>시작값 일치</b> — 적용 모델과 필요한 초기값이 있는 조건에서 0일차 경도·당도·산도는 초기값, 모델 감모율은 0%입니다. 모델이 없는 항목은 0이 아닙니다.</div></li>
        <li className="ok"><CheckCircle2 size={16} /><div><b>구간 경계 연속</b> — 홍로 경도·산도는 60일 경계에서 연속이고, 후지 당도 구간선형식은 100·200일 경계에서 이어집니다.</div></li>
        <li className="warn"><AlertTriangle size={16} /><div><b>후지 1-MCP 경도식의 출처 변경</b> — 이전 소스는 <code>y₀ − 0.002288t + 0.00002365t²</code>를 표시했습니다. 최신 제공 파일 사과_품질예측_회귀식.xlsx의 Sheet1!E6은 초기값 유지식이고 C6 모형 유형은 이차 회귀로 남아 있어 문서 내부 표기가 불일치합니다. 이전 번들 엑셀 E6은 이차식입니다. 최신 명시 수식을 기준으로 버전을 분리했으며 활성식은 <code>{mcpFirmness?.formula ?? '출처 확인 중'}</code>입니다. {mcpFirmness?.warnings.map((warning, index) => <p key={index}>{warning}</p>)} 출처 차이를 보정계수로 섞지 않습니다.</div></li>
        <li className="warn"><AlertTriangle size={16} /><div><b>1-MCP·CA 산도식의 100일 이후 정체</b> — <code>y₀·(1 − ⅓·min(t/100, 1))</code>는 식의 구조상 100일 이후 초기값의 2/3로 고정됩니다(원자료 비고: ‘호흡억제’). 관측 자료에서 확인된 특성인지는 미확인입니다.</div></li>
        <li className="warn"><AlertTriangle size={16} /><div><b>검증 자료 없음</b> — 별도 평가 자료와 오차가 없어 예측구간·신뢰구간을 표시하지 않습니다.</div></li>
      </ul>
    </details>

    </details>

    <section className="mi-card" id="mi-regression">
      <h2>연구 중인 모델·참고 자료</h2>
      <p><b>이 영역의 산지별 기상 회귀식은 현재 기본 품질 예측 결과에 사용하지 않습니다.</b> 별도로 제공하는 참고 계산입니다. 홍로의 날씨 기반 초기값 추정은 이 식과 다른 기능이며, 홍로 입력에서 직접 선택한 경우에만 결과의 초기값으로 사용됩니다.</p>
      <details className="mi-disclosure">
      <summary>산지별 기상 회귀식과 참고 계산 펼치기</summary>
      <p className="qt-help">이 영역의 학습 적합도는 학습 자료에 대한 값이며 별도 평가 자료의 예측 성능이나 서비스 전체의 정확도가 아닙니다.</p>
      <dl className="mi-dl">
        <div><dt>출처</dt><dd><code>data/initial-quality-regression.hwpx</code>(회귀계수·R²), 학습 자료 <code>data/initial-quality/*.csv</code></dd></div>
        <div><dt>입력</dt><dd>{inputKeys.map(k => `${inputInfo[k].label}(${inputInfo[k].code}, ${inputInfo[k].unit})`).join(' · ')} — 변수 이름은 자료의 약어로부터 붙인 것으로, 정의 확인이 필요합니다.</dd></div>
        <div><dt>출력</dt><dd>{metricKeys.map(m => `${metricInfo[m].label}(${metricInfo[m].unit})`).join(' · ')} — 경도는 <b>N/mm(강성)</b>으로, 실측 입력·저장 모델의 N(힘)과 다른 지표입니다.</dd></div>
        <div><dt>별도 평가 성능</dt><dd><b>평가 자료 없음 — 표시하지 않음.</b> 아래 수치는 모두 학습 자료에서 잰 적합도입니다.</dd></div>
      </dl>
      <div className="qt-table-wrap mi-table-wrap"><table className="qt-table mi-regression-table">
        <thead><tr><th>산지</th>{metricKeys.map(m => <th key={m}>{metricInfo[m].label}</th>)}</tr></thead>
        <tbody>{regionIds.map(r => { const sm = regionSummary(r); return <tr key={r}><td data-label="산지">{regions[r].name}<small> · {sm.count}건</small></td>
          {metricKeys.map(m => <td key={m} data-label={metricInfo[m].label}><small>학습 R² {regions[r].equations[m].r2.toFixed(2)}</small><br />학습 RMSE: {sm.rmse[m].toFixed(metricInfo[m].digits)} {metricInfo[m].unit}</td>)}</tr>; })}</tbody>
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
      </details>
    </section>
    <p className="qt-help"><BookOpen size={13} /> 근거 자료가 추가되면(관측·검증 기간, 평가 자료) 이 페이지와 계산 범위를 함께 갱신합니다.</p>
  </div>;
}
