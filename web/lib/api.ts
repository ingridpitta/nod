import type { PreviaDoMoverDto } from "../../src/contracts/previa-mover.ts";
import type { Prioridade } from "../../src/contracts/quadro-opcoes.ts";
import type { Time, TimeNaLista } from "../../src/contracts/time.ts";
import type { ModoAcionar, PassosDoRunDto, PreviaComentarioDto, RunDaTarefa } from "../../src/contracts/quadro-comentarios.ts";
import type { DetalheVersaoPerfil, ListaVersoesPerfil, VersaoPerfil } from "../../src/contracts/versoes-perfil.ts";
import type { AtividadeDto, ContagemDaAtividade } from "../../src/contracts/atividade.ts";
import type { DecisoesDto } from "../../src/contracts/decisoes-do-bot.ts";
import type { PaginaDaBiblioteca } from "../../src/contracts/biblioteca.ts";
import type { PaginaDaBusca } from "../../src/contracts/busca.ts";
import type { AnexoMeta } from "../../src/contracts/anexo.ts";
import type { CheckpointDaFala } from "../../src/contracts/checkpoint.ts";
import type { ArtefatoDto } from "../../src/contracts/artefato.ts";
import type { AcaoComputador, ComputadorDto, ResultadoComputador } from "../../src/contracts/computador.ts";
import { lerComputadorPessoa, type ComputadorPessoaDto, type OperacaoPessoa } from "./computador-pessoa.ts";
import type { DisponibilidadeDitado } from "../../src/contracts/ditado.ts";
import type { PreferenciaHarness } from "../../src/contracts/harness.ts";
import type { Agente, FormaAgente, CorAgente, ModoAprovacao } from "../../src/contracts/agente.ts";
import type { AmbienteBancoDto, ChaveEmitidaDto, ChaveMaquinaDto, ConversaDto, FrotaDto, ModoSessaoDto, RespostaMutacao, RotinaDto, SuaVezDto } from "../../src/contracts/api.ts";
import type { Concessao } from "../../src/contracts/concessao.ts";
import { cabecalhosDoApp, cabecalhosDoGoogleApp } from "./desafio-app.ts";
import type { MaquinasDto } from "../../src/contracts/maquina.ts";
import type { OpcoesRemover, PreviaRemoverDto, ResultadoRemoverDto } from "../../src/contracts/remover-computador.ts";
import type { InstalacaoCriadaDto, InstalacaoSshDto, MetodoSsh } from "../../src/contracts/instalacoes-ssh.ts";
import type { CadastroDto, EntrarDto, EsperaPareamentoDto, EstadoContaDto, EstadoPareamentoDto, ImportarDto, PareamentoAbertoDto, PedirPareamentoDto, RedefinirDto, SessoesDto, TrocarSenhaDto, VerificarDto } from "../../src/contracts/conta.ts";
import type { ContaNuvemDto, DormirAposMin, MaquinaCriandoDto, TamanhoMaquinaNuvem } from "../../src/contracts/provedor-nuvem.ts";
import type { CodigoCifrado, ContasIaDto, FrenteAtivaDaConta, IaComConta, LoginNaMaquina, ModoDasContas, MotivoDaNota } from "../../src/contracts/contas-ia.ts";
import type { EntradaRelato, Relato } from "../../src/contracts/relato.ts";
import type { Experimentos, ExibirDoQuadro, Preferencias, RaioXConversa, RaioXTurno } from "../../src/contracts/raio-x.ts";
import type { ComandosDto } from "../../src/contracts/comandos.ts";
import type { LeituraMarcada, NaoLidosDto, RespostaLeitura } from "../../src/contracts/nao-lidos.ts";
import type { Conector } from "../../src/contracts/conector.ts";
import type { AgendaDto } from "../../src/contracts/agenda.ts";
import type { Conversa } from "../../src/contracts/conversa.ts";
import type { EstadoExecutor, IdExecutor } from "../../src/contracts/executor.ts";
import type { Inventario } from "../../src/contracts/inventario.ts";
import type { IasDaPessoa, InteligenciaBot, PedidoInteligencia } from "../../src/contracts/inteligencia.ts";
import type { DecisaoDaPessoa } from "../../src/contracts/troca-de-ia.ts";
import type { OpcaoRitmo } from "../../src/contracts/rotina-ritmo.ts";
import type { UsoDoPlanoDto } from "../../src/contracts/uso-do-plano.ts";
import type { IdHarness } from "../../src/contracts/harness.ts";
import type { EntradaDiario, Memoria, PaginaDiario, TipoMemoria } from "../../src/contracts/memoria.ts";
import type { ReacaoNaFala } from "../../src/contracts/reacao.ts";
import type { AppComLogo } from "../../src/contracts/marketplace.ts";
import type { ConfirmarEmailDto, ExportacaoDto, FormasDto, MinhaContaDto, PerfilDto, ReautenticarDto } from "../../src/contracts/minha-conta.ts";
import type { ExecucaoRotina } from "../../src/contracts/rotina.ts";
import type { MembroSala, Sala } from "../../src/contracts/sala.ts";
import type { FaixaParada, Turno } from "../../src/contracts/turno.ts";
import type { ComentarioDto, ComentarioTarefa, EntradaHistoricoDto, GrupoColuna, LinhaMuralDto, LoteQuadro, ModoConversa, QuadroCompartilhadoDto, QuadroDaPessoaDto, QuadroDto, StatusTarefa, TarefaPorCodigoDto } from "../../src/contracts/quadro.ts";
import type { FiltroImportacao, ImportacaoDto, PreviaDaTela } from "../../src/contracts/quadro-importacao.ts";
import type { CamposDeLabel, CorLabel } from "../../src/contracts/quadro-labels.ts";
import type { PreviaAssumir, ResultadoAssumir } from "../../src/contracts/quadro-assumir.ts";
import type { EventoTrilhaQuadro } from "../../src/contracts/trilha-quadro.ts";
import type { Projeto, QuadrosDoBotDto } from "../../src/contracts/quadros-do-bot.ts";
import type { EstadoExecucao, ExecucoesDaTarefa } from "../../src/contracts/quadro-execucoes.ts";
import type { AppDto, PaginasDto } from "../../src/contracts/apps.ts";
import type { AppCanvasDto, CanvasItemDto, ComentarioCanvasDto, NivelCanvasDto, NovoComentarioDto, VistaCanvasDto } from "../../src/contracts/canvas.ts";
import type { AtividadeTarefa } from "../../src/contracts/quadro-pela-conversa.ts";
import type { EventoLinha, TaxaDeAbertura, TrabalhoDetalheDto, TrabalhosDto } from "../../src/contracts/trabalho.ts";
import type { DisponibilidadeLigacao, FalaLigacao, Ligacao, LigacaoCriada } from "../../src/contracts/ligacao.ts";
import type { IaDaLigacao } from "../../src/contracts/voz.ts";
import type { AcaoComandoVoz } from "../../src/contracts/voz.ts";
import type { IdVozNod, VelocidadeVoz } from "../../src/contracts/vozes.ts";
import type { MotivoAvaliacaoLigacao } from "./ligacao-protocolo.ts";
import type { WorkspaceDto } from "../../src/contracts/workspace.ts";
import type { EstadoOnboarding, PedidoEtapaOnboarding } from "../../src/contracts/onboarding.ts";
import type { Escopo } from "../../src/shared/types.ts";
import { corpoDoEnvio } from "./envio-idempotente.ts";
import { podeRepetir, tentarDeNovo } from "./tentar-de-novo.ts";
import { ErroApi, ehAbort, erroDaResposta, falhaDeTransporte, rotaDe } from "./erro-api.ts";

/** ADA-241: GET /conectores/:id/acessos. */
export type AcessosDoAppDto = { padrao: "nenhum" | "leitura" | "escrita"; bots: { agenteId: string; nivel: "nenhum" | "leitura" | "escrita" | "personalizado"; segue_padrao: boolean }[] };
/** ADA-241: POST /conectores/:id/acessos/lote. `lote_id` nulo: nada mudou (não há o que desfazer). */
export type LoteDeAcessosDto = { ok: true; lote_id: string | null; frase: string; aplicados: { agenteId: string; nome: string }[]; mantidos: { agenteId: string; nome: string }[]; ja_feito: boolean };

export { ErroApi, FRASE_SEM_INTERNET, FRASE_SERVIDOR_INDISPONIVEL, rotaDe } from "./erro-api.ts";

/**
 * Cliente REST da web (ADR-020: a web DECIDE, nunca executa; ADR-018: só `import type` de src).
 * Toda rota escopada vai por /api/t/:tenantId (ADR-005); o cookie da sessão vai sozinho. Erro do
 * servidor chega como `ErroApi` com o código FECHADO da tabela de erros — a web renderiza o código,
 * nunca inventa texto a partir de err.message (ADR-002/004).
 */
export type SalaDto = { sala: Sala; membros: MembroSala[] };
export type RegistroCatcher = { id: string; turnoId: string; tipo: string; dados: Record<string, unknown>; em: number };

/**
 * Quem acompanha a rede (main.ts): `falhou` a cada falha de transporte (inclusive as que ainda vão repetir), `voltou`
 * quando o nod responde qualquer coisa. Um só, como o resto do estado da página.
 */
export type ObservadorDeRede = { falhou(e: ErroApi): void; voltou(): void };
let observador: ObservadorDeRede | null = null;
export function observarRede(o: ObservadorDeRede | null): void {
  observador = o;
}

/**
 * `silencioso`: chamada de fundo que a pessoa não fez (o lote da telemetria, inclusive o do `pagehide`): a falha dela
 * não acende o "Reconectando…" (revisão NOD-215) — quem chama já engole o erro.
 */
type OpcoesPedido = { keepalive?: true; silencioso?: true; signal?: AbortSignal; cabecalhos?: Record<string, string> };

async function pedir<T>(metodo: string, url: string, corpo?: unknown, opcoesPedido: OpcoesPedido = {}): Promise<T> {
  const rota = rotaDe(metodo, url);
  const { silencioso, cabecalhos, ...opcoes } = opcoesPedido;
  const obs = silencioso ? null : observador;
  let r: Response;
  try {
    r = await fetch(url, {
      method: metodo,
      headers: { ...(corpo === undefined ? {} : { "content-type": "application/json" }), ...cabecalhos },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
      ...opcoes,
    });
  } catch (e) {
    // Navegação/troca de tela cancelou: não é falha, ninguém precisa de aviso.
    if (ehAbort(e)) throw e;
    const falha = falhaDeTransporte(rota);
    obs?.falhou(falha);
    throw falha;
  }
  let texto = "";
  try {
    texto = await r.text();
  } catch (e) {
    if (ehAbort(e)) throw e;
    const falha = falhaDeTransporte(rota);
    obs?.falhou(falha);
    throw falha;
  }
  let lido: unknown = null;
  try {
    lido = texto === "" ? null : JSON.parse(texto);
  } catch {
    lido = null;
  }
  if (!r.ok) {
    const erro = erroDaResposta(r.status, lido, rota);
    if (erro.codigo === "servidor_indisponivel") obs?.falhou(erro);
    else obs?.voltou();
    throw erro;
  }
  obs?.voltou();
  return lido as T;
}

