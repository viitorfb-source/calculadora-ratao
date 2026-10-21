// Recalibração anual automática. Refaz a calibração com o histórico da ESPN e só troca cada bloco
// de parâmetros quando a precisão fora da amostra não piora. Grava params.json e um relatório.
// Uso: node scripts/calibrate.mjs        Saída 0 = tudo certo; 2 = algum bloco recusado ou falhou (abre aviso).
import fs from 'node:fs';
import path from 'node:path';
import * as L from './lib.mjs';

const today = new Date().toISOString().slice(0,10);
const SNOW = L.seasonNow();          // temporada que está começando
const LAST = SNOW - 1;               // última temporada completa
const FIRST = LAST - 6;              // seis temporadas de origem para a curva de produção
const label = S => `${S-1}-${String(S).slice(2)}`;
const params = JSON.parse(fs.readFileSync('params.json','utf8'));
const P = {PROD_FPPG_CAP:32, DUR:{MIN:60, MAX:78, CENTER:65, SCALE:10}};  // forma fixa do modelo
const next = JSON.parse(JSON.stringify(params));
const rep = [`# Recalibração anual, ${today}`, '', `Histórico usado: temporadas ${label(FIRST-1)} a ${label(LAST)}.`, ''];
const decisions = [];
let problems = 0;
const mean = a => a.reduce((x,y)=>x+y,0)/a.length;
const log = (...a) => { console.log(...a); };

/* 1. Dados */
const TOT = {};
for(let S=FIRST-1; S<=LAST; S++){ TOT[S] = await L.seasonTotals(S); log(`Temporada ${label(S)}: ${Object.keys(TOT[S]).length} jogadores`); }
const ids = [...new Set(Object.values(TOT).flatMap(m=>Object.keys(m)))];
const AGES = await L.athleteAges(ids);
log(`Idades: ${Object.values(AGES).filter(a=>a.age!=null).length} de ${ids.length}`);

/* 2. Curva de produção futura do modo dynasty
   Os parâmetros atuais já viram quase todos estes dados, então compará-los com os novos seria desigual.
   As travas são: amostra mínima, erro fora da amostra do método igual ao do ano anterior, curva com forma
   coerente e mudança limitada em relação à curva em uso. */
