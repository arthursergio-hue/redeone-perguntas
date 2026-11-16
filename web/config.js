// Configuração das telas. Em localhost usa o servidor de teste (dev/servidor.mjs);
// publicado, usa a Edge Function "redeone" do Supabase da igreja.
window.REDEONE = (() => {
  const local = ["localhost", "127.0.0.1"].includes(location.hostname);
  const SUPABASE_URL = "https://kkhzmvcqcljptlntlmwm.supabase.co";
  // Chave pública (anon). Ela não dá acesso às tabelas: o schema redeone não tem grant para anon.
  const ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtraHptdmNxY2xqcHRsbnRsbXdtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc1MzAwODIsImV4cCI6MjA5MzEwNjA4Mn0.D7-f7eagyQHvIGbTV6yyXAKB7uvp7gCmKUQA2mN2Naw";
  const params = new URLSearchParams(location.search);
  return {
    evento: params.get("evento") || "rede-one-2026",
    api: local && params.get("api") !== "real" ? "/api" : `${SUPABASE_URL}/functions/v1/redeone`,
    supabaseUrl: SUPABASE_URL,
    anon: ANON,
    realtime: !(local && params.get("api") !== "real"),
  };
})();

window.redeoneApi = async function (op, dados = {}) {
  const c = window.REDEONE;
  const r = await fetch(c.api, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${c.anon}`, apikey: c.anon },
    body: JSON.stringify({ op, evento: c.evento, ...dados }),
  });
  let j = null;
  try { j = await r.json(); } catch { /* sem corpo */ }
  if (!j) throw new Error("rede");
  return j;
};

// Avisa "mudou" em tempo real (broadcast do Supabase). Sempre há polling de reserva.
window.redeoneAoVivo = function (aoMudar, intervaloMs) {
  const c = window.REDEONE;
  let timer = setInterval(aoMudar, intervaloMs);
  if (!c.realtime || !window.supabase) return;
  try {
    const cli = window.supabase.createClient(c.supabaseUrl, c.anon);
    cli.channel(`redeone:${c.evento}`)
      .on("broadcast", { event: "mudou" }, () => aoMudar())
      .subscribe((s) => {
        if (s === "SUBSCRIBED") { clearInterval(timer); timer = setInterval(aoMudar, Math.max(intervaloMs, 10000)); }
      });
  } catch { /* fica no polling */ }
};
