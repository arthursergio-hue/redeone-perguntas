// Servidor de TESTE local: serve a pasta web/ e imita a Edge Function "redeone" em memória,
// com as mesmas regras do SQL (aprovação, 30 s por aparelho, palavrão, repetida, PIN).
// Uso: node dev/servidor.mjs   →  http://localhost:5174   (PIN local: REDEONE_PIN ou 1234)
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

const PORTA = Number(process.env.PORT || 5174);
const RAIZ = join(fileURLToPath(new URL(".", import.meta.url)), "..", "web");
const PIN = process.env.REDEONE_PIN || "1234";

const eventos = new Map([["rede-one-2026", {
  titulo: "Rede One", subtitulo: "Filhos: a fé começa em casa · Pastor Pedro", aprovar_antes: true, aberto: true, banner_url: null,
}]]);
const perguntas = [];
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

function telao(id) {
  const ev = eventos.get(id); if (!ev) return null;
  const q = perguntas.filter((p) => p.evento_id === id && p.status === "aprovada")
    .sort((a, b) => (b.fixada - a.fixada) || ((b.aprovada_em || b.criada_em) > (a.aprovada_em || a.criada_em) ? 1 : -1))
    .slice(0, 12).map((p) => ({ id: p.id, texto: p.texto, nome: p.nome, fixada: p.fixada, quando: p.aprovada_em || p.criada_em }));
  return { evento: { titulo: ev.titulo, subtitulo: ev.subtitulo, banner_url: ev.banner_url, aberto: ev.aberto }, perguntas: q };
}
function listar(id) {
  const ev = eventos.get(id);
  return { evento: { ...ev }, perguntas: perguntas.filter((p) => p.evento_id === id).slice().reverse()
    .map(({ dispositivo, ...p }) => p) };
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

function agir(id, pid, acao) {
  const p = perguntas.find((x) => x.id === pid && x.evento_id === id); if (!p) return;
  if (acao === "fixar") { perguntas.forEach((x) => { if (x.evento_id === id && x.id !== pid) x.fixada = false; }); p.fixada = true; p.status = "aprovada"; p.aprovada_em ||= agora(); }
  else if (acao === "desafixar") p.fixada = false;
  else if (acao === "aprovar") { p.status = "aprovada"; p.aprovada_em = agora(); }
  else if (acao === "responder") { p.status = "respondida"; p.fixada = false; p.respondida_em = agora(); }
  else if (acao === "ocultar") { p.status = "oculta"; p.fixada = false; }
  else if (acao === "pendente") { p.status = "pendente"; p.fixada = false; }
}

let pinAtual = PIN;
function api(b) {
  const id = String(b.evento || "");
  switch (b.op) {
    case "enviar": return [200, enviar(id, b)];
    case "telao": { const t = telao(id); return t ? [200, { ok: true, ...t }] : [404, { ok: false, erro: "evento" }]; }
    case "entrar": case "listar": case "agir": case "config": {
      if (String(b.pin || "") !== pinAtual) return [401, { ok: false, erro: "pin" }];
      if (b.op === "agir") agir(id, b.id, b.acao);
      if (b.op === "config") {
        const ev = eventos.get(id), c = b.cfg || {};
        for (const k of ["aprovar_antes", "aberto"]) if (typeof c[k] === "boolean") ev[k] = c[k];
        if (c.titulo) ev.titulo = c.titulo.slice(0, 80);
        if (c.subtitulo) ev.subtitulo = c.subtitulo.slice(0, 120);
        if ("banner_url" in c) ev.banner_url = c.banner_url || null;
        if (c.novo_pin && /^\d{4,12}$/.test(c.novo_pin)) pinAtual = c.novo_pin;
      }
      return [200, { ok: true, ...listar(id) }];
    }
    default: return [400, { ok: false, erro: "op" }];
  }
}

const TIPOS = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".svg": "image/svg+xml", ".webp": "image/webp" };

createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  if (url.pathname === "/api" && req.method === "POST") {
    const partes = []; for await (const c of req) partes.push(c);
    let b; try { b = JSON.parse(Buffer.concat(partes).toString("utf8")); } catch { b = {}; }
    const [st, j] = api(b);
    res.writeHead(st, { "Content-Type": "application/json" }); return res.end(JSON.stringify(j));
  }
  let caminho = normalize(decodeURIComponent(url.pathname)).replace(/^[\\/]+/, "");
  if (!caminho) caminho = "index.html";
  if (!extname(caminho)) caminho += ".html";
  const arq = join(RAIZ, caminho);
  if (!arq.startsWith(RAIZ)) { res.writeHead(403); return res.end(); }
  try {
    const dados = await readFile(arq);
    res.writeHead(200, { "Content-Type": TIPOS[extname(arq)] || "application/octet-stream", "Cache-Control": "no-store" });
    res.end(dados);
  } catch { res.writeHead(404); res.end("não encontrado"); }
}).listen(PORTA, () => console.log(`Rede One (teste local) em http://localhost:${PORTA}  ·  PIN local: ${PIN === "1234" ? "1234" : "(do REDEONE_PIN)"}`));
