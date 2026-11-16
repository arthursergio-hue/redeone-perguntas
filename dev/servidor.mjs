// Servidor de TESTE local: serve a pasta web/ e imita a Edge Function "redeone" em memória,
// com as mesmas regras do SQL (aprovação, 30 s por aparelho, palavrão, repetida, PIN, slides, dinâmica).
// Uso: node dev/servidor.mjs   →  http://localhost:5174   (PIN local: REDEONE_PIN ou 1234)
import { createServer } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

const PORTA = Number(process.env.PORT || 5174);
const AQUI = fileURLToPath(new URL(".", import.meta.url));
const RAIZ = join(AQUI, "..", "web");
const UPLOADS = join(AQUI, "uploads");
const PIN = process.env.REDEONE_PIN || "1234";

const base = { aprovar_antes: true, aberto: true, banner_url: null, telao_modo: "perguntas", slides_url: null,
  slides_total: null, slide_atual: 1, mostrar_perguntas_slides: true, destaque_id: null, rodada: 0, rodada_fim: null,
  rodada_pausa_s: null, duracao_s: 120, foco_mesa: null, grupos: 4, pergunta_pastor: "", pastor_aberta: false };
const eventos = new Map([
  ["rede-one-2026", { ...base, titulo: "Rede One", subtitulo: "Filhos: a fé começa em casa · Pastor Pedro", modo: "perguntas" }],
  ["rede-one-paulo", { ...base, titulo: "Rede One", subtitulo: "Chamados para servir · Pastor Paulo", modo: "perguntas" }],
]);
const mesas = new Map([["rede-one-paulo", [1, 2, 3, 4].map((n) => ({ numero: n, pergunta: `Pergunta da mesa ${n} (o Pastor Paulo define)`, texto_ensina: "" }))]]);
let ativo = "rede-one-2026";            // palestra que está no telão
const resolver = (id) => (id === "ativo" ? ativo : id);
const perguntas = [];
const respostas = [];
const agora = () => new Date().toISOString();

const PALAVROES = ("porra|caralho|caralhos|krl|crl|merda|merdas|bosta|bostas|foda|fodase|foda-se|fuder|foder|fodido|fodida|" +
  "fdp|pqp|puta|putas|puto|putaria|vagabunda|vagabundo|cacete|buceta|boceta|xoxota|xereca|piroca|" +
  "pau no cu|cu|cuzao|arrombado|arrombada|viado|sapatao|corno|corna|otario|otaria|idiota|imbecil|" +
  "babaca|retardado|retardada|desgracado|desgracada|filho da puta|filha da puta|vsf|vtnc|tnc|" +
  "vai se foder|vai tomar no cu|punheta|siririca|safado|safada|piranha|rapariga|escroto|escrota|" +
  "baitola|traveco|fuck|shit|bitch");
const RE_PALAVRAO = new RegExp(`(^|[^a-z])(${PALAVROES})([^a-z]|$)`);
const DE = "áàâãäéèêëíìîïóòôõöúùûüçñ@013457$", PARA = "aaaaaeeeeiiiiooooouuuucnaoieasts";
const normalizar = (t) => [...(t || "").toLowerCase()].map((c) => { const i = DE.indexOf(c); return i >= 0 ? PARA[i] : c; })
  .join("").replace(/(.)\1{2,}/g, "$1");
const temPalavrao = (t) => RE_PALAVRAO.test(normalizar(t));
const limpar = (t) => String(t ?? "").replace(/\s+/g, " ").trim();
const mesaDoGrupo = (g, r, n) => ((g - 1 + r - 1) % n) + 1;
const restante = (ev) => ev.rodada_pausa_s != null ? ev.rodada_pausa_s
  : ev.rodada_fim == null ? null : Math.max(0, Math.ceil((Date.parse(ev.rodada_fim) - Date.now()) / 1000));
const emSeg = (s) => new Date(Date.now() + s * 1000).toISOString();

