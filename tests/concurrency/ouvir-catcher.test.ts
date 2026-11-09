import { VERSAO_CONSENTIMENTO_VOZ } from "../../src/contracts/ligacao.ts";
import { afterAll, beforeAll, expect, it } from "vitest";
import type { Agente } from "../../src/contracts/agente.ts";
import type { Conversa } from "../../src/contracts/conversa.ts";
import type { DisponibilidadeLigacao } from "../../src/contracts/ligacao.ts";
import { TAXA_VOZ_HZ } from "../../src/contracts/voz.ts";
import type { ProvedoresVoz } from "../../src/adapters/voz/spi.ts";
import { criarProvedoresFalsos, duracaoFalaFalsaMs } from "../../src/adapters/voz/voz-falsa.ts";
import { abrirTxEscopada } from "../../src/db/tx.ts";
import { textoParaLeitura } from "../../src/domain/ligacao-frases.ts";
import { definirDestinoDoLog } from "../../src/obs/log.ts";
import { criarRepos } from "../../src/repositories/index.ts";
import { autoriaAgente } from "../helpers/fabricas.ts";
import { servidorCompleto, type ServidorCompleto } from "../helpers/servidor-completo.ts";
import { limparPessoaE2E } from "./limpeza-e2e.ts";

/**
 * Ouvir uma resposta ponta a ponta (NOD-180): servidor completo, voz falsa (custo zero, nada vai ao Google) embrulhada
 * para observar cada trecho pedido ao TTS e o sinal de abort. Confere o streaming (bytes = Σ duração × 48, amostras em
 * big-endian), o cancelamento quando a pessoa fecha, a leitura nova cancelando a anterior, o 403 com a chave desligada,
 * o 429 no teto diário e o log sem o texto.
 */
type Pedido = { texto: string; sinal: AbortSignal | undefined; prioridade: string | undefined };

function vozObservada(): ProvedoresVoz & { pedidos: Pedido[] } {
  const base = criarProvedoresFalsos();
  const pedidos: Pedido[] = [];
  return {
    ...base,
    pedidos,
    tts: {
      ...base.tts,
      sintetizar(p) {
        pedidos.push({ texto: p.texto, sinal: p.sinal, prioridade: p.prioridade });
        return base.tts.sintetizar(p);
      },
    },
  };
}

let srv: ServidorCompleto;
let voz: ReturnType<typeof vozObservada>;
const extras: ServidorCompleto[] = [];
const criados = new Map<ServidorCompleto, { agentes: string[]; conversas: string[] }>();
const logs: string[] = [];

async function subir(env: Record<string, string>, v?: ProvedoresVoz): Promise<ServidorCompleto> {
  const s = await servidorCompleto({ env: { NOD_LIGACAO: "todas", ...env }, voz: v });
  criados.set(s, { agentes: [], conversas: [] });
  await s.json("POST", "voz/consentimento", { versao: VERSAO_CONSENTIMENTO_VOZ });
  return s;
}

beforeAll(async () => {
  voz = vozObservada();
  srv = await subir({ NOD_VOZ_LEITURA: "1", NOD_VOZ_LEITURA_ADIANTE_MS: "1000" }, voz);
  definirDestinoDoLog((l) => logs.push(l));
});

afterAll(async () => {
  definirDestinoDoLog(null);
  for (const s of [srv, ...extras]) {
    try {
      await s.fechar();
    } finally {
      await limparPessoaE2E(s.db, s.dbDono, { tenantId: s.pessoa.tenantId, pessoaId: s.pessoa.pessoaId }, criados.get(s) ?? { agentes: [], conversas: [] });
      await s.desligar();
    }
  }
});

/** Um bot novo e uma resposta pronta dele (gravada direto, como o turno gravaria). */
async function resposta(s: ServidorCompleto, texto: string): Promise<{ agenteId: string; mensagemId: string }> {
  const { agente, conversa } = await s.json<{ agente: Agente; conversa: Conversa }>("POST", "agentes", { dono: "pessoa", nome: "Nina" });
  criados.get(s)?.agentes.push(agente.id);
  criados.get(s)?.conversas.push(conversa.id);
  const escopo = { tenantId: s.pessoa.tenantId, pessoaId: s.pessoa.pessoaId };
  const m = await abrirTxEscopada(s.db, escopo)((trx) =>
    criarRepos(trx, escopo).mensagens.criar({ conversaId: conversa.id, autoria: autoriaAgente(agente.id, escopo.pessoaId), kind: "texto", texto, confianca: "confiavel" }),
  );
  return { agenteId: agente.id, mensagemId: m?.id ?? "" };
}

function ouvir(s: ServidorCompleto, mensagemId: string, sinal?: AbortSignal): Promise<Response> {
  return fetch(`${s.url}/api/t/${s.pessoa.tenantId}/mensagens/${mensagemId}/ouvir`, { headers: { cookie: s.pessoa.cookie }, signal: sinal });
}

const LONGA = Array.from({ length: 12 }, (_, i) => `Esta é a frase número ${i + 1} de uma resposta comprida que leva vários segundos para ser lida.`).join(" ");

