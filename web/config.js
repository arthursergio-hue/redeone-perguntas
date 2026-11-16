// Configuração das telas. Em localhost usa o servidor de teste (dev/servidor.mjs);
// publicado, usa a Edge Function "redeone" do Supabase da igreja.
window.REDEONE = (() => {
  const local = ["localhost", "127.0.0.1"].includes(location.hostname);
  const SUPABASE_URL = "https://kkhzmvcqcljptlntlmwm.supabase.co";
  // Chave pública (anon). Ela não dá acesso às tabelas: o schema redeone não tem grant para anon.
  const ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtraHptdmNxY2xqcHRsbnRsbXdtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc1MzAwODIsImV4cCI6MjA5MzEwNjA4Mn0.D7-f7eagyQHvIGbTV6yyXAKB7uvp7gCmKUQA2mN2Naw";
  const params = new URLSearchParams(location.search);
  return {
    // sem ?evento= a tela segue "a palestra que está no telão agora" (o Arthur troca pelo controle)
    evento: params.get("evento") || (location.pathname.includes("dinamica") ? "rede-one-paulo" : "ativo"),
    eventoReal: null,
    chavePin: "redeone.pin",
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
  if (j.evento_id && j.evento_id !== c.eventoReal) { c.eventoReal = j.evento_id; window._redeoneTrocouEvento?.(); }
  return j;
};

// Avisa "mudou" em tempo real (broadcast do Supabase). Sempre há polling de reserva.
// Canais: o da palestra em uso e o "ativo" (avisa quando o Arthur troca a palestra do telão).
window.redeoneAoVivo = function (aoMudar, intervaloMs) {
  const c = window.REDEONE;
  let timer = setInterval(aoMudar, intervaloMs);
  if (!c.realtime || !window.supabase) return;
  try {
    const cli = window.supabase.createClient(c.supabaseUrl, c.anon);
    let canalEvento = null, conectados = 0;
    const conectou = (s) => {
      if (s === "SUBSCRIBED" && ++conectados >= 1) { clearInterval(timer); timer = setInterval(aoMudar, Math.max(intervaloMs, 8000)); }
    };
    cli.channel("redeone:ativo").on("broadcast", { event: "mudou" }, () => aoMudar()).subscribe(conectou);
    const assinar = () => {
      const id = c.eventoReal || (c.evento !== "ativo" ? c.evento : null);
      if (!id) return;
      if (canalEvento) cli.removeChannel(canalEvento);
      canalEvento = cli.channel(`redeone:${id}`).on("broadcast", { event: "mudou" }, () => aoMudar()).subscribe(conectou);
    };
    window._redeoneTrocouEvento = assinar;
    assinar();
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

// Visual: "Rede One" com o "One" dourado (como no banner) e o fundo desfocado com a imagem da palestra
window.redeoneMarca = function (el, titulo) {
  const t = String(titulo || "Rede One").trim();
  const i = t.lastIndexOf(" ");
  el.textContent = "";
  if (i < 0) { el.textContent = t; return; }
  el.appendChild(document.createTextNode(t.slice(0, i + 1)));
  const b = document.createElement("b"); b.textContent = t.slice(i + 1); el.appendChild(b);
};
window.redeoneFundo = function (url) {
  if (!url || window._redeoneFundoAtual === url) return;
  window._redeoneFundoAtual = url;
  document.documentElement.style.setProperty("--banner", `url("${String(url).replace(/"/g, "")}")`);
};

// Sobe arquivo (PDF ou imagem) para o bucket "redeone": pede um endereço com o PIN e envia
window.redeoneSubir = async function (arquivo, pin, aoProgresso) {
  const ext = (arquivo.name.split(".").pop() || "").toLowerCase();
  const r = await redeoneApi("upload_url", { pin, ext });
  if (!r.ok) throw new Error(r.erro || "servidor");
  aoProgresso?.("Enviando…");
  if (r.local) {
    const up = await fetch(r.envio, { method: "PUT", body: arquivo });
    if (!up.ok) throw new Error("upload");
  } else {
    const cli = window.supabase.createClient(REDEONE.supabaseUrl, REDEONE.anon);
    const { error } = await cli.storage.from("redeone").uploadToSignedUrl(r.caminho, r.token, arquivo, { contentType: arquivo.type || undefined });
    if (error) throw error;
  }
  return r.publico;
};
