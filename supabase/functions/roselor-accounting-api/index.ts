import "jsr:@supabase/functions-js/edge-runtime.d.ts";
const BASE = "https://amiahhuapkqwbtcsmzal.supabase.co";
const ALLOWED_ORIGINS = new Set(["https://chatgpt.com","https://amiahhuapkqwbtcsmzal.supabase.co","https://id-preview--0a745bcf-66b6-42f8-9bde-8de369d482ab.lovable.app","https://roselor-accounting.lovable.app","https://alitoorabi-maker.github.io"]);
function corsHeaders(req: Request) {
  const origin = req.headers.get("origin") || "";
  return {"content-type":"application/json; charset=utf-8","access-control-allow-origin":ALLOWED_ORIGINS.has(origin)?origin:"https://chatgpt.com","vary":"Origin","access-control-allow-headers":"authorization, content-type, apikey","access-control-allow-methods":"POST, OPTIONS","cache-control":"no-store"};
}

function jalaliDateFromTimestamp(value: string) {
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-u-ca-persian", {
    timeZone: "UTC", year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(d);
  const p: Record<string,string> = {};
  for (const item of parts) if (item.type !== "literal") p[item.type] = item.value;
  const fa = (v: string) => v.replace(/[0-9]/g, x => "۰۱۲۳۴۵۶۷۸۹"[Number(x)]);
  return fa(p.year) + "/" + fa(p.month) + "/" + fa(p.day);
}
function jalaliToGregorian(jy:number,jm:number,jd:number) {
  let y=jy-979, m=jm-1, d=jd-1;
  let jdn=365*y+Math.floor(y/33)*8+Math.floor((y%33+3)/4);
  for(let i=0;i<m;i++) jdn += i<6 ? 31 : 30;
  jdn += d;
  let gdn=jdn+79;
  let gy=1600+400*Math.floor(gdn/146097);
  gdn%=146097;
  let leap=true;
  if(gdn>=36525){gdn--;gy+=100*Math.floor(gdn/36524);gdn%=36524;if(gdn>=365)gdn++;else leap=false;}
  gy+=4*Math.floor(gdn/1461);gdn%=1461;
  if(gdn>=366){leap=false;gdn--;gy+=Math.floor(gdn/365);gdn%=365;}
  const md=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31];
  let gm=0;while(gm<12&&gdn>=md[gm]){gdn-=md[gm];gm++;}
  return {year:gy,month:gm+1,day:gdn+1};
}
function reply(req: Request, data: unknown, status=200) { return new Response(JSON.stringify(data),{status,headers:corsHeaders(req)}); }
function jwtPayload(token: string) {
  try { const p=token.split(".")[1].replace(/-/g,"+").replace(/_/g,"/"); return JSON.parse(atob(p.padEnd(Math.ceil(p.length/4)*4,"="))); } catch { return null; }
}
Deno.serve(async (req: Request) => {
  if(req.method==="OPTIONS") return new Response(null,{status:204,headers:corsHeaders(req)});
  if(req.method!=="POST") return send({ok:false,error:"method_not_allowed"},405);
  const auth=req.headers.get("authorization")||"";
  if(!auth.startsWith("Bearer ")) return send({ok:false,error:"authentication_required"},401);
  const claims=jwtPayload(auth.slice(7));
  if(!claims?.sub || claims.role!=="authenticated") return send({ok:false,error:"authenticated_user_required"},403);
  const meta=claims.app_metadata||{};
  const metadataAdmin=meta.accounting_admin===true || meta.role==="admin";
  let body:any; try { body=await req.json(); } catch { return send({ok:false,error:"invalid_json"},400); }
  const action=body.action;
  const allowed=["my_access","overview","customer_balances","customer_ledger","create_customer_discount_adjustment","create_customer_balance_adjustment","transfer_customer_balance","transaction_ledger","unmatched_transactions","shipments_without_invoice","monthly_sales_monitor","bank_balance_reconciliation","create_invoice_for_shipment","pending_supervisor_invoices","approve_supervisor_invoice","create_shipment","customer_contract_options","delete_shipment","shipment_form_options","reconcile_deposit","reconcile_withdrawal","create_bank_reconciliation_adjustment","vendor_options","create_vendor","update_vendor","daily_harvest_summary","delete_daily_harvest","monthly_shipment_summary","returned_buckets","create_returned_bucket","driver_bucket_ledger","delete_driver_bucket_ledger","create_driver_bucket_return","pending_driver_bucket_returns","review_driver_bucket_return","pending_supervisor_shipments","review_supervisor_shipment","pending_supervisor_harvests","review_supervisor_harvest","driver_delivery_confirmations","save_daily_harvest"];
  if(!allowed.includes(action)) return send({ok:false,error:"unsupported_action",allowed},400);
  const key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if(!key) return send({ok:false,error:"server_configuration_missing"},500);
  async function get(path:string) {
    const r=await fetch(BASE+"/rest/v1/"+path,{headers:{apikey:key,authorization:"Bearer "+key}});
    const j=await r.json().catch(()=>null);
    if(!r.ok) throw new Error("database_read_failed:"+r.status);
    return j;
  }

  async function syncMarketSellerCustomer(vendor:any) {
    const isMarketSeller = String(vendor.vendor_type||"").trim().includes("بازار گل");
    if (!isMarketSeller) return null;
    const name = String(vendor.name||"").trim();
    const phone = String(vendor.phone||"").trim();
    const city = String(vendor.city||"").trim();
    const marketName = String(vendor.vendor_type||"بازار گل").trim();
    if (name.length < 2) throw new Error("invalid_market_customer_name");
    let existing:any[] = [];
    if (phone) existing = await get("customers?select=id,name,phone,customer_type,city,market_name,notes,is_active&phone=eq."+encodeURIComponent(phone)+"&limit=2");
    if (!existing.length) existing = await get("customers?select=id,name,phone,customer_type,city,market_name,notes,is_active&name=eq."+encodeURIComponent(name)+"&limit=2");
    if (existing.length > 1) throw new Error("market_customer_match_ambiguous");
    const payload:any = {name,customer_type:"market_seller",phone:phone||null,city:city||null,market_name:marketName,notes:vendor.notes||null,is_active:vendor.is_active!==false};
    if (existing.length===1) {
      const id=String(existing[0].id);
      const upd=await fetch(BASE+"/rest/v1/customers?id=eq."+encodeURIComponent(id),{method:"PATCH",headers:{"content-type":"application/json",apikey:key,authorization:"Bearer "+key,Prefer:"return=minimal"},body:JSON.stringify({...payload,updated_at:new Date().toISOString()})});
      if(!upd.ok) throw new Error("market_customer_sync_update_failed:"+upd.status);
      const check=await get("customers?select=id,name,phone,customer_type,market_name,is_active&id=eq."+encodeURIComponent(id)+"&limit=1");
      const saved=Array.isArray(check)?check[0]:null;
      if(!saved||saved.name!==name||saved.customer_type!=="market_seller"||(phone&&saved.phone!==phone)||saved.market_name!==marketName||saved.is_active!==payload.is_active) throw new Error("market_customer_sync_verification_failed");
      return saved;
    }
    const id="cust_"+crypto.randomUUID().replace(/-/g,"");
    await post("customers",{id,...payload});
    const check=await get("customers?select=id,name,phone,customer_type,market_name,is_active&id=eq."+encodeURIComponent(id)+"&limit=1");
    const saved=Array.isArray(check)?check[0]:null;
    if(!saved||saved.id!==id||saved.name!==name||saved.customer_type!=="market_seller"||(phone&&saved.phone!==phone)||saved.market_name!==marketName||saved.is_active!==payload.is_active) throw new Error("market_customer_sync_verification_failed");
    return saved;
  }
  async function post(path:string,data:unknown) {
    const r=await fetch(BASE+"/rest/v1/"+path,{method:"POST",headers:{"content-type":"application/json",apikey:key,authorization:"Bearer "+key,Prefer:"return=representation"},body:JSON.stringify(data)});
    const j=await r.json().catch(()=>null);
    if(!r.ok) throw new Error("database_write_failed:"+r.status+":"+JSON.stringify(j));
    return j;
  }
  await post("rpc/expire_customer_contract_entitlements",{}).catch(()=>null);
  let accessRows:any[]=[];
  if(!metadataAdmin) {
    const rows=await get("accounting_user_greenhouse_access?select=role,greenhouse,section_permissions&user_id=eq."+encodeURIComponent(String(claims.sub))+"&order=greenhouse.asc").catch(()=>[]);
    accessRows=Array.isArray(rows)?rows:[];
    if(!accessRows.length || accessRows.some((x:any)=>!["viewer","accountant","supervisor"].includes(x.role)||!["azna","khorramabad"].includes(x.greenhouse)))
      return send({ok:false,error:"accounting_access_not_assigned"},403);
  }
  const allowedGreenhouses=new Set<string>(metadataAdmin?["azna","khorramabad"]:accessRows.map((x:any)=>x.greenhouse));
  const writeGreenhouses=new Set<string>(metadataAdmin?["azna","khorramabad"]:accessRows.filter((x:any)=>x.role==="accountant"||x.role==="supervisor").map((x:any)=>x.greenhouse));
  const isReadOnly=!metadataAdmin && writeGreenhouses.size===0;
  const sectionDefaults:any={home:{view:true,write:false},buckets:{view:true,write:true},balances:{view:true,write:false},amb:{view:true,write:true},ledger:{view:true,write:false},bankRecon:{view:true,write:true},ship:{view:true,write:true},invoices:{view:true,write:true},cash:{view:true,write:true},vendors:{view:true,write:true},harvest:{view:true,write:true}};
  const hasSupervisor=!metadataAdmin&&accessRows.some((x:any)=>x.role==="supervisor");
  const sectionPermissions:any=metadataAdmin||accessRows.some((x:any)=>x.role==="accountant")?Object.fromEntries(Object.keys(sectionDefaults).map(k=>[k,{view:true,write:true}])):hasSupervisor?Object.fromEntries(Object.keys(sectionDefaults).map(k=>[k,{view:k==="cash"||k==="invoices"||k==="ship"||k==="harvest",write:k==="cash"||k==="invoices"||k==="ship"||k==="harvest"}])):Object.fromEntries(Object.keys(sectionDefaults).map(k=>{const entries=accessRows.map((x:any)=>({role:x.role,permission:x.section_permissions?.[k]||sectionDefaults[k]}));return [k,{view:entries.some((x:any)=>x.permission.view===true),write:false}]}));
  if(action==="my_access") return reply(req,{ok:true,is_admin:metadataAdmin,access:metadataAdmin?[{greenhouse:"azna",role:"admin"},{greenhouse:"khorramabad",role:"admin"}]:accessRows,section_permissions:sectionPermissions});
  if(hasSupervisor&&!["shipments_without_invoice","shipment_form_options","create_shipment","create_invoice_for_shipment","save_daily_harvest","daily_harvest_summary","supervisor_bucket_form_options","supervisor_bucket_requests","submit_supervisor_bucket_return"].includes(action)) return send({ok:false,error:"supervisor_action_not_allowed"},403);
  if(action==="supervisor_bucket_form_options"){
    if(!hasSupervisor)return send({ok:false,error:"supervisor_only"},403);
    const greenhouse=String(body.greenhouse||"");
    if(!["azna","khorramabad"].includes(greenhouse)||!accessRows.some((x:any)=>x.role==="supervisor"&&x.greenhouse===greenhouse))return send({ok:false,error:"greenhouse_access_denied"},403);
    const rows=await get("shipments?select=flower_truck&greenhouse=eq."+encodeURIComponent(greenhouse)+"&order=shipped_at.desc&limit=10000");
    const drivers=[...new Set((Array.isArray(rows)?rows:[]).map((x:any)=>String(x.flower_truck||"").trim()).filter(Boolean))];
    return send({ok:true,drivers});
  }
  if(action==="supervisor_bucket_requests"){
    if(!hasSupervisor)return send({ok:false,error:"supervisor_only"},403);
    const rows=await get("driver_bucket_return_requests?select=id,greenhouse,driver_name,bucket_count,status,driver_note,manager_note,created_at,reviewed_at&driver_user_id=eq."+encodeURIComponent(String(claims.sub))+"&order=created_at.desc&limit=200");
    return send({ok:true,requests:Array.isArray(rows)?rows:[]});
  }
  if(action==="submit_supervisor_bucket_return"){
    if(!hasSupervisor)return send({ok:false,error:"supervisor_only"},403);
    const greenhouse=String(body.greenhouse||""),driverName=String(body.driver_name||"").trim(),count=Number(body.bucket_count),note=String(body.driver_note||"").trim().slice(0,500);
    if(!["azna","khorramabad"].includes(greenhouse)||!accessRows.some((x:any)=>x.role==="supervisor"&&x.greenhouse===greenhouse)||driverName.length<1||driverName.length>120||!Number.isSafeInteger(count)||count<1||count>10000)return send({ok:false,error:"invalid_supervisor_bucket_return"},400);
    const known=await get("shipments?select=flower_truck&greenhouse=eq."+encodeURIComponent(greenhouse)+"&flower_truck=eq."+encodeURIComponent(driverName)+"&limit=1");
    if(!Array.isArray(known)||!known.length)return send({ok:false,error:"driver_not_found_for_greenhouse"},404);
    const id=crypto.randomUUID();
    await post("driver_bucket_return_requests",{id,driver_user_id:String(claims.sub),greenhouse,driver_name:driverName,bucket_count:count,status:"pending",driver_note:note||null});
    const verify=await get("driver_bucket_return_requests?select=id,driver_user_id,greenhouse,driver_name,bucket_count,status,driver_note,created_at&id=eq."+encodeURIComponent(id)+"&limit=1");
    const saved=Array.isArray(verify)?verify[0]:null;
    if(!saved||String(saved.driver_user_id)!==String(claims.sub)||saved.greenhouse!==greenhouse||saved.driver_name!==driverName||Number(saved.bucket_count)!==count||saved.status!=="pending")return send({ok:false,error:"supervisor_bucket_request_verification_failed"},409);
    return send({ok:true,verified:true,request:saved});
  }
  if(action==="pending_supervisor_invoices"){if(!metadataAdmin)return send({ok:false,error:"admin_only"},403);const rows=await get("invoices?select=id,shipment_id,invoice_date,amount_rial,commission_rial,net_sales_rial,status,notes&status=eq.pending&notes=like.*supervisor_submission:*&order=invoice_date.asc&limit=200");const shipmentIds=[...new Set((Array.isArray(rows)?rows:[]).map((x:any)=>String(x.shipment_id||"")).filter(Boolean))];const shipments=shipmentIds.length?await get("shipments?select=id,customer_id,greenhouse,quantity_bundles,shipped_at&id=in.("+shipmentIds.map(encodeURIComponent).join(",")+")"):[];const customerIds=[...new Set((Array.isArray(shipments)?shipments:[]).map((x:any)=>String(x.customer_id||"")).filter(Boolean))];const customers=customerIds.length?await get("customers?select=id,name&id=in.("+customerIds.map(encodeURIComponent).join(",")+")"):[];const customerNames=new Map((Array.isArray(customers)?customers:[]).map((x:any)=>[String(x.id),x.name]));const shipmentMap=new Map((Array.isArray(shipments)?shipments:[]).map((x:any)=>[String(x.id),x]));return send({ok:true,verified:true,invoices:(Array.isArray(rows)?rows:[]).map((x:any)=>{const s=shipmentMap.get(String(x.shipment_id||""));return {...x,customer_name:customerNames.get(String(s?.customer_id||""))||"نامشخص",greenhouse:s?.greenhouse||null,quantity_bundles:s?.quantity_bundles||null}})});}
  if(action==="approve_supervisor_invoice"){if(!metadataAdmin)return send({ok:false,error:"admin_only"},403);const invoiceId=typeof body.invoice_id==="string"?body.invoice_id.trim():"";if(!invoiceId)return send({ok:false,error:"invoice_id_required"},400);const rows=await get("invoices?select=id,status,notes,amount_rial,shipment_id&id=eq."+encodeURIComponent(invoiceId)+"&limit=1");const current=Array.isArray(rows)?rows[0]:null;if(!current||current.status!=="pending"||!String(current.notes||"").startsWith("supervisor_submission:"))return send({ok:false,error:"supervisor_pending_invoice_not_found"},404);const nextNotes=String(current.notes||"")+"\nتأیید نهایی مدیر: "+new Date().toISOString();const upd=await fetch(BASE+"/rest/v1/invoices?id=eq."+encodeURIComponent(invoiceId),{method:"PATCH",headers:{"content-type":"application/json",apikey:key,authorization:"Bearer "+key,Prefer:"return=minimal"},body:JSON.stringify({status:"received",notes:nextNotes})});if(!upd.ok)return send({ok:false,error:"invoice_approval_write_failed"},409);const verified=await get("invoices?select=id,status,notes,amount_rial,shipment_id&id=eq."+encodeURIComponent(invoiceId)+"&limit=1");const saved=Array.isArray(verified)?verified[0]:null;if(!saved||saved.status!=="received"||saved.shipment_id!==current.shipment_id)return send({ok:false,error:"invoice_approval_verification_failed"},409);return send({ok:true,verified:true,invoice:saved});}
  if(action==="driver_delivery_confirmations"){if(!metadataAdmin)return send({ok:false,error:"admin_only"},403);const rows=await get("shipments?select=id,customer_id,greenhouse,flower_truck,quantity_bundles,bucket_count,shipped_at,status&status=eq.delivered&order=shipped_at.desc&limit=100");const ids=[...new Set((Array.isArray(rows)?rows:[]).map((x:any)=>String(x.customer_id||"")).filter(Boolean))];const customers=ids.length?await get("customers?select=id,name&id=in.("+ids.map(encodeURIComponent).join(",")+")"):[];const names=new Map((Array.isArray(customers)?customers:[]).map((x:any)=>[String(x.id),x.name]));return send({ok:true,shipments:(Array.isArray(rows)?rows:[]).map((x:any)=>({...x,customer_name:names.get(String(x.customer_id||""))||"نامشخص"}))});}
  if(action==="pending_supervisor_harvests"||action==="review_supervisor_harvest"){if(!metadataAdmin)return send({ok:false,error:"admin_only"},403);if(action==="pending_supervisor_harvests"){const rows=await get("daily_harvest_submissions?select=id,harvest_date,greenhouse,quantity_bundles,notes,created_by,created_at&status=eq.pending_approval&order=created_at.asc");return send({ok:true,requests:Array.isArray(rows)?rows:[]});}const id=String(body.submission_id||"").trim(),approve=body.approve===true;if(!id)return send({ok:false,error:"submission_id_required"},400);const rows=await get("daily_harvest_submissions?select=id,harvest_date,greenhouse,quantity_bundles,notes,created_by,status&id=eq."+encodeURIComponent(id)+"&limit=1");const reqRow=Array.isArray(rows)?rows[0]:null;if(!reqRow||reqRow.status!=="pending_approval")return send({ok:false,error:"pending_harvest_not_found"},409);if(approve){const current=await get("daily_harvest?select=id&harvest_date=eq."+encodeURIComponent(String(reqRow.harvest_date))+"&greenhouse=eq."+encodeURIComponent(reqRow.greenhouse)+"&limit=1");const payload={harvest_date:reqRow.harvest_date,greenhouse:reqRow.greenhouse,quantity_bundles:reqRow.quantity_bundles,notes:reqRow.notes||null,created_by:reqRow.created_by,updated_at:new Date().toISOString()};if(Array.isArray(current)&&current.length){const r=await fetch(BASE+"/rest/v1/daily_harvest?id=eq."+encodeURIComponent(current[0].id),{method:"PATCH",headers:{"content-type":"application/json",apikey:key,authorization:"Bearer "+key,Prefer:"return=minimal"},body:JSON.stringify(payload)});if(!r.ok)throw new Error("approved_harvest_write_failed:"+r.status);}else await post("daily_harvest",{id:crypto.randomUUID(),...payload});}const status=approve?"approved":"rejected";const r=await fetch(BASE+"/rest/v1/daily_harvest_submissions?id=eq."+encodeURIComponent(id)+"&status=eq.pending_approval",{method:"PATCH",headers:{"content-type":"application/json",apikey:key,authorization:"Bearer "+key,Prefer:"return=minimal"},body:JSON.stringify({status,reviewed_by:String(claims.sub),reviewed_at:new Date().toISOString()})});if(!r.ok)throw new Error("harvest_review_failed:"+r.status);const verify=await get("daily_harvest_submissions?select=id,status,harvest_date,greenhouse,quantity_bundles&id=eq."+encodeURIComponent(id)+"&limit=1");const saved=Array.isArray(verify)?verify[0]:null;if(!saved||saved.status!==status)return send({ok:false,error:"harvest_review_verification_failed"},409);if(approve){const official=await get("daily_harvest?select=harvest_date,greenhouse,quantity_bundles&harvest_date=eq."+encodeURIComponent(String(saved.harvest_date))+"&greenhouse=eq."+encodeURIComponent(saved.greenhouse)+"&limit=1");if(!Array.isArray(official)||!official[0]||Number(official[0].quantity_bundles)!==Number(saved.quantity_bundles))return send({ok:false,error:"official_harvest_verification_failed"},409);}return send({ok:true,verified:true,request:saved});}
  if(action==="pending_supervisor_shipments"||action==="review_supervisor_shipment"){if(!metadataAdmin)return send({ok:false,error:"admin_only"},403);if(action==="pending_supervisor_shipments"){const rows=await get("shipments?select=id,customer_id,greenhouse,quantity_bundles,shipped_at,status,notes,flower_truck,bucket_count,created_at&status=eq.pending_approval&order=created_at.asc");const ids=[...new Set((rows||[]).map((x:any)=>String(x.customer_id)))];const customers=ids.length?await get("customers?select=id,name&id=in.("+ids.map(encodeURIComponent).join(",")+")"):[];const names=new Map((customers||[]).map((x:any)=>[String(x.id),x.name]));return send({ok:true,requests:(rows||[]).map((x:any)=>({...x,customer_name:names.get(String(x.customer_id))||"نامشخص"}))});}const id=String(body.shipment_id||"").trim(),approve=body.approve===true;if(!id)return send({ok:false,error:"shipment_id_required"},400);const rows=await get("shipments?select=id,status&id=eq."+encodeURIComponent(id)+"&limit=1");const row=Array.isArray(rows)?rows[0]:null;if(!row||row.status!=="pending_approval")return send({ok:false,error:"pending_shipment_not_found"},409);const status=approve?"sent":"rejected";const upd=await fetch(BASE+"/rest/v1/shipments?id=eq."+encodeURIComponent(id)+"&status=eq.pending_approval",{method:"PATCH",headers:{"content-type":"application/json",apikey:key,authorization:"Bearer "+key,Prefer:"return=minimal"},body:JSON.stringify({status})});if(!upd.ok)throw new Error("shipment_review_failed:"+upd.status);const verify=await get("shipments?select=id,status&id=eq."+encodeURIComponent(id)+"&limit=1");const saved=Array.isArray(verify)?verify[0]:null;if(!saved||saved.status!==status)return send({ok:false,error:"shipment_review_verification_failed"},409);return send({ok:true,verified:true,shipment_id:id,status});}
    if(action==="pending_driver_bucket_returns"||action==="review_driver_bucket_return"){if(!metadataAdmin)return send({ok:false,error:"admin_only"},403);if(action==="pending_driver_bucket_returns"){const rows=await get("driver_bucket_return_requests?select=id,greenhouse,driver_name,bucket_count,status,driver_note,created_at&status=eq.pending&order=created_at.asc");return send({ok:true,requests:Array.isArray(rows)?rows:[]});}const requestId=String(body.request_id||"").trim(),approve=body.approve===true,note=String(body.manager_note||"").trim().slice(0,500);if(!requestId)return send({ok:false,error:"request_id_required"},400);const rpc=await fetch(BASE+"/rest/v1/rpc/review_driver_bucket_return",{method:"POST",headers:{"content-type":"application/json",apikey:key,authorization:"Bearer "+key},body:JSON.stringify({p_request_id:requestId,p_approve:approve,p_manager_note:note||null,p_reviewer:String(claims.sub)})});const result=await rpc.json().catch(()=>null);if(!rpc.ok)return send({ok:false,error:"review_failed",detail:result},409);const verify=await get("driver_bucket_return_requests?select=id,status,bucket_count,ledger_id,reviewed_by&id=eq."+encodeURIComponent(requestId)+"&limit=1");if(!Array.isArray(verify)||verify.length!==1||verify[0].status!==(approve?"approved":"rejected")||String(verify[0].reviewed_by)!==String(claims.sub)||(approve&&!verify[0].ledger_id))return send({ok:false,error:"review_verification_failed"},409);return send({ok:true,verified:true,request:verify[0]});}
  const sectionByAction:any={overview:"home",customer_balances:"balances",customer_ledger:"balances",unmatched_transactions:"amb",reconcile_deposit:"amb",reconcile_withdrawal:"amb",transaction_ledger:"ledger",bank_balance_reconciliation:"bankRecon",create_bank_reconciliation_adjustment:"bankRecon",shipments_without_invoice:"ship",monthly_shipment_summary:"ship",shipment_form_options:"ship",create_shipment:"ship",delete_shipment:"ship",create_invoice_for_shipment:"invoices",monthly_sales_monitor:"invoices",vendor_options:"vendors",create_vendor:"vendors",update_vendor:"vendors",daily_harvest_summary:"harvest",returned_buckets:"buckets",create_returned_bucket:"buckets",driver_bucket_ledger:"buckets",create_driver_bucket_return:"buckets",save_daily_harvest:"harvest"};
  const writeActions=new Set(["reconcile_deposit","reconcile_withdrawal","create_bank_reconciliation_adjustment","create_shipment","delete_shipment","create_invoice_for_shipment","create_vendor","update_vendor","create_returned_bucket","create_driver_bucket_return","save_daily_harvest"]);
  const section=sectionByAction[action];if(!metadataAdmin&&section){const p=sectionPermissions[section];if(!p?.view)return send({ok:false,error:"section_access_denied",section},403);if(writeActions.has(action)&&!p.write)return send({ok:false,error:"section_write_denied",section},403);}

  const readOnlyActions=["overview","customer_balances","customer_ledger","transaction_ledger","unmatched_transactions","shipments_without_invoice","monthly_sales_monitor","bank_balance_reconciliation","daily_harvest_summary","monthly_shipment_summary","returned_buckets"];
  if(isReadOnly && !readOnlyActions.includes(action) && !(accessRows.some((x:any)=>x.role==="supervisor")&&["daily_harvest_summary","save_daily_harvest"].includes(action))) return send({ok:false,error:"read_only_access"},403);
  let scopedAccountIds=new Set<string>(), scopedWriteAccountIds=new Set<string>();
  if(!metadataAdmin) {
    for(const gh of allowedGreenhouses) {
      const accounts=await get("bank_accounts?select=id&greenhouse=eq."+encodeURIComponent(gh)+"&is_active=eq.true").catch(()=>[]);
      for(const a of (Array.isArray(accounts)?accounts:[])) scopedAccountIds.add(String(a.id));
    }
    for(const gh of writeGreenhouses) {
      const accounts=await get("bank_accounts?select=id&greenhouse=eq."+encodeURIComponent(gh)+"&is_active=eq.true").catch(()=>[]);
      for(const a of (Array.isArray(accounts)?accounts:[])) scopedWriteAccountIds.add(String(a.id));
    }
  }
  async function transactionInScope(txId:string) {
    if(metadataAdmin) return true;
    const txs=await get("bank_transactions?select=id,bank_account_id&id=eq."+encodeURIComponent(txId)+"&limit=1").catch(()=>[]);
    const tx=Array.isArray(txs)?txs[0]:null;
    return !!tx && scopedWriteAccountIds.has(String(tx.bank_account_id||""));
  }
  function send(data:any,status=200) {
    if(metadataAdmin || !data || data.ok!==true) return reply(req,data,status);
    const keepTx=(x:any)=>scopedAccountIds.has(String(x.bank_account_id||""));
    if(Array.isArray(data.accounts)) data={...data,accounts:data.accounts.filter((x:any)=>allowedGreenhouses.has(x.greenhouse))};
    if(Array.isArray(data.bank_accounts)) data={...data,bank_accounts:data.bank_accounts.filter((x:any)=>allowedGreenhouses.has(x.greenhouse))};
    if(Array.isArray(data.transactions)) data={...data,transactions:data.transactions.filter(keepTx)};
    if(Array.isArray(data.unmatched_transactions)) data={...data,unmatched_transactions:data.unmatched_transactions.filter(keepTx)};
    if(Array.isArray(data.customer_balances)) data={...data,customer_balances:data.customer_balances.map((x:any)=>{
      const az=allowedGreenhouses.has("azna")?Number(x.azna_balance_rial||0):0;
      const kh=allowedGreenhouses.has("khorramabad")?Number(x.khorramabad_balance_rial||0):0;
      return {...x,azna_balance_rial:az,khorramabad_balance_rial:kh,total_balance_rial:az+kh};
    })};
    if(Array.isArray(data.shipments_without_invoice)) data={...data,shipments_without_invoice:data.shipments_without_invoice.filter((x:any)=>allowedGreenhouses.has(x.greenhouse))};
    if(Array.isArray(data.shipments)) data={...data,shipments:data.shipments.filter((x:any)=>allowedGreenhouses.has(x.greenhouse))};
    if(Array.isArray(data.entries)) data={...data,entries:data.entries.filter((x:any)=>allowedGreenhouses.has(x.greenhouse))};
    if(Array.isArray(data.opening_balances)) data={...data,opening_balances:data.opening_balances.filter((x:any)=>allowedGreenhouses.has(x.greenhouse))};
    if(data.customer && Array.isArray(data.entries) && Array.isArray(data.opening_balances) && data.entries.length===0 && data.opening_balances.length===0)
      return reply(req,{ok:false,error:"customer_not_available_for_assigned_greenhouse"},404);
    if(action==="transaction_ledger") data={...data,categories:[]};
    if(action==="unmatched_transactions") {
      const allowedCustomerIds=new Set((data.transactions||[]).map((x:any)=>x.customer_id).filter(Boolean));
      data={...data,customers:(data.customers||[]).filter((x:any)=>allowedCustomerIds.has(x.id))};
    }
    return reply(req,data,status);
  }
  try {
    if(action==="create_bank_reconciliation_adjustment") {
      const accountId=typeof body.bank_account_id==="string"?body.bank_account_id.trim():"";
      const amount=Number(body.adjustment_rial);
      const reason=typeof body.reason==="string"?body.reason.trim():"";
      if(!accountId||!Number.isSafeInteger(amount)||amount===0||reason.length<5||reason.length>500)
        return send({ok:false,error:"invalid_adjustment_input"},400);
      if(!metadataAdmin&&!scopedWriteAccountIds.has(accountId)) return send({ok:false,error:"accountant_access_required_for_bank_account"},403);
      const accounts=await get("bank_accounts?select=id,greenhouse,is_active&id=eq."+encodeURIComponent(accountId)+"&limit=1");
      const account=Array.isArray(accounts)?accounts[0]:null;
      if(!account||account.is_active!==true) return send({ok:false,error:"active_bank_account_not_found"},404);
      if(!metadataAdmin&&!allowedGreenhouses.has(account.greenhouse)) return send({ok:false,error:"greenhouse_access_denied"},403);
      const id=crypto.randomUUID();
      await post("reconciliation_adjustments",{id,bank_account_id:accountId,bank_transaction_id:null,adjustment_rial:amount,reason,accounting_category:"اصلاح دستی مانده بانک"});
      const rows=await get("reconciliation_adjustments?select=id,bank_account_id,adjustment_rial,reason,accounting_category,created_at&id=eq."+encodeURIComponent(id)+"&limit=1");
      const saved=Array.isArray(rows)?rows[0]:null;
      if(!saved||Number(saved.adjustment_rial)!==amount||saved.bank_account_id!==accountId||saved.reason!==reason)
        return send({ok:false,error:"adjustment_verification_failed"},409);
      return send({ok:true,verified:true,adjustment:saved});
    }
    if(action==="bank_balance_reconciliation") {
      const accounts=await get("bank_accounts?select=id,name,bank_name,account_label,greenhouse,is_active&is_active=eq.true&order=name.asc");
      const out=[];
      for(const a of (Array.isArray(accounts)?accounts:[])) {
        const openings=await get("bank_opening_balances?select=opening_balance_rial,as_of_timestamp,notes&bank_account_id=eq."+encodeURIComponent(a.id)+"&limit=1");
        const opening=Array.isArray(openings)?openings[0]:null;
        const since=opening?.as_of_timestamp;
        let transactions=[];
        if(since) transactions=await get("bank_transactions?select=id,transaction_type,amount_rial,transaction_at,status,needs_clarification&bank_account_id=eq."+encodeURIComponent(a.id)+"&transaction_at=gte."+encodeURIComponent(since)+"&order=transaction_at.asc&limit=5000");
        const eligible=(Array.isArray(transactions)?transactions:[]).filter(t=>t.status==="matched" && t.needs_clarification!==true);
        const signed=eligible.reduce((sum,t)=>{
          const type=String(t.transaction_type||"").toLowerCase(),amount=Number(t.amount_rial||0);
          if(!Number.isFinite(amount)) return sum;
          if(type==="deposit"||type.includes("واریز")) return sum+amount;
          if(type==="withdrawal"||type.includes("برداشت")) return sum-amount;
          return sum;
        },Number(opening?.opening_balance_rial||0));
        const adjustments=await get("reconciliation_adjustments?select=adjustment_rial,bank_transaction_id,created_at&bank_account_id=eq."+encodeURIComponent(a.id)+"&created_at=gte."+encodeURIComponent(since||"1900-01-01T00:00:00Z")+"&limit=5000");
        const eligibleIds=new Set(eligible.map(t=>String(t.id)));
        const eligibleAdjustments=(Array.isArray(adjustments)?adjustments:[]).filter(x=>x.bank_transaction_id==null || eligibleIds.has(String(x.bank_transaction_id)));
        const adjustmentTotal=eligibleAdjustments.reduce((sum,x)=>sum+Number(x.adjustment_rial||0),0);
        const accountingBalance=signed+adjustmentTotal;
        const label=String(a.account_label||"").trim();
        let sms=[];
        if(label) sms=await get("sms_webhook_events?select=id,bank,account_number,balance_rial,raw_date,raw_time,created_at,received_at&account_number=eq."+encodeURIComponent(label)+"&balance_rial=not.is.null&order=created_at.desc&limit=1");
        const latest=Array.isArray(sms)?sms[0]||null:null;
        out.push({bank_account_id:a.id,name:a.name,bank_name:a.bank_name,greenhouse:a.greenhouse,account_label:label,opening_balance_rial:opening?.opening_balance_rial??null,opening_as_of:since??null,accounting_balance_rial:accountingBalance,adjustments_rial:adjustmentTotal,transactions_count:eligible.length,sms_balance_rial:latest?.balance_rial??null,sms_date_raw:latest?.raw_date??null,sms_time_raw:latest?.raw_time??null,sms_created_at:latest?.created_at??latest?.received_at??null,sms_bank:latest?.bank??null,sms_id:latest?.id??null});
      }
      return send({ok:true,source:"supabase",accounts:out});
    }
    if(action==="monthly_shipment_summary") {
      const dateFrom=typeof body.date_from==="string"?body.date_from.trim():"";
      const dateTo=typeof body.date_to==="string"?body.date_to.trim():"";
      const validDate=(x:string)=>/^\d{4}-\d{2}-\d{2}$/.test(x)&&!Number.isNaN(Date.parse(x+"T00:00:00Z"));
      if(!validDate(dateFrom)||!validDate(dateTo)||dateFrom>dateTo) return send({ok:false,error:"invalid_shipment_date_range"},400);
      const rows=await get("shipments?select=id,greenhouse,quantity_bundles,shipped_at,status&shipped_at=gte."+encodeURIComponent(dateFrom+"T00:00:00Z")+"&shipped_at=lt."+encodeURIComponent(new Date(Date.parse(dateTo+"T00:00:00Z")+86400000).toISOString())+"&status=neq.cancelled&limit=10000");
      const totals:any={azna:0,khorramabad:0};
      for(const x of (Array.isArray(rows)?rows:[])) {
        if(!x.greenhouse||!allowedGreenhouses.has(x.greenhouse)||!Object.prototype.hasOwnProperty.call(totals,x.greenhouse)) continue;
        totals[x.greenhouse]+=Number(x.quantity_bundles||0);
      }
      return send({ok:true,source:"supabase",date_from:dateFrom,date_to:dateTo,totals,shipment_count:Array.isArray(rows)?rows.filter((x:any)=>allowedGreenhouses.has(x.greenhouse)&&x.status!=="cancelled").length:0});
    }
    if(action==="daily_harvest_summary") {
      const dateFrom=typeof body.date_from==="string"?body.date_from.trim():"";
      const dateTo=typeof body.date_to==="string"?body.date_to.trim():"";
      const validDate=(x:string)=>/^\d{4}-\d{2}-\d{2}$/.test(x)&&!Number.isNaN(Date.parse(x+"T00:00:00Z"));
      if(!validDate(dateFrom)||!validDate(dateTo)||dateFrom>dateTo) return send({ok:false,error:"invalid_harvest_date_range"},400);
      const harvestRows=await get("daily_harvest?select=id,harvest_date,greenhouse,quantity_bundles,notes,created_at,updated_at&harvest_date=gte."+encodeURIComponent(dateFrom)+"&harvest_date=lte."+encodeURIComponent(dateTo)+"&order=harvest_date.desc&limit=1000");
      const shipmentsRows=await get("shipments?select=id,greenhouse,quantity_bundles,shipped_at,status&shipped_at=gte."+encodeURIComponent(dateFrom+"T00:00:00Z")+"&shipped_at=lt."+encodeURIComponent(new Date(Date.parse(dateTo+"T00:00:00Z")+86400000).toISOString())+"&status=neq.cancelled&limit=5000");
      const invoiceRows=await get("invoices?select=shipment_id&limit=5000");
      const invoiced=new Set((Array.isArray(invoiceRows)?invoiceRows:[]).map((x:any)=>String(x.shipment_id)));
      const shippedByDay:any={};
      for(const x of (Array.isArray(shipmentsRows)?shipmentsRows:[])) {
        if(!x.greenhouse||!allowedGreenhouses.has(x.greenhouse)||!invoiced.has(String(x.id))) continue;
        const day=String(x.shipped_at||"").slice(0,10), k=day+"|"+x.greenhouse;
        shippedByDay[k]=(shippedByDay[k]||0)+Number(x.quantity_bundles||0);
      }
      const rows=(Array.isArray(harvestRows)?harvestRows:[]).filter((x:any)=>allowedGreenhouses.has(x.greenhouse)).map((x:any)=>{
        const key=String(x.harvest_date)+"|"+x.greenhouse;
        const harvested=Number(x.quantity_bundles||0), invoicedBundles=Number(shippedByDay[key]||0);
        return {...x,invoiced_bundles:invoicedBundles,remaining_bundles:harvested-invoicedBundles};
      });
      return send({ok:true,source:"supabase",harvests:rows});
    }
    if(action==="delete_daily_harvest") {
      if(!metadataAdmin) return send({ok:false,error:"admin_only"},403);
      const id=typeof body.harvest_id==="string"?body.harvest_id.trim():"";
      if(!id) return send({ok:false,error:"harvest_id_required"},400);
      const rows=await get("daily_harvest?select=id,harvest_date,greenhouse,quantity_bundles&id=eq."+encodeURIComponent(id)+"&limit=1");
      const row=Array.isArray(rows)?rows[0]:null;
      if(!row) return send({ok:false,error:"daily_harvest_not_found"},404);
      const dayStart=String(row.harvest_date)+"T00:00:00Z";
      const dayEnd=new Date(Date.parse(dayStart)+86400000).toISOString();
      const shipments=await get("shipments?select=id,quantity_bundles,shipped_at,status,greenhouse&greenhouse=eq."+encodeURIComponent(row.greenhouse)+"&shipped_at=gte."+encodeURIComponent(dayStart)+"&shipped_at=lt."+encodeURIComponent(dayEnd)+"&status=neq.cancelled&limit=5000");
      const invoiceRows=await get("invoices?select=shipment_id&limit=10000");
      const invoiced=new Set((Array.isArray(invoiceRows)?invoiceRows:[]).map((x:any)=>String(x.shipment_id)));
      const invoicedBundles=(Array.isArray(shipments)?shipments:[]).filter((x:any)=>invoiced.has(String(x.id))).reduce((sum:number,x:any)=>sum+Number(x.quantity_bundles||0),0);
      if(invoicedBundles>0) return send({ok:false,error:"harvest_has_invoiced_shipments",invoiced_bundles:invoicedBundles},409);
      const del=await fetch(BASE+"/rest/v1/daily_harvest?id=eq."+encodeURIComponent(id),{method:"DELETE",headers:{apikey:key,authorization:"Bearer "+key,Prefer:"return=minimal"}});
      if(!del.ok) throw new Error("daily_harvest_delete_failed:"+del.status);
      const verify=await get("daily_harvest?select=id&id=eq."+encodeURIComponent(id)+"&limit=1");
      if(Array.isArray(verify)&&verify.length) return send({ok:false,error:"daily_harvest_delete_verification_failed"},409);
      return send({ok:true,verified:true,deleted_harvest_id:id});
    }
    if(action==="save_daily_harvest") {
      const harvestDate=typeof body.harvest_date==="string"?body.harvest_date.trim():"";
      const greenhouse=typeof body.greenhouse==="string"?body.greenhouse.trim():"";
      const bundles=Number(body.quantity_bundles);
      const notes=typeof body.notes==="string"?body.notes.trim().slice(0,500):"";
      if(!/^\d{4}-\d{2}-\d{2}$/.test(harvestDate)||Number.isNaN(Date.parse(harvestDate+"T00:00:00Z"))||!["azna","khorramabad"].includes(greenhouse)||!Number.isSafeInteger(bundles)||bundles<0)
        return send({ok:false,error:"invalid_harvest_input"},400);
      if(!metadataAdmin&&!writeGreenhouses.has(greenhouse)) return send({ok:false,error:"greenhouse_access_denied"},403);
      if(hasSupervisor||accessRows.some((x:any)=>x.role==="accountant")){const pending=await get("daily_harvest_submissions?select=id,status,harvest_date,greenhouse,quantity_bundles,notes&harvest_date=eq."+encodeURIComponent(harvestDate)+"&greenhouse=eq."+encodeURIComponent(greenhouse)+"&status=eq.pending_approval&limit=1");if(Array.isArray(pending)&&pending.length){const existing=pending[0];if(Number(existing.quantity_bundles)===bundles)return send({ok:true,verified:true,pending_approval:true,submission:existing,already_pending:true});return send({ok:false,error:"harvest_pending_conflict",pending_submission:existing},409);}const id=crypto.randomUUID();await post("daily_harvest_submissions",{id,harvest_date:harvestDate,greenhouse,quantity_bundles:bundles,notes:notes||null,created_by:String(claims.sub),status:"pending_approval"});const verify=await get("daily_harvest_submissions?select=id,status,harvest_date,greenhouse,quantity_bundles&id=eq."+encodeURIComponent(id)+"&limit=1");const saved=Array.isArray(verify)?verify[0]:null;if(!saved||saved.status!=="pending_approval"||Number(saved.quantity_bundles)!==bundles)return send({ok:false,error:"harvest_submission_verification_failed"},409);return send({ok:true,verified:true,pending_approval:true,submission:saved});}
      const existing=await get("daily_harvest?select=id&harvest_date=eq."+encodeURIComponent(harvestDate)+"&greenhouse=eq."+encodeURIComponent(greenhouse)+"&limit=1");
      let id="";
      if(Array.isArray(existing)&&existing.length) {
        id=String(existing[0].id);
        const r=await fetch(BASE+"/rest/v1/daily_harvest?id=eq."+encodeURIComponent(id),{method:"PATCH",headers:{"content-type":"application/json",apikey:key,authorization:"Bearer "+key,Prefer:"return=minimal"},body:JSON.stringify({quantity_bundles:bundles,notes:notes||null,updated_at:new Date().toISOString()})});
        if(!r.ok) throw new Error("daily_harvest_update_failed:"+r.status);
      } else {
        id=crypto.randomUUID();
        await post("daily_harvest",{id,harvest_date:harvestDate,greenhouse,quantity_bundles:bundles,notes:notes||null,created_by:String(claims.sub)});
      }
      const rows=await get("daily_harvest?select=id,harvest_date,greenhouse,quantity_bundles,notes,created_at,updated_at&id=eq."+encodeURIComponent(id)+"&limit=1");
      const saved=Array.isArray(rows)?rows[0]:null;
      if(!saved||saved.greenhouse!==greenhouse||String(saved.harvest_date)!==harvestDate||Number(saved.quantity_bundles)!==bundles)
        return send({ok:false,error:"daily_harvest_verification_failed"},409);
      return send({ok:true,verified:true,harvest:saved});
    }
    if(action==="shipment_form_options") {
      const [customers,transportVendors,legacyDrivers,contracts]=await Promise.all([
        get("customers?select=id,name,phone,is_active,customer_type&is_active=eq.true&order=name.asc"),
        get("vendors?select=name,flower_truck_driver&is_active=eq.true&vendor_type=eq."+encodeURIComponent("حمل‌ونقل")+"&order=name.asc"),
        get("vendors?select=flower_truck_driver&is_active=eq.true&flower_truck_driver=not.is.null&order=flower_truck_driver.asc"),
        get("customer_contracts?select=id,customer_id,greenhouse,contract_start_date,contract_end_date,delivery_frequency,quantity_per_period,period_price_rial,unit_price_rial,is_active&is_active=eq.true&order=contract_start_date.desc")
      ]);
      const candidates=[...(transportVendors||[]).flatMap((v:any)=>[v.name,v.flower_truck_driver]),...(legacyDrivers||[]).map((v:any)=>v.flower_truck_driver)];
      const flower_truck_drivers=Array.from(new Set(candidates.map((x:any)=>String(x||"").trim()).filter((x:string)=>x.length>0 && x!=="راننده ماشین گل")));
      return send({ok:true,source:"supabase",customers:customers||[],flower_truck_drivers,contracts:Array.isArray(contracts)?contracts:[]});
    }
    if(action==="customer_contract_options") {
      if(hasSupervisor) return send({ok:false,error:"manager_access_required_for_contract_quota"},403);
      const customerId=typeof body.customer_id==="string"?body.customer_id.trim():"";
      const greenhouse=body.greenhouse==="azna"||body.greenhouse==="khorramabad"?body.greenhouse:"";
      if(!customerId||!greenhouse) return send({ok:false,error:"invalid_contract_lookup"},400);
      const rows=await get("customer_contracts?select=id,customer_id,greenhouse,contract_start_date,contract_end_date,delivery_frequency,quantity_per_period,period_price_rial,unit_price_rial,is_active&customer_id=eq."+encodeURIComponent(customerId)+"&greenhouse=eq."+encodeURIComponent(greenhouse)+"&is_active=eq.true&order=contract_start_date.desc&limit=5");
      const today=new Date().toISOString().slice(0,10);
      const contract=(Array.isArray(rows)?rows:[]).find((x:any)=>x.contract_start_date<=today&&x.contract_end_date>=today)||null;
      if(!contract) return send({ok:true,contract:null});
      const entitlements=await get("customer_contract_weekly_entitlements?select=week_start,quota_bundles,consumed_bundles&contract_id=eq."+encodeURIComponent(contract.id)+"&order=week_start.asc");
      return send({ok:true,contract,entitlements:Array.isArray(entitlements)?entitlements:[]});
    }
    if(action==="create_shipment") {
      const customerId=typeof body.customer_id==="string"?body.customer_id.trim():"";
      const greenhouse=body.greenhouse;
      const bundles=Number(body.quantity_bundles);
      const declaredAmount=body.declared_amount_rial===undefined||body.declared_amount_rial===null||body.declared_amount_rial===""?null:Number(body.declared_amount_rial);
      let flowerTruck=typeof body.flower_truck==="string"?body.flower_truck.trim():"";
      let bucketCount=Number(body.bucket_count);
      const rawDate=typeof body.shipped_at_jalali==="string"?body.shipped_at_jalali.trim():"";
      const notes=typeof body.notes==="string"?body.notes.trim().slice(0,500):"";
      const match=rawDate.match(/^([0-9]{4})[\/-]([0-9]{1,2})[\/-]([0-9]{1,2})$/);
      if(!customerId||!["azna","khorramabad"].includes(greenhouse)||(!metadataAdmin&&!writeGreenhouses.has(greenhouse))||!Number.isSafeInteger(bundles)||bundles<=0||(declaredAmount!==null&&(!Number.isSafeInteger(declaredAmount)||declaredAmount<=0))||flowerTruck.length>120||!Number.isSafeInteger(bucketCount)||bucketCount<0||bucketCount>10000||!match)
        return send({ok:false,error:"invalid_shipment_input"},400);
      const jy=Number(match[1]),jm=Number(match[2]),jd=Number(match[3]);
      if(jy<1300||jy>1500||jm<1||jm>12||jd<1||jd>(jm<=6?31:jm<=11?30:30))
        return send({ok:false,error:"invalid_jalali_date"},400);
      const g=jalaliToGregorian(jy,jm,jd);
      const shippedAt=new Date(Date.UTC(g.year,g.month-1,g.day)).toISOString();
      const check=jalaliDateFromTimestamp(shippedAt);
      const asciiCheck=check?.replace(/[۰-۹]/g,c=>String("۰۱۲۳۴۵۶۷۸۹".indexOf(c))).replace(/-/g,"/");
      const expected=String(jy)+"/"+String(jm).padStart(2,"0")+"/"+String(jd).padStart(2,"0");
      if(asciiCheck!==expected) return send({ok:false,error:"jalali_date_conversion_failed",converted:check},400);
      const customers=await get("customers?select=id,name,phone,is_active,customer_type&id=eq."+encodeURIComponent(customerId)+"&limit=1");
      const customer=Array.isArray(customers)?customers[0]:null;
      if(!customer||customer.is_active===false) return send({ok:false,error:"active_customer_not_found"},404);
      const isMarketCustomer=customer.customer_type==="market_seller";
      const activeContracts=await get("customer_contracts?select=id&customer_id=eq."+encodeURIComponent(customerId)+"&greenhouse=eq."+encodeURIComponent(greenhouse)+"&is_active=eq.true&contract_start_date=lte."+encodeURIComponent(shippedAt.slice(0,10))+"&contract_end_date=gte."+encodeURIComponent(shippedAt.slice(0,10))+"&limit=1");
      const hasActiveContract=Array.isArray(activeContracts)&&activeContracts.length>0;
      if(isMarketCustomer&&!hasActiveContract&&(!flowerTruck||bucketCount<1)) return send({ok:false,error:"market_truck_and_bucket_count_required"},400);
      if(!isMarketCustomer) { bucketCount=0; flowerTruck=""; }
      const compact=String(jy)+String(jm).padStart(2,"0")+String(jd).padStart(2,"0");
      const gh=greenhouse==="azna"?"az":"kh";
      const shipmentId="shp_"+compact+"_"+gh+"_"+crypto.randomUUID().replace(/-/g,"").slice(0,12);
      const row={id:shipmentId,customer_id:customerId,greenhouse:greenhouse,quantity_bundles:bundles,shipped_at:shippedAt,status:hasSupervisor?"pending_approval":"sent",notes:notes||null,declared_amount_rial:declaredAmount,flower_truck:flowerTruck,bucket_count:bucketCount};
      const quotaMode=body.contract_quota_mode==="include_next_week"?"include_next_week":"saved_and_current";
      const dailyPrice=body.daily_unit_price_rial===undefined||body.daily_unit_price_rial===null||body.daily_unit_price_rial===""?null:Number(body.daily_unit_price_rial);
      if(dailyPrice!==null&&(!Number.isSafeInteger(dailyPrice)||dailyPrice<=0)) return send({ok:false,error:"invalid_daily_unit_price"},400);
      let allocation:any;
      try { allocation=await post("rpc/create_contract_shipment_with_allocation",{p_shipment:row,p_quota_mode:quotaMode,p_daily_unit_price_rial:dailyPrice}); }
      catch(e) { if(String(e).includes("daily_price_required_for_extra_bundles")) return send({ok:false,error:"contract_quota_exceeded_manager_price_required"},409); throw e; }
      const verify=await get("shipments?select=id,customer_id,greenhouse,quantity_bundles,shipped_at,status,notes,declared_amount_rial,flower_truck,bucket_count&id=eq."+encodeURIComponent(shipmentId)+"&limit=1");
      const saved=Array.isArray(verify)?verify[0]:null;
      const effectiveAmount=allocation?.contracted===true?Number(allocation.total_amount_rial):declaredAmount;
      if(!saved||saved.customer_id!==customerId||saved.greenhouse!==greenhouse||Number(saved.quantity_bundles)!==bundles||(effectiveAmount===null?saved.declared_amount_rial!==null:Number(saved.declared_amount_rial)!==effectiveAmount)||saved.flower_truck!==flowerTruck||Number(saved.bucket_count)!==bucketCount||saved.status!==(hasSupervisor?"pending_approval":"sent")||new Date(saved.shipped_at).toISOString()!==shippedAt)
        return send({ok:false,error:"shipment_verification_failed",shipment:saved,allocation},409);
      return send({ok:true,verified:true,allocation,shipment:{...saved,customer_name:customer.name,customer_phone:customer.phone||null,shipped_at_jalali:check}});
    }
    if(action==="reconcile_withdrawal") {
      const txId=body.transaction_id, disposition=body.disposition;
      const category=typeof body.category==="string"?body.category:null;
      const scope=typeof body.scope==="string"?body.scope:null;
      const partnerName=typeof body.partner_name==="string"?body.partner_name.trim():null;
      const notes=typeof body.notes==="string"?body.notes.slice(0,500):null;
      if(typeof txId!=="string"||!txId||!["expense","personal","transfer","other","unknown"].includes(disposition)) return send({ok:false,error:"invalid_reconciliation_input"},400);
      if(!await transactionInScope(txId)) return send({ok:false,error:"greenhouse_access_denied"},403);
      let result=await post("rpc/reconcile_bank_withdrawal",{p_transaction_id:txId,p_disposition:disposition,p_category:category,p_scope:scope,p_notes:notes,p_partner_name:partnerName});
      let rows=await get("bank_transactions?select=id,transaction_type,amount_rial,status,needs_clarification,accounting_category,accounting_scope,accounting_category_id,accounting_partner_name,is_accounting_expense,notes&id=eq."+encodeURIComponent(txId));
      let tx=Array.isArray(rows)?rows[0]:null;
      // One idempotent retry protects against a transient write/read race. Never report success unless a fresh read confirms the final state.
      if(disposition!=="unknown" && tx && (tx.status!=="matched" || tx.needs_clarification===true)) {
        result=await post("rpc/reconcile_bank_withdrawal",{p_transaction_id:txId,p_disposition:disposition,p_category:category,p_scope:scope,p_notes:notes});
        rows=await get("bank_transactions?select=id,transaction_type,amount_rial,status,needs_clarification,accounting_category,accounting_scope,accounting_category_id,accounting_partner_name,is_accounting_expense,notes&id=eq."+encodeURIComponent(txId));
        tx=Array.isArray(rows)?rows[0]:null;
      }
      if(!tx||tx.transaction_type!=="withdrawal") return send({ok:false,error:"withdrawal_verification_failed",result},409);
      if(disposition==="unknown") return tx.needs_clarification===true ? reply(req,{ok:true,verified:true,transaction:tx,result}) : reply(req,{ok:false,error:"unknown_status_verification_failed",transaction:tx},409);
      if(tx.status!=="matched"||tx.needs_clarification===true) return send({ok:false,error:"verification_failed",transaction:tx},409);
      if(["expense","personal"].includes(disposition)&&(tx.accounting_category!==category||tx.is_accounting_expense!==(result?.is_expense===true))) return send({ok:false,error:"category_verification_failed",transaction:tx,result},409);
      if(disposition==="expense"&&category==="پرداخت به شریک گلخانه"&&tx.accounting_partner_name!==partnerName) return send({ok:false,error:"partner_verification_failed",transaction:tx,result},409);
      if(disposition==="transfer"&&(tx.accounting_category!=="انتقال بین حساب‌ها"||tx.is_accounting_expense)) return send({ok:false,error:"transfer_verification_failed",transaction:tx},409);
      return send({ok:true,verified:true,transaction:tx,result});
    }
    if(action==="reconcile_deposit") {
      const txId=body.transaction_id, disposition=body.disposition, customerId=body.customer_id??null;
      const notes=typeof body.notes==="string"?body.notes.slice(0,500):null;
      if(typeof txId!=="string"||!txId||!["customer","transfer","other","unknown"].includes(disposition)) return send({ok:false,error:"invalid_reconciliation_input"},400);
      if(!await transactionInScope(txId)) return send({ok:false,error:"greenhouse_access_denied"},403);
      if(disposition==="customer"&&(typeof customerId!=="string"||!customerId)) return send({ok:false,error:"customer_required"},400);
      const result=await post("rpc/reconcile_bank_deposit",{p_transaction_id:txId,p_customer_id:customerId,p_disposition:disposition,p_notes:notes});
      const txRows=await get("bank_transactions?select=id,transaction_type,amount_rial,customer_id,status,needs_clarification,accounting_category&id=eq."+encodeURIComponent(txId));
      const tx=Array.isArray(txRows)?txRows[0]:null;
      if(!tx || tx.transaction_type!=="deposit") return send({ok:false,error:"deposit_verification_failed",result},409);
      if(disposition==="unknown") {
        if(tx.status==="unmatched" && tx.needs_clarification===true) return send({ok:true,verified:true,result,transaction:tx});
        return send({ok:false,error:"unknown_status_verification_failed",transaction:tx},409);
      }
      if(tx.status!=="matched" || tx.needs_clarification===true) return send({ok:false,error:"verification_failed",result,transaction:tx},409);
      if(disposition==="customer") {
        const payments=await get("payments?select=id,customer_id,amount_rial,bank_transaction_id&bank_transaction_id=eq."+encodeURIComponent(txId));
        const valid=Array.isArray(payments)&&payments.length===1&&payments[0].customer_id===customerId&&Number(payments[0].amount_rial)===Number(tx.amount_rial)&&tx.customer_id===customerId;
        if(!valid) return send({ok:false,error:"payment_verification_failed",transaction:tx,payments},409);
        return send({ok:true,verified:true,transaction:tx,payment:payments[0]});
      }
      return send({ok:true,verified:true,transaction:tx,payment_created:false});
    }
    if(action==="create_customer_discount_adjustment") {
      if(!metadataAdmin) return send({ok:false,error:"admin_only"},403);
      const customerId=typeof body.customer_id==="string"?body.customer_id.trim():"";
      const greenhouse=body.greenhouse==="azna"||body.greenhouse==="khorramabad"?body.greenhouse:"";
      const amount=Number(body.amount_rial);
      const description=typeof body.description==="string"?body.description.trim():"";
      if(!customerId||!greenhouse||!Number.isSafeInteger(amount)||amount<=0||amount>1000000000000||description.length>500) return send({ok:false,error:"invalid_discount_adjustment"},400);
      const customers=await get("customers?select=id,name&id=eq."+encodeURIComponent(customerId)+"&limit=1");
      if(!Array.isArray(customers)||!customers.length) return send({ok:false,error:"customer_not_found"},404);
      const rows=await post("customer_account_adjustments",{id:"adj_discount_"+crypto.randomUUID(),customer_id:customerId,greenhouse,event_at:new Date().toISOString(),adjustment_type:"discount",amount_rial:amount,description:description||"تخفیف اصلاحی مانده حساب"});
      const created=Array.isArray(rows)?rows[0]:rows;
      const verify=await get("customer_account_adjustments?select=id,customer_id,greenhouse,adjustment_type,amount_rial,description&id=eq."+encodeURIComponent(created.id)+"&limit=1");
      if(!Array.isArray(verify)||verify.length!==1||Number(verify[0].amount_rial)!==amount||verify[0].customer_id!==customerId) return send({ok:false,error:"discount_adjustment_verification_failed"},500);
      return send({ok:true,verified:true,adjustment:verify[0]});
    }
    if(action==="create_customer_balance_adjustment") {
      if(!metadataAdmin) return send({ok:false,error:"admin_only"},403);
      const customerId=typeof body.customer_id==="string"?body.customer_id.trim():"";
      const greenhouse=body.greenhouse==="azna"||body.greenhouse==="khorramabad"?body.greenhouse:"";
      const direction=body.direction==="increase_debt"||body.direction==="decrease_debt"?body.direction:"";
      const amount=Number(body.amount_rial);
      const description=typeof body.description==="string"?body.description.trim():"";
      const requestId=typeof body.request_id==="string"?body.request_id.trim().toLowerCase():"";
      if(!customerId||!greenhouse||!direction||!Number.isSafeInteger(amount)||amount<=0||amount>1000000000000||description.length<3||description.length>500||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(requestId))
        return send({ok:false,error:"invalid_customer_balance_adjustment"},400);
      const customers=await get("customers?select=id,name&id=eq."+encodeURIComponent(customerId)+"&limit=1");
      if(!Array.isArray(customers)||!customers.length) return send({ok:false,error:"customer_not_found"},404);
      const adjustmentType=direction==="increase_debt"?"debit_adjustment":"credit_adjustment";
      const adjustmentId="adj_balance_"+requestId;
      const matches=(row:any)=>row&&row.id===adjustmentId&&row.customer_id===customerId&&row.greenhouse===greenhouse&&row.adjustment_type===adjustmentType&&Number(row.amount_rial)===amount&&row.description===description;
      let existing=await get("customer_account_adjustments?select=id,customer_id,greenhouse,event_at,adjustment_type,amount_rial,description&id=eq."+encodeURIComponent(adjustmentId)+"&limit=1");
      let saved=Array.isArray(existing)?existing[0]:null;
      if(saved&&!matches(saved)) return send({ok:false,error:"adjustment_request_id_conflict"},409);
      if(!saved) {
        try {
          await post("customer_account_adjustments",{
            id:adjustmentId,customer_id:customerId,greenhouse,event_at:new Date().toISOString(),
            adjustment_type:adjustmentType,amount_rial:amount,description
          });
        } catch(writeError) {
          const raced=await get("customer_account_adjustments?select=id,customer_id,greenhouse,event_at,adjustment_type,amount_rial,description&id=eq."+encodeURIComponent(adjustmentId)+"&limit=1").catch(()=>[]);
          if(!Array.isArray(raced)||raced.length!==1||!matches(raced[0])) throw writeError;
        }
      }
      const verify=await get("customer_account_adjustments?select=id,customer_id,greenhouse,event_at,adjustment_type,amount_rial,description&id=eq."+encodeURIComponent(adjustmentId)+"&limit=1");
      saved=Array.isArray(verify)?verify[0]:null;
      if(!matches(saved)) return send({ok:false,error:"customer_balance_adjustment_verification_failed"},409);
      await post("rpc/rebuild_customer_account",{p_customer_id:customerId});
      const [summaryRows,ledgerRows]=await Promise.all([
        get("customer_balance_summary?select=customer_id,azna_balance_rial,khorramabad_balance_rial,total_balance_rial,updated_at&customer_id=eq."+encodeURIComponent(customerId)+"&limit=1"),
        get("customer_account_ledger?select=id,customer_id,greenhouse,event_at,source_type,source_id,description,debit_rial,credit_rial,balance_after_rial&source_type=eq.adjustment&source_id=eq."+encodeURIComponent(adjustmentId)+"&limit=1")
      ]);
      const summary=Array.isArray(summaryRows)?summaryRows[0]:null;
      const ledger=Array.isArray(ledgerRows)?ledgerRows[0]:null;
      const expectedDebit=direction==="increase_debt"?amount:0;
      const expectedCredit=direction==="decrease_debt"?amount:0;
      if(!summary||!ledger||ledger.customer_id!==customerId||ledger.greenhouse!==greenhouse||Number(ledger.debit_rial)!==expectedDebit||Number(ledger.credit_rial)!==expectedCredit||ledger.source_id!==adjustmentId)
        return send({ok:false,error:"customer_balance_adjustment_ledger_verification_failed",adjustment:saved,summary,ledger},409);
      return send({ok:true,verified:true,direction,adjustment:saved,summary,ledger});
    }
    if(action==="transfer_customer_balance") {
      if(!metadataAdmin) return send({ok:false,error:"admin_only"},403);
      const customerId=typeof body.customer_id==="string"?body.customer_id.trim():"";
      const from=body.from_greenhouse==="azna"||body.from_greenhouse==="khorramabad"?body.from_greenhouse:"";
      const to=body.to_greenhouse==="azna"||body.to_greenhouse==="khorramabad"?body.to_greenhouse:"";
      if(!customerId||!from||!to||from===to) return send({ok:false,error:"invalid_greenhouse_transfer"},400);
      const customers=await get("customers?select=id&id=eq."+encodeURIComponent(customerId)+"&limit=1");
      if(!Array.isArray(customers)||!customers.length) return send({ok:false,error:"customer_not_found"},404);
      const amount=Number(body.amount_rial);if(!Number.isSafeInteger(amount)||amount<=0)return send({ok:false,error:"invalid_transfer_amount"},400);const transfer=await post("rpc/transfer_customer_balance",{p_customer_id:customerId,p_from_greenhouse:from,p_to_greenhouse:to,p_amount_rial:amount});
      if(!transfer||transfer.ok!==true||!transfer.out_adjustment_id||!transfer.in_adjustment_id) return send({ok:false,error:"transfer_not_confirmed"},500);
      const [summary,adjustments,ledger]=await Promise.all([
        get("customer_balance_summary?select=customer_id,azna_balance_rial,khorramabad_balance_rial,total_balance_rial&customer_id=eq."+encodeURIComponent(customerId)+"&limit=1"),
        get("customer_account_adjustments?select=id,customer_id,greenhouse,adjustment_type,amount_rial,description&id=in.("+encodeURIComponent(transfer.out_adjustment_id)+","+encodeURIComponent(transfer.in_adjustment_id)+")"),
        get("customer_account_ledger?select=id,customer_id,greenhouse,source_type,source_id,debit_rial,credit_rial&source_type=eq.adjustment&source_id=in.("+encodeURIComponent(transfer.out_adjustment_id)+","+encodeURIComponent(transfer.in_adjustment_id)+")")
      ]);
      if(!Array.isArray(summary)||summary.length!==1||!Array.isArray(adjustments)||adjustments.length!==2||!Array.isArray(ledger)||ledger.length!==2) return send({ok:false,error:"transfer_verification_failed"},500);
      if(Number(summary[0].total_balance_rial)!==Number(transfer.summary.total_balance_rial)) return send({ok:false,error:"transfer_balance_verification_failed"},500);
      return send({ok:true,verified:true,transfer:{...transfer,summary:summary[0],adjustments,ledger}});
    }
    if(action==="customer_ledger") {
      const customerId=typeof body.customer_id==="string"?body.customer_id.trim():"";
      if(!customerId) return send({ok:false,error:"customer_id_required"},400);
      const [customers,opening,entries,adjustments]=await Promise.all([
        get("customers?select=id,name,is_active&id=eq."+encodeURIComponent(customerId)+"&limit=1"),
        get("customer_opening_balances?select=customer_id,greenhouse,amount_rial,as_of_date,baseline_locked,notes&customer_id=eq."+encodeURIComponent(customerId)+"&order=greenhouse.asc"),
        get("customer_account_ledger?select=id,customer_id,greenhouse,event_at,source_type,source_id,description,debit_rial,credit_rial,balance_after_rial,created_at&customer_id=eq."+encodeURIComponent(customerId)+"&order=event_at.desc,id.desc&limit=1000"),
        get("customer_account_adjustments?select=id,customer_id,greenhouse,event_at,adjustment_type,amount_rial,description,created_at&customer_id=eq."+encodeURIComponent(customerId)+"&order=event_at.desc&limit=500")
      ]);
      const customer=Array.isArray(customers)?customers[0]:null;
      if(!customer) return send({ok:false,error:"customer_not_found"},404);
      return send({ok:true,source:"supabase",currency:"IRR",customer,opening_balances:opening||[],entries:entries||[],adjustments:adjustments||[]});
    }
    if(action==="transaction_ledger") {
      const [transactions,categories,accounts]=await Promise.all([
        get("bank_transactions?select=id,bank_account_id,transaction_type,amount_rial,transaction_at,balance_after_rial,reference_number,raw_message,customer_id,status,accounting_category,accounting_scope,is_accounting_expense,notes,accounting_category_id,created_at&order=transaction_at.desc&limit=1000"),
        get("accounting_categories?select=id,code,name,category_type,accounting_scope,is_active&is_active=eq.true&order=name.asc&limit=1000"),
        get("bank_accounts?select=id,name,bank_name,account_label,greenhouse,current_balance_rial,is_active&is_active=eq.true&order=name.asc&limit=500")
      ]);
      return send({ok:true,source:"supabase",currency:"IRR",transactions:transactions||[],categories:categories||[],bank_accounts:accounts||[]});
    }
    if(action==="customer_balances"||action==="overview") {
      const [customers,balances]=await Promise.all([get("customers?select=id,name,is_active,phone&order=name.asc"),get("customer_balance_summary?select=customer_id,azna_balance_rial,khorramabad_balance_rial,total_balance_rial,updated_at&order=customer_id.asc")]);
      const names=new Map((customers||[]).map((x:any)=>[x.id,x.name]));
      const customer_balances=(balances||[]).filter((x:any)=>Number(x.total_balance_rial||0)!==0).map((x:any)=>({...x,customer_name:names.get(x.customer_id)||"نامشخص"}));
      if(action==="customer_balances") {
        const byId=new Map((balances||[]).map((x:any)=>[x.customer_id,x]));
        const allCustomers=(customers||[]).filter((x:any)=>x.is_active!==false).map((c:any)=>{
          const b:any=byId.get(c.id)||{};
          return {customer_id:c.id,customer_name:c.name,customer_phone:c.phone||null,azna_balance_rial:b.azna_balance_rial??0,khorramabad_balance_rial:b.khorramabad_balance_rial??0,total_balance_rial:b.total_balance_rial??0,updated_at:b.updated_at??null};
        });
        return send({ok:true,source:"supabase",currency:"IRR",customer_balances:allCustomers});
      }
      const [unmatched,shipments,invoices]=await Promise.all([
        get("bank_transactions?select=id,bank_account_id,transaction_type,amount_rial,transaction_at,balance_after_rial,raw_message,customer_id,status,needs_clarification,accounting_category&status=eq.unmatched&order=transaction_at.desc&limit=100"),
        get("shipments?select=id,customer_id,greenhouse,quantity_bundles,shipped_at,status,declared_amount_rial,flower_truck,bucket_count&status=neq.cancelled&order=shipped_at.desc&limit=200"),
        get("invoices?select=shipment_id")
      ]);
      const invoiceShipments=new Set((invoices||[]).map((x:any)=>x.shipment_id));
      const shipments_without_invoice=(shipments||[]).filter((x:any)=>!invoiceShipments.has(x.id)).map((x:any)=>({...x,customer_name:names.get(x.customer_id)||"نامشخص"}));
      return send({ok:true,source:"supabase",currency:"IRR",customer_balances,unmatched_transactions:unmatched,shipments_without_invoice});
    }
    if(action==="delete_shipment") {
      const shipmentId=typeof body.shipment_id==="string"?body.shipment_id.trim():"";
      if(!shipmentId||shipmentId.length>160) return send({ok:false,error:"invalid_shipment_id"},400);
      const rows=await get("shipments?select=id,greenhouse,status,customer_id,quantity_bundles&id=eq."+encodeURIComponent(shipmentId)+"&limit=1");
      const shipment=Array.isArray(rows)?rows[0]:null;
      if(!shipment) return send({ok:false,error:"shipment_not_found"},404);
      if(!metadataAdmin&&!writeGreenhouses.has(String(shipment.greenhouse))) return send({ok:false,error:"greenhouse_access_denied"},403);
      const invoices=await get("invoices?select=id,shipment_id&shipment_id=eq."+encodeURIComponent(shipmentId)+"&limit=1");
      if(Array.isArray(invoices)&&invoices.length) return send({ok:false,error:"shipment_has_invoice_cannot_delete"},409);
      // Remove only the automatic issued-bucket ledger entries linked to this shipment.
      const linked=await get("driver_bucket_ledger?select=id,shipment_id,event_type,notes&shipment_id=eq."+encodeURIComponent(shipmentId));
      const ledgerRows=Array.isArray(linked)?linked:[];
      if(ledgerRows.some((x:any)=>x.event_type!=="issued"||String(x.notes||"").trim()!=="ثبت خودکار از بار"))
        return send({ok:false,error:"shipment_has_nonautomatic_bucket_ledger_cannot_delete",linked_ledger_count:ledgerRows.length},409);
      for(const entry of ledgerRows) {
        const ledDel=await fetch(BASE+"/rest/v1/driver_bucket_ledger?id=eq."+encodeURIComponent(String(entry.id)),{method:"DELETE",headers:{apikey:key,authorization:"Bearer "+key,Prefer:"return=minimal"}});
        if(!ledDel.ok) throw new Error("linked_bucket_ledger_delete_failed:"+ledDel.status+":"+await ledDel.text());
      }
      const linkedCheck=await get("driver_bucket_ledger?select=id&shipment_id=eq."+encodeURIComponent(shipmentId));
      if(Array.isArray(linkedCheck)&&linkedCheck.length) return send({ok:false,error:"linked_bucket_ledger_delete_verification_failed"},409);
      const del=await fetch(BASE+"/rest/v1/shipments?id=eq."+encodeURIComponent(shipmentId),{method:"DELETE",headers:{apikey:key,authorization:"Bearer "+key,Prefer:"return=minimal"}});
      if(!del.ok) throw new Error("shipment_delete_failed:"+del.status+":"+await del.text());
      const check=await get("shipments?select=id&id=eq."+encodeURIComponent(shipmentId)+"&limit=1");
      if(Array.isArray(check)&&check.length) return send({ok:false,error:"shipment_delete_verification_failed"},409);
      return send({ok:true,verified:true,deleted_shipment_id:shipmentId,deleted_linked_bucket_entries:ledgerRows.length});
    }
    if(action==="create_invoice_for_shipment") {
      const shipmentId=typeof body.shipment_id==="string"?body.shipment_id.trim():"";
      const amount=Number(body.amount_rial);
      if(!shipmentId || !Number.isSafeInteger(amount) || amount<=0) return send({ok:false,error:"invalid_invoice_input"},400);
      const shipments=await get("shipments?select=id,customer_id,greenhouse,quantity_bundles,shipped_at,status&id=eq."+encodeURIComponent(shipmentId)+"&limit=1");
      const shipment=Array.isArray(shipments)?shipments[0]:null;
      if(!shipment || shipment.status==="cancelled") return send({ok:false,error:"shipment_not_found_or_cancelled"},404);
      if(!metadataAdmin&&!writeGreenhouses.has(shipment.greenhouse)) return send({ok:false,error:"greenhouse_access_denied"},403);
      const existing=await get("invoices?select=id,shipment_id,amount_rial,status&shipment_id=eq."+encodeURIComponent(shipmentId)+"&limit=1");
      if(Array.isArray(existing)&&existing.length) return send({ok:false,error:"invoice_already_exists",invoice:existing[0]},409);
      const invoiceId="inv_"+shipmentId.replace(/^shp_/,"");
      const date=new Date(shipment.shipped_at);
      if(!Number.isFinite(date.getTime())) return send({ok:false,error:"invalid_shipment_date"},409);
      const invoiceDate=date.toISOString();
      const supervisorSubmission=!metadataAdmin&&accessRows.some((x:any)=>x.role==="supervisor");
      const invoiceStatus=supervisorSubmission?"pending":"received";
      const notes=(supervisorSubmission?"supervisor_submission: ":"")+"ثبت مبلغ از بخش بارهای بدون فاکتور؛ مبلغ کل "+String(amount)+" ریال؛ کارمزد صفر.";
      await post("invoices",{id:invoiceId,shipment_id:shipmentId,invoice_date:invoiceDate,amount_rial:amount,commission_rial:0,net_sales_rial:amount,status:invoiceStatus,notes});
      const verified=await get("invoices?select=id,shipment_id,invoice_date,amount_rial,commission_rial,net_sales_rial,status,notes&shipment_id=eq."+encodeURIComponent(shipmentId)+"&limit=1");
      const inv=Array.isArray(verified)?verified[0]:null;
      if(!inv||Number(inv.amount_rial)!==amount||inv.status!==invoiceStatus||inv.shipment_id!==shipmentId) return send({ok:false,error:"invoice_verification_failed",invoice:inv},409);
      const remaining=await get("invoices?select=id&shipment_id=eq."+encodeURIComponent(shipmentId)+"&limit=1");
      return send({ok:true,verified:true,invoice:inv,shipment_id:shipmentId,amount_rial:amount,remaining_invoice_linked:Array.isArray(remaining)&&remaining.length===1});
    }
    if(action==="delete_driver_bucket_ledger") {
 const ledgerId=typeof body.ledger_id==="string"?body.ledger_id.trim():"";
 if(!ledgerId||ledgerId.length>160)return send({ok:false,error:"invalid_ledger_id"},400);
 if(!metadataAdmin)return send({ok:false,error:"admin_only"},403);
 const found=await get("driver_bucket_ledger?select=id,event_type,shipment_id&id=eq."+encodeURIComponent(ledgerId)+"&limit=1");
 const row=Array.isArray(found)?found[0]:null;
 if(!row)return send({ok:false,error:"ledger_entry_not_found"},404);
 if(row.event_type!=="returned"||row.shipment_id)return send({ok:false,error:"only_manual_return_entries_can_be_deleted"},409);
 const del=await fetch(BASE+"/rest/v1/driver_bucket_ledger?id=eq."+encodeURIComponent(ledgerId),{method:"DELETE",headers:{apikey:key,authorization:"Bearer "+key,Prefer:"return=minimal"}});
 if(!del.ok)throw new Error("driver_bucket_ledger_delete_failed:"+del.status+":"+await del.text());
 const check=await get("driver_bucket_ledger?select=id&id=eq."+encodeURIComponent(ledgerId)+"&limit=1");
 if(Array.isArray(check)&&check.length)return send({ok:false,error:"delete_verification_failed"},409);
 return send({ok:true,verified:true,deleted_id:ledgerId});
}
if(action==="driver_bucket_ledger") {
 const [ledger,shipments,vendors]=await Promise.all([
  get("driver_bucket_ledger?select=id,greenhouse,driver_name,event_type,bucket_count,event_at,shipment_id,notes,created_at&order=event_at.desc&limit=10000"),
  get("shipments?select=greenhouse,flower_truck&order=shipped_at.desc&limit=10000"),
  get("vendors?select=name,flower_truck_driver,city,is_active&limit=5000")
 ]);
 const allowedRows=(Array.isArray(ledger)?ledger:[]).filter((r:any)=>allowedGreenhouses.has(r.greenhouse));
 const driverSet=new Map<string,{greenhouse:string,driver_name:string}>();
 for(const s of (Array.isArray(shipments)?shipments:[])) if(allowedGreenhouses.has(s.greenhouse)&&String(s.flower_truck||"").trim()) driverSet.set(s.greenhouse+"|"+String(s.flower_truck).trim(),{greenhouse:s.greenhouse,driver_name:String(s.flower_truck).trim()});
 for(const v of (Array.isArray(vendors)?vendors:[])) if(v.is_active!==false&&String(v.name||"").trim()==="آرمین امجدی"){const city=String(v.city||"").toLowerCase();const gh=city.includes("ازنا")?"azna":(city.includes("خرم")?"khorramabad":"");if(gh&&allowedGreenhouses.has(gh))driverSet.set(gh+"|"+String(v.name).trim(),{greenhouse:gh,driver_name:String(v.name).trim()});}
 for(const r of allowedRows) driverSet.set(r.greenhouse+"|"+String(r.driver_name).trim(),{greenhouse:r.greenhouse,driver_name:String(r.driver_name).trim()});
 const balances:any={};
 for(const r of allowedRows){const k=r.greenhouse+"|"+String(r.driver_name).trim();balances[k]=(balances[k]||0)+(r.event_type==="issued"?1:-1)*Number(r.bucket_count||0);}
 return send({ok:true,source:"supabase",rows:allowedRows,drivers:[...driverSet.values()].sort((a,b)=>a.driver_name.localeCompare(b.driver_name,"fa")),balances});
}
if(action==="create_driver_bucket_return") {
 const greenhouse=String(body.greenhouse||""),driverName=typeof body.driver_name==="string"?body.driver_name.trim():"",count=Number(body.bucket_count),rawDate=typeof body.returned_at_jalali==="string"?body.returned_at_jalali.trim():"",notes=typeof body.notes==="string"?body.notes.trim().slice(0,500):"";
 const match=rawDate.match(/^([0-9]{4})[\\/-]([0-9]{1,2})[\\/-]([0-9]{1,2})$/);
 if(!["azna","khorramabad"].includes(greenhouse)||(!metadataAdmin&&!writeGreenhouses.has(greenhouse))||driverName.length<1||driverName.length>120||!Number.isSafeInteger(count)||count<1||count>10000||!match)return send({ok:false,error:"invalid_driver_bucket_return_input"},400);
 const jy=Number(match[1]),jm=Number(match[2]),jd=Number(match[3]);
 if(jy<1300||jy>1500||jm<1||jm>12||jd<1||jd>(jm<=6?31:30))return send({ok:false,error:"invalid_jalali_date"},400);
 const g=jalaliToGregorian(jy,jm,jd),returnedAt=new Date(Date.UTC(g.year,g.month-1,g.day,12)).toISOString();
 const [drivers,vendors]=await Promise.all([get("shipments?select=flower_truck,greenhouse&greenhouse=eq."+encodeURIComponent(greenhouse)+"&limit=10000"),get("vendors?select=name,flower_truck_driver,city,is_active&limit=5000")]);
 const known=(Array.isArray(drivers)?drivers:[]).some((x:any)=>String(x.flower_truck||"").trim()===driverName)||(driverName==="آرمین امجدی"&&((Array.isArray(vendors)?vendors:[]).some((x:any)=>x.is_active!==false&&String(x.name||"").trim()===driverName&&((greenhouse==="azna"&&String(x.city||"").includes("ازنا"))||(greenhouse==="khorramabad"&&String(x.city||"").includes("خرم"))))));
 if(!known)return send({ok:false,error:"driver_not_found_for_greenhouse"},404);
 const id=crypto.randomUUID();
 await post("driver_bucket_ledger",{id,greenhouse,driver_name:driverName,event_type:"returned",bucket_count:count,event_at:returnedAt,shipment_id:null,notes:notes||null,created_by:String(claims.sub||"")});
 const verify=await get("driver_bucket_ledger?select=id,greenhouse,driver_name,event_type,bucket_count,event_at,shipment_id,notes,created_at&id=eq."+encodeURIComponent(id)+"&limit=1");
 if(!Array.isArray(verify)||verify.length!==1||verify[0].driver_name!==driverName||verify[0].event_type!=="returned"||Number(verify[0].bucket_count)!==count)return send({ok:false,error:"driver_bucket_return_verification_failed"},500);
 return send({ok:true,verified:true,row:verify[0]});
}
if(action==="returned_buckets") {
 const [rows,customers]=await Promise.all([get("returned_buckets?select=id,returned_at,greenhouse,customer_id,bucket_count,notes,created_by,created_at&order=returned_at.desc&limit=5000"),get("customers?select=id,name,phone,is_active&is_active=eq.true&order=name.asc&limit=2000")]);
 return send({ok:true,source:"supabase",rows:(Array.isArray(rows)?rows:[]).filter((r:any)=>allowedGreenhouses.has(r.greenhouse)),customers:customers||[]});
}
if(action==="create_returned_bucket") {
 const greenhouse=String(body.greenhouse||""),customerId=typeof body.customer_id==="string"?body.customer_id.trim():"",count=Number(body.bucket_count),rawDate=typeof body.returned_at_jalali==="string"?body.returned_at_jalali.trim():"",notes=typeof body.notes==="string"?body.notes.trim().slice(0,500):"";
 const match=rawDate.match(/^([0-9]{4})[\\/-]([0-9]{1,2})[\\/-]([0-9]{1,2})$/);
 if(!["azna","khorramabad"].includes(greenhouse)||(!metadataAdmin&&!writeGreenhouses.has(greenhouse))||!customerId||!Number.isSafeInteger(count)||count<1||count>10000||!match)return send({ok:false,error:"invalid_returned_bucket_input"},400);
 const jy=Number(match[1]),jm=Number(match[2]),jd=Number(match[3]);
 if(jy<1300||jy>1500||jm<1||jm>12||jd<1||jd>(jm<=6?31:30))return send({ok:false,error:"invalid_jalali_date"},400);
 const g=jalaliToGregorian(jy,jm,jd),returnedAt=new Date(Date.UTC(g.year,g.month-1,g.day,12)).toISOString();
 const customers=await get("customers?select=id,name,is_active&id=eq."+encodeURIComponent(customerId)+"&is_active=eq.true&limit=1");
 if(!Array.isArray(customers)||!customers.length)return send({ok:false,error:"customer_not_found"},400);
 const id=crypto.randomUUID();await post("returned_buckets",{id,returned_at:returnedAt,greenhouse,customer_id:customerId,bucket_count:count,notes:notes||null,created_by:String(claims.sub||"")});
 const verify=await get("returned_buckets?select=id,returned_at,greenhouse,customer_id,bucket_count,notes,created_at&id=eq."+encodeURIComponent(id)+"&limit=1");
 if(!Array.isArray(verify)||verify.length!==1||Number(verify[0].bucket_count)!==count)return send({ok:false,error:"returned_bucket_verification_failed"},500);
 return send({ok:true,verified:true,row:verify[0]});
}
if(action==="vendor_options") {
      if(!metadataAdmin && writeGreenhouses.size===0) return send({ok:false,error:"accountant_access_required"},403);
      const types=await get("vendor_types?select=id,name,is_builtin&order=name.asc&limit=500");
      const vendors=await get("vendors?select=id,name,phone,vendor_type,city,flower_truck_driver,notes,is_active,created_at&is_active=eq.true&order=name.asc&limit=1000");
      return send({ok:true,source:"supabase",vendor_types:types,vendors});
    }
    if(action==="create_vendor") {
      if(!metadataAdmin && writeGreenhouses.size===0) return send({ok:false,error:"accountant_access_required"},403);
      const name=typeof body.name==="string"?body.name.trim():"";
      const phone=typeof body.phone==="string"?body.phone.trim():"";
      const city=typeof body.city==="string"?body.city.trim():"";
      const notes=typeof body.notes==="string"?body.notes.trim():"";
      const flowerTruckDriver=typeof body.flower_truck_driver==="string"?body.flower_truck_driver.trim():"";
      let vendorType=typeof body.vendor_type==="string"?body.vendor_type.trim():"";
      const customType=typeof body.custom_type==="string"?body.custom_type.trim():"";
      if(name.length<2||name.length>160||phone.length>40||city.length>100||flowerTruckDriver.length>120||notes.length>1000) return send({ok:false,error:"invalid_vendor_input"},400);
      if(vendorType==="سایر") {
        if(customType.length<2||customType.length>80) return send({ok:false,error:"custom_vendor_type_required"},400);
        vendorType=customType;
      } else if(customType) return send({ok:false,error:"unexpected_custom_vendor_type"},400);
      if(vendorType.length<2||vendorType.length>80) return send({ok:false,error:"invalid_vendor_type"},400);
      const known=await get("vendor_types?select=name&name=eq."+encodeURIComponent(vendorType)+"&limit=1");
      if(!Array.isArray(known)||!known.length) {
        if(body.vendor_type!=="سایر") return send({ok:false,error:"vendor_type_not_in_list"},400);
      }
      if(body.vendor_type==="سایر" && (!Array.isArray(known)||!known.length)) {
        try { await post("vendor_types",{name:vendorType,is_builtin:false,created_by:String(claims.sub)}); }
        catch(e) {
          const again=await get("vendor_types?select=name&name=eq."+encodeURIComponent(vendorType)+"&limit=1").catch(()=>[]);
          if(!Array.isArray(again)||!again.length) throw e;
        }
      }
      const id="ven_"+crypto.randomUUID().replace(/-/g,"");
      await post("vendors",{id,name,phone:phone||null,city:city||null,flower_truck_driver:flowerTruckDriver||null,notes:notes||null,vendor_type:vendorType,is_active:true,created_by:String(claims.sub)});
      const rows=await get("vendors?select=id,name,phone,city,flower_truck_driver,notes,vendor_type,is_active,created_at&id=eq."+encodeURIComponent(id)+"&limit=1");
      const vendor=Array.isArray(rows)?rows[0]:null;
      if(!vendor||vendor.id!==id||vendor.name!==name||vendor.vendor_type!==vendorType) return send({ok:false,error:"vendor_verification_failed"},409);
      const syncedCustomer=await syncMarketSellerCustomer(vendor);
      const types=await get("vendor_types?select=id,name,is_builtin&order=name.asc&limit=500");
      return send({ok:true,verified:true,vendor,customer:syncedCustomer,customer_synced:!!syncedCustomer,vendor_types:types});
    }
    if(action==="update_vendor") {
      if(!metadataAdmin && writeGreenhouses.size===0) return send({ok:false,error:"accountant_access_required"},403);
      const id=typeof body.id==="string"?body.id.trim():"";
      const name=typeof body.name==="string"?body.name.trim():"";
      const phone=typeof body.phone==="string"?body.phone.trim():"";
      const city=typeof body.city==="string"?body.city.trim():"";
      const notes=typeof body.notes==="string"?body.notes.trim():"";
      const flowerTruckDriver=typeof body.flower_truck_driver==="string"?body.flower_truck_driver.trim():"";
      const vendorType=typeof body.vendor_type==="string"?body.vendor_type.trim():"";
      if(!id.startsWith("ven_")||name.length<2||name.length>160||phone.length>40||city.length>100||flowerTruckDriver.length>120||notes.length>1000||vendorType.length<2||vendorType.length>80) return send({ok:false,error:"invalid_vendor_input"},400);
      const known=await get("vendor_types?select=name&name=eq."+encodeURIComponent(vendorType)+"&limit=1");
      if(!Array.isArray(known)||!known.length) return send({ok:false,error:"vendor_type_not_in_list"},400);
      const current=await get("vendors?select=id&id=eq."+encodeURIComponent(id)+"&limit=1");
      if(!Array.isArray(current)||!current.length) return send({ok:false,error:"vendor_not_found"},404);
      const response=await fetch(BASE+"/rest/v1/vendors?id=eq."+encodeURIComponent(id),{method:"PATCH",headers:{"content-type":"application/json",apikey:key,authorization:"Bearer "+key,Prefer:"return=minimal"},body:JSON.stringify({name,phone:phone||null,city:city||null,flower_truck_driver:flowerTruckDriver||null,notes:notes||null,vendor_type:vendorType,updated_at:new Date().toISOString()})});
      if(!response.ok) return send({ok:false,error:"vendor_update_failed",detail:await response.text()},502);
      const rows=await get("vendors?select=id,name,phone,city,flower_truck_driver,notes,vendor_type,is_active,created_at&id=eq."+encodeURIComponent(id)+"&limit=1");
      const vendor=Array.isArray(rows)?rows[0]:null;
      if(!vendor||vendor.id!==id||vendor.name!==name||vendor.vendor_type!==vendorType) return send({ok:false,error:"vendor_update_verification_failed"},409);
      const syncedCustomer=await syncMarketSellerCustomer(vendor);
      return send({ok:true,verified:true,vendor,customer:syncedCustomer,customer_synced:!!syncedCustomer});
    }
    if(action==="monthly_sales_monitor") {
      const monthStart=typeof body.month_start==="string"?body.month_start.trim():"";
      const monthEnd=typeof body.month_end==="string"?body.month_end.trim():"";
      const iso=/^[0-9]{4}-[0-9]{2}-[0-9]{2}T00:00:00\+03:30$/;
      if(!iso.test(monthStart)||!iso.test(monthEnd)||monthEnd<=monthStart) return send({ok:false,error:"invalid_month_range"},400);
      const [invoices,shipments,customers]=await Promise.all([
        get("invoices?select=id,shipment_id,invoice_date,amount_rial,status&invoice_date=gte."+encodeURIComponent(monthStart)+"&invoice_date=lt."+encodeURIComponent(monthEnd)+"&status=in.(received,verified,pending)&order=invoice_date.asc&limit=5000"),
        get("shipments?select=id,customer_id,greenhouse,quantity_bundles,status&status=neq.cancelled&limit=5000"),
        get("customers?select=id,name")
      ]);
      const shipmentById=new Map((shipments||[]).map((x:any)=>[x.id,x]));
      const names=new Map((customers||[]).map((x:any)=>[x.id,x.name]));
      const entries=(invoices||[]).map((inv:any)=>{
        const sh:any=shipmentById.get(inv.shipment_id);
        if(!sh||!["azna","khorramabad"].includes(sh.greenhouse)||Number(sh.quantity_bundles||0)<=0) return null;
        return {invoice_id:inv.id,invoice_date:inv.invoice_date,customer_id:sh.customer_id,customer_name:names.get(sh.customer_id)||"نامشخص",greenhouse:sh.greenhouse,quantity_bundles:Number(sh.quantity_bundles||0),amount_rial:Number(inv.amount_rial||0),invoice_status:inv.status};
      }).filter(Boolean);
      return send({ok:true,source:"supabase",currency:"IRR",month_start:monthStart,entries});
    }
    if(action==="unmatched_transactions") {
      const [transactions,customers]=await Promise.all([
        get("bank_transactions?select=id,bank_account_id,transaction_type,amount_rial,transaction_at,balance_after_rial,reference_number,raw_message,customer_id,status,needs_clarification,clarification_question,accounting_category,accounting_scope,notes&status=eq.unmatched&order=transaction_at.asc&limit=200"),
        get("customers?select=id,name,is_active&is_active=eq.true&order=name.asc")
      ]);
      return send({ok:true,source:"supabase",currency:"IRR",transactions,customers});
    }
    const [shipments,invoices,customers]=await Promise.all([get("shipments?select=id,customer_id,greenhouse,quantity_bundles,shipped_at,status,declared_amount_rial&status=neq.cancelled&order=shipped_at.asc,id.asc&limit=500"),get("invoices?select=shipment_id"),get("customers?select=id,name,phone")]);
    const invoiced=new Set((invoices||[]).map((x:any)=>x.shipment_id));
    const names=new Map((customers||[]).map((x:any)=>[x.id,x.name]));
    const phones=new Map((customers||[]).map((x:any)=>[x.id,x.phone||null]));
    return send({ok:true,source:"supabase",currency:"IRR",shipments:(shipments||[]).filter((x:any)=>!invoiced.has(x.id)).map((x:any)=>({...x,customer_name:names.get(x.customer_id)||"نامشخص",customer_phone:phones.get(x.customer_id)||null,shipped_at_jalali:jalaliDateFromTimestamp(x.shipped_at)}))});
  } catch(e) { return send({ok:false,error:"accounting_operation_failed",detail:String(e)},502); }
});