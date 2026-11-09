import { describe, expect, it } from "vitest";
import { aplicarAtualizacaoRotina } from "../../../src/use-cases/aplicar-proposta-rotina.ts";
import { ativarRotina } from "../../../src/use-cases/ativar-rotina.ts";
import { criarRotina } from "../../../src/use-cases/criar-rotina.ts";
import { atualizarRotinaPeloAgente } from "../../../src/use-cases/rotinas-do-agente.ts";
import { contexto, depsMemoria, rotinaValida } from "../../helpers/deps-l7.ts";

const AGORA = Date.parse("2026-09-16T12:00:00-03:00");

async function bot(d: ReturnType<typeof depsMemoria>) {
  const agente = await d.deps.repos.agentes.criar({ nome: "Vera", dono: "pessoa", forma: "shape-hex", cor: "c-purple", modelo: "m" });
  const conversa = await d.deps.repos.conversas.criar({ tipo: "propria", agenteId: agente?.id ?? "" });
  return contexto(agente?.id ?? "", conversa?.id ?? "");
}

/** O payload como uma proposta aberta antes do NOD-317 o guardou: com o flag do "A fazer". */
function comFlagAntigo(d: ReturnType<typeof depsMemoria>, propostaId: string, valor: boolean): void {
  const p = d.banco.propostas.find((x) => x.id === propostaId);
  if (!p) throw new Error("proposta não achada");
  Object.assign(p.payload, { soComPendencia: valor });
}

/**
 * NOD-317 (PR 1): o "só com pendência" saiu da rotina. A coluna fica no banco até o PR 2, mas ninguém lê nem grava; o
 * campo que ainda chegue — do modelo ou de uma proposta aberta antes do deploy — é ignorado e a operação segue.
 */
describe("NOD-317: so_com_pendencia é ignorado", () => {
  it("criar_rotina com o campo antigo vira proposta sem ele", async () => {
    const d = depsMemoria({ agora: () => AGORA });
    const ctx = await bot(d);
    const r = await criarRotina(d.deps, { ...ctx, ...rotinaValida(), ...({ so_com_pendencia: true } as object) });
    if ("erro" in r.data) throw new Error(`proposta não criada: ${r.data.erro}`);
    expect("soComPendencia" in (d.banco.propostas[0]?.payload ?? {})).toBe(false);
  });

  it("proposta de criação antiga com soComPendencia: true aplica e nasce uma rotina comum", async () => {
    const d = depsMemoria({ agora: () => AGORA });
    const ctx = await bot(d);
    const r = await criarRotina(d.deps, { ...ctx, ...rotinaValida() });
    if ("erro" in r.data) throw new Error("proposta não criada");
    comFlagAntigo(d, r.data.proposta_id, true);
    const a = await ativarRotina(d.deps, { propostaId: r.data.proposta_id });
    expect(a.data.rotina).toMatchObject({ id: r.data.proposta_id, estado: "ativa" });
    expect("soComPendencia" in a.data.rotina).toBe(false);
    expect(d.banco.propostas[0]?.estado).toBe("confirmada");
  });

  it("proposta de mudança antiga com soComPendencia aplica o resto e não falha", async () => {
    const d = depsMemoria({ agora: () => AGORA });
    const ctx = await bot(d);
    const r = await criarRotina(d.deps, { ...ctx, ...rotinaValida() });
    if ("erro" in r.data) throw new Error("proposta não criada");
    await ativarRotina(d.deps, { propostaId: r.data.proposta_id });
    const up = await atualizarRotinaPeloAgente(d.deps, { ...ctx, rotina_id: r.data.proposta_id, instrucao: "retome o PR" });
    if ("erro" in up.data) throw new Error(`proposta de mudança não criada: ${up.data.erro}`);
    comFlagAntigo(d, up.data.proposta_id, true);
    const a = await aplicarAtualizacaoRotina(d.deps, { propostaId: up.data.proposta_id });
    expect(a.data.obsoleta).toBeUndefined();
    expect(a.data.rotina.instrucao).toBe("retome o PR");
    expect("soComPendencia" in a.data.rotina).toBe(false);
  });
});
