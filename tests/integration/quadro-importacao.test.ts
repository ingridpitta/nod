import { afterAll, beforeAll, expect, it } from "vitest";
import { criarRotasDecisoes } from "../../src/adapters/http/rotas/decisoes.ts";
import { criarRotasPropostas } from "../../src/adapters/http/rotas/propostas.ts";
import { rotasQuadro } from "../../src/adapters/http/rotas/quadro.ts";
import type { DepsRotas } from "../../src/adapters/http/rotas/executar-caso.ts";
import { FRASE_SEM_CONECTOR, type FonteLinear, type IssueLinear } from "../../src/contracts/quadro-importacao.ts";
import type { OpQuadro } from "../../src/contracts/quadro.ts";
import type { RuntimeEvent } from "../../src/contracts/evento.ts";
import { ErroDeDominio } from "../../src/domain/erro.ts";
import { criarRepos } from "../../src/repositories/index.ts";
import type { Escopo, Tx } from "../../src/shared/types.ts";
import { vincularEscopo } from "../../src/db/tx.ts";
import { EXECUTORES_QUADRO } from "../../src/use-cases/acoes/quadro.ts";
import { chamarFerramentaFase1, concluirChamada, executarEfeito } from "../../src/use-cases/chamar-ferramenta.ts";
import { comentarTarefa } from "../../src/use-cases/comentar-tarefa.ts";
import { decidirAssumirQuadro } from "../../src/use-cases/assumir-quadro.ts";
import { recusarPropostaPelaConversa } from "../../src/use-cases/decidir-acesso.ts";
import { gerirQuadro, gerirQuadroEmFases } from "../../src/use-cases/gerir-quadro.ts";
import { FERRAMENTAS_NOD } from "../../src/contracts/ferramentas-nod.ts";
import type { PlanoTurno } from "../../src/contracts/plano-turno.ts";
import { ERRO_IMPORTACAO_PARADA } from "../../src/domain/importar-linear.ts";
import { decidirImportacaoLinear, previaDaTela, trazerImportacao, type RodarNaTx } from "../../src/use-cases/importar-linear.ts";
import { aplicarLoteQuadro, montarQuadro, verTarefaPorCodigo } from "../../src/use-cases/quadro.ts";
import type { Deps } from "../../src/use-cases/tipos.ts";
import { pessoaDeTeste } from "../helpers/pessoa-de-teste.ts";
import { ANA, depsSobreTrx, executar, MARLON, servicosDeTeste, useCasesDeTeste } from "../helpers/deps-l6.ts";
import { servidorDeTeste, type ServidorDeTeste } from "../helpers/servidor-de-teste.ts";
import { agenteComConversa, autoriaPessoa } from "../helpers/fabricas.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/**
 * NOD-422 (PR 1): trazer o time do Linear para o quadro pelo servidor. O card de prévia (pela conversa) e o clique (pela
 * tela) iniciam a importação; a busca roda depois do commit, com progresso, e aplica num lote só, com Desfazer; ninguém é
 * acionado; reimportar não duplica; falhar no meio não muda nada; sem o Linear conectado, recusa antes do card.
 */

const issue = (n: number, estado: string, o: Partial<IssueLinear> = {}): IssueLinear => ({
  identificador: `NOD-${n}`, numero: n, titulo: `Issue ${n}`, url: `https://linear.app/gamefik/issue/NOD-${n}/issue-${n}`, descricao: "corpo",
  estado, noEstadoDesde: Date.UTC(2026, 9, 30), etiquetas: [], mae: null, bloqueadaPor: [], comentarios: [], anexos: [], ...o,
});
const TRES = (): IssueLinear[] => [
  issue(901, "Implementando", { comentarios: [{ id: "c1", autor: "Ada", texto: "começa por aqui", criadoEm: Date.UTC(2026, 9, 31) }] }),
  issue(902, "Backlog"),
  issue(903, "Revisando", { anexos: [{ url: "https://github.com/gamefik/nod/pull/9", criadoEm: Date.UTC(2026, 9, 31) }] }),
];

/** O Linear de mentira: as issues abertas do time, e uma falha opcional no meio da busca completa. */
function linearFalso() {
  const f = { issues: TRES(), falharNaCompleta: false, trazidasAntesDeFalhar: 1, falharCom: "conector_indisponivel" as "conector_indisponivel" | "integracao_autenticacao", falharNaPrevia: false, chamadas: [] as { completo: boolean }[], descartadas: [] as (string | null)[] };
  const fonte: FonteLinear = {
    async listar(_cred, p) {
      f.chamadas.push({ completo: p.completo });
      if (!p.completo && f.falharNaPrevia) throw new ErroDeDominio(f.falharCom);
      if (p.completo && f.falharNaCompleta) {
        await p.aoAvancar?.(f.trazidasAntesDeFalhar);
        throw new ErroDeDominio(f.falharCom);
      }
      await p.aoAvancar?.(f.issues.length);
      for (const d of f.descartadas) p.aoDescartar?.(d);
      return f.issues;
    },
  };
  return { f, fonte };
}

async function montar(trx: Tx, o: { conectado?: boolean; semFonte?: boolean } = {}) {
  const { f, fonte } = linearFalso();
  const services = { ...servicosDeTeste((t) => criarRepos(t, MARLON), MARLON), ...(o.semFonte ? {} : { linear: fonte }) };
  const d = depsSobreTrx(trx, MARLON, { services });
  await d.repos.preferencias.gravar({ experimentos: { quadro: true } });
  const sufixo = Math.random().toString(36).slice(2, 7);
  const host = await agenteComConversa(trx, MARLON, { nome: `Host ${sufixo}` });
  const faustino = await agenteComConversa(trx, MARLON, { nome: "Faustino" });
  if (o.conectado !== false) {
    await d.repos.composio.salvarChave("cifrada-de-teste");
    const [conector] = await trx<{ id: string }[]>`
      insert into conectores (tenant_id, owner_id, nome, slug, transporte, url, declaracao)
      values (${MARLON.tenantId}, ${MARLON.pessoaId}, 'Linear', 'linear', 'http', 'https://exemplo.invalid/mcp', 'toca')
      returning id`;
    await d.repos.composio.salvarSessao({ toolkit: "linear", sessaoId: "sess_l", contaId: "ca_l", conectorId: conector!.id });
  }
  const lote = (ops: OpQuadro[]) => executar(d, aplicarLoteQuadro, { autor: { tipo: "pessoa" }, anfitriaoId: host.agenteId, executor: "catcher", ops });
  expect((await lote([{ tipo: "criar_quadro" }])).data).toMatchObject({ ok: true });
  const quadro = async () => (await d.repos.quadros.doAgente(host.agenteId))!;
  const dto = async () => montarQuadro(d, await quadro());
  const rodar: RodarNaTx = async (fn) => {
    const x = await fn(d);
    if (x.events?.length) await d.repos.events.gravarComOutbox(x.events);
    return x.data;
  };
  const turno = async () => {
    const t = await d.repos.turnos.enfileirar({ executor: "catcher", conversaId: host.conversaId, agenteId: host.agenteId, origem: "conversa", prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "traz o NOD", entradaConfianca: "confiavel", modelo: "auto" });
    return { turnoId: t!.id, agenteId: host.agenteId, conversaId: host.conversaId };
  };
  /** O bot pede na conversa: o card de prévia. */
  const pedir = async (op: OpQuadro = { tipo: "importar_time_linear", time: "nod" }) => (await executar(d, gerirQuadro, { ...(await turno()), acoes: [op] })).data;
  /** Pela tela: o clique em Trazer. */
  const pelaTela = (time = "nod") => executar(d, EXECUTORES_QUADRO["quadro.importar_time_linear"], { anfitriaoId: host.agenteId, executor: "catcher", time });
  const trazer = async () => trazerImportacao(rodar, (await d.repos.quadroImportacoes.ultima((await quadro()).id))!.id);
  /** Outro quadro da pessoa (sem importar nada) e o mesmo time importado nele (revisão 10). */
  const outroQuadro = async () => {
    const nome = `Outro ${Math.random().toString(36).slice(2, 7)}`;
    const outro = await agenteComConversa(trx, MARLON, { nome });
    expect((await executar(d, aplicarLoteQuadro, { autor: { tipo: "pessoa" }, anfitriaoId: outro.agenteId, executor: "catcher", ops: [{ tipo: "criar_quadro" }] })).data).toMatchObject({ ok: true });
    const q = async () => (await d.repos.quadros.doAgente(outro.agenteId))!;
    const importar = async () => {
      await executar(d, EXECUTORES_QUADRO["quadro.importar_time_linear"], { anfitriaoId: outro.agenteId, executor: "catcher", time: "NOD" });
      return trazerImportacao(rodar, (await d.repos.quadroImportacoes.ultima((await q()).id))!.id);
    };
    return { ...outro, nome, quadro: q, dto: async () => montarQuadro(d, await q()), importar };
  };
  const turnosAbertos = async () => (await trx<{ n: number }[]>`select count(*)::int as n from turnos where agente_id = any(${[host.agenteId, faustino.agenteId]}) and origem <> 'conversa'`)[0]!.n;
  return { trx, d, f, host, faustino, lote, quadro, dto, pedir, pelaTela, trazer, turnosAbertos, turno, outroQuadro };
}

/** As linhas "Linear · em X" da tarefa, na ordem (null = "fechada no Linear"). */
const linhasDoLinear = async (trx: Tx, tarefaId: string) =>
  (await trx<{ para: string | null }[]>`select para from quadro_tarefa_historico where tarefa_id = ${tarefaId} and campo = 'linear' order by criado_em, id`).map((l) => l.para);