function evPublico(ev) {
  const { aprovar_antes, destaque_id, rodada_fim, rodada_pausa_s, ...resto } = ev;
  return { ...resto, restante_s: restante(ev), pausada: ev.rodada_pausa_s != null };
}

function telao(id) {
  const ev = eventos.get(id); if (!ev) return null;
  const q = perguntas.filter((p) => p.evento_id === id && p.status === "aprovada")
    .sort((a, b) => (b.fixada - a.fixada) || ((b.aprovada_em || b.criada_em) > (a.aprovada_em || a.criada_em) ? 1 : -1))
    .slice(0, 12).map((p) => ({ id: p.id, texto: p.texto, nome: p.nome, fixada: p.fixada, quando: p.aprovada_em || p.criada_em }));
  const d = perguntas.find((p) => p.id === ev.destaque_id && p.evento_id === id && ["aprovada", "pendente"].includes(p.status));
  const rp = respostas.filter((r) => r.evento_id === id && r.mesa === 0 && !r.oculta);
  const out = { evento_id: id, evento: evPublico(ev), destaque: d ? { id: d.id, texto: d.texto, nome: d.nome } : null, perguntas: q,
    respostas_pastor: rp.slice(-60).reverse().map(({ id, texto, nome }) => ({ id, texto, nome })), total_respostas_pastor: rp.length };
  if (ev.modo === "dinamica") {
    out.mesas = (mesas.get(id) || []).map((m) => ({ ...m, texto_ensina: ev.rodada >= 5 ? m.texto_ensina : "" }));
    out.respostas = respostas.filter((r) => r.evento_id === id && r.mesa > 0 && !r.oculta).map(({ id, mesa, grupo, rodada, texto }) => ({ id, mesa, grupo, rodada, texto }));
  }
  return out;
}
function listar(id) {
  const ev = eventos.get(id);
  return {
    evento_id: id, ativo, eventos: [...eventos].map(([k, v]) => ({ id: k, subtitulo: v.subtitulo })),
    evento: { ...evPublico(ev), aprovar_antes: ev.aprovar_antes, destaque_id: ev.destaque_id },
    perguntas: perguntas.filter((p) => p.evento_id === id).slice().reverse().map(({ dispositivo, ...p }) => p),
    mesas: mesas.get(id) || [],
    respostas: respostas.filter((r) => r.evento_id === id).slice().reverse().map(({ dispositivo, ...r }) => r),
  };
}

function enviar(id, b) {
  const ev = eventos.get(id); if (!ev) return { ok: false, erro: "evento" };
  if (!ev.aberto) return { ok: false, erro: "fechado" };
  const txt = limpar(b.texto); let nm = limpar(b.nome) || null;
  if (txt.length < 3) return { ok: false, erro: "curta" };
  if (txt.length > 280) return { ok: false, erro: "longa" };
  if (nm) nm = nm.slice(0, 60);
  if (!/^[A-Za-z0-9-]{8,64}$/.test(b.dispositivo || "")) return { ok: false, erro: "dispositivo" };
  if (temPalavrao(txt) || temPalavrao(nm)) return { ok: false, erro: "palavrao" };
  const ultima = perguntas.filter((p) => p.dispositivo === b.dispositivo && p.evento_id === id).at(-1);
  if (ultima) {
    const falta = 30 - (Date.now() - Date.parse(ultima.criada_em)) / 1000;
    if (falta > 0) return { ok: false, erro: "espera", espera_s: Math.ceil(falta) };
  }
  if (perguntas.some((p) => p.evento_id === id && normalizar(p.texto) === normalizar(txt) && Date.now() - Date.parse(p.criada_em) < 600000))
    return { ok: false, erro: "repetida" };
  const p = { id: randomUUID(), evento_id: id, texto: txt, nome: nm, status: ev.aprovar_antes ? "pendente" : "aprovada",
    fixada: false, dispositivo: b.dispositivo, criada_em: agora(), aprovada_em: ev.aprovar_antes ? null : agora(), respondida_em: null };
  perguntas.push(p);
  return { ok: true, id: p.id, status: p.status };
}

