import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import type { CatalogoDeComandos } from "../../src/contracts/comandos.ts";
import type { ExecucaoRaioX } from "../../src/contracts/raio-x.ts";
import type { ResultadoTurno } from "../../src/contracts/turno.ts";
import { vincularEscopo } from "../../src/db/tx.ts";
import { assentarTurno } from "../../src/use-cases/assentar-turno.ts";
import { lerComandos, novaSessao } from "../../src/use-cases/comandos.ts";
import { criarAgente } from "../../src/use-cases/criar-agente.ts";
import { despacharTurno } from "../../src/use-cases/despachar-turno.ts";
import { editarPerfil } from "../../src/use-cases/editar-perfil.ts";
import { emitirPlanoTurno } from "../../src/use-cases/emitir-plano-turno.ts";
import { enviarMensagem } from "../../src/use-cases/enviar-mensagem.ts";
import { ANA, depsSobreTrx, esperarErro, executar, MARLON } from "../helpers/deps-l6.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

const PRONTO = { estado: "pronto" as const, versao: "teste", em: 0 };
const SINAIS = { attempted: true, rejected: false, promptSubmitted: true, producedOutput: true };
const resultado = (texto: string, extra: Partial<ResultadoTurno> = {}): ResultadoTurno => ({
  desfecho: "sucesso", texto, sessaoCli: randomUUID(), sinais: SINAIS, custoUsd: 0, tokens: { entrada: 1, saida: 1, cacheLeitura: 0, cacheCriacao: 0 },
  ferramentasChamadas: [], negacoesPermissao: [], ...extra,
});
const CATALOGO: CatalogoDeComandos = {
  versaoCli: "2.1.284",
  soDoTerminal: ["doctor"],
  comandos: [{ nome: "review", descricao: "Pre-landing PR review.", origem: "gstack" }, { nome: "posthog:auditing-endpoints", descricao: "Audita.", origem: "posthog" }],
};

type Deps = ReturnType<typeof depsSobreTrx>;
/** Envia, despacha e emite o plano pelo caso de uso real (o dublê do despacho não emite). */
async function turnoDe(deps: Deps, conversaId: string, texto: string, maquina: string) {
  await executar(deps, enviarMensagem, { conversaId, texto, inventario: PRONTO });
  const turnoId = (await executar(deps, despacharTurno, { machineId: maquina, inventario: PRONTO })).data.plano?.turnoId ?? "";
  const plano = (await executar(deps, emitirPlanoTurno, { turnoId, machineId: maquina, executor: "catcher" })).data;
  return { turnoId, plano };
}

