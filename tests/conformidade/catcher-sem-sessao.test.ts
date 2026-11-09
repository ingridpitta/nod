import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { catcherDriver } from "../../src/adapters/executor/drivers/catcher.ts";
import type { SinksTurno } from "../../src/adapters/executor/spi.ts";
import type { PlanoTurno } from "../../src/contracts/plano-turno.ts";
import type { EventoStream, ResultadoTurno } from "../../src/contracts/turno.ts";
import { criarTokenTurno } from "../../src/services/token-turno.ts";
import { assentarTurno } from "../../src/use-cases/assentar-turno.ts";
import { emitirPlanoTurno } from "../../src/use-cases/emitir-plano-turno.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { depsSobre, servicosDeTeste } from "../helpers/l5.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/**
 * NOD-281, critério 6 (conformidade): o catcher não tem CLI, então não tem sessão nem custo. Turno executado por ele
 * fica com `sessao_cli` null e custo 0, mesmo quando o plano chega com a sessão de um CLI de verdade (a pessoa trocou
 * de executor no meio da conversa): ecoar essa sessão virava `--resume` fantasma no claude-cli (0005, 2026-09-16).
 * Só o marcador de teste `[[sessao: …]]`/`[[custo: …]]` do roteiro (S9) reporta algo, e ele nunca nasce do roteiro padrão.
 */
const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };

function sinksMudos(eventos: EventoStream[] = []): SinksTurno {
  return { async sinal() {}, evento: (e) => eventos.push(e), delta: () => {} };
}

async function rodar(plano: PlanoTurno): Promise<{ resultado: ResultadoTurno; eventos: EventoStream[] }> {
  const inst = await catcherDriver.create({ env: {}, cwdBase: "/tmp/nao-usado" });
  const eventos: EventoStream[] = [];
  const resultado = await inst.adapter(plano).rodarTurno(sinksMudos(eventos));
  return { resultado, eventos };
}

describe("conformidade: o roteiro do catcher só fabrica sessão ou custo pelo marcador de teste", () => {
  it("o driver tira a sessão só de sessaoDoRoteiro e não gera uuid", async () => {
    const codigo = await readFile(join(process.cwd(), "src/adapters/executor/drivers/catcher.ts"), "utf8");
    expect(codigo).toMatch(/const sessaoCli: string \| null = sessaoDoRoteiro\(roteiro\);/);
    expect(codigo).not.toMatch(/randomUUID|crypto\.randomUUID|uuidv4/);
    expect(codigo).not.toMatch(/sessaoCli:\s*plano\.entrada\.sessaoCli/);
  });
});

describeIntegracao("conformidade: turno do catcher fica com sessao_cli null e custo 0 (NOD-281)", () => {
  it("o turno do catcher que continua a conversa de um claude-cli com sessão assenta sem sessão e sem custo", async () => {
    await withRollback(MARLON, async (trx) => {
      const base = await agenteComConversa(trx, MARLON, { nome: "Eng 1" });
      await base.repos.agentes.atualizarPerfil(base.agenteId, { confirmado: true });
      const agora = () => Date.now();
      const deps = depsSobre(base.repos, MARLON, { services: servicosDeTeste({ agora, tokens: criarTokenTurno({ agora }) }), agora, trx });
      const enfileirar = (texto: string) =>
        base.repos.turnos.enfileirar({ executor: "catcher", conversaId: base.conversaId, agenteId: base.agenteId, origem: "conversa", prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: texto, entradaConfianca: "confiavel", modelo: "sonnet", harness: "claude-cli" });

      // Um turno anterior com sessão de CLI de verdade na mesma conversa (a pessoa trocou de executor).
      const anterior = (await enfileirar("antes"))!;
      await trx`update turnos set executor = 'local', sessao_cli = 'sessao-do-claude', estado = 'concluido' where id = ${anterior.id}`;

      const ids: string[] = [];
      for (const texto of ["oi, tudo bem?", "resume o dia", "x".repeat(5_000)]) {
        const t = (await enfileirar(texto))!;
        const machineId = randomUUID();
        expect((await base.repos.turnos.reivindicar({ machineId, agora: Date.now() }))?.id).toBe(t.id);
        const plano = (await emitirPlanoTurno(deps, { turnoId: t.id, machineId, executor: "catcher" })).data;
        // Mesmo que o plano traga uma sessão (a da cadeia ou uma forjada), o catcher não a devolve.
        const { resultado, eventos } = await rodar({ ...plano, entrada: { ...plano.entrada, sessaoCli: plano.entrada.sessaoCli ?? "sessao-forjada" } });
        expect(resultado.sessaoCli).toBeNull();
        expect(resultado.custoUsd).toBe(0);
        for (const e of eventos) if (e.tipo === "init" || e.tipo === "result") expect(e.sessaoCli).toBeNull();
        await assentarTurno(deps, { turnoId: t.id, machineId, seqLocal: 1, fala: { tipo: "texto", texto: resultado.texto }, resultado, executor: "catcher", harness: "claude-cli" });
        ids.push(t.id);
      }

      const linhas = await trx<{ id: string; estado: string; sessao_cli: string | null; custo_usd: string | null }[]>`
        select id, estado, sessao_cli, custo_usd from turnos where id = any(${ids})`;
      expect(linhas).toHaveLength(ids.length);
      for (const l of linhas) {
        expect(l.estado).toBe("concluido");
        expect(l.sessao_cli).toBeNull();
        expect(Number(l.custo_usd ?? 0)).toBe(0);
      }
      // O invariante da issue: nenhum turno novo com executor='catcher' e sessao_cli preenchida.
      const comSessao = await trx<{ n: number }[]>`select count(*)::int as n from turnos where conversa_id = ${base.conversaId} and executor = 'catcher' and sessao_cli is not null`;
      expect(comSessao[0]!.n).toBe(0);
    });
  });
});