describeIntegracao("trazer o time do Linear para o quadro (NOD-422)", () => {
  it("o card mostra a prévia e nada muda; confirmar traz tudo num lote, sem responsável e sem turno", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const antes = await m.dto();
      const r = await m.pedir();
      if (!r.ok || !r.proposta_id) throw new Error(JSON.stringify(r));
      expect(m.f.chamadas).toEqual([{ completo: false }]);
      const proposta = await m.d.repos.propostas.buscar(r.proposta_id);
      expect(proposta?.payload).toMatchObject({ kind: "importacao_linear", time: "NOD", previa: { total: 3 } });
      expect((await m.d.repos.decisoes.buscar(r.proposta_id))?.tipo).toBe("importacao_linear");
      expect((await m.dto()).tarefas).toEqual(antes.tarefas);
      expect(await m.d.repos.quadroImportacoes.ultima((await m.quadro()).id)).toBeNull();

      const dec = await executar(m.d, decidirImportacaoLinear, { decisaoId: r.proposta_id, recusar: false });
      expect(dec.data).toMatchObject({ iniciada: true, importacaoId: r.proposta_id });
      expect((await m.dto()).importacao).toMatchObject({ estado: "trazendo", total: 3 });
      expect(await m.trazer()).toBe("aplicada");

      const q = await m.dto();
      expect(q.importacao).toMatchObject({ estado: "aplicada", trazidas: 3, total: 3 });
      expect(q.tarefas.map((t) => [t.linearId, t.status, t.agenteId, t.prUrl]).sort()).toEqual([
        ["NOD-901", "fazendo", null, null],
        ["NOD-902", "backlog", null, null],
        ["NOD-903", "revisao", null, "https://github.com/gamefik/nod/pull/9"],
      ]);
      // O quadro só tem tarefas do Linear: o prefixo vira o do time e o NOD-901 continua NOD-901.
      expect(q.tarefas.map((t) => t.codigo).sort()).toEqual(["NOD-901", "NOD-902", "NOD-903"]);
      // As colunas viram as do Linear; Revisando é do Faustino (padrão); a coluna sem bot fica sem ninguém.
      const revisao = q.colunas.find((c) => c.id === "revisao");
      expect(revisao).toMatchObject({ nome: "Revisando", responsavelNome: "Faustino" });
      expect(await m.turnosAbertos()).toBe(0);
      expect((await m.d.repos.quadros.tarefas(q.id)).every((t) => t.turnoId === null)).toBe(true);
      // Os comentários do Linear vêm marcados.
      const t901 = q.tarefas.find((t) => t.linearId === "NOD-901")!;
      expect((await m.d.repos.quadroComentarios.daTarefa(t901.id)).map((c) => [c.texto, c.autorNome, c.autor])).toEqual([["começa por aqui", "Ada", { tipo: "linear" }]]);
      // O recibo na conversa e nada escrito no Linear (a fonte só lista).
      const recibos = (await m.d.repos.mensagens.listarDaConversa(m.host.conversaId)).filter((x) => x.kind === "sistema").map((x) => x.texto);
      expect(recibos.at(-1)).toContain("Trouxe 3 tarefas do Linear (NOD)");
      expect(recibos.at(-1)).toContain("ninguém foi acionado");
    });
  });

  it("recusar o card fecha sem mudar nada; o card velho, depois de outra importação, volta obsoleto", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const a = await m.pedir();
      if (!a.ok || !a.proposta_id) throw new Error("card");
      expect((await executar(m.d, decidirImportacaoLinear, { decisaoId: a.proposta_id, recusar: true })).data).toEqual({ iniciada: false, importacaoId: null });
      expect(await m.d.repos.quadroImportacoes.ultima((await m.quadro()).id)).toBeNull();

      const b = await m.pedir();
      if (!b.ok || !b.proposta_id) throw new Error("card");
      // Enquanto o card espera, a pessoa trouxe pela tela: o Confirmar não abre a segunda.
      expect((await m.pelaTela()).data).toMatchObject({ ok: true, importacao: { estado: "trazendo" } });
      expect((await executar(m.d, decidirImportacaoLinear, { decisaoId: b.proposta_id, recusar: false })).data).toMatchObject({ iniciada: false, obsoleta: true });
      // E a tela também recusa a segunda enquanto a primeira traz.
      await expect(m.pelaTela()).rejects.toMatchObject({ codigo: "estado_invalido" });
    });
  });

  it("reimportar não duplica: atualiza o que mudou; a que fechou no Linear só ganha a linha no histórico, uma vez (revisão do PR #630)", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      await m.pelaTela();
      expect(await m.trazer()).toBe("aplicada");
      m.f.issues = [issue(901, "Revisando"), issue(902, "Backlog")];
      await m.pelaTela();
      expect(await m.trazer()).toBe("aplicada");
      const q = await m.dto();
      expect(q.tarefas).toHaveLength(3);
      const por = new Map(q.tarefas.map((t) => [t.linearId, t]));
      expect(por.get("NOD-901")?.status).toBe("revisao");
      // A spec: fechada no Linear não muda de coluna; só a linha "fechada no Linear".
      expect(por.get("NOD-903")?.status).toBe("revisao");
      expect(await linhasDoLinear(trx, por.get("NOD-903")!.id)).toEqual(["Revisando", null]);
      expect(q.ultimoLote?.resumo).toContain("1 fechada no Linear");
      // Reimportar de novo não repete a linha.
      await m.pelaTela();
      expect(await m.trazer()).toBe("aplicada");
      expect(await linhasDoLinear(trx, por.get("NOD-903")!.id)).toEqual(["Revisando", null]);
      // Com o filtro sem o Backlog a busca não traz o Backlog: a 902 não é dada como fechada.
      m.f.issues = [issue(901, "Revisando")];
      await executar(m.d, EXECUTORES_QUADRO["quadro.importar_time_linear"], { anfitriaoId: m.host.agenteId, executor: "catcher", time: "NOD", filtro: "sem_backlog" });
      expect(await m.trazer()).toBe("aplicada");
      expect(await linhasDoLinear(trx, por.get("NOD-902")!.id)).toEqual(["Backlog"]);
      expect(await m.turnosAbertos()).toBe(0);
    });
  });

  it("revisão 4 do PR #630: a reimportação que muda a tarefa de coluna grava tarefa_movida (regra, com o lote)", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      await m.pelaTela();
      expect(await m.trazer()).toBe("aplicada");
      m.f.issues = [issue(901, "Revisando"), issue(902, "Backlog"), issue(903, "Revisando")];
      await m.pelaTela();
      expect(await m.trazer()).toBe("aplicada");
      const q = await m.dto();
      const t901 = q.tarefas.find((t) => t.linearId === "NOD-901")!;
      const ev = await trx<{ dados: Record<string, unknown> }[]>`select dados from events where tenant_id = ${MARLON.tenantId} and kind = 'tarefa_movida'`;
      expect(ev.map((e) => e.dados)).toEqual([{ quadro_id: q.id, tarefa_id: t901.id, de: "fazendo", para: "revisao", autor: "regra", autor_agente_id: null, lote_id: q.ultimoLote!.id }]);
    });
  });

  it("reimportar não passa por cima do que a pessoa mexeu nem da tarefa com turno vivo: só a linha no histórico (revisão do PR #630)", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      await m.pelaTela();
      expect(await m.trazer()).toBe("aplicada");
      const id = async (l: string) => (await m.d.repos.quadros.tarefas((await m.quadro()).id)).find((t) => t.linearId === l)!;
      // A pessoa tirou a 901 de Implementando e pôs uma pergunta.
      expect((await m.lote([{ tipo: "mudar_tarefa", tarefa: "NOD-901", status: "backlog" }])).data).toMatchObject({ ok: true });
      // A 903 tem um turno vivo; a 902, um turno que já acabou (sem mexer no mudado_em: não é mexida da pessoa).
      const vivo = (await m.turno()).turnoId;
      const acabou = (await m.turno()).turnoId;
      await trx`update turnos set estado = 'concluido' where id = ${acabou}`;
      await trx`update quadro_tarefas set turno_id = ${vivo}, mudado_em = mudado_em where id = ${(await id("NOD-903")).id}`;
      await trx`update quadro_tarefas set turno_id = ${acabou}, mudado_em = mudado_em where id = ${(await id("NOD-902")).id}`;

      const depois = { noEstadoDesde: Date.UTC(2026, 10, 1) };
      m.f.issues = [issue(901, "Revisando", depois), issue(902, "Implementando", depois), issue(903, "Implementando", depois)];
      await m.pelaTela();
      expect(await m.trazer()).toBe("aplicada");
      const t901 = await id("NOD-901");
      const t902 = await id("NOD-902");
      const t903 = await id("NOD-903");
      expect(t901.status).toBe("backlog");
      expect(await linhasDoLinear(trx, t901.id)).toEqual(["Implementando", "Revisando"]);
      expect([t903.status, t903.turnoId]).toEqual(["revisao", vivo]);
      expect(await linhasDoLinear(trx, t903.id)).toEqual(["Revisando", "Implementando"]);
      // A que ninguém mexeu muda de coluna e solta o turno velho (o turnoId não segue vivo em outra coluna).
      expect([t902.status, t902.turnoId]).toEqual(["fazendo", null]);
      expect((await m.dto()).ultimoLote?.resumo).toContain("2 mexidas aqui ficaram como estavam");
      // Reimportar igual não repete as linhas.
      await m.pelaTela();
      expect(await m.trazer()).toBe("aplicada");
      expect(await linhasDoLinear(trx, t901.id)).toEqual(["Implementando", "Revisando"]);
    });
  });

  it("a importação 'trazendo' parada há mais de 10 minutos (o processo caiu) não trava o quadro: vira falhou e a próxima passa (revisão do PR #630)", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      expect((await m.pelaTela()).data).toMatchObject({ ok: true, importacao: { estado: "trazendo" } });
      const parada = (await m.d.repos.quadroImportacoes.ultima((await m.quadro()).id))!;
      // Recente ainda bloqueia.
      await expect(m.pelaTela()).rejects.toMatchObject({ codigo: "estado_invalido" });
      await trx`update quadro_importacoes set atualizado_em = clock_timestamp() - interval '11 minutes' where id = ${parada.id}`;
      // A tela já a mostra como falhou (para de reler a cada 2 s).
      expect((await m.dto()).importacao).toMatchObject({ id: parada.id, estado: "falhou", erro: ERRO_IMPORTACAO_PARADA });
      // A prévia pela conversa e o Trazer pela tela passam.
      expect(await m.pedir()).toMatchObject({ ok: true });
      expect((await m.pelaTela()).data).toMatchObject({ ok: true, importacao: { estado: "trazendo" } });
      expect(await m.d.repos.quadroImportacoes.buscar(parada.id)).toMatchObject({ estado: "falhou", erro: ERRO_IMPORTACAO_PARADA });
      expect(await m.trazer()).toBe("aplicada");
      // Se a busca velha ainda acordar, já não aplica nada.
      expect(await trazerImportacao(async (fn) => (await fn(m.d)).data, parada.id)).toBe("ignorada");
    });
  });

  it("se o aplicar não marca a importação (outra transação a venceu), lança e a transação inteira volta (revisão do PR #630)", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const antes = await m.dto();
      await m.pelaTela();
      const imp = (await m.d.repos.quadroImportacoes.ultima((await m.quadro()).id))!;
      // Cada passo numa savepoint (a transação de verdade); no aplicar, o repo diz que já não estava trazendo.
      const rodar: RodarNaTx = (fn) => trx.savepoint(async (sp) => {
        const d = depsSobreTrx(sp as unknown as Tx, MARLON, { services: m.d.services });
        const ri = { ...d.repos.quadroImportacoes, aplicar: async () => false };
        const x = await fn({ ...d, repos: { ...d.repos, quadroImportacoes: ri } });
        if (x.events?.length) await d.repos.events.gravarComOutbox(x.events);
        return x.data;
      }) as never;
      expect(await trazerImportacao(rodar, imp.id)).toBe("falhou");
      const q = await m.dto();
      expect(q.tarefas).toEqual(antes.tarefas);
      expect(q.colunas).toEqual(antes.colunas);
      expect(q.importacao).toMatchObject({ estado: "falhou" });
    });
  });

  it("falhar no meio da busca não muda nada: a importação fica 'falhou' com onde parou", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const antes = await m.dto();
      m.f.falharNaCompleta = true;
      await m.pelaTela();
      expect(await m.trazer()).toBe("falhou");
      const q = await m.dto();
      expect(q.importacao).toMatchObject({ estado: "falhou", trazidas: 1 });
      expect(q.importacao?.erro).toContain("Parei em 1 de 3");
      expect(q.tarefas).toEqual(antes.tarefas);
      expect(q.colunas).toEqual(antes.colunas);
      // Pode tentar de novo.
      m.f.falharNaCompleta = false;
      await m.pelaTela();
      expect(await m.trazer()).toBe("aplicada");
    });
  });

  it("revisão 9: o time cresceu depois da prévia; a frase de falha nunca diz 'Parei em X de Y' com Y menor que X", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      m.f.falharNaCompleta = true;
      m.f.trazidasAntesDeFalhar = 25;
      await m.pelaTela();
      expect((await m.dto()).importacao).toMatchObject({ estado: "trazendo", total: 3 });
      expect(await m.trazer()).toBe("falhou");
      expect((await m.dto()).importacao?.erro).toBe("Parei em 25 de 25: o Linear não respondeu. Nada mudou no quadro; tente de novo em instantes.");
      m.f.falharCom = "integracao_autenticacao";
      await m.pelaTela();
      expect(await m.trazer()).toBe("falhou");
      expect((await m.dto()).importacao?.erro).toBe("Parei em 25 de 25: o Linear recusou o acesso (reconecte o Linear em Conectores). Nada mudou no quadro.");
    });
  });

  it("revisão 9: o card de importação proposto antes do assumir; confirmar depois é recusado e nada começa a trazer", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const r = await m.pedir();
      if (!r.ok || !r.proposta_id) throw new Error(JSON.stringify(r));
      const q = await m.quadro();
      expect(await m.d.repos.quadroImportacoes.marcarAssumido(q.id, Date.now())).toBe(true);
      const dec = await executar(m.d, decidirImportacaoLinear, { decisaoId: r.proposta_id, recusar: false });
      expect(dec.data).toEqual({ iniciada: false, importacaoId: null, obsoleta: true });
      expect(await m.d.repos.quadroImportacoes.ultima(q.id)).toBeNull();
      expect((await m.d.repos.propostas.buscar(r.proposta_id))?.estado).toBe("recusada");
      const recibo = await trx<{ texto: string }[]>`select texto from mensagens where conversa_id = ${m.host.conversaId} and assunto = 'aprovacao.recibo' order by criado_em desc limit 1`;
      expect(recibo[0]?.texto).toContain("Nada foi importado: o quadro já assumiu o");
    });
  });

  it("revisão 6: o Linear fora do ar na prévia é linear_indisponivel (tente de novo, sem pedir_acesso); a recusa da conta segue sem_conector", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      m.f.falharNaPrevia = true;
      const fora = await m.pedir();
      expect(fora).toMatchObject({ ok: false, erro: "linear_indisponivel", instrucao: expect.stringContaining("o Linear não respondeu, tente de novo em instantes") });
      expect((fora as { instrucao: string }).instrucao).toContain("não chame pedir_acesso");
      expect((fora as { instrucao: string }).instrucao).not.toMatch(/peça à pessoa o acesso/);
      expect((await executar(m.d, previaDaTela, { agenteId: m.host.agenteId, time: "NOD", filtro: null })).data).toMatchObject({ ok: false, erro: "linear_indisponivel" });
      m.f.falharCom = "integracao_autenticacao";
      const recusada = await m.pedir();
      expect(recusada).toMatchObject({ ok: false, erro: "sem_conector", instrucao: expect.stringContaining("pedir_acesso, conector linear") });
      expect((await executar(m.d, previaDaTela, { agenteId: m.host.agenteId, time: "NOD", filtro: null })).data).toMatchObject({ ok: false, erro: "sem_conector" });
    });
  });

  it("revisão 6: a busca completa recusada pela conta diz reconectar; a que caiu diz tentar de novo", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      m.f.falharNaCompleta = true;
      m.f.falharCom = "integracao_autenticacao";
      await m.pelaTela();
      expect(await m.trazer()).toBe("falhou");
      expect((await m.dto()).importacao?.erro).toBe("Parei em 1 de 3: o Linear recusou o acesso (reconecte o Linear em Conectores). Nada mudou no quadro.");
      m.f.falharCom = "conector_indisponivel";
      await m.pelaTela();
      expect(await m.trazer()).toBe("falhou");
      expect((await m.dto()).importacao?.erro).toBe("Parei em 1 de 3: o Linear não respondeu. Nada mudou no quadro; tente de novo em instantes.");
    });
  });

  it("sem o Linear conectado (ou com a busca desligada no servidor) recusa antes do card, pela conversa e pela tela", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx, { conectado: false });
      expect(await m.pedir()).toMatchObject({ ok: false, erro: "sem_conector" });
      await expect(m.pelaTela()).rejects.toMatchObject({ codigo: "integracao_nao_configurada" });
      expect((await executar(m.d, previaDaTela, { agenteId: m.host.agenteId, time: "NOD", filtro: null })).data).toMatchObject({ ok: false, erro: "sem_conector" });
      expect(m.f.chamadas).toEqual([]);
    });
    await withRollback(MARLON, async (trx) => {
      // Revisão 4 do PR #630: a busca desligada no servidor tem código e instrução próprios; o bot não pede acesso à toa.
      const m = await montar(trx, { semFonte: true });
      const r = await m.pedir();
      expect(r).toMatchObject({ ok: false, erro: "importacao_indisponivel", instrucao: expect.stringContaining("não está disponível neste servidor") });
      expect((r as { instrucao: string }).instrucao).toContain("não chame pedir_acesso");
      expect((r as { instrucao: string }).instrucao).not.toMatch(/peça à pessoa o acesso/);
      await expect(m.pelaTela()).rejects.toMatchObject({ codigo: "nao_permitido" });
      expect((await executar(m.d, previaDaTela, { agenteId: m.host.agenteId, time: "NOD", filtro: null })).data).toMatchObject({ ok: false, erro: "importacao_indisponivel" });
    });
  });

  it("com o quadro desligado nos experimentos, a op, a tela e a prévia recusam (NOD_QUADROS)", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      await m.d.repos.preferencias.gravar({ experimentos: { quadro: false } });
      expect(await m.pedir()).toMatchObject({ ok: false, erro: "experimento_desligado" });
      await expect(m.pelaTela()).rejects.toBeInstanceOf(ErroDeDominio);
      expect((await executar(m.d, previaDaTela, { agenteId: m.host.agenteId, time: "NOD", filtro: null })).data).toMatchObject({ ok: false, erro: "experimento_desligado" });
      expect(m.f.chamadas).toEqual([]);
      expect(await m.d.repos.quadroImportacoes.ultima((await m.quadro()).id)).toBeNull();
    });
  });

  it("colisão com uma tarefa nativa: a importada ganha número novo e o NOD-xxx do Linear ainda a acha", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      expect((await m.lote([{ tipo: "criar_tarefa", titulo: "Nativa", status: "backlog" }])).data).toMatchObject({ ok: true });
      const nativa = (await m.dto()).tarefas[0]!;
      m.f.issues = [issue(nativa.numero!, "Backlog"), issue(950, "Implementando")];
      await m.pelaTela();
      expect(await m.trazer()).toBe("aplicada");
      const q = await m.dto();
      const colidiu = q.tarefas.find((t) => t.linearId === `NOD-${nativa.numero}`)!;
      expect(colidiu.numero).not.toBe(nativa.numero);
      expect(q.tarefas.find((t) => t.id === nativa.id)?.codigo).toBe(nativa.codigo);
      expect((await m.lote([{ tipo: "mudar_tarefa", tarefa: `NOD-${nativa.numero}`, titulo: "Achada pelo Linear" }])).data).toMatchObject({ ok: true });
      const depois = await m.dto();
      expect(depois.tarefas.find((t) => t.id === colidiu.id)?.titulo).toBe("Achada pelo Linear");
      expect(depois.tarefas.find((t) => t.id === nativa.id)?.titulo).toBe("Nativa");
    });
  });

  it("a prévia pela tela conta por coluna e só lê; time inválido é 400", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const r = (await executar(m.d, previaDaTela, { agenteId: m.host.agenteId, time: "nod", filtro: null })).data;
      expect(r).toMatchObject({ ok: true, time: "NOD", previa: { total: 3 } });
      expect(await m.d.repos.quadroImportacoes.ultima((await m.quadro()).id)).toBeNull();
      await expect(executar(m.d, previaDaTela, { agenteId: m.host.agenteId, time: "../x", filtro: null })).rejects.toMatchObject({ codigo: "entrada_invalida" });
    });
  });

  it("mais de 500 abertas recusa com quantas seriam sem o Backlog; com o filtro, a prévia e o Trazer passam (decisão 4)", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      m.f.issues = [...Array.from({ length: 490 }, (_, i) => issue(1000 + i, "Backlog")), ...Array.from({ length: 20 }, (_, i) => issue(2000 + i, "Implementando"))];
      const cheio = await m.pedir();
      expect(cheio).toMatchObject({ ok: false, erro: "demais" });
      expect(JSON.stringify(cheio)).toContain("sem o Backlog seriam 20");
      expect((await executar(m.d, previaDaTela, { agenteId: m.host.agenteId, time: "NOD", filtro: null })).data).toMatchObject({ ok: false, erro: "demais" });
      expect((await executar(m.d, previaDaTela, { agenteId: m.host.agenteId, time: "NOD", filtro: "sem_backlog" })).data).toMatchObject({ ok: true, previa: { total: 20 } });
      expect(await m.d.repos.quadroImportacoes.ultima((await m.quadro()).id)).toBeNull();
      await expect(m.pelaTela("NOD")).rejects.toBeInstanceOf(ErroDeDominio);
      expect(await m.d.repos.quadroImportacoes.ultima((await m.quadro()).id)).toBeNull();
      await executar(m.d, EXECUTORES_QUADRO["quadro.importar_time_linear"], { anfitriaoId: m.host.agenteId, executor: "catcher", time: "NOD", filtro: "sem_backlog" });
      expect(await m.trazer()).toBe("aplicada");
      expect((await m.dto()).tarefas).toHaveLength(20);
    });
  });

  it("o código do Linear e a URL acham a tarefa importada", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      await m.pelaTela();
      await m.trazer();
      expect((await m.lote([{ tipo: "mudar_tarefa", tarefa: "NOD-902", titulo: "Pelo código" }])).data).toMatchObject({ ok: true });
      expect((await m.lote([{ tipo: "mudar_tarefa", tarefa: "https://linear.app/gamefik/issue/NOD-903/issue-903", titulo: "Pela URL" }])).data).toMatchObject({ ok: true });
      const titulos = new Map((await m.dto()).tarefas.map((t) => [t.linearId, t.titulo]));
      expect([titulos.get("NOD-902"), titulos.get("NOD-903")]).toEqual(["Pelo código", "Pela URL"]);
      // Revisão 6: o link (`?tarefa=`) com a URL do Linear abre a tarefa importada.
      const t903 = (await m.dto()).tarefas.find((t) => t.linearId === "NOD-903")!;
      expect((await executar(m.d, verTarefaPorCodigo, { codigo: "https://linear.app/gamefik/issue/NOD-903/issue-903" })).data).toMatchObject({ tarefaId: t903.id });
    });
  });

  it("Desfazer volta a importação inteira; depois de mexer numa tarefa importada, recusa dizendo qual", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const antes = await m.dto();
      await m.pelaTela();
      await m.trazer();
      const depois = await m.dto();
      const loteId = depois.importacao!.loteId!;
      const t901 = depois.tarefas.find((t) => t.linearId === "NOD-901")!;
      expect((await m.lote([{ tipo: "desfazer", lote: loteId }])).data).toMatchObject({ ok: true, desfeito: true });
      const voltou = await m.dto();
      // A importação trocou o prefixo pelo do time (quadro vazio); o Desfazer o devolve (revisão do PR #630).
      expect(depois.prefixo).toBe("NOD");
      expect(voltou.prefixo).toBe(antes.prefixo);
      expect(voltou.tarefas).toEqual(antes.tarefas);
      expect(voltou.colunas).toEqual(antes.colunas);
      expect(voltou.importacao).toMatchObject({ estado: "desfeita" });
      expect(await m.d.repos.quadroComentarios.daTarefa(t901.id)).toEqual([]);

      await m.pelaTela();
      await m.trazer();
      // Mexer fora de um lote (o fim do turno de quem pegou a tarefa, a passagem): o Desfazer da importação ainda é o
      // último, mas voltaria por cima do que mudou depois.
      const t = (await m.d.repos.quadros.tarefas((await m.quadro()).id)).find((x) => x.linearId === "NOD-901")!;
      await m.d.repos.quadros.salvarTarefa(t.id, { ...t, titulo: "Mexi" });
      const r = (await m.lote([{ tipo: "desfazer" }])).data;
      expect(r).toMatchObject({ ok: false, erro: "entrada_invalida" });
      if (r.ok) throw new Error("desfez");
      expect(r.detalhe).toContain("NOD-901");
      expect((await m.dto()).tarefas).toHaveLength(3);
    });
  });
});

