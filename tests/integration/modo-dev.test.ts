import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { QUADROS_COM_EXIBIR_MAX, type ExecucaoRaioX } from "../../src/contracts/raio-x.ts";
import type { ResultadoTurno } from "../../src/contracts/turno.ts";
import { vincularEscopo } from "../../src/db/tx.ts";
import { assentarTurno } from "../../src/use-cases/assentar-turno.ts";
import { criarAgente } from "../../src/use-cases/criar-agente.ts";
import { despacharTurno } from "../../src/use-cases/despachar-turno.ts";
import { emitirPlanoTurno } from "../../src/use-cases/emitir-plano-turno.ts";
import { enviarMensagem } from "../../src/use-cases/enviar-mensagem.ts";
import { exibirDoQuadro, fecharAviso, gravarPreferencias, lerPreferencias, raioXDaConversa, raioXDoTurno } from "../../src/use-cases/raio-x.ts";
import { ANA, depsSobreTrx, esperarErro, executar, MARLON } from "../helpers/deps-l6.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

const PRONTO = { estado: "pronto" as const, versao: "teste", em: 0 };
const SINAIS = { attempted: true, rejected: false, promptSubmitted: true, producedOutput: true };
const resultado = (custoSessao: number, sessaoCli: string, extra: Partial<ResultadoTurno> = {}): ResultadoTurno => ({
  desfecho: "sucesso",
  texto: "feito",
  sessaoCli,
  sinais: SINAIS,
  custoUsd: custoSessao,
  tokens: { entrada: 120, saida: 30, cacheLeitura: 0, cacheCriacao: 0 },
  ferramentasChamadas: [],
  negacoesPermissao: [],
  ...extra,
});
const EXECUCAO: ExecucaoRaioX = {
  chamadas: [
    { em: 1000, contexto: 160_500, entrada: 10, cacheLido: 150_000, cacheNovo: 10_490, saida: 300, pensamento: 120, subagente: false, ferramentas: [{ nome: "mcp__nod__clickup__GET_TASKS", resultadoChars: 73_900, erro: false }] },
    { em: 30_000, contexto: 181_800, entrada: 8, cacheLido: 181_000, cacheNovo: 792, saida: 200, pensamento: 0, subagente: false, ferramentas: [] },
  ],
  chamadasOmitidas: 0,
  compactacoes: [{ em: 29_000, antes: 179_900, depois: 22_700, gatilho: "auto" }],
  janela: 200_000,
  modelo: "claude-sonnet-5",
  versaoCli: "2.1.284",
  custoSessaoUsd: 9.68,
  ferramentasNoInit: 40,
  buscaDeFerramentas: true,
  duracaoMs: 31_000,
  // Chat limpo (PR 1): o número de blocos que a fala colou acima da final é gravado e volta no GET do Raio-X.
  blocosColados: 1,
};

/**
 * O dublê de `planos.emitir` das deps da L6 monta o plano pelo domínio; aqui o turno despachado é emitido de novo
 * pelo caso de uso real, como o servidor faz no PUXAR, para a composição ser gravada.
 */
async function despacharEmitindo(deps: ReturnType<typeof depsSobreTrx>, machineId: string): Promise<string> {
  const turnoId = (await executar(deps, despacharTurno, { machineId, inventario: PRONTO })).data.plano?.turnoId ?? "";
  await executar(deps, emitirPlanoTurno, { turnoId, machineId, executor: "catcher" });
  return turnoId;
}

