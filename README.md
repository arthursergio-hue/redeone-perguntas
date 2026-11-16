# Rede One · perguntas ao vivo

App web para a **Conferência Rede One** (IBZS, sexta 20/11/2026, 15h).
Palestras: *Filhos: a fé começa em casa* (Pastor Pedro, evento `rede-one-2026`) e *Chamados para servir*
(Pastor Paulo, evento `rede-one-paulo`).

**Um QR Code e um telão para a conferência inteira:** sem `?evento=`, o celular e o telão seguem a palestra
marcada como **NO TELÃO** no controle. O Arthur troca de palestra pelo celular.

| Tela | Para quem | O que faz |
|---|---|---|
| `web/perguntar.html` | público (QR Code) | pergunta ao palestrante, anônima ou com nome (1 a cada 30 s). Quando o pastor abre a pergunta dele, aparece a aba **Responder o pastor** (abre sozinha), anônimo ou com nome (1 a cada 10 s). Filtro de palavrão |
| `web/telao.html` | projetor | **Imagem** (padrão): o banner da conferência (ou outra imagem subida na hora) grande, com as perguntas ao lado e o QR. **Slides**: o PDF no lugar da imagem, passador/setas (PIN uma vez). **Perguntas**: só os cartões. **Respostas**: a pergunta do pastor e o mural. **Pergunta inteira**: uma pergunta grande com o fundo desfocado. Visual em vidro com o banner desfocado ao fundo |
| `web/controle.html` | Arthur (PIN) | escolhe a palestra e põe no telão; aprovar, fixar, ocultar, respondida, desfazer, 📺 mostrar inteira; modo do telão (Imagem / Slides / Perguntas / Respostas); trocar a imagem na hora ou voltar ao banner oficial; ◀ ▶ com prévia e upload do PDF; ⚙️ apagar o ensaio da palestra; **pergunta do pastor**: escrever, abrir e mostrar, encerrar, ocultar respostas; CSV com perguntas e respostas |

As respostas à pergunta do pastor vão direto ao mural (sem aprovação); o Arthur oculta pelo controle se precisar.

A dinâmica de mesas (`web/dinamica*.html`, `dev/simular-dinamica.mjs`) ficou guardada sem uso: o Pastor Paulo
preferiu o papel, que faz parte da metodologia dele.

## Como funciona

- Páginas estáticas (sem build). `web/config.js` escolhe o servidor: em `localhost` usa o servidor de teste;
  publicado, usa a Edge Function `redeone` do Supabase da igreja.
- Banco: schema `redeone` (`supabase/migrations/001…004`). Público não tem acesso às tabelas; tudo passa pela
  Edge Function (`supabase/functions/redeone`). Um PIN para a conferência, só como hash, trava após 10 erros em
  10 min. PDFs no bucket público `redeone` (só PDF, até 50 MB), enviados por link assinado depois do PIN.
- Tempo real: broadcast do banco (`redeone:<evento>` e `redeone:ativo`) + consulta a cada 1,5–5 s.

## Rodar local

```bash
node dev/servidor.mjs
```

http://localhost:5174 (PIN local `1234`). `node dev/semear.mjs` põe perguntas de exemplo e confere as regras.
PDF de teste: `dev/exemplo-apresentacao.pdf`.

## No ar (desde 16/11/2026)

- Celular (QR Code): https://arthursergio-hue.github.io/redeone-perguntas/perguntar.html
- Telão: https://arthursergio-hue.github.io/redeone-perguntas/telao.html
- Controle: https://arthursergio-hue.github.io/redeone-perguntas/controle.html
- Site: GitHub Pages, publicado sozinho a cada push na `main` (`.github/workflows/pages.yml`).
- Servidor: Edge Function `redeone` no Supabase da igreja (publicar de novo após mudar `supabase/functions/redeone`).
- Capas das palestras: `capas/` (fundos feitos no Magnific; texto e fotos oficiais compostos à parte) e `web/capas/`.
