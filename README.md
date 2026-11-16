# Rede One · perguntas ao vivo

App web para a **Conferência Rede One** (IBZS, sexta 20/11/2026, 15h).
Palestras: *Filhos: a fé começa em casa* (Pastor Pedro) e *Chamados para servir* (Pastor Paulo).
Um QR Code só: a tela do celular muda sozinha conforme o evento (perguntas ou dinâmica).

## Palestra do Pastor Pedro (evento `rede-one-2026`)

| Tela | Para quem | O que faz |
|---|---|---|
| `web/perguntar.html` | público (QR Code) | pergunta anônima ou com nome; 1 a cada 30 s; filtro de palavrão |
| `web/telao.html` | projetor | **Perguntas**: cartões ao vivo, fixada em destaque, QR. **Apresentação**: os slides do PDF em tela cheia com a coluna de perguntas ao lado; passa pelo passador/setas (pede o PIN uma vez). **Pergunta inteira**: uma pergunta grande com o fundo desfocado |
| `web/controle.html` | Arthur (PIN) | aprovar, fixar, ocultar, respondida, desfazer; 📺 mostrar inteira; modo do telão; ◀ ▶ dos slides com prévia; subir o PDF; CSV |

## Dinâmica do Pastor Paulo (evento `rede-one-paulo`)

| Tela | Para quem | O que faz |
|---|---|---|
| `web/dinamica.html` | grupos (mesmo QR) | escolhe o grupo (1 a 4), vê a mesa da rodada e a pergunta, manda respostas, vê o que a mesa já recebeu |
| `web/dinamica-telao.html` | projetor | antes: QR grande; rodadas: 4 colunas (mesa, pergunta, grupo que está lá, respostas) + cronômetro; confronto: mesa por mesa, respostas × "o que o texto ensina" |
| `web/dinamica-controle.html` | Arthur (PIN) | começar / próxima rodada / pausar / +30 s / voltar; tempo por mesa; perguntas das mesas e pontos do texto; mesa do confronto; ocultar resposta; CSV |

Rodízio: na rodada *r* o grupo *g* fica na mesa `((g-1)+(r-1)) % 4 + 1` — cada grupo passa uma vez por mesa.

## Como funciona

- Páginas estáticas (sem build). `web/config.js` escolhe o servidor: em `localhost` usa o servidor de teste;
  publicado, usa a Edge Function `redeone` do Supabase da igreja.
- Banco: schema `redeone` (`supabase/migrations/001…` e `002…`). Público não tem acesso às tabelas; tudo passa
  pela Edge Function (`supabase/functions/redeone`). PIN só como hash, trava após 10 erros em 10 min.
  PDFs no bucket público `redeone` (só PDF, até 50 MB), enviados por link assinado depois do PIN.
- Tempo real: broadcast do banco (`redeone:<evento>`) + consulta a cada 1,5–2,5 s.

## Rodar local

```bash
node dev/servidor.mjs
```

http://localhost:5174 (PIN local `1234`). `node dev/semear.mjs` (perguntas de exemplo + regras) e
`node dev/simular-dinamica.mjs 5` (4 grupos, 4 rodadas e confronto). PDF de teste: `dev/exemplo-apresentacao.pdf`.

## Falta para publicar

1. Publicar a Edge Function `redeone` (a trava de permissão da sessão barrou; precisa do OK do Arthur).
2. Hospedar `web/` de graça (GitHub Pages / Netlify) e conferir o QR Code com o endereço final.
