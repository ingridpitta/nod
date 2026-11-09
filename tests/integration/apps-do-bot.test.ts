import { afterAll, beforeAll, expect, it } from "vitest";
import { rotasApps } from "../../src/adapters/http/rotas/apps.ts";
import type { DepsRotas } from "../../src/adapters/http/rotas/executar-caso.ts";
import type { PaginasDto } from "../../src/contracts/apps.ts";
import { vincularEscopo } from "../../src/db/tx.ts";
import { PROPRIEDADES_APPS } from "../../src/contracts/ferramentas-apps.ts";
import { homeDoBot, MAX_ORDEM_GUARDADA, PAGINA_CONVERSA, PAGINA_TAREFAS } from "../../src/domain/apps-do-bot.ts";
import { ehNomeRepetido } from "../../src/repositories/apps-do-bot.repo.ts";
import { criarRepos } from "../../src/repositories/index.ts";
import type { Escopo, Tx } from "../../src/shared/types.ts";
import { EXECUTORES_APPS, verPaginas } from "../../src/use-cases/acoes/apps.ts";
import { proporApp, REGRA_APP_SUBSTITUIDO } from "../../src/use-cases/apps-do-bot.ts";
import { gerirApps } from "../../src/use-cases/gerir-apps.ts";
import { aplicarLoteQuadro } from "../../src/use-cases/quadro.ts";
import type { Deps } from "../../src/use-cases/tipos.ts";
import { ANA, depsSobreTrx, esperarErro, executar, MARLON, servicosDeTeste, useCasesDeTeste } from "../helpers/deps-l6.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { servidorDeTeste, type ServidorDeTeste } from "../helpers/servidor-de-teste.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/**
 * NOD-445 (ADR-146): as regras das páginas do bot no banco de verdade — o limite de 12 (Tarefas conta), o nome sem
 * duplicado, a Conversa que nunca sai, a ordem guardada no servidor, o card que vira a última página, o Desfazer que
 * devolve no mesmo lugar, o bot de outra pessoa (RLS) e o experimento desligado.
 */
