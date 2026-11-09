import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { criarCatcherDriver } from "../../src/adapters/executor/drivers/catcher.ts";
import type { ConversaDto, RespostaMutacao } from "../../src/contracts/api.ts";
import type { Agente } from "../../src/contracts/agente.ts";
import type { Conversa } from "../../src/contracts/conversa.ts";
import type { Turno } from "../../src/contracts/turno.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { servidorCompleto, type ServidorCompleto } from "../helpers/servidor-completo.ts";
import { limparPessoaE2E } from "./limpeza-e2e.ts";

/**
 * Critério de aceite da #189 (ADR-083 §6), de ponta a ponta e sem custo: servidor completo, laço real e o catcher com a
 * sessão viva ligada. Um turno com três ferramentas de 5 s (`[[espera]]`); a pessoa manda uma mensagem no meio; a
 * resposta vira fala GRAVADA do mesmo turno em até 10 s depois do fim da ferramenta em curso — não um passo do card, e
 * não uma resposta que espera o turno acabar.
 */
const NOME_PESSOA = `E2E meio ${randomUUID().slice(0, 8)}`;
/** definido em 2026-10-07 (#189): o teto do aceite — 10 s depois do fim da ferramenta em curso. */
const TETO_DEPOIS_DA_FERRAMENTA_MS = 10_000;
const ESPERA_MS = 5_000;

describeIntegracao("mensagem no meio com o catcher (ADR-083 §6, #189)", () => {
  let srv: ServidorCompleto;
  const criados = { agentes: [] as string[], conversas: [] as string[] };

  beforeAll(async () => {
    srv = await servidorCompleto({ nomePessoa: NOME_PESSOA, drivers: ({ urlNod }) => [criarCatcherDriver({ urlNod, sessaoViva: true })] });
  }, 30_000);

  afterAll(async () => {
    if (srv) {
      await srv.fechar();
      await limparPessoaE2E(srv.db, srv.dbDono, { tenantId: srv.pessoa.tenantId, pessoaId: srv.pessoa.pessoaId }, criados);
      await srv.desligar();
    }
  }, 30_000);

  it("três ferramentas de 5 s; a mensagem do meio é respondida como fala gravada em ≤ 10 s depois da ferramenta em curso", { timeout: 90_000 }, async () => {
    const turno = (id: string) => srv.json<{ turno: Turno }>("GET", `turnos/${id}`).then((r) => r.turno);
    const enviar = async (conversaId: string, texto: string) => (await srv.json<RespostaMutacao>("POST", `conversas/${conversaId}/mensagens`, { texto })).ids.turno ?? "";
    const bot = await srv.json<{ agente: Agente; conversa: Conversa }>("POST", "agentes", { dono: "pessoa", nome: "Meio" });
    criados.agentes.push(bot.agente.id);
    criados.conversas.push(bot.conversa.id);
    const conversaId = bot.conversa.id;

    const passos = [1, 2, 3].map((n) => `[[tool: lembrar {"texto":"passo ${n}"}]]\n[[espera: ${ESPERA_MS}]]`).join("\n");
    const primeiro = await enviar(conversaId, `${passos}\n[[texto: Terminei os três passos.]]`);
    const inicio = await srv.esperar(async () => ((await turno(primeiro)).estado === "despachando" ? Date.now() : null), { nome: "turno longo despachando", timeoutMs: 20_000 });

    // No meio da primeira ferramenta (ela acaba ~5 s depois de o turno começar).
    await new Promise((r) => setTimeout(r, 1_500));
    const enviadaEm = Date.now();
    const segundo = await enviar(conversaId, "qual é o prazo?");

    const resposta = await srv.esperar(async () => {
      const dto = await srv.json<ConversaDto>("GET", `conversas/${conversaId}/mensagens`);
      return dto.mensagens.find((m) => m.kind === "texto" && m.autoria.autor_tipo === "agente" && m.texto === "Respondendo: qual é o prazo?") ?? null;
    }, { nome: "resposta à mensagem do meio", timeoutMs: 40_000 });
    const respondidaEm = Date.now();

    // A ferramenta em curso acabava em `inicio + 5 s` (a seguinte, se a mensagem chegou já nela, em `+ 10 s`).
    const fimDaFerramenta = Math.max(inicio + ESPERA_MS, enviadaEm);
    expect(respondidaEm - fimDaFerramenta).toBeLessThanOrEqual(TETO_DEPOIS_DA_FERRAMENTA_MS + ESPERA_MS);
    expect(respondidaEm - enviadaEm).toBeLessThanOrEqual(ESPERA_MS + TETO_DEPOIS_DA_FERRAMENTA_MS);
    // Fala do MESMO turno, gravada com ele ainda trabalhando.
    expect(resposta.turnoId).toBe(primeiro);
    expect((await turno(primeiro)).estado).toBe("despachando");

    const final = await srv.esperar(async () => {
      const t = await turno(primeiro);
      return t.estado === "concluido" ? t : null;
    }, { nome: "turno longo concluído", timeoutMs: 40_000 });
    expect(final.estado).toBe("concluido");
    // A mensagem entrou no turno vivo (confirmada pelo app) e não virou turno próprio.
    expect(await turno(segundo)).toMatchObject({ estado: "interrompido", motivoInterrupcao: "absorvido", absorvidoPor: primeiro });
    const dto = await srv.json<ConversaDto>("GET", `conversas/${conversaId}/mensagens`);
    const textos = [...dto.mensagens].sort((a, b) => a.criadoEm - b.criadoEm).filter((m) => m.kind === "texto").map((m) => [m.autoria.autor_tipo, m.texto]);
    expect(textos.filter(([, t]) => t === "Respondendo: qual é o prazo?")).toHaveLength(1);
    expect(textos.findIndex(([, t]) => t === "Respondendo: qual é o prazo?")).toBeLessThan(textos.findIndex(([, t]) => t === "Terminei os três passos."));
  });
});