describeIntegracao("revisão do PR #630: Desfazer e reimportar, códigos guardados", () => {
  it("importar, reimportar, desfazer a reimportação e reimportar de novo atualiza: o Desfazer não deixa a tarefa como mexida", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      await m.pelaTela();
      expect(await m.trazer()).toBe("aplicada");
      m.f.issues = [issue(901, "Revisando"), issue(902, "Backlog"), issue(903, "Revisando")];
      await m.pelaTela();
      expect(await m.trazer()).toBe("aplicada");
      const t901 = async () => (await m.dto()).tarefas.find((t) => t.linearId === "NOD-901")!;
      expect((await t901()).status).toBe("revisao");
      expect((await m.lote([{ tipo: "desfazer" }])).data).toMatchObject({ ok: true, desfeito: true });
      expect((await t901()).status).toBe("fazendo");
      await m.pelaTela();
      expect(await m.trazer()).toBe("aplicada");
      expect((await t901()).status).toBe("revisao");
      expect((await m.dto()).ultimoLote?.resumo).not.toContain("mexida");
    });
  });

  it("a 'fechada no Linear' (hora da importação) e a volta (data do Linear, mais antiga) não repetem a linha a cada reimportação", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      await m.pelaTela();
      expect(await m.trazer()).toBe("aplicada");
      const t901 = (await m.dto()).tarefas.find((t) => t.linearId === "NOD-901")!;
      // A pessoa mexe na 901: a reimportação só registra as linhas.
      expect((await m.lote([{ tipo: "mudar_tarefa", tarefa: t901.id, status: "backlog" }])).data).toMatchObject({ ok: true });
      m.f.issues = [issue(902, "Backlog"), issue(903, "Revisando")];
      await m.pelaTela();
      expect(await m.trazer()).toBe("aplicada");
      // Volta às abertas num estado de antes da "fechada" (a data do Linear é mais antiga que a hora da importação).
      m.f.issues = [issue(901, "Revisando", { noEstadoDesde: Date.UTC(2026, 9, 31) }), issue(902, "Backlog"), issue(903, "Revisando")];
      for (let i = 0; i < 2; i++) {
        await m.pelaTela();
        expect(await m.trazer()).toBe("aplicada");
      }
      expect((await linhasDoLinear(trx, t901.id)).sort()).toEqual(["Implementando", "Revisando", null].sort());
    });
  });

  it("o número de uma tarefa excluída não volta para a importada: o código novo é dela e o link abre a importada", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      expect((await m.lote([{ tipo: "criar_tarefa", titulo: "Fica", status: "backlog" }, { tipo: "criar_tarefa", titulo: "Sai", status: "backlog" }])).data).toMatchObject({ ok: true });
      const q0 = await m.dto();
      const sai = q0.tarefas.find((t) => t.titulo === "Sai")!;
      expect((await m.lote([{ tipo: "mudar_tarefa", tarefa: sai.codigo!, excluir: true }])).data).toMatchObject({ ok: true });
      m.f.issues = [issue(sai.numero!, "Backlog")];
      await m.pelaTela();
      expect(await m.trazer()).toBe("aplicada");
      const q = await m.dto();
      const importada = q.tarefas.find((t) => t.linearId === `NOD-${sai.numero}`)!;
      expect(q.prefixo).toBe(q0.prefixo);
      expect(importada.numero).not.toBe(sai.numero);
      expect(await m.d.repos.quadros.tarefaDoCodigo(q.prefixo!, importada.numero!)).toBe(importada.id);
      expect(await m.d.repos.quadros.tarefaDoCodigo(q.prefixo!, sai.numero!)).toBe(sai.id);
    });
  });
});