const prodGrid = (C) => { const g = []; for(const age of [20,22,24,26,28,30,32,34]) for(const pf of [20,32]) for(const gN of [62,72]) for(const k of [1,2,3,4]) g.push({k, v:L.predict(C[k], {age, pf, gN}, P)}); return g; };
try{
  const obs = L.buildObservations(TOT, AGES, SNOW, FIRST, LAST);
  const neu = L.cvProd(obs, P, null);
  const mn = mean([1,2,3,4].map(k=>neu[k].rmse));
  const prevCv = params.meta && params.meta.cv_curva;
  const f = L.fitProd(obs, P);
  const C = f.PROD;
  const at = (k, age, pf, gN) => L.predict(C[k], {age, pf, gN}, P);
  const shapeOk = [1,2,3,4].every(k => C[k][4] > 0)                                   // frágeis rendem menos
    && at(1,22,20,72) >= 0.85 && at(1,22,20,72) <= 1.2                                  // jovem estável no ano seguinte
    && at(1,30,20,72) <= at(1,26,20,72) + 0.01                                          // reserva declina depois dos 26
    && [26,30,34].every(a => at(4,a,20,72) <= at(1,a,20,72) + 0.01);                    // declínio acumula com o tempo
  // limite de mudança por horizonte: o quarto ano tem menos amostra e varia mais entre calibrações
  const LIMIT = {1:0.10, 2:0.12, 3:0.15, 4:0.25};
  const g0 = prodGrid(params.keeper.PROD), g1 = prodGrid(C);
  const shifts = g1.map((x,i)=>({k:x.k, d:Math.abs(x.v - g0[i].v)}));
  const maxShift = Math.max(...shifts.map(x=>x.d));
  const overLimit = shifts.filter(x=>x.d > LIMIT[x.k]);
  rep.push('## Curva de idade, nível e durabilidade', '', `${obs.length} observações.`, '',
    '| Horizonte | Erro fora da amostra |', '|---|---|', ...[1,2,3,4].map(k=>`| +${k} ${k>1?'anos':'ano'} | ${neu[k].rmse} |`), '',
    `Erro médio: ${Math.round(mn)}${prevCv ? `, contra ${prevCv} na calibração anterior` : ''}. Maior mudança na curva: ${Math.round(maxShift*100)} pontos percentuais.`, '');
  if(obs.length < 800){ decisions.push('Curva mantida: amostra pequena.'); problems++; }
  else if(prevCv && mn > prevCv*1.05){ decisions.push(`Curva mantida: o erro do método piorou (${Math.round(mn)} contra ${prevCv}).`); problems++; }
  else if(!shapeOk){ decisions.push('Curva mantida: a curva nova tem forma incoerente.'); problems++; }
  else if(overLimit.length){ decisions.push(`Curva mantida: mudaria mais que o limite em ${overLimit.length} casos (limites de 10, 12, 15 e 25 pontos percentuais do primeiro ao quarto ano). Vale revisar o relatório.`); problems++; }
  else{
    next.keeper.PROD = f.PROD; next.keeper.SD_FUT = f.SD_FUT; next.keeper.DUR_MEAN = f.DUR_MEAN;
    next.meta.cv_curva = Math.round(mn);
    decisions.push(`Curva atualizada. Maior mudança: ${Math.round(maxShift*100)} pontos percentuais.`);
  }
}catch(e){ decisions.push('Curva mantida: falha no cálculo, ' + e.message); problems++; }

/* 3. Mistura entre projeção, temporada atual e forma; fatores de ausência */
let logsLast = null;
try{
  const A = await L.seasonLogs(LAST-1), B = await L.seasonLogs(LAST);
  logsLast = B;
  const sA = L.blendSamples(A, TOT[LAST-2] || {}), sB = L.blendSamples(B, TOT[LAST-1]);
  const s = params.season;
  const curErr = mean([L.blendError(sA, s.PRIOR_GAMES, s.FORM15, s.FORM30), L.blendError(sB, s.PRIOR_GAMES, s.FORM15, s.FORM30)]);
  const fA = L.fitBlend(sA), fB = L.fitBlend(sB);
  const newErr = mean([L.blendError(sB, fA.K, fA.a, fA.b), L.blendError(sA, fB.K, fB.a, fB.b)]);
  rep.push('## Projeção, temporada atual e forma recente', '',
    `Erro médio por jogo no restante da temporada. Atual: ${curErr.toFixed(2)}. Novo, ajustando numa temporada e testando na outra: ${newErr.toFixed(2)}.`, '');
  // os pesos atuais foram ajustados com parte destes dados, por isso a tolerância de 2%
  if(newErr <= curErr*1.02){
    const f = L.fitBlend([...sA, ...sB]);
    next.season.PRIOR_GAMES = f.K; next.season.FORM15 = f.a; next.season.FORM30 = f.b;
    decisions.push(`Mistura atualizada: peso da projeção ${f.K} jogos, forma ${Math.round(f.a*100)}% e ${Math.round(f.b*100)}%.`);
  }else{ decisions.push('Mistura mantida: os novos pesos não melhoraram a previsão fora da amostra.'); problems++; }

  const all = [...sA, ...sB];
  const fit = L.fitAbsence(all);
  const ec = L.absenceError(all, s.ABSENCE_FACTOR), en = fit.F.every(x=>x!=null) ? L.absenceError(all, fit.F) : null;
  rep.push('## Fatores de ausência', '', '| Jogos perdidos em sequência | Atual | Novo | Casos |', '|---|---|---|---|',
    ...['nenhum','1 a 2','3 a 5','6 a 10','11 a 20','mais de 20'].map((b,i)=>`| ${b} | ${s.ABSENCE_FACTOR[i]} | ${fit.F[i]} | ${fit.N[i]} |`), '');
  const okBins = fit.N.every(n=>n>=30) && fit.F.every(x=>x!=null && x>=0.5 && x<=1.3);
  if(okBins && en && Math.abs(en.bias) <= Math.abs(ec.bias) + 0.2 && en.mae <= ec.mae*1.005){
    next.season.ABSENCE_FACTOR = fit.F; decisions.push('Fatores de ausência atualizados.');
  }else{ decisions.push('Fatores de ausência mantidos: amostra insuficiente ou sem melhora.'); if(!okBins) problems++; }
}catch(e){ decisions.push('Mistura e ausências mantidas: falha no cálculo, ' + e.message); problems++; }

