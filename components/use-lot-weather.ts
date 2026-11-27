'use client';

import {useEffect, useState} from 'react';
import {weatherRefreshPeriod, type WeatherValues} from '@/lib/lot-predict';
import type {Lot} from '@/lib/lot-types';
import {todayKST} from '@/lib/tracker';

type CompleteWeather = {[K in keyof WeatherValues]: number};
const weatherKeys = ['chang_min4', 'chang_LC56', 'chang_LC78', 'chang_9rain'] as const;
const cached = new Map<string, CompleteWeather>();
const requests = new Map<string, Promise<CompleteWeather | null>>();

async function readWeather(url: string): Promise<CompleteWeather | null> {
  const response = await fetch(url);
  if (!response.ok) return null;
  const data: {variables?: {key: string; value: unknown}[]} = await response.json();
  if (!Array.isArray(data.variables)) return null;
  const values = Object.fromEntries(data.variables.map(variable => [variable.key, variable.value]));
  if (!weatherKeys.every(key => typeof values[key] === 'number' && Number.isFinite(values[key]))) return null;
  return values as CompleteWeather;
}

export function useLotWeather(lot: Lot, enabled = true) {
  const period = enabled ? weatherRefreshPeriod(lot) : null;
  const waiting = !!period && todayKST() < period.refreshDate;
  const url = period && !waiting ? `/api/weather/hongro?year=${period.year}&region=${period.region}` : null;
  const [result, setResult] = useState<{url: string; values: CompleteWeather} | null>(null);

  useEffect(() => {
    if (!url || cached.has(url)) return;
    let live = true;
    let request = requests.get(url);
    if (!request) {
      request = readWeather(url).catch(() => null).finally(() => requests.delete(url));
      requests.set(url, request);
    }
    void request.then(values => {
      if (!values) return;
      cached.set(url, values);
      if (live) setResult({url, values});
    });
    return () => { live = false; };
  }, [url]);

  return {period, waiting, values: url ? cached.get(url) ?? (result?.url === url ? result.values : null) : null};
}
