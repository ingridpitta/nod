import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PlanoTurno } from "../../src/contracts/plano-turno.ts";
import type { VigiaVivo } from "../../src/contracts/ponte.ts";
import { VERSAO_MINIMA_APP, type PonteInternaNod } from "../../src/adapters/fundo/ponte-interna.ts";
import { criarAvisoDoVigia } from "../../src/adapters/http/aviso-vigia.ts";
import { criarPonteHttpServidor } from "../../src/adapters/http/rotas/ponte.ts";

const plano = { turnoId: "00000000-0000-4000-8000-000000000003", agenteId: "00000000-0000-4000-8000-000000000004" } as PlanoTurno;

function linhasDeLog(espiao: ReturnType<typeof vi.spyOn>): Record<string, unknown>[] {
  return espiao.mock.calls.map((c: unknown[]) => JSON.parse(String(c[0])) as Record<string, unknown>);
}

describe("aviso do vigia no servidor (NOD-73)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("publica nomes curtos e números; uma linha de log por nível de silêncio e por limiar, sem argumento", () => {
    const espiao = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const publicados: Record<string, unknown>[] = [];
    const avisar = criarAvisoDoVigia((_p, d) => publicados.push(d));
    avisar(plano, { mudoMs: 600_000, aberta: "Bash", emFundo: 1 });
    avisar(plano, { mudoMs: 0, emFundo: 0, repeticao: { nome: "mcp__nod__gmail__search_threads", vezes: 5 } });
    // A repetição viaja em todo aviso seguinte: não repete a linha de log.
    avisar(plano, { mudoMs: 600_000, emFundo: 0, repeticao: { nome: "mcp__nod__gmail__search_threads", vezes: 5 } });
    avisar(plano, { mudoMs: 1_200_000, emFundo: 0, repeticao: { nome: "mcp__nod__gmail__search_threads", vezes: 5 } });
    expect(publicados[0]).toEqual({ mudoMs: 600_000, emFundo: 1, aberta: "Terminal" });
    expect(publicados[1]).toEqual({ mudoMs: 0, emFundo: 0, repeticao: { rotulo: "Gmail", vezes: 5 } });
    const linhas = linhasDeLog(espiao);
    expect(linhas.map((l) => [l.evento, l.mudo_ms ?? l.vezes])).toEqual([
      ["turno_sem_novidade", 600_000],
      ["turno_repeticao", 5],
      ["turno_sem_novidade", 600_000],
      ["turno_sem_novidade", 1_200_000],
    ]);
    expect(linhas[0]).toMatchObject({ turno_id: plano.turnoId, agente_id: plano.agenteId, aberta: "Bash", em_fundo: 1 });
  });

  it("turno da ligação: sem frame e sem linha de log (não polui o gatilho Preso da ADR-067)", () => {
    const espiao = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const publicados: Record<string, unknown>[] = [];
    const avisar = criarAvisoDoVigia((_p, d) => publicados.push(d));
    const ligacao = { ...plano, modoTurno: "ligacao" } as PlanoTurno;
    avisar(ligacao, { mudoMs: 2_400_000, aberta: "Bash", emFundo: 0, repeticao: { nome: "Bash", vezes: 20 } });
    expect(publicados).toEqual([]);
    expect(linhasDeLog(espiao)).toEqual([]);
  });

  it("rota renovar: o trecho vigia vai ao servidor validado; o app antigo (sem vigia) segue igual", async () => {
    const escopo = { tenantId: "00000000-0000-4000-8000-000000000001", pessoaId: "00000000-0000-4000-8000-000000000002" };
    const ponte: PonteInternaNod = { conectar: async () => undefined, puxar: async () => plano, renovar: async () => ({ ativo: true, versaoMinimaApp: VERSAO_MINIMA_APP }), entregar: async () => undefined, desconectar: async () => undefined, maquinasConectadas: () => [], escopoDoTurno: () => null };
    const recebidos: VigiaVivo[] = [];
    const deltas: string[] = [];
    const p = criarPonteHttpServidor({
      criar: () => ponte, persistir: async () => undefined, autorizar: async () => ({ ...escopo, chaveId: "m1" }),
      segredo: "s", seguro: false, agora: () => Date.now(), delta: (_p, t) => { deltas.push(t); }, ferramenta: () => undefined, tarefas: () => undefined, longpollMs: 2_000,
      vigia: (_p, a) => { recebidos.push(a); },
    });
    const chamar = async (nome: string, corpo: unknown = {}) => {
      const rota = p.rotas.find((r) => r.padrao.test(`/${nome}`));
      let resposta: { status: number; body: unknown } | null = null;
      const req = new IncomingMessage(new Socket());
      req.headers = { authorization: "Bearer k", "x-nod-versao": VERSAO_MINIMA_APP };
      await rota!.handler({ req, res: new ServerResponse(req), escopo, params: { chaveId: "m1" }, corpo: async () => corpo, json: (status, body) => { resposta = { status, body }; } });
      return resposta!;
    };
    await chamar("conectar", { versaoContrato: 1, nome: "Mac", inventario: { estado: "pronto", versao: "fake", em: 0 } });
    expect(await chamar("puxar")).toMatchObject({ status: 200, body: { plano } });
    const sinais = { attempted: true, rejected: false, promptSubmitted: true, producedOutput: true };
    const aviso = { mudoMs: 600_000, aberta: "Bash", emFundo: 0 };
    expect(await chamar("renovar", { turnoId: plano.turnoId, sinais, trechos: [{ texto: "oi" }, { vigia: aviso }, { vigia: { ...aviso, input: "cat .env" } }] })).toMatchObject({ status: 200, body: { ativo: true } });
    expect(recebidos).toEqual([aviso]);
    expect(await chamar("renovar", { turnoId: plano.turnoId, sinais, trechos: [{ texto: "app antigo" }] })).toMatchObject({ status: 200, body: { ativo: true } });
    expect(recebidos).toHaveLength(1);
    expect(deltas).toEqual(["oi", "app antigo"]);
  });
});
