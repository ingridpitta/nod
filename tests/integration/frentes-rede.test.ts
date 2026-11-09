import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import type { IdHarness } from "../../src/contracts/harness.ts";
import type { ResultadoTurno } from "../../src/contracts/turno.ts";
import { comCitacao, trechoDaCitacao } from "../../src/domain/citacao.ts";
import { REDE_MS } from "../../src/domain/trabalho.ts";
import { criarTokenTurno } from "../../src/services/token-turno.ts";
import { assentarTurno } from "../../src/use-cases/assentar-turno.ts";
import { promoverNaRede } from "../../src/use-cases/coordenar-trabalhos.ts";
import { emitirPlanoTurno } from "../../src/use-cases/emitir-plano-turno.ts";
import { agenteComConversa, autoriaPessoa } from "../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { depsSobre, servicosDeTeste } from "../helpers/l5.ts";
import { withRollback } from "../helpers/with-rollback.ts";
import { textoAbrirTask } from "../../web/telas/acoes-da-fala.ts";

/**
 * A rede de 2 min promove o turno do dono a FRENTE, com ou sem bifurcar (definido em 2026-10-12, ADR-099, I8). O teste da
 * rede com bifurcação continua em trabalhos-sessao.test.ts e no e2e do catcher; aqui, os caminhos sem bifurcar e a
 * retomada do dono.
 */
const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const pronto = { estado: "pronto", versao: "teste", em: Date.now() } as const;
const SINAIS = { attempted: true, rejected: false, promptSubmitted: true, producedOutput: true };
const sucesso = (sessaoCli: string | null): ResultadoTurno => ({ desfecho: "sucesso", texto: "feito", sessaoCli, sinais: SINAIS, custoUsd: 0, tokens: { entrada: 1, saida: 1, cacheLeitura: 0, cacheCriacao: 0 }, ferramentasChamadas: [], negacoesPermissao: [] });

type Trx = Parameters<Parameters<typeof withRollback>[1]>[0];
async function montar(trx: Trx, harness: IdHarness) {
  const base = await agenteComConversa(trx, MARLON, { nome: "Ada" });
  await base.repos.agentes.atualizarPerfil(base.agenteId, { confirmado: true });
  const agora = () => Date.now();
  const deps = depsSobre(base.repos, MARLON, { services: servicosDeTeste({ agora, tokens: criarTokenTurno({ agora }) }), agora, trx });
  const maquina = randomUUID();
  const turno = async (o: { trabalhoId?: string | null; origem?: "conversa" | "retomada"; retomaTurnoId?: string; texto?: string } = {}) =>
    (await base.repos.turnos.enfileirar({ executor: "catcher", conversaId: base.conversaId, agenteId: base.agenteId, origem: o.origem ?? "conversa", prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: o.texto ?? "levante os números do trimestre", entradaConfianca: "confiavel", modelo: "auto", harness, trabalhoId: o.trabalhoId, ...(o.retomaTurnoId ? { retomaTurnoId: o.retomaTurnoId } : {}) }))!;
  const plano = async (turnoId: string) => (await emitirPlanoTurno(deps, { turnoId, machineId: maquina, executor: "local", harnesses: { [harness]: pronto } })).data;
  /** Puxa o turno (vira `despachando`) e devolve o plano dele, como a ponte. */
  const despachar = async (turnoId: string) => {
    await base.repos.turnos.reivindicar({ machineId: maquina, agora: Date.now() });
    expect((await base.repos.turnos.buscar(turnoId))?.estado).toBe("despachando");
    return plano(turnoId);
  };
  const promover = (turnoId: string, o: { sessaoCli: string | null; maquinaBifurca: boolean; modo?: "conversa" | "rotina" }) =>
    promoverNaRede(deps, { turnoId, despachadoEm: Date.now() - REDE_MS, fezFerramenta: true, harness, sessaoCli: o.sessaoCli, sessaoExecutor: "local", maquinaBifurca: o.maquinaBifurca, modo: o.modo ?? "conversa" });
  const falaDaPessoa = (texto: string) => base.repos.mensagens.criar({ conversaId: base.conversaId, autoria: autoriaPessoa(PESSOA_MARLON), kind: "texto", texto, confianca: "confiavel" });
  return { ...base, deps, maquina, turno, plano, despachar, promover, falaDaPessoa };
}

