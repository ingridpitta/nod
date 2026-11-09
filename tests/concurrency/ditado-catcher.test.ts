import { afterAll, beforeAll, expect, it } from "vitest";
import WebSocket from "ws";
import type { DisponibilidadeDitado, MsgDitadoServidor } from "../../src/contracts/ditado.ts";
import { VERSAO_CONSENTIMENTO_VOZ } from "../../src/contracts/ligacao.ts";
import { servidorCompleto, type ServidorCompleto } from "../helpers/servidor-completo.ts";
import { limparPessoaE2E } from "./limpeza-e2e.ts";

/**
 * Ditado ponta a ponta com custo zero (ADR-095): servidor completo e voz falsa (STT roteirizado). Um cliente WebSocket
 * faz o papel do campo de mensagem: abre o canal do ditado com cookie e Origin, fala em dois trechos, conclui e recebe
 * o texto inteiro. Sem o aviso da voz aceito, o canal recusa antes de qualquer áudio ir ao STT.
 */
let srv: ServidorCompleto;

beforeAll(async () => {
  srv = await servidorCompleto({ env: { NOD_VOZ_FALSO_ROTEIRO: "Oi, tudo bem?|Manda o resumo de ontem." } });
});

afterAll(async () => {
  try {
    await srv.fechar();
  } finally {
    await limparPessoaE2E(srv.db, srv.dbDono, { tenantId: srv.pessoa.tenantId, pessoaId: srv.pessoa.pessoaId }, { agentes: [], conversas: [] });
    await srv.desligar();
  }
});

type Cliente = { msgs: MsgDitadoServidor[]; ws: WebSocket; fechou: number | null; esperar(t: MsgDitadoServidor["t"]): Promise<MsgDitadoServidor> };

async function abrirDitado(origin: string): Promise<Cliente> {
  const url = `${srv.url.replace("http", "ws")}/api/t/${srv.pessoa.tenantId}/voz/v1/ditado`;
  const ws = new WebSocket(url, { headers: { cookie: srv.pessoa.cookie, origin } });
  const c: Cliente = {
    msgs: [],
    ws,
    fechou: null,
    esperar: (t) => srv.esperar(async () => c.msgs.find((m) => m.t === t) ?? null, { nome: t, timeoutMs: 8_000 }),
  };
  ws.on("message", (dados, binario) => {
    if (!binario) c.msgs.push(JSON.parse(String(dados)) as MsgDitadoServidor);
  });
  ws.on("close", (codigo) => {
    c.fechou = codigo;
  });
  await new Promise<void>((r, j) => {
    ws.once("open", () => r());
    ws.once("error", j);
    ws.once("unexpected-response", (_req, res) => j(new Error(`upgrade recusado: ${res.statusCode}`)));
  });
  ws.send(JSON.stringify({ t: "ola", v: 1 }));
  return c;
}

/** 20 ms de PCM16 16 kHz com um tom (fala) ou silêncio, no quadro 0x01 do protocolo. */
function quadroMicrofone(seq: number, comVoz: boolean): Buffer {
  const b = Buffer.alloc(5 + 640);
  b.writeUInt8(0x01, 0);
  b.writeUInt32LE(seq, 1);
  for (let i = 0; i < 320; i++) b.writeInt16LE(comVoz ? Math.round(Math.sin((i + seq * 320) / 6) * 9000) : 0, 5 + i * 2);
  return b;
}

/** No ritmo do app: blocos de 100 ms em tempo real (em rajada, a guarda de abuso fecharia o canal). */
async function falar(cli: Cliente, seq: { n: number }, comVoz: number, silencio: number): Promise<void> {
  for (let i = 0; i < comVoz + silencio; i++) {
    cli.ws.send(quadroMicrofone(seq.n++, i < comVoz));
    if (i % 5 === 4) await new Promise((r) => setTimeout(r, 100));
  }
}

it("o 🎤 aparece pedindo o aviso; sem ele o canal recusa; com ele, dois trechos viram um texto só", async () => {
  const antes = await srv.json<DisponibilidadeDitado>("GET", "voz/ditado/disponibilidade");
  expect(antes).toEqual({ disponivel: true, consentimentoNecessario: true, versaoConsentimento: VERSAO_CONSENTIMENTO_VOZ });

  const host = new URL(srv.url).host;
  // Origin de outro site: recusado no upgrade, como a mídia da ligação.
  await expect(abrirDitado("https://outro.exemplo")).rejects.toThrow(/403/);

  const semAviso = await abrirDitado(`http://${host}`);
  expect(await semAviso.esperar("erro")).toEqual({ t: "erro", codigo: "sem_consentimento" });
  await srv.esperar(async () => semAviso.fechou, { nome: "fechou sem aviso", timeoutMs: 5_000 });

  await srv.json("POST", "voz/consentimento", { versao: VERSAO_CONSENTIMENTO_VOZ });
  expect(await srv.json<DisponibilidadeDitado>("GET", "voz/ditado/disponibilidade")).toMatchObject({ disponivel: true, consentimentoNecessario: false });

  const cli = await abrirDitado(`http://${host}`);
  expect(await cli.esperar("pronto")).toEqual({ t: "pronto", maxS: 300 });
  const seq = { n: 0 };
  await falar(cli, seq, 30, 60); // 600 ms de tom e 1,2 s de pausa: o primeiro trecho fecha sozinho
  await falar(cli, seq, 30, 0); // o segundo fecha no concluir
  cli.ws.send(JSON.stringify({ t: "concluir", destino: "campo" }));
  expect(await cli.esperar("texto")).toEqual({ t: "texto", texto: "Oi, tudo bem? Manda o resumo de ontem." });
  await srv.esperar(async () => cli.fechou, { nome: "fechou depois do texto", timeoutMs: 5_000 });
  expect(cli.fechou).toBe(1000);
});
