import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ErroDeDominio } from "../../../src/domain/erro.ts";
import { ROTINAS_POR_AGENTE } from "../../../src/shared/constantes.ts";
import { ativarRotina } from "../../../src/use-cases/ativar-rotina.ts";
import { criarRotina, criarRotinaPelaPessoa } from "../../../src/use-cases/criar-rotina.ts";
import { contexto, depsMemoria, rotinaValida } from "../../helpers/deps-l7.ts";
import { PESSOA_MARLON } from "../../helpers/ids.ts";

const TZ = "America/Sao_Paulo";
// quarta, 16/09/2026 12:00 em São Paulo
const AGORA = Date.parse("2026-09-16T12:00:00-03:00");

async function bot(d: ReturnType<typeof depsMemoria>) {
  const agente = await d.deps.repos.agentes.criar({ nome: "Vera", dono: "pessoa", forma: "shape-hex", cor: "c-purple", modelo: "m" });
  const conversa = await d.deps.repos.conversas.criar({ tipo: "propria", agenteId: agente?.id ?? "" });
  return { agenteId: agente?.id ?? "", conversaId: conversa?.id ?? "" };
}

describe("criarRotina (ferramenta, origem agente)", () => {
  it("vira proposta 'rotina' com payload normalizado + decisão tipo 'rotina' com o MESMO id; ZERO rotinas antes de confirmar", async () => {
    const d = depsMemoria({ agora: () => AGORA });
    const { agenteId, conversaId } = await bot(d);
    const r = await criarRotina(d.deps, { ...contexto(agenteId, conversaId), ...rotinaValida() });
    expect("erro" in r.data).toBe(false);
    if ("erro" in r.data) return;
    // TZ=UTC do processo é irrelevante: o cálculo usa o fuso nomeado. Quinta 17/09 08:00 SP = 11:00Z.
    expect(new Date(r.data.proxima_execucao).toISOString()).toBe("2026-09-17T11:00:00.000Z");
    expect(r.data.resumo).toBe(`dias úteis às 08:00 (${TZ})`);
    expect(d.banco.rotinas).toHaveLength(0);
    const proposta = d.banco.propostas[0];
    expect(proposta).toMatchObject({ id: r.data.proposta_id, kind: "rotina", estado: "pendente" });
    expect(proposta?.payload).toMatchObject({ kind: "rotina", cron: "0 8 * * 1-5", fusoIana: TZ, proximaExecucao: r.data.proxima_execucao, resumo: r.data.resumo });
    expect(d.banco.decisoes.map((x) => [x.id, x.tipo, x.estado])).toEqual([[r.data.proposta_id, "rotina", "pendente"]]);
    expect(r.events?.map((e) => e.kind)).toEqual(["proposta_criada", "decisao_criada"]);
  });

  it("erros de domínio voltam TIPADOS no resultado: fuso offset, cron sem futuro, campo vazio", async () => {
    const d = depsMemoria({ agora: () => AGORA });
    const { agenteId, conversaId } = await bot(d);
    const ctx = contexto(agenteId, conversaId);
    expect((await criarRotina(d.deps, { ...ctx, ...rotinaValida({ fuso_iana: "+03:00" }) })).data).toEqual({ erro: "fuso_invalido" });
    expect((await criarRotina(d.deps, { ...ctx, ...rotinaValida({ fuso_iana: "UTC-3" }) })).data).toEqual({ erro: "fuso_invalido" });
    expect((await criarRotina(d.deps, { ...ctx, ...rotinaValida({ cron: "0 8 31 2 *" }) })).data).toEqual({ erro: "cron_sem_futuro" });
    expect((await criarRotina(d.deps, { ...ctx, ...rotinaValida({ instrucao: "  " }) })).data).toEqual({ erro: "entrada_invalida" });
    expect(d.banco.propostas).toHaveLength(0);
  });

  it("a 51ª rotina do bot é recusada com limite_atingido (Grok Bot: 50)", async () => {
    const d = depsMemoria({ agora: () => AGORA });
    const { agenteId, conversaId } = await bot(d);
    for (let i = 0; i < ROTINAS_POR_AGENTE; i++) {
      await d.deps.repos.rotinas.criar({ agenteId, conversaId, cron: "0 8 * * *", fusoIana: TZ, instrucao: "i", fonte: "f", entregavel: "e", limitesAprovacao: "l", politicaSemDado: "p", proximaExecucao: AGORA });
    }
    expect((await criarRotina(d.deps, { ...contexto(agenteId, conversaId), ...rotinaValida() })).data).toEqual({ erro: "limite_atingido" });
  });

  it("ativarRotina aplica a operação normalizada: rotina ativa com o id da proposta, decisão decidida, mensagem com fuso nomeado; segunda ativação é idempotente", async () => {
    const d = depsMemoria({ agora: () => AGORA });
    const { agenteId, conversaId } = await bot(d);
    const r = await criarRotina(d.deps, { ...contexto(agenteId, conversaId), ...rotinaValida() });
    if ("erro" in r.data) throw new Error("proposta não criada");
    const a = await ativarRotina(d.deps, { propostaId: r.data.proposta_id });
    expect(a.data.jaExistia).toBe(false);
    expect(a.data.rotina).toMatchObject({ id: r.data.proposta_id, estado: "ativa", exigeAprovacao: true, fusoIana: TZ, cron: "0 8 * * 1-5", proximaExecucao: r.data.proxima_execucao });
    expect(d.banco.propostas[0]?.estado).toBe("confirmada");
    expect(d.banco.decisoes[0]?.estado).toBe("decidida");
    const sistema = d.banco.mensagens.find((m) => m.kind === "sistema");
    expect(sistema?.texto).toBe(`Rotina ativa: dias úteis às 08:00 (${TZ}) · próxima execução: 17/09/2026, 08:00.`);
    expect(a.events?.map((e) => e.kind)).toEqual(["rotina_criada", "decisao_decidida"]);
    const de_novo = await ativarRotina(d.deps, { propostaId: r.data.proposta_id });
    expect(de_novo.data.jaExistia).toBe(true);
    expect(d.banco.rotinas).toHaveLength(1);
  });

  it("criarRotinaPelaPessoa (POST rotinas) LANÇA: fuso_invalido, limite_atingido, nao_encontrado; e cria a rotina ativa quando válida", async () => {
    const d = depsMemoria({ agora: () => AGORA });
    const { agenteId } = await bot(d);
    const base = { agenteId, cron: "0 8 * * *", fusoIana: TZ, instrucao: "i", fonte: "f", entregavel: "e", limitesAprovacao: "l", politicaSemDado: "p" };
    await expect(criarRotinaPelaPessoa(d.deps, { ...base, fusoIana: "+03:00" })).rejects.toMatchObject({ codigo: "fuso_invalido" });
    await expect(criarRotinaPelaPessoa(d.deps, { ...base, agenteId: randomUUID() })).rejects.toMatchObject({ codigo: "nao_encontrado" });
    const ok = await criarRotinaPelaPessoa(d.deps, base);
    expect(ok.data.rotina).toMatchObject({ estado: "ativa", exigeAprovacao: true, ownerId: PESSOA_MARLON });
    expect(ok.events?.map((e) => e.kind)).toEqual(["rotina_criada"]);
    for (let i = 1; i < ROTINAS_POR_AGENTE; i++) await criarRotinaPelaPessoa(d.deps, base);
    let erro: unknown;
    try {
      await criarRotinaPelaPessoa(d.deps, base);
    } catch (e) {
      erro = e;
    }
    expect(erro).toBeInstanceOf(ErroDeDominio);
    expect((erro as ErroDeDominio).codigo).toBe("limite_atingido");
  });
});
