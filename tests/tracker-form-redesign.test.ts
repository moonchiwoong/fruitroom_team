import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyForm, effectiveInitialMeasuredOn, formFromLot, loadDraft, payloadFromForm, saveDraft, validateForm} from '../lib/tracker-form';
import {evaluatePrediction} from '../lib/ai/prediction';
import {todayKST} from '../lib/tracker';
import {demoLots} from '../lib/demo-lots';

test('measurement date follows storage start only after an explicit selection', () => {
  const f = {...emptyForm(), intake_date: '2025-10-01', initialSameStart: true};
  assert.equal(effectiveInitialMeasuredOn(f), '2025-10-01');
  assert.equal(payloadFromForm(f).initial_measured_on, '2025-10-01');
  assert.equal(payloadFromForm(f).details.initial_same_start, true);
  f.intake_date = '2025-10-02';
  assert.equal(payloadFromForm(f).initial_measured_on, '2025-10-02');
  f.initialSameStart = false;
  assert.equal(payloadFromForm(f).initial_measured_on, null);
  f.initial_measured_on = '2025-10-04';
  assert.equal(payloadFromForm(f).initial_measured_on, '2025-10-04');
});

test('each unmeasured metric is null even if a stale number is present; zero remains measured', () => {
  const f = {...emptyForm(), intake_date: '2025-10-01', firmness: '1', firmness_unit: 'kgf' as const, brix: '0', acidity: '0.5'};
  assert.equal(payloadFromForm(f).firmness, 9.80665);
  assert.equal(payloadFromForm(f).brix, 0);
  f.missing = {firmness: true, brix: false, acidity: true};
  const p = payloadFromForm(f);
  assert.equal(p.firmness, null);
  assert.equal(p.brix, 0);
  assert.equal(p.acidity, null);
  assert.deepEqual(p.details.not_measured, ['firmness', 'acidity']);
  assert.equal(validateForm(f, true).firmness, undefined);
});

test('partial Hongro measurements do not require all three quality values', () => {
  const f = {...emptyForm(), variety:'홍로', intake_date:'2025-10-01'};
  f.hongro.initial.firmness = '60';
  f.missing.acidity = true;
  const errors = validateForm(f, true);
  assert.equal(errors['hongro.initial.firmness'], undefined);
  assert.equal(errors['hongro.initial.brix'], undefined);
  assert.equal(errors['hongro.initial.acidity'], undefined);
  assert.equal(payloadFromForm(f).details.hongro?.initial.acidity, null);
});

test('old saved records without a measurement date are not silently linked to the start date', () => {
  const f = formFromLot({id:'one',name:'사과',variety:'후지',harvest_date:null,intake_date:'2025-10-01',storage_start_date:'2025-10-01',initial_measured_on:null,location:null,sensor_id:null,quantity:null,storage:'일반 저온',mcp:'미확인',packaging:null,firmness:null,brix:null,weight:null,acidity:null,notes:'',created_at:''});
  assert.equal(f.initialSameStart, false);
  assert.equal(effectiveInitialMeasuredOn(f), '');
  assert.equal(payloadFromForm(f).initial_measured_on, null);
});

test('drafts preserve new flags and older drafts gain safe defaults', () => {
  const store = new Map<string,string>();
  const previous = globalThis.window;
  Object.defineProperty(globalThis, 'window', {value: {localStorage: {setItem: (k:string,v:string) => store.set(k,v), getItem: (k:string) => store.get(k) ?? null}}, configurable:true});
  try {
    const form = {...emptyForm(), intake_date:'2025-10-01', initialSameStart:true, missing:{firmness:false,brix:false,acidity:true}};
    assert.equal(saveDraft('u','real','new',{form,baseSig:'',savedAt:'2025-10-01'}), true);
    assert.equal(loadDraft('u','real','new')?.form.initialSameStart, true);
    assert.equal(loadDraft('u','real','new')?.form.missing.acidity, true);
    const old = {...form, initialSameStart:undefined, missing:{firmness:false,brix:false}};
    store.set('appletrack:draft:v1:u:real:old', JSON.stringify({form:old,baseSig:'',savedAt:''}));
    assert.equal(loadDraft('u','real','old')?.form.initialSameStart, false);
    assert.equal(loadDraft('u','real','old')?.form.missing.acidity, false);
    assert.equal(loadDraft('u','real','old')?.form.mcpSelected, false);
    store.set('appletrack:draft:v1:u:real:treated', JSON.stringify({form:{...old, mcp:'처리', mcpSelected:undefined},baseSig:'',savedAt:''}));
    assert.equal(loadDraft('u','real','treated')?.form.mcpSelected, true);
  } finally { Object.defineProperty(globalThis,'window',{value:previous,configurable:true}); }
});

test('AI prediction honors the actual measurement date, missing flags and firmness units', () => {
  const form = {...emptyForm(), intake_date:'2025-10-01', mcp:'미처리' as const, mcpSelected:true, firmness:'1', firmness_unit:'kgf' as const};
  const input = {form, mode:'real' as const, observations:[], asOf:todayKST(), selectedDate:'2025-10-02', metric:'firmness' as const, future:'same' as const, useLatest:false};
  assert.equal(evaluatePrediction(input).status, 'unavailable');
  assert.equal(evaluatePrediction(input).initialMeasuredOn, null);
  form.initialSameStart = true;
  assert.equal(evaluatePrediction(input).conditions.initial, 9.80665);
  form.missing.firmness = true;
  assert.equal(evaluatePrediction(input).conditions.initial, null);
});

test('editing a legacy Hongro lot preserves measurements without inventing model provenance', () => {
  const lot={...demoLots()[0],variety:'홍로',details:{}};
  const form=formFromLot(lot);
  assert.equal(form.legacyHongro,true);
  const payload=payloadFromForm(form);
  assert.deepEqual([payload.firmness,payload.brix,payload.acidity,payload.weight],[lot.firmness,lot.brix,lot.acidity,lot.weight]);
  assert.equal(payload.details.hongro,undefined);
  form.hongro.initial.brix='15';
  const changed=payloadFromForm(form);
  assert.deepEqual([changed.firmness,changed.brix,changed.acidity,changed.weight],[lot.firmness,15,lot.acidity,lot.weight]);
  assert.equal(changed.details.hongro,undefined);
});
