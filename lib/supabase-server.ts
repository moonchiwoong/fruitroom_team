import {createServerClient,type CookieOptions} from '@supabase/ssr';
import {cookies} from 'next/headers';
export async function serverClient(){
 const jar=await cookies();
 const url=process.env.NEXT_PUBLIC_SUPABASE_URL;
 const key=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
 if(!url||!key)throw new Error('Supabase 환경변수가 설정되지 않았습니다.');
 return createServerClient(url,key,{cookies:{getAll(){return jar.getAll();},setAll(values:{name:string;value:string;options:CookieOptions}[]){try{values.forEach(({name,value,options})=>jar.set(name,value,options));}catch{/* Server component cannot write cookies. */}}}});
}
