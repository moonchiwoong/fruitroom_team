import {listLots,createLot,errorResponse} from '@/lib/lot-server';
export async function GET(){try{return await listLots();}catch(e){return errorResponse(e);}}
export async function POST(req:Request){try{return await createLot(req);}catch(e){return errorResponse(e);}}
