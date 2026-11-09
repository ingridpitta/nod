import { randomUUID } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import type { ItemAprovacao } from "../../src/contracts/item-aprovacao.ts";
import { abrirTxEscopada, ErroConectorDentroDaTx, exigirForaDaTx, haTxEscopadaAberta } from "../../src/db/tx.ts";
import { criarConectoresVivos } from "../../src/services/conectores-vivos.ts";
import { executarItens, type ItemAExecutar } from "../../src/use-cases/decidir.ts";
import { db } from "../helpers/db.ts";
import { TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { servicosDeTeste } from "../helpers/l5.ts";

/**
 * NOD-263, a guarda (emenda ao ADR-001): nenhuma chamada externa com tx escopada aberta. Com uma tx real aberta pelo
 * `abrirTxEscopada`, o conector vivo e o lote do pedir_aprovacao acusam `conector_dentro_da_tx` — em teste lançam, em
 * produção só logam — e não chegam a falar com o app. Fora da tx, nada acontece.
 */
const ESCOPO = { tenantId: TENANT_PADRAO, pessoaId: randomUUID() };

function logsCapturados(): Record<string, unknown>[] {
  const linhas: Record<string, unknown>[] = [];
  vi.spyOn(console, "log").mockImplementation((l: unknown) => {
    try {
      linhas.push(JSON.parse(String(l)) as Record<string, unknown>);
    } catch {
      // linha que não é JSON: fora do que se confere aqui
    }
  });
  return linhas;
}

function item(sobre: Partial<ItemAprovacao> = {}): ItemAprovacao {
  return {
    tenantId: TENANT_PADRAO, id: randomUUID(), decisaoId: "decisao-263", idx: 0, textoOriginal: "a", textoFinal: "a",
    destino: { conector: "email", ferramenta: "enviar", argumentos: {} }, selecionado: true, origemSensivel: false,
    justificativa: null, marcadoPor: null, marcadoEm: null, editadoPor: null, desfecho: null, motivoManual: null, ...sobre,
  } as ItemAprovacao;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describeIntegracao("guarda conector_dentro_da_tx (NOD-263)", () => {
  it("haTxEscopadaAberta só é true dentro do callback da tx escopada", async () => {
    expect(haTxEscopadaAberta()).toBe(false);
    expect(await abrirTxEscopada(db, ESCOPO)(async () => haTxEscopadaAberta())).toBe(true);
    expect(haTxEscopadaAberta()).toBe(false);
  });

  it("exigirForaDaTx: fora da tx não faz nada; dentro loga aviso e lança em teste; fora de teste só loga", async () => {
    const logs = logsCapturados();
    exigirForaDaTx({ conector_id: "c" });
    expect(logs.filter((l) => l.evento === "conector_dentro_da_tx")).toHaveLength(0);
    const erro = await abrirTxEscopada(db, ESCOPO)(async () => exigirForaDaTx({ conector_id: "c", ferramenta: "f" })).catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(ErroConectorDentroDaTx);
    vi.stubEnv("NODE_ENV", "production");
    expect(await abrirTxEscopada(db, ESCOPO)(async () => {
      exigirForaDaTx({ conector_id: "c", ferramenta: "g" });
      return "seguiu";
    })).toBe("seguiu");
    const avisos = logs.filter((l) => l.evento === "conector_dentro_da_tx");
    expect(avisos.map((l) => [l.nivel, l.ferramenta])).toEqual([["aviso", "f"], ["aviso", "g"]]);
  });

  it("conector vivo com a guarda da composição: dentro da tx lança antes de carregar o conector; fora segue o caminho de sempre", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const carregar = vi.fn(async () => null);
    const vivos = criarConectoresVivos({ carregar, agora: () => Date.now(), antesDeChamar: exigirForaDaTx });
    const dentro = await abrirTxEscopada(db, ESCOPO)(() => vivos.chamar("c-263", "buscar", {}, { rotina: false })).catch((e: unknown) => e);
    expect(dentro).toBeInstanceOf(ErroConectorDentroDaTx);
    expect(carregar).not.toHaveBeenCalled();
    // Fora da tx: carrega (e, sem conector, cai no conector_indisponivel de sempre).
    await expect(vivos.chamar("c-263", "buscar", {}, { rotina: false })).rejects.toMatchObject({ message: expect.stringContaining("conector") });
    expect(carregar).toHaveBeenCalledTimes(1);
  });

  it("lote do pedir_aprovacao (executarItens): dentro da tx lança sem chamar o app; terminal e desmarcado não acusam; fora executa", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const chamadas: { tool: string }[] = [];
    const services = servicosDeTeste({ chamadas: chamadas as never });
    const lote: ItemAExecutar[] = [{ item: item(), conectorId: "c-263" }];
    const erro = await abrirTxEscopada(db, ESCOPO)(() => executarItens(services, lote)).catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(ErroConectorDentroDaTx);
    expect(chamadas).toHaveLength(0);
    // Sem efeito de fora (desmarcado; terminal só libera o hook): roda dentro da tx sem acusar.
    const semEfeito: ItemAExecutar[] = [{ item: item({ selecionado: false }), conectorId: "c-263" }, { item: item(), conectorId: null, terminal: true }];
    expect((await abrirTxEscopada(db, ESCOPO)(() => executarItens(services, semEfeito))).map((d) => d.desfecho)).toEqual(["retirado_pela_pessoa", "executado"]);
    expect((await executarItens(services, lote)).map((d) => d.desfecho)).toEqual(["executado"]);
    expect(chamadas).toHaveLength(1);
  });
});
