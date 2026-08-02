document.write('<script src="pilot-policy.js?v=16.0.1"><\/script>');
(()=>{const params=new URLSearchParams(location.search);const requested=params.get('view');const target=requested==='evaluation'?'evidence':requested;if(!target)return;window.addEventListener('load',()=>window.setTimeout(()=>document.querySelector(`[data-view="${target}"]`)?.click(),250));})();
