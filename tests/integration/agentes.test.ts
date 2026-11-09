import { expect, it } from "vitest";
import { vincularEscopo } from "../../src/db/tx.ts";
import { previaDaMensagem } from "../../src/domain/descricao-agente.ts";
import { criarAgente, NOME_INICIAL } from "../../src/use-cases/criar-agente.ts";
import { duplicarAgente } from "../../src/use-cases/duplicar-agente.ts";
import { editarPerfil } from "../../src/use-cases/editar-perfil.ts";
import { enviarMensagem, lerConversa } from "../../src/use-cases/enviar-mensagem.ts";
import { fixarAgente, ocultarAgente } from "../../src/use-cases/fixar-ocultar-agente.ts";
import { registrarMemoria } from "../../src/use-cases/lembrar.ts";
import { listarFrota } from "../../src/use-cases/listar-frota.ts";
import { ANA, depsSobreTrx, esperarErro, executar, MARLON } from "../helpers/deps-l6.ts";
import { expectRejected } from "../helpers/expect-rejected.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

describeIntegracao("agentes (E1.1/E1.2/E1.3, Grok Bot Pin/Hide/Duplicate) no Postgres", () => {
  it("nasce 'Novo agente' com conversa e mensagem de sistema; frota diz 'sem acessos · nunca executou'; eventos e outbox na mesma tx", async () => {
    await withRollback(MARLON, async (trx) => {
      const deps = depsSobreTrx(trx, MARLON);
      const { data } = await executar(deps, criarAgente, { dono: "pessoa" });
      expect(data.agente).toMatchObject({ nome: NOME_INICIAL, dono: "pessoa", visibility: "privado", confirmado: false });
      expect(data.conversa).toMatchObject({ tipo: "propria", agenteId: data.agente.id, sessaoCli: null });
      expect((await deps.repos.mensagens.listarDaConversa(data.conversa.id)).map((m) => m.kind)).toEqual(["sistema"]);

      const frota = (await listarFrota(deps, {})).data;
      expect(frota.agentes.find((a) => a.id === data.agente.id)).toMatchObject({ conversaId: data.conversa.id, descricaoEstado: "sem acessos · nunca executou" });
      // A linha da sidebar mostra a prévia da última mensagem da conversa própria (definido em 2026-09-24).
      const [boasVindas] = await deps.repos.mensagens.listarDaConversa(data.conversa.id);
      expect(frota.agentes.find((a) => a.id === data.agente.id)?.ultimaMensagem).toEqual({ previa: previaDaMensagem(boasVindas!.texto), em: boasVindas!.criadoEm });

      const eventos = await trx<{ kind: string }[]>`select kind from events where conversa_id = ${data.conversa.id}`;
      expect(eventos.map((e) => e.kind).sort()).toEqual(["agente_atualizado", "mensagem_criada"]);
      const outbox = await trx<{ n: number }[]>`select count(*)::int as n from events_outbox where owner_id = ${MARLON.pessoaId} and evento_id in (select id from events where conversa_id = ${data.conversa.id})`;
      expect(outbox[0]?.n).toBe(2);
    });
  });

  it("troca de modelo persiste Sonnet e descarta a sessão Haiku na mesma transação", async () => {
    await withRollback(MARLON, async (trx) => {
      const deps = depsSobreTrx(trx, MARLON);
      const { data } = await executar(deps, criarAgente, { dono: "pessoa", modelo: "claude-haiku-4-5-20251001" });
      await deps.repos.conversas.atualizarSessaoCli(data.conversa.id, "haiku-anterior", "local");
      await executar(deps, editarPerfil, { agenteId: data.agente.id, modelo: "sonnet" });
      expect((await deps.repos.conversas.buscar(data.conversa.id))?.sessaoCli).toBeNull();
      const enviado = await executar(deps, enviarMensagem, { conversaId: data.conversa.id, texto: "oi" });
      expect(enviado.data.turno.modelo).toBe("sonnet");
    });
  });

  it("dono é imutável: pelo caso de uso (dono_imutavel) e pelo banco (trigger P0001)", async () => {
    await withRollback(MARLON, async (trx) => {
      const deps = depsSobreTrx(trx, MARLON);
      const { data } = await executar(deps, criarAgente, { dono: "pessoa", nome: "Vera" });
      await esperarErro(() => editarPerfil(deps, { agenteId: data.agente.id, dono: "empresa" }), "dono_imutavel");
      await expectRejected(trx, () => trx`update agentes set dono = 'empresa' where id = ${data.agente.id}`, "P0001");
      expect((await deps.repos.agentes.buscar(data.agente.id))?.dono).toBe("pessoa");
      const editado = await executar(deps, editarPerfil, { agenteId: data.agente.id, titulo: "Revisora", descricao: "Revisa PRs" });
      expect(editado.data.agente).toMatchObject({ nome: "Vera", titulo: "Revisora", descricao: "Revisa PRs" });
    });
  });

  it("agente de empresa é visível para ana (equipe) mas só a dona edita; o privado de marlon não existe para ana", async () => {
    await withRollback(MARLON, async (trx) => {
      const marlon = depsSobreTrx(trx, MARLON);
      const empresa = (await executar(marlon, criarAgente, { dono: "empresa", nome: "Tuca" })).data;
      const privado = (await executar(marlon, criarAgente, { dono: "pessoa", nome: "Vera" })).data;

      await vincularEscopo(trx, ANA);
      const ana = depsSobreTrx(trx, ANA);
      expect((await ana.repos.agentes.buscar(empresa.agente.id))?.nome).toBe("Tuca");
      expect((await listarFrota(ana, {})).data.agentes.map((a) => a.id)).toContain(empresa.agente.id);
      await esperarErro(() => editarPerfil(ana, { agenteId: empresa.agente.id, nome: "Tuca 2" }), "nao_permitido");
      await esperarErro(() => fixarAgente(ana, { agenteId: empresa.agente.id }), "nao_permitido");

      expect(await ana.repos.agentes.buscar(privado.agente.id)).toBeNull();
      await esperarErro(() => editarPerfil(ana, { agenteId: privado.agente.id, nome: "x" }), "nao_encontrado");
      await esperarErro(() => lerConversa(ana, { conversaId: privado.conversa.id }), "nao_encontrado");
      await esperarErro(() => enviarMensagem(ana, { conversaId: privado.conversa.id, texto: "oi" }), "nao_encontrado");
      await vincularEscopo(trx, MARLON);
    });
  });

  it("duplicar copia perfil, avatar e memória da dona, NUNCA as mensagens nem os turnos; fixar e ocultar", async () => {
    await withRollback(MARLON, async (trx) => {
      const deps = depsSobreTrx(trx, MARLON);
      const { data: criado } = await executar(deps, criarAgente, { dono: "pessoa", nome: "Vera" });
      await executar(deps, editarPerfil, { agenteId: criado.agente.id, titulo: "Revisora" });
      await executar(deps, registrarMemoria, { agenteId: criado.agente.id, conversaId: criado.conversa.id, turnoId: null, tipo: "fato", texto: "revisa o repo nod", origem: "pessoa" });
      await executar(deps, enviarMensagem, { conversaId: criado.conversa.id, texto: "oi", inventario: { estado: "pronto", versao: "t", em: 0 } });

      const { data: copia } = await executar(deps, duplicarAgente, { agenteId: criado.agente.id });
      expect(copia.agente).toMatchObject({ nome: "Vera (cópia)", titulo: "Revisora", duplicadoDe: criado.agente.id, dono: "pessoa" });
      expect(copia.agente.cor).toBe(criado.agente.cor);
      expect(await deps.repos.memorias.listarDoAgente(copia.agente.id)).toMatchObject([{ tipo: "fato", texto: "revisa o repo nod", origem: "pessoa" }]);
      expect(await deps.repos.mensagens.listarDaConversa(copia.conversa.id)).toEqual([]);
      expect(await deps.repos.turnos.listarDaConversa(copia.conversa.id)).toEqual([]);

      expect((await executar(deps, fixarAgente, { agenteId: copia.agente.id })).data.agente.fixado).toBe(true);
      expect((await deps.repos.agentes.listar())[0]?.id).toBe(copia.agente.id);
      expect((await executar(deps, ocultarAgente, { agenteId: copia.agente.id })).data.agente.oculto).toBe(true);
      expect((await listarFrota(deps, {})).data.agentes.map((a) => a.id)).not.toContain(copia.agente.id);
    });
  });
});
