import "jsr:@supabase/functions-js/edge-runtime.d.ts";
const BASE = "https://amiahhuapkqwbtcsmzal.supabase.co";
const ORIGINS = new Set(["https://chatgpt.com","https://amiahhuapkqwbtcsmzal.supabase.co","https://id-preview--0a745bcf-66b6-42f8-9bde-8de369d482ab.lovable.app","https://roselor-accounting.lovable.app","https://alitoorabi-maker.github.io"]);
function headers(req:Request){const o=req.headers.get("origin")||"";return {"content-type":"application/json; charset=utf-8","access-control-allow-origin":ORIGINS.has(o)?o:"https://chatgpt.com","access-control-allow-headers":"authorization, content-type, apikey","access-control-allow-methods":"POST, OPTIONS","cache-control":"no-store","vary":"Origin"};}
function out(req:Request,data:unknown,status=200){return new Response(JSON.stringify(data),{status,headers:headers(req)});}
function payload(t:string){try{const p=t.split(".")[1].replace(/-/g,"+").replace(/_/g,"/");return JSON.parse(atob(p.padEnd(Math.ceil(p.length/4)*4,"=")));}catch{return null;}}
Deno.serve(async(req:Request)=>{
 if(req.method==="OPTIONS") return new Response(null,{status:204,headers:headers(req)});
 if(req.method!=="POST") return out(req,{ok:false,error:"method_not_allowed"},405);
 const auth=req.headers.get("authorization")||"";
 if(!auth.startsWith("Bearer ")) return out(req,{ok:false,error:"authentication_required"},401);
 const claims=payload(auth.slice(7));
 if(!claims?.sub||claims.role!=="authenticated") return out(req,{ok:false,error:"authenticated_user_required"},403);
 const meta=claims.app_metadata||{};
 async function protectSelf(userId:string){if(userId===claims.sub)throw new Error("self_management_blocked");}
 if(!(meta.accounting_admin===true||meta.role==="admin")) return out(req,{ok:false,error:"admin_required"},403);
 const key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
 if(!key) return out(req,{ok:false,error:"server_configuration_missing"},500);
 const h={"apikey":key,"authorization":"Bearer "+key,"content-type":"application/json"};
 async function call(path:string,method="GET",body?:unknown,prefer?:string){
   const hh:Record<string,string>={...h};if(prefer)hh.Prefer=prefer;
   const r=await fetch(BASE+path,{method,headers:hh,...(body===undefined?{}:{body:JSON.stringify(body)})});
   const d=await r.json().catch(()=>null);
   if(!r.ok) throw new Error("supabase_request_failed:"+r.status+":"+String(d?.msg||d?.message||d?.error||""));
   return d;
 }
 function normalize(items:any){
   if(!Array.isArray(items)||items.length>2) throw new Error("choose_up_to_two_greenhouses");
   const seen=new Set<string>();
   for(const x of items){if(!x||!["azna","khorramabad"].includes(x.greenhouse)||!["viewer","accountant","supervisor"].includes(x.role)||seen.has(x.greenhouse))throw new Error("invalid_greenhouse_access");seen.add(x.greenhouse);}
   const defaults:any={home:{view:true,write:false},balances:{view:true,write:false},amb:{view:true,write:true},ledger:{view:true,write:false},bankRecon:{view:true,write:true},ship:{view:true,write:true},invoices:{view:true,write:true},cash:{view:true,write:true},vendors:{view:true,write:true},harvest:{view:true,write:false},buckets:{view:true,write:false}}; const supervisorDefaults:any={home:{view:false,write:false},balances:{view:false,write:false},amb:{view:false,write:false},ledger:{view:false,write:false},bankRecon:{view:false,write:false},ship:{view:true,write:false},invoices:{view:true,write:true},cash:{view:true,write:true},vendors:{view:false,write:false},harvest:{view:false,write:false},buckets:{view:false,write:false}}; return items.map((x:any)=>{const p=x.role==="supervisor"?supervisorDefaults:(x.section_permissions&&typeof x.section_permissions==="object"?x.section_permissions:defaults);const clean:any={};for(const k of Object.keys(defaults)){const v=p[k]||defaults[k];clean[k]={view:v.view===true,write:(x.role==="accountant"||x.role==="supervisor")&&v.write===true&&v.view===true};}return {greenhouse:x.greenhouse,role:x.role,section_permissions:clean};});
 }
 async function saveAccess(userId:string,items:any[]){
   const valid=normalize(items);
   await call("/rest/v1/accounting_user_greenhouse_access?user_id=eq."+encodeURIComponent(userId),"DELETE");
   if(valid.length) await call("/rest/v1/accounting_user_greenhouse_access","POST",valid.map((x:any)=>({user_id:userId,...x,updated_at:new Date().toISOString()})),"return=representation");
   const check=await call("/rest/v1/accounting_user_greenhouse_access?select=user_id,greenhouse,role,section_permissions&user_id=eq."+encodeURIComponent(userId)+"&order=greenhouse.asc");
   if(!Array.isArray(check)||check.length!==valid.length||valid.some((v:any)=>!check.some((x:any)=>{if(x.greenhouse!==v.greenhouse||x.role!==v.role)return false;for(const k of ["home","balances","amb","ledger","bankRecon","ship","invoices","cash","vendors","harvest"]){if((x.section_permissions?.[k]?.view===true)!==(v.section_permissions?.[k]?.view===true)||(x.section_permissions?.[k]?.write===true)!==(v.section_permissions?.[k]?.write===true))return false;}return true;}))) throw new Error("access_verification_failed");
   return check;
 }
 try {
   const b=await req.json();const action=b?.action;
   if(action==="list_users"){
     const authUsers=await call("/auth/v1/admin/users?page=1&per_page=200");
     const access=await call("/rest/v1/accounting_user_greenhouse_access?select=user_id,greenhouse,role,section_permissions&order=greenhouse.asc");
     const customerLinks=await call("/rest/v1/customer_portal_user_access?select=user_id,customer_id,username,is_active&order=customer_id.asc").catch(()=>[]);
     const driverLinks=await call("/rest/v1/driver_user_access?select=user_id,driver_name,username,greenhouse,is_active&order=driver_name.asc").catch(()=>[]);
     const customers=await call("/rest/v1/customers?select=id,name,customer_type,is_active&is_active=eq.true&order=name.asc").catch(()=>[]);
     const rows=Array.isArray(authUsers?.users)?authUsers.users:[];
     const acl=Array.isArray(access)?access:[];
     return out(req,{ok:true,verified:true,customers:Array.isArray(customers)?customers:[],users:rows.filter((u:any)=>u.id!==claims.sub).map((u:any)=>({id:u.id,email:u.email||"",display_name:u.user_metadata?.display_name||"",created_at:u.created_at||null,last_sign_in_at:u.last_sign_in_at||null,email_confirmed_at:u.email_confirmed_at||null,confirmed_at:u.confirmed_at||null,banned_until:u.banned_until||null,is_admin:u.app_metadata?.accounting_admin===true||u.app_metadata?.role==="admin",access:acl.filter((a:any)=>a.user_id===u.id).map((a:any)=>({greenhouse:a.greenhouse,role:a.role,section_permissions:a.section_permissions})),customer_access:(Array.isArray(customerLinks)?customerLinks:[]).find((a:any)=>a.user_id===u.id)||null,driver_access:(Array.isArray(driverLinks)?driverLinks:[]).find((a:any)=>a.user_id===u.id)||null,assigned:acl.some((a:any)=>a.user_id===u.id)||(Array.isArray(customerLinks)&&(customerLinks as any[]).some((a:any)=>a.user_id===u.id))||(Array.isArray(driverLinks)&&(driverLinks as any[]).some((a:any)=>a.user_id===u.id))}))});
   }
   if(action==="create_user"){
     const emailInput=typeof b.email==="string"?b.email.trim().toLowerCase():"";
     const password=typeof b.password==="string"?b.password:"";
     const accessItems=normalize(b.access);
     const supervisorName=typeof b.supervisor_name==="string"?b.supervisor_name.trim():typeof b.name==="string"?b.name.trim():"";
     const isSupervisor=b.user_type==="supervisor"||accessItems.some((x:any)=>x.role==="supervisor");
     const customerId=typeof b.customer_id==="string"?b.customer_id.trim():"";
     const userType=b.user_type==="driver"?"driver":customerId?"florist":isSupervisor?"supervisor":"internal";
     const driverName=typeof b.driver_name==="string"?b.driver_name.trim():"";
     const driverGreenhouse=b.driver_greenhouse==="azna"?"azna":b.driver_greenhouse==="khorramabad"?"khorramabad":"";
     let username=typeof b.username==="string"?b.username.trim().toLowerCase():"";
     const isAdmin=b.is_admin===true;
     if(password.length<8||password.length>128) return out(req,{ok:false,error:"password_min_8_max_128_required"},400);
     if(userType==="driver"){
       if(!/^[a-z0-9._-]{3,32}$/.test(username)||!driverName||!driverGreenhouse)return out(req,{ok:false,error:"driver_name_username_greenhouse_required"},400);
       const dup=await call("/rest/v1/driver_user_access?select=user_id&driver_name=eq."+encodeURIComponent(driverName)+"&limit=1").catch(()=>[]);
       const unameDup=await call("/rest/v1/driver_user_access?select=user_id&username=eq."+encodeURIComponent(username)+"&limit=1").catch(()=>[]);
       if((Array.isArray(dup)&&dup.length)||(Array.isArray(unameDup)&&unameDup.length))return out(req,{ok:false,error:"driver_name_or_username_exists"},409);
     } else if(customerId){
       if(!username&&emailInput){username=emailInput.split("@")[0].toLowerCase().replace(/[^a-z0-9._-]/g,"").slice(0,32)}
       if(!/^[a-z0-9._-]{3,32}$/.test(username)) return out(req,{ok:false,error:"valid_username_required_for_customer"},400);
       const duplicate=await call("/rest/v1/customer_portal_user_access?select=user_id&username=eq."+encodeURIComponent(username)+"&limit=1");
       if(Array.isArray(duplicate)&&duplicate.length) return out(req,{ok:false,error:"username_already_exists"},409);
     } else if(userType!=="supervisor"&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailInput)) {
       return out(req,{ok:false,error:"valid_email_required_for_internal_user"},400);
     }
     if(!accessItems.length&&!customerId&&userType!=="driver"&&!isAdmin) return out(req,{ok:false,error:"greenhouse_or_customer_access_required"},400);
     if(customerId){
       const cs=await call("/rest/v1/customers?select=id&id=eq."+encodeURIComponent(customerId)+"&limit=1");
       if(!Array.isArray(cs)||!cs.length)return out(req,{ok:false,error:"customer_not_found"},404);
     }
     const email=(customerId||userType==="driver"||userType==="supervisor")?username+"@roselor.invalid":emailInput;
     const created=await call("/auth/v1/admin/users","POST",{email,password,email_confirm:true,user_metadata:{accounting_app:"roselor",...(userType==="supervisor"?{display_name:supervisorName,username}:{}),...((customerId||userType==="driver")?{username}: {})},app_metadata:isAdmin?{accounting_admin:true,role:"admin"}:{accounting_admin:false,role:"user"}});
     const user=created?.user||created;
     if(!user?.id) return out(req,{ok:false,error:"auth_user_creation_unverified"},502);
     try {
       const saved=await saveAccess(String(user.id),accessItems);
       if(userType==="driver"){
         await call("/rest/v1/driver_user_access","POST",{user_id:String(user.id),driver_name:driverName,username,greenhouse:driverGreenhouse,is_active:true,updated_at:new Date().toISOString()},"return=representation");
         const driverCheck=await call("/rest/v1/driver_user_access?select=user_id,driver_name,username,greenhouse,is_active&user_id=eq."+encodeURIComponent(String(user.id))+"&limit=1");
         const drow=Array.isArray(driverCheck)?driverCheck[0]:null;
         if(!drow||drow.driver_name!==driverName||drow.username!==username||drow.greenhouse!==driverGreenhouse||drow.is_active!==true)throw new Error("driver_access_verification_failed");
       }
       if(customerId){
         await call("/rest/v1/customer_portal_user_access","POST",{user_id:String(user.id),customer_id:customerId,username,is_active:true,updated_at:new Date().toISOString()},"return=representation");
         const linkCheck=await call("/rest/v1/customer_portal_user_access?select=user_id,customer_id,username,is_active&user_id=eq."+encodeURIComponent(String(user.id))+"&limit=1");
         const savedLink=Array.isArray(linkCheck)?linkCheck[0]:null;
         if(!savedLink||savedLink.customer_id!==customerId||savedLink.username!==username||savedLink.is_active!==true) throw new Error("customer_access_verification_failed");
       }
       const reread=await call("/auth/v1/admin/users/"+encodeURIComponent(String(user.id)));
       const rereadUser=reread?.user||reread;
       if(rereadUser?.id!==user.id) throw new Error("auth_user_verification_failed");
       return out(req,{ok:true,verified:true,user:{id:user.id,email:user.email,username:(customerId||userType==="driver")?username:null,display_name:userType==="supervisor"?supervisorName:null,driver_access:userType==="driver"?{driver_name:driverName,greenhouse:driverGreenhouse}:null,created_at:user.created_at,access:saved}});
     } catch(e) {
       await call("/auth/v1/admin/users/"+encodeURIComponent(String(user.id)),"DELETE").catch(()=>null);
       throw e;
     }
   }
   if(action==="set_access"){
     const userId=typeof b.user_id==="string"?b.user_id.trim():"";
     if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId)) return out(req,{ok:false,error:"invalid_user_id"},400);
     const access=normalize(b.access);
     await protectSelf(userId);
     const authUser=await call("/auth/v1/admin/users/"+encodeURIComponent(userId));
     if((authUser?.user||authUser)?.id!==userId) return out(req,{ok:false,error:"auth_user_not_found"},404);
     const saved=await saveAccess(userId,access);
     if(access.length) await call("/rest/v1/customer_portal_user_access?user_id=eq."+encodeURIComponent(userId),"DELETE");
     const portalCheck=await call("/rest/v1/customer_portal_user_access?select=user_id&user_id=eq."+encodeURIComponent(userId));
     if(access.length&&Array.isArray(portalCheck)&&portalCheck.length) return out(req,{ok:false,error:"customer_access_removal_unverified"},409);
     return out(req,{ok:true,verified:true,user_id:userId,access:saved});
   }
   if(action==="set_customer_access"){
     const userId=typeof b.user_id==="string"?b.user_id.trim():"";
     const customerId=typeof b.customer_id==="string"?b.customer_id.trim():"";
     let username=typeof b.username==="string"?b.username.trim().toLowerCase():"";
     const active=b.active!==false;
     if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId)) return out(req,{ok:false,error:"invalid_user_id"},400);
     await protectSelf(userId);
     const ures=await call("/auth/v1/admin/users/"+encodeURIComponent(userId));
     const u=ures?.user||ures;
     if(u?.id!==userId) return out(req,{ok:false,error:"auth_user_not_found"},404);
     if(!customerId){
       await call("/rest/v1/customer_portal_user_access?user_id=eq."+encodeURIComponent(userId),"DELETE");
       const check=await call("/rest/v1/customer_portal_user_access?select=user_id&user_id=eq."+encodeURIComponent(userId));
       if(Array.isArray(check)&&check.length) return out(req,{ok:false,error:"customer_access_removal_unverified"},409);
       return out(req,{ok:true,verified:true,user_id:userId,customer_id:null});
     }
     if(!username){const priorLink=await call("/rest/v1/customer_portal_user_access?select=username&user_id=eq."+encodeURIComponent(userId)+"&limit=1");username=Array.isArray(priorLink)?String(priorLink[0]?.username||"").trim().toLowerCase():"";}
     if(!/^[a-z0-9._-]{3,32}$/.test(username)) return out(req,{ok:false,error:"valid_username_required_for_customer"},400);
     const duplicate=await call("/rest/v1/customer_portal_user_access?select=user_id&username=eq."+encodeURIComponent(username)+"&user_id=neq."+encodeURIComponent(userId)+"&limit=1");
     if(Array.isArray(duplicate)&&duplicate.length) return out(req,{ok:false,error:"username_already_exists"},409);
     const customers=await call("/rest/v1/customers?select=id,name&id=eq."+encodeURIComponent(customerId)+"&limit=1");
     if(!Array.isArray(customers)||!customers.length) return out(req,{ok:false,error:"customer_not_found"},404);
     await call("/rest/v1/accounting_user_greenhouse_access?user_id=eq."+encodeURIComponent(userId),"DELETE");
     await call("/rest/v1/customer_portal_user_access?user_id=eq."+encodeURIComponent(userId),"DELETE");
     await call("/rest/v1/customer_portal_user_access","POST",{user_id:userId,customer_id:customerId,username,is_active:active,updated_at:new Date().toISOString()},"return=representation");
     const check=await call("/rest/v1/customer_portal_user_access?select=user_id,customer_id,username,is_active&user_id=eq."+encodeURIComponent(userId)+"&limit=1");
     const saved=Array.isArray(check)?check[0]:null;
     if(!saved||saved.user_id!==userId||saved.customer_id!==customerId||saved.username!==username||saved.is_active!==active) return out(req,{ok:false,error:"customer_access_verification_failed"},409);
     return out(req,{ok:true,verified:true,user_id:userId,customer_id:customerId,username,customer_name:customers[0].name,is_active:active});
   }
   if(action==="set_role"){
     const userId=typeof b.user_id==="string"?b.user_id.trim():"";
     const role=b.role;
     if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId)||!["admin","standard"].includes(role)) return out(req,{ok:false,error:"invalid_user_role_input"},400);
     await protectSelf(userId);
     const before=await call("/auth/v1/admin/users/"+encodeURIComponent(userId));
     const u=before?.user||before;
     if(u?.id!==userId) return out(req,{ok:false,error:"auth_user_not_found"},404);
     const prior=u.app_metadata||{};
     const next={...prior,accounting_admin:role==="admin",role:role==="admin"?"admin":"user"};
     await call("/auth/v1/admin/users/"+encodeURIComponent(userId),"PUT",{app_metadata:next});
     const reread=await call("/auth/v1/admin/users/"+encodeURIComponent(userId));
     const verifiedUser=reread?.user||reread;
     const verifiedAdmin=verifiedUser?.app_metadata?.accounting_admin===true||verifiedUser?.app_metadata?.role==="admin";
     if(verifiedUser?.id!==userId||verifiedAdmin!==(role==="admin")) return out(req,{ok:false,error:"user_role_verification_failed"},409);
     return out(req,{ok:true,verified:true,user_id:userId,role:verifiedAdmin?"admin":"standard"});
   }
   if(action==="reset_password"){
     const userId=typeof b.user_id==="string"?b.user_id.trim():"";
     const password=typeof b.password==="string"?b.password:"";
     if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId)) return out(req,{ok:false,error:"invalid_user_id"},400);
     if(password.length<8||password.length>128) return out(req,{ok:false,error:"password_min_8_max_128_required"},400);
     await protectSelf(userId);
     const beforeRes=await call("/auth/v1/admin/users/"+encodeURIComponent(userId));
     const before=beforeRes?.user||beforeRes;
     if(before?.id!==userId||!before?.email) return out(req,{ok:false,error:"auth_user_not_found"},404);
     const changedRes=await call("/auth/v1/admin/users/"+encodeURIComponent(userId),"PUT",{password});
     const changed=changedRes?.user||changedRes;
     const rereadRes=await call("/auth/v1/admin/users/"+encodeURIComponent(userId));
     const reread=rereadRes?.user||rereadRes;
     if(reread?.id!==userId||!reread?.updated_at||(changed?.updated_at&&reread.updated_at!==changed.updated_at)) return out(req,{ok:false,error:"password_reset_verification_failed"},409);
     const pub=Deno.env.get("SUPABASE_ANON_KEY")||Deno.env.get("SUPABASE_PUBLISHABLE_KEY");
     if(!pub) return out(req,{ok:false,error:"password_saved_but_auth_verification_unavailable"},503);
     const verifyRes=await fetch(BASE+"/auth/v1/token?grant_type=password",{method:"POST",headers:{apikey:pub,"content-type":"application/json"},body:JSON.stringify({email:before.email,password})});
     const verified=await verifyRes.json().catch(()=>({}));
     if(!verifyRes.ok||verified?.user?.id!==userId||!verified?.access_token) return out(req,{ok:false,error:"password_saved_but_login_verification_failed"},409);
     await fetch(BASE+"/auth/v1/logout",{method:"POST",headers:{apikey:pub,authorization:"Bearer "+verified.access_token}}).catch(()=>null);
     return out(req,{ok:true,verified:true,password_verified:true,user_id:userId,updated_at:reread.updated_at});
   }
   if(action==="set_active"){
     const userId=typeof b.user_id==="string"?b.user_id.trim():"";
     const active=b.active;
     if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId)||typeof active!=="boolean") return out(req,{ok:false,error:"invalid_user_status_input"},400);
     await protectSelf(userId);
     const user=await call("/auth/v1/admin/users/"+encodeURIComponent(userId),"PUT",{ban_duration:active?"none":"876000h"});
     const verified=await call("/auth/v1/admin/users/"+encodeURIComponent(userId));
     const u=verified?.user||verified;
     const banned=!!u?.banned_until&&new Date(u.banned_until).getTime()>Date.now();
     if(banned===active) return out(req,{ok:false,error:"user_status_verification_failed"},409);
     return out(req,{ok:true,verified:true,user_id:userId,active:!banned});
   }
       if(action==="confirm_email"){
      const userId=typeof b.user_id==="string"?b.user_id.trim():"";
      if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId)) return out(req,{ok:false,error:"invalid_user_id"},400);
      await protectSelf(userId);
      const before=await call("/auth/v1/admin/users/"+encodeURIComponent(userId));
      const u=before?.user||before;
      if(u?.id!==userId) return out(req,{ok:false,error:"auth_user_not_found"},404);
      if(!u.email) return out(req,{ok:false,error:"user_email_missing"},400);
      if(u.email_confirmed_at||u.confirmed_at) return out(req,{ok:true,verified:true,user_id:userId,email:u.email,confirmed:true,already_confirmed:true});
      await call("/auth/v1/admin/users/"+encodeURIComponent(userId),"PUT",{email_confirm:true});
      const reread=await call("/auth/v1/admin/users/"+encodeURIComponent(userId));
      const verifiedUser=reread?.user||reread;
      const confirmed=!!(verifiedUser?.email_confirmed_at||verifiedUser?.confirmed_at);
      if(verifiedUser?.id!==userId||!confirmed) return out(req,{ok:false,error:"email_confirmation_verification_failed"},409);
      return out(req,{ok:true,verified:true,user_id:userId,email:verifiedUser.email,confirmed:true,already_confirmed:false});
    }
    return out(req,{ok:false,error:"unsupported_action"},400);
 } catch(e) {
   const msg=String((e as Error)?.message||e);
   return out(req,{ok:false,error:msg.includes("choose_one_or_two_greenhouses")||msg.includes("invalid_greenhouse_access")||msg.includes("valid_email")?"invalid_input":"operation_failed",detail:msg},500);
 }
});