describeIntegracao("apps do bot (NOD-445)", () => {
  let servidor: ServidorDeTeste;
  let trxAtual: Tx | null = null;

  beforeAll(async () => {
    const deps: DepsRotas = {
      abrirTx:
        (escopo: Escopo) =>
        async <T,>(fn: (t: Tx) => Promise<T>): Promise<T> => {
          const trx = trxAtual;
          if (!trx) throw new Error("teste sem transação aberta");
          const caixa: { valor?: T } = {};
          await trx.savepoint(async (sp) => {
            await vincularEscopo(sp, escopo);
            caixa.valor = await fn(sp);
          });
          return caixa.valor as T;
        },
      services: servicosDeTeste((t) => criarRepos(t, MARLON), MARLON),
      useCases: useCasesDeTeste(),
      executor: "catcher",
    };
    servidor = await servidorDeTeste(rotasApps(deps));
  });
  afterAll(() => servidor.close());

  async function montar(trx: Tx) {
    const d = depsSobreTrx(trx, MARLON);
    await d.repos.preferencias.gravar({ experimentos: { quadro: true } });
    const bot = await agenteComConversa(trx, MARLON, { nome: `Gil ${Math.random().toString(36).slice(2, 7)}` });
    return { d, bot };
  }
  const turno = async (d: Deps, bot: { agenteId: string; conversaId: string }, o: { origem?: "conversa" | "rotina"; confianca?: "confiavel" | "nao_confiavel" } = {}) => {
    const t = await d.repos.turnos.enfileirar({ executor: "catcher", conversaId: bot.conversaId, agenteId: bot.agenteId, origem: o.origem ?? "conversa", prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "pedido", entradaConfianca: o.confianca ?? "confiavel", modelo: "auto" });
    return { turnoId: t!.id, agenteId: bot.agenteId, conversaId: bot.conversaId };
  };
  const criarDireto = (d: Deps, agenteId: string, nome: string) => d.repos.appsDoBot.criar({ agenteId, nome, icone: "app", fonte: "bot", fonteRef: null, forma: "lista", quemVe: "so_eu", regraPede: null });
  const paginas = async (d: Deps, agenteId: string): Promise<PaginasDto> => (await executar(d, verPaginas, { agenteId })).data.paginas;

  it("o card do app: nada nasce antes do Criar; depois é a última página, mesmo com ordem guardada; recusar não cria", async () => {
    await withRollback(MARLON, async (trx) => {
      trxAtual = trx;
      const { d, bot } = await montar(trx);
      await criarDireto(d, bot.agenteId, "Leituras");
      await executar(d, EXECUTORES_APPS["paginas.ordenar"], { agenteId: bot.agenteId, pagina: "Leituras", posicao: 1 });
      const p = await executar(d, proporApp, { ...(await turno(d, bot)), nome: "Vagas", regra_pede: "vaga parada há 2 dias" });
      if (!p.data.ok) throw new Error(JSON.stringify(p.data));
      expect((await d.repos.decisoes.buscar(p.data.propostaId))?.tipo).toBe("app");
      expect((await paginas(d, bot.agenteId)).apps.map((a) => a.nome)).toEqual(["Leituras"]);
      const r = await executar(d, EXECUTORES_APPS["paginas.criar_app"], { decisaoId: p.data.propostaId, recusar: false });
      expect(r.data.criado).toMatchObject({ nome: "Vagas", forma: "lista", fonte: "bot", quemVe: "so_eu", regraPede: "vaga parada há 2 dias" });
      const depois = await paginas(d, bot.agenteId);
      expect(depois.ordem).toEqual([`app:${depois.apps[0]!.id}`, "conversa", `app:${r.data.criado!.id}`]);
      expect(r.events.map((e) => e.kind)).toContain("paginas_mudaram");
      // Decidir de novo: a decisão já fechou.
      await esperarErro(() => executar(d, EXECUTORES_APPS["paginas.criar_app"], { decisaoId: p.data.ok ? p.data.propostaId : "", recusar: false }), "estado_invalido");

      const q = await executar(d, proporApp, { ...(await turno(d, bot)), nome: "Contas" });
      if (!q.data.ok) throw new Error("card");
      expect((await executar(d, EXECUTORES_APPS["paginas.criar_app"], { decisaoId: q.data.propostaId, recusar: true })).data.criado).toBeNull();
      expect((await paginas(d, bot.agenteId)).apps.map((a) => a.nome)).toEqual(["Leituras", "Vagas"]);
    });
  });

  it("revisão 5 do #649 (baixo 8): o app antigo chamado Canvas segue alcançável pelo nome quando o bot não tem o Canvas", async () => {
    await withRollback(MARLON, async (trx) => {
      trxAtual = trx;
      const { d, bot } = await montar(trx);
      await criarDireto(d, bot.agenteId, "Leituras");
      const antigo = await criarDireto(d, bot.agenteId, "Canvas");
      await executar(d, EXECUTORES_APPS["paginas.ordenar"], { agenteId: bot.agenteId, pagina: "canvas", posicao: 1 });
      expect((await paginas(d, bot.agenteId)).ordem[0]).toBe(`app:${antigo!.id}`);
      // Revisão 6 do #649 (baixo): e sai pelo nome, sem a recusa do Canvas nativo.
      const r = await executar(d, EXECUTORES_APPS["paginas.remover_app"], { agenteId: bot.agenteId, app: "Canvas" });
      expect(r.data.app.id).toBe(antigo!.id);
    });
  });

  it("revisão 3 do #626: o card novo fecha só o pendente do mesmo nome no mesmo bot; dois nomes na conversa ficam confirmáveis", async () => {
    await withRollback(MARLON, async (trx) => {
      trxAtual = trx;
      const { d, bot } = await montar(trx);
      const vagas = await executar(d, gerirApps, { ...(await turno(d, bot)), op: "propor", nome: "Vagas" });
      const contas = await executar(d, gerirApps, { ...(await turno(d, bot)), op: "propor", nome: "Contas" });
      if (!vagas.data.ok || !contas.data.ok) throw new Error("card");
      expect(contas.data.cards_fechados ?? []).toEqual([]);
      // O ajuste do mesmo app (o nome sem acento nem caixa): o card anterior de Vagas sai, e o retorno diz qual.
      const ajuste = await executar(d, gerirApps, { ...(await turno(d, bot)), op: "propor", nome: "VAGAS", forma: "quadro" });
      if (!ajuste.data.ok) throw new Error("ajuste");
      expect(ajuste.data.cards_fechados).toEqual([{ proposta_id: vagas.data.proposta_id, nome: "Vagas" }]);
      expect((await d.repos.propostas.buscar(vagas.data.proposta_id!))?.estado).toBe("recusada");
      // Revisão 5 do #626: o card substituído fecha por regra, não como se a pessoa o tivesse recusado.
      const fechada = await d.repos.decisoes.buscar(vagas.data.proposta_id!);
      expect(fechada).toMatchObject({ estado: "decidida", desfecho: { tipo: "decidida_por_regra", regra: REGRA_APP_SUBSTITUIDO } });
      expect(ajuste.events.find((e) => e.kind === "decisao_decidida")?.autoria).toMatchObject({ decidido_por: REGRA_APP_SUBSTITUIDO });
      await esperarErro(() => executar(d, EXECUTORES_APPS["paginas.criar_app"], { decisaoId: vagas.data.ok ? vagas.data.proposta_id! : "", recusar: false }), "estado_invalido");
      // Contas e o Vagas ajustado: os dois se confirmam.
      expect((await executar(d, EXECUTORES_APPS["paginas.criar_app"], { decisaoId: contas.data.proposta_id!, recusar: false })).data.criado).toMatchObject({ nome: "Contas" });
      expect((await executar(d, EXECUTORES_APPS["paginas.criar_app"], { decisaoId: ajuste.data.proposta_id!, recusar: false })).data.criado).toMatchObject({ nome: "VAGAS", forma: "quadro" });
      expect((await paginas(d, bot.agenteId)).apps.map((a) => a.nome).sort()).toEqual(["Contas", "VAGAS"]);
    });
  });

  it("revisões 4 e 5 do #626: o Criar já ganhou entre a leitura e a trava; o Ajustar não fecha o card e revalida: nome_em_uso, use editar", async () => {
    await withRollback(MARLON, async (trx) => {
      trxAtual = trx;
      const { d, bot } = await montar(trx);
      const vagas = await executar(d, proporApp, { ...(await turno(d, bot)), nome: "Vagas" });
      if (!vagas.data.ok) throw new Error("card");
      // O que o Ajustar leu antes de o Criar commitar (READ COMMITTED, sem trava): o card pendente e o bot sem o app.
      const pendentesAntes = await d.repos.propostas.pendentesDaConversa(bot.conversaId);
      const appsAntes = await d.repos.appsDoBot.doAgente(bot.agenteId);
      expect((await executar(d, EXECUTORES_APPS["paginas.criar_app"], { decisaoId: vagas.data.propostaId, recusar: false })).data.criado).toMatchObject({ nome: "Vagas" });
      let leituras = 0;
      const leituraVelha: Deps = {
        ...d,
        repos: {
          ...d.repos,
          propostas: { ...d.repos.propostas, pendentesDaConversa: async () => pendentesAntes },
          // Só a primeira leitura (a validação antes das travas) é a velha; a revalidação depois delas vê o app criado.
          appsDoBot: { ...d.repos.appsDoBot, doAgente: async (id: string) => (leituras++ === 0 ? appsAntes : d.repos.appsDoBot.doAgente(id)) },
        },
      };
      const ajuste = await proporApp(leituraVelha, { ...(await turno(d, bot)), nome: "vagas", forma: "quadro" });
      expect(ajuste.data).toMatchObject({ ok: false, erro: "nome_em_uso", instrucao: expect.stringContaining("editar") });
      expect(ajuste.events).toEqual([]);
      expect((await d.repos.propostas.buscar(vagas.data.propostaId))?.estado).toBe("confirmada");
      expect(await d.repos.propostas.pendentesDaConversa(bot.conversaId)).toEqual([]);
    });
  });

  it("limite de 12 páginas com a vaga de Tarefas reservada: o 11º app fecha a conta, mesmo sem quadro; o quadro depois não passa de 12", async () => {
    await withRollback(MARLON, async (trx) => {
      trxAtual = trx;
      const { d, bot } = await montar(trx);
      for (let i = 1; i <= 10; i++) await criarDireto(d, bot.agenteId, `App ${i}`);
      expect((await paginas(d, bot.agenteId)).cabeMais).toBe(true);
      const card = await executar(d, proporApp, { ...(await turno(d, bot)), nome: "Décimo segundo" });
      if (!card.data.ok) throw new Error("card");
      await criarDireto(d, bot.agenteId, "App 11");
      // Revisão 3 do #626: sem quadro, 11 apps já é o limite (a 12ª página é de Tarefas, que liga sozinha com o quadro).
      const sem = await paginas(d, bot.agenteId);
      expect(sem.temTarefas).toBe(false);
      expect(sem.cabeMais).toBe(false);
      const r = await executar(d, gerirApps, { ...(await turno(d, bot)), op: "propor", nome: "Mais um" });
      expect(r.data).toMatchObject({ ok: false, erro: "limite_de_apps" });
      const velho = await executar(d, EXECUTORES_APPS["paginas.criar_app"], { decisaoId: card.data.propostaId, recusar: false });
      expect(velho.data).toEqual({ criado: null, obsoleta: true, motivo: "limite_de_apps" });
      // O quadro chega depois: 11 apps + Tarefas = 12 páginas além da Conversa, nunca 13.
      expect((await executar(d, aplicarLoteQuadro, { autor: { tipo: "pessoa" }, anfitriaoId: bot.agenteId, executor: "catcher", ops: [{ tipo: "criar_quadro", meta: "M" }] })).data).toMatchObject({ ok: true });
      const p = await paginas(d, bot.agenteId);
      expect(p.temTarefas).toBe(true);
      expect(p.ordem.filter((x) => x !== "conversa")).toHaveLength(12);
      expect(p.cabeMais).toBe(false);
      // Tarefas não sai pela pílula.
      await esperarErro(() => executar(d, EXECUTORES_APPS["paginas.remover_app"], { agenteId: bot.agenteId, app: "tarefas" }), "entrada_invalida");
    });
  });

  it("nome: duplicado sem acento nem caixa, as páginas fixas contam, e a sugestão vem junto", async () => {
    await withRollback(MARLON, async (trx) => {
      trxAtual = trx;
      const { d, bot } = await montar(trx);
      await criarDireto(d, bot.agenteId, "Vagas");
      expect((await executar(d, gerirApps, { ...(await turno(d, bot)), op: "propor", nome: "VÁGAS" })).data).toMatchObject({ ok: false, erro: "nome_em_uso", sugestao: "VÁGAS 2" });
      expect((await executar(d, gerirApps, { ...(await turno(d, bot)), op: "propor", nome: "conversa" })).data).toMatchObject({ ok: false, erro: "nome_em_uso" });
      // Revisão 2 do #626: "Quadro" é o apelido de Tarefas no chat (o app seria inalcançável por lá), propor ou renomear.
      expect((await executar(d, gerirApps, { ...(await turno(d, bot)), op: "propor", nome: "Quadro" })).data).toMatchObject({ ok: false, erro: "nome_em_uso", sugestao: "Quadro 2" });
      expect((await executar(d, gerirApps, { ...(await turno(d, bot)), op: "editar", app: "Vagas", nome: "quadro" })).data).toMatchObject({ ok: false, erro: "nome_em_uso" });
      expect((await executar(d, gerirApps, { ...(await turno(d, bot)), op: "propor", nome: "x".repeat(21) })).data).toMatchObject({ ok: false, erro: "entrada_invalida" });
      expect((await executar(d, gerirApps, { ...(await turno(d, bot)), op: "propor", nome: "Docs", fonte: "arquivo" })).data).toMatchObject({ ok: false, erro: "entrada_invalida" });
      // O índice único segura o duplicado mesmo por fora do caso de uso.
      expect(await criarDireto(d, bot.agenteId, "Vagas")).toBeNull();
    });
  });

  it("remover e o Desfazer: o app volta no mesmo lugar; se outro pegou o nome, o restaurar recusa; a Conversa nunca sai", async () => {
    await withRollback(MARLON, async (trx) => {
      trxAtual = trx;
      const { d, bot } = await montar(trx);
      const vagas = (await criarDireto(d, bot.agenteId, "Vagas"))!;
      await criarDireto(d, bot.agenteId, "Leituras");
      await executar(d, EXECUTORES_APPS["paginas.ordenar"], { agenteId: bot.agenteId, pagina: "Vagas", posicao: 1 });
      const antes = (await paginas(d, bot.agenteId)).ordem;
      await executar(d, EXECUTORES_APPS["paginas.remover_app"], { agenteId: bot.agenteId, app: vagas.id });
      expect((await paginas(d, bot.agenteId)).ordem).not.toContain(`app:${vagas.id}`);
      await executar(d, EXECUTORES_APPS["paginas.restaurar_app"], { agenteId: bot.agenteId, app: vagas.id });
      expect((await paginas(d, bot.agenteId)).ordem).toEqual(antes);

      await executar(d, EXECUTORES_APPS["paginas.remover_app"], { agenteId: bot.agenteId, app: vagas.id });
      await criarDireto(d, bot.agenteId, "vagas");
      await esperarErro(() => executar(d, EXECUTORES_APPS["paginas.restaurar_app"], { agenteId: bot.agenteId, app: vagas.id }), "estado_invalido");
      await esperarErro(() => executar(d, EXECUTORES_APPS["paginas.remover_app"], { agenteId: bot.agenteId, app: "conversa" }), "estado_invalido");
      expect((await executar(d, gerirApps, { ...(await turno(d, bot)), op: "remover", app: "Conversa" })).data).toMatchObject({ ok: false, erro: "conversa_fica" });
    });
  });

  it("revisão 4 do #626: restaurar pelo chat aceita o nome (sem acento nem caixa) e traz o removido mais recente com ele", async () => {
    await withRollback(MARLON, async (trx) => {
      trxAtual = trx;
      const { d, bot } = await montar(trx);
      const velho = (await criarDireto(d, bot.agenteId, "Vágas"))!;
      await executar(d, EXECUTORES_APPS["paginas.remover_app"], { agenteId: bot.agenteId, app: velho.id });
      const novo = (await criarDireto(d, bot.agenteId, "Vagas"))!;
      await executar(d, EXECUTORES_APPS["paginas.remover_app"], { agenteId: bot.agenteId, app: novo.id });
      const r = await executar(d, gerirApps, { ...(await turno(d, bot)), op: "restaurar", app: "VAGAS" });
      expect(r.data).toMatchObject({ ok: true, app_id: novo.id });
      expect((await paginas(d, bot.agenteId)).apps.map((a) => a.id)).toEqual([novo.id]);
      // O nome que não está entre os removidos: nada muda.
      expect((await executar(d, gerirApps, { ...(await turno(d, bot)), op: "restaurar", app: "Contas" })).data).toMatchObject({ ok: false, erro: "nao_encontrado" });
    });
  });

  it("revisão 1 do #626: reordenar com um app removido não perde o lugar dele; o Desfazer o devolve lá, não no fim", async () => {
    await withRollback(MARLON, async (trx) => {
      trxAtual = trx;
      const { d, bot } = await montar(trx);
      const [a, b, c] = [(await criarDireto(d, bot.agenteId, "A"))!, (await criarDireto(d, bot.agenteId, "B"))!, (await criarDireto(d, bot.agenteId, "C"))!];
      const pa = `app:${a.id}`, pb = `app:${b.id}`, pc = `app:${c.id}`;
      await executar(d, EXECUTORES_APPS["paginas.ordenar"], { agenteId: bot.agenteId, ordem: ["conversa", pa, pb, pc] });
      await executar(d, EXECUTORES_APPS["paginas.remover_app"], { agenteId: bot.agenteId, app: b.id });
      // Com B fora, a pessoa põe A como home (pela tela e pelo chat: os dois caminhos gravam a ordem).
      await executar(d, EXECUTORES_APPS["paginas.ordenar"], { agenteId: bot.agenteId, ordem: [pa, "conversa", pc] });
      await executar(d, EXECUTORES_APPS["paginas.ordenar"], { agenteId: bot.agenteId, pagina: "C", posicao: 3 });
      expect((await paginas(d, bot.agenteId)).ordem).toEqual([pa, "conversa", pc]);
      await executar(d, EXECUTORES_APPS["paginas.restaurar_app"], { agenteId: bot.agenteId, app: b.id });
      // B volta logo depois de A (a página que vinha antes dele), não no fim.
      expect((await paginas(d, bot.agenteId)).ordem).toEqual([pa, pb, "conversa", pc]);
    });
  });

  it("revisão 2 do #626: sem ordem guardada, o app removido antes do primeiro reordenar volta no lugar da ordem padrão", async () => {
    await withRollback(MARLON, async (trx) => {
      trxAtual = trx;
      const { d, bot } = await montar(trx);
      for (const n of ["A", "B", "C"]) await criarDireto(d, bot.agenteId, n);
      expect(await d.repos.appsDoBot.ordem(bot.agenteId)).toBeNull();
      // A ordem padrão (a de criação); o do meio sai antes de a pessoa reordenar pela primeira vez.
      const [conversa, x, y, z] = (await paginas(d, bot.agenteId)).ordem;
      expect(conversa).toBe("conversa");
      await executar(d, EXECUTORES_APPS["paginas.remover_app"], { agenteId: bot.agenteId, app: y!.slice(4) });
      await executar(d, EXECUTORES_APPS["paginas.ordenar"], { agenteId: bot.agenteId, ordem: [x!, "conversa", z!] });
      await executar(d, EXECUTORES_APPS["paginas.restaurar_app"], { agenteId: bot.agenteId, app: y!.slice(4) });
      // O removido volta logo depois da página que vinha antes dele na padrão (x), não no fim.
      expect((await paginas(d, bot.agenteId)).ordem).toEqual([x, y, "conversa", z]);
    });
  });

  it("revisão 2 do #626: o nome repetido na corrida (o índice recusa no UPDATE) não aborta a transação de quem chama; só o índice do nome vira nome_repetido", async () => {
    await withRollback(MARLON, async (trx) => {
      trxAtual = trx;
      const { d, bot } = await montar(trx);
      const velho = (await criarDireto(d, bot.agenteId, "Vagas"))!;
      await d.repos.appsDoBot.remover(velho.id, Date.now());
      const novo = (await criarDireto(d, bot.agenteId, "vagas"))!;
      const outro = (await criarDireto(d, bot.agenteId, "Leituras"))!;
      // A corrida de duas abas: a conferência de antes passou (outra aba gravou depois dela) e o índice recusa no UPDATE.
      const repo = criarRepos(trx, MARLON).appsDoBot;
      repo.nomeTomado = async () => false;
      expect(await repo.restaurar(velho.id)).toBe("nome_repetido");
      expect(await repo.salvar(outro.id, { nome: "VAGAS" })).toBe("nome_repetido");
      // A transação segue viva: o chat continua no mesmo turno (antes: "current transaction is aborted").
      expect((await paginas(d, bot.agenteId)).apps.map((a) => a.id).sort()).toEqual([novo.id, outro.id].sort());
      // Outro 23505 (outra constraint) não é nome repetido: sobe como erro.
      expect(ehNomeRepetido({ code: "23505", constraint_name: "apps_do_bot_nome" })).toBe(true);
      expect(ehNomeRepetido({ code: "23505", constraint_name: "apps_do_bot_pkey" })).toBe(false);
    });
  });

  it("revisão 1 do #626: o app criado pelo card com a ordem guardada cheia não corta páginas vivas (nem a home)", async () => {
    await withRollback(MARLON, async (trx) => {
      trxAtual = trx;
      const { d, bot } = await montar(trx);
      const vivos: string[] = [];
      for (let i = 1; i <= 10; i++) vivos.push(`app:${(await criarDireto(d, bot.agenteId, `Vivo ${i}`))!.id}`);
      // A ordem guardada no teto (20): a home é um app, depois a Conversa, nove removidos (que o Desfazer traz) e o resto.
      const fora: string[] = [];
      for (let i = 1; i <= 9; i++) {
        const x = (await criarDireto(d, bot.agenteId, `Fora ${i}`))!;
        fora.push(`app:${x.id}`);
      }
      await d.repos.appsDoBot.gravarOrdem(bot.agenteId, [vivos[0]!, "conversa", ...fora, ...vivos.slice(1)]);
      for (const f of fora) await executar(d, EXECUTORES_APPS["paginas.remover_app"], { agenteId: bot.agenteId, app: f });
      const p = await executar(d, proporApp, { ...(await turno(d, bot)), nome: "Novo" });
      if (!p.data.ok) throw new Error(JSON.stringify(p.data));
      const r = await executar(d, EXECUTORES_APPS["paginas.criar_app"], { decisaoId: p.data.propostaId, recusar: false });
      const novo = `app:${r.data.criado!.id}`;
      expect((await paginas(d, bot.agenteId)).ordem).toEqual([vivos[0], "conversa", ...vivos.slice(1), novo]);
      const guardada = (await d.repos.appsDoBot.ordem(bot.agenteId))!;
      expect(guardada.length).toBeLessThanOrEqual(20);
      expect(guardada.slice(0, 2)).toEqual([vivos[0], "conversa"]);
      expect(guardada.at(-1)).toBe(novo);
    });
  });

  it("revisão 1 do #626: na conversa, turno que leu conteúdo de fora não remove nem reordena; propor, restaurar e renomear seguem", async () => {
    await withRollback(MARLON, async (trx) => {
      trxAtual = trx;
      const { d, bot } = await montar(trx);
      const vagas = (await criarDireto(d, bot.agenteId, "Vagas"))!;
      const fora = (await criarDireto(d, bot.agenteId, "Fora"))!;
      await d.repos.appsDoBot.remover(fora.id, Date.now());
      const antes = (await paginas(d, bot.agenteId)).ordem;
      // Dois jeitos de não estar limpo: a entrada não confiável, e o turno que leu uma página no meio (contaminado).
      const naoConfiavel = await turno(d, bot, { confianca: "nao_confiavel" });
      const contaminado = await turno(d, bot);
      await d.repos.turnos.contaminar(contaminado.turnoId, Date.now());
      for (const t of [naoConfiavel, contaminado]) {
        expect((await executar(d, gerirApps, { ...t, op: "remover", app: "Vagas" })).data).toMatchObject({ ok: false, erro: "entrada_invalida" });
        expect((await executar(d, gerirApps, { ...t, op: "ordenar", pagina: "Vagas", posicao: 1 })).data).toMatchObject({ ok: false, erro: "entrada_invalida" });
      }
      expect((await d.repos.appsDoBot.buscar(vagas.id))).not.toBeNull();
      expect((await paginas(d, bot.agenteId)).ordem).toEqual(antes);
      // O que não tira nada da pessoa segue: propor (o card espera ela), restaurar (o Desfazer) e renomear.
      expect((await executar(d, gerirApps, { ...contaminado, op: "propor", nome: "Contas" })).data).toMatchObject({ ok: true });
      expect((await executar(d, gerirApps, { ...contaminado, op: "restaurar", app: fora.id })).data).toMatchObject({ ok: true });
      expect((await executar(d, gerirApps, { ...contaminado, op: "editar", app: "Vagas", nome: "Vagas 2" })).data).toMatchObject({ ok: true });
      // Limpo, na conversa: remove e reordena.
      const limpo = await turno(d, bot);
      expect((await executar(d, gerirApps, { ...limpo, op: "ordenar", pagina: "Vagas 2", posicao: 1 })).data).toMatchObject({ ok: true });
      expect((await executar(d, gerirApps, { ...limpo, op: "remover", app: "Vagas 2" })).data).toMatchObject({ ok: true });
    });
  });

  it("revisão 3 do #626 (ADR-047): turno que leu conteúdo de fora não muda regra_pede, fonte nem fonte_ref; nome e retrato seguem", async () => {
    await withRollback(MARLON, async (trx) => {
      trxAtual = trx;
      const { d, bot } = await montar(trx);
      const vagas = (await criarDireto(d, bot.agenteId, "Vagas"))!;
      const naoConfiavel = await turno(d, bot, { confianca: "nao_confiavel" });
      const contaminado = await turno(d, bot);
      await d.repos.turnos.contaminar(contaminado.turnoId, Date.now());
      for (const t of [naoConfiavel, contaminado]) {
        for (const campos of [{ regra_pede: "toda vaga" }, { fonte: "conector", fonte_ref: "gmail" }, { fonte_ref: "outro" }, { regra_pede: null }]) {
          expect((await executar(d, gerirApps, { ...t, op: "editar", app: "Vagas", ...campos })).data).toMatchObject({ ok: false, erro: "entrada_invalida" });
          expect((await executar(d, gerirApps, { ...t, op: "propor", nome: "Contas", ...campos })).data).toMatchObject({ ok: false, erro: "entrada_invalida" });
        }
      }
      expect(await d.repos.appsDoBot.buscar(vagas.id)).toMatchObject({ regraPede: null, fonte: "bot", fonteRef: null });
      expect(await d.repos.propostas.pendentesDaConversa(bot.conversaId)).toEqual([]);
      // Nome e retrato seguem no turno sujo; o card sem regra nem fonte também.
      expect((await executar(d, gerirApps, { ...contaminado, op: "editar", app: "Vagas", nome: "Vagas 2", dados: { itens: [{ titulo: "x" }] } })).data).toMatchObject({ ok: true });
      expect((await executar(d, gerirApps, { ...contaminado, op: "propor", nome: "Contas" })).data).toMatchObject({ ok: true });
      // Limpo, a regra muda.
      expect((await executar(d, gerirApps, { ...(await turno(d, bot)), op: "editar", app: "Vagas 2", regra_pede: "toda vaga" })).data).toMatchObject({ ok: true });
    });
  });

  it("a ordem mora no servidor: a ordem inteira vale, o desconhecido sai, a Conversa pode ser a última e a primeira é a home", async () => {
    await withRollback(MARLON, async (trx) => {
      trxAtual = trx;
      const { d, bot } = await montar(trx);
      const a = (await criarDireto(d, bot.agenteId, "A"))!;
      const b = (await criarDireto(d, bot.agenteId, "B"))!;
      const s = await servidor.entrar("marlon");
      const r = await servidor.chamar(s, "PUT", `/agentes/${bot.agenteId}/paginas/ordem`, { ordem: [`app:${b.id}`, "lixo", "conversa"] });
      expect(r.status, await r.clone().text()).toBe(200);
      expect(await d.repos.appsDoBot.ordem(bot.agenteId)).toEqual([`app:${b.id}`, "conversa", `app:${a.id}`]);
      const g = (await (await servidor.chamar(s, "GET", `/agentes/${bot.agenteId}/paginas`)).json()) as { paginas: PaginasDto };
      expect(g.paginas.ordem[0]).toBe(`app:${b.id}`);
      await executar(d, EXECUTORES_APPS["paginas.ordenar"], { agenteId: bot.agenteId, pagina: "conversa", posicao: 99 });
      expect((await paginas(d, bot.agenteId)).ordem.at(-1)).toBe("conversa");
      expect((await servidor.chamar(s, "PUT", `/agentes/${bot.agenteId}/paginas/ordem`, { pagina: "nao-existe", posicao: 1 })).status).toBe(404);
    });
  });

  it("o gerir_apps fora da conversa só regrava o retrato; turno que leu conteúdo de fora não acende o pede você", async () => {
    await withRollback(MARLON, async (trx) => {
      trxAtual = trx;
      const { d, bot } = await montar(trx);
      const app = (await criarDireto(d, bot.agenteId, "Vagas"))!;
      await d.repos.appsDoBot.salvar(app.id, { regraPede: "vaga parada" });
      const rotina = await turno(d, bot, { origem: "rotina" });
      expect((await executar(d, gerirApps, { ...rotina, op: "ordenar", pagina: "Vagas", posicao: 1 })).data).toMatchObject({ ok: false, erro: "entrada_invalida" });
      expect((await executar(d, gerirApps, { ...rotina, op: "editar", app: "Vagas", nome: "Outro" })).data).toMatchObject({ ok: false, erro: "entrada_invalida" });
      expect((await executar(d, gerirApps, { ...rotina, op: "editar", app: "Vagas", dados: { itens: [{ titulo: "Dev", pede: true }] } })).data).toMatchObject({ ok: true, apps: [{ pede_voce: true }] });
      const sujo = await turno(d, bot, { origem: "rotina", confianca: "nao_confiavel" });
      expect((await executar(d, gerirApps, { ...sujo, op: "editar", app: "Vagas", dados: { itens: [{ titulo: "Dev", pede: true }] } })).data).toMatchObject({ ok: true, apps: [{ pede_voce: false }] });
      // A fonte em erro: o estado de erro aparece e o pede você apaga.
      expect((await executar(d, gerirApps, { ...rotina, op: "editar", app: "Vagas", erro_fonte: "o Gmail foi desconectado" })).data).toMatchObject({ ok: true, apps: [{ erro_fonte: "o Gmail foi desconectado", pede_voce: false }] });
    });
  });

  it("fora da conversa, a rotina de um bot não regrava o retrato do app de outro bot (só o dela)", async () => {
    await withRollback(MARLON, async (trx) => {
      trxAtual = trx;
      const { d, bot } = await montar(trx);
      const outro = await agenteComConversa(trx, MARLON, { nome: `Nina ${Math.random().toString(36).slice(2, 7)}` });
      const dela = (await criarDireto(d, outro.agenteId, "Vagas"))!;
      const rotina = await turno(d, bot, { origem: "rotina" });
      const r = await executar(d, gerirApps, { ...rotina, op: "editar", bot: outro.agenteId, app: "Vagas", dados: { itens: [{ titulo: "Invasor" }] } });
      expect(r.data).toMatchObject({ ok: false, erro: "entrada_invalida" });
      expect((await d.repos.appsDoBot.buscar(dela.id))?.dados).toBeNull();
      // Pelo nome do outro bot também não; e a listagem do outro bot fora da conversa fica fechada.
      expect((await executar(d, gerirApps, { ...rotina, op: "editar", bot: (await d.repos.agentes.buscar(outro.agenteId))!.nome, app: "Vagas", erro_fonte: "x" })).data).toMatchObject({ ok: false, erro: "entrada_invalida" });
      expect((await executar(d, gerirApps, { ...rotina, op: "listar", bot: outro.agenteId })).data).toMatchObject({ ok: false, erro: "entrada_invalida" });
      // O próprio bot, dito pelo id, segue podendo.
      await criarDireto(d, bot.agenteId, "Minhas");
      expect((await executar(d, gerirApps, { ...rotina, op: "editar", bot: bot.agenteId, app: "Minhas", dados: { itens: [{ titulo: "ok" }] } })).data).toMatchObject({ ok: true });
      // Na conversa, mexer na configuração das páginas de outro bot da pessoa vale ("muda o ícone do Vagas da Nina"); o
      // retrato (dados, erro_fonte) não: só o bot dono o grava (revisão 5 do #626).
      const naConversa = await turno(d, bot);
      expect((await executar(d, gerirApps, { ...naConversa, op: "editar", bot: outro.agenteId, app: "Vagas", dados: { itens: [{ titulo: "Dev" }] } })).data).toMatchObject({ ok: false, erro: "entrada_invalida" });
      expect((await executar(d, gerirApps, { ...naConversa, op: "editar", bot: outro.agenteId, app: "Vagas", erro_fonte: "x" })).data).toMatchObject({ ok: false, erro: "entrada_invalida" });
      expect((await executar(d, gerirApps, { ...naConversa, op: "editar", bot: outro.agenteId, app: "Vagas", forma: "quadro" })).data).toMatchObject({ ok: true });
      expect(await d.repos.appsDoBot.buscar(dela.id)).toMatchObject({ forma: "quadro", dados: null, erroFonte: null });
    });
  });

  it("revisão 5 do #626: erro_fonte só de turno limpo; de turno sujo é descartado e a ferramenta avisa", async () => {
    await withRollback(MARLON, async (trx) => {
      trxAtual = trx;
      const { d, bot } = await montar(trx);
      const app = (await criarDireto(d, bot.agenteId, "Vagas"))!;
      const sujo = await turno(d, bot);
      await d.repos.turnos.contaminar(sujo.turnoId, Date.now());
      // Só o erro, de turno sujo: nada a gravar.
      expect((await executar(d, gerirApps, { ...sujo, op: "editar", app: "Vagas", erro_fonte: "o Gmail caiu" })).data).toMatchObject({ ok: false, erro: "entrada_invalida" });
      expect((await d.repos.appsDoBot.buscar(app.id))?.erroFonte).toBeNull();
      // Com o retrato junto: o retrato vai (sem pede), o erro não, e a instrução diz que foi descartado.
      const r = await executar(d, gerirApps, { ...sujo, op: "editar", app: "Vagas", dados: { itens: [{ titulo: "Dev" }] }, erro_fonte: "o Gmail caiu" });
      expect(r.data).toMatchObject({ ok: true, apps: [{ erro_fonte: null }], instrucao: expect.stringContaining("erro_fonte não foi gravado") });
      // Limpo, grava.
      expect((await executar(d, gerirApps, { ...(await turno(d, bot)), op: "editar", app: "Vagas", erro_fonte: "o Gmail caiu" })).data).toMatchObject({ ok: true, apps: [{ erro_fonte: "o Gmail caiu" }] });
    });
  });

  it("revisão 5 do #626: editar para fonte conector ou arquivo exige fonte_ref, como o criar", async () => {
    await withRollback(MARLON, async (trx) => {
      trxAtual = trx;
      const { d, bot } = await montar(trx);
      const app = (await criarDireto(d, bot.agenteId, "Vagas"))!;
      const editar = (campos: Record<string, unknown>) => executar(d, EXECUTORES_APPS["paginas.editar_app"], { agenteId: bot.agenteId, app: "Vagas", ...campos });
      await esperarErro(() => editar({ fonte: "conector" }), "entrada_invalida");
      await esperarErro(() => editar({ fonte: "arquivo", fonte_ref: "  " }), "entrada_invalida");
      expect((await d.repos.appsDoBot.buscar(app.id))?.fonte).toBe("bot");
      await editar({ fonte: "conector", fonte_ref: "gmail" });
      // Já com fonte_ref: trocar entre conector e arquivo sem repetir vale; apagar a referência não.
      await editar({ fonte: "arquivo" });
      await esperarErro(() => editar({ fonte_ref: null }), "entrada_invalida");
      expect(await d.repos.appsDoBot.buscar(app.id)).toMatchObject({ fonte: "arquivo", fonteRef: "gmail" });
      // Voltar para bot sem referência vale.
      await editar({ fonte: "bot", fonte_ref: null });
    });
  });

  it("revisão 5 do #626: retenção dos removidos é um por nome; o removido mais novo apaga os de antes com o mesmo nome", async () => {
    await withRollback(MARLON, async (trx) => {
      trxAtual = trx;
      const { d, bot } = await montar(trx);
      const velho = (await criarDireto(d, bot.agenteId, "Vágas"))!;
      const outro = (await criarDireto(d, bot.agenteId, "Contas"))!;
      await executar(d, EXECUTORES_APPS["paginas.remover_app"], { agenteId: bot.agenteId, app: velho.id });
      await executar(d, EXECUTORES_APPS["paginas.remover_app"], { agenteId: bot.agenteId, app: outro.id });
      const novo = (await criarDireto(d, bot.agenteId, "Vagas"))!;
      await executar(d, EXECUTORES_APPS["paginas.remover_app"], { agenteId: bot.agenteId, app: novo.id });
      expect((await d.repos.appsDoBot.removidos(bot.agenteId)).map((r) => r.id).sort()).toEqual([novo.id, outro.id].sort());
      expect(await d.repos.appsDoBot.buscar(velho.id, { removido: true })).toBeNull();
      // O mais recente e o de outro nome seguem restauráveis.
      await executar(d, EXECUTORES_APPS["paginas.restaurar_app"], { agenteId: bot.agenteId, app: novo.id });
      await executar(d, EXECUTORES_APPS["paginas.restaurar_app"], { agenteId: bot.agenteId, app: outro.id });
    });
  });

  it("QA do #626: a recusa pela rota leva o motivo no corpo (limite, nome em uso, a Conversa), sem o detalhe interno", async () => {
    await withRollback(MARLON, async (trx) => {
      trxAtual = trx;
      const { d, bot } = await montar(trx);
      const s = await servidor.entrar("marlon");
      const recusa = async (metodo: "POST" | "DELETE", caminho: string) => {
        const r = await servidor.chamar(s, metodo, caminho);
        const corpo = (await r.json()) as Record<string, unknown>;
        return { status: r.status, corpo };
      };
      const fixa = { codigo: "estado_invalido", mensagem: "Isso não pode ser feito agora. Atualize a página e tente de novo." };

      // Com 11 apps, o Desfazer de um removido não cabe: 409 com motivo limite_de_apps.
      const vagas = (await criarDireto(d, bot.agenteId, "Vagas"))!;
      for (let i = 1; i <= 10; i++) await criarDireto(d, bot.agenteId, `App ${i}`);
      expect((await servidor.chamar(s, "DELETE", `/agentes/${bot.agenteId}/apps/${vagas.id}`)).status).toBe(200);
      await criarDireto(d, bot.agenteId, "App 11");
      const limite = await recusa("POST", `/agentes/${bot.agenteId}/apps/${vagas.id}/restaurar`);
      expect(limite).toEqual({ status: 409, corpo: { ...fixa, motivo: "limite_de_apps" } });

      // Outro app pegou o nome: motivo nome_em_uso (o nome do app não vai no corpo).
      // (Saem dois para caber: o limite é conferido antes do nome.)
      for (const n of ["App 10", "App 11"]) {
        const a = (await d.repos.appsDoBot.doAgente(bot.agenteId)).find((x) => x.nome === n)!;
        expect((await servidor.chamar(s, "DELETE", `/agentes/${bot.agenteId}/apps/${a.id}`)).status).toBe(200);
      }
      await criarDireto(d, bot.agenteId, "Vagas");
      const nome = await recusa("POST", `/agentes/${bot.agenteId}/apps/${vagas.id}/restaurar`);
      expect(nome).toEqual({ status: 409, corpo: { ...fixa, motivo: "nome_em_uso" } });

      // A Conversa não sai: motivo conversa_fica.
      expect(await recusa("DELETE", `/agentes/${bot.agenteId}/apps/conversa`)).toEqual({ status: 409, corpo: { ...fixa, motivo: "conversa_fica" } });

      // O que não é regra com frase própria segue sem motivo (só o código e a frase fixa).
      const fora = await recusa("POST", `/agentes/${bot.agenteId}/apps/${vagas.id}/restaurar`.replace(vagas.id, "00000000-0000-4000-8000-000000000000"));
      expect(fora.status).toBe(404);
      expect(fora.corpo).not.toHaveProperty("motivo");
    });
  });

  it("bot de outra pessoa é 404 (RLS) e o experimento desligado é 403", async () => {
    await withRollback(MARLON, async (trx) => {
      trxAtual = trx;
      const { d, bot } = await montar(trx);
      const app = (await criarDireto(d, bot.agenteId, "Vagas"))!;
      await trx.savepoint(async (sp) => {
        await vincularEscopo(sp, ANA);
        const da = depsSobreTrx(sp, ANA);
        await da.repos.preferencias.gravar({ experimentos: { quadro: true } });
        expect(await da.repos.appsDoBot.buscar(app.id)).toBeNull();
        expect(await da.repos.appsDoBot.doAgente(bot.agenteId)).toEqual([]);
      });
      const ana = await servidor.entrar("ana");
      expect((await servidor.chamar(ana, "GET", `/agentes/${bot.agenteId}/paginas`)).status).toBe(404);
      expect((await servidor.chamar(ana, "DELETE", `/agentes/${bot.agenteId}/apps/${app.id}`)).status).toBe(404);
      // O escopo da transação de teste volta para o Marlon (o savepoint e as rotas o trocaram).
      await vincularEscopo(trx, MARLON);
      expect(await d.repos.appsDoBot.buscar(app.id)).not.toBeNull();
      await d.repos.preferencias.gravar({ experimentos: { quadro: false } });
      const s = await servidor.entrar("marlon");
      expect((await servidor.chamar(s, "GET", `/agentes/${bot.agenteId}/paginas`)).status).toBe(403);
      expect((await executar(d, gerirApps, { ...(await turno(d, bot)), op: "listar" })).data).toMatchObject({ ok: false, erro: "experimento_desligado" });
    });
  });

  it("revisão 7 do #626: app de conector acende o pede você mesmo com o retrato de turno sujo (a regra estruturada decide no servidor)", async () => {
    await withRollback(MARLON, async (trx) => {
      trxAtual = trx;
      const { d, bot } = await montar(trx);
      const app = (await d.repos.appsDoBot.criar({ agenteId: bot.agenteId, nome: "Vagas", icone: "app", fonte: "conector", fonteRef: "gmail", forma: "lista", quemVe: "so_eu", regraPede: null }))!;
      // A regra entra num turno limpo, pela conversa ("acende quando a vaga está sem resposta há 2 dias").
      const regra = { coluna: "Sem resposta", dias_desde: 2 };
      expect((await executar(d, gerirApps, { ...(await turno(d, bot)), op: "editar", app: "Vagas", pede_quando: regra })).data).toMatchObject({ ok: true });
      // A rotina que lê o Gmail suja o turno (ADR-047); o retrato dela ainda acende pela regra, não pela marca do bot.
      const sujo = await turno(d, bot, { origem: "rotina" });
      await d.repos.turnos.contaminar(sujo.turnoId, Date.now());
      const DIA = 86_400_000;
      const dados = { itens: [
        { titulo: "Dev", coluna: "Sem resposta", desde: new Date(Date.now() - 3 * DIA).toISOString() },
        { titulo: "QA", coluna: "Respondida", desde: new Date(Date.now() - 5 * DIA).toISOString(), pede: true },
      ] };
      expect((await executar(d, gerirApps, { ...sujo, op: "editar", app: "Vagas", dados })).data).toMatchObject({ ok: true, apps: [{ pede_voce: true }] });
      const dto = (await paginas(d, bot.agenteId)).apps.find((a) => a.id === app.id)!;
      expect(dto.pedeVoce).toBe(true);
      expect(dto.dados?.itens.map((i) => [i.titulo, i.pede === true])).toEqual([["Dev", true], ["QA", false]]);
      // O turno sujo não troca a regra (nem a apaga): o conteúdo de fora não decide o que acende.
      for (const pede_quando of [{ coluna: "Respondida" }, null]) {
        expect((await executar(d, gerirApps, { ...(await turno(d, bot, { confianca: "nao_confiavel" })), op: "editar", app: "Vagas", pede_quando })).data).toMatchObject({ ok: false, erro: "entrada_invalida" });
      }
      expect((await d.repos.appsDoBot.buscar(app.id))?.pedeQuando).toEqual(regra);
      // Pelo card também: a regra estruturada vai no payload, a frase sai dela, e o Criar grava as duas.
      const p = await executar(d, proporApp, { ...(await turno(d, bot)), nome: "Contas", forma: "painel", pede_quando: { valor_acima: 1000 } });
      if (!p.data.ok) throw new Error(JSON.stringify(p.data));
      expect(p.data.payload).toMatchObject({ pedeQuando: { valor_acima: 1000 }, regraPede: "valor acima de 1000" });
      const c = await executar(d, EXECUTORES_APPS["paginas.criar_app"], { decisaoId: p.data.propostaId, recusar: false });
      expect(c.data.criado).toMatchObject({ pedeQuando: { valor_acima: 1000 }, regraPede: "valor acima de 1000", pedeVoce: false });
    });
  });

  it("QA do #626: mudar pede_quando troca a frase da regra; apagar a regra apaga a estruturada e o laranja", async () => {
    await withRollback(MARLON, async (trx) => {
      trxAtual = trx;
      const { d, bot } = await montar(trx);
      const app = (await criarDireto(d, bot.agenteId, "Vagas"))!;
      const editar = async (campos: Record<string, unknown>) => (await executar(d, gerirApps, { ...(await turno(d, bot)), op: "editar", app: "Vagas", ...campos })).data;
      const salvo = async () => d.repos.appsDoBot.buscar(app.id);
      expect(await editar({ pede_quando: { coluna: "Sem resposta" } })).toMatchObject({ ok: true });
      expect(await salvo()).toMatchObject({ regraPede: "coluna Sem resposta", pedeQuando: { coluna: "Sem resposta" } });
      // Só a estruturada muda: a frase antiga ("coluna Sem resposta") não fica na tela descrevendo a regra que saiu.
      expect(await editar({ pede_quando: { valor_acima: 1000 } })).toMatchObject({ ok: true });
      expect(await salvo()).toMatchObject({ regraPede: "valor acima de 1000", pedeQuando: { valor_acima: 1000 } });
      // Com a frase junto, vale a do bot (como no propor).
      expect(await editar({ pede_quando: { coluna: "Atrasada" }, regra_pede: "vaga atrasada" })).toMatchObject({ ok: true });
      expect(await salvo()).toMatchObject({ regraPede: "vaga atrasada", pedeQuando: { coluna: "Atrasada" } });
      expect(await editar({ dados: { itens: [{ titulo: "Dev", coluna: "Atrasada" }] } })).toMatchObject({ ok: true, apps: [{ pede_voce: true }] });
      // Apagar a regra em texto apaga a estruturada: sem regra, o laranja apaga.
      expect(await editar({ regra_pede: null })).toMatchObject({ ok: true, apps: [{ pede_voce: false }] });
      expect(await salvo()).toMatchObject({ regraPede: null, pedeQuando: null });
      // Tirar a estruturada sem frase nova também tira a frase.
      expect(await editar({ pede_quando: { coluna: "Atrasada" } })).toMatchObject({ ok: true });
      expect(await editar({ pede_quando: null })).toMatchObject({ ok: true, apps: [{ pede_voce: false }] });
      expect(await salvo()).toMatchObject({ regraPede: null, pedeQuando: null });
    });
  });

  it("revisão 7 do #626: em turno sujo, o bot só mexe na aparência dos próprios apps; os de outro bot recusam", async () => {
    await withRollback(MARLON, async (trx) => {
      trxAtual = trx;
      const { d, bot } = await montar(trx);
      const outro = await agenteComConversa(trx, MARLON, { nome: `Nina ${Math.random().toString(36).slice(2, 7)}` });
      const dela = (await criarDireto(d, outro.agenteId, "Vagas"))!;
      await criarDireto(d, bot.agenteId, "Minhas");
      const sujo = await turno(d, bot);
      await d.repos.turnos.contaminar(sujo.turnoId, Date.now());
      for (const campos of [{ nome: "Invadido" }, { icone: "estrela" }, { forma: "quadro" }]) {
        const r = await executar(d, gerirApps, { ...sujo, op: "editar", bot: outro.agenteId, app: "Vagas", ...campos });
        expect(r.data).toMatchObject({ ok: false, erro: "entrada_invalida" });
        expect(r.data.ok ? "" : r.data.instrucao).toMatch(/outro bot/);
      }
      expect(await d.repos.appsDoBot.buscar(dela.id)).toMatchObject({ nome: "Vagas", icone: "app", forma: "lista" });
      // O próprio app segue: nome, ícone e forma no turno sujo.
      expect((await executar(d, gerirApps, { ...sujo, op: "editar", app: "Minhas", nome: "Minhas 2", icone: "estrela", forma: "quadro" })).data).toMatchObject({ ok: true });
      // Limpo, a configuração do app de outro bot volta a valer.
      expect((await executar(d, gerirApps, { ...(await turno(d, bot)), op: "editar", bot: outro.agenteId, app: "Vagas", icone: "estrela" })).data).toMatchObject({ ok: true });
    });
  });

  it("revisão 7 do #626: o teto da ordem pedida é o mesmo do contrato (MAX_ORDEM_GUARDADA), na tela e no chat", async () => {
    await withRollback(MARLON, async (trx) => {
      trxAtual = trx;
      const { d, bot } = await montar(trx);
      expect(PROPRIEDADES_APPS.ordem.maxItems).toBe(MAX_ORDEM_GUARDADA);
      const demais = Array.from({ length: MAX_ORDEM_GUARDADA + 1 }, () => "conversa");
      await esperarErro(() => executar(d, EXECUTORES_APPS["paginas.ordenar"], { agenteId: bot.agenteId, ordem: demais }), "entrada_invalida");
      expect((await executar(d, gerirApps, { ...(await turno(d, bot)), op: "ordenar", ordem: demais })).data).toMatchObject({ ok: false, erro: "entrada_invalida" });
      expect((await executar(d, gerirApps, { ...(await turno(d, bot)), op: "ordenar", ordem: demais.slice(1) })).data).toMatchObject({ ok: true });
    });
  });
  it("ADA-9: \"coloque o quadro como sua view padrão\" pelo chat põe Tarefas em primeiro (a casa) e volta para a Conversa", async () => {
    await withRollback(MARLON, async (trx) => {
      trxAtual = trx;
      const { d, bot } = await montar(trx);
      await criarDireto(d, bot.agenteId, "Vagas");
      expect((await executar(d, aplicarLoteQuadro, { autor: { tipo: "pessoa" }, anfitriaoId: bot.agenteId, executor: "catcher", ops: [{ tipo: "criar_quadro" }] })).data).toMatchObject({ ok: true });
      expect(homeDoBot((await paginas(d, bot.agenteId)).ordem)).toBe(PAGINA_CONVERSA);
      // O que o prompt ensina (linha Tela inicial:): ordenar {pagina: "tarefas" | "quadro", posicao: 1}.
      for (const pagina of ["quadro", "tarefas"]) {
        // Cada volta parte da Conversa em primeiro: senão a segunda não moveria nada e passaria com o código errado.
        await executar(d, EXECUTORES_APPS["paginas.ordenar"], { agenteId: bot.agenteId, pagina: "conversa", posicao: 1 });
        expect(homeDoBot((await paginas(d, bot.agenteId)).ordem)).toBe(PAGINA_CONVERSA);
        const r = await executar(d, gerirApps, { ...(await turno(d, bot)), op: "ordenar", pagina, posicao: 1 });
        expect(r.data).toMatchObject({ ok: true, tela_inicial: "Tarefas" });
        if (!r.data.ok) throw new Error("ordenar");
        expect(r.data.paginas[0]).toEqual({ pagina: PAGINA_TAREFAS, nome: "Tarefas", posicao: 1 });
        expect(r.data.instrucao).toContain("Ao abrir o bot, Tarefas aparece primeiro");
        // Guardado no servidor: é o que a web lê para abrir o bot (irParaCasa abre na primeira página).
        expect(homeDoBot((await paginas(d, bot.agenteId)).ordem)).toBe(PAGINA_TAREFAS);
      }
      const volta = await executar(d, gerirApps, { ...(await turno(d, bot)), op: "ordenar", pagina: "conversa", posicao: 1 });
      expect(volta.data).toMatchObject({ ok: true, tela_inicial: "Conversa" });
      expect(homeDoBot((await paginas(d, bot.agenteId)).ordem)).toBe(PAGINA_CONVERSA);
      // Listar também diz a tela inicial, para o bot responder "o que abre primeiro?" sem adivinhar.
      expect((await executar(d, gerirApps, { ...(await turno(d, bot)), op: "listar" })).data).toMatchObject({ ok: true, tela_inicial: "Conversa" });
    });
  });

  it("ADA-9: bot sem quadro, \"abra no quadro\" recusa dizendo o caminho (criar o quadro) e nada muda", async () => {
    await withRollback(MARLON, async (trx) => {
      trxAtual = trx;
      const { d, bot } = await montar(trx);
      await criarDireto(d, bot.agenteId, "Vagas");
      const antes = (await paginas(d, bot.agenteId)).ordem;
      const pedidos = [
        { pagina: "quadro", posicao: 1 },
        { pagina: "Tarefas", posicao: 1 },
        { ordem: ["quadro", "conversa"] },
        { pagina: "Vagas", antes_de: "quadro" },
      ];
      for (const p of pedidos) {
        const r = await executar(d, gerirApps, { ...(await turno(d, bot)), op: "ordenar", ...p });
        expect(r.data).toMatchObject({ ok: false, erro: "nao_encontrado" });
        if (r.data.ok) throw new Error("devia recusar");
        expect(r.data.instrucao).toContain("ainda não tem quadro");
        expect(r.data.instrucao).toContain("gerir_quadro criar_quadro");
        expect(r.data.instrucao).not.toContain("confira o nome");
      }
      expect((await paginas(d, bot.agenteId)).ordem).toEqual(antes);
      // Revisão 1 do #648 (M1): a tela segue tolerante (ADR-146 §3): a ordem inteira com um "tarefas" velho (o quadro
      // saiu em outra aba) ignora o que sobra e grava, em vez de recusar o arrasto.
      const tela = await executar(d, EXECUTORES_APPS["paginas.ordenar"], { agenteId: bot.agenteId, ordem: ["tarefas", "conversa", ...antes.filter((x) => x !== "conversa")] });
      expect(tela.data.paginas.ordem).toEqual(["conversa", ...antes.filter((x) => x !== "conversa")]);
      // Página que não existe, sem ser o quadro, segue com a recusa de sempre.
      const outra = await executar(d, gerirApps, { ...(await turno(d, bot)), op: "ordenar", pagina: "Inexistente", posicao: 1 });
      if (outra.data.ok) throw new Error("devia recusar");
      expect(outra.data.instrucao).toContain("confira o nome");
    });
  });

  it("ADA-9 (revisão 1 do #648, M2): a view padrão de outro bot: sem quadro, a recusa manda criar o quadro DELE; com quadro, diz qual bot", async () => {
    await withRollback(MARLON, async (trx) => {
      trxAtual = trx;
      const { d, bot } = await montar(trx);
      const zeNome = `Ze ${Math.random().toString(36).slice(2, 7)}`;
      const ze = { ...(await agenteComConversa(trx, MARLON, { nome: zeNome })), nome: zeNome };
      const r = await executar(d, gerirApps, { ...(await turno(d, bot)), op: "ordenar", bot: ze.nome, pagina: "quadro", posicao: 1 });
      if (r.data.ok) throw new Error("devia recusar");
      expect(r.data.instrucao).toContain(`gerir_quadro criar_quadro e quadro: "${ze.nome}" (não no seu)`);
      // O do próprio bot não leva quadro: (criar_quadro sem quadro cria no próprio bot).
      const proprio = await executar(d, gerirApps, { ...(await turno(d, bot)), op: "ordenar", pagina: "quadro", posicao: 1 });
      if (proprio.data.ok) throw new Error("devia recusar");
      expect(proprio.data.instrucao).not.toContain("quadro: \"");
      expect((await executar(d, aplicarLoteQuadro, { autor: { tipo: "pessoa" }, anfitriaoId: ze.agenteId, executor: "catcher", ops: [{ tipo: "criar_quadro" }] })).data).toMatchObject({ ok: true });
      const ok = await executar(d, gerirApps, { ...(await turno(d, bot)), op: "ordenar", bot: ze.nome, pagina: "quadro", posicao: 1 });
      expect(ok.data).toMatchObject({ ok: true, tela_inicial: "Tarefas" });
      if (!ok.data.ok) throw new Error("ordenar");
      expect(ok.data.instrucao).toContain(`Ao abrir o ${ze.nome}, Tarefas aparece primeiro`);
      expect(homeDoBot((await paginas(d, ze.agenteId)).ordem)).toBe(PAGINA_TAREFAS);
      expect(homeDoBot((await paginas(d, bot.agenteId)).ordem)).toBe(PAGINA_CONVERSA);
    });
  });
});