/** GET e mutação com chave de idempotência atravessam alguns segundos de servidor fora (web/lib/tentar-de-novo.ts). */
function pedirDeNovoSeCair<T>(metodo: string, url: string, corpo?: unknown, chave?: string): Promise<T> {
  if (!podeRepetir(metodo, chave)) return pedir<T>(metodo, url, corpo);
  return tentarDeNovo(() => pedir<T>(metodo, url, corpo));
}

function subir(url: string, arquivo: File, mime: string, aoProgresso?: (fracao: number) => void): Promise<AnexoMeta> {
  const rota = rotaDe("POST", url);
  // Upload não repete sozinho (não é idempotente): só a frase certa.
  return new Promise((resolver, rejeitar) => {
    const x = new XMLHttpRequest();
    x.open("POST", url);
    x.setRequestHeader("content-type", mime);
    x.setRequestHeader("x-nod-nome", encodeURIComponent(arquivo.name));
    x.upload.onprogress = (e) => { if (e.lengthComputable) aoProgresso?.(e.loaded / e.total); };
    x.onerror = () => {
      const falha = falhaDeTransporte(rota);
      observador?.falhou(falha);
      rejeitar(falha);
    };
    x.onload = () => {
      let lido: unknown = null;
      try { lido = JSON.parse(x.responseText); } catch { lido = null; }
      if (x.status >= 200 && x.status < 300) {
        observador?.voltou();
        // Corpo vazio/ilegível num 2xx: objeto vazio como antes do NOD-215 (quem chama lê meta.id sem estourar).
        resolver((lido ?? {}) as AnexoMeta);
        return;
      }
      const erro = erroDaResposta(x.status, lido, rota);
      if (erro.codigo === "servidor_indisponivel") observador?.falhou(erro);
      else observador?.voltou();
      rejeitar(erro);
    };
    x.send(arquivo);
  });
}

export type Api = ReturnType<typeof criarApi>;

/** `de`, `ate`, `fuso` e o filtro (sem "tudo"): a mesma consulta na lista e no CSV, para as linhas baterem. */
function consultaDasDecisoes(q: { de: string; ate?: string; fuso: string; desfecho?: string }): string {
  const p = new URLSearchParams({ de: q.de, ate: q.ate ?? q.de, fuso: q.fuso });
  if (q.desfecho && q.desfecho !== "tudo") p.set("desfecho", q.desfecho);
  return p.toString();
}

export type { MotivoAvaliacaoLigacao };

/** O corpo da decisão por voz (plano, "Aprovação por voz" §5): o servidor confere o comando e monta o resto. */
export type DecisaoPorVoz = { canal: "voz"; ligacaoId: string; comandoId: string; acao: AcaoComandoVoz };

/** Chamado pelo motor da ligação (web/lib/ligacao.ts) ao receber `comando`: a decisão sai com o cookie da própria página. */
export function decidirPorVoz(tenantId: string, decisaoId: string, corpo: DecisaoPorVoz): Promise<RespostaMutacao> {
  return pedir<RespostaMutacao>("POST", `/api/t/${encodeURIComponent(tenantId)}/decisoes/${encodeURIComponent(decisaoId)}/decidir`, corpo);
}

/** NOD-442: a resposta de uma mutação do quadro (a rota devolve o lote inteiro; a web lê o quadro e o lote). */
/** `comecaram`: os bots que este lote fez começar (revisão do PR #623: o recibo diz "Ada começou", com Desfazer). */
export type MutacaoQuadro = { ok: true; quadro: QuadroDto | null; lote: LoteQuadro | null; desfeito: boolean; comecaram?: { tarefaId: string; agenteId: string; agenteNome: string; turnoId: string }[] };
/** NOD-418: Repetir, Cancelar e recado devolvem o quadro, o trabalho que ficou e a vista da tarefa aberta. */
export type MutacaoDoTrabalho = MutacaoQuadro & { trabalho?: { numero: number | null; estado: EstadoExecucao | null; entregue?: "agora" | "quando_comecar" | "novo"; cancelados?: number }; trabalhos?: ExecucoesDaTarefa };

/**
 * ADA-14 (ADR-153): toda rota `agentes/:id/quadro…` vai para o quadro aberto daquele bot (`?quadro=`). Sem quadro escolhido,
 * o caminho fica como está e o servidor usa o padrão do bot. Assim as mutações da tela (tarefas, colunas, meta) não
 * precisam carregar o id: quem troca de quadro é o seletor, com `usarQuadro`.
 */
export function comQuadroAberto(caminho: string, abertos: ReadonlyMap<string, string>): string {
  const m = /^agentes\/([^/?]+)\/quadro(?=\/|\?|$)/.exec(caminho);
  if (!m) return caminho;
  let id: string;
  try { id = decodeURIComponent(m[1]!); } catch { return caminho; }
  const q = abertos.get(id);
  if (!q || /[?&]quadro=/.test(caminho)) return caminho;
  return `${caminho}${caminho.includes("?") ? "&" : "?"}quadro=${encodeURIComponent(q)}`;
}