describeIntegracao("a prévia e o Trazer pela tela buscam no Linear fora da transação, com cache curto (revisão do PR #630)", () => {
  let servidor: ServidorDeTeste;
  let trxAtual: Tx | null = null;
  let txAbertas = 0;
  let agora = Date.now();
  const busca = { issues: TRES(), falhar: false, chamadas: [] as { completo: boolean; dentroDaTx: boolean }[] };
  const fonte: FonteLinear = {
    async listar(_cred, p) {
      busca.chamadas.push({ completo: p.completo, dentroDaTx: txAbertas > 0 });
      if (busca.falhar) throw new ErroDeDominio("conector_indisponivel");
      return busca.issues;
    },
  };

  beforeAll(async () => {
    const deps: DepsRotas = {
      abrirTx: (escopo: Escopo) => async <T,>(fn: (t: Tx) => Promise<T>): Promise<T> => {
        if (!trxAtual) throw new Error("teste sem transação aberta");
        const caixa: { valor?: T } = {};
        txAbertas++;
        try {
          await trxAtual.savepoint(async (sp) => {
            await vincularEscopo(sp, escopo);
            caixa.valor = await fn(sp);
          });
        } finally {
          txAbertas--;
        }
        return caixa.valor as T;
      },
      services: { ...servicosDeTeste((t) => criarRepos(t, MARLON), MARLON), linear: fonte },
      useCases: useCasesDeTeste(),
      executor: "catcher",
      agora: () => agora,
    };
    servidor = await servidorDeTeste(rotasQuadro(deps));
  });
  afterAll(() => servidor.close());

  it("GET da prévia: a busca roda sem transação aberta; repetir em 30 s não chama o Linear; o Trazer usa a mesma busca", async () => {
    await withRollback(MARLON, async (trx) => {
      trxAtual = trx;
      busca.chamadas = [];
      busca.falhar = false;
      const m = await montar(trx);
      const sessao = await servidor.entrar("marlon");
      const previa = `/agentes/${m.host.agenteId}/quadro/importacao/previa?time=nod`;
      // A falha não fica guardada: a próxima tentativa busca de novo.
      busca.falhar = true;
      // Revisão 6: o Linear fora do ar não é falta de conexão.
      expect(await (await servidor.chamar(sessao, "GET", previa)).json()).toMatchObject({ ok: false, erro: "linear_indisponivel", detalhe: "o Linear não respondeu, tente de novo em instantes" });
      const caiu = await servidor.chamar(sessao, "POST", `/agentes/${m.host.agenteId}/quadro/importacao`, { time: "nod" });
      expect(caiu.status).toBe(502);
      expect(await caiu.json()).toMatchObject({ codigo: "conector_indisponivel" });
      busca.chamadas.pop();
      busca.falhar = false;
      const r = await servidor.chamar(sessao, "GET", previa);
      expect(r.status).toBe(200);
      expect(await r.json()).toMatchObject({ ok: true, time: "NOD", previa: { total: 3 } });
      expect(busca.chamadas).toEqual([{ completo: false, dentroDaTx: false }, { completo: false, dentroDaTx: false }]);
      // Reabrir a prévia e clicar em Trazer logo depois não refazem a busca.
      expect(await (await servidor.chamar(sessao, "GET", previa)).json()).toMatchObject({ ok: true });
      const t = await servidor.chamar(sessao, "POST", `/agentes/${m.host.agenteId}/quadro/importacao`, { time: "nod" });
      expect(t.status).toBe(202);
      expect(await t.json()).toMatchObject({ ok: true, importacao: { estado: "trazendo", total: 3 } });
      expect(busca.chamadas).toHaveLength(2);
      // Passado o prazo, busca de novo.
      agora += 31_000;
      await trx`update quadro_importacoes set estado = 'falhou' where quadro_id = ${(await m.quadro()).id} and estado = 'trazendo'`;
      expect(await (await servidor.chamar(sessao, "GET", previa)).json()).toMatchObject({ ok: true });
      expect(busca.chamadas).toHaveLength(3);
      expect(busca.chamadas.every((c) => !c.dentroDaTx)).toBe(true);
      trxAtual = null;
    });
  });

  it("QA do PR #630: sem a chave do Composio, a prévia e o Trazer dizem a mesma causa (o Linear não está conectado)", async () => {
    await withRollback(MARLON, async (trx) => {
      trxAtual = trx;
      busca.chamadas = [];
      busca.falhar = false;
      const m = await montar(trx, { conectado: false });
      expect(await m.d.repos.composio.chave()).toBeNull();
      const sessao = await servidor.entrar("marlon");
      const g = await servidor.chamar(sessao, "GET", `/agentes/${m.host.agenteId}/quadro/importacao/previa?time=nod`);
      expect(await g.json()).toMatchObject({ ok: false, erro: "sem_conector" });
      const t = await servidor.chamar(sessao, "POST", `/agentes/${m.host.agenteId}/quadro/importacao`, { time: "nod" });
      expect(t.status).toBe(409);
      const corpo = await t.json() as { codigo: string; mensagem: string; motivo: string };
      expect(corpo).toEqual({ codigo: "integracao_nao_configurada", mensagem: FRASE_SEM_CONECTOR, motivo: "sem_conector" });
      expect(corpo.mensagem).not.toMatch(/Composio/);
      expect(busca.chamadas).toEqual([]);
      trxAtual = null;
    });
  });
});

