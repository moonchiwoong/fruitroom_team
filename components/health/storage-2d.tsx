'use client';
// 요약 화면의 ‘내 저장고’: 보관 중인 사과(로트) 하나 = 칸 하나. 위치는 입력값이 아니라 순서대로 채웁니다.
// 보여 주는 값은 모두 요약 화면이 이미 가진 값(이름·품종·저장 일수·상태·저장 온도·물량)입니다. 새로 계산하거나 지어내는 값은 없습니다.
export type StorageItem = {id: string; name: string; variety: string; hongro: boolean; day: number | null; tone: 'ok' | 'warn' | 'muted'; status: string; temp: number | null; qty: number | null; unit: string | null};

export default function Storage2D({items, onOpen}: {items: StorageItem[]; onOpen: (id: string) => void}) {
  if (!items.length) return null;
  return <section className="st2" aria-label="내 저장고">
    <div className="st2-h"><h2>내 저장고</h2><small>{items.length}개 보관 중 · 칸을 누르면 상세</small></div>
    <ul className="st2-grid">{items.map(x => <li key={x.id}>
      <button type="button" className={'st2-p ' + (x.hongro ? 'h' : 'f')} onClick={() => onOpen(x.id)}>
        <b>{x.name}</b>
        <span className="st2-m">{[x.variety, x.day !== null && x.day >= 0 ? `${x.day}일째` : null, x.qty ? `${x.qty}${x.unit ?? ''}` : null, x.temp !== null ? `${x.temp}℃` : null].filter(Boolean).join(' · ')}</span>
        <span className={'st2-s ' + x.tone}>{x.status}</span>
      </button></li>)}</ul>
  </section>;
}
