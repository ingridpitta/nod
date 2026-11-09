import { expect, it } from "vitest";
import { INTERVALO_MIN_MS, TETO_POSTS_SEM_HUMANO } from "../../src/domain/canal-orcamento.ts";
import { criarRepos } from "../../src/repositories/index.ts";
import { autoriaAgente } from "../../src/use-cases/apoio-l7.ts";
import { criarSala } from "../../src/use-cases/criar-sala.ts";
import { encaminhar } from "../../src/use-cases/encaminhar.ts";
import { postarNaSala } from "../../src/use-cases/postar-na-sala.ts";
import { contexto, depsSobre } from "../helpers/deps-l7.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
let relogio = Date.parse("2026-09-16T15:00:00Z");
const avancar = (ms: number) => (relogio += ms);
const PASSO = INTERVALO_MIN_MS + 1;

describeIntegracao("orçamento da sala (E5.5, E12.3): anel, teto em Sua vez, humano reabre, persistido na linha da sala", () => {
  it("anel A→B→C (três remetentes distintos em sequência, TAMANHO_ANEL = 3): o terceiro é recusado com mensagem negacao que encerra a tentativa; rotina passa", async () => {
    await withRollback(MARLON, async (trx) => {
      const [a, b, c] = await Promise.all([
        agenteComConversa(trx, MARLON, { nome: "Vera" }),
        agenteComConversa(trx, MARLON, { nome: "Tuca" }),
        agenteComConversa(trx, MARLON, { nome: "Bia" }),
      ]);
      const { deps, repos } = depsSobre(trx, MARLON, { agora: () => relogio });
      const s = await criarSala(deps, { nome: "anel", agenteIds: [a.agenteId, b.agenteId, c.agenteId] });
      await postarNaSala(deps, { salaId: s.data.sala.id, texto: "@Vera começa" });
      avancar(PASSO);
      const segundo = await postarNaSala(deps, { salaId: s.data.sala.id, texto: "@Tuca vai", autoria: autoriaAgente(a.agenteId, PESSOA_MARLON) });
      expect(segundo.data.turnos.map((t) => t.agenteId)).toEqual([b.agenteId]);
      avancar(PASSO);
      const fecha = await postarNaSala(deps, { salaId: s.data.sala.id, texto: "@Bia vai", autoria: autoriaAgente(b.agenteId, PESSOA_MARLON) });
      expect(fecha.data.turnos).toEqual([]);
      expect(fecha.data.negacoes.map((n) => [n.agenteId, n.decisao])).toEqual([[c.agenteId, "recusar"]]);
      const negacao = (await repos.mensagens.listarDaConversa(s.data.conversa.id)).find((m) => m.kind === "negacao");
      expect(negacao?.payload).toEqual({ kind: "negacao", classe: "ferramenta_negada", nome: "resposta de Bia", motivo: "teto_canal", terminal: true });
      expect(negacao?.texto).toContain("anel de bots detectado. Nada mais será tentado até uma pessoa falar.");
      expect(fecha.events?.filter((e) => e.kind === "negacao")).toHaveLength(1);
      avancar(PASSO);
      const rotina = await postarNaSala(deps, { salaId: s.data.sala.id, texto: "@Bia relatório 1/3", autoria: autoriaAgente(b.agenteId, PESSOA_MARLON), eRotina: true });
      expect(rotina.data.turnos.map((t) => t.agenteId)).toEqual([c.agenteId]);
    });
  });

  it("6 posts de bot sem humano → resfriar + decisão 'pergunta' em Sua vez (uma); a pessoa fala e a sala reabre; o orçamento está na linha da sala e sobrevive a um processo novo", async () => {
    await withRollback(MARLON, async (trx) => {
      const vera = await agenteComConversa(trx, MARLON, { nome: "Vera" });
      const tuca = await agenteComConversa(trx, MARLON, { nome: "Tuca" });
      const { deps, repos } = depsSobre(trx, MARLON, { agora: () => relogio });
      const s = await criarSala(deps, { nome: "teto", agenteIds: [vera.agenteId, tuca.agenteId] });
      const salaId = s.data.sala.id;
      await postarNaSala(deps, { salaId, texto: "@Vera vai" });
      let ultimo: Awaited<ReturnType<typeof postarNaSala>> | null = null;
      for (let i = 0; i < TETO_POSTS_SEM_HUMANO; i++) {
        avancar(PASSO);
        const autor = i % 2 === 0 ? vera.agenteId : tuca.agenteId;
        ultimo = await postarNaSala(deps, { salaId, texto: `${i % 2 === 0 ? "@Tuca" : "@Vera"} ping ${i}`, autoria: autoriaAgente(autor, PESSOA_MARLON) });
      }
      expect(ultimo?.data.negacoes.map((n) => n.decisao)).toEqual(["resfriar"]);
      expect(ultimo?.data.decisaoTeto).toBeTruthy();
      const fila = await repos.decisoes.listarSuaVez(relogio);
      expect(fila.map((d) => [d.tipo, d.estado])).toEqual([["pergunta", "pendente"]]);
      expect(fila[0]?.frase).toBe(`A sala "teto" esfriou: ${TETO_POSTS_SEM_HUMANO} posts de bots sem resposta humana. Fale na sala para reabrir a rodada.`);
      avancar(PASSO);
      const mais = await postarNaSala(deps, { salaId, texto: "@Vera ping 7", autoria: autoriaAgente(tuca.agenteId, PESSOA_MARLON) });
      expect(mais.data.decisaoTeto).toBeNull();
      expect(await repos.decisoes.listarSuaVez(relogio)).toHaveLength(1);

      // "Novo processo": repos novos sobre a mesma conexão leem o jsonb persistido, não memória.
      const persistido = (await criarRepos(trx, MARLON).salas.buscar(salaId))?.orcamento;
      expect(persistido).toMatchObject({ postsSemHumano: TETO_POSTS_SEM_HUMANO + 1, ultimoPostEm: relogio, handoffsNaRodada: 0 });
      expect(persistido?.ultimosPostsAgenteIds).toEqual([vera.agenteId, tuca.agenteId, tuca.agenteId].slice(-3));

      // humano reabre
      avancar(PASSO);
      const humano = await postarNaSala(deps, { salaId, texto: "@Vera e aí?" });
      expect(humano.data.turnos.map((t) => t.agenteId)).toEqual([vera.agenteId]);
      expect((await criarRepos(trx, MARLON).salas.buscar(salaId))?.orcamento).toMatchObject({ postsSemHumano: 0, ultimaFalaHumanaEm: relogio });
    });
  });

  it("handoffs por rodada (EMENDA 14) ficam no orçamento persistido: 3 passam, o 4º vira passe teto_canal e a rodada fecha por 'teto'", async () => {
    await withRollback(MARLON, async (trx) => {
      const vera = await agenteComConversa(trx, MARLON, { nome: "Vera" });
      const tuca = await agenteComConversa(trx, MARLON, { nome: "Tuca" });
      const { deps, repos } = depsSobre(trx, MARLON, { agora: () => relogio });
      const s = await criarSala(deps, { nome: "h", agenteIds: [vera.agenteId, tuca.agenteId] });
      const conversaId = s.data.conversa.id;
      const post = await postarNaSala(deps, { salaId: s.data.sala.id, texto: "vai" });
      let turnoVera = post.data.turnos[0]?.id ?? "";
      for (let i = 1; i <= 3; i++) {
        const de = i % 2 === 1 ? vera : tuca;
        const para = i % 2 === 1 ? "Tuca" : "Vera";
        await encaminhar(deps, { ...contexto(de.agenteId, conversaId, turnoVera), para_agente: para, motivo: `${i}` });
        expect((await repos.salas.buscar(s.data.sala.id))?.orcamento.handoffsNaRodada).toBe(i);
        turnoVera = (await repos.turnos.vivosDaConversa(conversaId)).at(-1)?.id ?? "";
      }
      await encaminhar(deps, { ...contexto(tuca.agenteId, conversaId, turnoVera), para_agente: "Vera", motivo: "4" });
      const mensagens = await repos.mensagens.listarDaConversa(conversaId);
      expect(mensagens.filter((m) => m.kind === "handoff")).toHaveLength(3);
      expect(mensagens.filter((m) => m.kind === "passe").map((m) => m.payload)).toEqual([{ kind: "passe", motivo: "negado_fail_closed" }]);
      expect(mensagens.find((m) => m.kind === "negacao")?.payload).toMatchObject({ nome: "encaminhar", motivo: "teto_canal" });
      // Só Tuca "falou" (passou) nesta rodada e Vera ainda tem turno vivo: em andamento, sem fechamento por teto ainda.
      expect(mensagens.some((m) => m.kind === "sistema" && m.texto.includes("teto"))).toBe(false);
      expect((await repos.turnos.vivosDaConversa(conversaId)).map((t) => t.agenteId)).toHaveLength(4);
    });
  });
});
