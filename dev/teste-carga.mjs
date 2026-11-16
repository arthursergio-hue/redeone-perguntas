// Teste de carga no servidor publicado: N celulares no MESMO Wi-Fi (mesmo IP), todos ao mesmo tempo.
// Uso: REDEONE_PIN=xxxxxx node dev/teste-carga.mjs [celulares=300]
// Os dados de teste usam aparelhos "carga-…" e são apagados no fim (controle_zerar das duas palestras).
const FN = "https://kkhzmvcqcljptlntlmwm.supabase.co/functions/v1/redeone";
const ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtraHptdmNxY2xqcHRsbnRsbXdtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc1MzAwODIsImV4cCI6MjA5MzEwNjA4Mn0.D7-f7eagyQHvIGbTV6yyXAKB7uvp7gCmKUQA2mN2Naw";
const PIN = process.env.REDEONE_PIN;
const N = Number(process.argv[2] || 300);
if (!PIN) { console.error("Defina REDEONE_PIN"); process.exit(1); }

async function ir(b) {
  const t0 = performance.now();
  try {
    const r = await fetch(FN, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${ANON}`, apikey: ANON }, body: JSON.stringify({ evento: "ativo", ...b }) });
    const j = await r.json().catch(() => ({}));
    return { ms: performance.now() - t0, status: r.status, ok: r.ok && j.ok !== false, j };
  } catch (e) { return { ms: performance.now() - t0, status: 0, ok: false, j: { erro: String(e.message) } }; }
}
function resumo(nome, rs) {
  const ms = rs.map((r) => r.ms).sort((a, b) => a - b);
  const p = (q) => Math.round(ms[Math.min(ms.length - 1, Math.floor(q * ms.length))]);
  const falhas = rs.filter((r) => !r.ok);
  const porErro = {};
  for (const f of falhas) { const k = `${f.status}:${f.j.erro || "?"}`; porErro[k] = (porErro[k] || 0) + 1; }
  console.log(`${nome.padEnd(34)} ${String(rs.length - falhas.length).padStart(4)}/${rs.length} ok · mediana ${p(.5)} ms · 95% ${p(.95)} ms · pior ${Math.round(ms.at(-1))} ms${falhas.length ? " · falhas " + JSON.stringify(porErro) : ""}`);
  return falhas.length;
}
const todos = (n, f) => Promise.all(Array.from({ length: n }, (_, i) => f(i)));

let falhas = 0;
const original = await ir({ op: "listar", pin: PIN });
const ativoAntes = original.j.ativo;
await ir({ op: "estado" });                                                       // acorda o servidor
falhas += resumo(`1. ${N} abrem o QR ao mesmo tempo`, await todos(N, () => ir({ op: "estado" })));
falhas += resumo(`2. ${N} mandam pergunta juntos`, await todos(N, (i) => ir({ op: "enviar", texto: `Pergunta de carga número ${i} — pode apagar`, nome: i % 3 ? null : `Pessoa ${i}`, dispositivo: `carga-aparelho-${i}-x` })));
await ir({ op: "config", pin: PIN, cfg: { pergunta_pastor: "Pergunta de teste de carga", pastor_aberta: true } });
falhas += resumo(`3. ${N} respondem o pastor juntos`, await todos(N, (i) => ir({ op: "responder_pastor", texto: `Resposta de carga ${i}`, dispositivo: `carga-aparelho-${i}-x` })));
falhas += resumo(`4. telão + controle durante a carga`, await todos(20, (i) => ir(i % 2 ? { op: "telao" } : { op: "listar", pin: PIN })));
falhas += resumo(`5. ${N} consultam de novo (12 s)`, await todos(N, () => ir({ op: "estado" })));

// limpeza: só a palestra que estava no telão recebeu os testes
const z = await ir({ op: "zerar", pin: PIN });
await ir({ op: "config", pin: PIN, cfg: { pergunta_pastor: "", pastor_aberta: false } });
console.log(`limpeza: apagadas ${z.j.apagados?.perguntas} perguntas e ${z.j.apagados?.respostas} respostas da palestra ${ativoAntes}`);
process.exitCode = falhas ? 1 : 0;
