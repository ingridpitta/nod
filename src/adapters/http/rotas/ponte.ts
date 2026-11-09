import { HARNESSES } from "../../../contracts/harness.ts";
import type { CapacidadesHarness, IdHarness } from "../../../contracts/harness.ts";
import { setTimeout as esperar } from "node:timers/promises";
import type { Inventario } from "../../../contracts/inventario.ts";
import type { DetalheDaIaNaMaquina } from "../../../contracts/maquina.ts";
import type { PlanoTurno } from "../../../contracts/plano-turno.ts";
import type { LeituraMemoria } from "../../../contracts/trabalho.ts";
import { PAPEIS_MAQUINA, PLATAFORMAS_MAQUINA, type AnuncioMaquina, type PapelMaquina, type PlataformaMaquina, type VigiaVivo } from "../../../contracts/ponte.ts";
import type { SubagenteVivo, TarefaDoBot } from "../../../contracts/turno.ts";
import type { ContaAnunciada, ProgressoDoLogin, PuxadaDeContas } from "../../../contracts/contas-ia.ts";
import type { PedidoDeInstalacao, ProgressoDeInstalacao } from "../../../contracts/instalacoes-ssh.ts";
import type { Escopo } from "../../../shared/types.ts";
import { ErroDeDominio } from "../../../domain/erro.ts";
import { estadoDaMaquina } from "../../../domain/harness.ts";
import { codigosDaMaquina } from "../../../domain/limpeza-das-tasks.ts";
import { log } from "../../../obs/log.ts";
import type { DesfechoAdocao, PonteInternaNod } from "../../fundo/ponte-interna.ts";
import { VERSAO_MINIMA_APP } from "../../fundo/ponte-interna.ts";
import type { Ctx, Rota } from "../roteador.ts";
import { CORPO_MAX_RESULTADO_COMPUTADOR } from "../util.ts";
import { cabecalhoCookieSessao } from "../sessao-cookie.ts";
import type { CanalComputador } from "../../computador/canal.ts";
import type { EstadoComputadorRelatado } from "../../../contracts/computador-motor.ts";
import type { MaquinaDaPessoa } from "../../computador/motor.ts";
import { anuncioComputador, anuncioVmLocal, estadoComputadorRelatado, resultadoComandoComputador, capacidadesAnunciadas, contasAnunciadas, entrega, impressoes, progressoDoLogin, progressoDeInstalacao, exigir, falas, idsDeMensagens, inventario, memoria, objeto, relatoDesfazer, relatoEspera, sessaoDaRenovacao, sinais, texto, trechos, turnosEmAndamento, uuid } from "./ponte-validacao.ts";
import { versaoAceita } from "../../../domain/versao-app.ts";
import { relatoValido } from "../../../use-cases/limpeza-das-tasks.ts";

/**
 * `planos`: os turnos que esta máquina está rodando AGORA (definido em 2026-09-24). Com o pool de laços
 * o app roda um turno por agente em paralelo; antes era um `plano` só e a renovação do segundo turno
 * voltava {ativo:false}, matando a CLI. `recebidas` guarda a última entrega de cada turno (idempotência).
 * `rebaixada` (definido em 2026-10-15, auditoria A2): o varredor deu o inventário por `ausente` depois de 60 s de silêncio
 * e só o próximo anúncio (`conectar`/`inventario`) o devolve — até lá o puxar responde 409 para a máquina se reanunciar.
 */
type Conexao = { escopo: Escopo; ponte: PonteInternaNod; inv: Inventario; ultimo: number; puxando: boolean; planos: Map<string, PlanoTurno>; recebidas: Map<string, number>; gh: boolean; nome: string; plataforma: PlataformaMaquina; anuncio: AnuncioMaquina | null; rebaixada: boolean; papel: PapelMaquina };

/**
 * NOD-199: o que um anúncio da máquina diz das IAs dela, lido com os mesmos filtros nas duas rotas que o recebem
 * (`conectar` e `inventario`): só ids integrados, `semLacoDeVoz` só de harness pronto neste anúncio, capacidades validadas.
 */
type LeituraAnuncio = { computador: ReturnType<typeof anuncioComputador>; vmLocal: ReturnType<typeof anuncioVmLocal>; inv: Inventario; gh: boolean; motores: Partial<Record<IdHarness, Inventario>>; harnessesAusente: boolean; semLacoDeVoz: IdHarness[]; capacidades: ReturnType<typeof capacidadesAnunciadas>; sobreviveReinicio: boolean };
function lerAnuncio(b: Record<string, unknown>, agora: number): LeituraAnuncio {
  // ADR-048: o gh desta máquina (app ≥ 2026-09-24). Ausente = app antigo = sem gh.
  const gh = objeto(b.github ?? {}).gh === true;
  const motores: Partial<Record<IdHarness, Inventario>> = {};
  if (b.harnesses !== undefined) {
    const anunciados = objeto(b.harnesses);
    for (const h of HARNESSES) if (anunciados[h.id] !== undefined && h.integrado) motores[h.id] = inventario(anunciados[h.id], agora, h.nome);
  }
  // #313: a máquina está pronta se QUALQUER IA dela está — o app rc.10/rc.11 manda em `inventario` o estado do Claude, e
  // quem só tem o ChatGPT ficava sem nenhum turno (envio negado, puxar vazio). App antigo sem `harnesses`: o `inventario` puro.
  const inv = estadoDaMaquina(inventario(b.inventario, agora), motores);
  // NOD-167: só ids integrados e prontos neste anúncio; qualquer outra coisa é ignorada (app antigo não manda o campo).
  const semLacoDeVoz = Array.isArray(b.semLacoDeVoz) ? HARNESSES.filter((h) => h.integrado && (b.semLacoDeVoz as unknown[]).includes(h.id) && motores[h.id]?.estado === "pronto").map((h) => h.id) : [];
  // Revisão do épico (S15, 2026-10-08): o que os drivers desta máquina declaram (com bifurcaSessao, a rede de 2 min bifurca).
  const capacidades = capacidadesAnunciadas(b.capacidades);
  // NOD-214: o cliente com o laço que atravessa o reinício do servidor (só o booleano conta; app antigo não manda).
  // NOD-96 PR 3: se a máquina roda o computador da pessoa (fora do formato = ausente, o computador não vai para ela).
  // NOD-93: o preparo da VM local do Mac (fora do formato = ausente).
  return { computador: anuncioComputador(b.computador), vmLocal: anuncioVmLocal(b.vmLocal), inv, gh, motores, harnessesAusente: b.harnesses === undefined, semLacoDeVoz, capacidades, sobreviveReinicio: b.sobreviveReinicio === true };
}

/** ADR-090: uma máquina conectada da pessoa, como a tela "Máquinas" a mostra (sem credencial nem inventário bruto). */
export type MaquinaConectada = { machineId: string; nome: string; plataforma: PlataformaMaquina; ias: Partial<Record<IdHarness, Inventario["estado"]>>; iasDetalhe: Partial<Record<IdHarness, DetalheDaIaNaMaquina>>; gh: boolean; /** NOD-9: atende o "Atualizar agora" remoto. */ atualizaIas: boolean };

/** NOD-8: a causa e as versões de uma IA anunciada, sem o motivo (a frase é da tela) nem o instante. */
function detalheDaIa(inv: Inventario): DetalheDaIaNaMaquina {
  const d: DetalheDaIaNaMaquina = {};
  if ("causa" in inv && inv.causa) d.causa = inv.causa;
  if (inv.versao) d.versao = inv.versao;
  if ("minima" in inv && inv.minima) d.minima = inv.minima;
  return d;
}

