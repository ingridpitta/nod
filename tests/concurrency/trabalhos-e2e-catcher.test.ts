import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { criarCatcherDriver } from "../../src/adapters/executor/drivers/catcher.ts";
import type { Driver } from "../../src/adapters/executor/spi.ts";
import type { ConversaDto, RespostaMutacao } from "../../src/contracts/api.ts";
import type { Agente } from "../../src/contracts/agente.ts";
import type { Conversa } from "../../src/contracts/conversa.ts";
import type { FrameSse } from "../../src/contracts/frame.ts";
import { CAPACIDADES_HARNESS } from "../../src/contracts/harness.ts";
import type { PlanoTurno } from "../../src/contracts/plano-turno.ts";
import type { TrabalhoDetalheDto, TrabalhoDto, TrabalhosDto } from "../../src/contracts/trabalho.ts";
import type { Turno } from "../../src/contracts/turno.ts";
import { vincularEscopo } from "../../src/db/tx.ts";
import type { Tx } from "../../src/shared/types.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { servidorCompleto, type ServidorCompleto } from "../helpers/servidor-completo.ts";
import { limparPessoaE2E } from "./limpeza-e2e.ts";

/**
 * E2E com o catcher dos trabalhos em paralelo (ADR-083, épico #188): servidor completo, laços reais, SSE e o catcher com
 * `[[espera: ms]]` (uma ferramenta longa) e `[[sessao: uuid]]` (a sessão que o "CLI" devolve).
 *
 * definido em 2026-10-08: o catcher entra no papel do Claude Code — registrado como `claude-cli`, com as capacidades de
 * `CAPACIDADES_HARNESS["claude-cli"]` e a sessão viva ligada. Assim o plano sai pelo caminho de produção (harness
 * escolhido, `capacidadesDe`, sessão por harness, pasta do trabalho, `bifurcar`) e só a execução é falsa. O catcher puro
 * (sem harness no plano) cai em SEM_CAPACIDADES na rede de 2 min e nunca seria promovido; o caminho "sem a capacidade"
 * está provado em tests/integration/trabalhos-sessao.test.ts e tests/unit/domain/trabalho.test.ts.
 */
type PlanoVisto = { plano: PlanoTurno; em: number };
type Bot = { agenteId: string; conversaId: string };

/** O catcher registrado como o Claude Code: cada plano recebido fica em `planos`, com a hora. */
function catcherNoPapelDoClaude(urlNod: string, planos: PlanoVisto[]): Driver {
  const base = criarCatcherDriver({ urlNod, sessaoViva: true });
  return {
    meta: { id: "claude-cli", locality: "local", capacidades: CAPACIDADES_HARNESS["claude-cli"] },
    async create(cfg) {
      const inst = await base.create(cfg);
      return {
        sondar: async () => ({ estado: "pronto", versao: "catcher-como-claude", em: Date.now() }),
        dispose: () => inst.dispose(),
        adapter(plano) {
          planos.push({ plano, em: Date.now() });
          return inst.adapter(plano);
        },
      };
    },
  };
}

type Ctx = ReturnType<typeof ajudantes>;