describeIntegracao("o / do chat (0037 + 0038): esforço, catálogo do Mac, comandos da conversa e nova sessão", () => {
  it("0037: o esforço do bot vai ao plano; vazio volta ao padrão do modelo", async () => {
    await withRollback(MARLON, async (trx) => {
      const deps = depsSobreTrx(trx, MARLON);
      const { data: criado } = await executar(deps, criarAgente, { dono: "pessoa" });
      expect((await executar(deps, editarPerfil, { agenteId: criado.agente.id, esforco: "xhigh" })).data.agente.esforco).toBe("xhigh");
      const { plano } = await turnoDe(deps, criado.conversa.id, "oi", randomUUID());
      expect(plano.entrada.esforco).toBe("xhigh");
      expect((await executar(deps, editarPerfil, { agenteId: criado.agente.id, esforco: "" })).data.agente.esforco).toBeNull();
      await esperarErro(() => editarPerfil(deps, { agenteId: criado.agente.id, esforco: "turbo" }), "entrada_invalida");
    });
  });

  it("0038: o catálogo que o Mac manda na entrega fica da pessoa, e só dela", async () => {
    await withRollback(MARLON, async (trx) => {
      const deps = depsSobreTrx(trx, MARLON);
      const { data: criado } = await executar(deps, criarAgente, { dono: "pessoa" });
      expect((await executar(deps, lerComandos, {})).data).toMatchObject({ doMac: null, doMacEm: null });
      const maquina = randomUUID();
      const { turnoId } = await turnoDe(deps, criado.conversa.id, "oi", maquina);
      await executar(deps, assentarTurno, { turnoId, machineId: maquina, seqLocal: 1, fala: { tipo: "texto", texto: "ok" }, resultado: resultado("ok", { comandos: CATALOGO }) });
      const lido = (await executar(deps, lerComandos, {})).data;
      expect(lido.doMac).toEqual(CATALOGO);
      expect(lido.doMacEm).toEqual(expect.any(Number));
      expect(lido.daConversa.map((c) => c.nome)).toEqual(["contexto", "uso", "compactar", "nova-sessao", "modelo", "configurar"]);

      await vincularEscopo(trx, ANA);
      expect((await executar(depsSobreTrx(trx, ANA), lerComandos, {})).data.doMac).toBeNull();
    });
  });

  it("/contexto vai ao CLI como /context; a saída do /uso chega em português; /compactar vira a linha com os números", async () => {
    await withRollback(MARLON, async (trx) => {
      const deps = depsSobreTrx(trx, MARLON);
      const { data: criado } = await executar(deps, criarAgente, { dono: "pessoa" });
      const maquina = randomUUID();

      const contexto = await turnoDe(deps, criado.conversa.id, "/contexto", maquina);
      expect(contexto.plano.entrada.texto).toBe("/context");
      await executar(deps, assentarTurno, { turnoId: contexto.turnoId, machineId: maquina, seqLocal: 1, fala: { tipo: "texto", texto: "## Context Usage" }, resultado: resultado("## Context Usage") });

      const uso = await turnoDe(deps, criado.conversa.id, "/uso", maquina);
      expect(uso.plano.entrada.texto).toBe("/cost");
      const saida = "Current session: 10% used · resets Sep 28 at 11:20pm (America/Sao_Paulo)";
      const u = (await executar(deps, assentarTurno, { turnoId: uso.turnoId, machineId: maquina, seqLocal: 1, fala: { tipo: "texto", texto: saida }, resultado: resultado(saida) })).data;
      expect(u.mensagem?.texto).toBe("- Sessão atual: **10%** · renova 28/09 às 23:20");

      const compactar = await turnoDe(deps, criado.conversa.id, "/compactar guarda o PR 420", maquina);
      expect(compactar.plano.entrada.texto).toBe("/compact guarda o PR 420");
      const execucao: ExecucaoRaioX = { chamadas: [], chamadasOmitidas: 0, compactacoes: [{ em: 10, antes: 104_800, depois: 12_400, gatilho: "manual" }], janela: 1_000_000, modelo: "sonnet", versaoCli: "2.1.284", custoSessaoUsd: 0.02, ferramentasNoInit: 3, buscaDeFerramentas: true, duracaoMs: 900 };
      // Medido ao vivo: o CLI devolve como resultado do /compact a saída do /context anterior. Ela não vira mensagem.
      const c = (await executar(deps, assentarTurno, { turnoId: compactar.turnoId, machineId: maquina, seqLocal: 1, fala: { tipo: "texto", texto: "## Context Usage" }, resultado: resultado("## Context Usage", { execucao }) })).data;
      expect(c.mensagem).toMatchObject({ kind: "sistema", texto: "Conversa compactada · 104,8 mil → 12,4 mil tokens. Novo agente continua daqui, com o resumo." });
    });
  });

  it("/nova-sessao: sem sessão para retomar, e o histórico do prompt recomeça depois da linha", async () => {
    await withRollback(MARLON, async (trx) => {
      const deps = depsSobreTrx(trx, MARLON);
      const { data: criado } = await executar(deps, criarAgente, { dono: "pessoa" });
      const maquina = randomUUID();
      const antes = await turnoDe(deps, criado.conversa.id, "a senha do cofre é ABACAXI", maquina);
      await executar(deps, assentarTurno, { turnoId: antes.turnoId, machineId: maquina, seqLocal: 1, fala: { tipo: "texto", texto: "anotado" }, resultado: resultado("anotado") });
      expect((await deps.repos.conversas.buscar(criado.conversa.id))?.sessaoCli).toEqual(expect.any(String));

      const r = (await executar(deps, novaSessao, { conversaId: criado.conversa.id })).data;
      expect(r.mensagem).toMatchObject({ kind: "sistema", texto: expect.stringContaining("Nova sessão") });
      expect(await deps.repos.conversas.buscar(criado.conversa.id)).toMatchObject({ sessaoCli: null, recomecoEm: expect.any(Number) });

      const depois = await turnoDe(deps, criado.conversa.id, "qual era a senha?", maquina);
      expect(depois.plano.entrada.sessaoCli).toBeNull();
      expect(depois.plano.promptSistema).not.toContain("ABACAXI");
      await esperarErro(() => novaSessao(deps, { conversaId: randomUUID() }), "nao_encontrado");
    });
  });
});
