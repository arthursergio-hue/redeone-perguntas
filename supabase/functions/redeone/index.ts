// Edge Function "redeone": a única porta entre as telas e o schema redeone.
// O público não toca nas tabelas; aqui só chamamos as funções SQL do schema.
import postgres from "npm:postgres@3.4.5";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { prepare: false, max: 3 });
const storage = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!).storage;
const SAL = "redeone-2026";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, authorization, apikey, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

async function hashIp(req: Request): Promise<string | null> {
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || req.headers.get("cf-connecting-ip") || "";
  if (!ip) return null;
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(SAL + ip));
  return Array.from(new Uint8Array(buf)).slice(0, 12).map((b) => b.toString(16).padStart(2, "0")).join("");
}

const ACOES = new Set(["aprovar", "responder", "ocultar", "fixar", "desafixar", "pendente", "destacar",
  "tirar_destaque", "ocultar_resposta", "mostrar_resposta"]);
const RODADA = new Set(["iniciar", "proxima", "anterior", "mais30", "pausar", "retomar", "zerar"]);
const COM_PIN = new Set(["entrar", "listar", "agir", "config", "slide", "rodada", "mesas", "upload_url", "ativar", "zerar"]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, erro: "metodo" }, 405);

  let b: Record<string, any>;
  try { b = await req.json(); } catch { return json({ ok: false, erro: "json" }, 400); }

  const pedido = String(b.evento ?? "").slice(0, 60);
  if (!/^[a-z0-9-]{3,60}$/.test(pedido)) return json({ ok: false, erro: "evento" }, 400);
  const ip = await hashIp(req);

  try {
    // "ativo" = a palestra que está no telão agora (um QR Code e um telão para a conferência inteira)
    const [{ id: evento }] = await sql`select redeone.resolver(${pedido}) as id`;
    if (!evento) return json({ ok: false, erro: "evento" }, 404);
    if (b.op === "enviar") {
      const [r] = await sql`select redeone.enviar(${evento}, ${String(b.texto ?? "")},
        ${b.nome ? String(b.nome) : null}, ${String(b.dispositivo ?? "")}, ${ip}) as r`;
      return json(r.r);
    }
    if (b.op === "responder") {
      const [r] = await sql`select redeone.responder(${evento}, ${Number(b.grupo) || null}, ${String(b.texto ?? "")},
        ${String(b.dispositivo ?? "")}, ${ip}) as r`;
      return json(r.r);
    }
    if (b.op === "responder_pastor") {
      const [r] = await sql`select redeone.responder_pastor(${evento}, ${String(b.texto ?? "")},
        ${b.nome ? String(b.nome) : null}, ${String(b.dispositivo ?? "")}, ${ip}) as r`;
      return json(r.r);
    }
    if (b.op === "telao") {
      const [r] = await sql`select redeone.telao(${evento}) as r`;
      if (!r.r.evento) return json({ ok: false, erro: "evento" }, 404);
      return json({ ok: true, ...r.r });
    }
    if (!COM_PIN.has(b.op)) return json({ ok: false, erro: "op" }, 400);

    const [p] = await sql`select redeone.pin_ok(${evento}, ${String(b.pin ?? "")}, ${ip}) as ok`;
    if (!p.ok) return json({ ok: false, erro: "pin" }, 401);

    switch (b.op) {
      case "agir":
        if (!ACOES.has(b.acao) || typeof b.id !== "string") return json({ ok: false, erro: "acao" }, 400);
        await sql`select redeone.controle_agir(${evento}, ${b.id}::uuid, ${b.acao})`;
        break;
      case "config":
        await sql`select redeone.controle_config(${evento}, ${sql.json(b.cfg ?? {})})`;
        break;
      case "slide":
        await sql`select redeone.controle_slide(${evento}, ${Number.isFinite(b.delta) ? b.delta : null}, ${Number.isFinite(b.ir) ? b.ir : null})`;
        break;
      case "rodada":
        if (!RODADA.has(b.acao)) return json({ ok: false, erro: "acao" }, 400);
        await sql`select redeone.controle_rodada(${evento}, ${b.acao})`;
        break;
      case "ativar":
        await sql`select redeone.controle_ativar(${String(b.alvo ?? "")})`;
        break;
      case "mesas":
        await sql`select redeone.controle_mesas(${evento}, ${sql.json(Array.isArray(b.mesas) ? b.mesas : [])})`;
        break;
      case "zerar": {
        const [z] = await sql`select redeone.controle_zerar(${evento}) as z`;
        const [r] = await sql`select redeone.controle_listar(${evento}) as r`;
        return json({ ok: true, apagados: z.z, ...r.r });
      }
      case "upload_url": {
        // PDF da apresentação ou imagem do telão (banner)
        const ext = { pdf: "pdf", jpg: "jpg", jpeg: "jpg", png: "png", webp: "webp" }[String(b.ext ?? "pdf").toLowerCase()];
        if (!ext) return json({ ok: false, erro: "tipo" }, 400);
        const caminho = `${evento}/${Date.now()}.${ext}`;
        const { data, error } = await storage.from("redeone").createSignedUploadUrl(caminho);
        if (error) throw error;
        const publico = storage.from("redeone").getPublicUrl(caminho).data.publicUrl;
        return json({ ok: true, caminho, token: data.token, publico });
      }
    }
    const [r] = await sql`select redeone.controle_listar(${evento}) as r`;
    return json({ ok: true, ...r.r });
  } catch (e) {
    const msg = String((e as Error)?.message ?? e);
    if (msg.includes("bloqueado")) return json({ ok: false, erro: "bloqueado" }, 429);
    console.error(msg);
    return json({ ok: false, erro: "servidor" }, 500);
  }
});
