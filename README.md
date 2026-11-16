# Rede One · perguntas ao vivo

App web para perguntas da plateia na **Conferência Rede One** (IBZS, sexta 20/11/2026, 15h).
Palestras: *Filhos: a fé começa em casa* (Pastor Pedro) e *Chamados para servir* (Pastor Paulo).

| Tela | Para quem | O que faz |
|---|---|---|
| `web/perguntar.html` | público (QR Code) | manda pergunta anônima ou com nome; 1 a cada 30 s; filtro de palavrão |
| `web/telao.html` | projetor | perguntas aprovadas ao vivo, pergunta fixada em destaque, QR Code, tela cheia (F) |
| `web/controle.html` | Arthur (PIN) | aprovar, fixar, ocultar, respondida, desfazer, chaves "aprovar antes" e "receber perguntas", ajustes, CSV |

## Como funciona

- Páginas estáticas (sem build). `web/config.js` escolhe o servidor: em `localhost` usa o servidor de teste;
  publicado, usa a Edge Function `redeone` do Supabase da igreja.
- Banco: schema `redeone` (migração em `supabase/migrations/001_redeone.sql`). Público não tem acesso às
  tabelas; tudo passa pela Edge Function (`supabase/functions/redeone`), que chama as funções SQL.
  O PIN fica só como hash (bcrypt) e trava após 10 erros em 10 min.
- Tempo real: o banco avisa por broadcast (`redeone:<evento>`); as telas também consultam a cada 2,5 s.

## Rodar local

```bash
node dev/servidor.mjs
```

Abre em http://localhost:5174 (PIN local `1234`). `node dev/semear.mjs` põe perguntas de exemplo e confere
as regras (espera, palavrão, repetida, curta, PIN).

## Falta para publicar

1. Publicar a Edge Function `redeone` (a trava de permissão da sessão barrou; precisa do OK do Arthur).
2. Hospedar `web/` de graça (GitHub Pages / Netlify) e conferir o QR Code com o endereço final.
