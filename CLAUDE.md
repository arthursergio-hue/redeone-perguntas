# Rede One · perguntas ao vivo no telão

Projeto **pessoal** do Arthur (ligado à igreja, não é da Seazone). App web para a plateia da conferência Rede One
mandar perguntas à palestrante pelo QR Code, anônimas ou com nome; elas aparecem no telão e o Arthur controla
pelo celular.

## Onde está cada coisa

- `PASSAGEM.md`: o plano aprovado em 16/11/2026 (três telas, extras, infra, o que falta).
- Telas: **Perguntar** (celular, sem login), **Telão** (banner + QR + cartões ao vivo), **Controle** (PIN do Arthur).

## Regras

- Responder em português, curto e visual; prova (print) de cada entrega com caminho completo.
- Supabase: o da igreja (MCP local `supabase`, projeto `kkhzmvcqcljptlntlmwm`), só no schema `redeone`.
  Não mexer nas tabelas do Selah (`C:\dev\pessoal\selah-app`). Sem projeto pago novo. Atenção à cota Free.
- Custo zero na hospedagem. Deploy, repositório e push só depois de mostrar ao Arthur.
- Git local: `Arthur Sérgio` / `arthur.sergio@seazone.com.br` (conta do GitHub a definir: `arthursergio-hue` ou `app-ibzs`).
- Não usar o padrão de projeto da Seazone nem as contas da Seazone aqui.
- Chaves (`.env*`) nunca impressas nem versionadas.