function responder(id, b) {
  const ev = eventos.get(id);
  if (!ev || ev.modo !== "dinamica") return { ok: false, erro: "evento" };
  if (!ev.aberto) return { ok: false, erro: "fechado" };
  if (ev.rodada < 1 || ev.rodada > ev.grupos) return { ok: false, erro: "fora_rodada" };
  if (ev.rodada_pausa_s == null && ev.rodada_fim && Date.now() > Date.parse(ev.rodada_fim) + 15000) return { ok: false, erro: "tempo" };
  const g = Number(b.grupo);
  if (!(g >= 1 && g <= ev.grupos)) return { ok: false, erro: "grupo" };
  const txt = limpar(b.texto);
  if (txt.length < 2) return { ok: false, erro: "curta" };
  if (txt.length > 200) return { ok: false, erro: "longa" };
  if (!/^[A-Za-z0-9-]{8,64}$/.test(b.dispositivo || "")) return { ok: false, erro: "dispositivo" };
  if (temPalavrao(txt)) return { ok: false, erro: "palavrao" };
  const ultima = respostas.filter((r) => r.dispositivo === b.dispositivo && r.evento_id === id).at(-1);
  if (ultima) {
    const falta = 8 - (Date.now() - Date.parse(ultima.criada_em)) / 1000;
    if (falta > 0) return { ok: false, erro: "espera", espera_s: Math.ceil(falta) };
  }
  const m = mesaDoGrupo(g, ev.rodada, ev.grupos);
  respostas.push({ id: randomUUID(), evento_id: id, mesa: m, grupo: g, rodada: ev.rodada, texto: txt, dispositivo: b.dispositivo, oculta: false, criada_em: agora() });
  return { ok: true, mesa: m };
}

function responderPastor(id, b) {
  const ev = eventos.get(id); if (!ev) return { ok: false, erro: "evento" };
  if (!ev.pastor_aberta || !ev.pergunta_pastor) return { ok: false, erro: "pastor_fechada" };
  const txt = limpar(b.texto); let nm = limpar(b.nome) || null;
  if (txt.length < 2) return { ok: false, erro: "curta" };
  if (txt.length > 280) return { ok: false, erro: "longa" };
  if (nm) nm = nm.slice(0, 60);
  if (!/^[A-Za-z0-9-]{8,64}$/.test(b.dispositivo || "")) return { ok: false, erro: "dispositivo" };
  if (temPalavrao(txt) || temPalavrao(nm)) return { ok: false, erro: "palavrao" };
  const ultima = respostas.filter((r) => r.dispositivo === b.dispositivo && r.evento_id === id && r.mesa === 0).at(-1);
  if (ultima) { const falta = 10 - (Date.now() - Date.parse(ultima.criada_em)) / 1000; if (falta > 0) return { ok: false, erro: "espera", espera_s: Math.ceil(falta) }; }
  respostas.push({ id: randomUUID(), evento_id: id, mesa: 0, grupo: 0, rodada: 0, texto: txt, nome: nm, dispositivo: b.dispositivo, oculta: false, criada_em: agora() });
  return { ok: true };
}

