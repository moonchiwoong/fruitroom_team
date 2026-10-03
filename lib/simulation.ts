export type Crop = 'apple' | 'pear' | 'peach';
export type Conditions = { crop: Crop; temperature: number; humidity: number; day: number; initial: number };
export const crops = {
  apple: {name:'사과', variety:'후지', english:'FUJI APPLE', rate:0.31, temp:'0 ± 1°C', source:'apple-fuji'},
  pear: {name:'배', variety:'동양배', english:'ASIAN PEAR', rate:0.45, temp:'0 ± 1°C', source:'asian-pear'},
  peach: {name:'복숭아', variety:'일반', english:'PEACH', rate:1.75, temp:'−1~0°C', source:'peach'},
};
export const defaults:Conditions = {crop:'apple',temperature:4,humidity:85,day:14,initial:95};
export function simulate(c:Conditions) {
  const heat = Math.pow(2.1,c.temperature/10);
  const moisture = 1 + Math.max(0,90-c.humidity)*0.025 + Math.max(0,c.humidity-95)*0.055;
  const chilling = c.crop==='peach' && c.temperature>=2 && c.temperature<=8 ? 1.35 : 1;
  const rate = crops[c.crop].rate*heat*moisture*chilling;
  const qualityAt = (day:number)=>Math.max(0,Math.min(100,c.initial-rate*day));
  const quality = qualityAt(c.day);
  const deadline = Math.max(0,Math.floor((c.initial-80)/rate));
  const shipDay = Math.max(0,deadline-2);
  const remaining = Math.max(0,shipDay-c.day);
  const firmness = Math.max(0,100-rate*c.day*1.13);
  const loss = Math.min(35,c.day*0.018*heat*(1+Math.max(0,95-c.humidity)*0.12));
  return {quality,rate,deadline,shipDay,remaining,firmness,loss,qualityAt};
}
export function validateConditions(value:unknown): Conditions {
  if(!value || typeof value!=='object') throw new Error('조건을 입력해 주세요.');
  const c=value as Conditions;
  if(!Object.hasOwn(crops,c.crop)) throw new Error('지원하지 않는 과일입니다.');
  for(const [key,min,max] of [['temperature',0,30],['humidity',40,100],['day',0,90],['initial',80,100]] as const) {
    if(typeof c[key]!=='number'||!Number.isFinite(c[key])||c[key]<min||c[key]>max) throw new Error(`${key}: ${min}~${max} 범위의 숫자가 필요합니다.`);
  }
  if(![85,95,100].includes(c.initial)) throw new Error('입고 품질은 85, 95, 100점 중에서 선택해 주세요.');
  return {...c};
}