export function criarApi(escopo: Escopo) {
  const base = `/api/t/${encodeURIComponent(escopo.tenantId)}`;
  /** ADA-14: o quadro aberto de cada bot (só em memória; o servidor guarda o último aberto). */
  const abertos = new Map<string, string>();
  const url = (caminho: string) => `${base}/${comQuadroAberto(caminho, abertos)}`;
  const get = <T>(caminho: string) => pedirDeNovoSeCair<T>("GET", url(caminho));
  const post = <T>(caminho: string, corpo?: unknown) => pedir<T>("POST", url(caminho), corpo ?? {});
  const patch = <T>(caminho: string, corpo: unknown) => pedir<T>("PATCH", url(caminho), corpo);
  const del = <T>(caminho: string) => pedir<T>("DELETE", url(caminho));
  return {
    escopo,
    /** ADA-14: escolhe o quadro que as rotas do bot usam (null volta ao padrão). */
    usarQuadro: (agenteId: string, quadroId: string | null) => { if (quadroId) abertos.set(agenteId, quadroId); else abertos.delete(agenteId); },
    /** ADA-14: o seletor (os quadros do bot, os projetos e o aberto) e a troca, que o servidor guarda como o último aberto. */
    quadrosDoBot: async (agenteId: string) => (await get<{ quadros: QuadrosDoBotDto }>(`agentes/${encodeURIComponent(agenteId)}/quadros`)).quadros,
    abrirQuadroDoBot: (agenteId: string, quadroId: string) => pedir<{ ok: true }>("PUT", `${base}/agentes/${encodeURIComponent(agenteId)}/quadros/aberto`, { quadro: quadroId }),
    criarProjeto: async (campos: { nome: string }) => (await post<{ projeto: Projeto }>("projetos", campos)).projeto,
    workspace: (id: string) => get<WorkspaceDto>(`conversas/${id}/workspace`),
    pastasWorkspace: (id: string, caminho?: string) => post<{ caminho: string; pai: string; selecionavel: boolean; pastas: { nome: string; caminho: string }[] }>(`conversas/${id}/workspace/pastas`, { caminho }),
    escolherWorkspace: (id: string, pasta: string) => post(`conversas/${id}/workspace`, { pasta }),
    revogarWorkspace: (id: string) => del(`conversas/${id}/workspace`),
    permitirPasta: (propostaId: string, pasta: string) => post(`propostas/${propostaId}/permitir-pasta`, { pasta }),
    computador: (id: string) => get<ComputadorDto>(`agentes/${encodeURIComponent(id)}/computador`),
    /** NOD-95 (ADR-138): o WebSocket da tela ao vivo do bot (mesma origem; o cookie da sessão vai sozinho). */
    urlVivo: (id: string) => `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}${base}/agentes/${encodeURIComponent(id)}/computador/vivo`,
    /** NOD-97: `origem` diz de onde veio a troca de controle (o servidor de antes ignora o campo). */
    configurarComputador: (id: string, operacao: string, origem?: "botao" | "clique" | "fechou_tela") => post<{ ok: true }>(`agentes/${encodeURIComponent(id)}/computador`, origem === undefined ? { operacao } : { operacao, origem }),
    /**
     * NOD-97: fechar a tela (ou a aba) no controle devolve ao bot. keepalive deixa o POST terminar depois de a página sair;
     * o que falhar aqui se perde, sem aviso (a ociosidade do controle cobre).
     */
    devolverComputadorAoSair: (id: string) => pedir<{ ok: true }>("POST", `${base}/agentes/${encodeURIComponent(id)}/computador`, { operacao: "devolver", origem: "fechou_tela" }, { keepalive: true, silencioso: true }).then(() => undefined, () => undefined),
    acaoComputador: (id: string, acao: AcaoComputador) => post<ResultadoComputador>(`agentes/${encodeURIComponent(id)}/computador/acoes`, acao),
    /**
     * Computador do bot v2 (NOD-96): o computador da pessoa, uma tela por bot. null = a rota não existe ou respondeu
     * fora do contrato (NOD_COMPUTADORES desligado): a web fica no modelo de antes. Sem nova tentativa: é sondagem.
     */
    computadorDaPessoa: async (): Promise<ComputadorPessoaDto | null> => {
      try {
        return lerComputadorPessoa(await pedir<unknown>("GET", `${base}/computador`));
      } catch {
        return null;
      }
    },
    operarComputador: (operacao: OperacaoPessoa) => post<unknown>("computador", { operacao }),
    trocarLugarDoComputador: (maquinaId: string, semLogins: boolean) => post<{ ok: true }>("computador/lugar", { maquinaId, semLogins }),
    urlEventos: `${base}/eventos`,
    frota: () => get<FrotaDto>("frota"),
    gestaoAgentes: () => get<FrotaDto>("gestao-agentes"),
    organizarAgente: (id: string, campos: { secao?: string; naoLido?: boolean; fixado?: boolean; ordem?: string[] }) => patch<{ agente: Agente }>(`agentes/${id}/organizacao`, campos),
    /** NOD-437: os times de bots da barra (cada mutação chama o mesmo executor do gerir_times). */
    sincronizarTimes: () => post<{ times: TimeNaLista[] }>("times/sincronizar", {}),
    criarTime: (campos: { nome: string; posicao?: number; recolhido?: boolean; bots?: string[] }) => post<{ time: Time; movidos: string[] }>("times", campos),
    renomearTime: (id: string, nome: string) => patch<{ time: Time }>(`times/${encodeURIComponent(id)}`, { nome }),
    ordenarTime: (id: string, posicao: number) => patch<{ time: Time }>(`times/${encodeURIComponent(id)}/posicao`, { posicao }),
    recolherTime: (id: string, recolhido: boolean) => patch<{ time: Time }>(`times/${encodeURIComponent(id)}/recolhido`, { recolhido }),
    excluirTime: (id: string) => del<{ time: Time; bots: { id: string; nome: string }[] }>(`times/${encodeURIComponent(id)}`),
    moverBotsParaTime: (bots: string[], time: string) => post<{ time: string; movidos: string[] }>("agentes/mover", { bots, time }),
    /** Não lidos (definido em 2026-09-29, 0039). */
    naoLidos: () => get<NaoLidosDto>("nao-lidos"),
    marcarLida: (conversaId: string) => post<RespostaLeitura>(`conversas/${conversaId}/lida`),
    marcarNaoLida: (conversaId: string) => post<RespostaMutacao>(`conversas/${conversaId}/nao-lida`),
    marcarTudoLido: () => post<RespostaLeitura>("nao-lidos/marcar-tudo"),
    /** NOD-449: o Desfazer de qualquer marcação como lida (as leituras que ela devolveu). */
    desfazerLeitura: (leituras: LeituraMarcada[]) => post<{ restauradas: number }>("nao-lidos/desfazer", { leituras }),
    /** NOD-449: o Desfazer do recibo que um bot deixou no chat ("Bia marcada como lida · Desfazer"). */
    desfazerRecibo: (mensagemId: string) => post<{ restauradas: number }>(`nao-lidos/recibos/${mensagemId}/desfazer`),
    excluirAgente: (id: string) => del<{ agente: Agente }>(`agentes/${id}`),
    restaurarAgente: (id: string) => post<{ agente: Agente }>(`agentes/${id}/restaurar`),
    inventario: (forcar = false) => get<Inventario>(`inventario${forcar ? "?forcar=1" : ""}`),
    ambiente: () => get<AmbienteBancoDto>("ambiente"),
    executor: () => get<EstadoExecutor>("executor"),
    trocarExecutor: (id: IdExecutor) => post<EstadoExecutor>("executor", { id }),
    // Plano das IAs (2026-10-10): a ordem do Automático da pessoa, o estado com o limite e os modelos; e a escolha do bot.
    ias: () => get<IasDaPessoa>("ias"),
    // definido em 2026-10-16 (plano "tela limpa", decisão E6): o anel de uso do seletor de IA no campo.
    usoDoPlano: () => get<UsoDoPlanoDto>("uso-do-plano"),
    gravarOrdemIas: (ordemIas: IdHarness[] | null) => pedir<Preferencias>("PUT", `${base}/preferencias`, { ordemIas }),
    gravarInteligencia: (agenteId: string, pedido: PedidoInteligencia) => pedir<{ agente: Agente }>("PUT", `${base}/agentes/${encodeURIComponent(agenteId)}/inteligencia`, pedido),
    inteligencia: (agenteId: string) => get<{ inteligencia: InteligenciaBot }>(`agentes/${encodeURIComponent(agenteId)}/inteligencia`),
    /** NOD-445 (ADR-146): as páginas do bot (a ordem no servidor) e os apps. Criar e editar vão pela conversa. */
    paginas: (agenteId: string) => get<{ paginas: PaginasDto }>(`agentes/${encodeURIComponent(agenteId)}/paginas`),
    ordenarPaginas: (agenteId: string, ordem: string[]) => pedir<{ paginas: PaginasDto }>("PUT", `${base}/agentes/${encodeURIComponent(agenteId)}/paginas/ordem`, { ordem }),
    removerApp: (agenteId: string, appId: string) => del<{ paginas: PaginasDto; app: AppDto }>(`agentes/${encodeURIComponent(agenteId)}/apps/${encodeURIComponent(appId)}`),
    restaurarApp: (agenteId: string, appId: string) => post<{ paginas: PaginasDto; app: AppDto }>(`agentes/${encodeURIComponent(agenteId)}/apps/${encodeURIComponent(appId)}/restaurar`),
    /** ADA-13 (ADR-150): o app Canvas. A gaveta do Marketplace (instalar, desinstalar, o nível por bot) e a página do bot. */
    appCanvas: () => get<AppCanvasDto>("canvas/app"),
    instalarCanvas: () => pedir<AppCanvasDto>("PUT", `${base}/canvas/app`, {}),
    desinstalarCanvas: () => del<AppCanvasDto>("canvas/app"),
    acessoCanvas: (agenteId: string, nivel: NivelCanvasDto | null) => pedir<AppCanvasDto>("PUT", `${base}/canvas/app/acessos/${encodeURIComponent(agenteId)}`, { nivel }),
    canvasDoAgente: (agenteId: string) => get<{ canvas: CanvasItemDto[] }>(`agentes/${encodeURIComponent(agenteId)}/canvas`),
    verCanvas: (canvasId: string) => get<VistaCanvasDto>(`canvas/${encodeURIComponent(canvasId)}`),
    blobsCanvas: (canvasId: string, hashes: readonly string[]) => get<{ blobs: Record<string, string> }>(`canvas/${encodeURIComponent(canvasId)}/blobs?hashes=${hashes.map(encodeURIComponent).join(",")}`),
    comentarCanvas: (canvasId: string, c: NovoComentarioDto) => post<{ comentario: ComentarioCanvasDto }>(`canvas/${encodeURIComponent(canvasId)}/comentarios`, c),
    resolverComentarioCanvas: (comentarioId: string, resolvido: boolean) => post<{ comentario: ComentarioCanvasDto }>(`canvas/comentarios/${encodeURIComponent(comentarioId)}/resolver`, { resolvido }),
    /** NOD-442 (ADR-135): a aba Quadro de um bot. Cada mutação devolve o quadro montado e o lote (o Desfazer usa o id dele). */
    quadro: (agenteId: string) => get<{ quadro: QuadroDto | null }>(`agentes/${encodeURIComponent(agenteId)}/quadro`),
    /** NOD-415 (ADR-141): meta e prazo opcionais; meta null tira (fluxo contínuo). */
    criarQuadro: (agenteId: string, campos: { meta?: string | null; prazo?: string | null; nome?: string; projeto?: string | null }) => post<MutacaoQuadro>(`agentes/${encodeURIComponent(agenteId)}/quadro`, campos),
    editarQuadro: (agenteId: string, campos: { meta?: string | null; prazo?: string | null }) => patch<MutacaoQuadro>(`agentes/${encodeURIComponent(agenteId)}/quadro`, campos),
    removerQuadro: (agenteId: string) => del<MutacaoQuadro>(`agentes/${encodeURIComponent(agenteId)}/quadro`),
    mudarTarefa: (agenteId: string, tarefaId: string, campos: { status?: StatusTarefa | string; agente?: string | null; titulo?: string; descricao?: string; sem_iniciar?: boolean; parar_anterior?: boolean; prioridade?: Prioridade } & CamposDeLabel) =>
      patch<MutacaoQuadro>(`agentes/${encodeURIComponent(agenteId)}/quadro/tarefas/${encodeURIComponent(tarefaId)}`, campos),
    /** NOD-416 (ADR-144): sem status, a tarefa cai no Backlog e ninguém começa. */
    criarTarefa: (agenteId: string, campos: { titulo: string; descricao?: string; status?: string; agente?: string | null; prioridade?: Prioridade; labels?: string[]; prazo_em?: string | null }) =>
      post<MutacaoQuadro>(`agentes/${encodeURIComponent(agenteId)}/quadro/tarefas`, campos),
    /** 0161: o catálogo de labels do quadro (pôr e tirar label na tarefa é o mudarTarefa: labels, por_labels, tirar_labels). */
    criarLabel: (agenteId: string, campos: { nome: string; cor?: CorLabel }) => post<MutacaoQuadro>(`agentes/${encodeURIComponent(agenteId)}/quadro/labels`, campos),
    editarLabel: (agenteId: string, labelId: string, campos: { nome?: string; cor?: CorLabel }) => patch<MutacaoQuadro>(`agentes/${encodeURIComponent(agenteId)}/quadro/labels/${encodeURIComponent(labelId)}`, campos),
    removerLabel: (agenteId: string, labelId: string) => del<MutacaoQuadro>(`agentes/${encodeURIComponent(agenteId)}/quadro/labels/${encodeURIComponent(labelId)}`),
    /** NOD-416: muda a tarefa para o quadro de outro bot (sem lote nem Desfazer; ninguém começa). */
    moverTarefa: (agenteId: string, tarefaId: string, quadro: string) =>
      post<MutacaoQuadro & { movida?: { tarefaId: string; codigo: string; codigoAntigo: string } }>(`agentes/${encodeURIComponent(agenteId)}/quadro/tarefas/${encodeURIComponent(tarefaId)}/mover`, { quadro }),
    /** 2026-11-10 (ADR-142): o diálogo de handoff — quem pega, se começa, o run de quem estava e o texto da etapa. */
    previaMover: (agenteId: string, tarefaId: string, coluna: string) =>
      get<PreviaDoMoverDto>(`agentes/${encodeURIComponent(agenteId)}/quadro/tarefas/${encodeURIComponent(tarefaId)}/previa-mover/${encodeURIComponent(coluna)}`),
    historicoTarefa: (agenteId: string, tarefaId: string) =>
      get<{ historico: EntradaHistoricoDto[] }>(`agentes/${encodeURIComponent(agenteId)}/quadro/tarefas/${encodeURIComponent(tarefaId)}/historico`),
    /** NOD-416: o link `?tarefa=ZE-12` (o código antigo também resolve, para a tarefa que mudou de quadro). */
    tarefaPorCodigo: (codigo: string) => get<TarefaPorCodigoDto>(`quadro/tarefas/${encodeURIComponent(codigo)}`),
    quadros: () => get<{ quadros: QuadroDaPessoaDto[] }>("quadros"),
    /** NOD-422: "Trazer do Linear…" pela tela. A prévia só lê; o importar começa a trazer (o progresso vem no quadro). */
    previaImportacao: (agenteId: string, time: string, filtro: FiltroImportacao | null) =>
      get<PreviaDaTela>(`agentes/${encodeURIComponent(agenteId)}/quadro/importacao/previa?time=${encodeURIComponent(time)}${filtro ? `&filtro=${encodeURIComponent(filtro)}` : ""}`),
    importarTimeLinear: (agenteId: string, time: string, filtro: FiltroImportacao | null) =>
      post<{ ok: true; importacao: ImportacaoDto }>(`agentes/${encodeURIComponent(agenteId)}/quadro/importacao`, { time, ...(filtro ? { filtro } : {}) }),
    /** NOD-422 (PR 2): o quadro assume a esteira. A lista só lê; o Assumir (só as `rotinas` vistas) e o Desfazer. */
    previaAssumir: (agenteId: string) => get<PreviaAssumir | { ok: false; erro: string; detalhe: string }>(`agentes/${encodeURIComponent(agenteId)}/quadro/assumir`),
    assumirQuadro: (agenteId: string, rotinas: readonly string[]) => post<ResultadoAssumir>(`agentes/${encodeURIComponent(agenteId)}/quadro/assumir`, { rotinas }),
    desfazerAssumir: (agenteId: string) => del<ResultadoAssumir>(`agentes/${encodeURIComponent(agenteId)}/quadro/assumir`),
    /** NOD-422 (PR 2): a trilha do quadro (só ids). Fundo, como a telemetria das linhas: a falha some em silêncio. */
    trilhaQuadro: (eventos: readonly EventoTrilhaQuadro[]) => pedir<{ gravados: number }>("POST", `${base}/telemetria/quadro`, { eventos }, { keepalive: true, silencioso: true }),
    /** ADA-15: `avancar` = "Responder e seguir" (responde e manda a tarefa para a próxima coluna). */
    responderTarefa: (agenteId: string, tarefaId: string, resposta: string, avancar = false) =>
      post<MutacaoQuadro>(`agentes/${encodeURIComponent(agenteId)}/quadro/tarefas/${encodeURIComponent(tarefaId)}/resposta`, { resposta, ...(avancar ? { avancar: true } : {}) }),
    /** NOD-417: os comentários da tarefa; o da pessoa aciona o responsável e @nome aciona outro bot. */
    comentariosDaTarefa: (agenteId: string, tarefaId: string) =>
      get<{ comentarios: ComentarioDto[]; atividade?: AtividadeTarefa[]; criadaPor?: string | null; runs?: RunDaTarefa[] }>(`agentes/${encodeURIComponent(agenteId)}/quadro/tarefas/${encodeURIComponent(tarefaId)}/comentarios`),
    /** 2026-11-10: responder_a (a thread) e a escolha de cada chip. */
    comentarTarefa: (agenteId: string, tarefaId: string, texto: string, extra: { responderA?: string | null; acionar?: { agente: string; modo: ModoAcionar }[] } = {}) =>
      post<MutacaoQuadro & { comentario: ComentarioTarefa }>(`agentes/${encodeURIComponent(agenteId)}/quadro/tarefas/${encodeURIComponent(tarefaId)}/comentarios`, { texto, ...(extra.responderA ? { responder_a: extra.responderA } : {}), ...(extra.acionar?.length ? { acionar: extra.acionar } : {}) }),
    /** 2026-11-10: os chips antes de enviar (a mesma conta do servidor). */
    previaComentario: (agenteId: string, tarefaId: string, texto: string, responderA: string | null) =>
      get<PreviaComentarioDto>(`agentes/${encodeURIComponent(agenteId)}/quadro/tarefas/${encodeURIComponent(tarefaId)}/comentarios/previa?texto=${encodeURIComponent(texto)}${responderA ? `&responder_a=${encodeURIComponent(responderA)}` : ""}`),
    /** 2026-11-10: `refazer` cancela o run vivo do comentário e reaciona (o mesmo texto: "Mandar como run novo", Repetir). */
    editarComentario: (agenteId: string, tarefaId: string, comentarioId: string, texto: string, refazer = false) =>
      patch<MutacaoQuadro>(`agentes/${encodeURIComponent(agenteId)}/quadro/tarefas/${encodeURIComponent(tarefaId)}/comentarios/${encodeURIComponent(comentarioId)}`, { texto, ...(refazer ? { refazer: true } : {}) }),
    apagarComentario: (agenteId: string, tarefaId: string, comentarioId: string) =>
      del<MutacaoQuadro>(`agentes/${encodeURIComponent(agenteId)}/quadro/tarefas/${encodeURIComponent(tarefaId)}/comentarios/${encodeURIComponent(comentarioId)}`),
    /** ADR-165: os passos persistidos de um run da tarefa (o turno raiz), a página depois do seq `depois` (null = do começo). */
    passosDoRun: (agenteId: string, tarefaId: string, turnoId: string, depois: number | null = null) =>
      get<PassosDoRunDto>(`agentes/${encodeURIComponent(agenteId)}/quadro/tarefas/${encodeURIComponent(tarefaId)}/runs/${encodeURIComponent(turnoId)}/passos${depois !== null ? `?depois=${depois}` : ""}`),
    /** NOD-418: os trabalhos da tarefa aberta (o atual, os anteriores, os recados) e Repetir, Cancelar e o recado. */
    trabalhosDaTarefa: (agenteId: string, tarefaId: string) =>
      get<ExecucoesDaTarefa>(`agentes/${encodeURIComponent(agenteId)}/quadro/tarefas/${encodeURIComponent(tarefaId)}/trabalhos`),
    repetirTrabalho: (agenteId: string, tarefaId: string) =>
      post<MutacaoDoTrabalho>(`agentes/${encodeURIComponent(agenteId)}/quadro/tarefas/${encodeURIComponent(tarefaId)}/trabalhos/repetir`),
    cancelarTrabalho: (agenteId: string, tarefaId: string) =>
      post<MutacaoDoTrabalho>(`agentes/${encodeURIComponent(agenteId)}/quadro/tarefas/${encodeURIComponent(tarefaId)}/trabalhos/cancelar`),
    acordarTrabalho: (agenteId: string, tarefaId: string) =>
      post<MutacaoDoTrabalho>(`agentes/${encodeURIComponent(agenteId)}/quadro/tarefas/${encodeURIComponent(tarefaId)}/trabalhos/acordar`),
    recadoTrabalho: (agenteId: string, tarefaId: string, texto: string) =>
      post<MutacaoDoTrabalho>(`agentes/${encodeURIComponent(agenteId)}/quadro/tarefas/${encodeURIComponent(tarefaId)}/trabalhos/recado`, { texto }),
    desfazerLoteQuadro: (agenteId: string, loteId: string) =>
      post<MutacaoQuadro>(`agentes/${encodeURIComponent(agenteId)}/quadro/lotes/${encodeURIComponent(loteId)}/desfazer`),
    /** NOD-443 (ADR-143): as pessoas do quadro, o modo da conversa, o comentário e o mural de Atividade. */
    adicionarPessoa: (agenteId: string, pessoa: string, modo?: ModoConversa) =>
      post<MutacaoQuadro>(`agentes/${encodeURIComponent(agenteId)}/quadro/pessoas`, modo ? { pessoa, modo } : { pessoa }),
    tirarPessoa: (agenteId: string, pessoaId: string) =>
      del<MutacaoQuadro>(`agentes/${encodeURIComponent(agenteId)}/quadro/pessoas/${encodeURIComponent(pessoaId)}`),
    mudarModo: (agenteId: string, modo: ModoConversa) =>
      patch<MutacaoQuadro>(`agentes/${encodeURIComponent(agenteId)}/quadro/modo`, { modo }),
    comentar: (agenteId: string, c: { texto: string; tarefa?: string }) =>
      post<MutacaoQuadro>(`agentes/${encodeURIComponent(agenteId)}/quadro/comentarios`, c),
    atividadeQuadro: (agenteId: string) => get<{ linhas: LinhaMuralDto[] }>(`agentes/${encodeURIComponent(agenteId)}/quadro/atividade`),
    /**
     * NOD-455 (ADR-143): o quadro de outra pessoa, para quem participa. Só as rotas `/quadros/:qid…` (a porta da dona);
     * nunca `/agentes/:id/…` com o bot da dona. Pessoas, modo, colunas, meta e pr_url não têm método aqui: são só dela.
     */
    compartilhados: () => get<{ quadros: QuadroCompartilhadoDto[] }>("quadros/compartilhados"),
    quadroPorId: (qid: string) => get<{ quadro: QuadroDto }>(`quadros/${encodeURIComponent(qid)}`),
    atividadeDoQuadro: (qid: string) => get<{ linhas: LinhaMuralDto[] }>(`quadros/${encodeURIComponent(qid)}/atividade`),
    criarTarefaNoQuadro: (qid: string, campos: { titulo: string; descricao?: string }) => post<MutacaoQuadro>(`quadros/${encodeURIComponent(qid)}/tarefas`, campos),
    mudarTarefaNoQuadro: (qid: string, tarefaId: string, campos: { status?: string; titulo?: string; descricao?: string; excluir?: true } & CamposDeLabel) =>
      patch<MutacaoQuadro>(`quadros/${encodeURIComponent(qid)}/tarefas/${encodeURIComponent(tarefaId)}`, campos),
    responderNoQuadro: (qid: string, tarefaId: string, resposta: string) =>
      post<MutacaoQuadro>(`quadros/${encodeURIComponent(qid)}/tarefas/${encodeURIComponent(tarefaId)}/resposta`, { resposta }),
    desfazerNoQuadro: (qid: string, loteId: string) => post<MutacaoQuadro>(`quadros/${encodeURIComponent(qid)}/lotes/${encodeURIComponent(loteId)}/desfazer`),
    comentarNoQuadro: (qid: string, c: { texto: string; tarefa?: string }) => post<MutacaoQuadro>(`quadros/${encodeURIComponent(qid)}/comentarios`, c),
    /** NOD-448 (ADR-140): as colunas pela tela; cada uma é um lote com Desfazer. */
    criarColuna: (agenteId: string, c: { nome: string; grupo: GrupoColuna; depois_de?: string }) =>
      post<MutacaoQuadro>(`agentes/${encodeURIComponent(agenteId)}/quadro/colunas`, c),
    renomearColuna: (agenteId: string, coluna: string, nome: string) =>
      patch<MutacaoQuadro>(`agentes/${encodeURIComponent(agenteId)}/quadro/colunas/${encodeURIComponent(coluna)}`, { nome }),
    /** NOD-420: o prazo (SLA) da coluna em minutos; null tira. */
    prazoDaColuna: (agenteId: string, coluna: string, prazoMin: number | null) =>
      patch<MutacaoQuadro>(`agentes/${encodeURIComponent(agenteId)}/quadro/colunas/${encodeURIComponent(coluna)}`, { prazo_min: prazoMin }),
    moverColuna: (agenteId: string, coluna: string, onde: { antes_de?: string; depois_de?: string }) =>
      post<MutacaoQuadro>(`agentes/${encodeURIComponent(agenteId)}/quadro/colunas/${encodeURIComponent(coluna)}/mover`, onde),
    removerColuna: (agenteId: string, coluna: string, destino?: string) =>
      del<MutacaoQuadro>(`agentes/${encodeURIComponent(agenteId)}/quadro/colunas/${encodeURIComponent(coluna)}${destino ? `?destino=${encodeURIComponent(destino)}` : ""}`),
    /** NOD-419: a trava da coluna (sai_para null tira o destino; so_pessoa false tira) e o Desfazer de um movimento. */
    travarColuna: (agenteId: string, coluna: string, t: { sai_para?: string[] | null; so_pessoa?: boolean }) =>
      patch<MutacaoQuadro>(`agentes/${encodeURIComponent(agenteId)}/quadro/colunas/${encodeURIComponent(coluna)}/trava`, t),
    desfazerMovimento: (agenteId: string, tarefaId: string, movimentoId: string) =>
      post<MutacaoQuadro>(`agentes/${encodeURIComponent(agenteId)}/quadro/tarefas/${encodeURIComponent(tarefaId)}/movimentos/${encodeURIComponent(movimentoId)}/desfazer`),
    /** ADR-142: a passagem da coluna (agente null tira; instrucoes null apaga). */
    definirPassagem: (agenteId: string, coluna: string, p: { agente: string | null; instrucoes: string | null; proxima?: string | null; volta_para?: string | null }) =>
      pedir<MutacaoQuadro>("PUT", `${base}/agentes/${encodeURIComponent(agenteId)}/quadro/colunas/${encodeURIComponent(coluna)}/passagem`, p),
    /** NOD-380: `ate` (o id de uma fala achada na busca) faz a janela crescer até ela, mesmo fora das 200 recentes. */
    conversa: (id: string, ate?: string) => get<ConversaDto>(`conversas/${id}/mensagens${ate ? `?ate=${encodeURIComponent(ate)}` : ""}`),
    /** NOD-380: a busca de mensagens do celular; 20 por página, `cursor` vem da página anterior; `signal` cancela o pedido velho. */
    buscarMensagens: (q: string, cursor: string | null = null, signal?: AbortSignal) =>
      pedir<PaginaDaBusca>("GET", `${base}/busca/mensagens?q=${encodeURIComponent(q)}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`, undefined, { silencioso: true, ...(signal ? { signal } : {}) }),
    /** NOD-156: `idEnvio` é a chave da fala (nasce no compositor); o reenvio com a mesma chave não duplica. */
    enviar: (conversaId: string, texto: string, anexos: readonly string[] = [], idEnvio?: string, respondeA?: string) =>
      pedirDeNovoSeCair<RespostaMutacao>("POST", `${base}/conversas/${conversaId}/mensagens`, corpoDoEnvio(texto, anexos, idEnvio, respondeA), idEnvio),
    /** ADR-113: põe (`marcada`) ou tira a reação da pessoa numa fala; devolve as reações dela. */
    reagir: (mensagemId: string, emoji: string, marcada: boolean) => pedir<{ reacoes: ReacaoNaFala[] }>("PUT", `${base}/mensagens/${encodeURIComponent(mensagemId)}/reacoes`, { emoji, marcada }),
    /** NOD-54 (ADR-134): pede o desfazer do turno; `forcar` = "Voltar mesmo assim" nos conflitos. A recusa vem com `ok: false`. */
    desfazerTurno: (conversaId: string, turnoId: string, forcar = false) =>
      pedir<{ ok: true; checkpoint: CheckpointDaFala } | { ok: false; recusa: "vencido" | "outro_desfazendo" | "ja_desfazendo" | "nada_a_forcar" }>("POST", `${base}/conversas/${encodeURIComponent(conversaId)}/turnos/${encodeURIComponent(turnoId)}/desfazer`, { forcar }),
    /** ADR-046: o arquivo sobe cru (não em JSON) e volta como metadado; progresso só existe no XHR. */
    subirAnexo: (conversaId: string, arquivo: File, mime: string, aoProgresso?: (fracao: number) => void) => subir(`${base}/conversas/${conversaId}/anexos`, arquivo, mime, aoProgresso),
    urlAnexo: (conversaId: string, anexoId: string) => `${base}/conversas/${encodeURIComponent(conversaId)}/anexos/${encodeURIComponent(anexoId)}`,
    /** NOD-323 (J5): onde a mídia do bot está na máquina (o caminho relativo à ~/nod), para o Mostrar no Finder. */
    localDaMidia: (urlDoAnexo: string) => pedir<{ caminhoRelativo: string; maquinaId: string }>("GET", `${urlDoAnexo}/local`, undefined, { silencioso: true }),
    pararConversa: (conversaId: string) => post<FaixaParada>(`conversas/${conversaId}/parar`),
    pararTudo: () => post<FaixaParada>("parar"),
    turno: (id: string) => get<{ turno: Turno }>(`turnos/${id}`),
    cancelarTurno: (id: string) => post<RespostaMutacao>(`turnos/${id}/cancelar`),
    relatar: (entrada: EntradaRelato) => post<RespostaMutacao>("relatos", entrada),
    // Modo dev (0036): a preferência mora no servidor e o Raio-X é lido por conversa (a faixa) e por turno (a gaveta).
    preferencias: () => get<Preferencias>("preferencias"),
    // ADR-083: a faixa de Trabalhos recolhida também é preferência (só o campo que mudou vai no corpo).
    // ADR-111: `experimentos` leva só a chave que mudou ({ calibracao }, { memoriaLonga } ou, ADR-112, { whatsapp }; NOD-429, { quadro }).
    gravarPreferencias: (p: Partial<Pick<Preferencias, "modoDev" | "usoDoMac">> & { experimentos?: Partial<Experimentos> }) => pedir<Preferencias>("PUT", `${base}/preferencias`, p),
    // NOD-460 (0149): o Exibir do quadro em tela cheia, da pessoa e por quadro.
    exibirQuadro: (quadroId: string, e: Partial<ExibirDoQuadro>) => pedir<Preferencias>("PUT", `${base}/preferencias/quadros/${encodeURIComponent(quadroId)}/exibir`, e),
    raioXDaConversa: (id: string, desde: number) => get<RaioXConversa>(`conversas/${encodeURIComponent(id)}/raio-x?desde=${desde}`),
    raioXDoTurno: (id: string) => get<RaioXTurno>(`turnos/${encodeURIComponent(id)}/raio-x`),
    // O "/" do chat (0038): o catálogo do Mac e os comandos da conversa; a nova sessão é do nod.
    comandos: () => get<ComandosDto>("comandos"),
    novaSessao: (conversaId: string) => post<RespostaMutacao>(`conversas/${encodeURIComponent(conversaId)}/nova-sessao`),
    relatos: () => get<{ relatos: Relato[] }>("relatos"),
    // ADR-083 §8 (definido em 2026-10-07): os trabalhos (tasks) dos bots, a tela da task e o que se faz nela.
    trabalhos: (agenteId?: string) => get<TrabalhosDto>(agenteId ? `trabalhos?agenteId=${encodeURIComponent(agenteId)}` : "trabalhos"),
    trabalho: (id: string) => get<TrabalhoDetalheDto>(`trabalhos/${encodeURIComponent(id)}`),
    escreverNoTrabalho: (id: string, texto: string) => post<RespostaMutacao>(`trabalhos/${encodeURIComponent(id)}/mensagens`, { texto }),
    pararTrabalho: (id: string) => post<RespostaMutacao>(`trabalhos/${encodeURIComponent(id)}/parar`),
    // NOD-377: o Cobrar e o Desistir da espera de colega vencida.
    cobrarEspera: (agenteId: string, tarefaId: string) => post<{ ok: true; cobradoEm: number; cobrancas: number }>(`agentes/${encodeURIComponent(agenteId)}/esperas-de-colega/${encodeURIComponent(tarefaId)}/cobrar`),
    desistirDaEspera: (agenteId: string, tarefaId: string) => post<{ ok: true }>(`agentes/${encodeURIComponent(agenteId)}/esperas-de-colega/${encodeURIComponent(tarefaId)}/desistir`),
    trabalhoDepois: (id: string, depoisDe: string) => post<RespostaMutacao>(`trabalhos/${encodeURIComponent(id)}/depois`, { depoisDe }),
    trabalhoFazerAqui: (id: string) => post<RespostaMutacao>(`trabalhos/${encodeURIComponent(id)}/fazer-aqui`),
    // #191: o que a tela mostrou e o que a pessoa abriu, em lote; a taxa por tipo aparece no Modo dev.
    // Revisão W12 (2026-10-08): o último lote sai no `pagehide`; com keepalive o POST termina depois de a aba fechar.
    telemetriaLinhas: (eventos: readonly EventoLinha[]) => pedir<RespostaMutacao>("POST", `${base}/telemetria/linhas`, { eventos }, { keepalive: true, silencioso: true }),
    taxasLinhas: () => get<TaxaDeAbertura[]>("telemetria/linhas"),
    criarAgente: (nome?: string, perfil?: { titulo?: string; descricao?: string; interativo?: boolean }) => post<{ agente: Agente; conversa: Conversa }>("agentes", { dono: "pessoa", nome, ...perfil }),
    /** NOD-20: voz e vozVelocidade vão no mesmo PATCH; `versao` = a versão do perfil que a mudança gravou (null = nada mudou). */
    editarPerfil: (id: string, perfil: { nome?: string; titulo?: string; descricao?: string; modelo?: string; harness?: PreferenciaHarness; esforco?: string; forma?: FormaAgente; cor?: CorAgente; voz?: IdVozNod | null; vozVelocidade?: VelocidadeVoz }) =>
      patch<{ agente: Agente; versao?: number | null }>(`agentes/${id}`, perfil),
    /** NOD-20: o histórico de versões do perfil (só da dona), da mais nova para a mais velha; `antes` pagina. */
    versoesPerfil: (id: string, antes?: number) => get<ListaVersoesPerfil>(`agentes/${encodeURIComponent(id)}/perfil/versoes${antes ? `?antes=${antes}` : ""}`),
    versaoPerfil: (id: string, n: number) => get<DetalheVersaoPerfil>(`agentes/${encodeURIComponent(id)}/perfil/versoes/${n}`),
    restaurarVersao: (id: string, n: number, guarda: { esperada: number; aceitarRedacao?: boolean }) =>
      post<{ agente: Agente; versao: VersaoPerfil; propostasObsoletas: string[] }>(`agentes/${encodeURIComponent(id)}/perfil/versoes/${n}/restaurar`, guarda),
    // ADR-059: o botão de aprovações do campo; o servidor escreve a troca na conversa do bot. O total exige `confirmado`
    // (o segundo clique do menu, emenda de 2026-10-18): sem ele o servidor responde 400.
    mudarModoAprovacao: (id: string, modo: ModoAprovacao, confirmado = false) => post<{ agente: Agente; mudou: boolean }>(`agentes/${id}/modo-aprovacao`, confirmado ? { modo, confirmado: true } : { modo }),
    fixar: (id: string, fixado?: boolean) => post<{ agente: Agente }>(`agentes/${id}/fixar`, fixado === undefined ? {} : { fixado }),
    ocultar: (id: string, oculto?: boolean) => post<{ agente: Agente }>(`agentes/${id}/ocultar`, oculto === undefined ? {} : { oculto }),
    duplicar: (id: string) => post<{ agente: Agente; conversa: Conversa }>(`agentes/${id}/duplicar`),
    memorias: (agenteId: string) => get<{ memorias: Memoria[]; aRevisar?: number }>(`agentes/${agenteId}/memoria`),
    // NOD-58: o histórico da memória (50 por página; `antes` é a última entrada já mostrada), o desfazer e o revisar.
    diarioMemoria: (agenteId: string, antes?: string) => get<PaginaDiario>(`agentes/${agenteId}/memoria/diario${antes ? `?antes=${encodeURIComponent(antes)}` : ""}`),
    desfazerEntrada: (agenteId: string, entradaId: string) => post<{ entrada: EntradaDiario; memoria: Memoria | null; aRevisar: number }>(`agentes/${agenteId}/memoria/diario/${encodeURIComponent(entradaId)}/desfazer`, {}),
    revisarDiario: (agenteId: string, entradaId?: string) => post<{ revisadas: number; aRevisar: number }>(`agentes/${agenteId}/memoria/diario/revisar`, entradaId ? { entradaId } : {}),
    // Chat limpo (ADR-114, PR 2): a Atividade do bot, um dia por página, e só o "N hoje" da gaveta (contagem=1).
    atividade: (agenteId: string, dia: string, fuso: string) => get<AtividadeDto>(`agentes/${encodeURIComponent(agenteId)}/atividade?dia=${encodeURIComponent(dia)}&fuso=${encodeURIComponent(fuso)}`),
    /** NOD-70: a aba Decisões (uma página do período, com a contagem) e o CSV, que vem como arquivo (blob). */
    decisoes: (agenteId: string, q: { de: string; ate?: string; fuso: string; desfecho?: string; cursor?: string | null; limite?: number }) =>
      get<DecisoesDto>(`agentes/${encodeURIComponent(agenteId)}/decisoes?${consultaDasDecisoes(q)}${q.cursor ? `&cursor=${encodeURIComponent(q.cursor)}` : ""}${q.limite ? `&limite=${q.limite}` : ""}`),
    async decisoesCsv(agenteId: string, q: { de: string; ate: string; fuso: string; desfecho?: string }): Promise<{ blob: Blob; nome: string; linhas: number; cortado: boolean }> {
      const url = `${base}/agentes/${encodeURIComponent(agenteId)}/decisoes.csv?${consultaDasDecisoes(q)}`;
      let r: Response;
      try {
        r = await fetch(url, { credentials: "same-origin" });
      } catch (e) {
        if (ehAbort(e)) throw e;
        throw falhaDeTransporte(rotaDe("GET", url));
      }
      if (!r.ok) {
        let lido: unknown = null;
        try { lido = await r.json(); } catch { lido = null; }
        throw erroDaResposta(r.status, lido, rotaDe("GET", url));
      }
      const blob = await r.blob();
      const nome = /filename="?([^";]+)"?/.exec(r.headers.get("content-disposition") ?? "")?.[1] ?? "decisoes.csv";
      return { blob, nome, linhas: Number(r.headers.get("x-nod-csv-linhas") ?? "0") || 0, cortado: r.headers.get("x-nod-csv-cortado") === "1" };
    },
    /** NOD-326: a Biblioteca da gaveta do bot; `antes` é o cursor opaco da página anterior. */
    biblioteca: (conversaId: string, antes?: string | null) => get<PaginaDaBiblioteca>(`conversas/${encodeURIComponent(conversaId)}/biblioteca${antes ? `?antes=${encodeURIComponent(antes)}` : ""}`),
    // PR 4 dos modos de aprovação: "Devia ter perguntado" numa ação que o revisor liberou (grava; não desfaz nada).
    contestarRevisor: (acaoId: string) => post<{ contestadaEm: number; jaContestada: boolean }>(`acoes-do-modo/${encodeURIComponent(acaoId)}/contestar`),
    contagemAtividade: (agenteId: string, dia: string, fuso: string) => get<ContagemDaAtividade>(`agentes/${encodeURIComponent(agenteId)}/atividade?dia=${encodeURIComponent(dia)}&fuso=${encodeURIComponent(fuso)}&contagem=1`),
    // ADR-113: o "Lembrar disso" da fala manda a conversa, para a linha "Anotei …" aparecer nela.
    criarMemoria: (agenteId: string, tipo: TipoMemoria, texto: string, conversaId?: string) => post<{ memoria: Memoria }>(`agentes/${agenteId}/memoria`, { tipo, texto, ...(conversaId ? { conversaId } : {}) }),
    editarMemoria: (agenteId: string, id: string, campos: { texto?: string; tipo?: TipoMemoria }) => patch<{ memoria: Memoria }>(`agentes/${agenteId}/memoria/${id}`, campos),
    apagarMemoria: (agenteId: string, id: string) => del<RespostaMutacao>(`agentes/${agenteId}/memoria/${id}`),
    confirmarProposta: (id: string) => post<RespostaMutacao>(`propostas/${id}/confirmar`),
    recusarProposta: (id: string) => post<RespostaMutacao>(`propostas/${id}/recusar`),
    criarRotina: (entrada: { agenteId: string; cron: string; fusoIana: string; instrucao: string; fonte: string; entregavel: string; limitesAprovacao: string; politicaSemDado: string }) => post<RespostaMutacao>("rotinas", entrada),
    executarRotina: (id: string, opcoes?: { confirmar?: boolean }) => post<RespostaMutacao>(`rotinas/${id}/executar`, opcoes?.confirmar ? { confirmar: true } : undefined),
    rotinas: () => get<{ rotinas: RotinaDto[] }>("rotinas"),
    /** NOD-85: a agenda das rotinas entre `de` e `ate` (epoch ms, `ate` exclusivo), com os dias no fuso do navegador. */
    agenda: (de: number, ate: number, fuso: string) => get<AgendaDto>(`rotinas/agenda?de=${de}&ate=${ate}&fuso=${encodeURIComponent(fuso)}`),
    execucoes: (rotinaId: string) => get<{ execucoes: ExecucaoRotina[] }>(`rotinas/${rotinaId}/execucoes`),
    /** NOD-412: `ate` = AAAA-MM-DD ou AAAA-MM-DDTHH:MM no fuso da rotina; omitido = pausa sem data. */
    pausarRotina: (id: string, ate?: string) => post<RespostaMutacao>(`rotinas/${id}/pausar`, ate ? { ate } : undefined),
    /** NOD-84: o endereço inteiro e o segredo do GitHub, só para o Copiar (no-store; nunca vai ao estado da tela). */
    enderecoWebhook: (id: string) => get<{ caminho: string; segredo: string; prefixo: string }>(`rotinas/${id}/endereco`),
    gerarEnderecoWebhook: (id: string) => post<RespostaMutacao>(`rotinas/${id}/endereco`),
    testarWebhook: (id: string) => post<RespostaMutacao>(`rotinas/${id}/testar-webhook`),
    ativarRotina: (id: string) => post<RespostaMutacao>(`rotinas/${id}/ativar`),
    salas: () => get<{ salas: SalaDto[] }>("salas"),
    criarSala: (nome: string, agenteIds: string[]) => post<RespostaMutacao>("salas", { nome, agenteIds }),
    postarNaSala: (salaId: string, texto: string) => post<RespostaMutacao>(`salas/${salaId}/mensagens`, { texto }),
    pararSala: (salaId: string) => post<FaixaParada>(`salas/${salaId}/parar`),
    conectores: () => get<{ conectores: Conector[]; marketplace: AppComLogo[]; composioConfigurado: boolean }>("conectores"),
    configurarComposio: (chave: string) => post<{ configurado: boolean }>("marketplace/configurar", { chave }),
    // definido em 2026-09-24 (ADR-048): o GitHub pode conectar na hora (gh logado nesta máquina, sem URL de login) ou dizer o que falta (`frase`).
    conectarApp: (slug: string) => post<{ url?: string; conectorId?: string; conectado?: boolean; frase?: string }>(`marketplace/${encodeURIComponent(slug)}/conectar`),
    appGithub: (p: { appId: string; instalacaoId: string; chavePrivada: string }) => post<{ configurado: boolean }>("marketplace/github/app", p),
    /** NOD-50: o valor do cartão de credencial vai daqui direto ao cofre; a resposta não o devolve. */
    guardarCredencial: (propostaId: string, valor: string) => post<{ estado: "guardada" }>(`propostas/${encodeURIComponent(propostaId)}/credencial`, { valor }),
    tokenGithub: (token: string) => post<{ conectado: boolean; conectorId: string }>("marketplace/github/token", { token }),
    verificarApp: (slug: string) => post<{ conectado: boolean; falhou?: boolean; causa?: "composio" | "app" | null }>(`marketplace/${encodeURIComponent(slug)}/verificar`),
    atualizarCredenciais: (id: string, env: Record<string, string>) => patch<{ conector: Conector }>(`conectores/${id}/credenciais`, { env }),
    registrarConector: (c: Record<string, unknown>) => post<{ ok: true; ids: { conector: string }; conector: Conector }>("conectores", c),
    sondarConector: (id: string) => post<{ ok: boolean; conector: Conector }>(`conectores/${id}/sondar`),
    habilitarConector: (id: string, habilitado: boolean) => post<{ conector: Conector }>(`conectores/${id}/${habilitado ? "habilitar" : "desabilitar"}`),
    concessoes: (agenteId: string) => get<{ concessoes: Concessao[]; liberacoesDispensadas?: Record<string, number> }>(`agentes/${agenteId}/concessoes`),
    // definido em 2026-10-05: o cartão da conversa que oferece liberar apps recém-conectados (web/telas/card-liberar.ts).
    liberarApps: (agenteId: string, apps: { conectorId: string; nivel: "leitura" | "escrita" }[]) => post<RespostaMutacao>(`agentes/${agenteId}/acessos/liberar`, { apps }),
    dispensarLiberacao: (agenteId: string, conectorIds: string[]) => post<RespostaMutacao>(`agentes/${agenteId}/acessos/dispensar`, { conectorIds }),
    conceder: (agenteId: string, conectorId: string, capacidade: string) => post<{ ok: true; ids: { concessao: string; mensagem: string }; naoInclui: string[] }>(`agentes/${agenteId}/concessoes`, { conectorId, capacidade }),
    revogar: (concessaoId: string) => del<RespostaMutacao>(`concessoes/${concessaoId}`),
    // definido em 2026-09-25: Nenhum / Ler / Ler e alterar por bot e app (marketplace e painel do bot).
    definirNivel: (agenteId: string, conectorId: string, nivel: "nenhum" | "leitura" | "escrita") => post<RespostaMutacao>(`agentes/${agenteId}/acessos`, { conectorId, nivel }),
    // ADA-241 (ADR-158): a gaveta "Quem pode usar": o padrão do app, o lote (com a chave do clique) e o Desfazer do lote.
    acessosDoApp: (conectorId: string) => get<AcessosDoAppDto>(`conectores/${conectorId}/acessos`),
    acessosEmLote: (conectorId: string, corpo: { nivel: "nenhum" | "leitura" | "escrita"; bots: "todos" | string[]; chave: string; confirmado?: boolean }) => post<LoteDeAcessosDto>(`conectores/${conectorId}/acessos/lote`, corpo),
    desfazerLoteDeAcessos: (loteId: string) => post<{ ok: true; voltaram: { agenteId: string; nome: string }[]; mudaram_depois: { agenteId: string; nome: string }[] }>(`acessos/lotes/${loteId}/desfazer`),
    padraoDoApp: (conectorId: string, corpo: { nivel: "nenhum" | "leitura" | "escrita"; aplicar?: boolean; confirmado?: boolean }) => post<{ ok: true; padrao: "nenhum" | "leitura" | "escrita"; anterior: "nenhum" | "leitura" | "escrita"; aplicados: { agenteId: string; nome: string }[] }>(`conectores/${conectorId}/padrao`, corpo),
    revogarAcessos: (agenteId: string, ids: string[]) => post<RespostaMutacao>(`agentes/${agenteId}/concessoes/revogar`, { ids }),
    // definido em 2026-09-24 ("aviso no Mac"): `ver: false` → `?ver=0`, a leitura da janela escondida ou
    // fora de foco, que não carimba vista_em (ADR-007, refinamento da mesma data).
    suaVez: (ver = true) => get<SuaVezDto>(ver ? "sua-vez" : "sua-vez?ver=0"),
    dispensarIncidente: (id: string) => post<RespostaMutacao>(`incidentes/${id}/dispensar`),
    // Modo ligação (definido em 2026-10-04, ADR-071/075): disponibilidade é 200 com o motivo, nunca erro.
    disponibilidadeLigacao: (agenteId: string) => get<DisponibilidadeLigacao>(`ligacoes/disponibilidade?agenteId=${encodeURIComponent(agenteId)}`),
    consentirVoz: (versao: number) => post<RespostaMutacao>("voz/consentimento", { versao }),
    // ADR-095: o microfone do campo de mensagem aparece? 200 com o motivo, nunca erro.
    disponibilidadeDitado: () => get<DisponibilidadeDitado>("voz/ditado/disponibilidade"),
    criarLigacao: (agenteId: string) => post<LigacaoCriada>("ligacoes", { agenteId }),
    ligacaoViva: () => get<{ ligacao: Ligacao | null }>("ligacoes/viva"),
    encerrarLigacao: (id: string) => post<RespostaMutacao>(`ligacoes/${encodeURIComponent(id)}/encerrar`),
    /** Rede de segurança (2026-10-05): a IA do Mac caiu no meio da ligação e a pessoa escolheu com qual continuar. */
    continuarLigacao: (id: string, ia: IaDaLigacao) => post<{ ligacao: Ligacao }>(`ligacoes/${encodeURIComponent(id)}/continuar`, { ia }),
    avaliarLigacao: (id: string, nota: "boa" | "ruim", motivo?: MotivoAvaliacaoLigacao) => post<RespostaMutacao>(`ligacoes/${encodeURIComponent(id)}/avaliacao`, motivo ? { nota, motivo } : { nota }),
    falasLigacao: (id: string) => get<{ falas: FalaLigacao[] }>(`ligacoes/${encodeURIComponent(id)}/falas`),
    apagarFalasLigacao: (id: string) => del<RespostaMutacao>(`ligacoes/${encodeURIComponent(id)}/falas`),
    /** Ajustes da ligação: a voz e a velocidade do bot valem a partir da próxima frase. */
    ajustarVoz: (agenteId: string, ajuste: { voz?: IdVozNod | null; vozVelocidade?: VelocidadeVoz }) => patch<{ voz: string | null; vozVelocidade: number }>(`agentes/${encodeURIComponent(agenteId)}/voz`, ajuste),
    // Onboarding por ligação (definido em 2026-10-04, ADR-077): a etapa mora no servidor; a web só lê e pede para mudar.
    onboarding: () => get<EstadoOnboarding>("onboarding"),
    etapaOnboarding: (p: PedidoEtapaOnboarding) => post<EstadoOnboarding>("onboarding/etapa", p),
    concluirOnboarding: () => post<EstadoOnboarding>("onboarding/concluir"),
    botDoOnboarding: (nome: string, descricao: string) => post<EstadoOnboarding>("onboarding/bot", { nome, descricao }),
    rotinaDoOnboarding: (indice: number) => post<EstadoOnboarding>("onboarding/rotina", { indice }),
    /** A decisão 'bot' do onboarding decidida pelo clique: o nome e a descrição podem ter sido editados no card. */
    decidirBot: (id: string, corpo: { nome?: string; descricao?: string; recusar?: boolean }) => post<RespostaMutacao>(`decisoes/${id}/decidir`, corpo),
    decidir: (id: string, corpo: { itens?: { id: string; selecionado: boolean; textoFinal?: string }[]; recusar?: boolean; sempre?: boolean; restoDaTarefa?: boolean; capacidades?: string[]; selecionados?: number[] }) => post<RespostaMutacao>(`decisoes/${id}/decidir`, corpo),
    responder: (id: string, texto: string) => post<RespostaMutacao>(`decisoes/${id}/responder`, { texto }),
    retomar: (id: string, texto?: string) => post<RespostaMutacao>(`decisoes/${id}/retomar`, texto ? { texto } : {}),
    reabrir: (id: string) => post<RespostaMutacao>(`decisoes/${id}/reabrir`),
    dispensar: (id: string) => post<RespostaMutacao>(`decisoes/${id}/dispensar`),
    trilha: (q: string) => get<{ linhas: unknown[] }>(`trilha${q ? `?${q}` : ""}`),
    devCatcher: () => get<{ executor: string; registros: RegistroCatcher[] }>("dev/catcher"),
    chaves: () => get<{ chaves: ChaveMaquinaDto[] }>("maquinas/chaves"),
    emitirChave: (nome: string) => post<ChaveEmitidaDto>("maquinas/chaves", { nome }),
    revogarChave: (id: string) => del<{ ok: true }>(`maquinas/chaves/${id}`),
    // ADR-090: as máquinas, onde cada bot trabalha, o pareamento por código e o "rodar em outra desta vez".
    maquinas: () => get<MaquinasDto>("maquinas"),
    maquinaDoBot: (agenteId: string, maquinaId: string | null) => pedir<{ agente: Agente }>("PUT", `${base}/agentes/${encodeURIComponent(agenteId)}/maquina`, { maquinaId }),
    moverBots: (maquinaId: string, agentes: string[]) => pedir<{ movidos: number }>("PUT", `${base}/maquinas/${encodeURIComponent(maquinaId)}/bots`, { agentes }),
    maquinaPadrao: (maquinaId: string | null) => pedir<{ padraoId: string | null }>("PUT", `${base}/maquinas/padrao`, { maquinaId }),
    verDispositivo: (codigo: string) => get<{ nome: string; plataforma: string; pedidoHaS: number }>(`maquinas/dispositivos/${encodeURIComponent(codigo)}`),
    aprovarDispositivo: (codigo: string) => post<{ ok: true }>(`maquinas/dispositivos/${encodeURIComponent(codigo)}/aprovar`),
    // NOD-314: a task que espera uma máquina sem contato roda os turnos pendentes dela em outra, uma vez.
    rodarTrabalhoDestaVez: (trabalhoId: string, maquinaId: string) =>
      post<{ turnos: number; motivo?: "ja_refeito" | null }>(`trabalhos/${encodeURIComponent(trabalhoId)}/rodar-desta-vez`, { maquinaId }),
    rodarDestaVez: (conversaId: string, maquinaId: string, turnoId?: string, contaId?: string) =>
      post<{ turnos: number; turnoId?: string | null; motivo?: MotivoDaNota | null }>(`conversas/${encodeURIComponent(conversaId)}/rodar-desta-vez`, { maquinaId, ...(turnoId ? { turnoId } : {}), ...(contaId ? { contaId } : {}) }),
    // ADR-102: as contas de IA da pessoa em todas as máquinas, o login numa máquina pela tela e o convite da VM.
    contasIa: () => get<ContasIaDto>("contas-ia"),
    ordemContas: (ids: string[]) => pedir<null>("PUT", `${base}/contas-ia/ordem`, { ids }),
    modoContas: (modo: ModoDasContas) => pedir<null>("PUT", `${base}/contas-ia/modo`, { modo }),
    mudarConta: (id: string, corpo: { apelido?: string; entraNaTrocaAutomatica?: boolean }) => patch<null>(`contas-ia/${encodeURIComponent(id)}`, corpo),
    sairDaConta: (id: string, maquinaId: string) => post<{ ok: true }>(`contas-ia/${encodeURIComponent(id)}/sair`, { maquinaId }),
    removerConta: (id: string) => del<{ ok: true }>(`contas-ia/${encodeURIComponent(id)}`),
    frentesAtivas: (id: string, maquinaId?: string, signal?: AbortSignal) =>
      pedir<FrenteAtivaDaConta[]>("GET", `${base}/contas-ia/${encodeURIComponent(id)}/frentes-ativas${maquinaId ? `?maquinaId=${encodeURIComponent(maquinaId)}` : ""}`, undefined, { signal }),
    seguirComConta: (id: string, conversaId: string, turnoId?: string) =>
      post<{ turnoId?: string | null; motivo?: MotivoDaNota | null }>(`contas-ia/${encodeURIComponent(id)}/seguir`, { conversaId, ...(turnoId ? { turnoId } : {}) }),
    tentarDeNovoConta: (id: string, p: { conversaId?: string; turnoId?: string }) =>
      post<{ turnoId?: string | null; motivo?: MotivoDaNota | null; acordados?: number }>(`contas-ia/${encodeURIComponent(id)}/tentar-de-novo`, p),
    // ADR-108 (R4/R6): a escolha no aviso de troca de IA do bot.
    /** Revisão do PR 2 (I2): `trocaId` diz qual aviso (o bot pode ter um por IA). */
    decidirTrocaDeIa: (agenteId: string, decisao: DecisaoDaPessoa, trocaId?: string) => post<{ decisao: string; aplicada: boolean; tasks: number }>(`agentes/${encodeURIComponent(agenteId)}/troca-de-ia`, { decisao, ...(trocaId ? { trocaId } : {}) }),
    // NOD-313: o clique no card de ritmo da rotina (a única coisa que muda a rotina a partir da sugestão).
    decidirRitmoRotina: (rotinaId: string, mensagemId: string, opcao: OpcaoRitmo | "desfazer") => post<{ ok: true; ids: { rotinaId: string; aplicada: string; motivo?: string } }>(`rotinas/${encodeURIComponent(rotinaId)}/ritmo`, { mensagemId, opcao }),
    pedirLogin: (maquinaId: string, p: { ia: IaComConta; contaId?: string; apelido?: string | null }) => post<LoginNaMaquina>(`maquinas/${encodeURIComponent(maquinaId)}/logins`, p),
    verLogin: (maquinaId: string, loginId: string) => get<LoginNaMaquina>(`maquinas/${encodeURIComponent(maquinaId)}/logins/${encodeURIComponent(loginId)}`),
    colarCodigoLogin: (maquinaId: string, loginId: string, cifrado: CodigoCifrado) => post<{ ok: true }>(`maquinas/${encodeURIComponent(maquinaId)}/logins/${encodeURIComponent(loginId)}/codigo`, { cifrado }),
    // NOD-9 PR4: a máquina recebe o pedido na próxima puxada e atualiza a IA quando os turnos dela terminarem.
    atualizarIaDaMaquina: (maquinaId: string, ia: IaComConta) => post<{ ok: true }>(`maquinas/${encodeURIComponent(maquinaId)}/ias/${encodeURIComponent(ia)}/atualizar`),
    cancelarLogin: (maquinaId: string, loginId: string) => post<{ ok: true }>(`maquinas/${encodeURIComponent(maquinaId)}/logins/${encodeURIComponent(loginId)}/cancelar`),
    renomearMaquina: (id: string, nome: string) => patch<{ id: string; nome: string }>(`maquinas/${encodeURIComponent(id)}`, { nome }),
    desconectarMaquina: (id: string, sairDasContas: boolean) => post<{ ok: true; contas: number; aguardandoMaquina: boolean }>(`maquinas/${encodeURIComponent(id)}/desconectar`, { sairDasContas }),
    // ADA-245 (jornada D): o que o diálogo "Remover o nod deste computador?" diz, e a ação `maquinas.remover`.
    previaRemover: (id: string) => get<PreviaRemoverDto>(`maquinas/${encodeURIComponent(id)}/remover/previa`),
    // ADA-245: `daqui` = o app já limpou este computador; o servidor revoga na hora e não manda nada para a puxada.
    removerComputador: (id: string, opcoes: OpcoesRemover, daqui = false) => post<ResultadoRemoverDto>(`maquinas/${encodeURIComponent(id)}/remover`, daqui ? { ...opcoes, daqui: true } : opcoes),
    criarConvite: (computador?: { substituir: boolean }) => post<{ convite: string; expiraEm: number }>("maquinas/convites", computador ? { papel: "computador", substituir: computador.substituir } : undefined),
    // NOD-94: a máquina só computador instalada por SSH. A credencial só sai daqui cifrada para a instaladora.
    instaladorasSsh: () => get<{ instaladoras: { id: string; nome: string; plataforma: string }[] }>("maquinas/ssh/instaladoras"),
    pedirInstalacaoSsh: (p: { host: string; porta: number; usuario: string; metodo: MetodoSsh; origemId: string | null; substituir: boolean }) => post<InstalacaoCriadaDto>("maquinas/ssh", p),
    verInstalacaoSsh: (id: string) => get<InstalacaoSshDto>(`maquinas/ssh/${encodeURIComponent(id)}`),
    credencialSsh: (id: string, cifrado: CodigoCifrado) => post<null>(`maquinas/ssh/${encodeURIComponent(id)}/credencial`, { cifrado }),
    confiarNaNovaSsh: (id: string) => post<null>(`maquinas/ssh/${encodeURIComponent(id)}/confiar-nova`),
    cancelarInstalacaoSsh: (id: string) => post<null>(`maquinas/ssh/${encodeURIComponent(id)}/cancelar`),
    // ADR-121 (NOD-92): a máquina na nuvem que dorme e acorda pelo Google. Sem NOD_MAQUINA_NUVEM, as rotas dão 404.
    contaNuvem: () => get<ContaNuvemDto>("nuvem/conta"),
    /** O OAuth do Google começa aqui: a resposta traz a `url` para onde a página vai (desvio 1 da NOD-92). */
    entrarNoGoogle: (pedido: { para: "preparar" } | { para: "conectar"; maquinaId: string; projeto: string; zona: string; nome: string } | { para: "criar"; regiao: string; tamanho: TamanhoMaquinaNuvem }) => post<{ url: string }>("nuvem/google", pedido),
    // PR 2: criar (202, a linha `criando` aparece em nuvem/conta) e excluir a VM que o nod criou.
    criarMaquinaNuvem: (pedido: { regiao: string; tamanho: TamanhoMaquinaNuvem }) => post<MaquinaCriandoDto>("nuvem/maquinas", pedido),
    excluirMaquinaNuvem: (id: string) => del<{ ok: true }>(`nuvem/maquinas/${encodeURIComponent(id)}`),
    dormirAgora: (maquinaId: string) => post<{ ok: true }>(`nuvem/maquinas/${encodeURIComponent(maquinaId)}/dormir`),
    acordarAgora: (maquinaId: string) => post<{ ok: true }>(`nuvem/maquinas/${encodeURIComponent(maquinaId)}/acordar`),
    dormirApos: (maquinaId: string, minutos: DormirAposMin | null) => pedir<{ dormirAposMin: DormirAposMin | null }>("PUT", `${base}/nuvem/maquinas/${encodeURIComponent(maquinaId)}/dormir-apos`, { minutos }),
    verConvite: (convite: string) => get<{ estado: "pendente" } | { estado: "chegou"; codigo: string; pedido: { nome: string; plataforma: string; pedidoHaS: number } }>(`maquinas/convites/${encodeURIComponent(convite)}`),
    /** ADR-069: abre o pedido de pareamento do Mac que pediu; o código volta ao app pelo 127.0.0.1. */
    parearMac: (nome: string, desafio: string) => post<{ codigo: string }>("maquinas/pareamentos", { nome, desafio }),
    // ADR-051 (definido em 2026-09-28): o card do artefato busca o HTML da SUA versão e o estado da pessoa.
    versaoArtefato: (id: string, versao: number) => get<ArtefatoDto>(`artefatos/${encodeURIComponent(id)}/versoes/${versao}`),
    salvarEstadoArtefato: (id: string, dados: unknown) => pedir<{ ok: true }>("PUT", `${base}/artefatos/${encodeURIComponent(id)}/estado`, { dados }),
    /** Ao fechar a página: keepalive deixa o PUT terminar depois de a aba sair (o que falhar aqui se perde, sem aviso). */
    salvarEstadoArtefatoAoSair: (id: string, dados: unknown) => {
      void fetch(`${base}/artefatos/${encodeURIComponent(id)}/estado`, { method: "PUT", keepalive: true, headers: { "content-type": "application/json" }, body: JSON.stringify({ dados }) }).catch(() => undefined);
    },
  };
}