/**
 * Revisão do PR #630 (item 6): o card pela conversa também busca a prévia FORA da transação. A rota interna roda a fase 1
 * (as recusas, numa tx curta), o efeito (a busca, sem banco) e a fase 2 (a proposta e a decisão, numa tx nova).
 */
describeIntegracao("o gerir_quadro com importar_time_linear busca a prévia fora da transação (revisão do PR #630)", () => {
  const planoDe = (t: { turnoId: string; agenteId: string; conversaId: string }): PlanoTurno => ({
    tenantId: MARLON.tenantId, turnoId: t.turnoId, agenteId: t.agenteId, conversaId: t.conversaId, localidade: "local", machineId: "m1", executor: "catcher", superficie: "maquina_da_pessoa",
    decididoPor: "regra:montagem-ferramentas", autoria: autoriaPessoa(MARLON.pessoaId), confiancaEntrada: "confiavel", profundidade: 0,
    catalogo: { ferramentas: [{ nome: "gerir_quadro", nomeMcp: "mcp__nod__gerir_quadro", origem: "nod", conectorId: null, readOnlyHint: false, tocaDadoPessoal: false, schema: FERRAMENTAS_NOD.gerir_quadro }], servidores: [] },
    promptSistema: "", entrada: { texto: "traz o NOD", sessaoCli: null, modelo: "m" }, politicaExecucao: { prazoMs: 60_000, orcamentoResultadoChars: 8000 },
    semprePermitir: [], tokenDeTurno: "tok", expiraEm: Date.now() + 60_000, nativas: [], modoTurno: "conversa",
  });

  it("a fase 1 não chama o Linear e devolve o efeito; o efeito busca; a fase 2 abre o card com a prévia", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const t = await m.turno();
      const f1 = (await executar(m.d, chamarFerramentaFase1, { turnoId: t.turnoId, agenteId: t.agenteId, nome: "gerir_quadro", argumentos: { acoes: [{ tipo: "importar_time_linear", time: "nod" }] }, plano: planoDe(t) })).data;
      expect(m.f.chamadas).toEqual([]);
      if (!("efeito" in f1)) throw new Error(`sem efeito: ${JSON.stringify(f1)}`);
      expect(f1.efeito.tipo).toBe("previa_linear");
      const desfecho = await executarEfeito(m.d.services, f1.efeito);
      expect(m.f.chamadas).toEqual([{ completo: false }]);
      const f2 = (await executar(m.d, concluirChamada, { efeito: f1.efeito, desfecho })).data;
      expect(f2).toMatchObject({ ok: true });
      expect(JSON.parse((f2 as { conteudo: string }).conteudo)).toMatchObject({ ok: true, proposta_id: expect.any(String) });
      const [p] = await trx<{ payload: { previa: { total: number } } }[]>`select payload from propostas where conversa_id = ${t.conversaId} and kind = 'importacao_linear'`;
      expect(p?.payload.previa.total).toBe(3);
    });
  });

  it("sem o Linear conectado, a fase 1 já recusa (sem efeito); o Linear fora do ar na busca vira a recusa na fase 2, sem card", async () => {
    await withRollback(MARLON, async (trx) => {
      const sem = await montar(trx, { conectado: false });
      const t0 = await sem.turno();
      const r0 = (await executar(sem.d, chamarFerramentaFase1, { turnoId: t0.turnoId, agenteId: t0.agenteId, nome: "gerir_quadro", argumentos: { acoes: [{ tipo: "importar_time_linear", time: "nod" }] }, plano: planoDe(t0) })).data;
      expect("efeito" in r0).toBe(false);
      expect(JSON.parse((r0 as { conteudo: string }).conteudo)).toMatchObject({ ok: false, erro: "sem_conector" });
      expect(sem.f.chamadas).toEqual([]);
    });
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const t = await m.turno();
      const f1 = (await executar(m.d, chamarFerramentaFase1, { turnoId: t.turnoId, agenteId: t.agenteId, nome: "gerir_quadro", argumentos: { acoes: [{ tipo: "importar_time_linear", time: "nod" }] }, plano: planoDe(t) })).data;
      if (!("efeito" in f1)) throw new Error("sem efeito");
      const f2 = (await executar(m.d, concluirChamada, { efeito: f1.efeito, desfecho: { tipo: "previa_linear", busca: { ok: false, erro: "sem_conector", detalhe: "o Linear não respondeu" } } })).data;
      expect(JSON.parse((f2 as { conteudo: string }).conteudo)).toMatchObject({ ok: false, erro: "sem_conector" });
      expect((await trx<{ n: number }[]>`select count(*)::int as n from propostas where conversa_id = ${t.conversaId} and kind = 'importacao_linear'`)[0]!.n).toBe(0);
    });
  });
  it("revisão 3: a fase 1 e a fase 2 passam pelo gerirQuadroEmFases injetado (deps.useCases), não pelo import direto", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const fases: string[] = [];
      m.d.useCases = { ...m.d.useCases, gerirQuadroEmFases: async (d, entrada, modo) => { fases.push(modo.fase); return gerirQuadroEmFases(d, entrada, modo); } };
      const t = await m.turno();
      const f1 = (await executar(m.d, chamarFerramentaFase1, { turnoId: t.turnoId, agenteId: t.agenteId, nome: "gerir_quadro", argumentos: { acoes: [{ tipo: "importar_time_linear", time: "nod" }] }, plano: planoDe(t) })).data;
      if (!("efeito" in f1)) throw new Error("sem efeito");
      const desfecho = await executarEfeito(m.d.services, f1.efeito);
      expect((await executar(m.d, concluirChamada, { efeito: f1.efeito, desfecho })).data).toMatchObject({ ok: true });
      expect(fases).toEqual(["conferir", "aplicar"]);
    });
  });
});

