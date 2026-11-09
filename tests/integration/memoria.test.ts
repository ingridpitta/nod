import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { criarAgente } from "../../src/use-cases/criar-agente.ts";
import { despacharTurno } from "../../src/use-cases/despachar-turno.ts";
import { apagarMemoria, editarMemoria, listarMemorias } from "../../src/use-cases/editar-memorias.ts";
import { enviarMensagem } from "../../src/use-cases/enviar-mensagem.ts";
import { lembrar, registrarMemoria } from "../../src/use-cases/lembrar.ts";
import { depsSobreTrx, esperarErro, executar, MARLON } from "../helpers/deps-l6.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

const PRONTO = { estado: "pronto" as const, versao: "teste", em: 0 };

describeIntegracao("memória por bot (Grok Bot: memória não é fonte)", () => {
  it("lembrar (ferramenta) grava com origem 'agente' e a mensagem 'anotei' no turno; a pessoa lista, edita e apaga", async () => {
    await withRollback(MARLON, async (trx) => {
      const deps = depsSobreTrx(trx, MARLON);
      const { data: criado } = await executar(deps, criarAgente, { dono: "pessoa" });
      const turno = await deps.repos.turnos.enfileirar({ executor: "catcher", conversaId: criado.conversa.id, agenteId: criado.agente.id, origem: "conversa", prazoEm: Date.now() + 1000, profundidade: 0, entradaTexto: "x", entradaConfianca: "confiavel", modelo: "m" });

      const r = await executar(deps, lembrar, { turnoId: turno?.id ?? "", agenteId: criado.agente.id, conversaId: criado.conversa.id, tipo: "preferencia", texto: "prefere resumos em tópicos" });
      expect(r.data).toEqual({ ok: true, id: expect.any(String) });
      if (!r.data.ok) throw new Error("lembrar recusou uma preferência comum");
      const memoriaId = r.data.id;
      expect(r.events.map((e) => e.kind)).toEqual(["agente_atualizado", "mensagem_criada"]);
      const anotei = await deps.repos.mensagens.ultimaDaConversa(criado.conversa.id);
      expect(anotei).toMatchObject({ kind: "sistema", turnoId: turno?.id, autoria: { autor_tipo: "agente", autor_id: criado.agente.id } });
      expect(anotei?.texto).toBe("Anotei uma preferência: prefere resumos em tópicos");

      const daPessoa = await executar(deps, registrarMemoria, { agenteId: criado.agente.id, conversaId: null, turnoId: null, tipo: "fato", texto: "o repo é o nod", origem: "pessoa" });
      expect(daPessoa.data.mensagem).toBeNull();
      const lista = (await listarMemorias(deps, { agenteId: criado.agente.id })).data.memorias;
      expect(lista.map((m) => [m.tipo, m.origem])).toEqual([
        ["preferencia", "agente"],
        ["fato", "pessoa"],
      ]);

      const editada = await executar(deps, editarMemoria, { memoriaId, texto: "prefere tópicos curtos", tipo: "resumo" });
      expect(editada.data.memoria).toMatchObject({ texto: "prefere tópicos curtos", tipo: "resumo" });
      await esperarErro(() => editarMemoria(deps, { memoriaId, texto: "  " }), "texto_vazio");
      await esperarErro(() => registrarMemoria(deps, { agenteId: criado.agente.id, conversaId: null, turnoId: null, tipo: "fato", texto: "", origem: "pessoa" }), "texto_vazio");
      expect((await executar(deps, apagarMemoria, { memoriaId: daPessoa.data.memoria.id })).data.apagada).toBe(true);
      await esperarErro(() => apagarMemoria(deps, { memoriaId: randomUUID() }), "nao_encontrado");
      expect((await listarMemorias(deps, { agenteId: criado.agente.id })).data.memorias).toHaveLength(1);
    });
  });

  it("ADR-065: o bot não grava como memória que falta terminal no turno; a pessoa grava pela tela o que quiser", async () => {
    await withRollback(MARLON, async (trx) => {
      const deps = depsSobreTrx(trx, MARLON);
      const { data: criado } = await executar(deps, criarAgente, { dono: "pessoa" });
      const turno = await deps.repos.turnos.enfileirar({ executor: "catcher", conversaId: criado.conversa.id, agenteId: criado.agente.id, origem: "conversa", prazoEm: Date.now() + 1000, profundidade: 0, entradaTexto: "x", entradaConfianca: "confiavel", modelo: "m" });
      // A frase que a Clarice gravou em 30/09, 22:50.
      const texto = "Dev 3/Dev 4 não têm terminal nem permissão de push no GitHub";

      const r = await executar(deps, lembrar, { turnoId: turno?.id ?? "", agenteId: criado.agente.id, conversaId: criado.conversa.id, tipo: "fato", texto });
      expect(r.data).toMatchObject({ ok: false, recusado: expect.stringContaining("depende do tipo de turno") });
      expect(r.events).toEqual([]);
      expect((await listarMemorias(deps, { agenteId: criado.agente.id })).data.memorias).toEqual([]);

      await executar(deps, registrarMemoria, { agenteId: criado.agente.id, conversaId: null, turnoId: null, tipo: "fato", texto, origem: "pessoa" });
      expect((await listarMemorias(deps, { agenteId: criado.agente.id })).data.memorias.map((m) => m.origem)).toEqual(["pessoa"]);
    });
  });

  it("o prompt de sistema do plano inclui a memória com o aviso 'não substitui fonte autoritativa'", async () => {
    await withRollback(MARLON, async (trx) => {
      const deps = depsSobreTrx(trx, MARLON);
      const { data: criado } = await executar(deps, criarAgente, { dono: "pessoa", nome: "Vera" });
      await executar(deps, registrarMemoria, { agenteId: criado.agente.id, conversaId: null, turnoId: null, tipo: "preferencia", texto: "prefere resumos em tópicos", origem: "pessoa" });
      await executar(deps, enviarMensagem, { conversaId: criado.conversa.id, texto: "revise o PR 12", inventario: PRONTO });
      const { data } = await executar(deps, despacharTurno, { machineId: randomUUID(), inventario: PRONTO });
      expect(data.plano).not.toBeNull();
      expect(data.plano?.promptSistema).toContain("- [preferencia] prefere resumos em tópicos");
      expect(data.plano?.promptSistema).toContain("não substitui fonte autoritativa");
      expect(data.plano?.promptSistema).toContain("Você é Vera");
      expect(data.plano?.catalogo.ferramentas.map((f) => f.nome)).toContain("lembrar");
    });
  });
});
