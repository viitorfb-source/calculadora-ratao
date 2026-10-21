# Calculadora de Trocas, Liga Ratão

Ferramenta de consulta de trocas para a Liga Ratão Fantasy (ESPN, redraft) e para a liga dynasty com 10 keepers.

## Arquivos

- `index.html`: a ferramenta inteira.
- `api/hashtag.js`: função do Vercel que lê o ranking dynasty da Hashtag Basketball.
- `params.json`: parâmetros calibrados. A ferramenta lê este arquivo direto do GitHub, então uma recalibração vale sem novo deploy.
- `scripts/`: rotinas automáticas.
- `data/`: arquivos semanais e relatórios. Mudanças só nesta pasta não geram deploy no Vercel.

## Rotinas automáticas (GitHub Actions)

| Rotina | Quando | O que faz |
|---|---|---|
| Arquivo semanal | segundas-feiras | Salva o ranking da Hashtag e um resumo da ESPN em `data/snapshots` |
| Relatório mensal | dia 2 de cada mês | Compara o modelo com a Hashtag na temporada atual. Só acompanhamento |
| Recalibração anual | 5 de outubro | Refaz a calibração com o histórico da ESPN e atualiza `params.json` quando as travas permitem |

As três podem ser rodadas manualmente na aba **Actions**, com o botão **Run workflow**.

### Travas da recalibração

- Amostra mínima de 800 observações para a curva de idade, nível e durabilidade.
- O erro fora da amostra não pode piorar mais de 5% em relação à calibração anterior.
- A curva precisa ter forma coerente: frágeis rendem menos e reservas declinam depois dos 26 anos.
- Mudança máxima da curva de 10, 12, 15 e 25 pontos percentuais do primeiro ao quarto ano.
- O peso da Hashtag só muda com 10 ou mais arquivos semanais da temporada anterior, entre 10% e 40%, no máximo 10 pontos por ano.

Quando alguma trava segura um bloco, os parâmetros anteriores continuam valendo e a rotina abre um aviso em **Issues**. O relatório completo fica em `data/relatorios`.
