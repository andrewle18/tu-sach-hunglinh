(function(){
  var cat = window.CATALOG || [];
  var grid = document.getElementById('grid');
  var count = document.getElementById('count');
  count.textContent = cat.length + (cat.length===1?' cuốn':' cuốn');

  var iRead = '<svg viewBox="0 0 24 24"><path d="M12 6c-1.6-1.2-3.7-2-6-2H2v14h4c2.3 0 4.4.8 6 2 1.6-1.2 3.7-2 6-2h4V4h-4c-2.3 0-4.4.8-6 2Zm0 0v14"/></svg>';
  var iDown = '<svg viewBox="0 0 24 24"><path d="M12 3v13m0 0 5-5m-5 5-5-5M5 21h14"/></svg>';

  grid.innerHTML = cat.map(function(b){
    return '<article class="card">'
      + '<a class="cover" href="'+b.read+'"><img src="'+b.cover+'" alt="Bìa sách '+b.title+'" loading="lazy"></a>'
      + '<div class="body">'
      +   '<div class="kicker">'+(b.kicker||'Sách')+'</div>'
      +   '<h3>'+b.title+'</h3>'
      +   (b.subtitle?'<div class="sub">'+b.subtitle+'</div>':'')
      +   '<div class="meta"><b>'+b.chapters+'</b> chương · <b>'+b.words+'</b> từ · '+b.author+' · '+b.year+'</div>'
      +   '<p class="blurb">'+b.blurb+'</p>'
      +   '<div class="actions">'
      +     '<a class="btn primary" href="'+b.read+'">'+iRead+'Đọc online</a>'
      +     '<a class="btn ghost" href="'+b.epub+'" download>'+iDown+'EPUB</a>'
      +     (b.pdf?'<a class="btn ghost" href="'+b.pdf+'" download>'+iDown+'PDF</a>':'')
      +   '</div>'
      + '</div>'
    + '</article>';
  }).join('');
})();
