import { expect, it } from "vitest";
import { vincularEscopo } from "../../src/db/tx.ts";
import { criarRepos } from "../../src/repositories/index.ts";
import { autoriaAgente } from "../../src/use-cases/apoio-l7.ts";
import { convidarBotParaSala } from "../../src/use-cases/convidar-bot-para-sala.ts";
import { criarSala } from "../../src/use-cases/criar-sala.ts";
import { encaminhar } from "../../src/use-cases/encaminhar.ts";
import { passar } from "../../src/use-cases/passar.ts";
import { postarNaSala } from "../../src/use-cases/postar-na-sala.ts";
import { contexto, depsSobre } from "../helpers/deps-l7.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { PESSOA_ANA, PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const ANA = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_ANA };
let relogio = Date.parse("2026-09-16T15:00:00Z");
const avancar = (ms: number) => (relogio += ms);

describeIntegracao("salas (ADR-027, E12.1, E6.1): tamanho, grant na mesma tx, responders, handoff, passes", () => {
  it("1 ou 7 bots → sala_tamanho; sala nasce privada com lead = primeiro; grant ao dono de cada bot; sétimo convite recusado", async () => {
    await withRollback(MARLON, async (trx) => {
      const { deps, repos } = depsSobre(trx, MARLON, { agora: () => relogio });
      const ids: string[] = [];
      for (let i = 0; i < 7; i++) ids.push((await agenteComConversa(trx, MARLON, { nome: `Bot${i}` })).agenteId);
      await expect(criarSala(deps, { nome: "x", agenteIds: [ids[0] ?? ""] })).rejects.toMatchObject({ codigo: "sala_tamanho" });
      await expect(criarSala(deps, { nome: "x", agenteIds: ids })).rejects.toMatchObject({ codigo: "sala_tamanho" });
      expect(await repos.salas.listar()).toEqual([]);
      const s = await criarSala(deps, { nome: "revisão", agenteIds: ids.slice(0, 6) });
      expect(s.data.sala).toMatchObject({ visibility: "privado", politica: "lead", leadAgenteId: ids[0], ownerId: PESSOA_MARLON });
      expect(s.data.membros.map((m) => m.pessoaLeitoraId)).toEqual(Array(6).fill(PESSOA_MARLON));
      expect((await repos.conversas.buscar(s.data.conversa.id))?.tipo).toBe("sala");
      await expect(convidarBotParaSala(deps, { salaId: s.data.sala.id, agenteId: ids[6] ?? "" })).rejects.toMatchObject({ codigo: "sala_tamanho" });
      // reconvidar quem já está não conta como sétimo
      expect((await convidarBotParaSala(deps, { salaId: s.data.sala.id, agenteId: ids[1] ?? "" })).data.membro.agenteId).toBe(ids[1]);
      expect(await repos.salas.membros(s.data.sala.id)).toHaveLength(6);
    });
  });

  it("Ana lê a sala (e as mensagens) onde Tuca — bot de empresa dela — é membro, e não vê o bot privado de Marlon; convidar não transfere capacidade", async () => {
    await withRollback(MARLON, async (trx) => {
      const vera = await agenteComConversa(trx, MARLON, { nome: "Vera" });
      await vincularEscopo(trx, ANA);
      const tuca = await agenteComConversa(trx, ANA, { nome: "Tuca", dono: "empresa" });
      await vincularEscopo(trx, MARLON);
      const { deps } = depsSobre(trx, MARLON, { agora: () => relogio });
      const s = await criarSala(deps, { nome: "revisão", agenteIds: [vera.agenteId, tuca.agenteId] });
      expect(s.data.membros.map((m) => [m.agenteId, m.pessoaLeitoraId])).toEqual([
        [vera.agenteId, PESSOA_MARLON],
        [tuca.agenteId, PESSOA_ANA],
      ]);
      const post = await postarNaSala(deps, { salaId: s.data.sala.id, texto: "@Tuca o que acha do PR 42?" });
      expect(post.data.turnos.map((t) => t.agenteId)).toEqual([tuca.agenteId]);
      expect(post.data.turnos[0]?.ownerId).toBe(PESSOA_MARLON); // roda na máquina e na cota de quem abriu a sala

      await vincularEscopo(trx, ANA);
      const comoAna = criarRepos(trx, ANA);
      expect((await comoAna.salas.listar()).map((x) => x.nome)).toEqual(["revisão"]);
      const lidas = await comoAna.mensagens.listarDaConversa(s.data.conversa.id);
      expect(lidas.map((m) => m.kind)).toEqual(["sistema", "texto"]);
      expect(lidas[1]?.texto).toBe("@Tuca o que acha do PR 42?");
      expect(await comoAna.agentes.buscar(vera.agenteId)).toBeNull();
      expect(await comoAna.concessoes.doAgente(tuca.agenteId)).toEqual([]);
      // Ana não posta pela sala de Marlon nesta rodada (turnos, cota e roteamento são da dona).
      const depsAna = depsSobre(trx, ANA, { agora: () => relogio }).deps;
      await expect(postarNaSala(depsAna, { salaId: s.data.sala.id, texto: "oi" })).rejects.toMatchObject({ codigo: "nao_permitido" });
      await vincularEscopo(trx, MARLON);
    });
  });

  it("@Vera → só Vera; sem menção → lead; 'todos' → todos; handoff visível cria turno do destinatário; passes assentam a rodada; bot offline → passe ausente_offline", async () => {
    await withRollback(MARLON, async (trx) => {
      const vera = await agenteComConversa(trx, MARLON, { nome: "Vera" });
      const tuca = await agenteComConversa(trx, MARLON, { nome: "Tuca" });
      const { deps, repos } = depsSobre(trx, MARLON, { agora: () => relogio });
      const s = await criarSala(deps, { nome: "revisão", agenteIds: [vera.agenteId, tuca.agenteId] });
      const sala = s.data.sala;
      const conversaId = s.data.conversa.id;

      const soVera = await postarNaSala(deps, { salaId: sala.id, texto: "@Vera o que acha?" });
      expect(soVera.data.turnos.map((t) => t.agenteId)).toEqual([vera.agenteId]);
      avancar(9_000);
      const lead = await postarNaSala(deps, { salaId: sala.id, texto: "sem menção" });
      expect(lead.data.turnos.map((t) => t.agenteId)).toEqual([vera.agenteId]);

      // Vera, instruída, encaminha para Tuca: handoff visível + turno de Tuca.
      const h = await encaminhar(deps, { ...contexto(vera.agenteId, conversaId, lead.data.turnos[0]?.id), para_agente: "Tuca", motivo: "ela conhece o PR" });
      expect(h.data).toEqual({ ok: true });
      const handoff = (await repos.mensagens.listarDaConversa(conversaId)).find((m) => m.kind === "handoff");
      expect(handoff?.payload).toEqual({ kind: "handoff", de: vera.agenteId, para: tuca.agenteId, motivo: "ela conhece o PR" });
      expect(handoff?.texto).toBe("Vera passou para Tuca: ela conhece o PR.");
      const vivos = await repos.turnos.vivosDaConversa(conversaId);
      expect(vivos.map((t) => t.agenteId)).toEqual([vera.agenteId, vera.agenteId, tuca.agenteId]);
      expect((await repos.salas.buscar(sala.id))?.orcamento.handoffsNaRodada).toBe(1);

      // Tuca passa; Vera passa → a rodada assenta com uma mensagem de sistema (turnos reais: a FK de mensagens exige).
      await passar(deps, { ...contexto(tuca.agenteId, conversaId, vivos[2]?.id), motivo: "passei_sem_nada_a_dizer" });
      await passar(deps, { ...contexto(vera.agenteId, conversaId, vivos[1]?.id), motivo: "passei_sem_nada_a_dizer" });
      const mensagens = await repos.mensagens.listarDaConversa(conversaId);
      expect(mensagens.filter((m) => m.kind === "passe").map((m) => m.payload)).toEqual([
        { kind: "passe", motivo: "passei_sem_nada_a_dizer" },
        { kind: "passe", motivo: "passei_sem_nada_a_dizer" },
      ]);
      expect(mensagens.filter((m) => m.kind === "sistema" && m.texto.startsWith("A rodada assentou"))).toHaveLength(1);

      await repos.salas.atualizarPolitica(sala.id, { politica: "todos" });
      avancar(9_000);
      const todos = await postarNaSala(deps, { salaId: sala.id, texto: "todo mundo" });
      expect(todos.data.turnos.map((t) => t.agenteId).sort()).toEqual([vera.agenteId, tuca.agenteId].sort());
      // pessoa falou: rodada de handoffs zerada
      expect(todos.data.orcamento.handoffsNaRodada).toBe(0);

      avancar(9_000);
      const offline = await postarNaSala(deps, { salaId: sala.id, texto: "@Tuca está aí?", estaOnline: (a) => a.id !== tuca.agenteId });
      expect(offline.data.turnos).toEqual([]);
      expect(offline.data.passes.map((p) => [p.payload, p.autoria.autor_id])).toEqual([[{ kind: "passe", motivo: "ausente_offline" }, tuca.agenteId]]);
      expect(offline.data.passes[0]?.texto).toBe("Tuca passou a vez (ausente_offline).");

      // fala de bot sem menção não dispara ninguém; com menção, dispara o mencionado
      avancar(9_000);
      const deBot = await postarNaSala(deps, { salaId: sala.id, texto: "sem menção", autoria: autoriaAgente(vera.agenteId, PESSOA_MARLON) });
      expect(deBot.data.turnos).toEqual([]);
    });
  });
});
