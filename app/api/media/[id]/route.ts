import {photoResponse,errorResponse} from '@/lib/lot-server';
export async function GET(_:Request,ctx:{params:Promise<{id:string}>}){try{return await photoResponse((await ctx.params).id);}catch(e){return errorResponse(e);}}
