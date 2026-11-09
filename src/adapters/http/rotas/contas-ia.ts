import type { ContasIaDto } from "../../../contracts/contas-ia.ts";
import { ehIaComConta } from "../../../domain/contas-da-pessoa.ts";
import { apelidoValido } from "../../../domain/contas-da-ia.ts";
import { ErroDeDominio } from "../../../domain/erro.ts";
import { log } from "../../../obs/log.ts";
import { cifradoValido, PRAZO_DESCONEXAO_MS, type LoginsNaMaquina } from "../../../services/logins-na-maquina.ts";
import type { PareamentoDispositivo } from "../../../services/pareamento-dispositivo.ts";
import type { Escopo } from "../../../shared/types.ts";
import { assertUuid } from "../../../use-cases/apoio-l7.ts";
import { contasDaPessoa, removerConta, reordenarContas, seguirComConta, tentarDeNovoComConta } from "../../../use-cases/contas-ia.ts";
import type { Deps } from "../../../use-cases/tipos.ts";
import type { Rota } from "../roteador.ts";
import { revogarChaveMaquina } from "../../../use-cases/chaves-maquina.ts";
import { executar, type DentroDeTx } from "./dentro-de-tx.ts";
import { previaDeRemover, removerComputador } from "../../../use-cases/acoes/maquinas.ts";
import type { ResultadoRemoverDto } from "../../../contracts/remover-computador.ts";

/**
 * As contas de IA da pessoa em todas as máquinas (definido em 2026-10-13, ADR-102): a lista única de Provedores de IA, a
 * gestão (renomear, ordem, sair de uma máquina, remover, o modo no limite), o login de uma conta numa máquina pela tela,
 * o convite do comando de instalação e o nome/desconexão da máquina. Rotas de PESSOA (cookie).
 */
export type DepsRotasContas = {
  dentro: DentroDeTx;
  logins: LoginsNaMaquina;
  dispositivo: PareamentoDispositivo;
  /** false no modo local (ADR-092): a tela mostra a de antes (suposição 7 da ADR-102). */
  compartilhado: boolean;
  /** Publica `contas.mudou` para a tela reler. */
  avisar(escopo: Escopo, motivo: string, loginId?: string): void;
  /** A máquina está conectada agora (a ponte a ouviu no último minuto)? */
  maquinaViva(escopo: Escopo, id: string): boolean;
  /** ADA-245: a plataforma do computador ligado agora (o diálogo de remover escolhe o texto do Windows ou do Mac). */
  plataformaDaMaquina?(escopo: Escopo, id: string): string | null;
  /** NOD-9 (2026-10-23): a máquina conectada anunciou que atende o "Atualizar agora" remoto (o motor da VM). */
  maquinaAtualizaIas?(escopo: Escopo, id: string): boolean;
  /** A conexão viva da máquina passa a usar o nome novo (o prompt e "Rodar no X"). */
  aoRenomear?(escopo: Escopo, id: string, nome: string): void;
  /** ADA-245 (revisão do PR #694): NOD_ONBOARDING_TEXTO=1. Desligada, a prévia e o remover dão 404 (a jornada D é da flag). */
  onboardingTexto?: boolean;
};

/** A jornada D (remover o computador) só existe com a flag ligada: desligada, a rota responde como se não existisse. */
function exigirJornadaD(deps: DepsRotasContas): void {
  if (deps.onboardingTexto !== true) throw new ErroDeDominio("nao_encontrado", { cause: "remover computador desligado" });
}

/** A máquina existe, é da pessoa e não foi revogada. */
async function exigirMaquina(d: Deps, id: string | undefined): Promise<{ id: string; nome: string }> {
  const maquinaId = assertUuid(id, "máquina");
  const viva = (await d.repos.maquinaTokens.listar()).find((c) => c.id === maquinaId && c.revogadaEm === null);
  if (!viva) throw new ErroDeDominio("nao_encontrado", { cause: "máquina" });
  return { id: viva.id, nome: viva.nome };
}

