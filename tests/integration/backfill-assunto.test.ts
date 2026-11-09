import { expect, it } from "vitest";
import { contagemVazia, processarLote, type OpcoesBackfill } from "../../scripts/backfill-assunto.ts";
import type { Tx } from "../../src/shared/types.ts";
import { redigir, motivoEmPortugues } from "../../src/domain/redacao.ts";
import { criarSala } from "../../src/use-cases/criar-sala.ts";
import { depsSobreTrx, executar, MARLON } from "../helpers/deps-l6.ts";
import { agenteComConversa, autoriaAgente, autoriaPessoa } from "../helpers/fabricas.ts";
import { PESSOA_MARLON } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

async function assuntos(trx: Tx, ids: readonly string[]): Promise<(string | null)[]> {
  const linhas = await trx<{ id: string; assunto: string | null }[]>`select id, assunto from mensagens where id = any(${[...ids]}::uuid[])`;
  return ids.map((id) => linhas.find((l) => l.id === id)?.assunto ?? null);
}

/** O lote inteiro da pessoa, como o script roda (vários lotes até acabar). */
async function rodar(trx: Tx, opcoes: OpcoesBackfill) {
  const total = contagemVazia();
  let depoisDe: string | null = null;
  let lotes = 0;
  do {
    depoisDe = await processarLote(trx, MARLON, opcoes, depoisDe, total);
    lotes += 1;
  } while (depoisDe !== null);
  return { ...total, lotes };
}

/** Linhas "de antes da 0091": gravadas pelo repositório e com o assunto apagado. */
async function antigas(trx: Tx) {
  const { repos, agenteId, conversaId } = await agenteComConversa(trx, MARLON);
  const bot = autoriaAgente(agenteId, PESSOA_MARLON);
  const base = { conversaId, autoria: bot, confianca: "confiavel" as const };
  const criar = async (m: Parameters<typeof repos.mensagens.criar>[0]) => (await repos.mensagens.criar(m))!.id;
  const ids = {
    // A primeira linha da conversa com uma frase que nenhum molde conhece: a regra da primeira linha a pega.
    nascimento: await criar({ ...base, kind: "sistema", assunto: "agente.criado", texto: "Olá! Um texto de boas-vindas de uma versão que ninguém guardou." }),
    anotei: await criar({ ...base, kind: "sistema", assunto: "memoria.anotada", texto: redigir("anotei", 0, { tipo: "uma preferência", texto: "em reais" }) }),
    pausa: await criar({ ...base, kind: "sistema", assunto: "rotina.evento", texto: "Rotina pausada: nada será disparado até você reativar." }),
    falhou: await criar({ ...base, kind: "sistema", assunto: "turno.falhou", texto: redigir("turno-interrompido", 0, { motivo: motivoEmPortugues("erro_execucao") }) }),
    parado: await criar({ ...base, kind: "sistema", assunto: "turno.interrompido", texto: redigir("turno-interrompido", 0, { motivo: motivoEmPortugues("parado_pela_pessoa") }) }),
    estranha: await criar({ ...base, kind: "sistema", assunto: "sistema.generico", texto: "Uma frase que o nod nunca escreveu." }),
    recibo: await criar({ ...base, kind: "resultado_aprovacao", assunto: "aprovacao.automatica_falhou", texto: "Fiz sem perguntar (1 ação):\n- Enviar (gmail.send): falhou na execucao" }),
    negada: await criar({ ...base, kind: "negacao", texto: "Bash negada", payload: { kind: "negacao", classe: "ferramenta_negada", nome: "Bash", motivo: "fora_do_catalogo", terminal: false } }),
    consentimento: await criar({ conversaId, autoria: { ...autoriaPessoa(PESSOA_MARLON), decidido_por: "regra:aprovacao_automatica" }, kind: "consentimento", texto: "Concedido", payload: { kind: "consentimento", conectorId: agenteId, slug: "gmail", capacidades: ["ler"], naoInclui: [] }, confianca: "confiavel" }),
    fala: await criar({ ...base, kind: "texto", texto: "Pronto, mandei." }),
  };
  await trx`update mensagens set assunto = null where conversa_id = ${conversaId}`;
  return { ids, conversaId };
}

