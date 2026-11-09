import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import { describe, expect, it } from "vitest";
import { VERSAO_MINIMA_APP, type PonteInternaNod } from "../../../src/adapters/fundo/ponte-interna.ts";
import { criarCanalComputador } from "../../../src/adapters/computador/canal.ts";
import { gerarParX25519 } from "../../../src/adapters/computador/selo.ts";
import { criarPonteHttpServidor } from "../../../src/adapters/http/rotas/ponte.ts";
import { anuncioComputador, estadoComputadorRelatado, resultadoComandoComputador } from "../../../src/adapters/http/rotas/ponte-validacao.ts";
import type { ComandoComputador, EstadoComputadorRelatado } from "../../../src/contracts/computador-motor.ts";
import type { Escopo } from "../../../src/shared/types.ts";

/**
 * NOD-96 PR 3: as rotas `computador/*` da ponte. A máquina é a da CHAVE e a pessoa a do escopo; o comando de uma pessoa
 * nunca sai para outra, nem para outra máquina da mesma pessoa. Flag desligada (sem `computador`): 404.
 */
const ana: Escopo = { tenantId: "00000000-0000-4000-8000-000000000001", pessoaId: "00000000-0000-4000-8000-000000000002" };
const bia: Escopo = { tenantId: "00000000-0000-4000-8000-000000000001", pessoaId: "00000000-0000-4000-8000-000000000009" };
const COMPUTADOR = "00000000-0000-4000-8000-0000000000c1";
const BOT = "00000000-0000-4000-8000-0000000000b1";
const pronto = { estado: "pronto", versao: "fake", em: 0 };

function montar(o: { comComputador?: boolean } = {}) {
  const canal = criarCanalComputador({ agora: Date.now });
  const reconciliados: { maquinaId: string; relato: EstadoComputadorRelatado }[] = [];
  const ponte: PonteInternaNod = {
    conectar: async () => undefined, puxar: async () => null, renovar: async () => ({ ativo: false, versaoMinimaApp: VERSAO_MINIMA_APP }),
    entregar: async () => undefined, desconectar: async () => undefined, maquinasConectadas: () => [], escopoDoTurno: () => null,
  } as PonteInternaNod;
  const p = criarPonteHttpServidor({
    criar: () => ponte, persistir: async () => undefined, autorizar: async () => ({ ...ana, chaveId: "x" }),
    segredo: "s", seguro: false, agora: Date.now, delta: () => undefined, ferramenta: () => undefined, tarefas: () => undefined, longpollMs: 300,
    ...(o.comComputador === false ? {} : { computador: { canal, reconciliar: async (_e: Escopo, maquinaId: string, relato: EstadoComputadorRelatado) => { reconciliados.push({ maquinaId, relato }); } } }),
  });
  const chamar = async (escopo: Escopo, chaveId: string, nome: string, corpo: unknown = {}) => {
    const rota = p.rotas.find((r) => r.padrao.test(`/${nome}`));
    let resposta: { status: number; body: unknown } | null = null;
    const req = new IncomingMessage(new Socket());
    req.headers = { authorization: "Bearer k", "x-nod-versao": VERSAO_MINIMA_APP };
    try {
      await rota!.handler({ req, res: new ServerResponse(req), escopo, params: { chaveId }, corpo: async () => corpo, json: (status, body) => { resposta = { status, body }; } });
    } catch (e) { return { status: 0, body: (e as Error).message }; }
    return resposta!;
  };
  return { p, canal, chamar, reconciliados };
}

const comando = (id: string): ComandoComputador => ({ id, computadorId: COMPUTADOR, tipo: "iniciar", uso: "equilibrado", prazoMs: Date.now() + 60_000, assinatura: "x" });

