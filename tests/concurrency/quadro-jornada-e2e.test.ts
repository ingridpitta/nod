import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { criarCatcherDriver } from "../../src/adapters/executor/drivers/catcher.ts";
import type { ConversaDto, RespostaMutacao } from "../../src/contracts/api.ts";
import type { Agente } from "../../src/contracts/agente.ts";
import type { Conversa } from "../../src/contracts/conversa.ts";
import type { FrameSse } from "../../src/contracts/frame.ts";
import type { QuadroDto, TarefaDto } from "../../src/contracts/quadro.ts";
import type { Turno } from "../../src/contracts/turno.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { servidorCompleto, type ServidorCompleto } from "../helpers/servidor-completo.ts";
import { limparPessoaE2E } from "./limpeza-e2e.ts";

/**
 * NOD-442 (definido em 2026-10-31): o roteiro 1–9 da jornada completa, em UM teste, sobre o servidor COMPLETO com o
 * catcher (zero custo, roda no CI). Os bots "pensam" pelos marcadores do roteiro do catcher (tests/helpers/catcher-
 * roteiro.ts): o pedido da pessoa traz os da Ada; a descrição de cada tarefa traz os do bot responsável (o turno que a
 * tarefa abre leva a descrição); a resposta da pessoa no bloqueio traz os da volta. Cada gerir_quadro passa pela mesma
 * rota interna que o CLI real usaria. Ninguém mexe no quadro "à mão" além de responder ao bloqueio (passo 6) e do
 * Desfazer (passo 8, opcional na história).
 *
 * Começa por um bot COMUM (a Ada), não pelo Nod; o Beto mexe no mesmo quadro sem ser o anfitrião. Dois fluxos SSE da
 * mesma pessoa fazem o papel de dois aparelhos: os dois veem cada `quadro.mudou`.
 */

const NOME_PESSOA = `E2E Quadro ${randomUUID().slice(0, 8)}`;
const JORNADA_MS = 120_000;
const PR_A = "https://github.com/gamefik/nod/pull/9001";
const PR_B = "https://github.com/gamefik/nod/pull/9002";
const gerir = (acoes: unknown[]) => `[[tool: gerir_quadro ${JSON.stringify({ acoes })}]]`;

