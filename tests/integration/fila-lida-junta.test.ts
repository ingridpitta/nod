import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { entradaDaFila } from "../../src/domain/entrada-da-fila.ts";
import { cancelarTurno } from "../../src/use-cases/cancelar-turno.ts";
import { criarAgente } from "../../src/use-cases/criar-agente.ts";
import { despacharTurno } from "../../src/use-cases/despachar-turno.ts";
import { emitirPlanoTurno } from "../../src/use-cases/emitir-plano-turno.ts";
import { enviarMensagem, lerConversa } from "../../src/use-cases/enviar-mensagem.ts";
import { depsSobreTrx, esperarErro, executar, MARLON } from "../helpers/deps-l6.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

const PRONTO = { estado: "pronto" as const, versao: "teste", em: 0 };

describeIntegracao("fila da conversa no Postgres (0024): cancelar uma, ler as restantes juntas", () => {
  it("mensagem_origem_id liga fala e turno; cancelar só pega pendente; ao reivindicar, a outra pendente sai absorvida", async () => {
    await withRollback(MARLON, async (trx) => {
      const deps = depsSobreTrx(trx, MARLON);
      const { data: criado } = await executar(deps, criarAgente, { dono: "pessoa" });
      const conversaId = criado.conversa.id;
      const maquina = randomUUID();
      const rodando = await executar(deps, enviarMensagem, { conversaId, texto: "fazer a triagem", inventario: PRONTO });
      await executar(deps, despacharTurno, { machineId: maquina, inventario: PRONTO });
      const a = await executar(deps, enviarMensagem, { conversaId, texto: "fazer novamente", inventario: PRONTO });
      const b = await executar(deps, enviarMensagem, { conversaId, texto: "fazer novamente", inventario: PRONTO });
      const c = await executar(deps, enviarMensagem, { conversaId, texto: "e o e-mail do Daniel?", inventario: PRONTO });
      expect(a.data.turno.mensagemOrigemId).toBe(a.data.mensagem.id);

      await esperarErro(() => cancelarTurno(deps, { turnoId: rodando.data.turno.id }), "estado_invalido");
      await executar(deps, cancelarTurno, { turnoId: b.data.turno.id });
      const lida = (await lerConversa(deps, { conversaId })).data;
      expect(lida.turnosCancelados).toEqual([{ id: b.data.turno.id, mensagemId: b.data.mensagem.id }]);
      expect(lida.turnosEmCurso.map((t) => [t.estado, t.mensagemId])).toEqual([["despachando", rodando.data.mensagem.id], ["pendente", a.data.mensagem.id], ["pendente", c.data.mensagem.id]]);

      await deps.repos.turnos.assentar(rodando.data.turno.id, { estado: "concluido", sinais: { promptSubmitted: true, producedOutput: true } });
      const d = await executar(deps, despacharTurno, { machineId: maquina, inventario: PRONTO });
      expect(d.data.turno?.id).toBe(a.data.turno.id);
      expect(d.data.plano?.entrada.texto).toBe(entradaDaFila(["fazer novamente", "e o e-mail do Daniel?"]));
      expect(await deps.repos.turnos.buscar(c.data.turno.id)).toMatchObject({ estado: "interrompido", motivoInterrupcao: "absorvido", absorvidoPor: a.data.turno.id });
      await esperarErro(() => cancelarTurno(deps, { turnoId: c.data.turno.id }), "estado_invalido");
    });
  });

  it("NOD-23: /configurar separa a fila em três turnos e não é absorvido por uma fala comum", async () => {
    await withRollback(MARLON, async (trx) => {
      const deps = depsSobreTrx(trx, MARLON);
      const { data: criado } = await executar(deps, criarAgente, { dono: "pessoa" });
      await deps.repos.agentes.atualizarPerfil(criado.agente.id, { descricao: "Ajuda com código", confirmado: true });
      const conversaId = criado.conversa.id;
      const maquina = randomUUID();
      const antes = await executar(deps, enviarMensagem, { conversaId, texto: "antes", inventario: PRONTO });
      const configurar = await executar(deps, enviarMensagem, { conversaId, texto: "/configurar", inventario: PRONTO });
      const depois = await executar(deps, enviarMensagem, { conversaId, texto: "depois", inventario: PRONTO });

      const primeiro = (await executar(deps, despacharTurno, { machineId: maquina, inventario: PRONTO })).data;
      expect(primeiro.plano?.turnoId).toBe(antes.data.turno.id);
      expect(primeiro.plano?.entrada.texto).toBe("antes");
      expect(primeiro.plano && "catalogo" in primeiro.plano ? primeiro.plano.catalogo.ferramentas.map((f) => f.nome) : []).not.toContain("atualizar_perfil");
      expect(primeiro.plano && "promptSistema" in primeiro.plano ? primeiro.plano.promptSistema : "").not.toContain("Modo de reconfiguração");
      expect((await deps.repos.turnos.buscar(configurar.data.turno.id))?.estado).toBe("pendente");
      expect((await deps.repos.turnos.buscar(depois.data.turno.id))?.estado).toBe("pendente");

      await deps.repos.turnos.assentar(antes.data.turno.id, { estado: "concluido", sinais: { promptSubmitted: true, producedOutput: true } });
      const segundo = (await executar(deps, despacharTurno, { machineId: maquina, inventario: PRONTO })).data;
      expect(segundo.plano?.turnoId).toBe(configurar.data.turno.id);
      // deps-l6 usa um emissor mínimo no despachante; a regra NOD-23 é provada pelo emissor real sobre o turno escolhido.
      const planoReal = (await emitirPlanoTurno(deps, { turnoId: configurar.data.turno.id, machineId: maquina, executor: "local", harnesses: { "claude-cli": PRONTO } })).data;
      expect(planoReal.entrada.texto).toContain("Comece a entrevista");
      expect("catalogo" in planoReal ? planoReal.catalogo.ferramentas.map((f) => f.nome) : []).toContain("atualizar_perfil");
      expect((await deps.repos.turnos.buscar(depois.data.turno.id))?.estado).toBe("pendente");

      await deps.repos.turnos.assentar(configurar.data.turno.id, { estado: "concluido", sinais: { promptSubmitted: true, producedOutput: true } });
      const terceiro = (await executar(deps, despacharTurno, { machineId: maquina, inventario: PRONTO })).data;
      expect(terceiro.plano?.turnoId).toBe(depois.data.turno.id);
      expect(terceiro.plano?.entrada.texto).toBe("depois");
    });
  });
});