function ajudantes(srv: ServidorCompleto, frames: FrameSse[], planos: PlanoVisto[], criados: { agentes: string[]; conversas: string[] }) {
  const json = <T>(metodo: string, caminho: string, corpo?: unknown) => srv.json<T>(metodo, caminho, corpo);
  const turno = (id: string) => json<{ turno: Turno }>("GET", `turnos/${id}`).then((r) => r.turno);
  const conversa = (id: string) => json<ConversaDto>("GET", `conversas/${id}/mensagens`);
  const trabalhos = (agenteId: string) => json<TrabalhosDto>("GET", `trabalhos?agenteId=${agenteId}`);
  const trabalho = (id: string) => json<TrabalhoDetalheDto>("GET", `trabalhos/${id}`).then((r) => r.trabalho);
  const registros = () => json<{ registros: { turnoId: string; tipo: string; dados: Record<string, unknown> }[] }>("GET", "dev/catcher").then((r) => r.registros);
  /** Diagnóstico de uma espera que estourou: turnos e trabalhos do bot (nunca passa em silêncio). */
  const diagnostico = async (bot: Bot) => {
    const dto = await conversa(bot.conversaId);
    const ts = (await trabalhos(bot.agenteId)).trabalhos.map((t) => [t.titulo, t.origem, t.estado, t.turnoVivoId?.slice(0, 8) ?? null]);
    return JSON.stringify({ mensagens: dto.mensagens.map((m) => [m.kind, m.autoria.autor_tipo, m.texto.slice(0, 60)]), pendentes: dto.turnosPendentes, trabalhos: ts }, null, 1);
  };
  return {
    srv,
    frames,
    planos,
    json,
    turno,
    conversa,
    trabalhos,
    trabalho,
    registros,
    async criarBot(nome: string): Promise<Bot> {
      const r = await json<{ agente: Agente; conversa: Conversa }>("POST", "agentes", { dono: "pessoa", nome });
      criados.agentes.push(r.agente.id);
      criados.conversas.push(r.conversa.id);
      return { agenteId: r.agente.id, conversaId: r.conversa.id };
    },
    async enviar(conversaId: string, texto: string): Promise<string> {
      return (await json<RespostaMutacao>("POST", `conversas/${conversaId}/mensagens`, { texto })).ids.turno ?? "";
    },
    esperarTurno(id: string, estados: Turno["estado"][] = ["concluido"], timeoutMs = 20_000) {
      return srv.esperar(async () => {
        const t = await turno(id);
        return estados.includes(t.estado) ? t : null;
      }, { nome: `turno ${id.slice(0, 8)} em ${estados.join("|")}`, timeoutMs });
    },
    esperarTrabalho(id: string, pred: (t: TrabalhoDto) => boolean, nome: string, timeoutMs = 30_000) {
      return srv.esperar(async () => {
        const t = await trabalho(id);
        return pred(t) ? t : null;
      }, { nome, timeoutMs });
    },
    /** O plano que o "CLI" recebeu para o turno (o catcher no papel do Claude guarda todos). */
    planoDe(turnoId: string): Promise<PlanoVisto> {
      return srv.esperar(async () => planos.find((p) => p.plano.turnoId === turnoId) ?? null, { nome: `plano de ${turnoId.slice(0, 8)}`, timeoutMs: 20_000 });
    },
    async comDiagnostico<T>(bot: Bot, fn: () => Promise<T>): Promise<T> {
      try {
        return await fn();
      } catch (e) {
        throw new Error(`${e instanceof Error ? e.message : String(e)}\n${await diagnostico(bot)}`);
      }
    },
    /** Leitura direta como a pessoa: só o que nenhuma rota mostra (a sessão do trabalho fica fora do DTO). */
    async comoPessoa<T>(fn: (trx: Tx) => Promise<T>): Promise<T> {
      const caixa: { valor?: T } = {};
      await srv.db.begin(async (trx) => {
        await vincularEscopo(trx, { tenantId: srv.pessoa.tenantId, pessoaId: srv.pessoa.pessoaId });
        caixa.valor = await fn(trx);
      });
      return caixa.valor as T;
    },
  };
}

/** Sobe o servidor completo com o catcher no papel do Claude e escuta o SSE da pessoa. */
async function subir(o: { nomePessoa: string; env?: Record<string, string>; redeMs?: number }): Promise<{ ctx: Ctx; descer: () => Promise<void> }> {
  const planos: PlanoVisto[] = [];
  const frames: FrameSse[] = [];
  const criados = { agentes: [] as string[], conversas: [] as string[] };
  const srv = await servidorCompleto({
    nomePessoa: o.nomePessoa,
    env: { NOD_EXECUTOR: "claude-cli", NOD_MODELO: "auto", ...(o.env ?? {}) },
    redeMs: o.redeMs,
    drivers: ({ urlNod }) => [catcherNoPapelDoClaude(urlNod, planos)],
  });
  const sse = new AbortController();
  const res = await fetch(`${srv.url}/api/t/${srv.pessoa.tenantId}/eventos`, { headers: { cookie: srv.pessoa.cookie }, signal: sse.signal });
  expect(res.status).toBe(200);
  void (async () => {
    const reader = res.body?.getReader();
    const dec = new TextDecoder();
    let buffer = "";
    if (!reader) return;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += dec.decode(value, { stream: true });
        const blocos = buffer.split("\n\n");
        buffer = blocos.pop() ?? "";
        for (const bloco of blocos) {
          const linhas = bloco.split("\n");
          // `event: ping` (NOD-254) é sinal de vida, não frame.
          if (linhas.includes("event: ping")) continue;
          const linha = linhas.find((l) => l.startsWith("data: "));
          if (linha) frames.push(JSON.parse(linha.slice(6)) as FrameSse);
        }
      }
    } catch {
      // abort no fim
    }
  })();
  const ctx = ajudantes(srv, frames, planos, criados);
  // ADR-085: o servidor sobe com o amostrador de verdade e, num Mac carregado, seguraria e espaçaria a rotina e o pedido
  // de colega — que é outro assunto (tests/concurrency/uso-do-mac-ponte.test.ts). Aqui os bots usam o Mac o quanto precisarem.
  await ctx.json("PUT", "preferencias", { usoDoMac: "livre" });
  return {
    ctx,
    async descer() {
      sse.abort();
      await srv.fechar();
      await limparPessoaE2E(srv.db, srv.dbDono, { tenantId: srv.pessoa.tenantId, pessoaId: srv.pessoa.pessoaId }, criados);
      await srv.desligar();
    },
  };
}

