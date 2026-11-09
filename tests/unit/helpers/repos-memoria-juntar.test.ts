import { describe, expect, it } from "vitest";
import { PESSOA_ANA, PESSOA_MARLON, TENANT_PADRAO } from "../../helpers/ids.ts";
import { criarBancoMemoria } from "../../helpers/repos-memoria.ts";

/**
 * NOD-417 (revisão do PR 622): o `turnos.juntarEntrada` em memória espelha o do Postgres (src/repositories/turnos.repo.ts),
 * que é o dedup dos comentários e do início da tarefa: só junta no turno pendente da pessoa, com uma linha em branco
 * antes do texto novo, e os anexos sem repetir, na ordem em que chegaram.
 */
const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const ANA = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_ANA };

async function montar() {
  const { banco, repos } = criarBancoMemoria();
  const r = repos(MARLON);
  const t = (await r.turnos.enfileirar({ conversaId: "c1", agenteId: "a1", origem: "delegacao", prazoEm: Date.now() + 60_000, profundidade: 0, entradaTexto: "comentário", entradaAnexos: ["x", "y"], entradaConfianca: "confiavel", modelo: "m", executor: "catcher" }))!;
  return { banco, r, t, daAna: repos(ANA) };
}

describe("repos-memoria: turnos.juntarEntrada", () => {
  it("junta no pendente com a linha em branco e os anexos sem repetir, na ordem", async () => {
    const { r, t } = await montar();
    const j = await r.turnos.juntarEntrada(t.id, "início da tarefa", ["y", "z"]);
    expect(j?.id).toBe(t.id);
    expect(j?.entradaTexto).toBe("comentário\n\ninício da tarefa");
    expect(j?.entradaAnexos).toEqual(["x", "y", "z"]);
    expect((await r.turnos.buscar(t.id))?.entradaTexto).toBe("comentário\n\ninício da tarefa");
  });

  it("fora da fila ou de outra pessoa não junta (devolve null e não mexe no texto)", async () => {
    const { banco, r, t, daAna } = await montar();
    expect(await daAna.turnos.juntarEntrada(t.id, "da Ana")).toBeNull();
    banco.turnos.find((x) => x.id === t.id)!.estado = "despachando";
    expect(await r.turnos.juntarEntrada(t.id, "tarde demais")).toBeNull();
    expect((await r.turnos.buscar(t.id))?.entradaTexto).toBe("comentário");
  });

  it("revisão 2 do PR #622: com a parada pedida não junta; a profundidade fica com a maior", async () => {
    const { banco, r, t } = await montar();
    expect((await r.turnos.juntarEntrada(t.id, "mais fundo", [], { profundidade: 2 }))?.profundidade).toBe(2);
    expect((await r.turnos.juntarEntrada(t.id, "mais raso", [], { profundidade: 1 }))?.profundidade).toBe(2);
    banco.turnos.find((x) => x.id === t.id)!.pararSolicitadoEm = Date.now();
    expect(await r.turnos.juntarEntrada(t.id, "parado")).toBeNull();
  });
});