describeIntegracao("revisão 3 do PR #630: Desfazer, fechadas e experimento", () => {
  it("pedir o Desfazer da importação depois de um lote que mexeu numa tarefa dela recusa dizendo qual (não só 'o último lote')", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      await m.pelaTela();
      expect(await m.trazer()).toBe("aplicada");
      const q = await m.dto();
      const loteId = q.importacao!.loteId!;
      const t902 = q.tarefas.find((t) => t.linearId === "NOD-902")!;
      // A pessoa move a 902 pela tela: um lote novo, que passa a ser o último.
      expect((await m.lote([{ tipo: "mudar_tarefa", tarefa: t902.id, status: "fazendo", sem_iniciar: true }])).data).toMatchObject({ ok: true });
      const r = (await m.lote([{ tipo: "desfazer", lote: loteId }])).data;
      if (r.ok) throw new Error("desfez");
      expect(r.erro).toBe("entrada_invalida");
      expect(r.detalhe).toBe(`a importação do Linear não se desfaz: ${t902.codigo} mudou depois dela`);
      expect((await m.dto()).tarefas).toHaveLength(3);
    });
  });

  it("um comentário da pessoa numa tarefa importada conta como mexida: o Desfazer recusa citando a tarefa e o comentário fica", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      await m.pelaTela();
      expect(await m.trazer()).toBe("aplicada");
      const t903 = (await m.dto()).tarefas.find((t) => t.linearId === "NOD-903")!;
      const c = await comentarTarefa(m.d, { autor: { tipo: "pessoa" }, anfitriaoId: m.host.agenteId, executor: "catcher", ops: [] }, { tipo: "comentar", tarefa: t903.id, texto: "olhei esta" });
      expect(c.data).toMatchObject({ ok: true });
      const r = (await m.lote([{ tipo: "desfazer" }])).data;
      if (r.ok) throw new Error("desfez");
      expect(r.detalhe).toBe(`a importação do Linear não se desfaz: ${t903.codigo} mudou depois dela`);
      expect((await m.d.repos.quadroComentarios.daTarefa(t903.id)).map((x) => x.texto)).toContain("olhei esta");
    });
  });

  it("revisão 6: um comentário de quem participa (quadro_tarefa_comentarios) numa tarefa importada também recusa o Desfazer, e o comentário fica", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      await m.pelaTela();
      expect(await m.trazer()).toBe("aplicada");
      const q = await m.dto();
      const t901 = q.tarefas.find((t) => t.linearId === "NOD-901")!;
      await m.d.repos.quadros.comentar({ quadroId: q.id, tarefaId: t901.id, texto: "vi isso aqui", pedidoPor: MARLON.pessoaId, viaAgenteId: null, viaNome: null, deFora: true });
      const r = (await m.lote([{ tipo: "desfazer" }])).data;
      if (r.ok) throw new Error("desfez");
      expect(r.detalhe).toBe(`a importação do Linear não se desfaz: ${t901.codigo} mudou depois dela`);
      expect((await m.d.repos.quadros.comentarios(q.id)).map((x) => x.texto)).toContain("vi isso aqui");
    });
  });

  it("issue descartada pela leitura (malformada) não vira 'fechada no Linear'; sem o identificador, nenhuma é marcada", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      await m.pelaTela();
      expect(await m.trazer()).toBe("aplicada");
      const por = new Map((await m.dto()).tarefas.map((t) => [t.linearId, t]));
      // A 903 continua aberta no Linear, mas veio malformada: a busca a descarta com o identificador.
      m.f.issues = [issue(901, "Implementando"), issue(902, "Backlog")];
      m.f.descartadas = ["NOD-903"];
      await m.pelaTela();
      expect(await m.trazer()).toBe("aplicada");
      expect(await linhasDoLinear(trx, por.get("NOD-903")!.id)).toEqual(["Revisando"]);
      // Descartada sem identificador legível: não dá para saber qual era, então nenhuma é dada como fechada.
      m.f.issues = [issue(901, "Implementando")];
      m.f.descartadas = [null];
      await m.pelaTela();
      expect(await m.trazer()).toBe("aplicada");
      expect(await linhasDoLinear(trx, por.get("NOD-902")!.id)).toEqual(["Backlog"]);
      expect(await linhasDoLinear(trx, por.get("NOD-903")!.id)).toEqual(["Revisando"]);
    });
  });

  it("o quadro desligado nos experimentos durante a busca: o aplicar não traz nada e a importação fica 'falhou'", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      await m.pelaTela();
      await m.d.repos.preferencias.gravar({ experimentos: { quadro: false } });
      expect(await m.trazer()).toBe("falhou");
      const q = await m.quadro();
      expect(await m.d.repos.quadros.tarefas(q.id)).toEqual([]);
      expect(await m.d.repos.quadroImportacoes.ultima(q.id)).toMatchObject({ estado: "falhou", erro: expect.stringContaining("desligado nos experimentos") });
    });
  });

  it("o Desfazer apaga o código do time que a importação guardou numa tarefa que já existia", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      // Uma nativa (o prefixo do quadro fica) e uma ligada ao Linear pelo importar_linear antigo, sem o código do time.
      expect((await m.lote([{ tipo: "criar_tarefa", titulo: "Nativa", status: "backlog" }, { tipo: "importar_linear", itens: [{ identificador: "NOD-960", titulo: "Antiga", url: "https://linear.app/gamefik/issue/NOD-960" }] }])).data).toMatchObject({ ok: true });
      const antiga = (await m.dto()).tarefas.find((t) => t.linearId === "NOD-960")!;
      expect(await m.d.repos.quadros.tarefaDoCodigo("NOD", 960)).toBeNull();
      m.f.issues = [issue(960, "Implementando")];
      await m.pelaTela();
      expect(await m.trazer()).toBe("aplicada");
      expect(await m.d.repos.quadros.tarefaDoCodigo("NOD", 960)).toBe(antiga.id);
      expect((await m.lote([{ tipo: "desfazer" }])).data).toMatchObject({ ok: true, desfeito: true });
      expect(await m.d.repos.quadros.tarefaDoCodigo("NOD", 960)).toBeNull();
      expect((await m.dto()).tarefas.find((t) => t.id === antiga.id)?.codigo).toBe(antiga.codigo);
    });
  });
});

describeIntegracao("revisão 4 do PR #630: meta, PR ligado depois e a importação mais nova", () => {
  it("as tarefas importadas ficam fora da meta (decisão 3 da Ada): o progresso não muda e a meta cumprida não reabre", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      expect((await m.lote([{ tipo: "editar_quadro", meta: "Lançar o login" }, { tipo: "criar_tarefa", titulo: "Nativa", status: "backlog" }])).data).toMatchObject({ ok: true });
      const nativa = (await m.dto()).tarefas.find((t) => t.titulo === "Nativa")!;
      expect((await m.lote([{ tipo: "mudar_tarefa", tarefa: nativa.id, status: "feito" }])).data).toMatchObject({ ok: true });
      const antes = await m.dto();
      expect([antes.feitas, antes.total]).toEqual([1, 1]);
      expect(antes.cumpridoEm).not.toBeNull();

      await m.pelaTela();
      expect(await m.trazer()).toBe("aplicada");
      const depois = await m.dto();
      expect(depois.tarefas).toHaveLength(4);
      expect([depois.feitas, depois.total]).toEqual([antes.feitas, antes.total]);
      // Um lote depois da importação recalcula o fecho: as importadas abertas não reabrem a meta.
      expect((await m.lote([{ tipo: "editar_quadro", prazo: "2026-12-30" }])).data).toMatchObject({ ok: true });
      const fim = await m.dto();
      expect(fim.cumpridoEm).toBe(antes.cumpridoEm);
      expect([fim.feitas, fim.total]).toEqual([1, 1]);
      // O Desfazer de uma importação tira as tarefas: nada mais a excluir.
      expect(await m.d.repos.quadroImportacoes.importadas(fim.id)).toEqual(new Set(depois.tarefas.filter((t) => t.linearId).map((t) => t.id)));
    });
  });

  it("um PR ligado depois da importação (o laço do NOD-421, sem mexer no mudado_em) conta como mexida no Desfazer", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      await m.pelaTela();
      expect(await m.trazer()).toBe("aplicada");
      const q = await m.dto();
      const t902 = q.tarefas.find((t) => t.linearId === "NOD-902")!;
      const url = "https://github.com/gamefik/nod/pull/77";
      expect(await m.d.repos.quadros.salvarPr(q.id, t902.id, { repo: "gamefik/nod", numero: 77, url, branch: "", estado: "aberto", ci: null, conflito: false })).toBe(true);
      expect(await m.d.repos.quadros.definirPrUrlSeVazio(t902.id, url)).toBe(true);
      const r = (await m.lote([{ tipo: "desfazer" }])).data;
      if (r.ok) throw new Error("desfez");
      expect(r.detalhe).toBe(`a importação do Linear não se desfaz: ${t902.codigo} mudou depois dela`);
      expect((await m.dto()).tarefas.find((t) => t.id === t902.id)?.prUrl).toBe(url);
    });
  });

  it("revisão 5: reimportar sem PR no Linear não apaga o pr_url que o laço do NOD-421 ligou; o estado novo do Linear ainda entra", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      await m.pelaTela();
      expect(await m.trazer()).toBe("aplicada");
      const q = await m.dto();
      const t902 = q.tarefas.find((t) => t.linearId === "NOD-902")!;
      const url = "https://github.com/gamefik/nod/pull/78";
      expect(await m.d.repos.quadros.salvarPr(q.id, t902.id, { repo: "gamefik/nod", numero: 78, url, branch: "", estado: "aberto", ci: null, conflito: false })).toBe(true);
      expect(await m.d.repos.quadros.definirPrUrlSeVazio(t902.id, url)).toBe(true);
      // Nada mudou no Linear (e a issue não tem PR lá): o pr_url fica e a reimportação não reescreve a tarefa.
      await m.pelaTela();
      expect(await m.trazer()).toBe("aplicada");
      expect((await m.dto()).tarefas.find((t) => t.id === t902.id)?.prUrl).toBe(url);
      // A 902 andou no Linear (ainda sem PR lá): a coluna muda e o pr_url continua.
      m.f.issues = [issue(901, "Implementando"), issue(902, "Implementando"), issue(903, "Revisando", { anexos: [{ url: "https://github.com/gamefik/nod/pull/9", criadoEm: Date.UTC(2026, 9, 31) }] })];
      await m.pelaTela();
      expect(await m.trazer()).toBe("aplicada");
      const depois = (await m.dto()).tarefas.find((t) => t.id === t902.id)!;
      expect([depois.status, depois.prUrl]).toEqual(["fazendo", url]);
    });
  });

  it("desfazer a primeira importação depois de reimportar aponta a mais nova, a única que se desfaz", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      await m.pelaTela();
      expect(await m.trazer()).toBe("aplicada");
      const primeira = (await m.dto()).importacao!.loteId!;
      m.f.issues = [issue(901, "Revisando"), issue(902, "Backlog"), issue(903, "Revisando")];
      await m.pelaTela();
      expect(await m.trazer()).toBe("aplicada");
      const r = (await m.lote([{ tipo: "desfazer", lote: primeira }])).data;
      if (r.ok) throw new Error("desfez");
      expect(r.erro).toBe("entrada_invalida");
      expect(r.detalhe).toBe("há uma importação do Linear mais nova neste quadro: só a mais nova se desfaz (o Desfazer volta um lote só)");
      // A mais nova se desfaz; o Desfazer volta um lote só, então a primeira não se desfaz depois.
      expect((await m.lote([{ tipo: "desfazer" }])).data).toMatchObject({ ok: true, desfeito: true });
      expect((await m.lote([{ tipo: "desfazer", lote: primeira }])).data).toMatchObject({ ok: false, erro: "nao_encontrado" });
    });
  });
});

