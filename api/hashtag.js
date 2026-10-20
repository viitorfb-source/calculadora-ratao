// Função serverless do Vercel: lê o ranking dynasty da Hashtag Basketball
// no filtro Points Leagues, horizonte de 5 temporadas, top 500, e devolve JSON.
// Resposta em cache na borda por 12 horas.

const URL_HB = 'https://hashtagbasketball.com/fantasy-basketball-dynasty-rankings';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

function decodeEntities(s) {
  return String(s)
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
}

function hiddenField(html, name) {
  const esc = name.replace(/[$]/g, '\\$');
  const m = html.match(new RegExp('name="' + esc + '"[^>]*value="([^"]*)"'))
         || html.match(new RegExp('value="([^"]*)"[^>]*name="' + esc + '"'));
  return m ? decodeEntities(m[1]) : '';
}

function parseHB(html) {
  const strip = s => decodeEntities(String(s).replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
  const updM = strip(html.slice(0, 400000)).match(/Updated:\s*(\d{1,2}\s+[A-Za-z]+\s+\d{4})/);
  const chunks = html.split('class="card dyn-card"').slice(1);
  const players = [], picks = [];
  for (const c of chunks) {
    const rank = +((c.match(/class="dyn-rank">\s*(\d+)/) || [])[1]);
    const nameRaw = (c.match(/class="dyn-name">([\s\S]*?)<span/) || c.match(/class="dyn-name">([^<]+)/) || [])[1] || '';
    const name = strip(nameRaw);
    if (!rank || !name) continue;
    const meta = (c.match(/class="dyn-meta">([\s\S]*?)<\/div>/) || [])[1] || '';
    const badges = [...meta.matchAll(/badge-light-secondary">([^<]*)</g)].map(m => strip(m[1]));
    const ageTxt = badges.pop() || '', team = badges.pop() || '';
    const pm = name.match(/^(\d{4})\s+Draft\s+\(Pick\s+(\d+)(?:\s*-\s*(\d+))?\)/i);
    if (pm) { picks.push({ rank, year: +pm[1], from: +pm[2], to: +(pm[3] || pm[2]) }); continue; }
    const age = parseFloat(ageTxt);
    players.push({ rank, name, team, pos: badges.filter(Boolean), age: isNaN(age) ? null : age });
  }
  return { updated: updM ? updM[1] : null, players, picks };
}

async function fetchRanking() {
  // 1. leitura inicial para obter os campos do formulário e o cookie de sessão
  const r1 = await fetch(URL_HB, { headers: { 'User-Agent': UA, 'Accept': 'text/html' } });
  if (!r1.ok) throw new Error('GET ' + r1.status);
  const html1 = await r1.text();
  const setCookie = typeof r1.headers.getSetCookie === 'function' ? r1.headers.getSetCookie() : [r1.headers.get('set-cookie')].filter(Boolean);
  const cookie = setCookie.map(c => c.split(';')[0]).join('; ');

  // 2. envio do formulário com os filtros desejados
  const body = new URLSearchParams();
  body.set('__EVENTTARGET', 'ctl00$ContentPlaceHolder1$DDFORECAST');
  body.set('__EVENTARGUMENT', '');
  body.set('__LASTFOCUS', '');
  for (const n of ['__VIEWSTATE', '__VIEWSTATEGENERATOR', '__EVENTVALIDATION']) body.set(n, hiddenField(html1, n));
  body.set('ctl00$ContentPlaceHolder1$DDSTAT', '500');
  body.set('ctl00$ContentPlaceHolder1$DDTYPE', 'POINT');
  body.set('ctl00$ContentPlaceHolder1$DDFORECAST', '5');
  body.set('ctl00$ContentPlaceHolder1$DDPOS', 'All');
  body.set('ctl00$ContentPlaceHolder1$DDPOSFROM', '1');
  body.set('ctl00$ContentPlaceHolder1$DDTSUM', 'All');
  const r2 = await fetch(URL_HB, {
    method: 'POST',
    headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded', 'Referer': URL_HB, ...(cookie ? { Cookie: cookie } : {}) },
    body: body.toString()
  });
  if (!r2.ok) throw new Error('POST ' + r2.status);
  const html2 = await r2.text();
  const type = (html2.match(/DDTYPE"[\s\S]{0,800}?selected="selected" value="([A-Z]+)"/) || [])[1] || null;
  const horizon = (html2.match(/DDFORECAST"[\s\S]{0,400}?selected="selected" value="(\d)"/) || [])[1] || null;
  const parsed = parseHB(html2);
  return { ...parsed, type, horizon };
}

module.exports = async (req, res) => {
  try {
    const data = await fetchRanking();
    if (data.players.length < 100) throw new Error('leitura incompleta, ' + data.players.length + ' jogadores');
    res.setHeader('Cache-Control', 's-maxage=43200, stale-while-revalidate=86400');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.status(200).json({ ok: true, source: URL_HB, fetchedAt: new Date().toISOString(), ...data });
  } catch (e) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(502).json({ ok: false, error: String(e && e.message || e) });
  }
};

module.exports.parseHB = parseHB;
module.exports.hiddenField = hiddenField;
