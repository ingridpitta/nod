import { expect, it } from "vitest";
import type { ModoAprovacao } from "../../src/contracts/agente.ts";
import type { PlanoTurno } from "../../src/contracts/plano-turno.ts";
import { NATIVAS_DO_TERMINAL } from "../../src/domain/nativas.ts";
import { autorizarComando } from "../../src/use-cases/autorizar-comando.ts";
import { mudarModoAprovacao } from "../../src/use-cases/mudar-modo-aprovacao.ts";
import { lerDaPessoa, resumir } from "../../scripts/medir-modos.ts";
import { agenteComConversa, autoriaPessoa } from "../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { depsSobre, servicosDeTeste } from "../helpers/l5.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/**
 * PR 1 do plano dos modos de aprovação: `scripts/medir-modos.ts` lê o banco pela RLS da pessoa (nod_app, transação só de
 * leitura) e conta, por semana e por bot, os cartões por motivo, os negados, os comandos no Mac, as esperas de rotina e
 * as horas paradas, a credencial que o hook negou e os bots por modo.
 */
const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const HORA = 60 * 60_000;
type Trx = Parameters<Parameters<typeof withRollback>[1]>[0];

async function bot(trx: Trx, nome: string, modo: ModoAprovacao) {
  const { repos, agenteId, conversaId } = await agenteComConversa(trx, MARLON, { nome });
  const deps = depsSobre(repos, MARLON, { services: servicosDeTeste({}), trx });
  if (modo !== "manual") await mudarModoAprovacao(deps, { agenteId, modo });
  const turno = async (origem: "conversa" | "rotina" | "retomada" = "conversa", retomaTurnoId?: string) => {
    const t = await repos.turnos.enfileirar({ executor: "catcher", conversaId, agenteId, origem, prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "x", entradaConfianca: "confiavel", modelo: "m", ...(retomaTurnoId ? { retomaTurnoId } : {}) });
    if (!t) throw new Error("turno");
    return t;
  };
  const plano = (turnoId: string): PlanoTurno => ({
    tenantId: TENANT_PADRAO, turnoId, agenteId, conversaId, localidade: "local", machineId: "m", executor: "local", superficie: "maquina_da_pessoa",
    decididoPor: "regra:montagem-ferramentas", autoria: autoriaPessoa(PESSOA_MARLON), confiancaEntrada: "confiavel", profundidade: 0,
    catalogo: { ferramentas: [], servidores: [] }, promptSistema: "", entrada: { texto: "", sessaoCli: null, modelo: "m" },
    politicaExecucao: { prazoMs: 1, orcamentoResultadoChars: 8000 }, semprePermitir: [], tokenDeTurno: "tok", expiraEm: Date.now() + 60_000, nativas: [...NATIVAS_DO_TERMINAL, "Write"],
  });
  /** O card que o comando abre (o id da decisão). */
  const card = async (turnoId: string, entrada: { comando: string } | { arquivo: string }) => {
    const r = await autorizarComando(deps, { plano: plano(turnoId), ...entrada });
    if (!("aguardar" in r.data)) throw new Error("esperava card");
    return r.data.aguardar;
  };
  return { repos, agenteId, conversaId, turno, card };
}

