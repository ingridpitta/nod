import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { varrerPessoa } from "../../src/adapters/fundo/varredor-lease.ts";
import { LEASE_MS } from "../../src/shared/constantes.ts";
import { criarAgente } from "../../src/use-cases/criar-agente.ts";
import { despacharTurno } from "../../src/use-cases/despachar-turno.ts";
import { enviarMensagem } from "../../src/use-cases/enviar-mensagem.ts";
import { retomarTurno } from "../../src/use-cases/retomar-turno.ts";
import { depsSobreTrx, esperarErro, executar, MARLON } from "../helpers/deps-l6.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

const PRONTO = { estado: "pronto" as const, versao: "teste", em: 0 };

describeIntegracao("retomada por frase humana (E5.4, ADR-009): turno NOVO com retoma_turno_id e --resume", () => {
  it("decisão tardia cria turno novo (origem retomada, reenvios+1) com a frase registrada; o plano leva a sessão do CLI", async () => {
    await withRollback(MARLON, async (trx) => {
      const agora = Date.now();
      const deps = depsSobreTrx(trx, MARLON, { relogio: () => agora });
      const { data: criado } = await executar(deps, criarAgente, { dono: "pessoa" });
      await deps.repos.conversas.atualizarSessaoCli(criado.conversa.id, "sessao-antiga");
      await executar(deps, enviarMensagem, { conversaId: criado.conversa.id, texto: "revise", inventario: PRONTO });
      const original = (await executar(deps, despacharTurno, { machineId: randomUUID(), inventario: PRONTO })).data.plano?.turnoId ?? "";
      const varrido = await varrerPessoa(deps.tx, MARLON, agora + LEASE_MS + 1);
      const decisaoId = varrido.decisoes[0] ?? "";

      await esperarErro(() => retomarTurno(deps, { decisaoId, texto: "  " }), "texto_vazio");
      const { data, events } = await executar(deps, retomarTurno, { decisaoId, texto: "o PR é o 12, siga" });
      expect(data.turno).toMatchObject({ origem: "retomada", estado: "pendente", retomaTurnoId: original, reenvios: 1, entradaTexto: "o PR é o 12, siga", agenteId: criado.agente.id });
      expect(data.original.estado).toBe("interrompido");
      expect(data.sessaoCli).toBe("sessao-antiga");
      expect(data.decisao).toMatchObject({ estado: "decidida", desfecho: { tipo: "decidida", por: MARLON.pessoaId } });
      expect(events.map((e) => e.kind)).toEqual(["mensagem_criada", "turno_criado", "mensagem_criada", "decisao_decidida"]);
      const ultimas = (await deps.repos.mensagens.listarDaConversa(criado.conversa.id)).slice(-2);
      expect(ultimas[0]).toMatchObject({ kind: "texto", texto: "o PR é o 12, siga", autoria: { autor_tipo: "pessoa" } });
      expect(ultimas[1]?.texto).toContain("Retomando o turno interrompido (maquina_sem_contato)");

      const plano = (await executar(deps, despacharTurno, { machineId: randomUUID(), inventario: PRONTO })).data.plano;
      expect(plano).toMatchObject({ turnoId: data.turno.id, entrada: { texto: "o PR é o 12, siga", sessaoCli: "sessao-antiga" } });
      await esperarErro(() => retomarTurno(deps, { decisaoId, texto: "de novo" }), "estado_invalido");
    });
  });

  it("retomar direto por turno; turno que não está interrompido → estado_invalido; inexistente → nao_encontrado", async () => {
    await withRollback(MARLON, async (trx) => {
      const deps = depsSobreTrx(trx, MARLON);
      const { data: criado } = await executar(deps, criarAgente, { dono: "pessoa" });
      const pendente = (await executar(deps, enviarMensagem, { conversaId: criado.conversa.id, texto: "oi", inventario: PRONTO })).data.turno;
      await esperarErro(() => retomarTurno(deps, { turnoId: pendente.id, texto: "x" }), "estado_invalido");
      await esperarErro(() => retomarTurno(deps, { turnoId: randomUUID(), texto: "x" }), "nao_encontrado");
      await deps.repos.turnos.interromper(pendente.id, "reinicio_servidor");
      const { data } = await executar(deps, retomarTurno, { turnoId: pendente.id, texto: "continua" });
      expect(data.turno).toMatchObject({ origem: "retomada", retomaTurnoId: pendente.id, reenvios: 1 });
      expect(data.decisao).toBeNull();
      expect((await deps.repos.turnos.listarDaConversa(criado.conversa.id)).map((t) => t.estado)).toEqual(["interrompido", "pendente"]);
    });
  });
});
