'use client';
// 출하 조건 비교(팀 제안 2026-11): ‘지금 출하 vs 30일·60일 더 저장’. ‘N일 뒤’는 오늘부터 N일 뒤이며, 그날의 실제 날짜와 저장 경과일을 함께 표시합니다.
// 사용자가 넣은 물량·가격·저장비로만 계산합니다(시세·판매 가능 물량은 예측하지 않음). 입력값은 저장하지 않습니다.
import {useState, type ChangeEvent} from 'react';
import type {Lot} from '@/lib/lot-types';
import type {lotPredictor} from '@/lib/lot-predict';
import {compareShipping, type ShipInput} from '@/lib/ship-compare';
import {addDays, fmtNum, metricMeta, todayKST} from '@/lib/tracker';
import {METRIC_LABEL} from '@/components/health/metric-icons';

const won = (n: number) => Math.round(n).toLocaleString('ko-KR');
const UNIT = (m: 'firmness' | 'brix') => m === 'firmness' ? 'N' : metricMeta[m].unit;

export default function ShipCompareCard({lot, p, maxDay}: {lot: Lot; p: ReturnType<typeof lotPredictor>; maxDay: number}) {
  const kg = lot.details?.quantity_unit === 'kg' && typeof lot.quantity === 'number' && lot.quantity > 0 ? String(lot.quantity) : '';
  // 지금 물량·가격은 두 기간이 함께 쓰고, 미래 물량·저장비·판매가는 30일·60일 따로 기억합니다(처음 여는 기간은 빈칸).
  const [now, setNow] = useState({nowKg: kg, nowPrice: ''});
  const [later, setLater] = useState<Record<30 | 60, {laterKg: string; cost: string; laterPrice: string}>>({30: {laterKg: '', cost: '', laterPrice: ''}, 60: {laterKg: '', cost: '', laterPrice: ''}});
  const [gap, setGap] = useState<30 | 60>(30);
  const v: ShipInput = {...now, ...later[gap]};
  const r = compareShipping(v, gap);
  const set = (k: keyof ShipInput) => (e: ChangeEvent<HTMLInputElement>) => { const val = e.target.value; if (k === 'nowKg' || k === 'nowPrice') setNow(x => ({...x, [k]: val})); else setLater(x => ({...x, [gap]: {...x[gap], [k]: val}})); };
  const today = p.todayDay !== null && p.todayDay >= 0 ? p.todayDay : null, laterDay = today === null ? null : today + gap;
  const laterDate = addDays(todayKST(), gap), md = (d: string) => `${+d.slice(5, 7)}월 ${+d.slice(8, 10)}일`;
  const when = `오늘부터 ${gap}일 후 · ${md(laterDate)}${laterDay !== null ? ` · 저장 ${laterDay}일째` : ''}`;
  // 참고: N일 뒤 품질(기존 식 계산값). 계산 범위를 넘으면 보여 주지 않습니다.
  const q = (m: 'firmness' | 'brix') => { if (laterDay === null || laterDay > maxDay) return '계산 범위 밖'; const x = p.at(m, laterDay); return x.ok ? `${fmtNum(x.value, metricMeta[m].digits)} ${UNIT(m)}` : '계산 없음'; };
  const field = (k: keyof ShipInput, label: string, unit: string, opt = false) =>
    <label className="sc-field"><span>{label}{opt && <em> (선택)</em>}</span><span className="sc-in"><input inputMode="decimal" value={v[k]} onChange={set(k)} placeholder={opt ? '넣으면 수입 차이' : ''} /><i>{unit}</i></span></label>;
  return <section id="ship-compare" className="sc dash-card dash-ship" aria-label="출하 조건 비교">
    <h2>출하 조건 비교 <small>지금 vs {gap}일 더 저장</small></h2>
    <div className="sc-gap" role="radiogroup" aria-label="더 저장할 기간">{([30, 60] as const).map(g => <button key={g} type="button" role="radio" aria-checked={gap === g} className={gap === g ? 'on' : ''} onClick={() => setGap(g)}>{g}일 더 저장</button>)}</div>
    <p className="sc-when">{when}</p>
    <p className="sc-ref">{laterDay === null ? `저장 시작일이 있어야 ${gap}일 뒤 품질을 함께 보여 줘요.` : `그날 계산값 · ${METRIC_LABEL.firmness} ${q('firmness')} · ${METRIC_LABEL.brix} ${q('brix')}`}</p>
    <div className="sc-fields">
      {field('nowKg', '지금 팔 수 있는 물량', 'kg')}{field('nowPrice', '지금 가격', '원/kg')}
      {field('laterKg', `${gap}일 뒤 팔 수 있는 물량`, 'kg')}{field('cost', `추가 저장비 (${gap}일 합계)`, '원')}
      {field('laterPrice', `${gap}일 뒤 예상 가격`, '원/kg', true)}
    </div>
    {!r.ok ? <p className="sc-msg" role="status">{r.reason ?? `입력해 주세요: ${r.missing.join(', ')}`}</p>
      : <dl className="sc-out" role="status">
        <div><dt>지금 출하 수입</dt><dd>{won(r.nowRevenue)} 원</dd></div>
        <div className="key"><dt>{gap}일 뒤 이 가격 이상이면 같거나 더 벌어요</dt><dd>{won(r.breakEven)} 원/kg</dd></div>
        {r.diff !== null && <div className={'key ' + (r.diff > 0 ? 'up' : r.diff < 0 ? 'down' : '')}><dt>{gap}일 더 저장했다 팔면</dt><dd>{r.diff === 0 ? '지금과 같음' : `${won(Math.abs(r.diff))}원 ${r.diff > 0 ? '유리' : '불리'}`}</dd></div>}
      </dl>}
    <p className="sc-note">넣은 값으로만 계산했어요(입력값 기준). 시세·판매 가능 물량은 예측하지 않고, 입력값은 저장하지 않아요. 기준 가격은 원 단위 올림.</p>
  </section>;
}
