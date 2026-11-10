import "jsr:@supabase/functions-js/edge-runtime.d.ts";
const BASE="https://amiahhuapkqwbtcsmzal.supabase.co";
const ALLOWED=new Set(["https://alitoorabi-maker.github.io","https://chatgpt.com","https://amiahhuapkqwbtcsmzal.supabase.co","https://roselor-accounting.lovable.app"]);
function headers(req:Request){const o=req.headers.get("origin")||"";return {"content-type":"application/json; charset=utf-8","access-control-allow-origin":ALLOWED.has(o)?o:"https://chatgpt.com","access-control-allow-headers":"authorization, content-type, apikey","access-control-allow-methods":"POST, OPTIONS","cache-control":"no-store","vary":"Origin"}}
function out(req:Request,b:unknown,s=200){return new Response(JSON.stringify(b),{status:s,headers:headers(req)})}
Deno.serve(async(req:Request)=>{
 if(req.method==="OPTIONS")return new Response(null,{status:204,headers:headers(req)});
 if(req.method!=="POST")return out(req,{error:"method_not_allowed"},405);
 const service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),pub=Deno.env.get("SUPABASE_ANON_KEY")||Deno.env.get("SUPABASE_PUBLISHABLE_KEY");
 if(!service||!pub)return out(req,{error:"server_configuration_missing"},500);
 try{
  const b=await req.json().catch(()=>({})),username=String(b.username||"").trim().toLowerCase(),password=String(b.password||"");
  if(!/^[a-z0-9._-]{3,32}$/.test(username)||!password||password.length>256)return out(req,{error:"نام کاربری یا رمز عبور نادرست است."},401);
  const h={apikey:service,authorization:"Bearer "+service};
  let matches:any[]=[];
  for(let page=1;page<=10;page++){
   const ur=await fetch(BASE+"/auth/v1/admin/users?page="+page+"&per_page=1000",{headers:h});
   if(!ur.ok)return out(req,{error:"ورود در حال حاضر ممکن نیست. دوباره تلاش کنید."},503);
   const d=await ur.json().catch(()=>({})),users=Array.isArray(d.users)?d.users:[];
   matches.push(...users.filter((u:any)=>String(u.user_metadata?.username||"").trim().toLowerCase()===username||String(u.email||"").split("@")[0].trim().toLowerCase()===username));
   if(users.length<1000)break;
  }
  const unique=[...new Map(matches.map((u:any)=>[u.id,u])).values()];
  if(unique.length!==1)return out(req,{error:"نام کاربری یا رمز عبور نادرست است."},401);
  const user=unique[0];
  const ar=await fetch(BASE+"/rest/v1/accounting_user_greenhouse_access?select=user_id,role&user_id=eq."+encodeURIComponent(user.id),{headers:h});
  if(!ar.ok)return out(req,{error:"ورود در حال حاضر ممکن نیست. دوباره تلاش کنید."},503);
  const access=await ar.json().catch(()=>[]);
  if(!Array.isArray(access)||!access.some((x:any)=>["supervisor","greenhouse_supervisor"].includes(String(x.role||"").toLowerCase().replace(/[\\s-]+/g,"_"))))return out(req,{error:"نام کاربری یا رمز عبور نادرست است."},401);
  const tr=await fetch(BASE+"/auth/v1/token?grant_type=password",{method:"POST",headers:{apikey:pub,"content-type":"application/json"},body:JSON.stringify({email:user.email,password})});
  const token=await tr.json().catch(()=>({}));
  if(!tr.ok||!token.access_token||!token.refresh_token)return out(req,{error:"نام کاربری یا رمز عبور نادرست است."},401);
  return out(req,token);
 }catch{return out(req,{error:"ورود در حال حاضر ممکن نیست. دوباره تلاش کنید."},500)}
});