/** Um item aprovado que roda no Mac da dona (ADR-048): o que a máquina recebe ao puxar `itens-locais`. */
export type ItemLocal = { itemId: string; capacidade: string; argumentos: Record<string, unknown> };
export type DesfechoLocal = "executado" | "falhou_na_execucao";
/**
 * definido em 2026-09-24: um item entregue a uma máquina fica reservado para ela por 2 min — duas
 * máquinas da mesma pessoa não executam o mesmo comentário. Reserva vencida volta para a fila (o
 * resultado que chegar depois ainda é aceito uma vez: o desfecho só é gravado se estava aberto).
 */
const RESERVA_ITEM_MS = 120_000;
const RECEBIDAS_GUARDADAS = 64;
export function criarPonteHttpServidor(d: {
  criar(escopo: Escopo): PonteInternaNod;
  persistir(escopo: Escopo, inv: Inventario): Promise<void>;
  autorizar(token: string): Promise<(Escopo & { chaveId: string }) | null>;
  segredo: string;
  seguro: boolean;
  /** NOD-345: com NOD_CONTAS, o cookie do app leva o id de uma sessão revogável "maquina" (uma por chave). */
  sessaoDaMaquina?(escopo: Escopo, chaveId: string): Promise<string>;
  agora(): number;
  delta(plano: PlanoTurno, texto: string): void;
  ferramenta(plano: PlanoTurno, nome: string, id?: string): void;
  /** NOD-353: a chamada `id` terminou (`falhou` = tool_result.isError) — publica turno.acao_fim. */
  fimDaFerramenta?(plano: PlanoTurno, id: string, falhou: boolean): void;
  /** A lista de tarefas do bot, inteira, quando muda (definido em 2026-09-28). */
  tarefas(plano: PlanoTurno, tarefas: TarefaDoBot[]): void;
  /** ADR-067: uma fala da sessão viva foi gravada — a tela troca o texto ao vivo pela mensagem. */
  fala?(plano: PlanoTurno): void;
  /** NOD-350: a lista inteira dos subagentes do turno quando muda — publica turno.subagentes e guarda o resumo. */
  subagentes?(plano: PlanoTurno, subagentes: SubagenteVivo[], principalOcioso?: boolean): void;
  /** NOD-73: o vigia do turno avisou (só nome e números) — publica turno.vigia e registra no log. */
  vigia?(plano: PlanoTurno, aviso: VigiaVivo): void;
  longpollMs?: number;
  /** ADR-048: itens aprovados que esperam o gh do Mac desta pessoa, e o desfecho que o Mac relata. */
  itensLocais?(escopo: Escopo): Promise<ItemLocal[]>;
  concluirItemLocal?(escopo: Escopo, itemId: string, desfecho: DesfechoLocal): Promise<void>;
  /** definido em 2026-10-05: o Mac anunciou uma IA pronta — repete as falas que ficaram sem resposta por falta de IA. */
  repetirBarrados?(escopo: Escopo, prontos: readonly IdHarness[]): Promise<void>;
  /**
   * ADR-092: com o servidor no Mac (modo local), a sessão do CLI que a máquina remota devolve não é guardada. A conversa
   * e o trabalho continuam com a sessão do Mac, que o próximo turno no Mac retoma; a sessão da VM não existe no Mac.
   */
  descartarSessao?: boolean;
  /** ADR-090 (0067): grava na chave o sistema que a máquina anunciou — o aviso de queda nomeia a VM depois que a conexão some. */
  registrarPlataforma?(escopo: Escopo, chaveId: string, plataforma: PlataformaMaquina): Promise<void>;
  /** ADR-102 (R2): o nome que a pessoa deu à chave (Renomear em Máquinas); null = sem nome guardado (vale o anunciado). */
  nomeDaChave?(escopo: Escopo, chaveId: string): Promise<string | null>;
  /**
   * NOD-94 (emenda 11 da ADR-090): o papel GRAVADO na chave no pareamento — quem decide é o servidor, o anunciado só é
   * conferido. Ausente (modo local) ou null = `motor`.
   */
  papelDaChave?(escopo: Escopo, chaveId: string): Promise<PapelMaquina | null>;
  /**
   * definido em 2026-10-10 (plano das IAs, PR 2): o que as máquinas da pessoa dizem das IAs mudou num `conectar` ou num
   * reanúncio — a composição publica `inventario.mudou` e a tela relê sem recarregar (antes só a troca do interruptor
   * local avisava).
   */
  inventarioMudou?(escopo: Escopo, motivo?: "anuncio" | "presenca"): void;
  /**
   * ADR-102 (2026-10-13): as contas de IA da máquina — o anúncio (no `conectar` e no `inventario`), a puxada de contas
   * (logins pedidos pela tela, saídas e a desconexão), o progresso de um login e as saídas feitas. Ausente = servidor sem
   * contas (modo local): a máquina recebe 404 na puxada e segue como antes.
   */
  contas?: {
    anunciar(escopo: Escopo, chaveId: string, anunciadas: ContaAnunciada[]): Promise<void>;
    puxada(escopo: Escopo, chaveId: string): Promise<PuxadaDeContas>;
    progresso(escopo: Escopo, chaveId: string, p: ProgressoDoLogin): Promise<boolean>;
    saiu(escopo: Escopo, chaveId: string, impressoes: string[], desconectada: boolean): Promise<void>;
  };
  /**
   * NOD-96 PR 3 (definido em 2026-10-22, ADR-122): o canal do computador no motor (NOD_COMPUTADORES=motor). Ausente = flag
   * desligada: as rotas `computador/*` respondem 404 e o motor não insiste. `reconciliar` grava o que a foto do supervisor
   * diz (TOFU da X25519, estado das telas) — melhor esforço, nunca derruba a rota.
   */
  computador?: { canal: CanalComputador; reconciliar?(escopo: Escopo, maquinaId: string, relato: EstadoComputadorRelatado): Promise<void> };
  /**
   * NOD-94 (emenda 11 da ADR-090): a máquina como instaladora por SSH — a puxada (com a chave pública do par que ela
   * gerou ao subir; a credencial vem cifrada com ela, uma vez) e o progresso. Ausente = modo local: 404 e a máquina segue.
   */
  instalacoes?: {
    puxada(escopo: Escopo, chaveId: string, e: { chavePublica: string; plataforma: PlataformaMaquina; servidorProprio: boolean }): PedidoDeInstalacao[];
    progresso(escopo: Escopo, chaveId: string, p: ProgressoDeInstalacao): Promise<boolean>;
    /**
     * NOD-344: a máquina revoga a PRÓPRIA chave (prova de posse: só quem tem o Bearer chega aqui). O `nod-motor parear
     * --convite` chama com a chave antiga do `conexao.json` depois de parear a nova, para a reinstalação não deixar a
     * antiga viva no servidor. true = revogou agora; "nuvem" = a VM ligada à nuvem (ADR-121), que não perde a chave por aqui.
     */
    aposentar(escopo: Escopo, chaveId: string): Promise<boolean | "nuvem">;
  };
}) {
  const conexoes = new Map<string, Conexao>();
  /**
   * NOD-300 (definido em 2026-10-20): a última presença avisada de cada máquina (viva = contato há menos de 60 s). Fora
   * de `conexoes`, que apaga a conexão aos 90 s e cria outra no `conectar`: sem isto, a volta não avisaria. Só na memória
   * do processo; depois de um reinício começa vazio, e por isso a primeira vista de cada chave (no `conectar` ou na
   * passada) sempre avisa.
   */
  const presencaAvisada = new Map<string, { escopo: Escopo; viva: boolean }>();
  const reservas = new Map<string, { machineId: string; ate: number }>();
  /** NOD-96 PR 3: máquinas com o long-poll do computador em curso (um por máquina, separado do `puxar` dos turnos). */
  const puxandoComputador = new Set<string>();
  /** Revisão do #209: um aviso por máquina para a leitura com defeito no puxar (ela chega a cada pedido). */
  const leiturasInvalidas = new Set<string>();
  /**
   * definido em 2026-10-05 (NOD-175): na drenagem do SIGTERM o puxar não reserva turno novo — o turno fica `pendente` no
   * Postgres (ADR-010) para o próximo processo. `reservando` conta os `ponte.puxar` em voo: o que já reservou antes da
   * drenagem é ENTREGUE (o token foi cunhado e `ativos()` passa a contá-lo), nunca desfeito; a drenagem espera esse zero.
   */
  let drenando = false;
  let reservando = 0;
  const ausente = (): Inventario => ({ estado: "ausente", motivo: "Abra o app nod e conecte sua conta de IA no seu computador", em: d.agora() });
  function atual(pessoaId: string): Inventario {
    // NOD-94: a máquina só-computador não roda IA da pessoa — o inventário dela não conta.
    const vivas = [...conexoes.values()].filter((c) => c.escopo.pessoaId === pessoaId && c.papel === "motor" && d.agora() - c.ultimo < 60_000);
    return vivas.find((c) => c.inv.estado === "pronto")?.inv ?? vivas[0]?.inv ?? ausente();
  }
  async function persistir(c: Conexao) { await d.persistir(c.escopo, atual(c.escopo.pessoaId)); }
  /** Melhor esforço: o anúncio não pode falhar porque a repetição das falas barradas falhou. */
  async function repetirBarrados(c: Conexao) {
    if (c.inv.estado !== "pronto" || !d.repetirBarrados) return;
    const prontos = Object.entries(harnessesDaPessoa(c.escopo.pessoaId)).filter(([, i]) => i?.estado === "pronto").map(([h]) => h as IdHarness);
    await d.repetirBarrados(c.escopo, prontos).catch(() => log("aviso", "repetir_barrados_falhou", {}));
  }
  /** O que a tela mostra das IAs da pessoa (estado, causa e versão por IA): só a mudança disso vira `inventario.mudou`. */
  function assinaturaDasIas(pessoaId: string): string {
    return JSON.stringify(Object.entries(harnessesDaPessoa(pessoaId)).sort(([a], [b]) => a.localeCompare(b)).map(([h, i]) => [h, i?.estado, i && "causa" in i ? i.causa ?? null : null, i?.versao ?? null]));
  }
  function avisarSeMudou(escopo: Escopo, antes: string): void {
    if (assinaturaDasIas(escopo.pessoaId) !== antes) d.inventarioMudou?.(escopo);
  }
  /** ADR-102: melhor esforço — o anúncio das IAs não pode falhar porque o das contas falhou. */
  async function anunciarContas(escopo: Escopo, chaveId: string, bruto: unknown): Promise<void> {
    const anunciadas = d.contas ? contasAnunciadas(bruto, d.agora()) : undefined;
    if (!anunciadas || !d.contas) return;
    await d.contas.anunciar(escopo, chaveId, anunciadas).catch((e) => log("aviso", "contas_anuncio_falhou", { machine_id: chaveId, erro: e instanceof Error ? e.name : "desconhecido" }));
  }
  function conexao(ctx: Ctx): Conexao {
    const c = conexoes.get(ctx.params.chaveId ?? "");
    if (!c || c.escopo.pessoaId !== ctx.escopo.pessoaId || c.escopo.tenantId !== ctx.escopo.tenantId) throw new ErroDeDominio("estado_invalido");
    return c;
  }
  /**
   * NOD-214: o turno que esta máquina roda e o processo não conhece (despachado antes do reinício). Só com o token do
   * turno no header — a chave de máquina sozinha nunca devolve um plano; a ponte confere o resto no banco.
   * revisto em 2026-10-15 (NOD-245): a exceção (banco fora, impasse) é `erro`, separada da recusa real — quem chama
   * responde 503, que a máquina lê como transitório e repete; antes virava `{ativo:false}` (matava o CLI) ou 403 na entrega.
   */
  async function adocao(ctx: Ctx, c: Conexao, turnoId: string, para: "rodar" | "assentar"): Promise<DesfechoAdocao | { tipo: "erro" }> {
    const token = ctx.req.headers["x-nod-token-turno"];
    if (typeof token !== "string" || token === "" || token.length > 512 || !c.ponte.adotar) return { tipo: "recusado" };
    try {
      return await c.ponte.adotar({ pessoaId: ctx.escopo.pessoaId, turnoId, machineId: ctx.params.chaveId!, token, para });
    } catch (e) {
      log("aviso", "adocao_falhou", { turno_id: turnoId, para, erro: e instanceof Error ? e.name : "desconhecido" });
      return { tipo: "erro" };
    }
  }
  /** O plano do turno adotado para RODAR; `erro` = a adoção falhou por exceção (a rota responde 503). */
  async function adotado(ctx: Ctx, c: Conexao, turnoId: string): Promise<PlanoTurno | null | "erro"> {
    const r = await adocao(ctx, c, turnoId, "rodar");
    if (r.tipo === "erro") return "erro";
    if (r.tipo !== "adotado") return null;
    c.planos.set(turnoId, r.plano);
    return r.plano;
  }
  function rota(nome: string, fn: (ctx: Ctx, corpo: Record<string, unknown>) => Promise<void>, o: { corpoMax?: number } = {}): Rota {
    return { metodo: "POST", padrao: new RegExp(`^/${nome}$`), maquina: true, ...(o.corpoMax ? { corpoMax: o.corpoMax } : {}), async handler(ctx) {
      ctx.res.setHeader("x-nod-versao-minima", VERSAO_MINIMA_APP);
      if (!versaoAceita(ctx.req.headers["x-nod-versao"], VERSAO_MINIMA_APP)) { ctx.json(426, { codigo: "atualize_app", versaoMinimaApp: VERSAO_MINIMA_APP }); return; }
      await fn(ctx, objeto(await ctx.corpo()));
    } };
  }
  const rotas = [
    rota("sessao", async (ctx) => {
      const sid = d.sessaoDaMaquina ? await d.sessaoDaMaquina(ctx.escopo, ctx.params.chaveId!) : undefined;
      ctx.res.setHeader("set-cookie", cabecalhoCookieSessao(ctx.escopo, d.segredo, d.seguro, undefined, sid));
      // NOD-94: o papel da chave vai junto — a máquina só-computador não sobe o laço de turnos.
      const papel = (await d.papelDaChave?.(ctx.escopo, ctx.params.chaveId!)) ?? "motor";
      // ADA-11 (ADR-147): as plataformas que este servidor conhece. O motor do Windows só conecta se o win32 está aqui
      // (um servidor antigo, num rollback, o trataria como Mac).
      ctx.json(200, { escopo: ctx.escopo, machineId: ctx.params.chaveId, papel, plataformas: PLATAFORMAS_MAQUINA });
    }),
    rota("conectar", async (ctx, b) => {
      exigir(b.versaoContrato === 1 && texto(b.nome, 100) && b.nome.trim());
      const id = ctx.params.chaveId!;
      const antes = assinaturaDasIas(ctx.escopo.pessoaId);
      // ADR-090: o nome e o sistema da máquina (o motor sem janela manda "linux"). Ausente = app do Mac.
      // ADR-147 (definido em 2026-11-03): desconhecido é recusado — virar Mac em silêncio era o que um servidor antigo
      // fazia com o motor do Windows (voz e VM locais erradas).
      const nome = b.nome.trim();
      const plataforma = b.plataforma === undefined ? "darwin" : PLATAFORMAS_MAQUINA.find((x) => x === b.plataforma);
      exigir(plataforma !== undefined);
      let c = conexoes.get(id);
      if (!c) {
        c = { escopo: ctx.escopo, ponte: d.criar(ctx.escopo), inv: ausente(), ultimo: d.agora(), puxando: false, planos: new Map(), recebidas: new Map(), gh: false, nome, plataforma, anuncio: null, rebaixada: false, papel: "motor" };
        conexoes.set(id, c);
      }
      if (c.planos.size > 0) {
        // Auditoria A4 (definido em 2026-10-15): o app novo diz quais turnos roda. O plano que ele não conhece é de um
        // processo que morreu sem `desconectar` (SIGKILL, OOM) e voltou em menos de 90 s — antes o `conectar` recusava
        // para sempre (o laço novo renova `ultimo` a cada puxar) e nenhum anúncio chegava. O que ele roda fica; se um
        // plano sair por engano, a renovação com o token do turno o adota de volta (NOD-214). App antigo: a regra de antes.
        const rodando = turnosEmAndamento(b.turnosEmAndamento);
        if (rodando) { for (const id of [...c.planos.keys()]) if (!rodando.has(id)) c.planos.delete(id); }
        else if (d.agora() - c.ultimo < 90_000) throw new ErroDeDominio("estado_invalido");
        else c.planos.clear();
      }
      const a = lerAnuncio(b, d.agora());
      c.inv = a.inv; c.ultimo = d.agora(); c.gh = a.gh; c.rebaixada = false;
      // Revisão do PR #306: o prompt e "Rodar no X" usam o mesmo nome da tela (o da chave), não o hostname anunciado.
      c.nome = (await d.nomeDaChave?.(ctx.escopo, id).catch(() => null)) ?? nome;
      c.plataforma = plataforma;
      // NOD-94: o papel é o da chave (pareamento), não o anunciado; a diferença só vira log (app antigo não anuncia).
      c.papel = (await d.papelDaChave?.(ctx.escopo, id).catch(() => null)) ?? "motor";
      const anunciado = PAPEIS_MAQUINA.find((p) => p === b.papel) ?? null;
      if (anunciado && anunciado !== c.papel) log("aviso", "papel_anunciado_difere", { machine_id: id, anunciado, gravado: c.papel });
      // O só-computador não pega turno: sem gh nem laço de voz, nada da fila nem dos itens locais chega a ele.
      if (c.papel === "computador") c.gh = false;
      c.anuncio = { machineId: id, nome: b.nome, plataforma: c.plataforma, ...(typeof ctx.req.headers["x-nod-versao"] === "string" ? { versaoApp: ctx.req.headers["x-nod-versao"] } : {}), inventario: c.inv, versaoContrato: 1, harnesses: a.harnessesAusente ? { "claude-cli": c.inv } : a.motores, ligacao: b.ligacao === true && c.papel === "motor", papel: c.papel, ...(a.semLacoDeVoz.length > 0 ? { semLacoDeVoz: a.semLacoDeVoz } : {}), ...(a.capacidades ? { capacidades: a.capacidades } : {}), ...(a.sobreviveReinicio ? { sobreviveReinicio: true } : {}), ...(a.computador ? { computador: a.computador } : {}), ...(a.vmLocal ? { vmLocal: a.vmLocal } : {}), ...(b.atualizaIas === true ? { atualizaIas: true } : {}) };
      await c.ponte.conectar(c.anuncio);
      await persistir(c);
      await d.registrarPlataforma?.(ctx.escopo, id, plataforma);
      await anunciarContas(ctx.escopo, id, b.contas);
      await repetirBarrados(c);
      // Re-QA do NOD-300: a máquina que a memória não sabe viva (primeira vista, ou depois de um reinício da API em que a
      // tela ainda mostra "sem contato" lido do banco) avisa a presença no `conectar` — com outra máquina da pessoa pronta,
      // a assinatura das IAs não muda e nada mais avisaria. Marcada viva aqui, a passada seguinte não repete.
      const estava = presencaAvisada.get(id);
      presencaAvisada.set(id, { escopo: ctx.escopo, viva: true });
      if (!estava?.viva) d.inventarioMudou?.(ctx.escopo, "presenca");
      else avisarSeMudou(ctx.escopo, antes);
      // NOD-94: `instalacoes` = este servidor aceita a máquina como instaladora por SSH (a puxada de /instalacoes).
      ctx.json(200, { machineId: id, escopo: ctx.escopo, papel: c.papel, ...(d.contas ? { contasIa: true } : {}), ...(d.instalacoes && c.papel === "motor" ? { instalacoes: true } : {}) });
    }),
    /**
     * NOD-199 (emenda à ADR-021): anúncio SÓ de inventário, para a máquina já conectada — a IA que ficou pronta (ou caiu)
     * chega ao servidor com turno rodando. Troca inventário, harnesses, gh e capacidades da conexão e nunca toca em
     * `planos`, `puxando` nem `recebidas`: o turno em curso termina e entrega como antes. Sem conexão desta chave (ou de
     * outra pessoa), `conexao` lança `estado_invalido` → 409, que o app lê como `reconectar`. O nome, a plataforma e o
     * laço de voz vêm do `conectar` (não mudam sem reabrir o app).
     */
    rota("inventario", async (ctx, b) => {
      const c = conexao(ctx);
      exigir(b.versaoContrato === 1);
      const antes = assinaturaDasIas(ctx.escopo.pessoaId);
      const a = lerAnuncio(b, d.agora());
      c.inv = a.inv; c.ultimo = d.agora(); c.gh = a.gh && c.papel === "motor"; c.rebaixada = false;
      // A conexão só nasce no `conectar`, que grava o anúncio: daqui saem o nome e o laço de voz, que não mudam aqui.
      // ADR-090: a plataforma também é do `conectar` — o motor na VM Linux não vira "darwin" ao reanunciar.
      const { nome, ligacao, atualizaIas, versaoApp } = c.anuncio ?? { nome: c.nome, ligacao: false, atualizaIas: false, versaoApp: undefined };
      c.anuncio = { machineId: ctx.params.chaveId!, nome, plataforma: c.plataforma, ...(versaoApp ? { versaoApp } : {}), inventario: c.inv, versaoContrato: 1, harnesses: a.harnessesAusente ? { "claude-cli": c.inv } : a.motores, ligacao, papel: c.papel, ...(a.semLacoDeVoz.length > 0 ? { semLacoDeVoz: a.semLacoDeVoz } : {}), ...(a.capacidades ? { capacidades: a.capacidades } : {}), ...(a.sobreviveReinicio ? { sobreviveReinicio: true } : {}), ...(a.computador ? { computador: a.computador } : {}), ...(a.vmLocal ? { vmLocal: a.vmLocal } : {}), ...(atualizaIas ? { atualizaIas: true } : {}) };
      // O `conectar` da ponte interna só registra o anúncio da máquina (idempotente): seguro com turno rodando.
      await c.ponte.conectar(c.anuncio);
      await persistir(c);
      await anunciarContas(ctx.escopo, ctx.params.chaveId!, b.contas);
      await repetirBarrados(c);
      avisarSeMudou(ctx.escopo, antes);
      ctx.json(200, { ok: true });
    }),
    /** ADR-102: o que a tela pediu a esta máquina (logins, saídas, desconexão). O motor puxa a cada 3 s (1 s com login aberto). */
    rota("contas", async (ctx) => {
      const c = conexao(ctx);
      if (!d.contas) { ctx.json(404, { codigo: "sem_contas" }); return; }
      c.ultimo = d.agora();
      ctx.json(200, await d.contas.puxada(ctx.escopo, ctx.params.chaveId!));
    }),
    rota("contas/progresso", async (ctx, b) => {
      conexao(ctx);
      if (!d.contas) { ctx.json(404, { codigo: "sem_contas" }); return; }
      const ok = await d.contas.progresso(ctx.escopo, ctx.params.chaveId!, progressoDoLogin(b));
      ctx.json(ok ? 200 : 409, ok ? { ok: true } : { codigo: "login_recusado" });
    }),
    rota("contas/saiu", async (ctx, b) => {
      conexao(ctx);
      if (!d.contas) { ctx.json(404, { codigo: "sem_contas" }); return; }
      await d.contas.saiu(ctx.escopo, ctx.params.chaveId!, impressoes(b.impressoes ?? []), b.desconectada === true);
      ctx.json(200, { ok: true });
    }),
    /**
     * NOD-94: os pedidos de instalação por SSH desta máquina (a cada 3 s). A só-computador não instala outra (ela não tem
     * o motor completo nem é escolha da pessoa como origem).
     */
    rota("instalacoes", async (ctx, b) => {
      const c = conexao(ctx);
      if (!d.instalacoes || c.papel === "computador") { ctx.json(404, { codigo: "sem_instalacoes" }); return; }
      exigir(typeof b.chavePublica === "string" && b.chavePublica.length > 0 && b.chavePublica.length <= 2_048 && /^[A-Za-z0-9+/]+={0,2}$/.test(b.chavePublica));
      c.ultimo = d.agora();
      ctx.json(200, { pedidos: d.instalacoes.puxada(ctx.escopo, ctx.params.chaveId!, { chavePublica: b.chavePublica, plataforma: c.plataforma, servidorProprio: b.servidorProprio === true }) });
    }),
    rota("instalacoes/progresso", async (ctx, b) => {
      conexao(ctx);
      if (!d.instalacoes) { ctx.json(404, { codigo: "sem_instalacoes" }); return; }
      const ok = await d.instalacoes.progresso(ctx.escopo, ctx.params.chaveId!, progressoDeInstalacao(b));
      ctx.json(ok ? 200 : 409, ok ? { ok: true } : { codigo: "instalacao_recusada" });
    }),
    rota("puxar", async (ctx, b) => {
      const c = conexao(ctx);
      // ADR-085: a leitura do Mac (memória e processador) vem no corpo; app antigo manda `{}`. Revisão do #209: leitura
      // com defeito vai como "sem leitura" (nada é segurado), nunca um 400 — o puxar é o que entrega trabalho ao Mac.
      let mem: LeituraMemoria | undefined;
      try {
        mem = memoria(b.memoria);
      } catch {
        if (!leiturasInvalidas.has(ctx.params.chaveId!)) log("aviso", "puxar_leitura_invalida", { machine_id: ctx.params.chaveId });
        leiturasInvalidas.add(ctx.params.chaveId!);
      }
      // Auditoria A2 (definido em 2026-10-15): a máquina voltou de 60–90 s de silêncio (tampa fechada, troca de rede) e a
      // conexão ainda existe, mas o varredor já pôs o inventário em `ausente`. Sem isto o puxar respondia 200 sem nunca
      // reservar (só reserva com `pronto`) e nada restaurava o inventário; o 409 faz o cliente reconectar com o anúncio.
      if (c.rebaixada) throw new ErroDeDominio("estado_invalido");
      if (c.puxando) throw new ErroDeDominio("estado_invalido");
      c.puxando = true;
      try {
        const ate = d.agora() + (d.longpollMs ?? 20_000);
        let plano: PlanoTurno | null = null;
        do {
          if (ctx.res.destroyed) return;
          const identidade = await d.autorizar((ctx.req.headers.authorization ?? "").slice(7));
          if (!identidade) { ctx.json(401, { codigo: "nao_permitido" }); return; }
          c.ultimo = d.agora();
          if (drenando) break;
          // NOD-94: a máquina só-computador espera o longpoll e volta `{plano:null}` (o motor dela nem sobe o laço).
          if (c.inv.estado === "pronto" && c.papel === "motor") {
            reservando++;
            // Revisão do #209: a leitura entra uma vez por pedido. Repetida a cada 250 ms durante a espera de até 20 s,
            // ela passava por cima da mais nova que a renovação trouxe e o nível ia e voltava na tela.
            // ADR-130: a máquina drenando (ADR-100) só aceita o que a pessoa espera agora; servidor antigo ignora o campo.
            try { plano = await (b.soDaPessoa === true ? c.ponte.puxar(ctx.escopo.pessoaId, mem, { soDaPessoa: true }) : c.ponte.puxar(ctx.escopo.pessoaId, mem)); } finally { reservando--; mem = undefined; }
          }
          if (plano) { c.planos.set(plano.turnoId, plano); break; }
          if (drenando) break;
          await esperar(250);
        } while (d.agora() < ate);
        ctx.json(200, { plano });
      } finally { c.puxando = false; }
    }),
    rota("renovar", async (ctx, b) => {
      const c = conexao(ctx), turnoId = uuid(b.turnoId);
      exigir(b.eventos === undefined || (Array.isArray(b.eventos) && b.eventos.length === 0));
      const s = sinais(b.sinais);
      const plano = c.planos.get(turnoId) ?? await adotado(ctx, c, turnoId);
      if (plano === "erro") { ctx.json(503, { codigo: "adocao_indisponivel" }); return; }
      if (!plano) { ctx.json(200, { ativo: false, versaoMinimaApp: VERSAO_MINIMA_APP, motivo: "sem_plano" }); return; }
      c.ultimo = d.agora();
      const sessaoCli = d.descartarSessao ? undefined : sessaoDaRenovacao(b.sessaoCli);
      // ADR-067: as falas da sessão viva e o pedido de mensagens novas viajam na renovação.
      const fs = falas(b.falas);
      // #189: o que o app escreveu na sessão (confirmado) e o que não conseguiu (fica na fila).
      const entregues = idsDeMensagens(b.mensagensEntregues), devolvidas = idsDeMensagens(b.mensagensDevolvidas);
      // ADR-083 (#194): a memória do Mac, amostrada uma vez por máquina e mandada em cada renovação.
      const mem = memoria(b.memoria);
      const r = await c.ponte.renovar({ turnoId, machineId: ctx.params.chaveId!, sinais: s, eventos: [], ...(fs.length ? { falas: fs } : {}), ...(b.aceitaMensagens === true ? { aceitaMensagens: true } : {}), ...(entregues ? { mensagensEntregues: entregues } : {}), ...(devolvidas?.length ? { mensagensDevolvidas: devolvidas } : {}), ...(mem ? { memoria: mem } : {}), ...(sessaoCli ? { sessaoCli } : {}) });
      if (fs.length && r.ativo) d.fala?.(plano);
      if (r.ativo && texto(b.delta, 16_000) && b.delta) d.delta(plano, b.delta);
      if (r.ativo) for (const t of trechos(b.trechos)) {
        if ("ferramenta" in t) d.ferramenta(plano, t.ferramenta, t.id);
        else if ("fim" in t) d.fimDaFerramenta?.(plano, t.fim, t.falhou);
        else if ("tarefas" in t) d.tarefas(plano, t.tarefas);
        else if ("vigia" in t) d.vigia?.(plano, t.vigia);
        else if ("subagentes" in t) d.subagentes?.(plano, t.subagentes, t.ocioso);
        else if (t.texto) d.delta(plano, t.texto);
      }
      ctx.json(200, r);
    }),
    rota("entregar", async (ctx, b) => {
      const c = conexao(ctx), lida = entrega(b, ctx.params.chaveId!);
      const e = d.descartarSessao && lida.resultado.sessaoCli !== null ? { ...lida, resultado: { ...lida.resultado, sessaoCli: null } } : lida;
      if (c.recebidas.get(e.turnoId) === e.seqLocal) { ctx.json(200, { ok: true }); return; }
      // NOD-214: sem o plano nesta conexão (o processo reiniciou no meio do turno), a entrega adota o turno pelo token —
      // ou, já assentado (pelo varredor, ou por uma entrega cuja resposta se perdeu), assenta como tardia/duplicada e
      // responde `ja_assentado`, que o app lê como sucesso.
      let jaAssentado = false;
      if (!c.planos.has(e.turnoId)) {
        // NOD-245/NOD-252: adota para ASSENTAR — sem renovar o lease e aceitando o Parar pendente; exceção dá 503.
        const r = await adocao(ctx, c, e.turnoId, "assentar");
        if (r.tipo === "erro") { ctx.json(503, { codigo: "adocao_indisponivel" }); return; }
        if (r.tipo === "adotado") c.planos.set(e.turnoId, r.plano);
        else if (r.tipo === "ja_assentado") jaAssentado = true;
        else throw new ErroDeDominio("nao_permitido");
      }
      c.ultimo = d.agora();
      await c.ponte.entregar(e);
      // definido em 2026-10-05: o turno reprovou a conta da IA (ponte-interna, reprovarHarness) — o inventário desta
      // conexão acompanha, para a tela e o banco não continuarem dizendo "pronta".
      if (e.resultado.causaSemIa) {
        const m = c.ponte.maquinasConectadas().find((x) => x.machineId === e.machineId);
        if (m) { c.inv = m.inventario; await persistir(c); }
      }
      c.recebidas.set(e.turnoId, e.seqLocal);
      if (c.recebidas.size > RECEBIDAS_GUARDADAS) c.recebidas.delete(c.recebidas.keys().next().value!);
      c.planos.delete(e.turnoId);
      if (jaAssentado) { ctx.json(200, { ok: true, codigo: "ja_assentado" }); return; }
      // ADR-099 item 9 (definido em 2026-10-12, I5): a frente que terminou com este turno e já vale `sem_trabalho` vai na
      // resposta, e o Mac a limpa na hora (só com prova). App antigo ignora o campo; falhar aqui não falha a entrega —
      // a pasta sai na passada de 6 h.
      const limpar = await (c.ponte.limparAgora?.(ctx.escopo.pessoaId, e.turnoId) ?? Promise.resolve(null)).catch((erro: unknown) => {
        log("aviso", "limpeza_agora_falhou", { turno_id: e.turnoId, erro: erro instanceof Error ? erro.name : "desconhecido" });
        return null;
      });
      ctx.json(200, limpar ? { ok: true, limparAgora: [limpar] } : { ok: true });
    }),
    /**
     * ADR-048: a máquina PUXA os itens aprovados que rodam no gh dela — o servidor nunca disca (ADR-021).
     * Só a máquina que anunciou o gh recebe; a pessoa é a da chave, nunca do corpo.
     */
    /**
     * NOD-96 PR 3 (definido em 2026-10-22, ADR-122): o motor PUXA os comandos do computador da pessoa (o servidor nunca
     * disca, ADR-021). Long-poll como o `puxar`; a máquina é a da chave e a pessoa a do escopo — o canal só entrega o
     * comando dessa máquina E dessa pessoa. Flag desligada: 404 (o motor lê como "servidor sem computador" e para).
     */
    rota("computador/puxar", async (ctx) => {
      const c = conexao(ctx);
      if (!d.computador) { ctx.json(404, { codigo: "sem_computador" }); return; }
      const id = ctx.params.chaveId!;
      if (puxandoComputador.has(id)) throw new ErroDeDominio("estado_invalido");
      puxandoComputador.add(id);
      try {
        const ate = d.agora() + (d.longpollMs ?? 20_000);
        do {
          if (ctx.res.destroyed) return;
          c.ultimo = d.agora();
          if (drenando) break;
          if (d.computador.canal.temPara(ctx.escopo, id)) { ctx.json(200, { comandos: d.computador.canal.puxar(ctx.escopo, id) }); return; }
          await esperar(250);
        } while (d.agora() < ate);
        ctx.json(200, { comandos: [] });
      } finally { puxandoComputador.delete(id); }
    }),
    /** A resposta do supervisor a um comando. Id desconhecido ou de outra máquina/pessoa: ignorado (200, `aceito: false`). */
    rota("computador/resultado", async (ctx, b) => {
      const c = conexao(ctx);
      if (!d.computador) { ctx.json(404, { codigo: "sem_computador" }); return; }
      const r = resultadoComandoComputador(b);
      c.ultimo = d.agora();
      ctx.json(200, { aceito: d.computador.canal.resultado(ctx.escopo, ctx.params.chaveId!, r) });
    }, { corpoMax: CORPO_MAX_RESULTADO_COMPUTADOR }),
    /** A foto do computador (a cada 15 s e a cada mudança): o canal guarda; a composição reconcilia o banco. */
    rota("computador/estado", async (ctx, b) => {
      const c = conexao(ctx);
      if (!d.computador) { ctx.json(404, { codigo: "sem_computador" }); return; }
      const relato = estadoComputadorRelatado(b);
      c.ultimo = d.agora();
      d.computador.canal.relatarEstado(ctx.escopo, ctx.params.chaveId!, relato);
      await d.computador.reconciliar?.(ctx.escopo, ctx.params.chaveId!, relato).catch((e) => log("aviso", "computador_reconciliar_falhou", { machine_id: ctx.params.chaveId, erro: e instanceof Error ? e.name : "desconhecido" }));
      ctx.json(200, { ok: true });
    }),
    rota("itens-locais", async (ctx) => {
      const c = conexao(ctx);
      c.ultimo = d.agora();
      if (!c.gh || !d.itensLocais) { ctx.json(200, { itens: [] }); return; }
      const agora = d.agora();
      // revisto em 2026-09-25: reserva viva não volta nem para a máquina que a segura — comentar e
      // revisar no GitHub não são idempotentes; se o relato falhou, a máquina reenvia só o relato.
      const livres = (await d.itensLocais(ctx.escopo)).filter((i) => {
        const r = reservas.get(i.itemId);
        return !r || r.ate <= agora;
      }).slice(0, 10);
      for (const i of livres) reservas.set(i.itemId, { machineId: ctx.params.chaveId!, ate: agora + RESERVA_ITEM_MS });
      ctx.json(200, { itens: livres });
    }),
    rota("itens-locais/resultado", async (ctx, b) => {
      const c = conexao(ctx);
      const itemId = uuid(b.itemId);
      exigir(b.desfecho === "executado" || b.desfecho === "falhou_na_execucao");
      // Reserva perdida (servidor reiniciou) não recusa o relato: sem ele a máquina puxaria e rodaria de
      // novo. Recusa só a reserva viva de OUTRA máquina; o desfecho é gravado uma vez (se aberto).
      const r = reservas.get(itemId);
      if (!c.gh || (r && r.ate > d.agora() && r.machineId !== ctx.params.chaveId)) throw new ErroDeDominio("nao_permitido");
      c.ultimo = d.agora();
      await d.concluirItemLocal?.(ctx.escopo, itemId, b.desfecho as DesfechoLocal);
      reservas.delete(itemId);
      ctx.json(200, { ok: true });
    }),
    /**
     * ADR-088 (2026-10-09): o Mac PUXA as pastas de task encerradas que pode limpar (o servidor nunca disca, ADR-021) e
     * relata o resumo. A pessoa é a da chave; o relato só vira log (relatoValido descarta o que não é número conhecido).
     * ADR-096: `apertado: true` (só o booleano conta) = o disco da máquina está amarelo ou vermelho. ADR-106: `codigos` =
     * o sha256 das pastas que a máquina tem no disco (validados por `codigosDaMaquina`), nunca os nomes; ausente = app
     * antigo.
     */
    rota("limpeza", async (ctx, b) => {
      const c = conexao(ctx);
      c.ultimo = d.agora();
      const codigos = codigosDaMaquina(b.codigos);
      ctx.json(200, { pastas: (await c.ponte.pastasParaLimpar?.(ctx.escopo.pessoaId, { apertado: b.apertado === true, ...(codigos ? { codigos } : {}) })) ?? [] });
    }),
    rota("limpeza/resultado", async (ctx, b) => {
      const c = conexao(ctx);
      c.ultimo = d.agora();
      await c.ponte.relatarLimpeza?.(ctx.escopo.pessoaId, relatoValido(b.relato), ctx.params.chaveId);
      ctx.json(200, { ok: true });
    }),
    /**
     * ADR-099 (parte 2, definido em 2026-10-12): a máquina PUXA as esperas de comando que deve estar rodando (o servidor
     * nunca disca, ADR-021) e relata o fim. A máquina é a da chave, nunca do corpo; servidor antigo responde 404 e o app
     * segue sem esperas.
     */
    rota("esperas", async (ctx) => {
      const c = conexao(ctx);
      c.ultimo = d.agora();
      ctx.json(200, { esperas: (await c.ponte.esperas?.(ctx.escopo.pessoaId, ctx.params.chaveId!)) ?? [] });
    }),
    rota("esperas/resultado", async (ctx, b) => {
      const c = conexao(ctx);
      c.ultimo = d.agora();
      const r = await c.ponte.relatarEspera?.(ctx.escopo.pessoaId, ctx.params.chaveId!, relatoEspera(b.relato));
      ctx.json(200, r ?? { seguir: false });
    }),
    /** NOD-54 (ADR-134): a máquina PUXA os desfazeres de arquivos dela e relata o progresso e o fim (molde das esperas). */
    rota("desfazeres", async (ctx) => {
      const c = conexao(ctx);
      c.ultimo = d.agora();
      ctx.json(200, { desfazeres: (await c.ponte.desfazeres?.(ctx.escopo.pessoaId, ctx.params.chaveId!)) ?? [] });
    }),
    rota("desfazeres/relato", async (ctx, b) => {
      const c = conexao(ctx);
      c.ultimo = d.agora();
      const r = await c.ponte.relatarDesfazer?.(ctx.escopo.pessoaId, ctx.params.chaveId!, relatoDesfazer(b.relato));
      ctx.json(200, r ?? { ok: false });
    }),
    /** NOD-344: a reinstalação aposenta a chave antiga (a própria do Bearer). Não exige conexão: o motor antigo já parou. */
    rota("aposentar", async (ctx) => {
      if (!d.instalacoes) { ctx.json(404, { codigo: "sem_instalacoes" }); return; }
      const id = ctx.params.chaveId!;
      const r = await d.instalacoes.aposentar(ctx.escopo, id);
      if (r === "nuvem") { log("aviso", "maquina_aposentar_recusada", { pessoa_id: ctx.escopo.pessoaId, machine_id: id, motivo: "nuvem" }); ctx.json(409, { codigo: "maquina_na_nuvem" }); return; }
      const revogou = r;
      const c = conexoes.get(id);
      if (c && c.escopo.pessoaId === ctx.escopo.pessoaId && c.escopo.tenantId === ctx.escopo.tenantId) {
        // Como o "desconectar" (revisão do PR #579): a barra e a lista do dono releem na hora.
        const antes = assinaturaDasIas(ctx.escopo.pessoaId);
        await c.ponte.desconectar(id);
        conexoes.delete(id);
        d.computador?.canal.esquecerMaquina(id);
        const estava = presencaAvisada.get(id);
        presencaAvisada.set(id, { escopo: c.escopo, viva: false });
        await persistir(c);
        avisarSeMudou(ctx.escopo, antes);
        if (estava?.viva) d.inventarioMudou?.(c.escopo, "presenca");
      }
      log("info", "maquina_aposentada", { pessoa_id: ctx.escopo.pessoaId, tenant_id: ctx.escopo.tenantId, machine_id: id, revogou });
      ctx.json(200, { ok: true, revogou });
    }),
    rota("desconectar", async (ctx) => {
      const c = conexao(ctx);
      const antes = assinaturaDasIas(ctx.escopo.pessoaId);
      await c.ponte.desconectar(ctx.params.chaveId!);
      conexoes.delete(ctx.params.chaveId!);
      // NOD-96 PR 3: a foto do computador desta máquina deixa de valer (o despachante não a escolhe mais).
      d.computador?.canal.esquecerMaquina(ctx.params.chaveId!);
      // NOD-300: a máquina que sai avisa a presença (a barra do dono relê na hora).
      const estava = presencaAvisada.get(ctx.params.chaveId!);
      presencaAvisada.set(ctx.params.chaveId!, { escopo: c.escopo, viva: false });
      await persistir(c);
      avisarSeMudou(ctx.escopo, antes);
      if (estava?.viva) d.inventarioMudou?.(c.escopo, "presenca");
      ctx.json(200, { ok: true });
    }),
  ];
  async function varrer() {
    // NOD-300: a máquina que perde ou recupera o contato avisa (`inventario.mudou`, motivo "presenca") só na transição,
    // um aviso por pessoa por passada. Antes do `continue`, para o `puxando` não pular o aviso.
    const avisar = new Map<string, Escopo>();
    const transicao = (id: string, escopo: Escopo, viva: boolean) => {
      const antes = presencaAvisada.get(id);
      // Re-QA do NOD-300: a chave que a memória não conhece (depois de um reinício) também avisa na primeira vista, viva ou
      // não — a tela pode estar mostrando o contrário, lido do banco. Gravada aqui, a passada seguinte não repete.
      if (!antes || antes.viva !== viva) avisar.set(`${escopo.tenantId}:${escopo.pessoaId}`, escopo);
      presencaAvisada.set(id, { escopo, viva });
    };
    for (const [id, c] of conexoes) transicao(id, c.escopo, d.agora() - c.ultimo < 60_000);
    for (const [id, p] of presencaAvisada) if (p.viva && !conexoes.has(id)) transicao(id, p.escopo, false);
    for (const escopo of avisar.values()) d.inventarioMudou?.(escopo, "presenca");
    for (const [id, c] of conexoes) {
      if (d.agora() - c.ultimo < 60_000 || c.puxando) continue;
      c.inv = ausente(); c.rebaixada = true;
      await persistir(c);
      if (d.agora() - c.ultimo >= 90_000) conexoes.delete(id);
    }
  }
  function harnesses(escopo: Escopo, machineId: string): Partial<Record<IdHarness, Inventario>> {
    const c = conexoes.get(machineId);
    // NOD-94: as IAs da máquina só-computador não contam para a pessoa (harnessesProntosPessoa, prontos por máquina).
    if (!c || c.papel !== "motor" || c.escopo.pessoaId !== escopo.pessoaId || c.escopo.tenantId !== escopo.tenantId || d.agora() - c.ultimo >= 60_000) return {};
    return c.ponte.maquinasConectadas().find((m) => m.machineId === machineId)?.harnesses ?? { "claude-cli": c.inv };
  }
  function harnessesDaPessoa(pessoaId: string): Partial<Record<IdHarness, Inventario>> {
    const todos: Partial<Record<IdHarness, Inventario>> = {};
    for (const [id, c] of conexoes) if (c.escopo.pessoaId === pessoaId) for (const [h, inv] of Object.entries(harnesses(c.escopo, id))) {
      const key = h as IdHarness; if (todos[key]?.estado !== "pronto") todos[key] = inv;
    }
    return todos;
  }
  /** ADR-108 (revisão do PR 2, C5/C6): as IAs prontas de cada máquina viva da pessoa, por máquina. */
  function prontosPorMaquinaDaPessoa(pessoaId: string): Record<string, IdHarness[]> {
    const porMaquina: Record<string, IdHarness[]> = {};
    for (const [id, c] of conexoes) if (c.escopo.pessoaId === pessoaId) {
      porMaquina[id] = (Object.entries(harnesses(c.escopo, id)) as [IdHarness, Inventario | undefined][]).filter(([, i]) => i?.estado === "pronto").map(([h]) => h);
    }
    return porMaquina;
  }
  /** Último contato da máquina pela ponte (conectar/puxar/renovar/entregar); null = não está conectada. */
  function ultimoContato(machineId: string): number | null {
    return conexoes.get(machineId)?.ultimo ?? null;
  }
  /** ADR-048: a máquina do turno anunciou o gh e é da pessoa do escopo (a chave é por pessoa). */
  function ghDaMaquina(escopo: Escopo, machineId: string): boolean {
    const c = conexoes.get(machineId);
    return !!c && c.gh && c.escopo.pessoaId === escopo.pessoaId && c.escopo.tenantId === escopo.tenantId && d.agora() - c.ultimo < 60_000;
  }
  /** ADR-072: alguma máquina viva da pessoa anunciou o laço de voz (app que sabe atender ligação). */
  function ligacaoDaPessoa(pessoaId: string): boolean {
    return [...conexoes.entries()].some(([id, c]) => c.escopo.pessoaId === pessoaId && d.agora() - c.ultimo < 60_000 && c.ponte.maquinasConectadas().some((m) => m.machineId === id && m.ligacao === true));
  }
  /**
   * NOD-167: a IA está pronta em alguma máquina viva da pessoa que atende ligação, e TODAS essas a anunciaram sem o laço
   * de voz (o Codex sem `app-server`). Basta uma máquina com o laço para não recusar.
   */
  function semLacoDeVozDaPessoa(pessoaId: string, harness: IdHarness): boolean {
    const maquinas = [...conexoes.entries()].flatMap(([id, c]) => c.escopo.pessoaId === pessoaId && d.agora() - c.ultimo < 60_000 ? c.ponte.maquinasConectadas().filter((m) => m.machineId === id && m.ligacao === true && m.harnesses?.[harness]?.estado === "pronto") : []);
    return maquinas.length > 0 && maquinas.every((m) => m.semLacoDeVoz?.includes(harness) === true);
  }
  /** Alguma máquina viva da pessoa tem o gh: o registro automático do GitHub pode nascer dele. */
  function ghDaPessoa(pessoaId: string): boolean {
    return [...conexoes.entries()].some(([id, c]) => c.escopo.pessoaId === pessoaId && ghDaMaquina(c.escopo, id));
  }
  /** ADR-090: nome e plataforma da máquina viva do turno, para o prompt nomeá-la. null = não conectada (ou de outra pessoa). */
  function maquina(escopo: Escopo, machineId: string): { nome: string; plataforma: PlataformaMaquina } | null {
    const c = conexoes.get(machineId);
    if (!c || c.escopo.pessoaId !== escopo.pessoaId || c.escopo.tenantId !== escopo.tenantId) return null;
    return { nome: c.nome, plataforma: c.plataforma };
  }
  /**
   * ADR-103: as capacidades que a máquina viva do turno anunciou por IA (AnuncioMaquina.capacidades). {} = não anunciou
   * (app antigo) ou não está conectada; quem decide o terminal do Codex lê daqui.
   */
  function capacidadesDaMaquina(escopo: Escopo, machineId: string): Partial<Record<IdHarness, CapacidadesHarness>> {
    const c = conexoes.get(machineId);
    if (!c || c.escopo.pessoaId !== escopo.pessoaId || c.escopo.tenantId !== escopo.tenantId) return {};
    return c.ponte.maquinasConectadas().find((m) => m.machineId === machineId)?.capacidades ?? {};
  }
  /**
   * definido em 2026-10-15 (NOD-288): como `capacidadesDaMaquina`, mas `undefined` ("não sei") quando a máquina não está
   * conectada a este processo — o servidor recém-reiniciado antes de ela reconectar. Quem recompõe o plano lê daqui para
   * não tirar o terminal do Codex por falta de conexão; o despacho segue com `capacidadesDaMaquina`.
   */
  function capacidadesDaMaquinaConectada(escopo: Escopo, machineId: string): Partial<Record<IdHarness, CapacidadesHarness>> | undefined {
    const c = conexoes.get(machineId);
    if (!c || c.escopo.pessoaId !== escopo.pessoaId || c.escopo.tenantId !== escopo.tenantId) return undefined;
    return capacidadesDaMaquina(escopo, machineId);
  }
  /** ADR-090: as máquinas vivas da pessoa (último contato há menos de 60 s), para a tela "Máquinas". */
  function maquinasDaPessoa(escopo: Escopo): MaquinaConectada[] {
    return [...conexoes.entries()].flatMap(([id, c]) => {
      if (c.escopo.pessoaId !== escopo.pessoaId || c.escopo.tenantId !== escopo.tenantId || d.agora() - c.ultimo >= 60_000) return [];
      const anunciadas = Object.entries(harnesses(c.escopo, id));
      const ias = Object.fromEntries(anunciadas.map(([h, inv]) => [h, inv?.estado])) as MaquinaConectada["ias"];
      const iasDetalhe = Object.fromEntries(anunciadas.flatMap(([h, inv]) => (inv ? [[h, detalheDaIa(inv)]] : []))) as MaquinaConectada["iasDetalhe"];
      return [{ machineId: id, nome: c.nome, plataforma: c.plataforma, ias, iasDetalhe, gh: c.gh, atualizaIas: c.anuncio?.atualizaIas === true }];
    });
  }
  /**
   * NOD-96 PR 3: as máquinas da pessoa com o que cada uma anunciou do computador, para o despachante do driver `motor`.
   * Inclui as sem contato (o `ultimoContato` diz): `maquina_id` fixo numa máquina parada falha com o nome dela.
   */
  function maquinasComComputador(escopo: Escopo): MaquinaDaPessoa[] {
    return [...conexoes.entries()].flatMap(([id, c]) => {
      if (c.escopo.pessoaId !== escopo.pessoaId || c.escopo.tenantId !== escopo.tenantId || d.agora() - c.ultimo >= 60_000) return [];
      return [{ machineId: id, nome: c.nome, plataforma: c.plataforma, papel: c.papel, computador: c.anuncio?.computador?.estado ?? null, ultimoContato: c.ultimo, ...(c.anuncio?.versaoApp ? { versaoApp: c.anuncio.versaoApp } : {}), ...(c.anuncio?.vmLocal ? { vmLocal: c.anuncio.vmLocal } : {}) }];
    });
  }
  /** ADR-102: a pessoa renomeou a máquina; a conexão viva passa a usar o nome novo. */
  function renomear(escopo: Escopo, machineId: string, nome: string): void {
    const c = conexoes.get(machineId);
    if (c && c.escopo.pessoaId === escopo.pessoaId && c.escopo.tenantId === escopo.tenantId) c.nome = nome;
  }
  /** NOD-175: a partir daqui o puxar volta `{plano:null}` na hora; renovar e entregar seguem aceitos. Não se desfaz. */
  function iniciarDrenagem(): void { drenando = true; }
  /** NOD-175: quantos `ponte.puxar` estão em voo (reserva que pode virar token vivo). */
  function reservasEmVoo(): number { return reservando; }
  return { rotas, inventario: atual, varrer, harnesses, harnessesDaPessoa, prontosPorMaquinaDaPessoa, maquina, capacidadesDaMaquina, capacidadesDaMaquinaConectada, maquinasDaPessoa, maquinasComComputador, renomear, ultimoContato, ghDaMaquina, ghDaPessoa, ligacaoDaPessoa, semLacoDeVozDaPessoa, iniciarDrenagem, reservasEmVoo };
}