/**
 * Sessão (ADR-019/030): GET /api/sessao devolve o escopo ou 401. O modo diz como a tela de entrada se
 * desenha: `google` é um link de navegação para /api/sessao/google (o servidor redireciona); `entrar`
 * só existe no login de desenvolvimento (NOD_LOGIN=stub, 127.0.0.1).
 */
export const sessao = {
  atual: () => pedirDeNovoSeCair<Escopo>("GET", "/api/sessao"),
  modo: () => pedirDeNovoSeCair<ModoSessaoDto>("GET", "/api/sessao/modo"),
  entrar: (pessoaId: string) => pedir<Escopo>("POST", "/api/sessao/entrar", { pessoaId }),
  urlGoogle: "/api/sessao/google",
};

/**
 * NOD-345 (ADR-124): as contas. Públicas no servidor (a sessão, quando há, vem do cookie). Os valores dos campos do
 * cartão (e-mail, senha, código) vão SÓ aqui, direto ao nod — nunca por mensagem, turno ou memória.
 */
/**
 * No app, os pedidos que podem trocar de conta levam o desafio do segredo do processo principal (estilo PKCE): só assim
 * o servidor devolve o código de troca, e só o processo principal consegue trocá-lo pela chave. No navegador, nada.
 */
const doApp = (): Promise<OpcoesPedido> => cabecalhosDoApp(typeof window === "undefined" ? undefined : window.nodDesktop);

