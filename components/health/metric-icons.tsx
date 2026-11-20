// 항목별 색·아이콘(헬스앱 방식). 당도는 피를 떠올리지 않도록 꿀색 각설탕으로 표시합니다.
import type {MetricId} from '@/lib/tracker';
export const METRIC_COLOR: Record<MetricId, string> = {firmness: '#F07014', brix: '#D99500', acidity: '#2FA84F', loss: '#0A7CF0'};
export const METRIC_LABEL: Record<MetricId, string> = {firmness: '경도', brix: '당도', acidity: '산도', loss: '무게 감소'};
export function MetricIcon({m, size = 18}: {m: MetricId; size?: number}) {
  const c = METRIC_COLOR[m];
  return <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden="true">
    {m === 'firmness' && <><path d="M3 13a7 7 0 0 1 14 0" fill="none" stroke={c} strokeWidth="2.4" strokeLinecap="round" /><path d="M10 13l3.5-4" stroke={c} strokeWidth="2.4" strokeLinecap="round" /></>}
    {m === 'brix' && <><rect x="3.5" y="4.5" width="13" height="12" rx="3" fill={c} /><path d="M3.5 9.5h13M10 4.5v12" stroke="#fff" strokeWidth="1.4" opacity=".75" /></>}
    {m === 'acidity' && <><ellipse cx="10" cy="10.5" rx="6.5" ry="5.5" fill={c} /><path d="M15 6l2-2" stroke={c} strokeWidth="2" strokeLinecap="round" /></>}
    {m === 'loss' && <><path d="M4 7h12l-2 9H6z" fill={c} /><circle cx="10" cy="5" r="2" fill="none" stroke={c} strokeWidth="2" /></>}
  </svg>;
}