describeIntegracao("a rede de 2 min promove a frente, com ou sem bifurcar (ADR-099, I8)", () => {
  // QA do PR 392 (2026-10-18, ADR-113 §8): o "Abrir task com isto" vai como mensagem comum citando a fala; quando a rede
  // promove esse turno, o título sai do texto da pessoa sem o prefixo da citação. Só com o pedido, saía "Abre uma task com isto.".
  // Revisto no rebase do PR 5 (título curto): o título provisório sai do assunto citado.
  it("o turno do 'Abrir task com isto' promovido vira frente com o assunto da fala no título", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx, "codex-cli");
      const falaCitada = "O deploy de ontem quebrou o login do app quando a pessoa entra pelo Google. Vale olhar o callback.";
      const vivo = await m.turno({ texto: comCitacao(textoAbrirTask({ texto: falaCitada }), trechoDaCitacao(falaCitada)) });
      await m.despachar(vivo.id);
      const frente = (await m.promover(vivo.id, { sessaoCli: null, maquinaBifurca: false })).data.trabalho!;
      expect(frente.titulo).toBe("O deploy de ontem quebrou");
    });
  });

  it("Codex (sem retomar sessão): promove a frente num lote aberto pelo próprio turno; a próxima fala da pessoa sai sem sessão e com o histórico", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx, "codex-cli");
      // Plano chat limpo (PR 5): o título deixa de ser a mensagem crua (cortada em 80) e vira o provisório.
      const pedido = "Oi Ada, os resultados estão ficando muito bons, mas preciso que você levante os números do trimestre e compare com o ano passado";
      await m.falaDaPessoa(pedido);
      const vivo = await m.turno({ texto: pedido });
      const p = await m.despachar(vivo.id);
      expect(p.harness).toBe("codex-cli");
      expect(p.entrada.sessaoCli).toBeNull();

      const r = await m.promover(vivo.id, { sessaoCli: null, maquinaBifurca: false });
      const frente = r.data.trabalho!;
      expect(frente).toMatchObject({ origem: "rede", forma: "frente", estado: "rodando", sessaoCli: null, titulo: "Os resultados estão ficando muito bons" });
      expect(frente.titulo).not.toBe(pedido);
      expect(frente.loteId).toBeTruthy();
      // O lote da rede não tem título (sem `nomear_frente`): a tela usa o título da frente.
      expect(await m.repos.frentes.buscarLote(frente.loteId!)).toMatchObject({ abertoPorTurnoId: vivo.id, trabalhoId: null, avisarACadaUma: false, titulo: null });
      expect((await m.repos.turnos.buscar(vivo.id))?.trabalhoId).toBe(frente.id);
      // A linha na conversa do dono: "Virou a frente".
      const linha = (await m.repos.mensagens.listarDaConversa(m.conversaId, 50)).find((x) => x.payload?.kind === "trabalho_aberto");
      expect(linha?.texto).toBe(`Virou a frente ${frente.titulo}`);
      expect(r.events?.some((e) => e.kind === "mensagem_criada")).toBe(true);

      // A próxima fala da pessoa: turno do dono, sem sessão, sem bifurcar e com o histórico recente no prompt.
      await m.falaDaPessoa("e o outro assunto, como ficou?");
      const proxima = await m.plano((await m.turno({ texto: "e o outro assunto, como ficou?" })).id);
      expect(proxima.entrada.sessaoCli).toBeNull();
      expect(proxima.entrada.bifurcar).toBeUndefined();
      expect(proxima.promptSistema).toContain("levante os números do trimestre");
    });
  });

  it("harness que retoma, na máquina que não bifurca: a sessão vai com a frente, a conversa a larga e o dono segue com o histórico", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx, "claude-cli");
      const s = randomUUID();
      await m.repos.conversas.atualizarSessaoCli(m.conversaId, s, "local", "claude-cli");
      await m.falaDaPessoa("levante os números do trimestre");
      const vivo = await m.turno();
      expect((await m.despachar(vivo.id)).entrada.sessaoCli).toBe(s);

      const frente = (await m.promover(vivo.id, { sessaoCli: s, maquinaBifurca: false })).data.trabalho!;
      expect(frente).toMatchObject({ forma: "frente", origem: "rede", sessaoCli: s });
      expect((await m.repos.conversas.buscar(m.conversaId))?.sessaoCli).toBeNull();

      // A próxima fala da pessoa não retoma a sessão da frente (nem a bifurca) e recebe o histórico.
      await m.falaDaPessoa("e o outro assunto?");
      const proxima = await m.plano((await m.turno({ texto: "e o outro assunto?" })).id);
      expect(proxima.entrada.sessaoCli).toBeNull();
      expect(proxima.entrada.bifurcar).toBeUndefined();
      expect(proxima.promptSistema).toContain("levante os números do trimestre");

      // O promovido termina numa sessão que é só da frente: ela não volta para a conversa (S16 só vale quando bifurcou).
      await assentarTurno(m.deps, { turnoId: vivo.id, machineId: m.maquina, seqLocal: 1, fala: { tipo: "texto", texto: "feito" }, resultado: sucesso(s), executor: "local", harness: "claude-cli", maquinaBifurca: false });
      expect((await m.repos.conversas.buscar(m.conversaId))?.sessaoCli).toBeNull();
      expect((await m.repos.trabalhos.buscar(frente.id))?.sessaoCli).toBe(s);
    });
  });

  it("sem bifurcar, o promovido que começou sessão nova também a guarda só na frente; bifurcando, ela vira a da conversa (S16)", async () => {
    for (const maquinaBifurca of [false, true]) {
      await withRollback(MARLON, async (trx) => {
        const m = await montar(trx, "claude-cli");
        const vivo = await m.turno();
        expect((await m.despachar(vivo.id)).entrada.sessaoCli).toBeNull();
        const frente = (await m.promover(vivo.id, { sessaoCli: null, maquinaBifurca })).data.trabalho!;
        await assentarTurno(m.deps, { turnoId: vivo.id, machineId: m.maquina, seqLocal: 1, fala: { tipo: "texto", texto: "feito" }, resultado: sucesso("sessao-nova"), executor: "local", harness: "claude-cli", maquinaBifurca });
        expect((await m.repos.trabalhos.buscar(frente.id))?.sessaoCli).toBe("sessao-nova");
        expect((await m.repos.conversas.buscar(m.conversaId))?.sessaoCli).toBe(maquinaBifurca ? "sessao-nova" : null);
      });
    }
  });

  it("bifurcando (como desde a #193): a conversa fica com a sessão e a próxima fala sai com bifurcar", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx, "claude-cli");
      const s = randomUUID();
      await m.repos.conversas.atualizarSessaoCli(m.conversaId, s, "local", "claude-cli");
      const vivo = await m.turno();
      await m.despachar(vivo.id);
      const frente = (await m.promover(vivo.id, { sessaoCli: s, maquinaBifurca: true })).data.trabalho!;
      expect(frente).toMatchObject({ forma: "frente", sessaoCli: s });
      expect((await m.repos.conversas.buscar(m.conversaId))?.sessaoCli).toBe(s);
      expect((await m.plano((await m.turno()).id)).entrada).toMatchObject({ sessaoCli: s, bifurcar: true });
    });
  });

  it("a retomada do dono em modo conversa também vira frente, com o título do que a pessoa pediu; fora do modo conversa, não", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx, "codex-cli");
      const original = await m.turno({ texto: "revise o contrato da Acme" });
      await m.repos.turnos.reivindicar({ machineId: m.maquina, agora: Date.now() });
      await assentarTurno(m.deps, { turnoId: original.id, machineId: m.maquina, seqLocal: 1, fala: { tipo: "texto", texto: "preciso da sua aprovação" }, resultado: sucesso(null), executor: "local", harness: "codex-cli" });
      const retomada = await m.turno({ origem: "retomada", retomaTurnoId: original.id, texto: "[nod] A pessoa aprovou. Continue." });
      expect(retomada.trabalhoId).toBeNull();
      await m.despachar(retomada.id);

      expect((await m.promover(retomada.id, { sessaoCli: null, maquinaBifurca: false, modo: "rotina" })).data.trabalho).toBeNull();
      const frente = (await m.promover(retomada.id, { sessaoCli: null, maquinaBifurca: false })).data.trabalho!;
      // O provisório sai da raiz da cadeia (o que a pessoa pediu), nunca da entrada "[nod] …" da retomada.
      expect(frente).toMatchObject({ forma: "frente", origem: "rede", titulo: "Revise o contrato da Acme" });
      expect(await m.repos.frentes.buscarLote(frente.loteId!)).toMatchObject({ abertoPorTurnoId: retomada.id });
    });
  });

  it("mensagem só com link, só com emoji ou vazia: a frente da rede vira 'Frente da conversa' (plano chat limpo, PR 5)", async () => {
    await withRollback(MARLON, async (trx) => {
      // Um bot por mensagem: a conversa tem um turno do dono despachando por vez.
      for (const texto of ["https://github.com/gamefik/nod/pull/391", "🎉🎉", ""]) {
        const m = await montar(trx, "codex-cli");
        const vivo = await m.turno({ texto });
        await m.despachar(vivo.id);
        const frente = (await m.promover(vivo.id, { sessaoCli: null, maquinaBifurca: false })).data.trabalho!;
        expect(frente).toMatchObject({ forma: "frente", origem: "rede", titulo: "Frente da conversa" });
      }
    });
  });

  it("sem harness no plano (catcher puro), nada a decidir: não promove", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx, "codex-cli");
      const vivo = await m.turno();
      await m.despachar(vivo.id);
      const r = await promoverNaRede(m.deps, { turnoId: vivo.id, despachadoEm: Date.now() - REDE_MS, fezFerramenta: true, harness: null, sessaoCli: null, maquinaBifurca: false, modo: "conversa" });
      expect(r.data.trabalho).toBeNull();
      expect((await m.repos.turnos.buscar(vivo.id))?.trabalhoId).toBeNull();
    });
  });
});
