import {productionData,budgetStatus} from '@/lib/ai/data';
import {providerSettings} from '@/lib/ai/provider';
import {json,fail} from '@/lib/ai/http';
export const runtime='nodejs';
export async function GET(){try{
  await productionData.authenticate();
  const settings=providerSettings();
  if(!settings.available)return json({...settings,retention:'session-only'});
  const budget=await budgetStatus();return json({...budget,retention:'session-only'});
}catch(e){return fail(e);}}
