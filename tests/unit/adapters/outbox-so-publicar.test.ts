import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ItemOutbox } from "../../../src/repositories/outbox.repo.ts";
import type { Barramento } from "../../../src/services/barramento.ts";
import type { Conn, Escopo } from "../../../src/shared/types.ts";

/**
 * NOD-331 (item 7): o modo "só ligações" da drenagem (`soPublicar`) publica no barramento local o que a cor ativa já
 * entregou, sem nunca marcar, contar tentativa ou abandonar (quem faz isso é a ativa). Cada item sai uma vez por
 * processo (`vistos`). Repos falsos de outbox por `vi.mock` de `criarRepos`.
 */
const outbox = {
  pendentes: vi.fn<(limite?: number) => Promise<ItemOutbox[]>>(),
  paraPublicar: vi.fn<(o: { desde: Date; excluir: string[]; limite?: number }) => Promise<ItemOutbox[]>>(),
  marcarEntregue: vi.fn(async (_id: string) => undefined),
  incrementarTentativa: vi.fn(async (_id: string) => undefined),
  abandonar: vi.fn(async () => 0),
  contarAbandonados: vi.fn(async () => 0),
};
vi.mock("../../../src/repositories/index.ts", () => ({ criarRepos: () => ({ outbox }) }));

const { despacharPessoa } = await import("../../../src/adapters/fundo/despachar-outbox.ts");

const conn = {} as Conn;
const escopo: Escopo = { tenantId: "t", pessoaId: "p" };
const item = (id: string): ItemOutbox => ({ id, eventoId: `ev-${id}`, tipo: "mensagem_criada", dados: {}, tentativas: 0, criadoEm: "2026-10-22T00:00:00Z", conversaId: "c", turnoId: null });

function barramento(falharEm: string[] = []) {
  const publicados: string[] = [];
  const b = {
    publicar: (_p: string, _t: string, dados: Record<string, unknown>) => {
      const id = String(dados.eventoId).replace(/^ev-/, "");
      if (falharEm.includes(id)) throw new Error("barramento fora");
      publicados.push(id);
      return null;
    },
  } as unknown as Barramento;
  return { b, publicados };
}

describe("despacharPessoa com soPublicar (NOD-331)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    outbox.pendentes.mockResolvedValue([]);
    outbox.paraPublicar.mockResolvedValue([]);
  });

  it("lê por paraPublicar({desde, excluir: vistos}) e não por pendentes; publica e põe em vistos; nunca marca, conta ou abandona", async () => {
    const desde = new Date("2026-10-22T12:00:00Z");
    const vistos = new Set(["antigo"]);
    outbox.paraPublicar.mockResolvedValue([item("a"), item("b")]);
    const { b, publicados } = barramento();
    const r = await despacharPessoa(conn, escopo, b, { soPublicar: { vistos, desde }, limite: 50 });
    expect(outbox.paraPublicar).toHaveBeenCalledWith({ desde, excluir: ["antigo"], limite: 50 });
    expect(outbox.pendentes).not.toHaveBeenCalled();
    expect(publicados).toEqual(["a", "b"]);
    expect([...vistos].sort()).toEqual(["a", "antigo", "b"]);
    expect(r).toEqual({ publicados: 2, falhas: 0, abandonadosAgora: 0 });
    expect(outbox.marcarEntregue).not.toHaveBeenCalled();
    expect(outbox.incrementarTentativa).not.toHaveBeenCalled();
    expect(outbox.abandonar).not.toHaveBeenCalled();
  });

  it("id já em vistos não sai de novo (mesmo que o repo o devolva)", async () => {
    const vistos = new Set(["a"]);
    outbox.paraPublicar.mockResolvedValue([item("a"), item("b")]);
    const { b, publicados } = barramento();
    const r = await despacharPessoa(conn, escopo, b, { soPublicar: { vistos, desde: new Date() } });
    expect(publicados).toEqual(["b"]);
    expect(r.publicados).toBe(1);
  });

  it("falha ao publicar: o id entra em vistos e conta falha, sem tentativa no banco", async () => {
    const vistos = new Set<string>();
    outbox.paraPublicar.mockResolvedValue([item("a"), item("b")]);
    const { b, publicados } = barramento(["a"]);
    const r = await despacharPessoa(conn, escopo, b, { soPublicar: { vistos, desde: new Date() } });
    expect(publicados).toEqual(["b"]);
    expect(vistos.has("a")).toBe(true);
    expect(r).toEqual({ publicados: 1, falhas: 1, abandonadosAgora: 0 });
    expect(outbox.incrementarTentativa).not.toHaveBeenCalled();
    expect(outbox.marcarEntregue).not.toHaveBeenCalled();
  });

  it("controle, sem soPublicar: lê pendentes e marca entregue", async () => {
    outbox.pendentes.mockResolvedValue([item("a")]);
    const { b, publicados } = barramento();
    const r = await despacharPessoa(conn, escopo, b, { varrerAbandono: false });
    expect(outbox.paraPublicar).not.toHaveBeenCalled();
    expect(publicados).toEqual(["a"]);
    expect(outbox.marcarEntregue).toHaveBeenCalledWith("a");
    expect(r.publicados).toBe(1);
  });
});
