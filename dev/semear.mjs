// Coloca perguntas de exemplo no servidor local (node dev/semear.mjs) e confere as regras.
const API = process.env.API || "http://localhost:5174/api";
const E = "rede-one-2026";
const ir = (b) => fetch(API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ evento: E, ...b }) }).then((r) => r.json());

const exemplos = [
  ["Como manter a fé firme quando a oração parece não ter resposta?", null],
  ["Que conselho você daria para quem está começando a liderar jovens na igreja?", "Mariana"],
  ["Como equilibrar ministério, trabalho e família sem se esgotar?", "Lucas"],
  ["Qual livro mais marcou a sua caminhada?", null],
  ["Como perdoar alguém que nunca pediu perdão?", "Ana Clara"],
];
let i = 0;
for (const [texto, nome] of exemplos) console.log(await ir({ op: "enviar", texto, nome, dispositivo: `exemplo-aparelho-${++i}0` }));

const testes = [
  ["espera (mesmo aparelho em 30 s)", { op: "enviar", texto: "Outra logo em seguida", dispositivo: "exemplo-aparelho-10" }, "espera"],
  ["palavrão disfarçado", { op: "enviar", texto: "que p0rraaa é essa", dispositivo: "exemplo-aparelho-90" }, "palavrao"],
  ["repetida", { op: "enviar", texto: "Qual livro mais marcou a sua caminhada?", dispositivo: "exemplo-aparelho-91" }, "repetida"],
  ["curta", { op: "enviar", texto: "oi", dispositivo: "exemplo-aparelho-92" }, "curta"],
  ["PIN errado", { op: "listar", pin: "0000" }, "pin"],
];
let falhas = 0;
for (const [nome, b, esperado] of testes) {
  const r = await ir(b);
  const ok = r.erro === esperado;
  if (!ok) falhas++;
  console.log(`${ok ? "OK " : "ERRO"} ${nome}: ${JSON.stringify(r)}`);
}
process.exitCode = falhas ? 1 : 0;
