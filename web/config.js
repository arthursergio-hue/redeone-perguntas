// Configuração das telas. Em localhost usa o servidor de teste (dev/servidor.mjs);
// publicado, usa a Edge Function "redeone" do Supabase da igreja.
window.REDEONE = (() => {
  const local = ["localhost", "127.0.0.1"].includes(location.hostname);
  const SUPABASE_URL = "https://kkhzmvcqcljptlntlmwm.supabase.co";
  // Chave pública (anon). Ela não dá acesso às tabelas: o schema redeone não tem grant para anon.
  const ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtraHptdmNxY2xqcHRsbnRsbXdtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc1MzAwODIsImV4cCI6MjA5MzEwNjA4Mn0.D7-f7eagyQHvIGbTV6yyXAKB7uvp7gCmKUQA2mN2Naw";
  const params = new URLSearchParams(location.search);
  return {
    evento: params.get("evento") || (location.pathname.includes("dinamica") ? "rede-one-paulo" : "rede-one-2026"),
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

// Sobe o PDF da apresentação: pede um endereço de envio ao servidor (com PIN) e manda o arquivo.
window.redeoneSubirPdf = async function (arquivo, pin, aoProgresso) {
  const r = await redeoneApi("upload_url", { pin });
  if (!r.ok) throw new Error(r.erro || "servidor");
  aoProgresso?.("Enviando…");
  if (r.local) {
    const up = await fetch(r.envio, { method: "PUT", body: arquivo });
    if (!up.ok) throw new Error("upload");
  } else {
    const cli = window.supabase.createClient(REDEONE.supabaseUrl, REDEONE.anon);
    const { error } = await cli.storage.from("redeone").uploadToSignedUrl(r.caminho, r.token, arquivo, { contentType: "application/pdf" });
    if (error) throw error;
  }
  return r.publico;
};

// Leva para a tela certa conforme o tipo do evento (perguntas x dinâmica)
window.redeoneTelaCerta = function (modo, telaPerguntas, telaDinamica) {
  const aqui = location.pathname.split("/").pop() || "";
  const alvo = modo === "dinamica" ? telaDinamica : telaPerguntas;
  if (alvo && !aqui.startsWith(alvo.replace(".html", ""))) { location.replace(alvo + location.search); return true; }
  return false;
};
