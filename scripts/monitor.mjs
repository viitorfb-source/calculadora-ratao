// Relatório mensal: com os arquivos semanais da temporada, mede se o modelo ou a Hashtag
// previu melhor o FPPG do restante da temporada. Apenas acompanhamento, não altera parâmetros.
// Uso: node scripts/monitor.mjs
import fs from 'node:fs';
import path from 'node:path';
import {seasonNow, seasonLogs, hashtagSamples, fitHashtagWeight} from './lib.mjs';

const S = seasonNow();
const today = new Date().toISOString().slice(0,10);
const params = JSON.parse(fs.readFileSync('params.json','utf8'));
const dir = path.join('data','snapshots',String(S));
const cutoff = Date.now() - 21*864e5; // só datas com pelo menos 3 semanas de resultado depois

const snaps = fs.existsSync(dir) ? fs.readdirSync(dir).filter(f=>f.endsWith('.json')).sort()
  .map(f=>JSON.parse(fs.readFileSync(path.join(dir,f),'utf8')))
  .filter(s=>s.espn && s.hashtag && new Date(s.date).getTime() < cutoff) : [];

const lines = [`# Acompanhamento mensal, ${today}`, '', `Temporada ${S-1}-${String(S).slice(2)}. Peso mínimo da Hashtag em uso: ${Math.round(params.keeper.HB_MIN*100)}%.`, ''];
if(snaps.length < 2){
  lines.push(`Ainda há poucos arquivos semanais com resultado para comparar (${snaps.length}). O relatório fica disponível depois de algumas semanas de temporada.`);
}else{
  const players = await seasonLogs(S, 400);
  const logsById = Object.fromEntries(players.map(p=>[p.id, p.logs]));
  const samples = hashtagSamples(snaps, logsById);
  const fit = fitHashtagWeight(samples);
  lines.push(`Comparação em ${snaps.length} datas, ${samples.length} observações. Erro do FPPG previsto para o restante da temporada, por peso da Hashtag:`, '',
    '| Peso da Hashtag | Erro (RMSE) |', '|---|---|', ...fit.grid.map(g=>`| ${Math.round(g.w*100)}% | ${g.rmse} |`), '',
    `Melhor peso nesta amostra: ${Math.round(fit.best*100)}%.`, '',
    'Atenção: mede só a temporada atual, enquanto o valor dynasty olha 5 temporadas. Serve para acompanhamento. O peso só é alterado na recalibração anual, com a temporada completa.');
}
fs.mkdirSync(path.join('data','relatorios'), {recursive:true});
const out = path.join('data','relatorios', `mensal-${today.slice(0,7)}.md`);
fs.writeFileSync(out, lines.join('\n') + '\n');
console.log(lines.join('\n'));