function agir(id, pid, acao) {
  const ev = eventos.get(id);
  if (acao === "tirar_destaque") { ev.destaque_id = null; return; }
  if (acao === "ocultar_resposta" || acao === "mostrar_resposta") {
    const r = respostas.find((x) => x.id === pid && x.evento_id === id); if (r) r.oculta = acao === "ocultar_resposta"; return;
  }
  const p = perguntas.find((x) => x.id === pid && x.evento_id === id); if (!p) return;
  const tiraDestaque = () => { if (ev.destaque_id === pid) ev.destaque_id = null; };
  if (acao === "fixar") { perguntas.forEach((x) => { if (x.evento_id === id && x.id !== pid) x.fixada = false; }); p.fixada = true; p.status = "aprovada"; p.aprovada_em ||= agora(); }
  else if (acao === "desafixar") p.fixada = false;
  else if (acao === "aprovar") { p.status = "aprovada"; p.aprovada_em = agora(); }
  else if (acao === "responder") { p.status = "respondida"; p.fixada = false; p.respondida_em = agora(); tiraDestaque(); }
  else if (acao === "ocultar") { p.status = "oculta"; p.fixada = false; tiraDestaque(); }
  else if (acao === "pendente") { p.status = "pendente"; p.fixada = false; tiraDestaque(); }
  else if (acao === "destacar") { p.status = "aprovada"; p.aprovada_em ||= agora(); ev.destaque_id = pid; }
}

function rodada(id, acao) {
  const ev = eventos.get(id);
  if (acao === "iniciar") Object.assign(ev, { rodada: 1, rodada_fim: emSeg(ev.duracao_s), rodada_pausa_s: null, foco_mesa: null });
  else if (acao === "proxima") {
    if (ev.rodada >= ev.grupos) Object.assign(ev, { rodada: ev.grupos + 1, rodada_fim: null, rodada_pausa_s: null, foco_mesa: 1 });
    else Object.assign(ev, { rodada: ev.rodada + 1, rodada_fim: emSeg(ev.duracao_s), rodada_pausa_s: null });
  } else if (acao === "anterior") {
    const r = Math.max(ev.rodada - 1, 0);
    Object.assign(ev, { rodada: r, rodada_fim: r >= 1 && r <= ev.grupos ? emSeg(ev.duracao_s) : null, rodada_pausa_s: null, foco_mesa: null });
  } else if (acao === "mais30") {
    if (ev.rodada_pausa_s != null) ev.rodada_pausa_s += 30;
    else ev.rodada_fim = new Date(Math.max(Date.parse(ev.rodada_fim || agora()), Date.now()) + 30000).toISOString();
  } else if (acao === "pausar") { if (ev.rodada_pausa_s == null) Object.assign(ev, { rodada_pausa_s: restante(ev), rodada_fim: null }); }
  else if (acao === "retomar") Object.assign(ev, { rodada_fim: emSeg(ev.rodada_pausa_s || 0), rodada_pausa_s: null });
  else if (acao === "zerar") Object.assign(ev, { rodada: 0, rodada_fim: null, rodada_pausa_s: null, foco_mesa: null });
}

