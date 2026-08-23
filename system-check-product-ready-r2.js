(function () {
  'use strict';
  const GATEWAY = 'https://cbknucemarcpbscirzyv.supabase.co/functions/v1/dpro-estate-product-ready-r2-gateway';
  function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
  async function run(){
    const status=document.getElementById('productReadyR2Status');
    const box=document.getElementById('productReadyR2Json');
    status.textContent='確認中...'; status.className='status attention';
    try{
      const url=window.DPRO_ESTATE_CONFIG?.productReadyCheck || `${GATEWAY}/api/product-ready/check`;
      const r=await fetch(url,{headers:{Accept:'application/json'},cache:'no-store'});
      const d=await r.json();
      const ok=r.ok&&d.ok===true&&d.versions?.versionsAligned===true&&d.compatibility?.phoneNormalization===true&&d.compatibility?.serverPastDateGuard===true&&d.calendar?.exceptionModel===true&&d.calendar?.exceptionOverridesRegularHoliday===true&&d.staff?.signedSession===true&&d.staff?.ownerMutationAuthority===false&&d.staff?.auditTable===true&&d.line?.serverVerifiedLineIdentityCapability===true&&d.line?.phoneOnlyProduction===false&&d.line?.clientSuppliedIdentityAccepted===false;
      status.textContent=ok?'PRODUCT READY R2 基盤 OK':'要確認'; status.className=`status ${ok?'ok':'ng'}`;
      box.textContent=JSON.stringify(d,null,2);
    }catch(e){status.textContent='要確認';status.className='status ng';box.textContent=JSON.stringify({ok:false,error:String(e?.message||e)},null,2);}
  }
  function mount(){
    if(document.getElementById('productReadyR2Card')) return;
    const host=document.querySelector('main.wrap')||document.querySelector('main')||document.body;
    const card=document.createElement('section');
    card.className='card'; card.id='productReadyR2Card';
    card.innerHTML=`<h2>PRODUCT READY R2 確認</h2><div class="desc">Version整合・電話正規化・過去予約拒否・例外営業日・Staff権限/監査・LINE安全境界を読取専用で確認します。</div><div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:14px"><button class="btn" id="productReadyR2Run" type="button">PRODUCT READY確認</button><strong id="productReadyR2Status" class="status">未確認</strong></div><pre id="productReadyR2Json" style="margin-top:12px;max-height:360px;overflow:auto;white-space:pre-wrap;word-break:break-word;background:#f7faf9;border:1px solid #dce8e4;border-radius:12px;padding:12px;font-size:11px">{}</pre>`;
    host.insertBefore(card,host.firstChild);
    document.getElementById('productReadyR2Run').addEventListener('click',run);
    run().catch(()=>{});
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',mount); else mount();
}());
