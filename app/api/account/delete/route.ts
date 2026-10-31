import {deleteMyAccount,errorResponse} from '@/lib/lot-server';
export async function POST(req:Request){try{return await deleteMyAccount(req);}catch(e){return errorResponse(e);}}