export function rotasContasIa(deps: DepsRotasContas): Rota[] {
  return [
    {
      metodo: "GET",
      padrao: /^\/contas-ia$/,
      async handler(ctx) {
        const r: ContasIaDto = deps.compartilhado
          ? { disponivel: true, ...(await deps.dentro(ctx.escopo, (d) => contasDaPessoa(d))) }
          : { disponivel: false, modo: "perguntar", contas: [] };
        ctx.json(200, r);
      },
    },
    {
      metodo: "PUT", acao: "contas_ia.ordenar",
      padrao: /^\/contas-ia\/ordem$/,
      async handler(ctx) {
        const corpo = (await ctx.corpo()) as { ids?: unknown };
        if (!Array.isArray(corpo.ids) || corpo.ids.length > 50) throw new ErroDeDominio("entrada_invalida", { cause: "ids" });
        const ids = corpo.ids.map((id) => assertUuid(id, "conta"));
        await deps.dentro(ctx.escopo, (d) => reordenarContas(d, ids));
        deps.avisar(ctx.escopo, "ordem");
        ctx.json(204, null);
      },
    },
    {
      metodo: "PUT", acao: "contas_ia.mudar_modo",
      padrao: /^\/contas-ia\/modo$/,
      async handler(ctx) {
        const corpo = (await ctx.corpo()) as { modo?: unknown };
        if (corpo.modo !== "perguntar" && corpo.modo !== "automatico") throw new ErroDeDominio("entrada_invalida", { cause: "modo" });
        const modo = corpo.modo;
        await deps.dentro(ctx.escopo, (d) => d.repos.contasIa.definirModo(modo));
        log("info", "contas_modo", { pessoa_id: ctx.escopo.pessoaId, modo });
        deps.avisar(ctx.escopo, "modo");
        ctx.json(204, null);
      },
    },
    {
      metodo: "PATCH", acao: "contas_ia.editar",
      padrao: /^\/contas-ia\/(?<id>[^/]+)$/,
      async handler(ctx) {
        const id = assertUuid(ctx.params.id, "conta");
        const corpo = (await ctx.corpo()) as { apelido?: unknown; entraNaTrocaAutomatica?: unknown };
        const apelido = corpo.apelido === undefined ? undefined : apelidoValido(corpo.apelido);
        if (apelido === null) throw new ErroDeDominio("entrada_invalida", { cause: "apelido" });
        if (corpo.entraNaTrocaAutomatica !== undefined && typeof corpo.entraNaTrocaAutomatica !== "boolean") throw new ErroDeDominio("entrada_invalida", { cause: "entraNaTrocaAutomatica" });
        const ok = await deps.dentro(ctx.escopo, async (d) => {
          if (apelido !== undefined && !(await d.repos.contasIa.renomear(id, apelido))) return false;
          if (typeof corpo.entraNaTrocaAutomatica === "boolean" && !(await d.repos.contasIa.definirTrocaAutomatica(id, corpo.entraNaTrocaAutomatica))) return false;
          return true;
        });
        if (!ok) throw new ErroDeDominio("nao_encontrado", { cause: "conta" });
        deps.avisar(ctx.escopo, "conta");
        ctx.json(204, null);
      },
    },
    {
      metodo: "POST", acao: "contas_ia.sair",
      padrao: /^\/contas-ia\/(?<id>[^/]+)\/sair$/,
      async handler(ctx) {
        const id = assertUuid(ctx.params.id, "conta");
        const corpo = (await ctx.corpo()) as { maquinaId?: unknown };
        const ok = await deps.dentro(ctx.escopo, async (d) => d.repos.contasIa.pedirSaida(id, (await exigirMaquina(d, corpo.maquinaId as string | undefined)).id, d.agora()));
        if (!ok) throw new ErroDeDominio("nao_encontrado", { cause: "conta nesta máquina" });
        log("info", "conta_saida_pedida", { pessoa_id: ctx.escopo.pessoaId, conta_id: id });
        deps.avisar(ctx.escopo, "sair");
        ctx.json(202, { ok: true });
      },
    },
    {
      // NOD-293 C11 (definido em 2026-10-20): o que para se a pessoa sair da conta (numa máquina) ou removê-la. Só lê.
      metodo: "GET",
      padrao: /^\/contas-ia\/(?<id>[^/]+)\/frentes-ativas$/,
      async handler(ctx) {
        const id = assertUuid(ctx.params.id, "conta");
        const bruto = new URL(ctx.req.url ?? "/", "http://127.0.0.1").searchParams.get("maquinaId");
        const maquinaId = bruto === null ? null : assertUuid(bruto, "máquina");
        const lista = await deps.dentro(ctx.escopo, async (d) => {
          if (!(await d.repos.contasIa.buscar(id))) throw new ErroDeDominio("nao_encontrado", { cause: "conta" });
          return d.repos.contasIa.frentesAtivas(id, maquinaId);
        });
        ctx.json(200, lista);
      },
    },
    {
      metodo: "DELETE", acao: "contas_ia.remover",
      padrao: /^\/contas-ia\/(?<id>[^/]+)$/,
      async handler(ctx) {
        const id = assertUuid(ctx.params.id, "conta");
        await deps.dentro(ctx.escopo, (d) => removerConta(d, id));
        log("info", "conta_removida", { pessoa_id: ctx.escopo.pessoaId, conta_id: id });
        deps.avisar(ctx.escopo, "remover");
        ctx.json(202, { ok: true });
      },
    },
    {
      metodo: "POST", acao: "contas_ia.seguir",
      padrao: /^\/contas-ia\/(?<id>[^/]+)\/seguir$/,
      async handler(ctx) {
        const contaId = assertUuid(ctx.params.id, "conta");
        const corpo = (await ctx.corpo()) as { conversaId?: unknown; turnoId?: unknown };
        const conversaId = assertUuid(corpo.conversaId, "conversa");
        // NOD-284: o turno da nota (o botão novo); sem ele, o botão antigo acha a última nota da conversa.
        const turnoId = corpo.turnoId === undefined || corpo.turnoId === null ? null : assertUuid(corpo.turnoId, "turno");
        const r = await deps.dentro(ctx.escopo, (d) => executar(d, (dd, i) => seguirComConta(dd, i), { contaId, conversaId, turnoId }));
        deps.avisar(ctx.escopo, "seguir");
        ctx.json(202, r);
      },
    },
    {
      // NOD-280 (definido em 2026-10-15): "Tentar de novo com <conta>" — na nota (com o turno) ou em Provedores (sem).
      metodo: "POST", acao: "contas_ia.tentar_de_novo",
      padrao: /^\/contas-ia\/(?<id>[^/]+)\/tentar-de-novo$/,
      async handler(ctx) {
        const contaId = assertUuid(ctx.params.id, "conta");
        const corpo = (await ctx.corpo()) as { conversaId?: unknown; turnoId?: unknown };
        const turnoId = corpo.turnoId === undefined || corpo.turnoId === null ? null : assertUuid(corpo.turnoId, "turno");
        const conversaId = turnoId === null ? null : assertUuid(corpo.conversaId, "conversa");
        const r = await deps.dentro(ctx.escopo, (d) => executar(d, (dd, i) => tentarDeNovoComConta(dd, i), { contaId, conversaId, turnoId }));
        deps.avisar(ctx.escopo, "tentar_de_novo");
        ctx.json(202, r);
      },
    },
    // ── O login de uma conta numa máquina pela tela (ADR-102 item 3) ──────────────────────────────────────────────────
    {
      metodo: "POST", acao: "contas_ia.entrar",
      padrao: /^\/maquinas\/(?<id>[^/]+)\/logins$/,
      async handler(ctx) {
        const corpo = (await ctx.corpo()) as { ia?: unknown; contaId?: unknown; apelido?: unknown };
        if (!ehIaComConta(corpo.ia)) throw new ErroDeDominio("entrada_invalida", { cause: "ia" });
        const ia = corpo.ia;
        const apelido = corpo.apelido === undefined || corpo.apelido === null ? null : apelidoValido(corpo.apelido);
        if (corpo.apelido !== undefined && corpo.apelido !== null && apelido === null) throw new ErroDeDominio("entrada_invalida", { cause: "apelido" });
        const { maquina, conta } = await deps.dentro(ctx.escopo, async (d) => {
          const m = await exigirMaquina(d, ctx.params.id);
          if (corpo.contaId === undefined || corpo.contaId === null) return { maquina: m, conta: null };
          const c = await d.repos.contasIa.buscar(assertUuid(corpo.contaId, "conta"));
          if (!c || c.removidaEm !== null || c.ia !== ia) throw new ErroDeDominio("nao_encontrado", { cause: "conta" });
          return { maquina: m, conta: c };
        });
        const login = deps.logins.pedir({ escopo: ctx.escopo, maquinaId: maquina.id, ia, contaId: conta?.id ?? null, impressao: conta?.impressao ?? null, apelido: conta?.apelido ?? apelido });
        if (!login) { ctx.json(429, { codigo: "muitos_pedidos", mensagem: "Você já tem logins demais abertos. Termine ou cancele um deles." }); return; }
        log("info", "login_na_maquina_pedido", { pessoa_id: ctx.escopo.pessoaId, maquina_id: maquina.id, login_id: login.id, ia, conta_id: conta?.id ?? null });
        deps.avisar(ctx.escopo, "login", login.id);
        ctx.json(201, login);
      },
    },
    {
      metodo: "GET",
      padrao: /^\/maquinas\/(?<id>[^/]+)\/logins\/(?<login>[^/]+)$/,
      async handler(ctx) {
        const login = deps.logins.ver(ctx.escopo, assertUuid(ctx.params.login, "login"));
        if (!login || login.maquinaId !== ctx.params.id) throw new ErroDeDominio("nao_encontrado", { cause: "login" });
        ctx.json(200, login);
      },
    },
    {
      metodo: "POST", acao: "contas_ia.codigo_do_login",
      padrao: /^\/maquinas\/(?<id>[^/]+)\/logins\/(?<login>[^/]+)\/codigo$/,
      async handler(ctx) {
        const corpo = (await ctx.corpo()) as { cifrado?: unknown };
        const cifrado = cifradoValido(corpo.cifrado);
        if (!cifrado) throw new ErroDeDominio("entrada_invalida", { cause: "código cifrado" });
        const loginId = assertUuid(ctx.params.login, "login");
        const atual = deps.logins.ver(ctx.escopo, loginId);
        if (!atual || atual.maquinaId !== ctx.params.id) throw new ErroDeDominio("nao_encontrado", { cause: "login" });
        const r = deps.logins.colarCodigo(ctx.escopo, loginId, cifrado);
        if (r !== "ok") { ctx.json(409, { codigo: r }); return; }
        deps.avisar(ctx.escopo, "login", loginId);
        ctx.json(202, { ok: true });
      },
    },
    {
      metodo: "POST", acao: "contas_ia.cancelar_login",
      padrao: /^\/maquinas\/(?<id>[^/]+)\/logins\/(?<login>[^/]+)\/cancelar$/,
      async handler(ctx) {
        const loginId = assertUuid(ctx.params.login, "login");
        const atual = deps.logins.ver(ctx.escopo, loginId);
        if (!atual || atual.maquinaId !== ctx.params.id) throw new ErroDeDominio("nao_encontrado", { cause: "login" });
        deps.logins.cancelar(ctx.escopo, loginId);
        deps.avisar(ctx.escopo, "login", loginId);
        ctx.json(202, { ok: true });
      },
    },
    // ── Atualizar a IA de uma máquina pela tela (definido em 2026-10-22, NOD-9) ─────────────────────────────────────────
    {
      // O botão "Atualizar agora" da VM ou do Mac visto de outro aparelho: o pedido fica em memória e a máquina o recebe
      // uma vez, na próxima puxada (`atualizar`). O andamento volta pelo anúncio (Inventario.atualizacao). Fora do ar, 409:
      // o pedido venceria antes de alguém puxá-lo.
      metodo: "POST", acao: "maquinas.atualizar_ia",
      padrao: /^\/maquinas\/(?<id>[^/]+)\/ias\/(?<ia>[^/]+)\/atualizar$/,
      async handler(ctx) {
        const ia = ctx.params.ia;
        if (!ehIaComConta(ia)) throw new ErroDeDominio("entrada_invalida", { cause: "ia" });
        const maquina = await deps.dentro(ctx.escopo, (d) => exigirMaquina(d, ctx.params.id));
        if (!deps.maquinaViva(ctx.escopo, maquina.id)) {
          ctx.json(409, { codigo: "maquina_sem_contato", mensagem: `${maquina.nome} não está conectada agora. Abra o nod nela e tente de novo.` });
          return;
        }
        // Só quem anunciou `atualizaIas` puxa o pedido; para os outros ele ficaria em memória sem ninguém atender.
        if (!deps.maquinaAtualizaIas?.(ctx.escopo, maquina.id)) {
          ctx.json(409, { codigo: "maquina_sem_atualizacao", mensagem: `${maquina.nome} não atualiza a IA por aqui. Atualize no próprio aparelho.` });
          return;
        }
        deps.logins.pedirAtualizacao(ctx.escopo, maquina.id, ia);
        log("info", "ia_atualizar_pedido", { pessoa_id: ctx.escopo.pessoaId, maquina_id: maquina.id, ia });
        deps.avisar(ctx.escopo, "atualizar");
        ctx.json(202, { ok: true });
      },
    },
    // ── A máquina: nome, desconexão e o convite do comando de instalação ─────────────────────────────────────────────
    {
      metodo: "PATCH", acao: "maquinas.editar",
      padrao: /^\/maquinas\/(?<id>[^/]+)$/,
      async handler(ctx) {
        const corpo = (await ctx.corpo()) as { nome?: unknown };
        const nome = typeof corpo.nome === "string" ? corpo.nome.replace(/\s+/g, " ").trim() : "";
        if (nome.length === 0 || nome.length > 60) throw new ErroDeDominio("entrada_invalida", { cause: "nome da máquina" });
        const id = assertUuid(ctx.params.id, "máquina");
        if (!(await deps.dentro(ctx.escopo, (d) => d.repos.maquinaTokens.renomear(id, nome)))) throw new ErroDeDominio("nao_encontrado", { cause: "máquina" });
        deps.aoRenomear?.(ctx.escopo, id, nome);
        deps.avisar(ctx.escopo, "maquina");
        ctx.json(200, { id, nome });
      },
    },
    {
      metodo: "POST", acao: "maquinas.desconectar",
      padrao: /^\/maquinas\/(?<id>[^/]+)\/desconectar$/,
      async handler(ctx) {
        const corpo = (await ctx.corpo()) as { sairDasContas?: unknown };
        const sair = corpo.sairDasContas === true;
        const id = assertUuid(ctx.params.id, "máquina");
        const viva = deps.maquinaViva(ctx.escopo, id);
        const r = await deps.dentro(ctx.escopo, async (d) => {
          const m = await exigirMaquina(d, id);
          // Com "Sair também das contas" e a máquina no ar, ela recebe o pedido na próxima puxada, sai das contas e para;
          // a chave é revogada quando ela confirma e, de todo jeito, vence em PRAZO_DESCONEXAO_MS (revisão do PR #306:
          // antes dependia só da máquina confirmar). Fora do ar (ou sem a caixa), a chave é revogada agora.
          const contas = sair ? await d.repos.contasIa.pedirSaidaDeTodas(m.id, d.agora()) : 0;
          if (!sair || !viva) await executar(d, revogarChaveMaquina, { id: m.id });
          else await d.repos.maquinaTokens.vencerEm(m.id, d.agora() + PRAZO_DESCONEXAO_MS);
          return { maquina: m, contas };
        });
        if (sair && viva) deps.logins.pedirDesconexao(ctx.escopo, id);
        log("info", "maquina_desconectada", { pessoa_id: ctx.escopo.pessoaId, maquina_id: id, sair_das_contas: sair, no_ar: viva, contas: r.contas });
        deps.avisar(ctx.escopo, "maquina");
        ctx.json(202, { ok: true, contas: r.contas, aguardandoMaquina: sair && viva });
      },
    },
    {
      // ADA-245 (jornada D): o que o diálogo "Remover o nod deste computador" mostra antes — os bots de lá e quem assume.
      metodo: "GET",
      padrao: /^\/maquinas\/(?<id>[^/]+)\/remover\/previa$/,
      async handler(ctx) {
        exigirJornadaD(deps);
        const id = assertUuid(ctx.params.id, "máquina");
        const viva = deps.maquinaViva(ctx.escopo, id);
        const plataforma = deps.plataformaDaMaquina?.(ctx.escopo, id) ?? null;
        ctx.json(200, await deps.dentro(ctx.escopo, (d) => previaDeRemover(d, id, viva, plataforma)));
      },
    },
    {
      // ADA-245: o executor único (o card do chat chama o mesmo). `daqui` = o app deste computador já se limpou (a ponte
      // removerDaqui roda ANTES, com a conexão ainda valendo): a chave cai agora e não vai pedido na puxada.
      metodo: "POST", acao: "maquinas.remover",
      padrao: /^\/maquinas\/(?<id>[^/]+)\/remover$/,
      async handler(ctx) {
        exigirJornadaD(deps);
        const corpo = ((await ctx.corpo()) ?? {}) as { manterIas?: unknown; manterConexao?: unknown; daqui?: unknown };
        if (typeof corpo.manterIas !== "boolean" || typeof corpo.manterConexao !== "boolean") throw new ErroDeDominio("entrada_invalida", { cause: "manterIas e manterConexao" });
        const id = assertUuid(ctx.params.id, "máquina");
        const daqui = corpo.daqui === true;
        const viva = deps.maquinaViva(ctx.escopo, id);
        const r = await deps.dentro(ctx.escopo, (d) => executar(d, removerComputador, { maquinaId: id, manterIas: corpo.manterIas as boolean, manterConexao: corpo.manterConexao as boolean, daqui }));
        // O mesmo critério do efeito depois do commit (compor.ts, removerDepoisDoCommit): ligado, a limpeza vai na puxada;
        // desligado com "Continuar ligado", o pedido espera ele ligar; desligado saindo da conta, a chave cai e nada se limpa.
        const dto: ResultadoRemoverDto = { ...r, aguardandoComputador: !daqui && deps.compartilhado && (viva || (corpo.manterConexao as boolean)) };
        log("info", "computador_remover", { pessoa_id: ctx.escopo.pessoaId, maquina_id: id, daqui, no_ar: viva, bots: dto.bots.length, saiu_da_conta: dto.saiuDaConta });
        deps.avisar(ctx.escopo, "maquina");
        ctx.json(200, dto);
      },
    },
    {
      metodo: "POST", acao: "maquinas.convidar",
      padrao: /^\/maquinas\/convites$/,
      async handler(ctx) {
        // NOD-94: `{papel: "computador"}` = o comando manual da instalação por SSH ("Prefere fazer você mesmo?"): a máquina
        // pareia como só computador, sem a tela confirmar (o convite é de uso único e só a pessoa o vê). `substituir` só
        // quando ela já disse "Substituir" na tela. Sem corpo, o convite de sempre (ADR-102).
        const corpo = (await ctx.corpo()) as Record<string, unknown> | null;
        const computador = corpo?.papel === "computador";
        ctx.json(201, deps.dispositivo.criarConvite(ctx.escopo, computador ? { papel: "computador", autoAprovar: true, substituir: corpo?.substituir === true } : undefined));
      },
    },
    {
      metodo: "GET",
      padrao: /^\/maquinas\/convites\/(?<convite>[^/]+)$/,
      async handler(ctx) {
        const r = deps.dispositivo.verConvite({ convite: decodeURIComponent(ctx.params.convite ?? ""), escopo: ctx.escopo });
        if (r.estado === "invalido") { ctx.json(404, { codigo: "convite_invalido" }); return; }
        if (r.estado === "conflito") { ctx.json(409, { codigo: "convite_em_conflito" }); return; }
        ctx.json(200, r);
      },
    },
  ];
}

