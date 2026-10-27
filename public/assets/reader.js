(function(){
  var qs = new URLSearchParams(location.search);
  var CAT = window.CATALOG||[];
  var slug = qs.get('book') || (CAT[0] && CAT[0].slug) || '';
  var meta = CAT.find(function(b){return b.slug===slug;}) || {};
  var LS = { get:function(k){try{return localStorage.getItem(k)}catch(e){return null}},
             set:function(k,v){try{localStorage.setItem(k,v)}catch(e){}} };

  // tải nội dung sách
  var sc = document.createElement('script');
  sc.src = meta.content || ('books/'+slug+'/content.js');
  sc.onload = init;
  sc.onerror = function(){ document.getElementById('scroller').innerHTML =
     '<p style="text-align:center;color:var(--rmuted)">Không tải được nội dung sách.</p>'; };
  document.head.appendChild(sc);

  var DIVIDER = '<div class="divider" aria-hidden="true">'
    + '<svg viewBox="0 0 32 32"><circle cx="16" cy="16" r="11"/><circle cx="16" cy="16" r="3"/><path d="M16 5v22M5 16h22M8.2 8.2 23.8 23.8M23.8 8.2 8.2 23.8"/></svg>'
    + '<svg viewBox="0 0 32 32"><path d="M16 4 27 23 5 23Z"/><path d="M16 28 5 9 27 9Z"/></svg>'
    + '<svg viewBox="0 0 32 32"><path d="M16 4v24M8 12h16"/></svg>'
    + '</div>';

  var units, idx=0;

  function init(){
    var B = window.BOOK; units = B.units;
    document.title = B.title + ' — đang đọc';
    document.getElementById('bookTitle').textContent = B.title;
    var de=document.getElementById('dlEpub'), dp=document.getElementById('dlPdf');
    if(meta.epub) de.href = meta.epub; else de.style.display='none';
    if(meta.pdf)  dp.href = meta.pdf;  else dp.style.display='none';

    buildToc();
    restorePrefs();

    var start = 0;
    var h = location.hash.replace('#','');
    if(h){ var f = units.findIndex(function(u){return u.id===h;}); if(f>=0) start=f; }
    else { var last = LS.get('pos:'+slug); if(last){ var g=units.findIndex(function(u){return u.id===last;}); if(g>=0) start=g; } }
    show(start, false);

    bindTools();
  }

  function buildToc(){
    var toc = document.getElementById('toc');
    var html='', curPart=null;
    units.forEach(function(u,i){
      if(u.part!==curPart){ curPart=u.part; html += '<h4>'+u.part+'</h4>'; }
      var cls = 'toc-link' + (u.kind==='intro'?' intro':'');
      var label = u.kind==='intro' ? 'Dẫn nhập' : u.title;
      html += '<a class="'+cls+'" data-i="'+i+'" href="#'+u.id+'">'+label+'</a>';
    });
    toc.innerHTML = html;
    toc.addEventListener('click', function(e){
      var a = e.target.closest('a'); if(!a) return;
      e.preventDefault(); show(parseInt(a.dataset.i,10)); closeToc();
    });
  }

  function show(i, push){
    if(i<0||i>=units.length) return;
    idx=i; var u=units[i];
    var eyebrow = u.kind==='intro' ? u.part : u.part;
    var titleHtml = u.kind==='intro'
      ? '<h1 class="ch-title">'+u.part.replace(' · ',' — ')+'</h1>'
      : '<div class="part-eyebrow">'+u.part+'</div><h1 class="ch-title">'+esc(u.title)+'</h1>';
    document.getElementById('scroller').innerHTML =
      titleHtml + DIVIDER + '<div class="content">'+u.html+'</div>';
    document.querySelector('.reading').scrollTop = 0;
    window.scrollTo(0,0);
    // active toc
    Array.prototype.forEach.call(document.querySelectorAll('.toc a'),function(a){
      a.classList.toggle('active', parseInt(a.dataset.i,10)===i);
      if(parseInt(a.dataset.i,10)===i) a.scrollIntoView({block:'nearest'});
    });
    renderNav();
    if(push!==false) history.replaceState(null,'','#'+u.id);
    else history.replaceState(null,'','#'+u.id);
    LS.set('pos:'+slug, u.id);
  }

  function renderNav(){
    var nav=document.getElementById('chnav'); var h='';
    if(idx>0){ var p=units[idx-1];
      h+='<a class="prev" data-i="'+(idx-1)+'" href="#'+p.id+'"><span class="lab">Trước</span>'+navLabel(p)+'</a>'; }
    else h+='<a class="prev disabled"></a>';
    if(idx<units.length-1){ var n=units[idx+1];
      h+='<a class="next" data-i="'+(idx+1)+'" href="#'+n.id+'"><span class="lab">Tiếp</span>'+navLabel(n)+'</a>'; }
    else h+='<a class="next disabled"></a>';
    nav.innerHTML=h;
    nav.querySelectorAll('a[data-i]').forEach(function(a){
      a.addEventListener('click',function(e){e.preventDefault();show(parseInt(a.dataset.i,10));});
    });
  }
  function navLabel(u){ return esc(u.kind==='intro'?u.part.replace(' · ',' — '):u.title); }

  // ----- công cụ: cỡ chữ, nền, mục lục -----
  var SIZES=[1.02,1.1,1.16,1.24,1.34,1.46], si=2;
  var THEMES=['light','sepia','dark'];
  function applyFs(){ document.documentElement.style.setProperty('--fs',SIZES[si]+'rem'); LS.set('fs',si); }
  function restorePrefs(){
    var f=LS.get('fs'); if(f!==null){ si=Math.max(0,Math.min(SIZES.length-1,parseInt(f,10))); }
    applyFs();
    var t=LS.get('read'); if(t&&THEMES.indexOf(t)>=0) document.documentElement.setAttribute('data-read',t);
  }
  function bindTools(){
    document.getElementById('fsUp').onclick=function(){ si=Math.min(SIZES.length-1,si+1); applyFs(); };
    document.getElementById('fsDown').onclick=function(){ si=Math.max(0,si-1); applyFs(); };
    document.getElementById('themeBtn').onclick=function(){
      var cur=document.documentElement.getAttribute('data-read');
      var nx=THEMES[(THEMES.indexOf(cur)+1)%THEMES.length];
      document.documentElement.setAttribute('data-read',nx); LS.set('read',nx);
    };
    document.getElementById('menuBtn').onclick=function(){ document.documentElement.setAttribute('data-toc','open'); };
    document.getElementById('scrim').onclick=closeToc;
    document.addEventListener('keydown',function(e){
      if(e.target.tagName==='INPUT') return;
      if(e.key==='ArrowRight') show(idx+1);
      if(e.key==='ArrowLeft') show(idx-1);
      if(e.key==='Escape') closeToc();
    });
  }
  function closeToc(){ document.documentElement.removeAttribute('data-toc'); }

  function esc(s){ return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
})();
