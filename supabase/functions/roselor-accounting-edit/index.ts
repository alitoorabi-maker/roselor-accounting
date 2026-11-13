import "jsr:@supabase/functions-js/edge-runtime.d.ts";
const BASE="https://amiahhuapkqwbtcsmzal.supabase.co";
const ORIGINS=new Set(["https://chatgpt.com","https://amiahhuapkqwbtcsmzal.supabase.co","https://alitoorabi-maker.github.io","https://roselor-accounting.lovable.app"]);
function headers(req:Request){const o=req.headers.get("origin")||"";return {"content-type":"application/json; charset=utf-8","access-control-allow-origin":ORIGINS.has(o)?o:"https://chatgpt.com","access-control-allow-headers":"authorization, content-type, apikey","access-control-allow-methods":"POST, OPTIONS","vary":"Origin","cache-control":"no-store"}}
function response(req:Request,data:unknown,status=200){return new Response(JSON.stringify(data),{status,headers:headers(req)})}
function payload(t:string){try{let p=t.split(".")[1].replace(/-/g,"+").replace(/_/g,"/");return JSON.parse(atob(p.padEnd(Math.ceil(p.length/4)*4,"=")))}catch{return null}}
Deno.serve(async(req:Request)=>{
 if(req.method==="OPTIONS")return new Response(null,{status:204,headers:headers(req)});
 if(req.method!=="POST")return response(req,{ok:false,error:"method_not_allowed"},405);
 const auth=req.headers.get("authorization")||"";if(!auth.startsWith("Bearer "))return response(req,{ok:false,error:"authentication_required"},401);
 const claims=payload(auth.slice(7));if(!claims?.sub||claims.role!=="authenticated")return response(req,{ok:false,error:"authenticated_user_required"},403);
 let body:any;try{body=await req.json()}catch{return response(req,{ok:false,error:"invalid_json"},400)}
 const admin=claims.app_metadata?.accounting_admin===true||claims.app_metadata?.role==="admin";
 const key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");if(!key)return response(req,{ok:false,error:"server_configuration_missing"},500);
 async function db(method:string,path:string,data?:unknown){const r=await fetch(BASE+"/rest/v1/"+path,{method,headers:{apikey:key,authorization:"Bearer "+key,"content-type":"application/json",Prefer:"return=representation"},...(data===undefined?{}:{body:JSON.stringify(data)})});const j=await r.json().catch(()=>null);if(!r.ok)throw Error("database_operation_failed:"+r.status);return j}
 async function scope(gh:string){if(admin)return true;const a=await db("GET","accounting_user_greenhouse_access?select=role,greenhouse&user_id=eq."+encodeURIComponent(String(claims.sub))+"&greenhouse=eq."+encodeURIComponent(gh));return Array.isArray(a)&&a.some((x:any)=>x.role==="accountant"&&x.greenhouse===gh)}
 const reason=typeof body.reason==="string"?body.reason.trim():"";if(reason.length<5||reason.length>500)return response(req,{ok:false,error:"reason_required"},400);
 try{
  if(body.action==="update_invoice_amount"){
   const id=typeof body.invoice_id==="string"?body.invoice_id.trim():"",amount=Number(body.amount_rial);
   if(!id||!Number.isSafeInteger(amount)||amount<=0)return response(req,{ok:false,error:"invalid_invoice_input"},400);
   const found=await db("GET","invoices?select=id,shipment_id,amount_rial,commission_rial,net_sales_rial,notes&id=eq."+encodeURIComponent(id)+"&limit=1");
   const inv=Array.isArray(found)?found[0]:null;if(!inv)return response(req,{ok:false,error:"invoice_not_found"},404);
   const ships=await db("GET","shipments?select=id,greenhouse,customer_id&id=eq."+encodeURIComponent(inv.shipment_id)+"&limit=1");
   const sh=Array.isArray(ships)?ships[0]:null;if(!sh||!await scope(String(sh.greenhouse)))return response(req,{ok:false,error:"accountant_access_required"},403);
   const customers=await db("GET","customers?select=customer_type&id=eq."+encodeURIComponent(String(sh.customer_id))+"&limit=1");
   const customer=Array.isArray(customers)?customers[0]:null;if(!customer)return response(req,{ok:false,error:"invoice_customer_not_found"},404);
   const previousCommission=Number(inv.commission_rial||0);
   const commission=customer.customer_type==="market_seller"?Math.round(amount*0.15):previousCommission;
   if(!Number.isSafeInteger(commission)||commission<0||commission>amount)return response(req,{ok:false,error:"invalid_commission"},409);
   const netSales=amount-commission;
   const audit="\\nاصلاح مبلغ فاکتور توسط "+String(claims.sub)+" در "+new Date().toISOString()+": "+String(inv.amount_rial)+" → "+String(amount)+" ریال؛ کمیسیون "+String(previousCommission)+" → "+String(commission)+" ریال؛ علت: "+reason;
   const upd=await db("PATCH","invoices?id=eq."+encodeURIComponent(id),{amount_rial:amount,commission_rial:commission,net_sales_rial:netSales,notes:String(inv.notes||"").slice(0,3000)+audit});
   const saved=Array.isArray(upd)?upd[0]:null;if(!saved||Number(saved.amount_rial)!==amount||Number(saved.commission_rial)!==commission||Number(saved.net_sales_rial)!==netSales)return response(req,{ok:false,error:"verification_failed"},409);
   return response(req,{ok:true,verified:true,invoice:saved});
  }
  if(body.action==="update_bank_transaction_amount"){
   const id=typeof body.transaction_id==="string"?body.transaction_id.trim():"",amount=Number(body.amount_rial);
   if(!id||!Number.isSafeInteger(amount)||amount<=0)return response(req,{ok:false,error:"invalid_transaction_input"},400);
   const found=await db("GET","bank_transactions?select=id,bank_account_id,transaction_type,amount_rial,notes&id=eq."+encodeURIComponent(id)+"&limit=1");
   const tx=Array.isArray(found)?found[0]:null;if(!tx)return response(req,{ok:false,error:"transaction_not_found"},404);
   const ac=await db("GET","bank_accounts?select=greenhouse&id=eq."+encodeURIComponent(tx.bank_account_id)+"&limit=1");
   const gh=Array.isArray(ac)?ac[0]?.greenhouse:null;if(!gh||!await scope(String(gh)))return response(req,{ok:false,error:"accountant_access_required"},403);
   const linked=await db("GET","payments?select=id,amount_rial,bank_transaction_id&bank_transaction_id=eq."+encodeURIComponent(id));
   if(Array.isArray(linked)&&linked.length>1)return response(req,{ok:false,error:"multiple_linked_payments"},409);
   const audit="\nاصلاح مبلغ تراکنش بانکی توسط "+String(claims.sub)+" در "+new Date().toISOString()+": "+String(tx.amount_rial)+" → "+String(amount)+" ریال؛ علت: "+reason;
   const upd=await db("PATCH","bank_transactions?id=eq."+encodeURIComponent(id),{amount_rial:amount,notes:String(tx.notes||"").slice(0,3000)+audit});
   const saved=Array.isArray(upd)?upd[0]:null;if(!saved||Number(saved.amount_rial)!==amount)return response(req,{ok:false,error:"verification_failed"},409);
   if(Array.isArray(linked)&&linked.length===1){const pu=await db("PATCH","payments?id=eq."+encodeURIComponent(linked[0].id),{amount_rial:amount});if(!Array.isArray(pu)||!pu[0]||Number(pu[0].amount_rial)!==amount)return response(req,{ok:false,error:"linked_payment_verification_failed",transaction:saved},409)}
   return response(req,{ok:true,verified:true,transaction:saved});
  }
  if(body.action==="reset_bank_accounting_classification"){
   const id=typeof body.transaction_id==="string"?body.transaction_id.trim():"";
   if(!id)return response(req,{ok:false,error:"invalid_transaction_id"},400);
   const found=await db("GET","bank_transactions?select=id,bank_account_id,status,needs_clarification,accounting_category,accounting_category_id,accounting_scope,notes,accounting_partner_name&id=eq."+encodeURIComponent(id)+"&limit=1");
   const tx=Array.isArray(found)?found[0]:null;if(!tx)return response(req,{ok:false,error:"transaction_not_found"},404);
   const ac=await db("GET","bank_accounts?select=greenhouse&id=eq."+encodeURIComponent(tx.bank_account_id)+"&limit=1");
   const gh=Array.isArray(ac)?ac[0]?.greenhouse:null;if(!gh||!await scope(String(gh)))return response(req,{ok:false,error:"accountant_access_required"},403);
   const upd=await db("PATCH","bank_transactions?id=eq."+encodeURIComponent(id),{status:"unmatched",needs_clarification:true,accounting_category:null,accounting_category_id:null,accounting_scope:null,is_accounting_expense:false,accounting_partner_name:null,notes:null,clarification_question:"ثبت حسابداری قبلی با درخواست کاربر بازنشانی شد: "+reason,clarification_answered_at:null});
   const saved=Array.isArray(upd)?upd[0]:null;
   if(!saved||saved.status!=="unmatched"||saved.needs_clarification!==true||saved.accounting_category_id!==null||saved.accounting_scope!==null)return response(req,{ok:false,error:"verification_failed"},409);
   return response(req,{ok:true,verified:true,transaction:saved});
  }
  return response(req,{ok:false,error:"unsupported_action"},400)
 }catch(e){return response(req,{ok:false,error:String(e instanceof Error?e.message:"operation_failed")},500)}
});