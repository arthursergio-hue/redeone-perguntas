// Edge Function "redeone": a única porta entre as telas e o schema redeone.
// O público não toca nas tabelas; aqui só chamamos as funções SQL do schema.
import postgres from "npm:postgres@3.4.5";

const sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { prepare: false, max: 3 });
const SAL = "redeone-2026";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, authorization, apikey, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

async function hashIp(req: Request): Promise<string | null> {
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim()
    || req.headers.get("cf-connecting-ip") || "";
  if (!ip) return null;
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(SAL + ip));
  return Array.from(new Uint8Array(buf)).slice(0, 12).map((b) => b.toString(16).padStart(2, "0")).join("");
}

const ACOES = new Set(["aprovar", "responder", "ocultar", "fixar", "desafixar", "pendente"]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, erro: "metodo" }, 405);

  let b: Record<string, any>;
  try { b = await req.json(); } catch { return json({ ok: false, erro: "json" }, 400); }

  const evento = String(b.evento ?? "").slice(0, 60);
  if (!evento) return json({ ok: false, erro: "evento" }, 400);
  const ip = await hashIp(req);

  try {
    switch (b.op) {
      case "enviar": {
        const [r] = await sql`select redeone.enviar(${evento}, ${String(b.texto ?? "")},
          ${b.nome ? String(b.nome) : null}, ${String(b.dispositivo ?? "")}, ${ip}) as r`;
        return json(r.r);
      }
      case "telao": {
        const [r] = await sql`select redeone.telao(${evento}) as r`;
        if (!r.r.evento) return json({ ok: false, erro: "evento" }, 404);
        return json({ ok: true, ...r.r });
      }
      case "entrar":
      case "listar":
      case "agir":
      case "config": {
        const [p] = await sql`select redeone.pin_ok(${evento}, ${String(b.pin ?? "")}, ${ip}) as ok`;
        if (!p.ok) return json({ ok: false, erro: "pin" }, 401);
        if (b.op === "agir") {
          if (!ACOES.has(b.acao) || typeof b.id !== "string") return json({ ok: false, erro: "acao" }, 400);
          await sql`select redeone.controle_agir(${evento}, ${b.id}::uuid, ${b.acao})`;
        } else if (b.op === "config") {
          await sql`select redeone.controle_config(${evento}, ${sql.json(b.cfg ?? {})})`;
        }
        const [r] = await sql`select redeone.controle_listar(${evento}) as r`;
        return json({ ok: true, ...r.r });
      }
      default:
        return json({ ok: false, erro: "op" }, 400);
    }
  } catch (e) {
    const msg = String((e as Error)?.message ?? e);
    if (msg.includes("bloqueado")) return json({ ok: false, erro: "bloqueado" }, 429);
    console.error(msg);
    return json({ ok: false, erro: "servidor" }, 500);
  }
});