describeIntegracao("medir-modos: a linha de base das metas (modos de aprovação, PR 1)", () => {
  it("conta por semana e por bot: motivo, negados, no Mac, rotina e horas paradas, sem espera, credencial do hook e bots por modo", async () => {
    await withRollback(MARLON, async (trx) => {
      const auto = await bot(trx, "Clarice", "automatico");
      const manual = await bot(trx, "Milton", "manual");

      // Automático: um arriscado no terminal, aberto agora.
      const t1 = await auto.turno();
      await auto.card(t1.id, { comando: "git push --force origin fix/x" });
      // Manual: um commit negado depois de 2 h e uma gravação de arquivo aprovada.
      const t2 = await manual.turno();
      const negado = await manual.card(t2.id, { comando: "git commit -am x" });
      const [item] = await manual.repos.itensAprovacao.listar(negado);
      await manual.repos.itensAprovacao.marcar(item?.id ?? "", { selecionado: false, agora: Date.now() });
      await manual.repos.decisoes.decidir(negado, { por: PESSOA_MARLON, agora: Date.now() + 2 * HORA });
      const aprovado = await manual.card(t2.id, { arquivo: "/Users/marlon/notas.md" });
      await manual.repos.decisoes.decidir(aprovado, { por: PESSOA_MARLON, agora: Date.now() + HORA });
      // Rotina: o card nasce na retomada de um turno de rotina e fica 3 h até vencer.
      const rotina = await manual.turno("rotina");
      const retomada = await manual.turno("retomada", rotina.id);
      const daRotina = await manual.card(retomada.id, { comando: "npm install" });
      await trx`update decisoes set estado = 'vencida', prazo_decisao_em = criado_em + interval '3 hours' where id = ${daRotina}`;
      // Lote que a regra aprovou na hora: não é espera.
      const lote = await manual.repos.decisoes.criar({ tipo: "aprovacao", agenteId: manual.agenteId, conversaId: manual.conversaId, turnoId: t2.id, prazoDecisaoEm: Date.now() + HORA, frase: "lote" });
      await manual.repos.decisoes.fecharPorRegra(lote?.id ?? "", { regra: "regra:aprovacao_permanente", regraVersao: 2, agora: Date.now() });
      // O hook negou duas vezes a leitura de um arquivo de credencial (sem cartão).
      await auto.repos.mensagens.criar({ conversaId: auto.conversaId, turnoId: t1.id, autoria: autoriaPessoa(PESSOA_MARLON), kind: "negacao", texto: "Read negada", confianca: "confiavel",
        payload: { kind: "negacao", classe: "ferramenta_negada", nome: "Read", motivo: "alcance_insuficiente", terminal: false, causaNativa: "credencial", vezes: 2 } });

      await trx`set local transaction_read_only = on`;
      const lido = await lerDaPessoa(trx, MARLON, 35);
      const meus = new Set([auto.agenteId, manual.agenteId]);
      const linhas = lido.linhas.filter((l) => meus.has(l.agente_id));
      const bots = lido.bots.filter((b) => meus.has(b.id));
      const credenciais = lido.credenciais.filter((c) => meus.has(c.agente_id));
      expect(linhas).toHaveLength(5);
      expect(bots.map((b) => b.modo).sort()).toEqual(["automatico", "manual"]);

      const r = resumir(linhas, bots, credenciais, Date.now());
      const [semana, s] = [...r.porSemana][0]!;
      expect(r.porSemana.size).toBe(1);
      expect(s).toMatchObject({ cartoes: 4, emAutoOuTotal: 1, negados: 1, rotina: 1, semEspera: 1, credencialNegada: 2 });
      expect(s.msRotina).toBeGreaterThan(2.9 * HORA);
      expect(s.ms).toBeGreaterThan(s.msRotina + 2.9 * HORA);
      expect(r.porMotivo.get(`${semana}|acao_arriscada`)).toMatchObject({ cartoes: 1, negados: 0 });
      expect(r.porMotivo.get(`${semana}|destino_terminal`)).toMatchObject({ cartoes: 3, negados: 1, rotina: 1 });
      expect(r.noMac.get(`${semana}|comando|destino_terminal`)).toMatchObject({ cartoes: 2, negados: 1 });
      expect(r.noMac.get(`${semana}|arquivo|destino_terminal`)).toMatchObject({ cartoes: 1, negados: 0 });
      expect(r.porBot.get(`${semana}|${manual.agenteId}`)).toMatchObject({ cartoes: 3, negados: 1, noMac: 3, rotina: 1, credencialNegada: 0 });
      expect(r.porBot.get(`${semana}|${auto.agenteId}`)).toMatchObject({ cartoes: 1, noMac: 1, credencialNegada: 2 });
      expect(r.porModo).toEqual(new Map([["automatico", 1], ["manual", 1]]));
    });
  });
});