let pinAtual = PIN;
function api(b, origem) {
  const id = resolver(String(b.evento || ""));
  const ev = eventos.get(id);
  switch (b.op) {
    case "enviar": return [200, enviar(id, b)];
    case "responder_pastor": return [200, responderPastor(id, b)];
    case "responder": return [200, responder(id, b)];
    case "telao": { const t = telao(id); return t ? [200, { ok: true, ...t }] : [404, { ok: false, erro: "evento" }]; }
    case "entrar": case "listar": case "agir": case "config": case "slide": case "rodada": case "mesas": case "upload_url": case "ativar": {
      if (!ev) return [404, { ok: false, erro: "evento" }];
      if (String(b.pin || "") !== pinAtual) return [401, { ok: false, erro: "pin" }];
      if (b.op === "agir") agir(id, b.id, b.acao);
      if (b.op === "rodada") rodada(id, b.acao);
      if (b.op === "ativar" && eventos.has(b.alvo)) ativo = b.alvo;
      if (b.op === "slide") {
        const alvo = Number.isFinite(b.ir) ? b.ir : ev.slide_atual + (Number.isFinite(b.delta) ? b.delta : 0);
        ev.slide_atual = Math.min(Math.max(alvo, 1), Math.max(ev.slides_total || 1, 1));
      }
      if (b.op === "mesas" && Array.isArray(b.mesas)) {
        const lista = mesas.get(id) || [];
        for (const m of b.mesas) {
          const alvo = lista.find((x) => x.numero === Number(m.numero));
          const novo = { numero: Number(m.numero), pergunta: String(m.pergunta || "").slice(0, 200), texto_ensina: String(m.texto_ensina || "").slice(0, 1000) };
          if (alvo) Object.assign(alvo, novo); else lista.push(novo);
        }
        mesas.set(id, lista.sort((a, c) => a.numero - c.numero));
      }
      if (b.op === "upload_url") {
        const nome = `${id}-${Date.now()}.pdf`;
        return [200, { ok: true, local: true, caminho: nome, envio: `/upload/${nome}`, publico: `${origem}/uploads/${nome}` }];
      }
      if (b.op === "config") {
        const c = b.cfg || {};
        for (const k of ["aprovar_antes", "aberto", "mostrar_perguntas_slides", "pastor_aberta"]) if (typeof c[k] === "boolean") ev[k] = c[k];
        if ("pergunta_pastor" in c) ev.pergunta_pastor = limpar(c.pergunta_pastor).slice(0, 200);
        if (c.titulo) ev.titulo = c.titulo.slice(0, 80);
        if (c.subtitulo) ev.subtitulo = c.subtitulo.slice(0, 120);
        if ("banner_url" in c) ev.banner_url = c.banner_url || null;
        if (["perguntas", "apresentacao", "resposta"].includes(c.telao_modo)) ev.telao_modo = c.telao_modo;
        if ("slides_url" in c) { ev.slides_url = c.slides_url || null; ev.slides_total = c.slides_total || null; ev.slide_atual = 1; }
        if (Number.isFinite(c.duracao_s)) ev.duracao_s = Math.min(Math.max(c.duracao_s, 30), 1800);
        if ("foco_mesa" in c) ev.foco_mesa = c.foco_mesa;
        if (c.novo_pin && /^\d{4,12}$/.test(c.novo_pin)) pinAtual = c.novo_pin;
      }
      return [200, { ok: true, ...listar(id) }];
    }
    default: return [400, { ok: false, erro: "op" }];
  }
}

const TIPOS = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".svg": "image/svg+xml", ".webp": "image/webp", ".pdf": "application/pdf" };

createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const corpo = async () => { const p = []; for await (const c of req) p.push(c); return Buffer.concat(p); };
  if (url.pathname === "/api" && req.method === "POST") {
    let b; try { b = JSON.parse((await corpo()).toString("utf8")); } catch { b = {}; }
    const [st, j] = api(b, `http://${req.headers.host}`);
    res.writeHead(st, { "Content-Type": "application/json" }); return res.end(JSON.stringify(j));
  }
  if (url.pathname.startsWith("/upload/") && req.method === "PUT") {
    const nome = url.pathname.slice(8).replace(/[^a-z0-9.-]/gi, "");
    await mkdir(UPLOADS, { recursive: true });
    await writeFile(join(UPLOADS, nome), await corpo());
    res.writeHead(200, { "Content-Type": "application/json" }); return res.end('{"ok":true}');
  }
  let pasta = RAIZ, caminho = normalize(decodeURIComponent(url.pathname)).replace(/^[\\/]+/, "");
  if (caminho.startsWith("uploads")) { pasta = UPLOADS; caminho = caminho.replace(/^uploads[\\/]/, ""); }
  if (!caminho) caminho = "index.html";
  if (!extname(caminho)) caminho += ".html";
  const arq = join(pasta, caminho);
  if (!arq.startsWith(pasta)) { res.writeHead(403); return res.end(); }
  try {
    const dados = await readFile(arq);
    res.writeHead(200, { "Content-Type": TIPOS[extname(arq)] || "application/octet-stream", "Cache-Control": "no-store" });
    res.end(dados);
  } catch { res.writeHead(404); res.end("não encontrado"); }
}).listen(PORTA, () => console.log(`Rede One (teste local) em http://localhost:${PORTA}  ·  PIN local: ${PIN === "1234" ? "1234" : "(do REDEONE_PIN)"}`));
