// Funções compartilhadas pelas rotinas automáticas da calculadora.
// Sem dependências: usa apenas fetch, disponível no Node 20 e nos navegadores.

export const SCORING = {0:1, 13:1, 14:-1, 15:1, 16:-1, 17:0.5, 4:0.5, 6:1, 3:1.5, 2:3, 1:2, 11:-1.5, 37:2, 38:3, 39:4};
export const KEEP = ['0','1','2','3','4','6','11','13','14','15','16','17','37','38','39','40','42'];
const ESPN = 'https://lm-api-reads.fantasy.espn.com/apis/v3/games/fba/seasons';
const ATHLETE = 'https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba/athletes';

export const fp = t => { let f = 0; for(const k in SCORING) f += SCORING[k]*(t[k]||0); return f; };
export const sub = s => { const o = {}; for(const k of KEEP) if(s[k] != null) o[k] = s[k]; return o; };
export const perGame = (t, gp) => { const a = {}; for(const k in t) a[k] = t[k]/gp; return a; };
// temporada em andamento ou próxima: a temporada 2026-27 tem id 2027
export const seasonNow = (d = new Date()) => d.getUTCMonth() >= 6 ? d.getUTCFullYear()+1 : d.getUTCFullYear();

export async function getJSON(url, opts = {}, tries = 3){
  let last;
  for(let i=0;i<tries;i++){
    try{
      const r = await fetch(url, opts);
      if(!r.ok) throw new Error(`HTTP ${r.status} em ${url.split('?')[0]}`);
      return await r.json();
    }catch(e){ last = e; await new Promise(res => setTimeout(res, 1500*(i+1))); }
  }
  throw last;
}
export const kona = (S, filter) => getJSON(`${ESPN}/${S}/segments/0/leaguedefaults/3?view=kona_player_info`, {headers:{'x-fantasy-filter':JSON.stringify(filter)}});

// totais e projeção de pré-temporada de uma temporada
export async function seasonTotals(S){
  const j = await kona(S, {players:{limit:700, sortPercOwned:{sortPriority:1,sortAsc:false}, filterStatsForTopScoringPeriodIds:{value:1, additionalValue:[`00${S}`,`10${S}`]}}});
  const m = {};
  for(const e of j.players||[]){
    const st = e.player.stats||[];
    const t = st.find(x=>x.id===`00${S}`), p = st.find(x=>x.id===`10${S}`);
    if(t && t.stats && t.stats['42']>0) m[e.player.id] = {name:e.player.fullName, t:sub(t.stats), gp:t.stats['42'],
      proj: p && p.stats && p.stats['42']>0 ? {t:sub(p.stats), gp:p.stats['42']} : null};
  }
  return m;
}

// boletins jogo a jogo dos jogadores mais relevantes de uma temporada
export async function seasonLogs(S, n = 400){
  const out = [];
  for(let off=0; off<n; off+=50){
    const j = await kona(S, {players:{filterActive:{value:true}, limit:50, offset:off, sortPercOwned:{sortPriority:1,sortAsc:false}, filterStatsForTopScoringPeriodIds:{value:200, additionalValue:[`10${S}`,`00${S}`]}}});
    for(const e of j.players||[]){
      const p = e.player, st = p.stats||[];
      const proj = st.find(x=>x.id===`10${S}`);
      out.push({id:p.id, name:p.fullName, pos:p.defaultPositionId,
        proj: proj && proj.stats && proj.stats['42']>0 ? {t:sub(proj.stats), gp:proj.stats['42']} : null,
        logs: st.filter(x=>x.statSplitTypeId===5 && x.seasonId===S).map(x=>[x.scoringPeriodId, (x.stats && x.stats['42']>0) ? sub(x.stats) : null]).sort((a,b)=>a[0]-b[0])});
    }
  }
  return out;
}

// idade atual pela ESPN, inclusive de quem saiu da liga
export async function athleteAges(ids, batch = 25){
  const out = {};
  for(let i=0;i<ids.length;i+=batch){
    await Promise.all(ids.slice(i,i+batch).map(async id => {
      try{ const j = await getJSON(`${ATHLETE}/${id}`, {}, 2); const a = j.athlete||{}; out[id] = {age:a.age??null, pos:a.position && a.position.abbreviation || null}; }
      catch(e){ out[id] = {age:null, pos:null}; }
    }));
  }
  return out;
}

