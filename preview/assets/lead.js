// טופס "חזרו אליי": שולח את הפנייה ל-CRM (טבלת leads ב-Supabase).
// המפתח ציבורי. ההרשאות במסד מאפשרות לאתר רק להוסיף ליד, לא לקרוא שום מידע.
(function () {
  var SUPA_URL = 'https://ilublhgawgfznxpdrfra.supabase.co';
  var f = document.getElementById('lead');
  if (!f) return;
  var KEY = f.getAttribute('data-k');
  var TEL = '0559992266', PHONE = '055-9992266';
  var msg = document.getElementById('lead-msg'), btn = document.getElementById('lead-btn');

  function v(id) { var el = document.getElementById(id); return el ? el.value.trim() : ''; }
  function esc(t) { return String(t).replace(/[&<>"']/g, function (c) { return '&#' + c.charCodeAt(0) + ';'; }); }
  function wa(n, ph, pe) {
    return 'https://api.whatsapp.com/send?phone=972559992266&text=' + encodeURIComponent(
      'שלום, הגעתי מאתר הדברה 360 (10% הנחה).\nשם: ' + n + '\nטלפון: ' + ph + '\nמזיק: ' + pe + '\nאשמח שתחזרו אליי.');
  }
  function err(html) { msg.style.color = '#B42318'; msg.innerHTML = html; }

  f.addEventListener('submit', function (e) {
    e.preventDefault();
    var n = v('lead-name'), ph = v('lead-phone'), pe = v('lead-pest');
    if (v('lead-hp')) return; // bot
    if (!n) return err('נא למלא שם');
    if (ph.replace(/\D/g, '').length < 9) return err('נא למלא מספר טלפון תקין');
    btn.disabled = true; btn.textContent = 'שולח...'; msg.textContent = '';

    var path;
    try { path = decodeURIComponent(location.pathname); } catch (_) { path = location.pathname; }
    path = path.replace(/^\/hadbara360-site/, '') || '/';

    fetch(SUPA_URL + '/rest/v1/leads', {
      method: 'POST',
      headers: { 'apikey': KEY, 'Authorization': 'Bearer ' + KEY, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
      body: JSON.stringify({
        name: n.slice(0, 80), phone: ph.slice(0, 20), pest: pe.slice(0, 60),
        page_path: path.slice(0, 300), page_title: document.title.slice(0, 200),
        referrer: (document.referrer || '').slice(0, 300)
      })
    }).then(function (r) {
      if (!r.ok) throw new Error(r.status);
      f.innerHTML =
        '<div class="t" style="flex:1 1 100%"><strong>תודה ' + esc(n) + '! קיבלנו את הפרטים ✓</strong>' +
        '<span>נחזור אליכם בהקדם. רוצים מענה מהיר יותר?</span></div>' +
        '<a class="btn btn-g" href="tel:' + TEL + '">חייגו עכשיו</a>' +
        '<a class="btn btn-n" target="_blank" rel="noopener" href="' + wa(n, ph, pe) + '">וואטסאפ</a>';
    }).catch(function () {
      btn.disabled = false; btn.textContent = 'חזרו אליי';
      msg.style.color = '#01344A';
      msg.innerHTML = 'לא הצלחנו לשלוח. <a href="' + wa(n, ph, pe) + '" target="_blank" rel="noopener">שלחו לנו בוואטסאפ</a> או חייגו <a href="tel:' + TEL + '">' + PHONE + '</a>';
    });
  });
})();