const sufixo = () => randomUUID().slice(0, 8);
/**
 * O marcador que abre a task com o pedido (que leva o roteiro dela). revisto em 2026-10-12 (ADR-099, I2): o catálogo do
 * dono tem `abrir_frentes` (um lote de uma frente aqui); `abrir_task` ficou só como sinônimo fora do catálogo.
 */
const abrirTask = (titulo: string, pedido: string) => `[[tool: abrir_frentes ${JSON.stringify({ frentes: [{ titulo, pedido }] })}]]`;

describeIntegracao("e2e com catcher: trabalhos em paralelo (#192, #193, #194)", () => {
  describe("a conversa coordena", () => {
    let c: Ctx;
    let descer: (() => Promise<void>) | null = null;

    beforeAll(async () => {
      const s = await subir({ nomePessoa: `E2E trabalhos ${sufixo()}` });
      c = s.ctx;
      descer = s.descer;
    }, 30_000);

    afterAll(async () => {
      await descer?.();
    }, 30_000);

    it("#192 (revisto pela ADR-099, I7): rotina e pedido de colega entram pela triagem do dono, que abre uma frente para cada; com a da pessoa, as três rodam juntas ([[espera]] nas três) e a mensagem da conversa é respondida enquanto elas rodam", { timeout: 90_000 }, async () => {
      // definido em 2026-10-08: 20 s seguram os três rodando enquanto o teste abre os outros e conversa (sob carga, ~5 s).
      const ESPERA = 20_000;
      const dev = await c.criarBot("Dev");
      const chico = await c.criarBot("Chico");

      const rotina = (agenteId: string, instrucao: string) => c.json<RespostaMutacao>("POST", "rotinas", {
        agenteId, cron: "0 8 * * *", fusoIana: "America/Sao_Paulo", instrucao,
        fonte: "as mensagens desta conversa", entregavel: "um resumo curto", limitesAprovacao: "nada sai sem aprovação", politicaSemDado: "diga que não houve",
      });
      const executar = async (rotinaId: string | undefined) => (await c.json<RespostaMutacao>("POST", `rotinas/${rotinaId}/executar`)).ids.turnoId ?? "";
      // revisto em 2026-10-12 (ADR-099, I7 revista): a rotina e o pedido de colega viram turnos curtos de triagem na conversa
      // do Dev (sem trabalho); em cada um, o dono abre uma frente com o roteiro longo.
      const daRotina = await executar((await rotina(dev.agenteId, `Triagem das mensagens da manhã ${abrirTask("Triagem da manhã", `faça a triagem [[espera: ${ESPERA}]] [[texto: Triagem feita.]]`)} [[texto: Abri a frente da triagem.]]`)).ids.rotinaId);
      expect(daRotina).toBeTruthy();
      expect(await c.turno(daRotina)).toMatchObject({ origem: "rotina", trabalhoId: null, conversaId: dev.conversaId });
      // O pedido do Chico sai da rotina dele: a fala de uma pessoa iria junto, literal, para a entrada do Dev, e o catcher do
      // Dev leria nela o próprio `[[tool: pedir_a_bot …]]` (definido em 2026-10-08: o roteiro do Dev é só o pedido).
      const pedido = await executar((await rotina(chico.agenteId, `Peça a revisão ao Dev. [[tool: pedir_a_bot ${JSON.stringify({ agente: "Dev", pedido: `revise o PR 481 ${abrirTask("PR 481", `revise o PR 481 [[espera: ${ESPERA}]] [[texto: PR 481 revisado]]`)} [[texto: Abri a frente do PR 481.]]` })}]] [[texto: Pedi ao Dev.]]`)).ids.rotinaId);
      await c.esperarTurno(pedido);
      const abertura = await c.enviar(dev.conversaId, `Monte o dashboard. ${abrirTask("Dashboard de churn", `monte o dashboard de churn [[espera: ${ESPERA}]] [[texto: Dashboard pronto]]`)} [[texto: Abri a task do dashboard.]]`);
      await c.esperarTurno(abertura);

      // As três frentes rodando JUNTAS: um turno vivo em cada uma, do mesmo bot.
      const tres = await c.comDiagnostico(dev, () => c.srv.esperar(async () => {
        const ts = (await c.trabalhos(dev.agenteId)).trabalhos;
        return ts.length === 3 && ts.every((t) => t.estado === "rodando" && t.turnoVivoId !== null) ? ts : null;
      }, { nome: "três trabalhos rodando juntos", timeoutMs: 30_000 }));
      expect(new Set(tres.map((t) => t.origem))).toEqual(new Set(["rotina", "colega", "pessoa"]));
      expect(tres.map((t) => t.forma)).toEqual(["frente", "frente", "frente"]);
      expect(tres.find((t) => t.origem === "colega")?.pedidoPorNome).toBe("Chico");
      const vivos = await Promise.all(tres.map((t) => c.turno(t.turnoVivoId!)));
      expect(vivos.map((t) => t.estado)).toEqual(["despachando", "despachando", "despachando"]);
      expect(new Set(vivos.map((t) => t.agenteId))).toEqual(new Set([dev.agenteId]));

      // A conversa não espera nenhum deles.
      const fala = await c.enviar(dev.conversaId, "e aí, como vai? [[texto: Tudo certo por aqui.]]");
      const respondida = await c.esperarTurno(fala, ["concluido"], 10_000);
      const respondidaEm = Date.now();
      expect(respondida).toMatchObject({ origem: "conversa", trabalhoId: null });
      const ainda = await Promise.all(vivos.map((t) => c.turno(t.id)));
      expect(ainda.map((t) => t.estado), "os três ainda rodam quando a conversa responde").toEqual(["despachando", "despachando", "despachando"]);
      const dto = await c.conversa(dev.conversaId);
      expect(dto.mensagens.find((m) => m.turnoId === fala && m.autoria.autor_tipo === "agente")?.texto).toBe("Tudo certo por aqui.");

      // E os três terminam, cada um com o seu resultado.
      const finais = await c.srv.esperar(async () => {
        const ts = (await c.trabalhos(dev.agenteId)).trabalhos;
        return ts.length === 3 && ts.every((t) => t.estado === "terminado") ? ts : null;
      }, { nome: "três trabalhos terminados", timeoutMs: ESPERA + 20_000 });
      expect(finais.map((t) => t.terminadoEm! > respondidaEm)).toEqual([true, true, true]);
    });

    it("#192: duas tasks do mesmo bot terminam com sessões ([[sessao]]) e pastas diferentes; a retomada de cada uma volta na sessão dela", { timeout: 90_000 }, async () => {
      const ada = await c.criarBot("Ada");
      const [s1, s2] = [randomUUID(), randomUUID()];
      const abertura = await c.enviar(ada.conversaId, `Duas tasks iguais. ${abrirTask("Login do app", `faça o login [[sessao: ${s1}]] [[texto: Login feito]]`)} ${abrirTask("Login do app", `faça o login de novo [[sessao: ${s2}]] [[texto: Login refeito]]`)} [[texto: Abri as duas.]]`);
      await c.esperarTurno(abertura);
      const [a, b] = await c.comDiagnostico(ada, () => c.srv.esperar(async () => {
        const ts = (await c.trabalhos(ada.agenteId)).trabalhos.filter((t) => t.titulo === "Login do app");
        return ts.length === 2 && ts.every((t) => t.estado === "terminado") ? [...ts].sort((x, y) => x.criadoEm - y.criadoEm) : null;
      }, { nome: "duas tasks terminadas", timeoutMs: 20_000 }));
      // Mesmo título, pastas diferentes (slug + 6 caracteres do id), dentro da pasta do bot.
      expect(a!.pasta).toMatch(/^~\/nod\/[^/]+\/login-do-app-[a-z0-9]{6}$/);
      expect(b!.pasta).toMatch(/^~\/nod\/[^/]+\/login-do-app-[a-z0-9]{6}$/);
      expect(a!.pasta).not.toBe(b!.pasta);

      // A sessão de cada uma ficou no TRABALHO dela (fora do DTO), e a conversa continua sem sessão.
      const sessoes = await c.comoPessoa((trx) => trx<{ id: string; sessao_cli: string | null; sessao_harness: string | null }[]>`select id, sessao_cli, sessao_harness from trabalhos where agente_id = ${ada.agenteId}`);
      const sessaoDe = (id: string) => sessoes.find((x) => x.id === id);
      expect(new Set([sessaoDe(a!.id)?.sessao_cli, sessaoDe(b!.id)?.sessao_cli])).toEqual(new Set([s1, s2]));
      expect(sessaoDe(a!.id)?.sessao_harness).toBe("claude-cli");
      expect((await c.conversa(ada.conversaId)).conversa.sessaoCli).toBeNull();

      // O primeiro turno de cada uma rodou na pasta dela, sem sessão.
      for (const t of [a!, b!]) {
        const primeiro = (await c.comoPessoa((trx) => trx<{ id: string }[]>`select id from turnos where trabalho_id = ${t.id} order by criado_em limit 1`))[0]!;
        const { plano } = await c.planoDe(primeiro.id);
        expect(plano.pastaDoBot).toBe(t.pasta!.slice("~/nod/".length));
        expect(plano.entrada.sessaoCli).toBeNull();
      }

      // A pessoa escreve em cada task: a retomada volta na sessão DAQUELA task e na pasta dela.
      for (const t of [a!, b!]) {
        const r = await c.json<RespostaMutacao>("POST", `trabalhos/${t.id}/mensagens`, { texto: "e o logout? [[texto: Logout feito]]" });
        const retomada = await c.esperarTurno(r.ids.turno ?? "");
        expect(retomada).toMatchObject({ origem: "retomada", trabalhoId: t.id });
        const { plano } = await c.planoDe(retomada.id);
        expect(plano.entrada.sessaoCli).toBe(sessaoDe(t.id)?.sessao_cli);
        expect(plano.entrada.bifurcar).toBeUndefined();
        expect(plano.pastaDoBot).toBe(t.pasta!.slice("~/nod/".length));
      }
    });

    it("#193: \"monta o dashboard de churn\" durante uma task abre uma segunda task (abrir_task no roteiro); \"Fazer depois\" grava depois_de e ela espera a primeira terminar", { timeout: 120_000 }, async () => {
      // definido em 2026-10-08: a primeira roda 25 s; a segunda, 8 s — o botão é apertado com ela já rodando (o laço a pega
      // em ~1 s, antes de a pessoa ler a linha), que é o caso de verdade.
      const [ESPERA_1, ESPERA_2] = [25_000, 8_000];
      const leo = await c.criarBot("Leo");
      const t1 = await c.enviar(leo.conversaId, `Migre os relatórios. ${abrirTask("Migrar relatórios", `migre os relatórios [[espera: ${ESPERA_1}]] [[texto: Relatórios migrados]]`)} [[texto: Abri a task.]]`);
      await c.esperarTurno(t1);
      const primeira = await c.comDiagnostico(leo, () => c.srv.esperar(async () => (await c.trabalhos(leo.agenteId)).trabalhos.find((t) => t.titulo === "Migrar relatórios" && t.estado === "rodando") ?? null, { nome: "primeira task rodando", timeoutMs: 15_000 }));

      const t2 = await c.enviar(leo.conversaId, `monta o dashboard de churn ${abrirTask("Dashboard de churn", `monte o dashboard de churn [[espera: ${ESPERA_2}]] [[texto: Dashboard pronto]]`)} [[texto: Abri a task do dashboard.]]`);
      await c.esperarTurno(t2);
      // A linha "Começou a frente" da segunda, com o payload que a tela usa para o botão "Fazer depois da …".
      const segunda = await c.comDiagnostico(leo, () => c.srv.esperar(async () => (await c.trabalhos(leo.agenteId)).trabalhos.find((t) => t.titulo === "Dashboard de churn" && t.turnoVivoId !== null) ?? null, { nome: "segunda task rodando", timeoutMs: 15_000 }));
      expect((await c.conversa(leo.conversaId)).mensagens.some((m) => m.kind === "sistema" && m.payload?.kind === "frentes_abertas" && m.payload.frentes.some((f) => f.trabalhoId === segunda.id))).toBe(true);
      const turnoInicial = segunda.turnoVivoId!;

      // "Fazer depois da Migrar relatórios" com a segunda já rodando: ela para e o pedido volta à fila dela.
      const depois = await c.json<{ trabalho: TrabalhoDto }>("POST", `trabalhos/${segunda.id}/depois`, { depoisDe: primeira.id });
      expect(depois.trabalho).toMatchObject({ depoisDeTrabalhoId: primeira.id, estado: "na_fila" });
      const espera = await c.esperarTrabalho(segunda.id, (t) => t.turnoVivoId === null, "segunda task sem turno vivo", 10_000);
      expect(espera).toMatchObject({ estado: "na_fila", depoisDeTrabalhoId: primeira.id });
      expect(await c.turno(turnoInicial)).toMatchObject({ estado: "interrompido", motivoInterrupcao: "parado_pela_pessoa" });
      expect((await c.trabalho(primeira.id)).estado, "a primeira ainda roda").toBe("rodando");

      // Enquanto a primeira roda, a segunda não roda; quando ela termina, a segunda refaz o pedido e termina.
      const fim1 = await c.esperarTrabalho(primeira.id, (t) => t.estado === "terminado", "primeira task terminada", ESPERA_1 + 15_000);
      const fim2 = await c.esperarTrabalho(segunda.id, (t) => t.estado === "terminado", "segunda task terminada", ESPERA_2 + 15_000);
      const turnos2 = await c.comoPessoa((trx) => trx<{ id: string; estado: string; motivo_interrupcao: string | null; entrada_texto: string }[]>`select id, estado, motivo_interrupcao, entrada_texto from turnos where trabalho_id = ${segunda.id} order by criado_em`);
      expect(turnos2.map((t) => [t.estado, t.motivo_interrupcao])).toEqual([["interrompido", "parado_pela_pessoa"], ["concluido", null]]);
      expect(turnos2[1]?.entrada_texto).toBe(turnos2[0]?.entrada_texto);
      const refeito = await c.planoDe(turnos2[1]!.id);
      expect(refeito.em).toBeGreaterThanOrEqual(fim1.terminadoEm!);
      expect(fim2.terminadoEm!).toBeGreaterThan(fim1.terminadoEm!);
      expect((await c.conversa(leo.conversaId)).mensagens.some((m) => m.turnoId === turnos2[1]?.id && m.texto === "Dashboard pronto")).toBe(true);
    });

    it("#193: mandar_para_task com a task rodando chega no meio do turno dela (renovação com aceitaMensagens) e nunca no da conversa", { timeout: 90_000 }, async () => {
      const ESPERA = 15_000;
      const lia = await c.criarBot("Lia");
      // definido em 2026-10-08 (revisão do épico): a espera em duas metades. O catcher responde à mensagem do meio no começo
      // do passo SEGUINTE; com uma espera só, a resposta saía colada no fim do turno (medido: 39 ms entre a fala e a
      // entrega) e a leitura do "ainda rodando" abaixo virava sorteio, nas duas formas da absorção (#189 e a antiga).
      const t1 = await c.enviar(lia.conversaId, `Monte o relatório. ${abrirTask("Relatório de vendas", `monte o relatório [[tool: lembrar {"texto":"relatório de vendas"}]] [[espera: ${ESPERA / 2}]] [[espera: ${ESPERA / 2}]] [[texto: Relatório pronto]]`)} [[texto: Abri a task.]]`);
      await c.esperarTurno(t1);
      const task = await c.comDiagnostico(lia, () => c.srv.esperar(async () => (await c.trabalhos(lia.agenteId)).trabalhos.find((t) => t.estado === "rodando" && t.turnoVivoId !== null) ?? null, { nome: "task rodando", timeoutMs: 15_000 }));
      const turnoDaTask = task.turnoVivoId!;

      // A conversa repassa um recado e fica rodando 4 s depois (a sessão dela também aceita mensagem nesse tempo).
      const recado = await c.enviar(lia.conversaId, `Avise a task de incluir março. [[tool: mandar_para_frente ${JSON.stringify({ trabalho_id: task.id, texto: "inclua março" })}]] [[espera: 4000]] [[texto: Repassei para a task.]]`);
      const resposta = "Respondendo: [nod] Recado da conversa com a pessoa, repassado por você: inclua março";
      const fala = await c.comDiagnostico(lia, () => c.srv.esperar(async () => {
        const dto = await c.conversa(lia.conversaId);
        return dto.mensagens.find((m) => m.kind === "texto" && m.autoria.autor_tipo === "agente" && m.texto === resposta) ?? null;
      }, { nome: "a task respondeu ao recado", timeoutMs: 20_000 }));
      // Fala do turno DA TASK, gravada com ele ainda rodando.
      expect(fala.turnoId).toBe(turnoDaTask);
      expect((await c.turno(turnoDaTask)).estado).toBe("despachando");

      const conversaFeita = await c.esperarTurno(recado);
      expect(conversaFeita).toMatchObject({ estado: "concluido", trabalhoId: null });
      // A ferramenta disse que entrou no meio.
      const regs = await c.registros();
      const doRecado = regs.filter((r) => r.turnoId === recado);
      expect(doRecado.find((r) => r.tipo === "tool_use")?.dados).toMatchObject({ nome: "mandar_para_frente" });
      expect(doRecado.find((r) => r.tipo === "tool_result")?.dados).toMatchObject({ isError: false });
      // Só o turno da task recebeu a mensagem no meio; o da conversa, nunca.
      expect(regs.filter((r) => r.tipo === "mensagem_no_meio").map((r) => r.turnoId)).toEqual([turnoDaTask]);
      // O turno do recado (faixa da task) entrou no turno vivo dela e não virou turno próprio.
      const doRecadoNaTask = await c.comoPessoa((trx) => trx<{ id: string; estado: string; motivo_interrupcao: string | null; absorvido_por: string | null }[]>`select id, estado, motivo_interrupcao, absorvido_por from turnos where trabalho_id = ${task.id} and id <> ${turnoDaTask}`);
      expect(doRecadoNaTask).toEqual([expect.objectContaining({ estado: "interrompido", motivo_interrupcao: "absorvido", absorvido_por: turnoDaTask })]);

      const fim = await c.esperarTrabalho(task.id, (t) => t.estado === "terminado", "task terminada", ESPERA + 15_000);
      expect(fim.estado).toBe("terminado");
      // A resposta vem antes do resultado da task, no turno dela.
      const textos = [...(await c.conversa(lia.conversaId)).mensagens].sort((x, y) => x.criadoEm - y.criadoEm).filter((m) => m.turnoId === turnoDaTask && m.kind === "texto").map((m) => m.texto);
      expect(textos.indexOf(resposta)).toBeGreaterThanOrEqual(0);
      expect(textos.indexOf(resposta)).toBeLessThan(textos.indexOf("Relatório pronto"));
    });
  });

  describe("a rede de 2 min (prazo do e2e: 3 s)", () => {
    /** definido em 2026-10-08: REDE_MS (120 s) encolhida pela opção `redeMs` do servidorCompleto; a escala da issue é 150/120/130 s. */
    const REDE_MS_E2E = 3_000;
    let c: Ctx;
    let descer: (() => Promise<void>) | null = null;

    beforeAll(async () => {
      const s = await subir({ nomePessoa: `E2E rede ${sufixo()}`, redeMs: REDE_MS_E2E });
      c = s.ctx;
      descer = s.descer;
    }, 30_000);

    afterAll(async () => {
      await descer?.();
    }, 30_000);

    it("#193: turno de conversa com ferramenta de 150 s ([[espera: 150000]]) vira task aos 120 s; uma mensagem aos 130 s é despachada em até 5 s com entrada.bifurcar", { timeout: 90_000 }, async () => {
      const ESPERA = 15_000;
      const rui = await c.criarBot("Rui");
      const [s0, s1] = [randomUUID(), randomUUID()];
      // A conversa já tem sessão (o turno longo a retoma; é ela que vai para o trabalho promovido).
      await c.esperarTurno(await c.enviar(rui.conversaId, `oi [[sessao: ${s0}]] [[texto: Oi!]]`));
      expect((await c.conversa(rui.conversaId)).conversa.sessaoCli).toBe(s0);

      const longo = await c.enviar(rui.conversaId, `levanta os números do trimestre [[tool: lembrar {"texto":"números do trimestre"}]] [[espera: ${ESPERA}]] [[sessao: ${s0}]] [[texto: Números levantados.]]`);
      const planoLongo = await c.planoDe(longo);
      expect(planoLongo.plano.entrada.sessaoCli).toBe(s0);

      // Promovido na renovação depois do prazo: o turno ganha o trabalho `rede`, com a sessão da conversa.
      const promovido = await c.comDiagnostico(rui, () => c.srv.esperar(async () => {
        const t = await c.turno(longo);
        return t.trabalhoId ? { t, em: Date.now() } : null;
      }, { nome: "turno promovido pela rede", timeoutMs: 15_000 }));
      expect(promovido.em - planoLongo.em).toBeGreaterThanOrEqual(REDE_MS_E2E);
      expect(promovido.t.estado).toBe("despachando");
      const rede = await c.trabalho(promovido.t.trabalhoId!);
      expect(rede).toMatchObject({ origem: "rede", estado: "rodando", turnoVivoId: longo });
      const [linha] = await c.comoPessoa((trx) => trx<{ sessao_cli: string | null }[]>`select sessao_cli from trabalhos where id = ${rede.id}`);
      expect(linha?.sessao_cli).toBe(s0);
      expect((await c.conversa(rui.conversaId)).mensagens.some((m) => m.kind === "sistema" && m.payload?.kind === "trabalho_aberto" && m.payload.trabalhoId === rede.id && m.payload.origem === "rede")).toBe(true);

      // "Aos 130 s": a mensagem nova vira turno de conversa próprio em ≤ 5 s, numa cópia da sessão (bifurcar).
      const enviadaEm = Date.now();
      const nova = await c.enviar(rui.conversaId, `e o outro assunto? [[sessao: ${s1}]] [[texto: Respondido na conversa.]]`);
      const planoNova = await c.planoDe(nova);
      expect(planoNova.em - enviadaEm).toBeLessThanOrEqual(5_000);
      expect(planoNova.plano.entrada).toMatchObject({ sessaoCli: s0, bifurcar: true });
      expect((await c.turno(longo)).estado, "o promovido segue rodando").toBe("despachando");
      const respondida = await c.esperarTurno(nova);
      // Não foi absorvida pelo promovido: rodou como turno de conversa, e o id novo virou a sessão da conversa.
      expect(respondida).toMatchObject({ origem: "conversa", trabalhoId: null, estado: "concluido" });
      expect((await c.registros()).filter((r) => r.tipo === "mensagem_no_meio" && r.turnoId === longo)).toEqual([]);
      expect((await c.conversa(rui.conversaId)).conversa.sessaoCli).toBe(s1);

      // O promovido termina como trabalho; a sessão dele fica no trabalho, e a conversa segue na cópia.
      await c.esperarTrabalho(rede.id, (t) => t.estado === "terminado", "trabalho rede terminado", ESPERA + 15_000);
      expect((await c.conversa(rui.conversaId)).conversa.sessaoCli).toBe(s1);
    });
  });

  describe("memória do Mac (NOD_SIMULAR_PRESSAO no laço)", () => {
    /** Abre uma task de 8 s e espera ela terminar; devolve o trabalho e os frames `memoria.mudou`. */
    async function taskSobPressao(nivel: "2" | "4") {
      const s = await subir({ nomePessoa: `E2E memória ${nivel} ${sufixo()}`, env: { NOD_SIMULAR_PRESSAO: nivel } });
      try {
        const c = s.ctx;
        const bot = await c.criarBot("Mel");
        const abertura = await c.enviar(bot.conversaId, `Faça a planilha. ${abrirTask("Planilha de custos", "faça a planilha [[tool: lembrar {\"texto\":\"planilha\"}]] [[espera: 8000]] [[texto: Planilha pronta]]")} [[texto: Abri a task.]]`);
        await c.esperarTurno(abertura);
        const rodando = await c.comDiagnostico(bot, () => c.srv.esperar(async () => (await c.trabalhos(bot.agenteId)).trabalhos.find((t) => t.estado === "rodando") ?? null, { nome: "task rodando", timeoutMs: 15_000 }));
        // A pressão chega na renovação seguinte (a primeira leitura do amostrador ainda é a inicial).
        const pressao = await c.srv.esperar(async () => (await c.trabalhos(bot.agenteId)).pressao ?? null, { nome: "pressão lida", timeoutMs: 15_000 });
        const fim = await c.esperarTrabalho(rodando.id, (t) => !["na_fila", "rodando"].includes(t.estado), "task acabou", 30_000);
        const turnos = await c.comoPessoa((trx) => trx<{ estado: string; motivo_interrupcao: string | null }[]>`select estado, motivo_interrupcao from turnos where trabalho_id = ${rodando.id}`);
        const fechou = (await c.conversa(bot.conversaId)).mensagens.some((m) => m.kind === "sistema" && m.texto.startsWith("Fechei a task"));
        // O outbox publica com atraso de uma passada: o frame da mudança já saiu quando a task terminou.
        const frames = c.frames.filter((f) => f.tipo === "memoria.mudou").map((f) => f.dados.nivel);
        return { pressao, fim, turnos, fechou, frames };
      } finally {
        await s.descer();
      }
    }

    it("#194: com NOD_SIMULAR_PRESSAO=2 no laço, abrir uma task publica memoria.mudou amarela uma vez; com 4, nenhuma task rodando é encerrada", { timeout: 120_000 }, async () => {
      const amarela = await taskSobPressao("2");
      expect(amarela.pressao).toBe("amarela");
      expect(amarela.frames).toEqual(["amarela"]);
      expect(amarela.fim.estado).toBe("terminado");

      const vermelha = await taskSobPressao("4");
      expect(vermelha.pressao).toBe("vermelha");
      expect(vermelha.frames).toEqual(["vermelha"]);
      // Vermelha só avisa: a task rodando vai até o fim, nunca é parada nem fechada.
      expect(vermelha.fim.estado).toBe("terminado");
      expect(vermelha.turnos).toEqual([{ estado: "concluido", motivo_interrupcao: null }]);
      expect(vermelha.fechou).toBe(false);
    });
  });
});