describeIntegracao("e2e com catcher: a jornada do quadro-agente, da meta ao merge (NOD-442)", () => {
  let srv: ServidorCompleto;
  const aparelhos: { frames: FrameSse[]; parar: AbortController }[] = [];
  const criados = { agentes: [] as string[], conversas: [] as string[] };

  const json = <T>(metodo: string, caminho: string, corpo?: unknown) => srv.json<T>(metodo, caminho, corpo);
  const turno = (id: string) => json<{ turno: Turno }>("GET", `turnos/${id}`).then((r) => r.turno);
  const rodar = async (conversaId: string, texto: string): Promise<Turno> => {
    const r = await json<RespostaMutacao>("POST", `conversas/${conversaId}/mensagens`, { texto });
    const id = r.ids.turno ?? "";
    return srv.esperar(async () => { const t = await turno(id); return t.estado === "concluido" || t.estado === "interrompido" ? t : null; }, { nome: `turno ${id}`, timeoutMs: 20_000 });
  };
  const criarBot = async (nome: string) => {
    const r = await json<{ agente: Agente; conversa: Conversa }>("POST", "agentes", { dono: "pessoa", nome });
    criados.agentes.push(r.agente.id);
    criados.conversas.push(r.conversa.id);
    return { agenteId: r.agente.id, conversaId: r.conversa.id };
  };
  const quadro = (agenteId: string) => json<{ quadro: QuadroDto | null }>("GET", `agentes/${agenteId}/quadro`).then((r) => r.quadro);
  const tarefa = (q: QuadroDto | null, titulo: string): TarefaDto | undefined => q?.tarefas.find((t) => t.titulo === titulo);
  /** Espera o quadro chegar num estado (os turnos que as tarefas abrem rodam no fundo). */
  const quando = (agenteId: string, nome: string, pred: (q: QuadroDto) => boolean, timeoutMs = 30_000) =>
    srv.esperar(async () => { const q = await quadro(agenteId); return q && pred(q) ? q : null; }, { nome, timeoutMs, intervaloMs: 150 }).catch(async (e) => {
      throw new Error(`${e instanceof Error ? e.message : String(e)}\n${JSON.stringify((await quadro(agenteId))?.tarefas.map((t) => [t.titulo, t.status, t.execucao, t.agenteNome]))}`);
    });
  /** Um aparelho aberto: o fluxo SSE da pessoa, como o app. */
  const abrirAparelho = async () => {
    const parar = new AbortController();
    const frames: FrameSse[] = [];
    const res = await fetch(`${srv.url}/api/t/${srv.pessoa.tenantId}/eventos`, { headers: { cookie: srv.pessoa.cookie }, signal: parar.signal });
    expect(res.status).toBe(200);
    void (async () => {
      const reader = res.body?.getReader();
      if (!reader) return;
      const dec = new TextDecoder();
      let buffer = "";
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += dec.decode(value, { stream: true });
          const blocos = buffer.split("\n\n");
          buffer = blocos.pop() ?? "";
          for (const bloco of blocos) {
            const linhas = bloco.split("\n");
            if (linhas.includes("event: ping")) continue;
            const linha = linhas.find((l) => l.startsWith("data: "));
            if (linha) frames.push(JSON.parse(linha.slice(6)) as FrameSse);
          }
        }
      } catch {
        // abort no afterAll
      }
    })();
    aparelhos.push({ frames, parar });
    return frames;
  };

  beforeAll(async () => {
    srv = await servidorCompleto({
      nomePessoa: NOME_PESSOA,
      env: { NOD_LONGPOLL_MS: "300", NOD_PRAZO_DECISAO_MS: "86400000" },
      drivers: ({ urlNod }) => [criarCatcherDriver({ urlNod, atrasoMs: 5 })],
    });
    await abrirAparelho();
    await abrirAparelho();
  }, 30_000);

  afterAll(async () => {
    for (const a of aparelhos) a.parar.abort();
    if (srv) {
      await srv.fechar();
      await limparPessoaE2E(srv.db, srv.dbDono, { tenantId: srv.pessoa.tenantId, pessoaId: srv.pessoa.pessoaId }, criados);
      await srv.desligar();
    }
  }, 30_000);

  it("roteiro 1–9: a meta no chat da Ada vira quadro, as tarefas começam sozinhas, o bloqueio se resolve no card, o PR fecha no merge e a meta se cumpre", { timeout: JORNADA_MS }, async () => {
    await json("PUT", "preferencias", { experimentos: { quadro: true } });
    const ada = await criarBot("Ada");
    const beto = await criarBot("Beto");

    // 1–3. No chat de um bot comum, a pessoa diz o que quer; a Ada cria o quadro com meta e prazo, quebra em tarefas e
    // puxa a que já existe no Linear (o servidor não fala com o Linear: o bot passa o item).
    const descA = [
      gerir([{ tipo: "mudar_tarefa", tarefa: "Seção de planos", status: "voce", pergunta: "Planos em reais ou em dólares?" }]),
      "[[texto: Travei numa decisão; perguntei no card.]]",
    ].join("\n");
    const descB = [
      gerir([{ tipo: "mudar_tarefa", tarefa: "NOD-900", pr_url: PR_B }]),
      gerir([{ tipo: "mudar_tarefa", tarefa: "NOD-900", status: "feito" }]),
      "[[texto: PR mergeado; NOD-900 feita.]]",
    ].join("\n");
    const t1 = await rodar(ada.conversaId, [
      "Quero lançar as seções novas até sexta.",
      gerir([
        { tipo: "criar_quadro", meta: "Lançar as seções novas", prazo: "2026-11-06" },
        { tipo: "criar_tarefa", titulo: "Seção de planos", descricao: descA },
        { tipo: "importar_linear", itens: [{ identificador: "NOD-900", titulo: "Seção de depoimentos", url: "https://linear.app/gamefik/issue/NOD-900", descricao: descB }] },
      ]),
      "[[texto: Criei o quadro com 2 tarefas.]]",
    ].join("\n"));
    expect(t1.estado).toBe("concluido");
    let q = await quadro(ada.agenteId);
    expect(q).toMatchObject({ meta: "Lançar as seções novas", prazo: "2026-11-06", agenteNome: "Ada", total: 2, feitas: 0, cumpridoEm: null });
    expect(tarefa(q, "Seção de depoimentos")).toMatchObject({ linearId: "NOD-900", agenteId: null });
    // NOD-416: criada sem status vai para o Backlog e não aciona ninguém.
    expect(tarefa(q, "Seção de planos")).toMatchObject({ status: "backlog", agenteId: null, linearId: null });
    const quadroId = q!.id;

    // 4. Cada tarefa vai para o bot certo e começa sozinha (em A fazer com responsável → Fazendo, com um turno dele).
    const t4 = await rodar(ada.conversaId, [
      "Distribui e começa.",
      gerir([
        { tipo: "mudar_tarefa", tarefa: "Seção de planos", agente: "Beto", status: "afazer" },
        { tipo: "mudar_tarefa", tarefa: "NOD-900", agente: "Ada", status: "afazer" },
      ]),
      "[[texto: O Beto pega os planos e eu os depoimentos.]]",
    ].join("\n"));
    expect(t4.estado).toBe("concluido");

    // 5–7. Ao vivo: o Beto trava e pergunta (ADR-162: a tarefa fica na coluna, esperando a pessoa); a Ada abre o PR (Em revisão) e o fecha
    // no merge (Feito) — tudo pelos turnos que as próprias tarefas abriram.
    q = await quando(ada.agenteId, "planos em voce e depoimentos feito", (x) => tarefa(x, "Seção de planos")?.esperaPessoa === true && tarefa(x, "Seção de depoimentos")?.status === "feito");
    expect(tarefa(q, "Seção de planos")).toMatchObject({ agenteNome: "Beto", pergunta: "Planos em reais ou em dólares?" });
    expect(tarefa(q, "Seção de depoimentos")).toMatchObject({ agenteNome: "Ada", prUrl: PR_B });
    expect(q.cumpridoEm).toBeNull();

    // 8. A qualquer momento, outro bot (o Beto, no chat dele) mexe no quadro da Ada; a pessoa desfaz pelo Desfazer.
    const t8 = await rodar(beto.conversaId, ["Põe uma tarefa de revisar os textos.", gerir([{ tipo: "criar_tarefa", titulo: "Revisar os textos" }]), "[[texto: Pus no Backlog.]]"].join("\n"));
    expect(t8.estado).toBe("concluido");
    q = await quadro(ada.agenteId);
    expect(tarefa(q, "Revisar os textos")).toMatchObject({ status: "backlog", agenteId: null });
    const desfeito = await json<{ ok: true; desfeito: boolean; quadro: QuadroDto }>("POST", `agentes/${ada.agenteId}/quadro/lotes/${q!.ultimoLote!.id}/desfazer`);
    expect(desfeito.desfeito).toBe(true);
    expect(tarefa(desfeito.quadro, "Revisar os textos")).toBeUndefined();

    // 6. A única ação da pessoa: responder ao bloqueio no card. O Beto volta a andar, abre o PR e fecha no merge.
    const planos = tarefa(q, "Seção de planos")!;
    const resposta = ["Em reais.", gerir([{ tipo: "mudar_tarefa", tarefa: planos.id, pr_url: PR_A }]), gerir([{ tipo: "mudar_tarefa", tarefa: planos.id, status: "feito" }]), "[[texto: PR mergeado.]]"].join("\n");
    await json("POST", `agentes/${ada.agenteId}/quadro/tarefas/${planos.id}/resposta`, { resposta });

    // 9. No fim, a meta cumprida com o resumo do que foi feito.
    q = await quando(ada.agenteId, "meta cumprida", (x) => x.cumpridoEm !== null);
    expect(q).toMatchObject({ feitas: 2, total: 2 });
    expect(tarefa(q, "Seção de planos")).toMatchObject({ status: "feito", prUrl: PR_A, resposta: expect.stringContaining("Em reais.") });
    expect(q.resumo).toEqual(expect.stringContaining("2 de 2 tarefas feitas"));

    // Ao vivo em outro aparelho: os dois fluxos receberam as mudanças do quadro, de quem quer que tenha feito.
    for (const frames of aparelhos.map((a) => a.frames)) {
      const doQuadro = frames.filter((f) => f.tipo === "quadro.mudou" && f.dados.quadroId === quadroId);
      expect(doQuadro.length).toBeGreaterThanOrEqual(6);
      expect(new Set(doQuadro.map((f) => f.dados.autor))).toEqual(new Set(["agente", "pessoa"]));
    }

    // A conversa da Ada guarda o pedido e as respostas (é a mesma conversa que a pílula do quadro mostra).
    const conversaAda = await json<ConversaDto>("GET", `conversas/${ada.conversaId}/mensagens`);
    expect(conversaAda.mensagens.map((m) => m.texto)).toEqual(expect.arrayContaining([expect.stringContaining("Criei o quadro"), expect.stringContaining("PR mergeado; NOD-900 feita.")]));
  });
});