describeIntegracao("revisão 6 do PR #630: o card importacao_linear pela rota de decidir", () => {
  let servidor: ServidorDeTeste;
  let trxAtual: Tx | null = null;
  beforeAll(async () => {
    const dentro = <T,>(escopo: Escopo, fn: (d: Deps) => Promise<T>): Promise<T> => {
      const trx = trxAtual;
      if (!trx) throw new Error("teste sem transação aberta");
      const caixa: { valor?: T } = {};
      return trx.savepoint(async (sp) => { await vincularEscopo(sp, escopo); caixa.valor = await fn(depsSobreTrx(sp, escopo)); }).then(() => caixa.valor as T);
    };
    const abrirTx = (escopo: Escopo) => async <T,>(fn: (t: Tx) => Promise<T>): Promise<T> => {
      const trx = trxAtual;
      if (!trx) throw new Error("teste sem transação aberta");
      const caixa: { valor?: T } = {};
      await trx.savepoint(async (sp) => { await vincularEscopo(sp, escopo); caixa.valor = await fn(sp); });
      return caixa.valor as T;
    };
    const services = servicosDeTeste((t) => criarRepos(t, MARLON), MARLON);
    servidor = await servidorDeTeste([
      ...criarRotasDecisoes({ dentro, services, prazoDecisaoMs: 60_000, executor: "catcher" }),
      ...criarRotasPropostas({ abrirTx, services, useCases: useCasesDeTeste(), prazoDecisaoMs: 60_000, executor: "catcher" }),
    ]);
  });
  afterAll(() => servidor.close());

  it("só a dona confirma: a decisora designada recebe 404, nada é importado e o card segue pendente", async () => {
    await withRollback(MARLON, async (trx) => {
      trxAtual = trx;
      const m = await montar(trx);
      const r = await m.pedir();
      if (!r.ok || !r.proposta_id) throw new Error(JSON.stringify(r));
      // Um card igual com uma decisora designada (decisor_id é imutável, então nasce com ela): ela o vê pela perna dela,
      // mas não importa para o quadro da dona com a conta do Linear da dona.
      const lida = (await m.d.repos.propostas.buscar(r.proposta_id))!;
      const proposta = (await m.d.repos.propostas.criar({ conversaId: m.host.conversaId, agenteId: m.host.agenteId, payload: lida.payload }))!;
      await m.d.repos.decisoes.criar({ id: proposta.id, tipo: "importacao_linear", decisorId: ANA.pessoaId, agenteId: m.host.agenteId, conversaId: m.host.conversaId, prazoDecisaoEm: Date.now() + 600_000, frase: "Trazer o time do Linear" });
      const ana = await servidor.entrar("ana");
      const d = await servidor.chamar(ana, "POST", `decisoes/${proposta.id}/decidir`, {});
      expect(d.status, await d.clone().text()).toBe(404);
      await vincularEscopo(trx, MARLON);
      expect(await m.d.repos.quadroImportacoes.ultima((await m.quadro()).id)).toBeNull();
      expect((await m.d.repos.propostas.buscar(proposta.id))?.estado).toBe("pendente");
      trxAtual = null;
    });
  });
  it("revisão 7: recusar pela conversa (POST propostas/:id/recusar) fecha a decisão de mesmo id em Sua vez e não importa nada", async () => {
    await withRollback(MARLON, async (trx) => {
      trxAtual = trx;
      const m = await montar(trx);
      const r = await m.pedir();
      if (!r.ok || !r.proposta_id) throw new Error(JSON.stringify(r));
      const sessao = await servidor.entrar("marlon");
      const res = await servidor.chamar(sessao, "POST", `propostas/${r.proposta_id}/recusar`);
      expect(res.status, await res.clone().text()).toBe(200);
      await vincularEscopo(trx, MARLON);
      expect((await m.d.repos.propostas.buscar(r.proposta_id))?.estado).toBe("recusada");
      expect((await m.d.repos.decisoes.buscar(r.proposta_id))?.estado).toBe("decidida");
      expect(await m.d.repos.quadroImportacoes.ultima((await m.quadro()).id)).toBeNull();
      expect((await servidor.chamar(sessao, "POST", `propostas/${r.proposta_id}/recusar`)).status).toBe(409);
      trxAtual = null;
    });
  });

  it("revisão 7: recusarPropostaPelaConversa no card importacao_linear fecha a decisão (não fica aberta em Sua vez)", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const r = await m.pedir();
      if (!r.ok || !r.proposta_id) throw new Error(JSON.stringify(r));
      const out = await executar(m.d, recusarPropostaPelaConversa, { propostaId: r.proposta_id, executor: "catcher" });
      expect(out.data.proposta.estado).toBe("recusada");
      expect(out.data.decisao?.estado).toBe("decidida");
      expect((await m.d.repos.decisoes.buscar(r.proposta_id))?.estado).toBe("decidida");
      expect(await m.d.repos.quadroImportacoes.ultima((await m.quadro()).id)).toBeNull();
    });
  });
});

describeIntegracao("revisão 8 do PR #630: o código do time depois da troca de prefixo e a importada em outro quadro", () => {
  it("a nativa criada no quadro de prefixo NOD pega o número da issue que chega depois: a URL do Linear abre a importada; o código puro pergunta qual", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      await m.pelaTela();
      expect(await m.trazer()).toBe("aplicada");
      expect((await m.dto()).prefixo).toBe("NOD");
      expect((await m.lote([{ tipo: "criar_tarefa", titulo: "Nativa", status: "backlog" }])).data).toMatchObject({ ok: true });
      const nativa = (await m.dto()).tarefas.find((t) => t.titulo === "Nativa")!;
      expect(nativa.codigo).toBe("NOD-904");
      // A issue NOD-904 nasce no Linear: a reimportação lhe dá número novo (o 904 é da nativa).
      m.f.issues = [...TRES(), issue(904, "Backlog")];
      await m.pelaTela();
      expect(await m.trazer()).toBe("aplicada");
      const importada = (await m.dto()).tarefas.find((t) => t.linearId === "NOD-904")!;
      expect(importada.codigo).not.toBe("NOD-904");
      // O código guardado continua da nativa (o link que a tela mostra não muda de dona).
      expect(await m.d.repos.quadros.tarefaDoCodigo("NOD", 904)).toBe(nativa.id);
      expect(await m.d.repos.quadros.tarefaDoCodigo("NOD", importada.numero!)).toBe(importada.id);
      // A URL da issue só pode ser do Linear: abre a importada (antes: ambígua).
      const url = "https://linear.app/gamefik/issue/NOD-904/issue-904";
      expect((await executar(m.d, verTarefaPorCodigo, { codigo: url })).data).toMatchObject({ tarefaId: importada.id });
      // O código puro é das duas: pergunta, com a importada marcada do Linear.
      const puro = (await executar(m.d, verTarefaPorCodigo, { codigo: "NOD-904" })).data as { ambigua?: { tarefaId: string }[] };
      expect(puro.ambigua?.map((o) => o.tarefaId).sort()).toEqual([importada.id, nativa.id].sort());
      // E o novo código da importada a abre direto.
      expect((await executar(m.d, verTarefaPorCodigo, { codigo: importada.codigo! })).data).toMatchObject({ tarefaId: importada.id });
    });
  });

  it("a importada movida para outro quadro não é recriada na reimportação: fica lá e o recibo conta", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const outro = await agenteComConversa(trx, MARLON, { nome: `Outro ${Math.random().toString(36).slice(2, 7)}` });
      expect((await executar(m.d, aplicarLoteQuadro, { autor: { tipo: "pessoa" }, anfitriaoId: outro.agenteId, executor: "catcher", ops: [{ tipo: "criar_quadro" }] })).data).toMatchObject({ ok: true });
      await m.pelaTela();
      expect(await m.trazer()).toBe("aplicada");
      const t902 = (await m.dto()).tarefas.find((t) => t.linearId === "NOD-902")!;
      expect((await m.lote([{ tipo: "mover_quadro", tarefa: t902.id, quadro: outro.agenteId }])).data).toMatchObject({ ok: true });
      m.f.issues = [issue(901, "Revisando"), issue(902, "Implementando"), issue(903, "Revisando")];
      await m.pelaTela();
      expect(await m.trazer()).toBe("aplicada");
      const todas = await trx<{ id: string; quadro_id: string; status: string }[]>`select id, quadro_id, status from quadro_tarefas where owner_id = ${MARLON.pessoaId} and lower(linear_id) = 'nod-902'`;
      expect(todas).toHaveLength(1);
      expect(todas[0]!.id).toBe(t902.id);
      expect(todas[0]!.quadro_id).not.toBe((await m.quadro()).id);
      expect((await m.dto()).tarefas.map((t) => t.linearId).sort()).toEqual(["NOD-901", "NOD-903"]);
      expect((await m.dto()).ultimoLote?.resumo).toContain("1 em outro quadro");
      // O link do Linear segue achando a que está no outro quadro.
      expect((await executar(m.d, verTarefaPorCodigo, { codigo: "https://linear.app/gamefik/issue/NOD-902/issue-902" })).data).toMatchObject({ tarefaId: t902.id });
    });
  });
});