it("toca a resposta inteira: audio/L16 24 kHz, bytes = Σ duração × 48, amostras big-endian, prioridade previa", async () => {
  const texto = "Pronto, abri o [PR](https://x.y/1). Tudo certo por aqui.";
  const { agenteId, mensagemId } = await resposta(srv, texto);
  const disp = await srv.json<DisponibilidadeLigacao>("GET", `ligacoes/disponibilidade?agenteId=${agenteId}`);
  expect(disp.ouvir).toBe(true);
  const antes = voz.pedidos.length;
  const r = await ouvir(srv, mensagemId);
  expect(r.status).toBe(200);
  expect(r.headers.get("content-type")).toBe(`audio/L16; rate=${TAXA_VOZ_HZ}; channels=1`);
  expect(r.headers.get("cache-control")).toBe("no-store");
  const corpo = Buffer.from(await r.arrayBuffer());
  const trechos = textoParaLeitura(texto);
  expect(voz.pedidos.slice(antes).map((p) => p.texto)).toEqual(trechos);
  expect(voz.pedidos.slice(antes).every((p) => p.prioridade === "previa")).toBe(true);
  expect(corpo.length).toBe(trechos.reduce((s, t) => s + duracaoFalaFalsaMs(t) * 48, 0));
  // O tom falso começa em sin(0)=0 e sobe: a 2ª amostra lida em BE é positiva e pequena; lida em LE, não.
  expect(corpo.readInt16BE(2)).toBeGreaterThan(0);
  expect(corpo.readInt16BE(2)).toBeLessThan(600);
  expect(corpo.readInt16BE(2)).not.toBe(corpo.readInt16LE(2));
});

it("a pessoa fecha no meio: o TTS é abortado e nenhum trecho novo é pedido", async () => {
  const { mensagemId } = await resposta(srv, LONGA);
  const antes = voz.pedidos.length;
  const ctrl = new AbortController();
  const r = await ouvir(srv, mensagemId, ctrl.signal);
  expect(r.status).toBe(200);
  const leitor = r.body?.getReader();
  await leitor?.read();
  ctrl.abort();
  await srv.esperar(async () => voz.pedidos.slice(antes).at(-1)?.sinal?.aborted === true, { nome: "abort no TTS", timeoutMs: 5_000 });
  const pedidos = voz.pedidos.length - antes;
  await new Promise((ok) => setTimeout(ok, 1_500));
  expect(voz.pedidos.length - antes).toBe(pedidos);
  expect(pedidos).toBeLessThan(textoParaLeitura(LONGA).length);
  await srv.esperar(async () => logs.find((l) => l.includes('"voz_leitura"') && l.includes(mensagemId) && l.includes('"cancelada"')) ?? null, { nome: "log cancelada" });
});

it("uma leitura nova cancela a anterior da mesma pessoa (2ª e 3ª seguidas)", async () => {
  const a = await resposta(srv, LONGA);
  const b = await resposta(srv, LONGA);
  const c = await resposta(srv, "Curta.");
  const ra = await ouvir(srv, a.mensagemId);
  await ra.body?.getReader().read();
  const rb = await ouvir(srv, b.mensagemId);
  await rb.body?.getReader().read();
  const rc = await ouvir(srv, c.mensagemId);
  expect(rc.status).toBe(200);
  expect((await rc.arrayBuffer()).byteLength).toBe(duracaoFalaFalsaMs("Curta.") * 48);
  for (const id of [a.mensagemId, b.mensagemId]) {
    await srv.esperar(async () => logs.find((l) => l.includes('"voz_leitura"') && l.includes(id) && l.includes('"substituida"')) ?? null, { nome: `substituida ${id}` });
  }
});

it("o log da leitura não leva o texto da resposta", async () => {
  const segredo = "Senha do cofre é abacaxi azul.";
  const { mensagemId } = await resposta(srv, segredo);
  const r = await ouvir(srv, mensagemId);
  await r.arrayBuffer();
  const linha = await srv.esperar(async () => logs.find((l) => l.includes('"voz_leitura"') && l.includes(mensagemId)) ?? null, { nome: "log" });
  expect(linha).toContain('"desfecho":"completa"');
  expect(linha).toContain('"provedor":"falso"');
  expect(logs.join("\n")).not.toContain("abacaxi");
});

it("mensagem que não existe → 404; id que não é uuid → 404", async () => {
  expect((await ouvir(srv, "00000000-0000-4000-8000-000000000000")).status).toBe(404);
  expect((await ouvir(srv, "nao-e-uuid")).status).toBe(404);
});

it("chave NOD_VOZ_LEITURA desligada (o padrão) → 403 e disponibilidade sem ouvir", async () => {
  const s2 = await subir({}, vozObservada());
  extras.push(s2);
  const { agenteId, mensagemId } = await resposta(s2, "Oi.");
  expect((await ouvir(s2, mensagemId)).status).toBe(403);
  expect((await s2.json<DisponibilidadeLigacao>("GET", `ligacoes/disponibilidade?agenteId=${agenteId}`)).ouvir).toBe(false);
});

it("teto diário de caracteres → 429, sem chamar o TTS", async () => {
  const v3 = vozObservada();
  const s3 = await subir({ NOD_VOZ_LEITURA: "1", NOD_VOZ_LEITURA_CARACTERES_DIA: "30" }, v3);
  extras.push(s3);
  const { mensagemId } = await resposta(s3, "Uma frase de vinte e poucas.");
  const r1 = await ouvir(s3, mensagemId);
  expect(r1.status).toBe(200);
  await r1.arrayBuffer();
  const pedidos = v3.pedidos.length;
  const r2 = await ouvir(s3, mensagemId);
  expect(r2.status).toBe(429);
  expect(v3.pedidos.length).toBe(pedidos);
});
