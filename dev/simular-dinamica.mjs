// Simula a dinâmica no servidor local: perguntas das mesas, 4 grupos respondendo e as rodadas.
// Uso: node dev/simular-dinamica.mjs [ate_rodada]   (ex.: 2 para parar na rodada 2; 5 = confronto)
const API = process.env.API || "http://localhost:5174/api";
const E = "rede-one-paulo", PIN = process.env.REDEONE_PIN || "1234";
const ir = (b) => fetch(API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ evento: E, pin: PIN, ...b }) }).then((r) => r.json());
const ate = Number(process.argv[2] || 5);

const mesas = [
  { numero: 1, pergunta: "O que significa servir para você?", texto_ensina: "Servir é seguir o exemplo de Jesus (Mc 10.45)\nQuem serve não busca o primeiro lugar\nServir é amor em forma de atitude" },
  { numero: 2, pergunta: "O que nos impede de servir mais?", texto_ensina: "O orgulho nos afasta da toalha e da bacia (Jo 13)\nO medo de errar não pode parar a obra" },
  { numero: 3, pergunta: "Onde você pode servir nesta semana?", texto_ensina: "Começa em casa e na célula\nPequenas atitudes também são serviço" },
  { numero: 4, pergunta: "Como a igreja pode servir à cidade?", texto_ensina: "Sal e luz no lugar onde estamos (Mt 5.13-16)" },
];
const respostas = {
  1: ["Fazer pelo outro sem esperar nada", "Amor na prática", "Estar disponível", "Ser as mãos de Jesus"],
  2: ["Falta de tempo", "Orgulho", "Medo de não saber fazer", "Cansaço"],
  3: ["Ajudar em casa", "Na recepção do culto", "Visitar quem sumiu da célula", "No lanche da conferência"],
  4: ["Ação social no bairro", "Visitar o hospital", "Ajudar a escola da rua", "Doação de alimentos"],
};

const ok = (r, nome) => { if (!r.ok) { console.log("ERRO", nome, r); process.exitCode = 1; } return r; };
ok(await ir({ op: "rodada", acao: "zerar" }), "zerar");
ok(await ir({ op: "mesas", mesas }), "mesas");
let dispositivo = 0;
for (let r = 1; r <= Math.min(ate, 4); r++) {
  ok(await ir({ op: "rodada", acao: r === 1 ? "iniciar" : "proxima" }), `rodada ${r}`);
  for (let g = 1; g <= 4; g++) {
    const mesa = ((g - 1 + r - 1) % 4) + 1;
    const texto = respostas[mesa][g - 1];
    const res = ok(await ir({ op: "responder", grupo: g, texto, dispositivo: `simulado-aparelho-${++dispositivo}` }), `resposta g${g}`);
    if (res.mesa !== mesa) { console.log("ERRO mesa errada", g, r, res); process.exitCode = 1; }
  }
}
if (ate >= 5) ok(await ir({ op: "rodada", acao: "proxima" }), "confronto");
const t = await ir({ op: "telao", pin: undefined });
console.log(`rodada=${t.evento.rodada} respostas=${t.respostas.length} mesas=${t.mesas.length} ensina_visivel=${t.mesas.some((m) => m.texto_ensina)}`);
