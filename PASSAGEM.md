# Rede One — perguntas ao vivo no telão (passagem para a sessão nova)

Projeto pessoal do Arthur. Decisão tomada em 16/11/2026: **app web à parte** (não no app da igreja), sem instalar e sem login para o público.

## Três telas
1. **Perguntar** (celular, pelo QR Code): campo da pergunta, chave "anônimo / com meu nome", Enviar, confirmação. Sem login.
2. **Telão** (projetor, tela cheia): fundo = banner da conferência (provisório "Rede One" até chegar o banner), QR Code num canto, perguntas ao vivo em cartões grandes (máx. 4–5), animação suave, pergunta fixada em destaque.
3. **Controle** (celular do Arthur, com PIN): ✅ Respondida (sai do telão), 🙈 Ocultar, 📌 Fixar, chave "aprovar antes de aparecer" (ligada por padrão), exportar CSV no fim.

## Extras aprovados
Limite de 1 pergunta / 30 s por aparelho, filtro de palavrão, tempo real, celular + tela cheia, estados de erro e espera.

## Infra
- Custo zero. Supabase da igreja (MCP local `supabase`, projeto kkhzmvcqcljptlntlmwm), **schema próprio `redeone`**, sem tocar nas tabelas do app. Sem projeto pago novo.
- RLS: público só insere; telão lê só aprovadas/visíveis; controle validado no servidor (PIN).
- Hospedagem gratuita (Vercel/Netlify/GitHub Pages). Deploy e repositório (conta `arthursergio-hue`) só depois de mostrar ao Arthur.
- Git local: `Arthur Sérgio` / `arthur.sergio@seazone.com.br`.

## Situação em 16/11/2026 (fim da 1ª etapa)
- Feito: as três telas, schema `redeone` aplicado no Supabase da igreja (evento `rede-one-2026`, PIN em hash),
  Edge Function escrita (`supabase/functions/redeone`), servidor de teste local, fluxo completo testado e prints em `provas/`.
- Barrado: publicar a Edge Function (trava de permissão da sessão). Sem ela, o online ainda não funciona.
- Conferência: sexta 20/11/2026, 15h, IBZS (https://ibzonasul.org.br/evento/conferencia-rede-one).
  Banner oficial no storage da igreja (`evento-capas/e242eae2-…jpg`); paleta azul royal + dourado já aplicada.
  Palestras: Pastor Pedro (*Filhos: a fé começa em casa*, 45 min + 15 min de perguntas) e Pastor Paulo
  (*Chamados para servir*, em dinâmica).

## Pedidos novos do Arthur (16/11, tarde)
1. **Modo apresentação**: os pastores mandam o arquivo; os slides sobem pelo nosso sistema e rodam no telão
   (computador da igreja, não o do Arthur); as perguntas ficam sobrepostas; o Arthur destaca uma pergunta inteira
   com o fundo da apresentação desfocado, uma por vez.
2. **Dinâmica do Pastor Paulo** (áudio de 16/11): 4 mesas, cada uma com uma pergunta sobre serviço; a plateia em
   4 grupos faz o circuito, 2 min por mesa, cada grupo responde cada pergunta uma vez; o material fica com o Arthur
   e a Raquel; depois o texto bíblico e, no fim, o confronto do que se produziu com o que o texto ensina.
   O Arthur propôs trocar as cartolinas pelo celular, com as respostas na tela (Paulo ainda não respondeu).

## Situação em 16/11/2026 (fim da 2ª etapa)
- Feitos e testados no local: modo apresentação (PDF, slides pelo celular ou passador, coluna de perguntas,
  pergunta inteira com fundo desfocado) e a dinâmica do Pastor Paulo (3 telas). Migração 002 aplicada no Supabase
  (evento `rede-one-paulo` com o mesmo PIN, bucket `redeone`). Painel de prints: `provas/00-painel-entrega.png`.
- As 4 perguntas das mesas estão como "Pergunta da mesa N (o Pastor Paulo define)": trocar no controle da dinâmica.

## Situação em 16/11/2026 (3ª etapa)
- O Pastor Paulo vai usar papel branco na dinâmica (faz parte da metodologia). A palestra dele ficou igual à do
  Pastor Pedro (perguntas) + a **pergunta do pastor**: todos respondem pelo celular, anônimo ou com nome, e as
  respostas vão para o mural do telão. A dinâmica das mesas ficou guardada, sem uso.
- Novo: "palestra no telão" (um QR e um telão para a conferência; o Arthur troca no controle), PIN único.
- Migração 003 aplicada no Supabase. Edge Function e site ainda **não publicados** (Arthur disse "ainda não").

## Situação em 16/11/2026 (4ª etapa)
- Visual premium (vidro, dourado, banner desfocado ao fundo) nas telas do celular, telão e controle.
- Telão com 4 opções no controle: Imagem (banner oficial por padrão, trocável na hora), Slides, Perguntas e Respostas.
  As duas palestras começam em Imagem. Migração 004 aplicada (bucket aceita imagens, `controle_zerar`).
- Antes do evento: ⚙️ → "Apagar perguntas e respostas desta palestra" limpa o ensaio.

## Falta do Arthur
Nome do endereço (sugestão `redeone-perguntas`), arquivo das apresentações, as 4 perguntas do Pastor Paulo.

## Pronto =
Fluxo completo local (enviar → aprovar → aparece no telão → respondida → some), prints de cada tela com caminho completo, `CLAUDE.md` + `README.md` na pasta, registro pela skill `registrar-entrega`.