// FPPG da projeção, preenchendo rebote ofensivo e double-doubles pela temporada anterior
export function projFP(cur, prev){
  if(!cur || !cur.proj) return null;
  const a = perGame(cur.proj.t, cur.proj.gp);
  const pv = prev && prev.gp>=10 ? perGame(prev.t, prev.gp) : null;
  if(a[4]==null) a[4] = pv && pv[6]>0 ? a[6]*pv[4]/pv[6] : (a[6]||0)*0.15;
  if(a[37]==null){ a[37] = pv ? pv[37]||0 : 0; a[38] = pv ? pv[38]||0 : 0; a[39] = pv ? pv[39]||0 : 0; }
  return fp(a);
}

/* ===================== ÁLGEBRA ===================== */
export function lsq(X, y){
  const n = X[0].length, A = Array.from({length:n},()=>new Array(n).fill(0)), b = new Array(n).fill(0);
  for(let i=0;i<y.length;i++) for(let j=0;j<n;j++){ b[j]+=X[i][j]*y[i]; for(let k=0;k<n;k++) A[j][k]+=X[i][j]*X[i][k]; }
  for(let i=0;i<n;i++){ let m=i; for(let r=i+1;r<n;r++) if(Math.abs(A[r][i])>Math.abs(A[m][i])) m=r; [A[i],A[m]]=[A[m],A[i]]; [b[i],b[m]]=[b[m],b[i]];
    for(let r=0;r<n;r++){ if(r===i) continue; const f=A[r][i]/A[i][i]; for(let k=i;k<n;k++) A[r][k]-=f*A[i][k]; b[r]-=f*b[i]; } }
  return b.map((v,i)=>v/A[i][i]);
}
export const pct95 = arr => { const v = [...arr].sort((a,b)=>a-b); return v[Math.floor(0.95*(v.length-1))]; };
export const round = (x, d=4) => Math.round(x*10**d)/10**d;

/* ===================== CURVA DE PRODUÇÃO FUTURA ===================== */
// mesma forma usada na ferramenta: c0 + c1·z + c2·z² + c3·max(0,z)·t + c4·g, com z ≥ 0 nunca aumentando a produção
export const zAge = a => (Math.min(38, Math.max(19, a)) - 26)/5;
export const tLev = (pf, cap) => (Math.min(cap, Math.max(12, pf)) - 22)/6;
export const gDur = (gN, D) => (Math.min(D.MAX, Math.max(D.MIN, gN)) - D.CENTER)/D.SCALE;
export const feats = (o, P) => { const z = zAge(o.age), t = tLev(o.pf, P.PROD_FPPG_CAP); return [1, z, z*z, Math.max(0,z)*t, gDur(o.gN, P.DUR)]; };
export function predict(c, o, P, g){
  const z = zAge(o.age), t = tLev(o.pf, P.PROD_FPPG_CAP), gg = g==null ? gDur(o.gN, P.DUR) : g;
  const raw = x => c[0] + c[1]*x + c[2]*x*x + c[3]*Math.max(0,x)*t + c[4]*gg;
  let r = raw(z);
  if(z>0){ const cand=[0,z]; if(c[2]>0){ const zv=-(c[1]+c[3]*t)/(2*c[2]); if(zv>0 && zv<z) cand.push(zv); } r = Math.min(...cand.map(raw)); }
  return Math.max(0.03, r);
}

// observações: para cada temporada S e jogador com projeção, a produção real de S+k em fração de projeção × 61 jogos
export function buildObservations(TOT, AGES, seasonNowId, firstS, lastOutcome){
  const p95 = {};
  for(let S=firstS; S<lastOutcome; S++){ const g = Object.values(TOT[S]||{}).filter(p=>p.proj).map(p=>p.proj.gp); if(g.length) p95[S] = pct95(g); }
  const obs = [];
  for(let S=firstS; S<lastOutcome; S++){
    for(const [id,p] of Object.entries(TOT[S]||{})){
      const a = AGES[id]; if(!a || a.age==null || !p.proj) continue;
      const pf = projFP(p, TOT[S-1] && TOT[S-1][id]); if(!pf || pf<12) continue;
      const r = [1,2,3,4].map(k => S+k<=lastOutcome ? ((TOT[S+k]&&TOT[S+k][id] ? fp(TOT[S+k][id].t) : 0)/(pf*61)) : null);
      obs.push({S, id, age:a.age-(seasonNowId-S), pf, gN:p.proj.gp/p95[S]*78, pos:a.pos, r});
    }
  }
  return obs;
}