describeIntegracao("modo dev (0035 + 0036): o custo de cada turno e o Raio-X", () => {
  it("0035: numa sessão retomada, cada turno custa a diferença para o total que o anterior registrou", async () => {
    await withRollback(MARLON, async (trx) => {
      const deps = depsSobreTrx(trx, MARLON);
      const { data: criado } = await executar(deps, criarAgente, { dono: "pessoa" });
      const sessao = randomUUID();
      const maquina = randomUUID();
      const custos: (number | null)[] = [];
      for (const [i, total] of [8.35, 8.8, 9.68].entries()) {
        await executar(deps, enviarMensagem, { conversaId: criado.conversa.id, texto: `pedido ${i}`, inventario: PRONTO });
        const turnoId = (await executar(deps, despacharTurno, { machineId: maquina, inventario: PRONTO })).data.plano?.turnoId ?? "";
        const a = (await executar(deps, assentarTurno, { turnoId, machineId: maquina, seqLocal: i + 1, fala: { tipo: "texto", texto: "feito" }, resultado: resultado(total, sessao) })).data;
        custos.push(a.turno?.custoUsd ?? null);
        expect((await deps.repos.gastos.doTurno(turnoId)).map((g) => g.custoUsd)).toEqual([a.turno?.custoUsd]);
      }
      expect(custos).toEqual([8.35, 0.45, 0.88]);
      // O total do dia soma o custo de cada turno, e não os totais da sessão (que dariam 26,83).
      const dia = (await executar(deps, raioXDaConversa, { conversaId: criado.conversa.id, desde: 0 })).data;
      expect(dia.desde).toEqual({ custoUsd: 9.68, turnos: 3 });
    });
  });

  it("0036: a emissão grava a composição (texto só com modo dev), a entrega grava a execução, e a conversa resume", async () => {
    await withRollback(MARLON, async (trx) => {
      const deps = depsSobreTrx(trx, MARLON);
      const { data: criado } = await executar(deps, criarAgente, { dono: "pessoa" });
      const maquina = randomUUID();

      await executar(deps, enviarMensagem, { conversaId: criado.conversa.id, texto: "sem modo dev", inventario: PRONTO });
      const t1 = await despacharEmitindo(deps, maquina);
      const semTexto = (await executar(deps, raioXDoTurno, { turnoId: t1 })).data;
      expect(semTexto.composicao).toMatchObject({ comTexto: false, entrada: { chars: "sem modo dev".length, anexos: 0 }, sessaoRetomada: false });
      expect(semTexto.composicao?.prompt.length).toBeGreaterThan(0);
      expect(semTexto.composicao?.prompt.every((p) => p.texto === undefined)).toBe(true);
      expect(semTexto.execucao).toBeNull();
      await executar(deps, assentarTurno, { turnoId: t1, machineId: maquina, seqLocal: 1, fala: { tipo: "texto", texto: "ok" }, resultado: resultado(0.5, randomUUID()) });

      expect((await executar(deps, lerPreferencias, {})).data).toEqual({ modoDev: false, avisosFechados: [], usoDoMac: "equilibrado", maquinaPadraoId: null, ordemIas: null, iasNoLimite: {}, quadroLiberado: true, experimentos: { calibracao: false, memoriaLonga: false, whatsapp: false, quadro: false }, quadroExibir: {} });
      expect((await executar(deps, gravarPreferencias, { modoDev: true })).data).toEqual({ modoDev: true, avisosFechados: [], usoDoMac: "equilibrado", maquinaPadraoId: null, ordemIas: null, iasNoLimite: {}, quadroLiberado: true, experimentos: { calibracao: false, memoriaLonga: false, whatsapp: false, quadro: false }, quadroExibir: {} });
      // Corpo vazio é recusado. ADR-099 (I10): `faixaTrabalhosRecolhida` saiu do contrato — vinda sozinha, é corpo vazio.
      await expect(executar(deps, gravarPreferencias, {})).rejects.toMatchObject({ codigo: "entrada_invalida" });
      await expect(executar(deps, gravarPreferencias, { faixaTrabalhosRecolhida: true } as never)).rejects.toMatchObject({ codigo: "entrada_invalida" });
      expect((await executar(deps, gravarPreferencias, { modoDev: false })).data).not.toHaveProperty("faixaTrabalhosRecolhida");
      await executar(deps, gravarPreferencias, { modoDev: true });
      await esperarErro(() => gravarPreferencias(deps, { modoDev: "sim" }), "entrada_invalida");

      await executar(deps, enviarMensagem, { conversaId: criado.conversa.id, texto: "com modo dev", inventario: PRONTO });
      const t2 = await despacharEmitindo(deps, maquina);
      await executar(deps, assentarTurno, { turnoId: t2, machineId: maquina, seqLocal: 1, fala: { tipo: "texto", texto: "ok" }, resultado: resultado(1.02, randomUUID(), { execucao: EXECUCAO }) });

      const r = (await executar(deps, raioXDoTurno, { turnoId: t2 })).data;
      expect(r).toMatchObject({ turnoId: t2, estado: "concluido", custoUsd: 1.02, execucao: EXECUCAO, composicao: { comTexto: true, entrada: { texto: "com modo dev" } } });
      expect(r.composicao?.prompt.find((p) => p.secao === "identidade")?.texto).toContain("um agente do nod");
      // NOD-352: o nome amigável de cada ferramenta das chamadas, para o title do Raio-X.
      expect(r.nomesDasFerramentas).toEqual({ "mcp__nod__clickup__GET_TASKS": "Consultou Clickup" });
      expect(semTexto.nomesDasFerramentas).toEqual({});
      expect(JSON.stringify(r.composicao)).not.toContain(`tok-${t2}`);

      const conversa = (await executar(deps, raioXDaConversa, { conversaId: criado.conversa.id, desde: 0 })).data;
      expect(conversa.turnos.map((t) => t.turnoId)).toEqual([t2, t1]);
      expect(conversa.turnos[0]).toEqual({ turnoId: t2, custoUsd: 1.02, chamadas: 2, compactacoes: 1, picoContexto: 181_800, janela: 200_000, cachePct: 97, modelo: "claude-sonnet-5" });
      expect(conversa.turnos[1]).toMatchObject({ turnoId: t1, custoUsd: 0.5, chamadas: 0, picoContexto: null });
    });
  });

  it("0036: o Raio-X e a preferência são privados da pessoa", async () => {
    await withRollback(MARLON, async (trx) => {
      const deps = depsSobreTrx(trx, MARLON);
      const { data: criado } = await executar(deps, criarAgente, { dono: "pessoa" });
      await executar(deps, gravarPreferencias, { modoDev: true });
      await executar(deps, enviarMensagem, { conversaId: criado.conversa.id, texto: "privado", inventario: PRONTO });
      const turnoId = await despacharEmitindo(deps, randomUUID());
      expect((await executar(deps, raioXDoTurno, { turnoId })).data.composicao?.comTexto).toBe(true);

      await vincularEscopo(trx, ANA);
      const daAna = depsSobreTrx(trx, ANA);
      await esperarErro(() => raioXDoTurno(daAna, { turnoId }), "nao_encontrado");
      expect(await trx`select 1 from turno_raio_x where turno_id = ${turnoId}`).toHaveLength(0);
      expect((await executar(daAna, lerPreferencias, {})).data).toEqual({ modoDev: false, avisosFechados: [], usoDoMac: "equilibrado", maquinaPadraoId: null, ordemIas: null, iasNoLimite: {}, quadroLiberado: true, experimentos: { calibracao: false, memoriaLonga: false, whatsapp: false, quadro: false }, quadroExibir: {} });
      expect((await executar(daAna, raioXDaConversa, { conversaId: criado.conversa.id, desde: 0 })).data).toEqual({ turnos: [], desde: { custoUsd: 0, turnos: 0 } });
    });
  });

  it("0059: o aviso fechado fica com a pessoa — sem repetir, sem apagar o modo dev, privado e com chave fechada", async () => {
    await withRollback(MARLON, async (trx) => {
      const deps = depsSobreTrx(trx, MARLON);
      expect((await executar(deps, fecharAviso, { chave: "modo:total" })).data).toEqual({ modoDev: false, avisosFechados: ["modo:total"], usoDoMac: "equilibrado", maquinaPadraoId: null, ordemIas: null, iasNoLimite: {}, quadroLiberado: true, experimentos: { calibracao: false, memoriaLonga: false, whatsapp: false, quadro: false }, quadroExibir: {} });
      await executar(deps, gravarPreferencias, { modoDev: true });
      await executar(deps, fecharAviso, { chave: "modo:total" });
      expect((await executar(deps, fecharAviso, { chave: "modo:automatico" })).data).toEqual({ modoDev: true, avisosFechados: ["modo:total", "modo:automatico"], usoDoMac: "equilibrado", maquinaPadraoId: null, ordemIas: null, iasNoLimite: {}, quadroLiberado: true, experimentos: { calibracao: false, memoriaLonga: false, whatsapp: false, quadro: false }, quadroExibir: {} });
      expect((await executar(deps, lerPreferencias, {})).data.avisosFechados).toEqual(["modo:total", "modo:automatico"]);
      for (const chave of ["", "Modo:total", "modo:total; drop", "x".repeat(80), 42]) await esperarErro(() => fecharAviso(deps, { chave }), "entrada_invalida");

      await vincularEscopo(trx, ANA);
      expect((await executar(depsSobreTrx(trx, ANA), lerPreferencias, {})).data.avisosFechados).toEqual([]);
    });
  });

  it("0149 (NOD-460): o Exibir do quadro é da pessoa e de cada quadro — substitui o daquele, guarda os outros e recusa o inválido", async () => {
    await withRollback(MARLON, async (trx) => {
      const deps = depsSobreTrx(trx, MARLON);
      const q1 = randomUUID();
      const q2 = randomUUID();
      await executar(deps, gravarPreferencias, { modoDev: true });
      expect((await executar(deps, exibirDoQuadro, { quadroId: q1.toUpperCase(), recolhidas: false, compacto: true })).data.quadroExibir).toEqual({ [q1]: { recolhidas: false, compacto: true } });
      await executar(deps, exibirDoQuadro, { quadroId: q2, recolhidas: true, compacto: true });
      const lido = (await executar(deps, exibirDoQuadro, { quadroId: q1, recolhidas: true, compacto: false })).data;
      expect(lido.quadroExibir).toEqual({ [q1]: { recolhidas: true, compacto: false }, [q2]: { recolhidas: true, compacto: true } });
      // Não apaga o resto das preferências.
      expect(lido.modoDev).toBe(true);
      expect((await executar(deps, lerPreferencias, {})).data.quadroExibir).toEqual(lido.quadroExibir);
      for (const e of [{ quadroId: "q1", recolhidas: true, compacto: true }, { quadroId: q1, recolhidas: "sim", compacto: true }, { quadroId: q1 }, { quadroId: q1, visao: "grade" }, { quadroId: q1, visao: 1 }, { quadroId: q1, compacto: null }, { quadroId: 42, recolhidas: true, compacto: false }]) {
        await esperarErro(() => exibirDoQuadro(deps, e as never), "entrada_invalida");
      }

      await vincularEscopo(trx, ANA);
      expect((await executar(depsSobreTrx(trx, ANA), lerPreferencias, {})).data.quadroExibir).toEqual({});
    });
  });

  it("ADA-18: a visão do celular entra no Exibir do quadro sem apagar as recolhidas, e as recolhidas não apagam a visão", async () => {
    await withRollback(MARLON, async (trx) => {
      const deps = depsSobreTrx(trx, MARLON);
      const q1 = randomUUID();
      // Só a visão, num quadro sem Exibir: o padrão da tela embaixo.
      expect((await executar(deps, exibirDoQuadro, { quadroId: q1, visao: "colunas" })).data.quadroExibir?.[q1]).toEqual({ recolhidas: true, compacto: false, visao: "colunas" });
      // O computador muda as recolhidas: a visão fica.
      expect((await executar(deps, exibirDoQuadro, { quadroId: q1, recolhidas: false, compacto: true })).data.quadroExibir?.[q1]).toEqual({ recolhidas: false, compacto: true, visao: "colunas" });
      // O celular troca a visão: as recolhidas ficam.
      expect((await executar(deps, exibirDoQuadro, { quadroId: q1, visao: "minhas" })).data.quadroExibir?.[q1]).toEqual({ recolhidas: false, compacto: true, visao: "minhas" });
      expect((await executar(deps, lerPreferencias, {})).data.quadroExibir?.[q1]?.visao).toBe("minhas");
    });
  });

  it("0149 (NOD-460): o teto de quadros com Exibir guardado recusa o novo, mas o já guardado ainda muda", async () => {
    await withRollback(MARLON, async (trx) => {
      const deps = depsSobreTrx(trx, MARLON);
      const cheio = Object.fromEntries(Array.from({ length: QUADROS_COM_EXIBIR_MAX }, () => [randomUUID(), { recolhidas: true, compacto: false }]));
      await trx`insert into preferencias (tenant_id, owner_id, quadro_exibir) values (${MARLON.tenantId}, ${MARLON.pessoaId}, ${trx.json(cheio)})
        on conflict (tenant_id, owner_id) do update set quadro_exibir = excluded.quadro_exibir`;
      await esperarErro(() => exibirDoQuadro(deps, { quadroId: randomUUID(), recolhidas: false, compacto: false }), "entrada_invalida");
      const um = Object.keys(cheio)[0]!;
      expect((await executar(deps, exibirDoQuadro, { quadroId: um, recolhidas: false, compacto: true })).data.quadroExibir?.[um]).toEqual({ recolhidas: false, compacto: true });
    });
  });

  it("0149 (QA do PR #645): um abaixo do teto ainda aceita o novo (chega a 200) e o seguinte é recusado no próprio upsert", async () => {
    await withRollback(MARLON, async (trx) => {
      const deps = depsSobreTrx(trx, MARLON);
      const quase = Object.fromEntries(Array.from({ length: QUADROS_COM_EXIBIR_MAX - 1 }, () => [randomUUID(), { recolhidas: true, compacto: false }]));
      await trx`insert into preferencias (tenant_id, owner_id, quadro_exibir) values (${MARLON.tenantId}, ${MARLON.pessoaId}, ${trx.json(quase)})
        on conflict (tenant_id, owner_id) do update set quadro_exibir = excluded.quadro_exibir`;
      const r = await executar(deps, exibirDoQuadro, { quadroId: randomUUID(), recolhidas: false, compacto: false });
      expect(Object.keys(r.data.quadroExibir ?? {})).toHaveLength(QUADROS_COM_EXIBIR_MAX);
      // O repositório sozinho (sem o caso de uso) também recusa: o teto mora no SQL.
      expect(await deps.repos.preferencias.exibirQuadro(randomUUID(), { recolhidas: true, compacto: true }, QUADROS_COM_EXIBIR_MAX)).toBeNull();
      const [n] = await trx<{ n: number }[]>`select count(*)::int as n from preferencias, jsonb_object_keys(quadro_exibir) where tenant_id = ${MARLON.tenantId} and owner_id = ${MARLON.pessoaId}`;
      expect(n!.n).toBe(QUADROS_COM_EXIBIR_MAX);
    });
  });
});