describeIntegracao("revisão 10 do PR #630: a URL sem importada, o prefixo do importar_linear antigo e o mesmo time em dois quadros", () => {
  it("a URL de uma issue não importada não abre a nativa de mesmo código: o link é nao_encontrado e o mover_quadro recusa", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const outro = await m.outroQuadro();
      await m.pelaTela();
      expect(await m.trazer()).toBe("aplicada");
      expect((await m.dto()).prefixo).toBe("NOD");
      expect((await m.lote([{ tipo: "criar_tarefa", titulo: "Nativa", status: "backlog" }])).data).toMatchObject({ ok: true });
      const nativa = (await m.dto()).tarefas.find((t) => t.titulo === "Nativa")!;
      expect(nativa.codigo).toBe("NOD-904");
      // A issue NOD-904 do Linear nunca foi importada: a URL dela não é a nativa NOD-904.
      const url = "https://linear.app/gamefik/issue/NOD-904/outra-coisa";
      await expect(executar(m.d, verTarefaPorCodigo, { codigo: url })).rejects.toMatchObject({ codigo: "nao_encontrado" });
      const r = (await m.lote([{ tipo: "mover_quadro", tarefa: url, quadro: outro.agenteId }])).data;
      expect(r).toMatchObject({ ok: false, erro: "nao_encontrado" });
      expect((await m.dto()).tarefas.some((t) => t.id === nativa.id)).toBe(true);
      expect((await outro.dto()).tarefas).toHaveLength(0);
      // O código puro segue sendo da nativa.
      expect((await executar(m.d, verTarefaPorCodigo, { codigo: "NOD-904" })).data).toMatchObject({ tarefaId: nativa.id });
    });
  });

  it("quadro só com tarefas do importar_linear antigo (numeração do quadro): importar o time não troca o prefixo e todo código mostrado abre a própria tarefa", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      expect((await m.lote([{ tipo: "importar_linear", itens: [
        { identificador: "NOD-960", titulo: "Antiga 960", url: "https://linear.app/gamefik/issue/NOD-960" },
        { identificador: "NOD-961", titulo: "Antiga 961", url: "https://linear.app/gamefik/issue/NOD-961" },
      ] }])).data).toMatchObject({ ok: true });
      const antes = await m.dto();
      expect(antes.tarefas.map((t) => t.numero).sort()).not.toEqual([960, 961]);
      m.f.issues = [issue(960, "Implementando"), issue(961, "Backlog"), issue(962, "Backlog")];
      await m.pelaTela();
      expect(await m.trazer()).toBe("aplicada");
      const q = await m.dto();
      expect(q.prefixo).toBe(antes.prefixo);
      expect(q.tarefas).toHaveLength(3);
      for (const t of q.tarefas) expect((await executar(m.d, verTarefaPorCodigo, { codigo: t.codigo! })).data, t.codigo!).toMatchObject({ tarefaId: t.id });
      // E o código do time (guardado) abre a de cada issue.
      for (const t of q.tarefas) expect((await executar(m.d, verTarefaPorCodigo, { codigo: t.linearId! })).data, t.linearId!).toMatchObject({ tarefaId: t.id });
    });
  });

  it("o mesmo time importado em dois quadros: nenhum pula tarefa; pela URL, o mover_quadro pergunta qual dizendo o identificador", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const outro = await m.outroQuadro();
      await m.pelaTela();
      expect(await m.trazer()).toBe("aplicada");
      expect(await outro.importar()).toBe("aplicada");
      expect((await outro.dto()).tarefas.map((t) => t.linearId).sort()).toEqual(["NOD-901", "NOD-902", "NOD-903"]);
      // Reimportar nos dois: nada pula nem duplica, e o estado novo entra nos dois.
      m.f.issues = [issue(901, "Revisando"), issue(902, "Implementando"), issue(903, "Revisando")];
      await m.pelaTela();
      expect(await m.trazer()).toBe("aplicada");
      expect(await outro.importar()).toBe("aplicada");
      for (const q of [await m.dto(), await outro.dto()]) {
        expect(q.tarefas.map((t) => [t.linearId, t.status]).sort()).toEqual([["NOD-901", "revisao"], ["NOD-902", "fazendo"], ["NOD-903", "revisao"]]);
        expect(q.ultimoLote?.resumo ?? "").not.toContain("em outro quadro");
      }
      // Baixo 1: a ambiguidade pela URL diz o identificador (não a URL crua) e marca as duas como do Linear.
      const url = "https://linear.app/gamefik/issue/NOD-901/issue-901";
      const r = (await m.lote([{ tipo: "mover_quadro", tarefa: url, quadro: outro.agenteId }])).data;
      if (r.ok) throw new Error("devia perguntar qual");
      expect(r.erro).toBe("entrada_invalida");
      expect(r.detalhe).toMatch(/^"NOD-901" acha 2 tarefas: /);
      expect(r.detalhe.match(/do Linear NOD-901/g)).toHaveLength(2);
      expect(r.detalhe).not.toContain("HTTPS://");
    });
  });

  it("a tarefa que volta ao quadro (A→B→A) é a mesma: a reimportação em A a encontra, sem recriar nem marcar como fechada", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const outro = await m.outroQuadro();
      await m.pelaTela();
      expect(await m.trazer()).toBe("aplicada");
      const t902 = (await m.dto()).tarefas.find((t) => t.linearId === "NOD-902")!;
      expect((await m.lote([{ tipo: "mover_quadro", tarefa: t902.id, quadro: outro.agenteId }])).data).toMatchObject({ ok: true });
      expect((await executar(m.d, aplicarLoteQuadro, { autor: { tipo: "pessoa" }, anfitriaoId: outro.agenteId, executor: "catcher", ops: [{ tipo: "mover_quadro", tarefa: t902.id, quadro: m.host.agenteId }] })).data).toMatchObject({ ok: true });
      m.f.issues = [issue(901, "Implementando"), issue(902, "Implementando", { noEstadoDesde: Date.UTC(2026, 10, 2) }), issue(903, "Revisando")];
      await m.pelaTela();
      expect(await m.trazer()).toBe("aplicada");
      const todas = await trx<{ id: string; quadro_id: string }[]>`select id, quadro_id from quadro_tarefas where owner_id = ${MARLON.pessoaId} and lower(linear_id) = 'nod-902'`;
      expect(todas).toEqual([{ id: t902.id, quadro_id: (await m.quadro()).id }]);
      expect((await m.dto()).ultimoLote?.resumo ?? "").not.toContain("em outro quadro");
      // A reimportação a tratou como dela (o estado novo do Linear chegou), não como fechada.
      const linhas = await linhasDoLinear(trx, t902.id);
      expect(linhas.at(-1)).toBe("Implementando");
      expect(linhas).not.toContain(null);
    });
  });

  it("mover a importada para um quadro que já tem a mesma issue recusa com a frase (não estoura o índice único)", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const outro = await m.outroQuadro();
      await m.pelaTela();
      expect(await m.trazer()).toBe("aplicada");
      expect(await outro.importar()).toBe("aplicada");
      const t902 = (await m.dto()).tarefas.find((t) => t.linearId === "NOD-902")!;
      const r = (await m.lote([{ tipo: "mover_quadro", tarefa: t902.id, quadro: outro.agenteId }])).data;
      expect(r).toMatchObject({ ok: false, erro: "conflito", motivo: "linear_no_destino" });
      if (r.ok) throw new Error("devia recusar");
      expect(r.detalhe).toContain(`o quadro ${outro.nome} já tem`);
      expect(r.detalhe).toContain("já tem a tarefa do Linear NOD-902");
      expect((await m.dto()).tarefas.some((t) => t.id === t902.id)).toBe(true);
      // Pela tela, a recusa sai com o motivo que a faixa conhece.
      await expect(executar(m.d, EXECUTORES_QUADRO["quadro.mover_tarefa"], { anfitriaoId: m.host.agenteId, executor: "catcher", tarefa: t902.id, quadro: outro.agenteId })).rejects.toMatchObject({ motivo: "linear_no_destino" });
    });
  });
});

describeIntegracao("revisão 11 do PR #630: os avisos da importação e do assumir vão também a quem participa (ADR-143)", () => {
  /** O RodarNaTx que guarda os eventos de cada transação (o despacho lê `membros` deles). */
  const rodarGuardando = (d: Deps, guardados: RuntimeEvent[]): RodarNaTx => async (fn) => {
    const x = await fn(d);
    guardados.push(...(x.events ?? []));
    return x.data;
  };
  const membrosDe = (es: readonly RuntimeEvent[]) => es.filter((e) => e.kind === "quadro_mudou").map((e) => e.dados.membros);

  // A participante é uma pessoa de verdade (o banco limpo da CI não tem a ANA do seed: FK de quadro_membros).
  const PARTICIPANTE = pessoaDeTeste("Participante 630");
  beforeAll(() => PARTICIPANTE.criar());

  it("iniciar, progresso, fim do aplicar, falha, assumir e desfazer o assumir: todo quadro_mudou leva o participante", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const qid = (await m.quadro()).id;
      expect(await m.d.repos.quadros.adicionarMembro(qid, PARTICIPANTE.id)).toBe(true);

      const ini = await m.pelaTela();
      expect(membrosDe(ini.events)).toEqual([PARTICIPANTE.id]);
      const trazidos: RuntimeEvent[] = [];
      expect(await trazerImportacao(rodarGuardando(m.d, trazidos), (await m.d.repos.quadroImportacoes.ultima(qid))!.id)).toBe("aplicada");
      // O progresso (aoAvancar) e o fim do aplicar.
      expect(membrosDe(trazidos).length).toBeGreaterThanOrEqual(2);
      expect(membrosDe(trazidos).every((x) => x === PARTICIPANTE.id)).toBe(true);

      // A busca que cai no meio: o progresso e a falha.
      m.f.falharNaCompleta = true;
      await m.pelaTela();
      const falhos: RuntimeEvent[] = [];
      expect(await trazerImportacao(rodarGuardando(m.d, falhos), (await m.d.repos.quadroImportacoes.ultima(qid))!.id)).toBe("falhou");
      expect(membrosDe(falhos).length).toBeGreaterThanOrEqual(2);
      expect(membrosDe(falhos).every((x) => x === PARTICIPANTE.id)).toBe(true);

      // O assumir pelo card e o Desfazer pela tela.
      const card = await m.pedir({ tipo: "assumir_quadro" });
      if (!card.ok || !card.proposta_id) throw new Error(JSON.stringify(card));
      const dec = await executar(m.d, decidirAssumirQuadro, { decisaoId: card.proposta_id, recusar: false });
      expect(dec.data).toMatchObject({ assumido: true });
      expect(membrosDe(dec.events)).toEqual([PARTICIPANTE.id]);
      const des = await executar(m.d, EXECUTORES_QUADRO["quadro.assumir"], { anfitriaoId: m.host.agenteId, executor: "catcher", desfazer: true });
      expect(membrosDe(des.events)).toEqual([PARTICIPANTE.id]);
    });
  });
});