// ajuste por mínimos quadrados ponderados e validação deixando uma temporada de fora
export function fitProd(obs, P){
  const C = {}, SD = {};
  const w = o => Math.sqrt(o.pf);
  for(const k of [1,2,3,4]){
    const tr = obs.filter(o=>o.r[k-1]!=null);
    C[k] = lsq(tr.map(o=>feats(o,P).map(v=>v*w(o))), tr.map(o=>o.r[k-1]*w(o))).map(v=>round(v));
    const L = lsq(tr.map(o=>[1, predict(C[k],o,P)*o.pf*61]), tr.map(o=>Math.abs(o.r[k-1]-predict(C[k],o,P))*o.pf*61*1.2533));
    SD[k] = [Math.round(L[0]), round(L[1],3)];
  }
  const gm = obs.reduce((s,o)=>s+gDur(o.gN,P.DUR)*o.pf,0)/obs.reduce((s,o)=>s+o.pf,0);
  return {PROD:C, SD_FUT:SD, DUR_MEAN:round(gm,2)};
}
export function cvProd(obs, P, fixedC){
  const seasons = [...new Set(obs.map(o=>o.S))];
  const res = {};
  for(const k of [1,2,3,4]){
    let se=0, n=0, seT=0, nT=0;
    for(const S of seasons){
      const te = obs.filter(o=>o.S===S && o.r[k-1]!=null); if(!te.length) continue;
      let c = fixedC && fixedC[k];
      if(!c){ const tr = obs.filter(o=>o.S!==S && o.r[k-1]!=null); if(tr.length<50) continue;
        c = lsq(tr.map(o=>feats(o,P).map(v=>v*Math.sqrt(o.pf))), tr.map(o=>o.r[k-1]*Math.sqrt(o.pf))); }
      for(const o of te){ const e = (predict(c,o,P)-o.r[k-1])*o.pf*61; se+=e*e; n++; if(o.pf>=24){ seT+=e*e; nT++; } }
    }
    res[k] = {rmse: n ? Math.round(Math.sqrt(se/n)) : null, rmseTitulares: nT ? Math.round(Math.sqrt(seT/nT)) : null, n};
  }
  return res;
}

/* ===================== MISTURA PROJEÇÃO, TEMPORADA E FORMA ===================== */
// pontos de corte ao longo da temporada; para cada um, o que se sabia antes e o que aconteceu depois
export function blendSamples(players, prevTot){
  const out = [];
  for(const p of players){
    if(!p.proj) continue;
    const P = projFP(p, prevTot[p.id]);
    const projAvail = Math.min(1, p.proj.gp/82);
    for(const c of [15,30,45,60,75,90,105]){
      const past = p.logs.filter(l=>l[0]<c), rest = p.logs.filter(l=>l[0]>=c);
      if(rest.length<10) continue;
      const pp = past.filter(l=>l[1]).map(l=>fp(l[1])), rp = rest.filter(l=>l[1]).map(l=>fp(l[1]));
      const win = d => past.filter(l=>l[1] && l[0]>=c-d).map(l=>fp(l[1]));
      const w15 = win(15), w30 = win(30);
      let streak = 0; for(let i=past.length-1;i>=0 && !past[i][1];i--) streak++;
      out.push({c, P, projAvail, gp:pp.length, M:pp.length ? pp.reduce((a,b)=>a+b,0)/pp.length : 0,
        L15: w15.length ? w15.reduce((a,b)=>a+b,0)/w15.length : 0, n15:w15.length,
        L30: w30.length ? w30.reduce((a,b)=>a+b,0)/w30.length : 0, n30:w30.length,
        y: rp.length ? rp.reduce((a,b)=>a+b,0)/rp.length : null, gR:rp.length, tR:rest.length, tP:past.length, streak});
    }
  }
  return out;
}
export const blendPredict = (s, K, a, b) => { const B = s.gp ? (s.gp*s.M + K*s.P)/(s.gp+K) : s.P; let p = B; if(s.n15>=3) p += a*(s.L15-B); if(s.n30>=5) p += b*(s.L30-B); return p; };
export function blendError(samples, K, a, b){
  let sa=0, w=0; for(const s of samples){ if(s.gR<10) continue; sa += Math.abs(blendPredict(s,K,a,b)-s.y)*s.gR; w += s.gR; }
  return w ? sa/w : null;
}
export function fitBlend(train){
  let best = null;
  for(const K of [4,6,8,10,12,15,20,25,30]) for(const a of [0,.05,.1,.15,.2,.25]) for(const b of [0,.05,.1,.15,.2]){
    const e = blendError(train, K, a, b); if(best==null || e<best.e) best = {K, a, b, e};
  }
  return best;
}