describe("rotas computador/* da ponte", () => {
  it("o anúncio `computador` entra na conexão e chega ao despachante; fora do formato some", async () => {
    const { p, chamar } = montar();
    await chamar(ana, "vm", "conectar", { versaoContrato: 1, nome: "vm", plataforma: "linux", inventario: pronto, computador: { estado: "pronto" } });
    await chamar(ana, "mac", "conectar", { versaoContrato: 1, nome: "mac", inventario: pronto, computador: { estado: "voando" } });
    expect(p.maquinasComComputador(ana).map((m) => [m.machineId, m.plataforma, m.computador, m.versaoApp])).toEqual([["vm", "linux", "pronto", VERSAO_MINIMA_APP], ["mac", "darwin", null, VERSAO_MINIMA_APP]]);
    expect(p.maquinasComComputador(bia)).toEqual([]);
    await chamar(ana, "vm", "inventario", { versaoContrato: 1, inventario: pronto, computador: { estado: "faltam_pacotes", falta: ["bubblewrap", "Rm -rf"] } });
    expect(p.maquinasComComputador(ana)[0]!.computador).toBe("faltam_pacotes");
    expect(anuncioComputador({ estado: "faltam_pacotes", falta: ["bubblewrap", "Rm -rf"] })).toEqual({ estado: "faltam_pacotes", falta: ["bubblewrap"] });
  });

  it("puxar entrega só à máquina e à pessoa do comando; o resultado resolve quem espera", async () => {
    const { canal, chamar } = montar();
    await chamar(ana, "vm", "conectar", { versaoContrato: 1, nome: "vm", plataforma: "linux", inventario: pronto });
    await chamar(ana, "vm2", "conectar", { versaoContrato: 1, nome: "vm2", plataforma: "linux", inventario: pronto });
    await chamar(bia, "vb", "conectar", { versaoContrato: 1, nome: "vb", plataforma: "linux", inventario: pronto });
    const espera = canal.enviar(ana, "vm", comando("c1"));
    // A Bia com a chave da máquina da Ana: a conexão não é dela.
    expect((await chamar(bia, "vm", "computador/puxar")).status).toBe(0);
    expect((await chamar(bia, "vb", "computador/puxar")).body).toEqual({ comandos: [] });
    expect((await chamar(ana, "vm2", "computador/puxar")).body).toEqual({ comandos: [] });
    expect((await chamar(ana, "vm", "computador/puxar")).body).toMatchObject({ comandos: [{ id: "c1" }] });
    expect((await chamar(bia, "vb", "computador/resultado", { id: "c1", desfecho: "ok" })).body).toEqual({ aceito: false });
    expect((await chamar(ana, "vm", "computador/resultado", { id: "c1", desfecho: "ok", resultado: { saida: "x" } })).body).toEqual({ aceito: true });
    await expect(espera).resolves.toEqual({ id: "c1", desfecho: "ok", resultado: { saida: "x" } });
    expect((await chamar(ana, "vm", "computador/resultado", { id: "c1", desfecho: "ok" })).body).toEqual({ aceito: false });
  });

  it("o long-poll volta assim que chega comando", async () => {
    const { canal, chamar } = montar();
    await chamar(ana, "vm", "conectar", { versaoContrato: 1, nome: "vm", plataforma: "linux", inventario: pronto });
    const puxada = chamar(ana, "vm", "computador/puxar");
    setTimeout(() => void canal.enviar(ana, "vm", comando("c2")).catch(() => undefined), 50);
    expect((await puxada).body).toMatchObject({ comandos: [{ id: "c2" }] });
  });

  it("estado: o canal guarda a foto e a composição reconcilia; corpo fora do formato é recusado", async () => {
    const { canal, chamar, reconciliados } = montar();
    await chamar(ana, "vm", "conectar", { versaoContrato: 1, nome: "vm", plataforma: "linux", inventario: pronto });
    const relato = { computadorId: COMPUTADOR, ligado: true, supervisorPub: gerarParX25519().publica, telas: [{ agenteId: BOT, estado: "aberta", ultimaAcaoEm: 5, memoriaMb: 300 }] };
    expect((await chamar(ana, "vm", "computador/estado", relato)).status).toBe(200);
    expect(canal.foto(ana, "vm")).toEqual(relato);
    expect(canal.foto(bia, "vm")).toBeNull();
    expect(reconciliados).toEqual([{ maquinaId: "vm", relato }]);
    expect((await chamar(ana, "vm", "computador/estado", { ...relato, supervisorPub: "curta" })).status).toBe(0);
    await chamar(ana, "vm", "desconectar");
    expect(canal.foto(ana, "vm")).toBeNull();
  });

  it("flag desligada: 404 nas três rotas", async () => {
    const { chamar } = montar({ comComputador: false });
    await chamar(ana, "vm", "conectar", { versaoContrato: 1, nome: "vm", plataforma: "linux", inventario: pronto });
    for (const r of ["computador/puxar", "computador/resultado", "computador/estado"]) expect((await chamar(ana, "vm", r, {})).status).toBe(404);
  });

  it("validação: motivo desconhecido vira acao_falhou; id fora do formato é recusado", () => {
    expect(resultadoComandoComputador({ id: "c1", desfecho: "falhou", motivo: "inventado" })).toEqual({ id: "c1", desfecho: "falhou", motivo: "acao_falhou" });
    expect(() => resultadoComandoComputador({ id: "../x", desfecho: "ok" })).toThrow();
    expect(() => estadoComputadorRelatado({ computadorId: "x", ligado: true, supervisorPub: gerarParX25519().publica, telas: [] })).toThrow();
  });
});
