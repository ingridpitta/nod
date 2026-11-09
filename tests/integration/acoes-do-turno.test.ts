import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import type { Entrega } from "../../src/contracts/ponte.ts";
import type { Tx } from "../../src/shared/types.ts";
import { ASSUNTOS_DA_ATIVIDADE } from "../../src/domain/destino-no-chat.ts";
import { assentarTurno } from "../../src/use-cases/assentar-turno.ts";
import { criarSala } from "../../src/use-cases/criar-sala.ts";
import { postarNaSala } from "../../src/use-cases/postar-na-sala.ts";
import { lerConversa } from "../../src/use-cases/enviar-mensagem.ts";
import { depsSobre } from "../helpers/deps-l7.ts";
import { agenteComConversa, autoriaAgente } from "../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const SINAIS = { attempted: true, rejected: false, promptSubmitted: true, producedOutput: true };
const SUCESSO: Entrega["resultado"] = { desfecho: "sucesso", texto: "feito", sessaoCli: null, sinais: SINAIS, custoUsd: 0.01, tokens: { entrada: 1, saida: 1, cacheLeitura: 0, cacheCriacao: 0 }, ferramentasChamadas: [], negacoesPermissao: [] };

let ultimo: Pick<Awaited<ReturnType<typeof agenteComConversa>>, "repos" | "agenteId" | "conversaId"> | null = null;

async function turnoDeConversa(trx: Tx) {
  const { repos, agenteId, conversaId } = await agenteComConversa(trx, MARLON, { nome: "Eng" });
  ultimo = { repos, agenteId, conversaId };
  const turno = await repos.turnos.enfileirar({ executor: "catcher", conversaId, agenteId, origem: "conversa", prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "faça", entradaConfianca: "confiavel", modelo: "m" });
  if (!turno) throw new Error("turno não criado");
  return { conversaId, turnoId: turno.id };
}

/**
 * NOD-353: a fala final do bot guarda o resumo das ações do turno (payload `acoes_do_turno`), para ele continuar depois
 * da resposta e do recarregar; o Falhou vem dos índices que o executor mandou (tool_result.isError).
 */