describeIntegracao("backfill do assunto (scripts/backfill-assunto.ts)", () => {
  it("--seco só conta: nada gravado; as contagens dizem o assunto e quantas ficaram sem casamento", async () => {
    await withRollback(MARLON, async (trx) => {
      const { ids, conversaId } = await antigas(trx);
      const r = await rodar(trx, { seco: true, refazer: false, conversaId });
      expect(r.semCasamento).toBeGreaterThanOrEqual(1);
      expect(r.porAssunto.get("agente.criado")).toBeGreaterThanOrEqual(1);
      expect(r.porAssunto.get("rotina.evento")).toBeGreaterThanOrEqual(1);
      expect(await assuntos(trx, Object.values(ids))).toEqual(Object.values(ids).map(() => null));
    });
  });

  it("grava o assunto certo, deixa a fala nula e é idempotente; o lote anda pelo id", async () => {
    await withRollback(MARLON, async (trx) => {
      const { ids, conversaId } = await antigas(trx);
      const r = await rodar(trx, { seco: false, refazer: false, limite: 3, conversaId });
      expect(r.lotes).toBeGreaterThan(1);
      const gravados = await assuntos(trx, Object.values(ids));
      expect(Object.fromEntries(Object.keys(ids).map((k, i) => [k, gravados[i]]))).toEqual({
        nascimento: "agente.criado",
        anotei: "memoria.anotada",
        pausa: "rotina.evento",
        falhou: "turno.falhou",
        parado: "turno.interrompido",
        estranha: "sistema.generico",
        recibo: "aprovacao.automatica_falhou",
        negada: "negacao.ferramenta",
        consentimento: "acesso.automatico",
        fala: null,
      });
      // De novo: nada a gravar; a fala é lida e continua nula.
      const segunda = await rodar(trx, { seco: false, refazer: false, conversaId });
      expect(segunda.gravadas).toBe(0);
      expect((await assuntos(trx, [ids.fala]))[0]).toBeNull();
    });
  });

  it("--refazer corrige uma linha sem payload já classificada errada; sem ele ela fica", async () => {
    await withRollback(MARLON, async (trx) => {
      const { ids, conversaId } = await antigas(trx);
      await rodar(trx, { seco: false, refazer: false, conversaId });
      await trx`update mensagens set assunto = 'sistema.generico' where id = ${ids.pausa}`;
      expect((await rodar(trx, { seco: false, refazer: false, conversaId })).gravadas).toBe(0);
      expect((await assuntos(trx, [ids.pausa]))[0]).toBe("sistema.generico");
      const r = await rodar(trx, { seco: false, refazer: true, conversaId });
      expect(r.gravadas).toBe(1);
      expect((await assuntos(trx, [ids.pausa]))[0]).toBe("rotina.evento");
    });
  });

  it("--refazer nunca tira do chat o assunto que o produtor escolheu (o texto só adivinha)", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos, agenteId, conversaId } = await agenteComConversa(trx, MARLON);
      const base = { conversaId, autoria: autoriaAgente(agenteId, PESSOA_MARLON), confianca: "confiavel" as const };
      // Uma fala antes, para a linha abaixo não ser a primeira da conversa (essa regra é a da criação do bot).
      await repos.mensagens.criar({ ...base, kind: "texto", texto: "Oi." });
      // Uma linha gravada depois do deploy: o produtor sabe que é um turno que falhou; a frase não casa com nenhum molde
      // (mudou sem o molde mudar junto). Pelo texto ela iria para sistema.generico, na Atividade.
      const falhou = (await repos.mensagens.criar({ ...base, kind: "sistema", assunto: "turno.falhou", texto: "Uma frase nova que o molde ainda não conhece." }))!.id;
      // E uma que está na Atividade por engano: o --refazer a traz para o chat, que é o lado seguro.
      const pausa = (await repos.mensagens.criar({ ...base, kind: "sistema", assunto: "sistema.generico", texto: "Rotina pausada: nada será disparado até você reativar." }))!.id;
      const r = await rodar(trx, { seco: false, refazer: true, conversaId });
      expect(await assuntos(trx, [falhou, pausa])).toEqual(["turno.falhou", "rotina.evento"]);
      expect(r.preservadas).toBe(1);
      expect(r.gravadas).toBe(1);
    });
  });

  it("na sala, a linha sem molde é sala.evento (a sala não aplica a tabela)", async () => {
    await withRollback(MARLON, async (trx) => {
      const vera = await agenteComConversa(trx, MARLON, { nome: "Vera" });
      const tuca = await agenteComConversa(trx, MARLON, { nome: "Tuca" });
      const deps = depsSobreTrx(trx, MARLON);
      const sala = await executar(deps, criarSala, { nome: "revisão", agenteIds: [vera.agenteId, tuca.agenteId] });
      const estranha = await deps.repos.mensagens.criar({ conversaId: sala.data.conversa.id, autoria: autoriaPessoa(PESSOA_MARLON), kind: "sistema", assunto: "sala.evento", texto: "Uma linha de sala sem molde.", confianca: "confiavel" });
      await trx`update mensagens set assunto = null where conversa_id = ${sala.data.conversa.id}`;
      await rodar(trx, { seco: false, refazer: false, conversaId: sala.data.conversa.id });
      const linhas = await trx<{ assunto: string | null }[]>`select assunto from mensagens where conversa_id = ${sala.data.conversa.id} order by criado_em`;
      expect(linhas.map((l) => l.assunto)).toEqual(["sala.evento", "sala.evento"]);
      expect((await assuntos(trx, [estranha!.id]))[0]).toBe("sala.evento");
    });
  });
});