/* ===================== AUSÊNCIAS ===================== */
export const absenceBin = n => n===0?0 : n<=2?1 : n<=5?2 : n<=10?3 : n<=20?4 : 5;
export function fitAbsence(samples, AVAIL_PRIOR = 20){
  const blend = s => s.tP>0 ? Math.min(1, (s.gp + AVAIL_PRIOR*s.projAvail)/(s.tP + AVAIL_PRIOR)) : s.projAvail;
  const F = [], N = [];
  for(let b=0;b<6;b++){
    const g = samples.filter(s=>s.tR>=10 && s.tP>0 && absenceBin(s.streak)===b);
    const pred = g.reduce((a,s)=>a+blend(s)*s.tR,0);
    F.push(pred>0 ? round(g.reduce((a,s)=>a+s.gR,0)/pred, 2) : null); N.push(g.length);
  }
  return {F, N};
}
export function absenceError(samples, F, AVAIL_PRIOR = 20){
  const blend = s => s.tP>0 ? Math.min(1, (s.gp + AVAIL_PRIOR*s.projAvail)/(s.tP + AVAIL_PRIOR)) : s.projAvail;
  let a=0, n=0, bias=0;
  for(const s of samples){ if(s.tR<10 || s.tP<=0) continue; const e = blend(s)*s.tR*F[absenceBin(s.streak)] - s.gR; a+=Math.abs(e); bias+=e; n++; }
  return {mae: n ? a/n : null, bias: n ? bias/n : null};
}

/* ===================== HASHTAG CONTRA O MODELO ===================== */
const norm = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/\b(jr|sr|ii|iii|iv)\b\.?/g,'').replace(/[^a-z]/g,'');
// usa os arquivos semanais: em cada data, compara quem previu melhor o FPPG do restante da temporada
export function hashtagSamples(snapshots, logsById){
  const out = [];
  for(const snap of snapshots){
    const hb = new Map((snap.hashtag && snap.hashtag.players || []).map(h=>[norm(h.name), h.rank]));
    const day = snap.espn && snap.espn.period; if(!day) continue;
    const rows = [];
    for(const p of snap.espn.players){
      if(p.model==null) continue;
      const logs = logsById[p.id]; if(!logs) continue;
      const rest = logs.filter(l=>l[0]>=day && l[1]).map(l=>fp(l[1]));
      if(rest.length<10) continue;
      rows.push({model:p.model, hbRank:hb.get(norm(p.name)) || null, y:rest.reduce((a,b)=>a+b,0)/rest.length, n:rest.length});
    }
    // posição no ranking externo convertida para a escala do modelo
    const scale = rows.map(r=>r.model).sort((a,b)=>b-a);
    for(const r of rows) if(r.hbRank) out.push({date:snap.date, model:r.model, hb:scale[Math.min(scale.length-1, r.hbRank-1)], y:r.y, n:r.n});
  }
  return out;
}
export function fitHashtagWeight(samples){
  const err = w => { let s=0, n=0; for(const x of samples){ const e = (1-w)*x.model + w*x.hb - x.y; s += e*e*x.n; n += x.n; } return Math.sqrt(s/n); };
  const grid = [0,.05,.1,.15,.2,.25,.3,.35,.4,.45,.5].map(w=>({w, rmse:round(err(w),2)}));
  const best = grid.reduce((a,b)=>b.rmse<a.rmse?b:a);
  return {best:best.w, grid};
}