export const contaApi = {
  estado: () => pedir<EstadoContaDto>("GET", "/api/conta"),
  provisorioWeb: (verificador: string, prova?: { desafio: string; resposta: string }) => pedir<{ novo: boolean }>("POST", "/api/conta/provisorio", { verificador, forma: "web", ...prova }),
  cadastrar: (email: string, senha: string) => pedir<CadastroDto>("POST", "/api/conta/cadastro", { email, senha }),
  reenviar: () => pedir<CadastroDto>("POST", "/api/conta/reenviar", {}),
  verificar: (codigo: string) => pedir<VerificarDto>("POST", "/api/conta/verificar", { codigo }),
  entrar: async (email: string, senha: string) => pedir<EntrarDto>("POST", "/api/conta/entrar", { email, senha }, await doApp()),
  importar: async () => pedir<ImportarDto>("POST", "/api/conta/importar", {}, await doApp()),
  outra: () => pedir<{ ok: true }>("POST", "/api/conta/outra", {}),
  cancelar: () => pedir<{ ok: true }>("POST", "/api/conta/cancelar", {}),
  recuperar: (email: string) => pedir<{ ok: true }>("POST", "/api/conta/recuperar", { email }),
  redefinir: async (token: string, senha: string) => pedir<RedefinirDto>("POST", "/api/conta/redefinir", { token, senha }, await doApp()),
  trocarSenha: (atual: string, nova: string) => pedir<TrocarSenhaDto>("POST", "/api/conta/senha", { atual, nova }),
  sessoes: () => pedir<SessoesDto>("GET", "/api/conta/sessoes"),
  sairDasOutras: () => pedir<{ encerradas: number }>("POST", "/api/conta/sair-das-outras", {}),
  sair: () => pedir<unknown>("POST", "/api/sessao/sair", {}),
  gerarPareamento: () => pedir<{ codigo: string; expiraEm: number }>("POST", "/api/conta/parear", {}),
  pareamento: () => pedir<{ pareamento: PareamentoAbertoDto }>("GET", "/api/conta/parear"),
  decidirPareamento: (confirmar: boolean) => pedir<{ estado: EstadoPareamentoDto }>("POST", "/api/conta/parear/decidir", { confirmar }),
  pedirPareamento: (codigo: string) => pedir<PedirPareamentoDto>("POST", "/api/conta/parear/pedir", { codigo }),
  esperarPareamento: async () => pedir<EsperaPareamentoDto>("GET", "/api/conta/parear/pedido", undefined, await doApp()),
  google: (app: boolean) => pedir<{ url: string }>("POST", "/api/conta/google", { app }),
  /** ADA-242: conta sem senha (só com NOD_ONBOARDING_TEXTO): o código vai para o e-mail e `verificar` conclui. */
  codigo: (email: string) => pedir<CadastroDto>("POST", "/api/conta/codigo", { email }),
  /** ADA-242: o Google dentro do app; porta e estado vêm do loopback do processo principal (`googleConta.abrir`). */
  googleApp: async (porta: number, estado: string) =>
    pedir<{ url: string }>("POST", "/api/conta/google", { app: true, porta, estado }, await cabecalhosDoGoogleApp(typeof window === "undefined" ? undefined : window.nodDesktop)),
};