/* 4. Peso mínimo da Hashtag, com os arquivos semanais da última temporada */
try{
  const dir = path.join('data','snapshots',String(LAST));
  const snaps = fs.existsSync(dir) ? fs.readdirSync(dir).filter(f=>f.endsWith('.json')).sort().map(f=>JSON.parse(fs.readFileSync(path.join(dir,f),'utf8'))).filter(s=>s.espn && s.hashtag) : [];
  if(snaps.length < 10){ decisions.push(`Peso da Hashtag mantido: só ${snaps.length} arquivos semanais da temporada ${label(LAST)}, são necessários 10.`); }
  else{
    if(!logsLast) logsLast = await L.seasonLogs(LAST);
    const samples = L.hashtagSamples(snaps, Object.fromEntries(logsLast.map(p=>[p.id, p.logs])));
    const fit = L.fitHashtagWeight(samples);
    const curW = params.keeper.HB_MIN;
    const target = Math.min(0.4, Math.max(0.1, fit.best));
    const newW = Math.round(Math.min(curW+0.1, Math.max(curW-0.1, target))*100)/100;
    rep.push('## Peso mínimo da Hashtag', '', `${snaps.length} datas, ${samples.length} observações.`, '', '| Peso | Erro |', '|---|---|', ...fit.grid.map(g=>`| ${Math.round(g.w*100)}% | ${g.rmse} |`), '');
    next.keeper.HB_MIN = newW;
    decisions.push(newW===curW ? `Peso da Hashtag mantido em ${Math.round(curW*100)}%.` : `Peso da Hashtag de ${Math.round(curW*100)}% para ${Math.round(newW*100)}%, limitado a 10 pontos por ano.`);
  }
}catch(e){ decisions.push('Peso da Hashtag mantido: falha no cálculo, ' + e.message); problems++; }

/* 5. Gravação */
const changed = JSON.stringify(next.season) !== JSON.stringify(params.season) || JSON.stringify(next.keeper) !== JSON.stringify(params.keeper);
if(changed){
  next.meta = {calibrado_em: today, temporadas: `${label(FIRST-1)} a ${label(LAST)}`, origem: 'Recalibração anual automática', cv_curva: next.meta.cv_curva,
    historico: [...(params.meta.historico||[]), {data: params.meta.calibrado_em, temporadas: params.meta.temporadas, season: params.season, keeper: params.keeper}].slice(-5)};
  fs.writeFileSync('params.json', JSON.stringify(next, null, 2) + '\n');
}
rep.splice(4, 0, '## Decisões', '', ...decisions.map(d=>'- ' + d), '', changed ? 'Os parâmetros novos já estão em uso na ferramenta.' : 'Nenhum parâmetro mudou.', '');
fs.mkdirSync(path.join('data','relatorios'), {recursive:true});
fs.writeFileSync(path.join('data','relatorios', `recalibracao-${today.slice(0,4)}.md`), rep.join('\n') + '\n');
log(rep.join('\n'));
process.exit(problems ? 2 : 0);