describeIntegracao("resumo das ações na fala final (NOD-353)", () => {
  it("grava as ações no payload da fala e a conversa relida as devolve", async () => {
    await withRollback(MARLON, async (trx) => {
      const { conversaId, turnoId } = await turnoDeConversa(trx);
      const { deps } = depsSobre(trx, MARLON);
      const resultado = { ...SUCESSO, ferramentasChamadas: ["Read", "Read", "WebFetch", "Bash"], ferramentasFalharam: [2] };
      const r = await assentarTurno(deps, { turnoId, machineId: randomUUID(), seqLocal: 1, fala: { tipo: "texto", texto: "Pronto." }, resultado, executor: "catcher" });
      // `duracaoMs` (plano "o pensamento no chat", decisão 2 de 26/10): quanto o turno levou, para a fala gravada dizer "Pensou por".
      const esperado = { kind: "acoes_do_turno", acoes: [{ rotulo: "Leu um arquivo", vezes: 2 }, { rotulo: "Abriu uma página", falhou: true }, { rotulo: "Rodou um comando" }], duracaoMs: expect.any(Number) };
      expect(r.data.mensagem?.payload).toEqual(esperado);
      const lida = await lerConversa(deps, { conversaId });
      const fala = lida.data.mensagens.find((m) => m.id === r.data.mensagem?.id);
      expect(fala?.payload).toEqual(esperado);
      expect(fala?.destino ?? "chat").toBe("chat");
    });
  });

  it("turno sem ferramenta: a fala fica sem payload, como antes", async () => {
    await withRollback(MARLON, async (trx) => {
      const { turnoId } = await turnoDeConversa(trx);
      const { deps } = depsSobre(trx, MARLON);
      const r = await assentarTurno(deps, { turnoId, machineId: randomUUID(), seqLocal: 1, fala: { tipo: "texto", texto: "Oi." }, resultado: SUCESSO, executor: "catcher" });
      expect(r.data.mensagem?.payload).toBeNull();
    });
  });

  it("revisão do #523: a fala com o resumo não é candidata da Atividade (o teto do SQL não a conta nem tira um item real)", async () => {
    await withRollback(MARLON, async (trx) => {
      const { turnoId } = await turnoDeConversa(trx);
      const { repos, agenteId, conversaId } = ultimo!;
      const autoria = autoriaAgente(agenteId, PESSOA_MARLON);
      const anotei = await repos.mensagens.criar({ conversaId, autoria, kind: "sistema", assunto: "memoria.anotada", texto: "Anotei", confianca: "confiavel" });
      await trx`update mensagens set criado_em = now() - interval '1 minute' where id = ${anotei!.id}`;
      const { deps } = depsSobre(trx, MARLON);
      const resultado = { ...SUCESSO, ferramentasChamadas: ["Read"] };
      const r = await assentarTurno(deps, { turnoId, machineId: randomUUID(), seqLocal: 1, fala: { tipo: "texto", texto: "Pronto." }, resultado, executor: "catcher" });
      expect(r.data.mensagem?.payload?.kind).toBe("acoes_do_turno");
      const faixa = { ini: new Date(Date.now() - 3_600_000), fim: new Date(Date.now() + 3_600_000) };
      const [linha] = await trx<{ n: number }[]>`select count(*)::int as n from mensagens where conversa_id = ${conversaId} and id = ${r.data.mensagem!.id} and assunto is null`;
      expect(linha?.n).toBe(1);
      // Teto 1: o item real fica (antes, a fala mais recente ocupava o lugar e era descartada depois do SQL).
      expect((await repos.atividade.mensagens(conversaId, faixa, ASSUNTOS_DA_ATIVIDADE, 1)).map((x) => x.mensagem.id)).toEqual([anotei!.id]);
      expect(await repos.atividade.contarMensagens(conversaId, faixa, ASSUNTOS_DA_ATIVIDADE)).toBe(1);
    });
  });

  it("revisão do #523: turno que falou no meio e acabou sem fala final — o resumo vai na última fala do meio", async () => {
    await withRollback(MARLON, async (trx) => {
      const { turnoId } = await turnoDeConversa(trx);
      const { repos, agenteId, conversaId } = ultimo!;
      const autoria = autoriaAgente(agenteId, PESSOA_MARLON);
      const primeira = await repos.mensagens.criar({ conversaId, turnoId, autoria, kind: "texto", texto: "Primeira parte.", confianca: "confiavel" });
      await trx`update mensagens set criado_em = now() - interval '1 minute' where id = ${primeira!.id}`;
      const meio = await repos.mensagens.criar({ conversaId, turnoId, autoria, kind: "texto", texto: "Segunda parte.", confianca: "confiavel" });
      const { deps } = depsSobre(trx, MARLON);
      const resultado = { ...SUCESSO, texto: "", ferramentasChamadas: ["Read", "Bash"], ferramentasFalharam: [1] };
      const r = await assentarTurno(deps, { turnoId, machineId: randomUUID(), seqLocal: 1, fala: { tipo: "texto", texto: "" }, resultado, executor: "catcher" });
      expect(r.data.mensagem).toBeNull();
      const lida = await lerConversa(deps, { conversaId });
      const porId = (id: string) => lida.data.mensagens.find((m) => m.id === id);
      expect(porId(meio!.id)?.payload).toEqual({ kind: "acoes_do_turno", acoes: [{ rotulo: "Leu um arquivo" }, { rotulo: "Rodou um comando", falhou: true }], duracaoMs: expect.any(Number) });
      expect(porId(meio!.id)?.destino ?? "chat").toBe("chat");
      expect(porId(primeira!.id)?.payload ?? null).toBeNull();
      // Turno sem ferramenta não toca a fala do meio.
      const outro = await turnoDeConversa(trx);
      const m2 = await ultimo!.repos.mensagens.criar({ conversaId: outro.conversaId, turnoId: outro.turnoId, autoria: autoriaAgente(ultimo!.agenteId, PESSOA_MARLON), kind: "texto", texto: "Oi.", confianca: "confiavel" });
      await assentarTurno(deps, { turnoId: outro.turnoId, machineId: randomUUID(), seqLocal: 1, fala: { tipo: "texto", texto: "" }, resultado: { ...SUCESSO, texto: "" }, executor: "catcher" });
      expect((await lerConversa(deps, { conversaId: outro.conversaId })).data.mensagens.find((m) => m.id === m2!.id)?.payload ?? null).toBeNull();
    });
  });

  it("revisão do #523: na sala, a fala do bot (postarNaSala) também guarda o resumo", async () => {
    await withRollback(MARLON, async (trx) => {
      const vera = await agenteComConversa(trx, MARLON, { nome: "Vera" });
      const tuca = await agenteComConversa(trx, MARLON, { nome: "Tuca" });
      const { deps } = depsSobre(trx, MARLON);
      const s = await criarSala(deps, { nome: "revisão", agenteIds: [vera.agenteId, tuca.agenteId] });
      const post = await postarNaSala(deps, { salaId: s.data.sala.id, texto: "@Vera olha o PR" });
      const turnoId = post.data.turnos[0]?.id ?? "";
      const resultado = { ...SUCESSO, ferramentasChamadas: ["Bash"], ferramentasFalharam: [0] };
      const r = await assentarTurno(deps, { turnoId, machineId: randomUUID(), seqLocal: 1, fala: { tipo: "texto", texto: "Olhei." }, resultado, executor: "catcher" });
      expect(r.data.mensagem?.payload).toEqual({ kind: "acoes_do_turno", acoes: [{ rotulo: "Rodou um comando", falhou: true }], duracaoMs: expect.any(Number) });
      // A fala da pessoa na sala continua sem payload.
      const lida = await lerConversa(deps, { conversaId: s.data.conversa.id });
      expect(lida.data.mensagens.find((m) => m.autoria.autor_tipo === "pessoa")?.payload ?? null).toBeNull();
    });
  });
});