/** NOD-346 (ADR-126): Minha conta. As ações de risco voltam 403 com `motivo: reautenticar` até a pessoa confirmar quem é. */
export const minhaContaApi = {
  estado: () => pedir<MinhaContaDto>("GET", "/api/conta/eu"),
  salvarPerfil: (p: { nome: string; sobreMim: string }) => pedir<PerfilDto>("POST", "/api/conta/eu/perfil", p),
  definirFoto: (base64: string | null) => pedir<PerfilDto>("POST", "/api/conta/eu/foto", { base64 }),
  reautenticarComSenha: (senha: string) => pedir<ReautenticarDto>("POST", "/api/conta/eu/reautenticar", { senha }),
  enviarCodigo: () => pedir<{ enviado: boolean; expiraEm: number }>("POST", "/api/conta/eu/reautenticar/codigo", {}),
  reautenticarComCodigo: (codigo: string) => pedir<ReautenticarDto>("POST", "/api/conta/eu/reautenticar", { codigo }),
  removerGoogle: () => pedir<{ formas: FormasDto }>("POST", "/api/conta/eu/google/remover", {}),
  pedirTrocaEmail: (email: string) => pedir<{ enviado: boolean; para: string; expiraEm: number }>("POST", "/api/conta/eu/email", { email }),
  cancelarTrocaEmail: () => pedir<unknown>("POST", "/api/conta/eu/email/cancelar", {}),
  confirmarEmail: (token: string) => pedir<ConfirmarEmailDto>("POST", "/api/conta/eu/email/confirmar", { token }),
  trocarSenha: contaApi.trocarSenha,
  pedirExportacao: () => pedir<ExportacaoDto>("POST", "/api/conta/eu/exportacao", {}),
  /** O zip vem como arquivo: baixa pelo blob. Erro (403 reautenticar, 404) volta como ErroApi, igual ao resto. */
  async baixarExportacao(id: string): Promise<void> {
    const url = `/api/conta/eu/exportacao/${encodeURIComponent(id)}`;
    let r: Response;
    try {
      r = await fetch(url);
    } catch (e) {
      if (ehAbort(e)) throw e;
      throw falhaDeTransporte(rotaDe("GET", url));
    }
    if (!r.ok) {
      let lido: unknown = null;
      try { lido = await r.json(); } catch { lido = null; }
      throw erroDaResposta(r.status, lido, rotaDe("GET", url));
    }
    const blob = await r.blob();
    const nome = /filename="?([^";]+)"?/.exec(r.headers.get("content-disposition") ?? "")?.[1] ?? "nod-meus-dados.zip";
    const href = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = href;
    a.download = nome;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(href), 10_000);
  },
  excluir: () => pedir<{ pedidaEm: number; purgarEm: number }>("POST", "/api/conta/eu/excluir", {}),
  desfazerExclusao: () => pedir<{ desfeita: boolean }>("POST", "/api/conta/eu/excluir/desfazer", {}),
};
