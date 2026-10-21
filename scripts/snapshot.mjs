// Rotina semanal: salva o ranking da Hashtag e um resumo da ESPN para avaliar, no futuro,
// quem previu melhor e calibrar o peso da Hashtag.
// Uso: node scripts/snapshot.mjs   (variável SITE_URL opcional)
import fs from 'node:fs';
import path from 'node:path';
import {kona, getJSON, sub, perGame, fp, projFP, seasonNow} from './lib.mjs';

const SITE = process.env.SITE_URL || 'https://calculadora-ratao.vercel.app';
const S = seasonNow();
const today = new Date().toISOString().slice(0,10);
const params = JSON.parse(fs.readFileSync('params.json','utf8'));
const {PRIOR_GAMES:K, FORM15, FORM30} = params.season;

const compact = s => s && s.stats && s.stats['42']>0 ? {t:sub(s.stats), gp:s.stats['42']} : null;

async function espnSnapshot(){
  const filter = {players:{filterActive:{value:true}, limit:450, sortPercOwned:{sortPriority:1,sortAsc:false},
    filterStatsForTopScoringPeriodIds:{value:1, additionalValue:[`00${S}`,`10${S}`,`02${S}`,`03${S}`,`00${S-1}`]}}};
  const [j, g] = await Promise.all([kona(S, filter), getJSON(`https://lm-api-reads.fantasy.espn.com/apis/v3/games/fba/seasons/${S}`)]);
  const period = (g.currentScoringPeriod && g.currentScoringPeriod.id) || 1;
  const players = [];
  for(const e of j.players||[]){
    const p = e.player, st = p.stats||[], pick = id => compact(st.find(x=>x.id===id));
    const proj = pick(`10${S}`), cur = pick(`00${S}`), l15 = pick(`02${S}`), l30 = pick(`03${S}`), prev = pick(`00${S-1}`);
    // mesmo FPPG da ferramenta: projeção misturada com a temporada atual, mais a forma recente
    let base = proj ? projFP({proj}, prev) : (prev ? fp(perGame(prev.t, prev.gp)) : null);
    const curF = cur ? fp(perGame(cur.t, cur.gp)) : null, gp = cur ? cur.gp : 0;
    let model = base!=null && curF!=null ? (gp*curF + K*base)/(gp+K) : (curF!=null ? curF : base);
    if(model!=null){
      const b = model;
      if(l15 && l15.gp>=3) model += FORM15*(fp(perGame(l15.t,l15.gp)) - b);
      if(l30 && l30.gp>=5) model += FORM30*(fp(perGame(l30.t,l30.gp)) - b);
    }
    players.push({id:p.id, name:p.fullName, team:p.proTeamId, inj:p.injuryStatus||'ACTIVE',
      model: model==null ? null : Math.round(model*100)/100, projFP: base==null ? null : Math.round(base*100)/100,
      projGP: proj ? proj.gp : null, gp});
  }
  return {season:S, period, players};
}

async function hashtagSnapshot(){
  const j = await getJSON(`${SITE}/api/hashtag`, {}, 3);
  if(!j.ok) throw new Error('Hashtag: ' + j.error);
  return {updated:j.updated, type:j.type, horizon:j.horizon, picks:j.picks,
    players:j.players.map(p=>({rank:p.rank, name:p.name, team:p.team, age:p.age}))};
}

const errors = [];
let espn = null, hashtag = null;
try{ espn = await espnSnapshot(); }catch(e){ errors.push('ESPN: ' + e.message); }
try{ hashtag = await hashtagSnapshot(); }catch(e){ errors.push('Hashtag: ' + e.message); }
if(!espn && !hashtag){ console.error(errors.join('\n')); process.exit(1); }

const dir = path.join('data','snapshots',String(S));
fs.mkdirSync(dir, {recursive:true});
const file = path.join(dir, `${today}.json`);
fs.writeFileSync(file, JSON.stringify({date:today, espn, hashtag, errors}));
console.log(`Salvo ${file}: ${espn ? espn.players.length : 0} jogadores ESPN, ${hashtag ? hashtag.players.length : 0} no ranking.${errors.length ? ' Avisos: ' + errors.join('; ') : ''}`);
