/**
 * NOD-429 (definido em 2026-10-30): a troca Conversa ↔ Quadro na pílula, nos nós vivos do palco.
 *
 * - O HTML do segmento não diz o modo (web/telas/quadro.ts, `segmento`); `sincronizar` marca `data-atual`,
 *   `aria-selected` e `tabindex` depois de cada desenho, e o indicador desliza por transição de CSS (web/quadro.css).
 * - A conversa (timeline, campo, faixas) nunca é regravada nem tirada do DOM: no modo Quadro ela fica por baixo, invisível
 *   e `inert`; a vista `#quadro` cobre o palco. Rolagem, rascunho e foco da conversa sobrevivem à ida e volta.
 * - Comentário final do Marlon na j7-1: o conteúdo desliza de lado nos dois sentidos (Web Animations, `movimentoDaTroca`);
 *   com "Reduzir movimento", fade curto sem deslocamento. Trocar de volta no meio inverte a animação em curso, do ponto
 *   onde ela está (sem salto).
 * - O modo é por conversa e só em memória: trocar de conversa (ou sair dela) volta para Conversa, sem animação.
 */
import { previaDoComentario, textoDaPrevia } from "./previa-comentario.ts";
import { direcaoDaTroca, ehModo, ADIAR_ATE_MS, ARRASTO_ATE_MS, ECO_DA_PESSOA_MS, GESTO_MS, RESERVA_MS, movimentoDaTroca, releComecando, TURNO_MUDA_A_EXECUCAO, type ModoDaConversa } from "./quadro.ts";
import { comColunas, FAIXA_DO_PRAZO, fraseDoErroDeColuna, nomeRepetido, passoDeMover, comecaAoEntrar, porqueNaoRecebeCard, porqueNaoRemove, prazoEmMin, prazoLegivelMin, reciboDaResposta, reciboDeMover, saidaComErroDesiste, seletorDoFocoDaColuna, soltarEm, type EdicaoDeColuna, type Lado, type UnidadeDePrazo } from "./colunas.ts";
import { ErroApi, ehRecusaDoServidor } from "./erro-api.ts";
import { anunciarEm } from "./posicao-da-lista.ts";
import { campoComFocoNoToque, criarGestoNaTela, rolagemDoPrograma } from "./gesto-na-tela.ts";
import { focarSemRolar, guardarRolagem, restaurarRolagem, seletorDoFocoDoCard, type RolagemGuardada } from "./rolagem-guardada.ts";
import { criarAlvosDeRolagem, criarReservaDeAltura } from "./alvo-de-rolagem-na-tela.ts";
import { COLADO_PX } from "./alvo-de-rolagem.ts";
import { acharAncora, topoPelaAncora } from "./ancora-de-leitura.ts";
import type { CamposDeLabel } from "../../src/contracts/quadro-labels.ts";
import type { EntradaHistoricoDto, GrupoColuna, LinhaMuralDto, ModoConversa, QuadroDaPessoaDto, QuadroDto, TarefaDto } from "../../src/contracts/quadro.ts";
import type { ConversaDto, RespostaMutacao } from "../../src/contracts/api.ts";
import type { MutacaoQuadro } from "./api.ts";
import type { FiltroImportacao, ImportacaoDto, PreviaDaTela } from "../../src/contracts/quadro-importacao.ts";
import type { EventoTrilhaQuadro } from "../../src/contracts/trilha-quadro.ts";
import { ehRecusaDoPainel, type PainelImportacao } from "../telas/card-importacao.ts";
import { PARAMETRO_TAREFA, acesos, codigoDaTarefa, acoesDaNovaTarefa, fraseDoErroDoMover, reciboDaNovaTarefa, codigoNaUrl, destinosDaTarefa, historicoDaFaixa, respostaDoBot, respostaLonga, tarefaNoQuadro, type AcoesDoRecibo, type Faixa } from "./quadro-dados.ts";
import type { ExibirDoQuadro, VisaoDoQuadro } from "../../src/contracts/raio-x.ts";
import { VISOES_DO_QUADRO } from "../telas/quadro-celular.ts";
import { criarCelularDoQuadro, seletorDoFocoDaFolha } from "./celular-do-quadro.ts";
import { confiar, quadroVazio, type Aviso, type Filtro, type Html } from "../telas/quadro.ts";
import { contarNaVista, ehFiltro, termoDaBusca } from "./vista-do-quadro.ts";
import type { QuadrosDoBotDto } from "../../src/contracts/quadros-do-bot.ts";
import { mostraSeletor, quadroQueAbre, seletorDeQuadro, type CriandoNoSeletor } from "../telas/seletor-de-quadro.ts";
import { decidirSoltura, fraseDaTrava, RECUSA_MS, relogioDaRecusa, type RelogioDaRecusa } from "./freios.ts";
import { sugestoesDoQuadro, contadorDaPilula } from "./sugestoes-do-quadro.ts";
import { ajustarAltura, type ContextoDaBarra } from "./composer.ts";
import { comandoNoTexto } from "./barra.ts";
import { ligarComposer, type ComposerLigado } from "./composer-ligado.ts";
import { CONSULTA_CELULAR, ehCelular, enterEnvia } from "./celular.ts";
import { abrirFolha, engolirCliqueDoToque, folhaAberta, type FolhaAberta } from "./folha.ts";
import { autorDoComentario, fimDaTrocaCel, tarefaAbertaCelular, textoDaResposta, trechoDe, type NaoSalvouCel, type Respondendo, type TrocaCel } from "../telas/tarefa-celular.ts";
import { casaNaBusca, folhaDeAjustes, folhaDeCancelar, folhaDeMover, folhaDeStatus, folhaDoBranch, folhaDoComentario, folhaDoResponsavel } from "../telas/folhas-da-tarefa.ts";
import type { Aceita } from "./anexos.ts";
import { anuncioDaFaixa, cartaoDaResposta, faixaDoQuadro, ICONE_ENVIAR_PILULA, ICONE_PARAR_PILULA, idDaNovaTarefa, ideiasDaPilula, pilulaDoQuadro, quadroCarregando, quadroComErro, quadroDaMeta, rotuloDoModo, semQuadro, tarefaAberta, tempoDoTurno, type AgenteDoQuadro, type AvisoDaFaixa, type PainelDoQuadro, type TrocaDaFaixa } from "../telas/quadro-real.ts";
import { anuncioDaOrdem, anuncioDaPagina, CONVERSA, ehForma, indicePeloId, moverNaOrdem, paginaPelaTecla, presa, TAREFAS, type FormaDasTarefas, type Pagina } from "./paginas.ts";
import { guardarOrdem, ordemDoAgente, paginasDtoDe } from "./ordem-das-paginas.ts";
import { menuDaPagina, paginaDoApp } from "../telas/paginas.ts";
import { criarBarraDoQuadro } from "./barra-do-quadro.ts";
import { NOME_DA_PRIORIDADE, opcoesEfetivas, PRIORIDADES, prioridadeDe } from "./opcoes-do-quadro.ts";
import type { Prioridade } from "../../src/contracts/quadro-opcoes.ts";
import type { BuscaDaPilula } from "./gesto-da-pilula-na-tela.ts";
import { ligarGestosDaPilula, type PilulaDePaginas } from "./paginas-na-tela.ts";
import { criarComentariosNaTela, type ApiDosComentarios } from "./comentarios-na-tela.ts";
import { trecho } from "../telas/linha-do-tempo.ts";
import { criarTrabalhosDaTarefa, type ApiDosTrabalhos } from "./trabalhos-da-tarefa.ts";
import { criarEnvios } from "./envio-idempotente.ts";
import { atualizarPontos } from "./pontos-das-colunas.ts";
import { criarToqueLongo } from "./toque-longo.ts";
import { TOQUE_LONGO_DA_LINHA_MS } from "./celular-do-quadro.ts";
import { PRAZO_DO_ENVIO_MS, comPrazo } from "./com-prazo.ts";

/** Revisão 11 do #646: a janela de reenvio da mesma fala com a mesma chave (depois dela, o mesmo texto é pedido novo). */
const VALIDADE_DA_CHAVE_MS = 2 * 60_000;
import { ANUNCIO_MS, ARMAR_PARAR_MS, pedidoSeguido, podeParar, proximaFaixa, silencioEm, soORelogio, vivosDoPedido, type EventoDaFaixa } from "./faixa-do-quadro.ts";

const ehPrioridade = (v: string): v is Prioridade => (PRIORIDADES as readonly string[]).includes(v);
/** O pedaço da API que o quadro usa (NOD-442); null = sem sessão ainda. */
/** NOD-460: o Exibir de um quadro sem nada guardado (as recolhidas à mostra, a densidade normal). */
const EXIBIR_PADRAO: ExibirDoQuadro = { recolhidas: true, compacto: false };

export interface ApiDoQuadro extends ApiDosComentarios, ApiDosTrabalhos {
  quadro(agenteId: string): Promise<{ quadro: QuadroDto | null }>;
  conversa(conversaId: string): Promise<Pick<ConversaDto, "mensagens"> & Partial<Pick<ConversaDto, "turnosEmCurso" | "turnosPendentes">>>;
  enviar(conversaId: string, texto: string, anexos?: readonly string[], idEnvio?: string): Promise<RespostaMutacao>;
  /** ADA-4: o ■ Parar da pílula (o mesmo POST do chat). Sem isto, o botão fica sempre Enviar. */
  pararConversa?(conversaId: string): Promise<{ nadaRodando?: boolean }>;
  responderTarefa(agenteId: string, tarefaId: string, resposta: string, avancar?: boolean): Promise<MutacaoQuadro>;
  desfazerLoteQuadro(agenteId: string, loteId: string): Promise<MutacaoQuadro>;
  /** NOD-415 (ADR-141): criar o quadro e mudar a meta e o prazo pela tela (meta null tira). */
  criarQuadro(agenteId: string, campos: { meta?: string | null; prazo?: string | null; nome?: string; projeto?: string | null }): Promise<MutacaoQuadro>;
  editarQuadro(agenteId: string, campos: { meta?: string | null; prazo?: string | null }): Promise<MutacaoQuadro>;
  /** Voltar a agente comum: apaga o quadro (sem Desfazer); a conversa e a memória ficam. */
  removerQuadro(agenteId: string): Promise<MutacaoQuadro>;
  /** NOD-448: as colunas (cada uma um lote com Desfazer). Opcionais: sem elas, o quadro não edita colunas. */
  criarColuna?(agenteId: string, c: { nome: string; grupo: GrupoColuna; depois_de?: string }): Promise<MutacaoQuadro>;
  renomearColuna?(agenteId: string, coluna: string, nome: string): Promise<MutacaoQuadro>;
  prazoDaColuna?(agenteId: string, coluna: string, prazoMin: number | null): Promise<MutacaoQuadro>;
  moverColuna?(agenteId: string, coluna: string, onde: { antes_de?: string; depois_de?: string }): Promise<MutacaoQuadro>;
  removerColuna?(agenteId: string, coluna: string, destino?: string): Promise<MutacaoQuadro>;
  /** ADR-142: a passagem da coluna e o card arrastado (o mesmo mudar_tarefa). */
  definirPassagem?(agenteId: string, coluna: string, p: { agente: string | null; instrucoes: string | null; proxima?: string | null; volta_para?: string | null }): Promise<MutacaoQuadro>;
  /** NOD-416 (ADR-144): criar (cai no Backlog), mudar status e responsável, mudar de quadro, o histórico e os quadros. */
  criarTarefa?(agenteId: string, campos: { titulo: string; status?: string; descricao?: string; agente?: string | null; prioridade?: Prioridade }): Promise<MutacaoQuadro>;
  mudarTarefa?(agenteId: string, tarefaId: string, campos: { status?: string; agente?: string | null; prioridade?: Prioridade; titulo?: string; descricao?: string } & CamposDeLabel): Promise<MutacaoQuadro>;
  /** NOD-419: a trava da coluna e o Desfazer de um movimento (o eco do agente e o histórico da tarefa). */
  travarColuna?(agenteId: string, coluna: string, t: { sai_para?: string[] | null; so_pessoa?: boolean }): Promise<MutacaoQuadro>;
  desfazerMovimento?(agenteId: string, tarefaId: string, movimentoId: string): Promise<MutacaoQuadro>;
  moverTarefa?(agenteId: string, tarefaId: string, quadro: string): Promise<MutacaoQuadro & { movida?: { codigo: string; codigoAntigo: string } }>;
  historicoTarefa?(agenteId: string, tarefaId: string): Promise<{ historico: EntradaHistoricoDto[] }>;
  quadros?(): Promise<{ quadros: QuadroDaPessoaDto[] }>;
  /** NOD-422: "Trazer do Linear…" pela tela. A prévia só lê; o importar começa a trazer em segundo plano. */
  previaImportacao?(agenteId: string, time: string, filtro: FiltroImportacao | null): Promise<PreviaDaTela>;
  importarTimeLinear?(agenteId: string, time: string, filtro: FiltroImportacao | null): Promise<{ ok: true; importacao: ImportacaoDto }>;
  /** NOD-443 (ADR-143): as pessoas, o modo e o mural. Opcionais: sem elas, o quadro não mostra "Pessoas" nem "Atividade". */
  adicionarPessoa?(agenteId: string, pessoa: string, modo?: ModoConversa): Promise<MutacaoQuadro>;
  tirarPessoa?(agenteId: string, pessoaId: string): Promise<MutacaoQuadro>;
  mudarModo?(agenteId: string, modo: ModoConversa): Promise<MutacaoQuadro>;
  atividadeQuadro?(agenteId: string): Promise<{ linhas: LinhaMuralDto[] }>;
  /** NOD-460 (0149): o Exibir guardado de cada quadro (nas preferências de quem lê) e a gravação de um. */
  preferencias?(): Promise<{ quadroExibir?: Record<string, ExibirDoQuadro> }>;
  exibirQuadro?(quadroId: string, e: Partial<ExibirDoQuadro>): Promise<unknown>;
  /** ADA-14 (ADR-153): os N quadros do bot. Sem eles, a tela tem o quadro único de antes (sem seletor). */
  usarQuadro?(agenteId: string, quadroId: string | null): void;
  quadrosDoBot?(agenteId: string): Promise<QuadrosDoBotDto>;
  abrirQuadroDoBot?(agenteId: string, quadroId: string): Promise<unknown>;
  criarProjeto?(campos: { nome: string }): Promise<{ id: string }>;
}

/** NOD-442: o que o quadro de verdade precisa do main. Sem isto (os testes da NOD-429), a vista é o quadro vazio. */
export interface DadosDoQuadro {
  api: () => ApiDoQuadro | null;
  agente: AgenteDoQuadro;
  /**
   * Os bots da pessoa: os que podem receber a passagem de uma coluna (ADR-142; sem isto, o cabeçalho não mostra a passagem)
   * e os que podem ser o Responsável da tarefa aberta (NOD-416; sem isto, ele fica só leitura).
   */
  agentes?: () => readonly { id: string; nome: string }[];
  hora: (em: number) => string;
  /** Quanto a faixa fica à vista depois da resposta (ms). */
  recolherEm?: number;
  /** ADA-4 (revisão 1 do #646): o envio da pílula que não volta neste prazo vira "Não saiu · Tentar de novo" (ms). */
  envioEm?: number;
  /** Revisão 11 do #646: por quanto tempo a chave da fala que falhou é reusada para o mesmo texto (ms). */
  validadeDaChaveMs?: number;
  /** A janela que junta frames em rajada numa releitura só (ms). */
  juntarEm?: number;
  /** NOD-415: a confirmação antes de remover o quadro (padrão: window.confirm). */
  confirmar?: (texto: string) => boolean;
  /** NOD-416: o código da tarefa aberta vai para a URL (`?tarefa=ZE-12`); null = voltou ao quadro. */
  naUrl?: (codigo: string | null) => void;
  /** NOD-422 (PR 2): a trilha do quadro (só ids): a tarefa aberta pelo card ou por um link. */
  trilha?: (e: EventoTrilhaQuadro) => void;
  /**
   * QA do PR #623 (D4): depois de mover, leva à conversa do bot destino e abre a tarefa lá (o mesmo caminho do link).
   * false = o bot não está à mão (fica no quadro de origem, com o aviso).
   */
  irParaTarefa?: (agenteId: string, tarefaId: string, quadroId?: string) => boolean;
  /** NOD-422: de quanto em quanto tempo a linha "Trazendo do Linear" se relê (ms). */
  releImportacaoEm?: number;
  /** ADA-5: o composer do chat na pílula (web/lib/composer.ts). Sem isto, a pílula é só o campo e o Enviar. */
  composer?: ComposerDoQuadro;
  /** ADA-12: o prazo da reserva da altura (o teste encurta; o app usa RESERVA_MS). */
  reservaMs?: number;
  /** ADA-18: a tela é de celular (o quadro do celular no lugar da grade). Padrão: a consulta canônica (web/lib/celular.ts). */
  celular?: () => boolean;
}

/** ADA-5: o que a pílula do Quadro usa do composer do chat (o main dá as peças que são dele: anexos, ditado, Parar). */
export interface ComposerDoQuadro {
  /** No celular o Enter quebra a linha e o envio é pelo botão. */
  celular(): boolean;
  /** Os nomes da menção @. */
  sugestoes(): readonly string[];
  barra?: { contexto(): ContextoDaBarra; recarregar?(): Promise<void> | null };
  /** Os rascunhos da pessoa (web/lib/rascunhos.ts): a pílula, a resposta, o comentário e o recado sobrevivem à troca de bot e ao recarregar. */
  rascunhos?: { ler(chave: string): string; guardar(chave: string, texto: string): void };
  /** A fila de anexos da conversa (a mesma do chat). `aceita` undefined = o bot não lê anexo (sem clipe). */
  anexos?: {
    aceita(): Aceita | undefined;
    adicionar(arquivos: File[]): void;
    /** Os ids prontos da conversa; null = um arquivo ainda sobe (o Enviar espera). */
    prontos(conversa: string): readonly string[] | null;
    quantos(conversa: string): number;
    /**
     * Tira da fila da conversa só os anexos que vão no envio, antes do POST (revisão 2: um segundo envio, o do chat ou
     * a troca de bot no meio não os mandam de novo; o que foi colado durante o voo fica). `devolver` = o POST falhou.
     */
    retirar(conversa: string, ids: readonly string[]): { confirmar(): void; devolver(): void };
  };
  /** Os comandos que o nod resolve sem turno (/nova-sessao, /modelo), os mesmos do chat. true = era um deles e já rodou. */
  comando?(texto: string, conversa: string): Promise<boolean>;
  /** O Parar: para o turno da conversa do quadro. */
  parar?(): Promise<void>;
  /** Há turno vivo do chat nesta conversa (o mesmo critério do Parar do chat); sem isto, vale a faixa da pílula. */
  trabalhando?(): boolean;
  /** `descartar`: a vista trocou (pílula ⇄ chat) com a gravação aberta; ADR-095, a gravação não cai no campo escondido. */
  ditado?: { ativo(): boolean; concluirEnviando(): void; descartar?(): void };
  /** A pílula acabou de nascer (outro bot): o main desenha a fila de anexos e o 🎤 nela. */
  aoCriarPilula?(): void;
}

/** ADA-5: as chaves dos rascunhos do Quadro, separadas das do chat (que são a própria conversa). */
export function chaveDoRascunho(conversa: string, campo: { tarefa: string | null; id: string } | null): string {
  return campo ? `quadro:${conversa}:${campo.tarefa ?? "-"}:${campo.id}` : `quadro:${conversa}`;
}
/** Os campos de texto da vista cujo rascunho fica: a resposta, o comentário e o recado. */
const CAMPOS_COM_RASCUNHO = "textarea.qd-resp-in[id], textarea.qd-com-in[id]";
/** Depois de um envio da pílula, o Parar espera este tanto: o clique duplo em Enviar não cancela o turno novo (revisão 4). */
const SEM_PARAR_DEPOIS_DE_ENVIAR_MS = 600;

/** Os pedaços do palco que são "a conversa": saem juntos quando o Quadro entra. */
export const LADO_DA_CONVERSA = ["timeline", "pilula-novas", "faixa-trabalhos", "composer"] as const;

export interface QuadroNaTela {
  /**
   * Depois de cada desenho: `chave` é a conversa à vista com o quadro liberado, ou null (outra tela, flag desligada).
   * `agenteId` com `chave` null: a conversa desse bot está na tela, mas ele não tem quadro.
   */
  sincronizar(o: { chave: string | null; nome: string; agenteId?: string | null; paginas?: readonly Pagina[] }): void;
  /** NOD-445: ir a uma página da pílula (índice de dentro: 0 = Conversa, depois Tarefas, se houver, e os apps). */
  irPara(i: number, o?: { foco?: boolean }): void;
  /** ⌘[ ⌘]: a página anterior/seguinte na ordem da pílula. */
  andar(passo: -1 | 1, o?: { foco?: boolean; espiar?: boolean }): boolean;
  /** NOD-461: ⌥⇧← → move a página atual na ordem da pílula. false = não moveu (sem pílula ou na ponta). */
  moverAtual(passo: -1 | 1, o?: { foco?: boolean }): boolean;
  totalDePaginas(): number;
  /** Abre a página pelo id ("tarefas", "app:<id>"): o app que acabou de chegar. */
  abrirPagina(id: string): void;
  /** O app que acabou de chegar: o ícone e o pontinho entram com uma animação curta. */
  marcarChegada(id: string): void;
  pagina(): number;
  /** NOD-442: cada frame do SSE. `quadro.mudou` relê o quadro (os cards que mudaram acendem); a fala do bot sobe na faixa. */
  aoFrame(frame: { tipo: string; dados: Record<string, unknown> }): void;
  trocar(para: ModoDaConversa, o?: { foco?: boolean }): void;
  /** A conexão voltou sem o replay: relê o quadro (e a conversa, com um pedido esperando). */
  reler(): void;
  /** ADA-5: a fila de anexos ou o turno mudou por fora: o botão da pílula volta a decidir entre Enviar e Parar. */
  atualizarPilula(): void;
  /** ADA-5: a pílula (o composer do Quadro) quando o Quadro está na tela; null com a Conversa. */
  pilula(): HTMLFormElement | null;
  /** NOD-430: o código da tarefa num chat — abre a tarefa no quadro de `agenteId` quando a conversa dele estiver na tela. */
  abrirTarefaDe(agenteId: string, tarefaId: string): void;
  modo(): ModoDaConversa;
  /**
   * NOD-416: o link `?tarefa=`: abre a tarefa deste bot (a conversa dele já à vista) assim que o quadro chegar; o modo vira
   * Quadro. Antes de o quadro ser liberado (as preferências ainda não chegaram), o pedido espera o próximo `sincronizar`.
   */
  abrirTarefa(agenteId: string, tarefaId: string, quadroId?: string): void;
  /**
   * NOD-422 (revisão do PR #630): o Quadro deste bot vai abrir (um link ou um código de tarefa esperando o quadro chegar).
   * A trilha "conversa aberta" não conta a conversa que só passou por baixo a caminho do Quadro.
   */
  aCaminhoDoQuadro(agenteId: string): boolean;
}

/** NOD-445: o que a pílula de páginas pede ao main (a conversa, a API dos apps). */
export interface AcoesDasPaginas {
  /** "+ pedir um app": a caixa da conversa com a frase começada. */
  pedirApp(): void;
  /** O menu do ícone: "Editar pela conversa". */
  editarApp(p: Pagina): void;
  /** O menu do ícone: "Remover da pílula" (o main mostra o Desfazer). */
  removerApp(p: Pagina): void;
  /** O erro de fonte: "Pedir acesso de novo". */
  reconectar(p: Pagina): void;
  /** O GET das páginas do bot está no ar: um app ainda vazio mostra o esqueleto, não o "Nada aqui ainda". */
  lendo?(agenteId: string): boolean;
  /** ADA-13 (ADR-150): a página Canvas mora num host estável (o módulo dela cuida do DOM de dentro e dos frames). */
  canvas?: { montar(host: HTMLElement, agenteId: string, nome: string): void };
}

export function criarQuadroNaTela(doc: Document, o: { busca?: BuscaDaPilula; menuDaPilula?: PilulaDePaginas["menuDaPilula"]; reduzido?: () => boolean; aoTrocar?: (m: ModoDaConversa) => void; aoMudarOrdem?: () => void; aoTarefasPedirem?: (pedem: boolean) => void; dados?: DadosDoQuadro; paginas?: AcoesDasPaginas } = {}): QuadroNaTela {
  // Revisão 5 do ADA-5 (definido em 2026-11-04): a troca de vista descarta o ditado aberto (ADR-095) aqui, e não no
  // main, para que o teste do Chrome prove a regra; depois avisa quem ouve.
  const avisarTroca = (m: ModoDaConversa): void => {
    const dt = o.dados?.composer?.ditado;
    if (dt?.ativo()) dt.descartar?.();
    o.aoTrocar?.(m);
  };
  const reduzido = o.reduzido ?? (() => doc.defaultView?.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false);
  let chave: string | null = null;
  let nome = "";
  let modo: ModoDaConversa = "conversa";
  /**
   * NOD-445: as páginas da pílula. A 0 é a conversa e as outras moram na vista `#quadro`, então `modo` continua valendo
   * para o resto do main: "conversa" na página 0, "quadro" em qualquer outra.
   */
  let paginas: readonly Pagina[] = [CONVERSA, TAREFAS];
  let pagina = 0;
  /** A última página da vista (Tarefas ou um app): o `trocar("quadro")` de fora volta a ela. */
  let ultimaDaVista = 1;
  let forma: FormaDasTarefas = "quadro";
  let filtro: Filtro = "todos";
  /** NOD-460: a busca da barra, os menus abertos (o "+N" e o Exibir), o Exibir da pessoa e o campo "+" aberto numa coluna. */
  let busca = "";
  let maisAberto = false;
  let exibirAberto = false;
  /** NOD-460: o Exibir por id do quadro (o guardado no servidor, e o que a pessoa mudou nesta tela por cima). */
  let exibirPorQuadro: Record<string, ExibirDoQuadro> = {};
  let exibirPedido = false;
  let gravacaoDoExibir: Promise<void> = Promise.resolve();
  /** Sobe a cada mudança do Exibir feita nesta tela: a releitura que voltar depois de uma mudança local é descartada. */
  let versaoDoExibir = 0;
  let nova: { coluna: string; estreito?: boolean; erro?: boolean } | null = null;
  /** ADA-18: as folhas do celular (visão, toque longo, ⋯ do topo); web/lib/celular-do-quadro.ts. */
  const cel = criarCelularDoQuadro({
    trocarVisao, redesenhar: () => desenharVista(), focar: (s) => focarNaVista(s),
    atribuir: (id, agente) => { const t = tarefaNoQuadro(q, id); if (t && agente !== t.agenteId) mudarNaTarefaAberta(t, { agente }); },
    copiarLink: (id) => { void copiarLinkDaTarefa(id); },
    definirPrazo: (prazo) => { if (q && prazo !== q.prazo) void mexerNoQuadro("editar", { prazo }); },
  });
  /** Quadro minimalista (2026-11-10): o funil, as Opções, quem trabalha e o modal de Nova tarefa (web/lib/barra-do-quadro.ts). */
  const barraUi = criarBarraDoQuadro({
    quadro: () => q,
    colunas: () => (q ? comColunas(q).colunas : []),
    exibir: () => exibirDoQuadro(),
    gravarExibir: (m) => mudarExibir(m),
    desenhar: () => desenharVista(),
    focar: (s) => focarNaVista(s),
    anunciar: (t) => anunciar(t),
    podeCriar: () => !!dd?.api()?.criarTarefa,
    criarTarefa: async (c) => {
      // NOD-460 (como no fecharNova): a 1ª tarefa na coluna que a pessoa abriu (o Backlog vazio nasce recolhido) muda o
      // padrão dela, e a alternância a recolheria; quem acabou de criar nela segue vendo a coluna (e o foco volta ao "+").
      const mais = `.qd-so-largo [data-act="col-nova-tarefa"][data-status="${CSS.escape(c.status)}"]`;
      const abertaAntes = !!vista()?.querySelector(mais);
      const ok = await mudarTarefa((a, de) => a.criarTarefa?.(de, c), (r) => reciboDaNovaTarefa(c.titulo, r), acoesDaNovaTarefa);
      if (ok && abertaAntes && !vista()?.querySelector(mais)) { if (alternadas.has(c.status)) alternadas.delete(c.status); else alternadas.add(c.status); desenharVista(); }
      return ok;
    },
    noQuadro: () => modo === "quadro" && !aberta,
    celular: () => noCelular(),
  });
  /** ADA-18 (S9): segurar a linha do celular abre o menu da tarefa. */
  const toque = criarToqueLongo<string>(
    { agendar: (fn, ms) => Number(setTimeout(fn, ms)), cancelar: (id) => clearTimeout(id), agora: () => Date.now() },
    (id) => {
      if (!tarefaNoQuadro(q, id)) return false;
      (globalThis.navigator as { vibrate?: (ms: number) => boolean } | undefined)?.vibrate?.(10);
      cel.menuDaTarefa(id);
      return true;
    },
    TOQUE_LONGO_DA_LINHA_MS,
  );
  /** S5: o link da tarefa é o `?tarefa=` do NOD-416 (o código do quadro, ou o uuid). */
  async function copiarLinkDaTarefa(id: string): Promise<void> {
    const t = tarefaNoQuadro(q, id);
    if (!t) return;
    const url = new URL(globalThis.location.href);
    url.search = "";
    url.hash = "";
    url.searchParams.set(PARAMETRO_TAREFA, codigoNaUrl(t));
    let ok = false;
    try { await globalThis.navigator.clipboard.writeText(url.toString()); ok = true; } catch { ok = false; }
    const texto = ok ? `Link de ${t.titulo} copiado.` : "Não deu para copiar o link.";
    mudarFaixa(ok ? { tipo: "resposta", texto, loteId: null, mensagemId: "" } : { tipo: "erro", texto });
    anunciar(texto);
  }
  /** As colunas que a pessoa abriu ou recolheu, ao contrário do padrão. */
  let alternadas = new Set<string>();
  let animacoes: Animation[] = [];
  /** Quem está saindo na animação em curso (fica `inert`); na inversão, troca com quem entra. */
  let saindo: HTMLElement[] = [];
  let entrando: HTMLElement[] = [];
  let vez = 0;
  /**
   * A aba que tem o foco: se o render regravar o cabeçalho, o nó dela sai do DOM e o foco cai no body; aí ele vai para a aba
   * nova do mesmo modo. Zera quando a pessoa leva o foco para outro lugar (clique, toque, Tab), para não puxá-lo de volta.
   */
  let abaFocada: { el: HTMLElement; pagina: number } | null = null;

  const vista = (): HTMLElement | null => doc.getElementById("quadro");
  const conversa = (): HTMLElement[] => LADO_DA_CONVERSA.map((id) => doc.getElementById(id)).filter((e): e is HTMLElement => !!e);

  /* ---------- NOD-442: o quadro de verdade ---------- */
  const dd = o.dados;
  /**
   * ADA-5 (definido em 2026-11-04): a pílula é o composer do chat (web/lib/composer.ts): altura até 170 px, @, /, colar e
   * clipe, Enter (no celular quebra a linha), Esc. A delegação é no document filtrada pela pílula: sobrevive à regravação.
   */
  const cp = dd?.composer;
  const composer: ComposerLigado | null = cp
    ? ligarComposer(doc, {
        raiz: '#quadro .qc-pil[data-form="conversa-no-quadro"]',
        // Revisão 5 do ADA-5: de volta à Conversa a pílula fica no DOM (#quadro hidden); o soltar é do chat.
        ativo: () => modo === "quadro",
        celular: () => cp.celular(),
        sugestoes: () => cp.sugestoes(),
        ...(cp.barra ? { barra: cp.barra } : {}),
        // Bot que não lê anexo: a colagem segue como texto (revisão 1), como no chat sem clipe.
        ...(cp.anexos ? { anexar: (f: File[]) => cp.anexos?.adicionar(f), aceitaAnexo: () => !!cp.anexos?.aceita() } : {}),
        ...(cp.ditado ? { gravando: () => !!cp.ditado?.ativo() } : {}),
        sair: (ta) => sairDoCampo(ta),
        aoMudar: (ta) => { guardarRascunho(ta); atualizarBotaoDaPilula(); },
        // Revisão 2: o Enter com a pílula vazia não faz nada (como no chat); o Parar é só o clique no botão.
        enviar: (ta) => {
          if (!ta.value.trim() && !cp.ditado?.ativo() && (!chave || (cp.anexos?.quantos(chave) ?? 0) === 0)) return;
          ta.form?.requestSubmit();
        },
      })
    : null;
  // ADA-5: a resposta, o comentário e o recado guardam o rascunho a cada tecla (voltam depois de trocar de bot e recarregar).
  if (cp?.rascunhos) doc.addEventListener("input", (ev) => {
    const el = ev.target;
    if (el instanceof HTMLTextAreaElement && el.matches(CAMPOS_COM_RASCUNHO) && el.closest("#quadro")) guardarRascunho(el);
  });
  let agenteId: string | null = null;
  /**
   * ADA-14: o seletor de quadro. `sel` é a lista do bot `selDe` (lida antes do 1º quadro); `quadroPedido` é o quadro que um
   * link de tarefa pediu (vale na próxima leitura e vira o aberto).
   */
  let sel: QuadrosDoBotDto | null = null;
  let selDe: string | null = null;
  let selAberto = false;
  let selBusca = "";
  let selCriando: CriandoNoSeletor = null;
  let selErro: string | null = null;
  let quadroPedido: { agenteId: string; quadroId: string } | null = null;
  /**
   * NOD-445 (revisão 2, achado 1): a casa (1ª posição da pílula) ainda não foi decidida porque as páginas do servidor não
   * tinham chegado quando a conversa abriu (a primeira visita ao bot na sessão). Liga na troca de conversa sem o DTO e é
   * consumida no primeiro `sincronizar` com o DTO, se a pessoa não trocou de página no meio (`trocar`/`irPara` desligam).
   */
  let homePendente = false;
  let q: QuadroDto | null = null;
  let carga: "nada" | "carregando" | "ok" | "erro" = "nada";
  let aberta: string | null = null;
  /**
   * NOD-469: a rolagem do quadro (a caixa e a grade) no clique que abriu a tarefa, e a vista dela. Abrir troca a vista (a
   * grade some) e fechar a desenhava com scrollLeft 0; o voltarAoQuadro a devolve. Só vale para a mesma página e forma, na
   * mesma conversa e no mesmo quadro (a troca de bot ou de quadro com a tarefa aberta não a apaga).
   */
  let quadroAntesDaTarefa: { vista: string; de: string | null; quadro: string | null; rolagem: RolagemGuardada } | null = null;
  /** NOD-422 (PR 2): a tarefa aberta por link antes de o quadro chegar; a trilha sai quando ele chega (com o quadroId). */
  let trilhaPendente: string | null = null;
  let aberturaRegistrada = false;
  let viaDaAbertura: "tela" | "link" = "tela";
  const trilharAbertura = (): void => {
    if (aberturaRegistrada || modo !== "quadro" || !ehTarefas(pagina) || !q) return;
    aberturaRegistrada = true;
    dd?.trilha?.({ acao: "quadro_aberto", quadroId: q.id, via: viaDaAbertura });
    viaDaAbertura = "tela";
  };
  const trilhar = (tarefaId: string, via: "card" | "link"): void => {
    if (q && tarefaNoQuadro(q, tarefaId)) { trilhaPendente = null; dd?.trilha?.({ acao: "tarefa_aberta", quadroId: q.id, tarefaId, via }); }
    else trilhaPendente = tarefaId;
  };
  let acesas = new Set<string>();
  let faixa: Faixa = { tipo: "nada" };
  /** O último lote antes do pedido na pílula: o Desfazer da faixa é o lote que nasceu depois dele. */
  let loteAntes: string | null = null;
  let historico: TrocaDaFaixa[] = [];
  let histAberto = false;
  /** ADA-6: o cartão-mensagem (a resposta inteira, em markdown) aberto acima da pílula. */
  let lendo = false;
  /** ADA-6 (revisão): o último HTML de cada lugar da faixa; o frame que não muda nada não regrava (rolagem e foco ficam). */
  const desenhado = new WeakMap<Element, string>();
  /** ADA-6 (revisão A3): a resposta da pílula de Responder que o Desfazer pode devolver ao campo. */
  let ultimaResposta: { loteId: string; tarefaId: string; texto: string } | null = null;
  let observador: ResizeObserver | null = null;
  let observado: Element | null = null;
  let leitura = 0;
  let leituraConversa = 0;
  let timerReler: ReturnType<typeof setTimeout> | null = null;
  let timerRecolher: ReturnType<typeof setTimeout> | null = null;
  /** ADA-4: a trava e a chave do envio pela pílula (o 2º Enter com um envio em voo não manda nada). */
  const novaChave = (): string => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
  const envios = criarEnvios(novaChave);
  /** ADA-4: o relógio dos 90 s sem frame, o tique do tempo do turno e a faixa segura pelo ponteiro ou pelo foco. */
  /** Revisão 6 do #646: a fala que não saiu já voltou ao campo (o campo manda); `perdidos`: a que falhou noutra conversa. */
  let falhaNoCampo = false;
  /** Revisão 7 do #646: o recibo de outra ação com um pedido em curso (fica ao lado, a faixa do pedido não sai). */
  let aviso: AvisoDaFaixa | null = null;
  let timerAviso: ReturnType<typeof setTimeout> | null = null;
  /**
   * Revisão 7 do #646: as falas novas da conversa (`mensagem.nova`, com o id e o turno) desde que o pedido saiu: o prazo
   * que vence confere nelas se o pedido chegou mesmo.
   */
  let novasDoEnvio: { mensagemId: string; turnoId: string | null }[] = [];
  const perdidosDaPilula = new Map<string, string>();
  /**
   * Revisão 9 do #646 (M1): a chave da fala que falhou sem recusa (a rede, o 5xx, o prazo: o POST pode ter chegado), por
   * conversa e texto. Mandar a mesma fala de novo — do campo, depois de outro pedido no meio, ou ao voltar à conversa —
   * reusa a chave, e o servidor deduplica em vez de o bot fazer o pedido duas vezes.
   */
  const chavesQueFalharam = new Map<string, { id: string; em: number; lote: string | null }>();
  const chaveDaFala = (c: string, texto: string): string => `${c}\n${texto}`;
  /**
   * Revisão 11 (M1): a chave guardada só vale na janela de reenvio. Passado o prazo, o mesmo texto é um pedido novo (um
   * "sim" de agora não pode cair no turno antigo, já encerrado). Outro pedido no meio não a apaga (revisão 9: a fala que
   * voltou ao campo e sai depois dele ainda pode ter chegado). A pílula sempre dá a chave ao `envios` (o dele reusaria a
   * da última fala igual sem prazo).
   */
  const chaveQueFalhou = (c: string, texto: string): string | undefined => {
    const k = chavesQueFalharam.get(chaveDaFala(c, texto));
    if (k && Date.now() - k.em <= (dd?.validadeDaChaveMs ?? VALIDADE_DA_CHAVE_MS)) return k.id;
    chavesQueFalharam.delete(chaveDaFala(c, texto));
    return undefined;
  };
  /** Revisão 11 (M2): o lote do pedido que já pulsou (o card pulsa quando o pedido vira trabalho, uma vez só). */
  let lotePulsado: string | null = null;
  /** Revisão 12 do #646 (M2): os turnos que o pedido da faixa já teve (a resposta só vem deles). */
  let turnosDoPedido = new Set<string>();

  let timerSilencio: ReturnType<typeof setTimeout> | null = null;
  let timerAnuncio: ReturnType<typeof setTimeout> | null = null;
  let anunciadoEm = 0;
  /** Revisão 2 do #646: a nova tentativa do pulso (o gesto segurava o desenho); cai no reset e na troca de bot. */
  let timerPulso: ReturnType<typeof setTimeout> | null = null;
  let timerArmar: ReturnType<typeof setTimeout> | null = null;
  let timerTempo: ReturnType<typeof setInterval> | null = null;
  const faixaSegura = { ponteiro: false, foco: false };
  /** O último HTML gravado em cada #qc-faixa: a faixa igual não é regravada (ADR-061: a atividade chega várias vezes por segundo). */
  const faixaGravada = new WeakMap<Element, string>();
  let dica: string[] = [];
  /** NOD-415: a meta no topo virou campo (Enter salva, Esc desiste). */
  let editandoMeta = false;
  /** NOD-422: o painel "Trazer do Linear…" aberto no topo, e a releitura enquanto a importação traz. */
  let importando: PainelImportacao | null = null;
  let timerImportacao: ReturnType<typeof setTimeout> | null = null;
  /** NOD-448: o pedaço da edição das colunas que está aberto (menu, renomear, remover, coluna nova, a folha do celular). */
  let edicao: EdicaoDeColuna | null = null;
  let tarefasPedem = false;
  /**
   * NOD-419: a recusa da trava no card que a pessoa soltou. Some sozinha (sem a pessoa no card), no Esc ou no próximo
   * gesto; ao sumir com o foco nela, o foco volta ao card.
   */
  let recusa: { tarefa: string; destino: string; aviso: Aviso } | null = null;
  let relogio: RelogioDaRecusa | null = null;
  /** NOD-416: o histórico da tarefa aberta (null = carregando), os quadros do "Mover para…" e o link que espera o quadro. */
  let histTarefa: EntradaHistoricoDto[] | null = null;
  let quadros: QuadroDaPessoaDto[] | null = null;
  let leituraHist = 0;
  /** NOD-430: a tarefa pedida pelo código num chat (`nod-tarefa:`): abre quando a conversa do dono dela estiver na tela. */
  let pendente: { agenteId: string; tarefaId: string } | null = null;
  /** NOD-443: o painel aberto abaixo do topo (Pessoas ou Atividade), o mural (null = carregando) e o porquê de uma recusa. */
  let painel: PainelDoQuadro = null;
  let mural: LinhaMuralDto[] | null = null;
  let erroPessoas: string | null = null;
  let leituraMural = 0;
  /** QA do PR #623 (D4): o aviso do mover, dito no quadro destino quando a tarefa movida abre lá. */
  let avisoDoMover: string | null = null;
  /** ADA-17: no celular, a troca que ainda não voltou (o chip já mostra), a que não salvou e o comentário respondido. */
  let otimistaCel: TrocaCel | null = null;
  let naoSalvouCel: NaoSalvouCel | null = null;
  let seqCel = 0;
  let respondendo: ({ tarefa: string } & Respondendo) | null = null;
  /** O quadro escolhido no "Mover para…" da tarefa aberta: um redesenho (o histórico, os comentários) não o apaga. */
  let moverPara: string | null = null;
  /** NOD-430: a tarefa pedida pelo código num chat (`nod-tarefa:`): abre quando a conversa do dono dela estiver na tela. */
  let pedidoDoChat: { agenteId: string; tarefaId: string } | null = null;
  /** NOD-417: os comentários da tarefa aberta. */
  // ADA-7 (revisão 3): a leitura que chega sozinha (o frame, o abrir) redesenha só com a tela livre do gesto.
  const coms = criarComentariosNaTela({ api: () => dd?.api() ?? null, redesenhar: () => { if (aberta) redesenharQuandoLivre(); } });
  /** NOD-418: o trabalho da tarefa aberta (o atual ao vivo, os anteriores, Repetir, Cancelar e o recado). */
  const trabs = criarTrabalhosDaTarefa({
    api: () => dd?.api() ?? null,
    redesenhar: () => { if (aberta) desenharVista(); },
    redesenharLido: () => { if (aberta) redesenharQuandoLivre(); },
    log: () => vista()?.querySelector<HTMLElement>(".qd-trab-log") ?? null,
    // QA do NOD-468: o log escrito no lugar (o passo novo, ao vivo) também segura o texto lido abaixo dele. Medido em
    // 2026-11-11 a 390 (toque), sem isto: 21 px por passo com o log aberto acima do comentário lido.
    escreverNoLog: (escrever) => segurarLeitura(escrever),
    // ADA-7 (revisão 8): o delta do log do trabalho também espera o dedo (o mesmo teto do redesenho).
    // O log não recria o campo do recado: só o gesto o segura.
    segura: (desde) => seguraGesto(desde),
    // Revisão 5 do PR #625: a região de status fica fora da .qd-conteudo (que o desenho recria): o mesmo nó, só o texto muda.
    anuncio: () => vista()?.querySelector<HTMLElement>(":scope > #qd-trab-anuncio") ?? null,
    aplicarQuadro: (novo) => aplicarQuadro(novo, aberta ? [aberta] : []),
    ...(dd?.juntarEm !== undefined ? { juntarEm: dd.juntarEm } : {}),
    // 2026-11-10: o bloco do run na linha do tempo: só o texto do último passo troca (o campo de comentário fica).
    aoPasso: (turno, ultimo) => {
      for (const el of vista()?.querySelectorAll<HTMLElement>(`[data-run-vivo="${CSS.escape(turno)}"]`) ?? []) el.textContent = trecho(ultimo, 140) || el.textContent;
    },
  });

  /** Os itens de menu que andam pelas setas: o menu da coluna e os da barra do quadro (NOD-460). */
  const ITEM_DE_MENU = '#qd-menu [role="menuitem"], #qd-menu-exibir [role="menuitemcheckbox"], #qd-menu-agentes [role="menuitemradio"], #qd-menu-agentes [role="menuitem"]';

  function zerarDados(): void {
    if (aberta) dd?.naUrl?.(null);
    histTarefa = null; quadros = null; leituraHist++;
    // Revisão 7 do #646 (B1): a fala que não saiu e ficou só na faixa volta ao campo quando a pessoa retornar à conversa.
    // Revisão 8 (A1): a que voltou ao campo também: o campo é recriado vazio na troca. Vale o que está nele (a pessoa pode
    // tê-la editado); campo esvaziado pela pessoa não volta.
    if (chave && faixa.tipo === "falhou") {
      const noCampo = doc.getElementById("qc-txt") as HTMLTextAreaElement | null;
      const guardar = falhaNoCampo ? (noCampo?.value.trim() ?? "") : faixa.fala;
      if (guardar) perdidosDaPilula.set(chave, guardar);
    } else if (chave && faixa.tipo === "erro" && faixa.fala) perdidosDaPilula.set(chave, faixa.fala);
    agenteId = null; q = null; carga = "nada"; aberta = null; acesas = new Set(); faixa = { tipo: "nada" }; loteAntes = null;
    sel = null; selDe = null; selAberto = false; selBusca = ""; selCriando = null; selErro = null;
    aviso = null; novasDoEnvio = [];
    if (timerAviso) clearTimeout(timerAviso);
    timerAviso = null;
    doc.querySelector('#quadro [data-form="conversa-no-quadro"]')?.removeAttribute("aria-busy");
    painel = null; mural = null; erroPessoas = null; leituraMural++;
    historico = []; histAberto = false; lendo = false; ultimaResposta = null; tarefasPedem = false; leitura++; leituraConversa++; dica = []; editandoMeta = false; edicao = null; importando = null; otimistaCel = naoSalvouCel = respondendo = null; folhaAberta()?.fechar(false); coms.fechar(); trabs.fechar();
    if (timerReler) clearTimeout(timerReler);
    if (timerImportacao) clearTimeout(timerImportacao);
    timerImportacao = null;
    if (timerRecolher) clearTimeout(timerRecolher);
    if (timerSilencio) clearTimeout(timerSilencio);
    if (timerArmar) clearTimeout(timerArmar);
    timerArmar = null;
    if (timerAnuncio) clearTimeout(timerAnuncio);
    timerAnuncio = null; anunciadoEm = 0;
    if (timerPulso) clearTimeout(timerPulso);
    timerPulso = null;
    if (timerTempo) clearInterval(timerTempo);
    timerSilencio = timerTempo = null;
    if (timerDetalhe) clearTimeout(timerDetalhe);
    timerReler = timerRecolher = timerDetalhe = null;
    releituraDesde = detalheDesde = 0;
  }

  function conteudoHtml(): Html | string {
    const p = paginas[pagina];
    if (p?.app) return paginaDoApp(p, nome, { lendo: agenteId !== null && (o.paginas?.lendo?.(agenteId) ?? false) });
    if (!dd) return quadroVazio({ nome, filtro, alternadas });
    if (carga === "nada" || carga === "carregando") return quadroCarregando();
    if (carga === "erro") return quadroComErro();
    if (!q) return semQuadro(nome, Date.now());
    const t = tarefaNoQuadro(q, aberta);
    if (t) {
      const trabalhos = trabs.html(t.id, { bloqueada: t.status === "bloqueado" || (t.esperaPessoa === true && t.voltarPara !== null), agenteId: t.agenteId, conversaAtual: chave, hora: dd.hora });
      const resp = dd.agentes?.();
      // 2026-11-10 (a issue do Multica): a linha do tempo, o chip do topo e a lateral (Registro, Entregas, Runs no tempo).
      trabs.escutar(coms.runs(t.id).filter((r) => r.estado === "rodando").map((r) => r.turnoAtual));
      const partes = coms.partes(t, { colunas: comColunas(q).colunas, agente: dd.agente, nomes: (resp ?? []).map((a) => a.nome), passos: (turno) => trabs.passosDe(turno), ...(trabalhos !== undefined ? { trabalho: trabalhos } : {}) });
      if (ehCelular()) {
        // ADA-17 (ADR-148): a mesma tarefa, os mesmos dados e handlers; só a árvore muda no celular.
        const trabalho = trabs.vista(t.id, { bloqueada: t.status === "bloqueado" || (t.esperaPessoa === true && t.voltarPara !== null), agenteId: t.agenteId, conversaAtual: chave });
        const cd = coms.dados(t.id);
        return tarefaAbertaCelular({
          t, q, agente: dd.agente, hora: dd.hora, historico: dd.api()?.historicoTarefa ? histTarefa : undefined, ...(resp ? { responsaveis: resp } : {}), ...(cd ? { coms: cd } : {}), ...(trabalho ? { trabalho } : {}),
          respondendo: respondendo?.tarefa === t.id ? respondendo : null, otimista: otimistaCel?.tarefa === t.id ? otimistaCel : null, naoSalvou: naoSalvouCel?.tarefa === t.id ? naoSalvouCel.qual : null,
        });
      }
      return tarefaAberta({ t, q, agente: dd.agente, comentarios: coms.html(t.id, dd.agente, dd.hora), hora: dd.hora, historico: dd.api()?.historicoTarefa ? histTarefa : undefined, ...(resp ? { responsaveis: resp } : {}), ...(quadros ? { destinos: destinosDaTarefa(quadros, q.id), moverPara } : {}), ...(trabalhos !== undefined ? { trabalhos } : {}), ...(partes ?? {}) });
    }
    const comPessoas = !!dd.api()?.adicionarPessoa;
    const agentes = dd.agentes && dd.api()?.definirPassagem ? dd.agentes() : undefined;
    const seletor = seletorDeQuadro(sel, { aberto: selAberto, busca: selBusca, criando: selCriando, erro: selErro });
    // Quadro mínimo: no computador o seletor mora no cabeçalho (o item "Trocar de quadro…" do menu o abre).
    const noCab = !noCelular();
    return confiar((noCab ? "" : seletor) + quadroDaMeta({ q, ...(noCab && mostraSeletor(sel) ? { seletor, trocar: true } : {}), nome, agente: dd.agente, filtro, alternadas, acesas, edicao, agora: Date.now(), editandoMeta, ...(comPessoas ? { pessoas: { painel, mural, hora: dd.hora, erro: erroPessoas } } : {}), ...(agentes ? { agentes } : {}), ...(importando ? { importando } : {}), ...(recusa ? { avisos: new Map([[recusa.tarefa, recusa.aviso]]) } : {}), busca, exibir: { ...exibirDoQuadro(), aberto: exibirAberto }, maisAberto, nova, podeCriar: !!dd.api()?.criarTarefa, ui: barraUi.ui(), ...(noCelular() ? { celular: { visao: visaoDoQuadro(), folha: cel.folha() } } : {}) }));
  }

  /** ADA-18: o quadro do celular (o teste injeta; o app lê a consulta canônica a cada desenho). */
  function noCelular(): boolean {
    return dd?.celular ? dd.celular() : ehCelular();
  }
  /** ADA-18: a visão do celular, guardada no Exibir do quadro; a desconhecida (ou ausente) cai em Lista. */
  function visaoDoQuadro(): VisaoDoQuadro {
    const v = exibirDoQuadro().visao;
    return v && VISOES_DO_QUADRO.includes(v) ? v : "lista";
  }

  /**
   * Regrava só o conteúdo (o quadro ou a tarefa). A pílula fica: o rascunho e o foco nela sobrevivem a cada frame. O que a
   * pessoa digitava numa resposta também volta (o campo é o mesmo id), e o foco com ele.
   */
  /** ADA-7: a vista do último desenho (página, tarefa aberta, forma); a regravação da mesma vista guarda a rolagem. */
  let vistaDesenhada: string | null = null;
  /** ADA-7: o minuto do último desenho; o quadro igual de outro minuto regrava (o "parada há", o prazo). */
  let minutoDesenhado = -1;
  /** ADA-12: a posição que a pessoa escolheu na vista (o corte do navegador no conteúdo que encolheu não a muda). */
  let rol: ReturnType<typeof criarAlvosDeRolagem> | null = null;
  const reserva = criarReservaDeAltura({ ms: dd?.reservaMs ?? RESERVA_MS, segura: () => gesto.ativo(), esperaMs: GESTO_MS });
  /** ADA-12: o próximo desenho é de uma leitura (o frame, os comentários, o trabalho), não de um clique da pessoa. Só ele
   * reserva a altura e leva a vista ao alvo; a regravação da pessoa (filtro, painel, edição) segue com ela (revisão 1). */
  let aoVivo = false;
  /** ADA-12 (QA, bug 1): até quando o redesenho de uma leitura é eco da ação da pessoa (sem alvo nem reserva). */
  let daPessoaAte = 0;
  /** ADA-12 (revisão 10): até quando os desenhos seguem o fim depois do comentário que a pessoa mandou colada no fim. */
  let fimDoComentarioAte = 0;
  /** A tarefa do comentário: fechar e reabrir na janela não leva a tarefa recém-aberta ao fim. */
  let fimDoComentarioDe: string | null = null;
  /** ADA-12 (revisão 5): o último desenho mostrou a tarefa aberta ainda lendo os comentários. */
  let carregavaNoDesenho = false;
  /** ADA-12 (revisão 7): o último desenho mostrou a tarefa aberta com todas as leituras da abertura já chegadas. */
  let abertaCompletaNoDesenho = false;
  let desenhoDevido = false;
  /** ADA-7: o gesto na vista (o dedo, a última mexida e a última rolagem) e desde quando a releitura do frame espera. */
  let releituraDesde = 0;
  let timerDetalhe: ReturnType<typeof setTimeout> | null = null;
  let detalheDesde = 0;

  /**
   * QA do NOD-468: a escrita ao vivo que muda um pedaço da tarefa aberta no lugar, sem o desenharVista (o log do
   * trabalho), com a mesma âncora de leitura: fora do colado no fim e do alvo cortado da ADA-12, e com o gesto, que já
   * segura a escrita, fora (quem chama só escreve com a tela livre).
   */
  function segurarLeitura(escrever: () => void): void {
    const v = vista();
    const conteudo = v?.querySelector<HTMLElement>(":scope > .qd-conteudo") ?? null;
    const alvoDaCaixa = rol?.alvo("caixa");
    const colada = alvoDaCaixa?.colado ?? (!!v && v.scrollHeight - v.clientHeight - v.scrollTop <= COLADO_PX);
    const cortada = !!v && !!alvoDaCaixa && Math.abs(alvoDaCaixa.topo - v.scrollTop) > 1;
    const ancora = v && conteudo && aberta && !colada && !cortada && v.scrollTop > 0 ? acharAncora(v, conteudo) : null;
    escrever();
    if (!v || !conteudo || !ancora) return;
    const alvo = topoPelaAncora(ancora, v, conteudo);
    const max = v.scrollHeight - v.clientHeight;
    if (alvo !== null && alvo >= 0 && alvo <= max + 0.5 && Math.abs(v.scrollTop - alvo) > 0.5) { v.scrollTop = alvo; rolagemDoPrograma(v); rol?.aceitar(); }
  }

  function desenharVista(): void {
    const vivo = aoVivo;
    aoVivo = false;
    const v = vista();
    if (!v) return;
    marcarTopo();
    // Quadro minimalista: a visão (Quadro | Lista) mora nas Opções do quadro, guardadas por quadro.
    if (q && dd) forma = opcoesEfetivas(exibirDoQuadro()).vista;
    v.dataset["forma"] = forma;
    v.dataset["pagina"] = paginas[pagina]?.id ?? "";
    if (paginas[pagina]?.id === "canvas" && o.paginas?.canvas && agenteId) {
      // ADA-13: o host do canvas não é regravado a cada frame (os iframes e a vista ficam); as outras páginas o trocam.
      let host = v.querySelector<HTMLElement>(":scope > .cv-host");
      if (!host || host.dataset["agente"] !== agenteId) {
        v.innerHTML = "";
        host = doc.createElement("div");
        host.className = "cv-host";
        host.dataset["agente"] = agenteId;
        v.append(host);
        vistaDesenhada = null;
      }
      o.paginas.canvas.montar(host, agenteId, nome);
      return;
    }
    if (v.querySelector(":scope > .cv-host")) v.innerHTML = "";
    if (!dd) { v.innerHTML = conteudoHtml(); vistaDesenhada = null; return; }
    let conteudo = v.querySelector<HTMLElement>(":scope > .qd-conteudo");
    if (!conteudo) {
      // Merge da main (#623): a região do quadro (rodapé) vem primeiro; a do trabalho (NOD-418) depois, as duas fora da .qd-conteudo.
      const aceita = dd.composer?.anexos?.aceita();
      v.innerHTML = `<div class="qd-conteudo"></div><footer class="qc-wrap">${pilulaDoQuadro({ meta: q?.meta ?? null, nome, ...(aceita ? { anexos: aceita } : {}) })}<p class="qd-sr qd-anuncio" role="status" aria-live="polite"></p></footer><p class="qd-sr" id="qd-trab-anuncio" role="status" aria-atomic="true"></p>`;
      conteudo = v.querySelector<HTMLElement>(":scope > .qd-conteudo");
      vistaDesenhada = null;
      // ADA-5: o rascunho da pílula volta (outro bot, recarregar); a fila de anexos e o 🎤 vêm do main.
      const txtNovo = v.querySelector<HTMLTextAreaElement>("#qc-txt");
      if (txtNovo && chave) {
        txtNovo.dataset["rascunho"] = chaveDoRascunho(chave, null);
        const r = dd.composer?.rascunhos?.ler(txtNovo.dataset["rascunho"]) ?? "";
        if (r) { txtNovo.value = r; composer?.atualizar(txtNovo); }
      }
      dd.composer?.aoCriarPilula?.();
    }
    if (!conteudo) return;
    const rascunhos = new Map<string, string>();
    // NOD-448: o nome que a pessoa digita numa coluna (renomear, nova) sobrevive ao frame que regrava o quadro.
    for (const c of conteudo.querySelectorAll<HTMLTextAreaElement | HTMLInputElement>("textarea[id], input.qd-col-in[id], input.qd-nova-in[id]")) if (c.value) rascunhos.set(c.id, c.value);
    // ADA-5: o que está nos campos é o rascunho de cada um (o campo limpo pelo envio apaga o dele).
    for (const c of conteudo.querySelectorAll<HTMLTextAreaElement>(CAMPOS_COM_RASCUNHO)) guardarRascunho(c);
    const ativo = doc.activeElement;
    const focoId = ativo instanceof HTMLElement && conteudo.contains(ativo) && ativo.id ? ativo.id : null;
    const focoColuna = ativo instanceof HTMLElement && conteudo.contains(ativo) && !ativo.id ? seletorDoFocoDaColuna(ativo) ?? seletorDoFocoDoCard(ativo) : null;
    // QA do PR #700: o item focado da folha do celular volta a ter o foco no desenho (senão cai no body, fora da folha).
    const focoFolha = ativo instanceof HTMLElement && conteudo.contains(ativo) && !ativo.id ? seletorDoFocoDaFolha(ativo) : null;
    const sel = (ativo instanceof HTMLInputElement || ativo instanceof HTMLTextAreaElement) && focoId ? [ativo.selectionStart, ativo.selectionEnd] as const : null;
    // ADA-7: a mesma vista (página, tarefa e forma) regravada pelo frame fica onde a pessoa rolou; trocar de vista
    // (abrir a tarefa, voltar ao quadro, outra página) segue com quem a trocou (abrirTarefa e irPara levam ao topo).
    const vistaAgora = `${paginas[pagina]?.id ?? ""}|${aberta ?? ""}|${forma}`;
    const mesmaVista = vistaAgora === vistaDesenhada;
    // ADA-12: a rolagem que o evento ainda não contou entra no alvo antes de o conteúdo mudar; a vista nova começa sem alvo.
    const doAlvo = mesmaVista && vivo;
    // ADA-12 (revisões 9 e 10): quem comentou colada no fim (ou com a tarefa inteira na tela) segue o fim nos desenhos do
    // eco do comentário, como num chat; senão a resposta que chega depois não aparece. Só o comentário: abrir os passos,
    // repetir ou mudar o status no fim da tarefa fica onde a pessoa estava.
    if (!mesmaVista) fimDoComentarioAte = 0;
    const seguirFim = mesmaVista && !!aberta && aberta === fimDoComentarioDe && Date.now() < fimDoComentarioAte;
    if (doAlvo) rol?.antes(); else { rol?.esquecer(); reserva.soltar(); }
    // ADA-12 (revisão 5): o fim tocado enquanto a tarefa recém-aberta ainda lia os comentários (o que vem no fim dela) não
    // cola: ela não pula ao fim quando eles chegam; fica onde estava. Só os comentários: o trabalho, que vem acima deles,
    // chegando depois não tira do fim quem desceu até os comentários já lidos (revisão 6).
    if (doAlvo && carregavaNoDesenho && rol?.alvo("caixa")?.colado) rol.esquecer();
    // Revisão 6: a tarefa aberta que cabia inteira na tela (sem rolagem, a pessoa vê o fim) segue o fim, como a colada.
    // Revisão 7: só depois de a abertura inteira ter chegado num desenho anterior (os comentários, o trabalho e o
    // histórico); senão a leitura que chega por último desceria a tarefa recém-aberta e o título sumiria.
    const cabiaInteira = doAlvo && !!aberta && abertaCompletaNoDesenho && !rol?.alvo("caixa") && v.scrollHeight - v.clientHeight <= COLADO_PX;
    carregavaNoDesenho = !!aberta && coms.carregando();
    abertaCompletaNoDesenho = !!aberta && !coms.carregando() && !trabs.carregando() && !(dd?.api()?.historicoTarefa && histTarefa === null);
    const rolagem = mesmaVista ? guardarRolagem(v, conteudo) : null;
    // NOD-468: na tarefa aberta, quem lê no meio (não colada no fim) fica com o mesmo texto no mesmo lugar: a âncora é o
    // bloco no topo da vista, e o desenho novo compensa o que mudou de altura acima dele.
    const coladaAntes = rol?.alvo("caixa")?.colado ?? (v.scrollHeight - v.clientHeight - v.scrollTop <= COLADO_PX && v.scrollTop > 0);
    // Com o alvo da ADA-12 cortado (o conteúdo encolheu e o navegador limitou a rolagem), quem manda é o alvo: a âncora de
    // agora seria um bloco do corte, e prendê-lo tiraria a vista do lugar quando o conteúdo voltasse.
    const alvoDaCaixa = rol?.alvo("caixa");
    const cortada = !!alvoDaCaixa && Math.abs(alvoDaCaixa.topo - v.scrollTop) > 1;
    // Revisão 1: só no desenho ao vivo (o frame, a releitura). A regravação da pessoa (abrir os passos, responder, editar)
    // muda o bloco que ela tocou, que pode cruzar o topo: a âncora abaixo dele levaria o que ela tocou para cima. Ali a
    // posição fica com quem regravou (ADA-12, `esquecer`).
    const ancora = doAlvo && !!aberta && !coladaAntes && !cortada && !seguirFim && v.scrollTop > 0 ? acharAncora(v, conteudo) : null;
    // Revisão 3: colada no fim segue o fim do desenho novo, sem reserva (a reserva a deixaria no branco até ela soltar).
    const alturaAntes = doAlvo && !rol?.alvo("caixa")?.colado ? reserva.antes(conteudo, v) : 0;
    vistaDesenhada = vistaAgora;
    minutoDesenhado = Math.floor(Date.now() / 60_000);
    desenhoDevido = false;
    // ADA-12 (revisão 4): o histórico de movimentos aberto continua aberto (recriado fechado, a tarefa encolhia e a reserva
    // ficava em branco).
    const movimentosAbertos = mesmaVista && conteudo.querySelector<HTMLDetailsElement>("details.qd-hist")?.open === true;
    conteudo.innerHTML = conteudoHtml();
    if (movimentosAbertos) { const d = conteudo.querySelector<HTMLDetailsElement>("details.qd-hist"); if (d) d.open = true; }
    // NOD-445: o Lista | Quadro de Tarefas foi para as Opções do quadro (quadro minimalista, 2026-11-10).
    for (const [id, valor] of rascunhos) { const c = doc.getElementById(id); if (c instanceof HTMLTextAreaElement || c instanceof HTMLInputElement) c.value = valor; }
    restaurarRascunhos(conteudo);
    // ADA-12: a releitura que volta mais curta por um instante não encolhe a vista (o navegador cortaria a rolagem).
    if (alturaAntes > 0) reserva.depois(conteudo, alturaAntes);
    // ADA-7: a rolagem volta depois dos rascunhos (o campo que cresce com o texto mudaria a altura e a vista pularia).
    if (rolagem) restaurarRolagem(v, conteudo, rolagem);
    // ADA-18: os pontos das colunas do celular seguem a coluna que a rolagem restaurada deixou à vista.
    atualizarPontos(conteudo);
    // ADA-12: o alvo vence o valor guardado (que pode ser o corte de um conteúdo que encolheu no desenho anterior).
    rol?.depois(doAlvo);
    if (ancora && !cabiaInteira && !seguirFim) {
      const alvo = topoPelaAncora(ancora, v, conteudo);
      // A âncora que o conteúdo de agora não alcança (cortaria a rolagem) fica com a ADA-12 (o alvo e a reserva).
      const max = v.scrollHeight - v.clientHeight;
      if (alvo !== null && alvo >= 0 && alvo <= max + 0.5 && Math.abs(v.scrollTop - alvo) > 0.5) { v.scrollTop = alvo; rolagemDoPrograma(v); rol?.aceitar(); }
    }
    if (cabiaInteira || seguirFim) v.scrollTop = v.scrollHeight;
    // ADA-7: o foco volta sem rolar (o título da tarefa aberta, recriado e focado, levava a vista ao topo).
    if (focoColuna) focarSemRolar(conteudo.querySelector<HTMLElement>(focoColuna));
    if (focoFolha) focarSemRolar(conteudo.querySelector<HTMLElement>(focoFolha) ?? conteudo.querySelector<HTMLElement>(".qd-cel-folha"));
    if (focoId) {
      const novo = doc.getElementById(focoId);
      focarSemRolar(novo);
      if (sel && (novo instanceof HTMLInputElement || novo instanceof HTMLTextAreaElement)) { try { novo.setSelectionRange(sel[0], sel[1]); } catch { /* o tipo não tem seleção */ } }
    }
    const form = v.querySelector<HTMLElement>('[data-form="conversa-no-quadro"]');
    const rot = q?.meta ? `Conversar com o quadro ${q.meta}` : `Conversar com ${nome} sobre o quadro`;
    if (form && form.getAttribute("aria-label") !== rot) form.setAttribute("aria-label", rot);
    const txt = v.querySelector<HTMLTextAreaElement>("#qc-txt");
    const t = tarefaNoQuadro(q, aberta);
    if (txt) txt.placeholder = t ? `Recado sobre ${t.linearId ?? t.titulo}` : "Nova tarefa ou mensagem";
    // Revisão 6 do #646: o pedido que falhou com a pessoa noutra conversa volta ao campo quando ela retorna.
    const perdido = chave !== null ? perdidosDaPilula.get(chave) : undefined;
    if (txt && perdido !== undefined && chave !== null) { perdidosDaPilula.delete(chave); if (!txt.value.trim()) { txt.value = perdido; atualizarBotaoDaPilula(); } }
    desenharIdeias();
    // NOD-443 (D2): o rótulo diz quem vê esta conversa, com gente no quadro.
    const modo = v.querySelector<HTMLElement>("#qc-modo");
    if (modo) { const m = q ? rotuloDoModo(q) : null; modo.hidden = !m; modo.textContent = m ?? ""; }
    desenharFaixa();
  }

  /** ADA-5: a chave de rascunho do campo da vista (a resposta, o comentário, o recado), marcada nele quando ele nasce. */
  function restaurarRascunhos(conteudo: HTMLElement): void {
    const r = dd?.composer?.rascunhos;
    if (!chave) return;
    for (const c of conteudo.querySelectorAll<HTMLTextAreaElement>(CAMPOS_COM_RASCUNHO)) {
      // Revisão 6 do ADA-5 (definido em 2026-11-04): a resposta é da tarefa que pergunta (o card e a tarefa aberta), não
      // da tarefa aberta na hora; assim o envio limpa todas as chaves dela.
      const daTarefa = c.closest<HTMLElement>('form[data-form="responder-tarefa"]')?.dataset["id"] ?? aberta;
      c.dataset["rascunho"] = chaveDoRascunho(chave, { tarefa: daTarefa, id: c.id });
      if (!c.value && r) c.value = r.ler(c.dataset["rascunho"]);
    }
  }
  /**
   * Revisão 6 do ADA-5 (definido em 2026-11-04): a resposta foi aceita, a pergunta acabou. Saem os rascunhos de todos os
   * campos de resposta da tarefa (o card, a linha do celular, a tarefa aberta) e, na mesma conversa, o texto dos campos
   * que estão na tela agora (o nó do começo do envio pode ter sido regravado por um frame no meio).
   */
  function limparRespostaEnviada(conv: string, tarefa: string, resposta: string): void {
    const ids = [`qd-resp-${tarefa}`, `qd-cresp-card-${tarefa}`, `qd-cresp-linha-${tarefa}`];
    for (const id of ids) cp?.rascunhos?.guardar(chaveDoRascunho(conv, { tarefa, id }), "");
    if (conv !== chave) return;
    for (const id of ids) {
      const el = doc.getElementById(id);
      // Revisão 7: o campo regravado no voo pode ter sido editado; a edição fica.
      if (el instanceof HTMLTextAreaElement && el.value.trim() === resposta) el.value = "";
    }
  }
  function guardarRascunho(c: HTMLTextAreaElement): void {
    const k = c.dataset["rascunho"];
    if (k) dd?.composer?.rascunhos?.guardar(k, c.value);
  }
  /**
   * Esc com texto sai do campo e o rascunho fica (ADA-5). Com uma tarefa aberta o foco vai ao conteúdo dela, para o Esc
   * seguinte fechá-la (QA do ADA-5, 2026-11-04: com o foco no body o segundo Esc não fazia nada).
   */
  function sairDoCampo(el: HTMLElement): void {
    const c = aberta ? vista()?.querySelector<HTMLElement>(":scope > .qd-conteudo") : null;
    if (!c) { el.blur(); return; }
    if (!c.hasAttribute("tabindex")) c.tabIndex = -1;
    c.focus({ preventScroll: true });
  }
  /** As conversas com um envio da pílula em voo (revisão 2 do ADA-5). */
  const enviandoEm = new Set<string>();
  /** Quando a pílula mandou o último pedido de cada conversa (revisão 4 do ADA-5, definido em 2026-11-04). */
  const enviouEm = new Map<string, number>();
  const pilulaNaTela = (): HTMLFormElement | null => vista()?.querySelector<HTMLFormElement>('.qc-pil[data-form="conversa-no-quadro"]') ?? null;
  /**
   * O bot desta conversa está trabalhando. ADA-5: com o composer, o critério do Parar do chat (o turno vivo, venha de onde
   * vier); sem ele, o turno do pedido da faixa (ADA-4), já armado (ARMAR_PARAR_MS depois do aceito).
   */
  function trabalhando(agora = Date.now()): boolean {
    const cp = dd?.composer;
    if (!chave) return false;
    if (cp?.parar) return cp.trabalhando ? cp.trabalhando() : podeParar(faixa, agora);
    return !!dd?.api()?.pararConversa && podeParar(faixa, agora);
  }
  function temConteudo(): boolean {
    const txt = pilulaNaTela()?.querySelector<HTMLTextAreaElement>("#qc-txt");
    return !!txt?.value.trim() || (!!chave && (dd?.composer?.anexos?.quantos(chave) ?? 0) > 0);
  }
  /** ADA-5: com o bot respondendo e nada para mandar, o botão da pílula é o Parar (o mesmo botão, outro rótulo). */
  function pararNaPilula(agora = Date.now()): boolean {
    return !!pilulaNaTela()?.querySelector("#qc-txt") && trabalhando(agora) && !temConteudo();
  }
  /** ADA-4 + ADA-5: o botão da pílula alterna Enviar ⇄ ■ Parar; com texto e o bot trabalhando, o Parar fica ao lado. */
  function atualizarBotaoDaPilula(): void {
    const pil = pilulaNaTela();
    const bt = pil?.querySelector<HTMLButtonElement>('[data-composer="enviar"]');
    // Revisão 3 (como botoesDoCampo no chat): com o bot trabalhando e algo no campo, o Parar fica ao lado do Enviar. O
    // segundo botão é a ação do chat (`parar-conversa`): só com o composer.
    const segundo = pil?.querySelector<HTMLButtonElement>('[data-composer="parar"]');
    if (segundo) {
      const ver = !!dd?.composer?.parar && trabalhando() && (temConteudo() || bt?.dataset["modo"] === "ditado");
      if (segundo.hidden === ver) segundo.hidden = !ver;
      const rotSeg = `Parar a resposta de ${nome}`;
      if (segundo.getAttribute("aria-label") !== rotSeg) segundo.setAttribute("aria-label", rotSeg);
    }
    if (timerArmar) { clearTimeout(timerArmar); timerArmar = null; }
    // Gravando, o botão é do ditado ("Parar e enviar"); ele devolve o rótulo no fim.
    if (!bt || bt.dataset["modo"] === "ditado") return;
    const agora = Date.now();
    const parar = pararNaPilula(agora);
    // Revisão 1 do #646: pela faixa, o Parar arma ARMAR_PARAR_MS depois do aceito (o Enter + clique não para o pedido).
    // Revisão 4: só enquanto ainda não armou (com texto no campo, o 0 ms virava um laço).
    if (!parar && !dd?.composer?.trabalhando && !temConteudo() && podeParar(faixa) && faixa.tipo === "trabalhando" && agora < faixa.desde + ARMAR_PARAR_MS) {
      timerArmar = setTimeout(() => { timerArmar = null; atualizarBotaoDaPilula(); }, Math.max(0, faixa.desde + ARMAR_PARAR_MS - agora));
    }
    const rot = parar ? `Parar a resposta de ${nome}` : "Enviar ao quadro";
    if (bt.getAttribute("aria-label") !== rot) { bt.setAttribute("aria-label", rot); bt.innerHTML = parar ? ICONE_PARAR_PILULA : ICONE_ENVIAR_PILULA; }
    // Revisão 3 do #646: nada é regravado igual (a atividade chega várias vezes por segundo; ADR-061).
    if (bt.dataset["modo"] !== (parar ? "parar" : "")) bt.dataset["modo"] = parar ? "parar" : "";
    // ADA-4: o Parar é um botão (o clique não submete a pílula vazia); o `qc-parar` leva a pararPedido.
    const tipo = parar ? "button" : "submit";
    if (bt.type !== tipo) bt.type = tipo;
    if (parar && bt.dataset["act"] !== "qc-parar") bt.dataset["act"] = "qc-parar";
    else if (!parar && bt.dataset["act"] !== undefined) delete bt.dataset["act"];
  }

  function desenharFaixa(): void {
    const lugar = doc.getElementById("qc-faixa");
    if (!lugar || !dd) return;
    const bot = agenteId ? dd.agente(agenteId) : null;
    // ADA-6 (revisão B1/B2): o cartão mora fora da região viva e só é regravado quando muda (o frame não perde a rolagem
    // nem o foco de quem está lendo); a linha da faixa, idem.
    const cartao = doc.getElementById("qc-cartao");
    if (cartao) {
      const html = cartaoDaResposta({ faixa, avatarBot: bot?.avatar ?? null, lendo, nomeBot: bot?.nome ?? "" });
      if (desenhado.get(cartao) !== html) {
        // Revisão 2 (M3): a fala nova do mesmo pedido regrava o cartão; quem lia continua com o foco no corpo e na mesma rolagem.
        const corpo = cartao.querySelector<HTMLElement>(".qc-msg-corpo");
        const focado = !!corpo && cartao.contains(doc.activeElement);
        const rolado = corpo?.scrollTop ?? 0;
        desenhado.set(cartao, html);
        cartao.innerHTML = html;
        const novo = cartao.querySelector<HTMLElement>(".qc-msg-corpo");
        if (novo) { novo.scrollTop = rolado; if (focado) novo.focus({ preventScroll: true }); }
      }
    }
    // ADA-7: o histórico aberto (rolável) fica onde a pessoa rolou quando a faixa é regravada.
    // ADA-4: o HTML sai sem o relógio (o tempo do turno é do tique, só no textContent): a faixa igual não regrava.
    const html = String(faixaDoQuadro({ faixa, avatarBot: bot?.avatar ?? null, historico, aberto: histAberto, hora: dd.hora, aviso, lendo, nomeBot: bot?.nome ?? "" }));
    if (faixaGravada.get(lugar) !== html) {
      const rolagem = guardarRolagem(lugar, lugar);
      // ADA-6: o botão focado (o Ler tudo, o Mover) continua focado depois da regravação.
      const foco = doc.activeElement instanceof HTMLElement && lugar.contains(doc.activeElement) ? doc.activeElement.dataset["act"] ?? null : null;
      lugar.innerHTML = html;
      faixaGravada.set(lugar, html);
      restaurarRolagem(lugar, lugar, rolagem);
      if (foco) lugar.querySelector<HTMLElement>(`[data-act="${foco}"]`)?.focus({ preventScroll: true });
    }
    marcarTempo();
    atualizarBotaoDaPilula();
    anunciarFaixa();
    observarFaixa();
    medirFaixa();
    desenharIdeias();
  }

  /** ADA-6 (revisão A4): a altura da faixa muda sem desenho (fonte, largura, a resposta que quebra): mede de novo. */
  function observarFaixa(): void {
    const sobre = doc.getElementById("qc-sobre");
    if (!sobre || sobre === observado || typeof ResizeObserver !== "function") return;
    observador?.disconnect();
    observador = new ResizeObserver(() => medirFaixa());
    observador.observe(sobre);
    observado = sobre;
  }

  /**
   * ADA-6 (critério 2): a faixa e o cartão ficam por cima da pílula (posição absoluta); o fim do conteúdo reserva a altura
   * deles, para o último card não terminar debaixo da caixa. Mede depois de cada desenho e quando o tamanho muda.
   */
  function medirFaixa(): void {
    const v = vista();
    const sobre = doc.getElementById("qc-sobre");
    if (!v || !sobre) return;
    const alto = Math.ceil(sobre.getBoundingClientRect().height);
    const valor = `${alto}px`;
    if (v.style.getPropertyValue("--qc-faixa-alto") !== valor) v.style.setProperty("--qc-faixa-alto", valor);
  }

  /**
   * ADA-6 (critérios 5 e 6): até 3 sugestões do quadro com a pílula vazia (somem ao digitar e enquanto a faixa fala) e o
   * contador só a partir de 3500 caracteres.
   */
  function desenharIdeias(): void {
    const txt = doc.getElementById("qc-txt");
    const ideias = doc.getElementById("qc-ideias");
    const conta = doc.getElementById("qc-conta");
    if (!(txt instanceof HTMLTextAreaElement)) return;
    const n = txt.value.length;
    // ADA-4 (revisão 3 do #646): o frame do turno não pode mexer no DOM fora da faixa; só grava o que mudou.
    if (conta) { const c = contadorDaPilula(n, txt.maxLength > 0 ? txt.maxLength : 4000); if (conta.hidden !== !c) conta.hidden = !c; if (conta.textContent !== (c ?? "")) conta.textContent = c ?? ""; }
    if (!ideias) return;
    const s = !txt.value.trim() && faixa.tipo === "nada" && !histAberto ? sugestoesDoQuadro(q, aberta) : [];
    const html = ideiasDaPilula(s);
    if (ideias.innerHTML !== html) ideias.innerHTML = html;
    if (ideias.hidden !== !s.length) ideias.hidden = !s.length;
  }

  /**
   * Revisão 2 do #646: a região viva só da frase curta. As trocas de ferramenta seguidas ("Usando Linear" → "Rodando um
   * comando" → …) saem no máximo uma a cada ANUNCIO_MS; o resto (fim, falha, resposta) sai na hora.
   */
  function anunciarFaixa(): void {
    if (timerAnuncio) { clearTimeout(timerAnuncio); timerAnuncio = null; }
    const el = doc.getElementById("qc-vivo");
    if (!el) return;
    const frase = anuncioDaFaixa(faixa);
    if (el.textContent === frase) return;
    const espera = faixa.tipo === "trabalhando" ? anunciadoEm + ANUNCIO_MS - Date.now() : 0;
    if (espera > 0) { timerAnuncio = setTimeout(() => { timerAnuncio = null; anunciarFaixa(); }, espera); return; }
    el.textContent = frase;
    anunciadoEm = Date.now();
  }

  /** ADA-4: o tempo do turno ("· 14 s") sem regravar a faixa. */
  function marcarTempo(): void {
    const el = doc.querySelector<HTMLElement>("#qc-faixa .qc-tempo[data-desde]");
    if (!el) return;
    const t = tempoDoTurno(Number(el.dataset["desde"]), Date.now());
    if (el.textContent !== t) el.textContent = t;
  }

  /** A faixa que recolhe sozinha: a resposta e o "Parado por você". O resto (falha, demora, parou no meio) fica. */
  const recolhe = (f: Faixa): boolean => f.tipo === "resposta" || (f.tipo === "parou" && f.porVoce);

  /** ADA-4: os 12 s só correm com a faixa sem o ponteiro em cima e sem o foco dentro; ao sair, recomeçam. */
  function agendarRecolher(): void {
    if (timerRecolher) { clearTimeout(timerRecolher); timerRecolher = null; }
    if (!recolhe(faixa) || lendo || faixaSegura.ponteiro || faixaSegura.foco) return;
    const f = faixa;
    // Com o histórico aberto, fica até a pessoa fechar (passo 9).
    timerRecolher = setTimeout(() => { timerRecolher = null; if (!histAberto && !lendo && faixa === f) trocarFaixa({ tipo: "nada" }); }, dd?.recolherEm ?? 12000);
  }

  /** O pedido da pílula ainda não chegou ao fim (em voo, rodando ou "Não saiu" com o texto só na faixa). */
  // Revisão 13 do #646 (M2): a fala recusada que ficou só na faixa (`erro` com `fala`) também: o recibo vai para o lado.
  const pedidoEmCurso = (f: Faixa): boolean => f.tipo === "enviando" || f.tipo === "trabalhando" || f.tipo === "falhou" || (f.tipo === "erro" && !!f.fala);

  /**
   * O recibo ou o erro de uma ação do quadro (mover, criar, desfazer, regra). Revisão 7 do #646: com um pedido em curso, ele
   * vai para uma linha ao lado (e para o leitor de tela) e a faixa continua seguindo o pedido: o status, o Parar, o
   * "Não saiu" e a resposta não se perdem.
   */
  function mudarFaixa(f: Faixa): void {
    if (pedidoEmCurso(faixa) && (f.tipo === "erro" || (f.tipo === "resposta" && !f.pedidoId))) {
      mostrarAviso(f.texto, f.tipo === "erro", f.tipo === "resposta" ? f.loteId : null);
      return;
    }
    trocarFaixa(f);
  }

  /** A linha de aviso sob o pedido em curso: recolhe sozinha e é dita. */
  function mostrarAviso(texto: string, erro: boolean, loteId: string | null): void {
    aviso = { texto, erro, loteId };
    if (timerAviso) clearTimeout(timerAviso);
    const meu = aviso;
    timerAviso = setTimeout(() => { timerAviso = null; if (aviso === meu) { aviso = null; desenharFaixa(); } }, dd?.recolherEm ?? 12000);
    desenharFaixa();
    anunciar(texto);
  }

  /** A faixa nova (o pedido ou, sem pedido em curso, o recibo). */
  function trocarFaixa(f: Faixa): void {
    // ADA-6: uma faixa nova fecha o cartão da anterior; a fala nova do mesmo pedido (o fecho que troca o "Vou olhar")
    // mantém aberto quem está lendo (revisão A2); o fecho curto não tem cartão (revisão 2, M3).
    const mesmoPedido = f.tipo === "resposta" && faixa.tipo === "resposta" && !!f.pedidoId && f.pedidoId === faixa.pedidoId;
    if (!mesmoPedido || (f.tipo === "resposta" && !respostaLonga(f.completo))) lendo = false;
    faixa = f;
    if (f.tipo === "enviando") turnosDoPedido = new Set();
    if (f.tipo === "trabalhando") for (const t of [f.turnoId, f.origem, f.segue]) if (t) turnosDoPedido.add(t);
    agendarRecolher();
    // ADA-4: o relógio do silêncio, um só por faixa (todo frame do turno traz uma faixa nova e o recomeça).
    armarSilencio(f);
    const comTempo = f.tipo === "trabalhando" && !f.demorando && !f.parando;
    if (comTempo && !timerTempo) timerTempo = setInterval(marcarTempo, 1000);
    if (!comTempo && timerTempo) { clearInterval(timerTempo); timerTempo = null; }
    const form = doc.querySelector<HTMLElement>('#quadro [data-form="conversa-no-quadro"]');
    if (form) { if (f.tipo === "enviando") form.setAttribute("aria-busy", "true"); else form.removeAttribute("aria-busy"); }
    desenharFaixa();
  }

  function armarSilencio(f: Faixa): void {
    if (timerSilencio) { clearTimeout(timerSilencio); timerSilencio = null; }
    const falta = silencioEm(f, Date.now());
    if (falta !== null) {
      timerSilencio = setTimeout(() => {
        timerSilencio = null;
        const antes = faixa;
        despachar({ tipo: "silencio", agora: Date.now() });
        // Revisão 2 do #646: em "Ainda trabalhando…" a tela confere a conversa (o fim pode ter chegado sem frame).
        if (faixa.tipo === "trabalhando" && faixa.demorando) {
          void lerConversa(true);
          if (faixa === antes) armarSilencio(faixa);
        }
      }, falta);
    }
  }

  /** ADA-4: um evento da faixa (envio, frame, silêncio, parar); a faixa que não muda não regrava nem mexe nos relógios. */
  function despachar(ev: EventoDaFaixa): void {
    const nova = proximaFaixa(faixa, ev);
    if (nova === faixa) return;
    // ADR-061: o `turno.delta` (várias vezes por segundo) só empurra o relógio do silêncio; a faixa igual não é redesenhada.
    if (soORelogio(faixa, nova)) { faixa = nova; armarSilencio(nova); return; }
    trocarFaixa(nova);
  }

  /** ADA-6: Ler tudo / Fechar. Aberto, a faixa não recolhe; fechado, volta a contar. O foco fica no corpo ou no Ler tudo. */
  function alternarLeitura(op: { focar?: boolean } = {}): void {
    if (faixa.tipo !== "resposta") return;
    lendo = !lendo;
    histAberto = false;
    if (lendo && timerRecolher) { clearTimeout(timerRecolher); timerRecolher = null; }
    if (!lendo) agendarRecolher();
    desenharFaixa();
    // O clique fora (revisão A1) não puxa o foco de volta: a pessoa foi para outro lugar.
    if (op.focar !== false) doc.querySelector<HTMLElement>(lendo ? "#qc-msg .qc-msg-corpo" : '#qc-faixa [data-act="qc-ler"]')?.focus({ preventScroll: true });
  }

  /** Revisão M5: trocar de página ou de modo fecha o cartão (ele é da página onde a pessoa lia). */
  function fecharLeitura(): void {
    if (!lendo) return;
    lendo = false;
    if (faixa.tipo === "resposta") agendarRecolher();
    desenharFaixa();
  }

  /** Lê o quadro do bot anfitrião; o que mudou desde a leitura anterior acende. Leitura velha (outra conversa) é descartada. */
  /** `gestoDesde` (ADA-7): a leitura que a pessoa não pediu agora espera o gesto para regravar, contando desde então. */
  /** `vivo` (ADA-12): a leitura que a pessoa não pediu (a importação que se relê) leva a rolagem ao alvo e reserva a altura. */
  async function lerQuadro(doFrame = false, gestoDesde: number | null = null, vivo = false): Promise<void> {
    const a = dd?.api();
    if (!a || !agenteId) return;
    const minha = ++leitura;
    const de = agenteId;
    // Revisão 4: a leitura que deve redesenhar (a da recusa, a da resposta) e que um frame atropelou passa o dever à do
    // frame; senão a do frame, com o quadro igual, não redesenhava e o select ficava no status recusado.
    if (!doFrame) desenhoDevido = true;
    if (carga === "nada") { carga = "carregando"; desenharVista(); }
    try {
      await prepararSeletor(a, de);
      if (minha !== leitura || de !== agenteId) return;
      const r = await a.quadro(de);
      if (minha !== leitura || de !== agenteId) return;
      aplicarQuadro(r.quadro, [], doFrame, gestoDesde, vivo);
    } catch {
      if (minha !== leitura || de !== agenteId) return;
      if (carga !== "ok") { carga = "erro"; desenharVista(); }
    }
  }

  function aplicarQuadro(novo: QuadroDto | null, extra: readonly string[] = [], doFrame = false, gestoDesde: number | null = null, vivo = false): void {
    if (novo) novo = comColunas(novo);
    // NOD-445: Tarefas acende o laranja na pílula quando alguma tarefa espera a pessoa (ADR-162: o bot perguntou).
    const pedem = !!novo?.tarefas.some((t) => t.esperaPessoa);
    if (pedem !== tarefasPedem) { tarefasPedem = pedem; o.aoTarefasPedirem?.(pedem); }
    const novas = acesos(q, novo, [...dica, ...extra]);
    // Uma releitura sem mudança (a do frame e a da resposta chegam juntas) não apaga o brilho que a anterior acendeu.
    if (novas.size || !q || !novo || q.id !== novo.id) acesas = novas;
    // ADA-7: a releitura de um frame que traz o mesmo quadro não regrava a tela (a regravação sem mudança interrompia o
    // toque e o embalo da rolagem). Só a de frame: a releitura depois de uma recusa ou de uma resposta redesenha sempre,
    // para fechar o menu e devolver o select ao valor real mesmo com o quadro igual.
    const igual = doFrame && carga === "ok" && Math.floor(Date.now() / 60_000) === minutoDesenhado && !desenhoDevido && !novas.size && !pendente && !!novo && !!q && JSON.stringify(q) === JSON.stringify(novo);
    dica = [];
    q = novo;
    carga = "ok";
    // 2026-11-10 (card preso em "começando"): a resposta de uma mudança traz o quadro do commit, com o turno que acabou
    // de nascer ainda pendente ("na fila"). O despacho vem logo depois e o frame dele relê o quadro, mas, quando a resposta
    // HTTP chega DEPOIS dessa releitura, ela regrava o quadro velho e o card fica em "começando" até o próximo frame. Uma
    // releitura a mais, só quando há card na fila, fecha a corrida.
    if (releComecando(novo, doFrame)) pedirReleitura();
    trilharAbertura();
    if (aberta && !tarefaNoQuadro(q, aberta)) { aberta = null; dd?.naUrl?.(null); }
    if (trilhaPendente && aberta === trilhaPendente) trilhar(trilhaPendente, "link");
    // NOD-416: o link `?tarefa=` esperava este quadro.
    let linkSemTarefa = false;
    let avisoSemTarefa: string | null = null;
    if (pendente && pendente.agenteId === agenteId) {
      const id = pendente.tarefaId;
      pendente = null;
      const aviso = avisoDoMover;
      avisoDoMover = null;
      if (tarefaNoQuadro(q, id)) {
        abrirTarefa(id);
        if (aviso) { mudarFaixa({ tipo: "resposta", texto: aviso, loteId: null, mensagemId: "" }); anunciar(aviso); }
        return;
      }
      linkSemTarefa = true;
      avisoSemTarefa = aviso;
    }
    if (aberta && novas.has(aberta)) void lerHistorico();
    // NOD-422: enquanto traz do Linear, a linha "Trazendo · N de M" se relê sozinha (o progresso não vira frame).
    if (timerImportacao) { clearTimeout(timerImportacao); timerImportacao = null; }
    if (q?.importacao?.estado === "trazendo") timerImportacao = setTimeout(() => { timerImportacao = null; void lerQuadro(false, null, true); }, dd?.releImportacaoEm ?? 2000);
    // NOD-443: o mural aberto acompanha o quadro (cada pedido de qualquer pessoa entra nele).
    if (painel === "atividade" && novas.size) void lerMural();
    // Revisão 11 (M2): o lote do pedido aparece no meio do turno: o card pulsa já (depois do desenho), não só no fim.
    setTimeout(pulsarDoPedido, 0);
    if (igual) return;
    // ADA-7 (revisão 6): a resposta do frame que chega com o gesto em curso (o dedo começou com o GET no ar) espera
    // como o pedido esperou; o link que não achou a tarefa (abaixo) é da pessoa e desenha já.
    // Revisão 10: a espera segue contando de quando a releitura foi pedida (o adiamento do GET e o do desenho não somam).
    if ((doFrame || gestoDesde !== null) && !linkSemTarefa) { redesenharQuandoLivre(gestoDesde ?? undefined); return; }
    // ADA-12 (revisão 2): a releitura depois de uma ação da pessoa (mover, status, edição, a resposta da ação) é dela, não
    // ao vivo: sem alvo nem reserva. Ao vivo só o frame (por redesenharQuandoLivre) e a importação que se relê.
    aoVivo = vivo && !linkSemTarefa;
    desenharVista();
    // Revisão 7 do PR #623: a tarefa do link saiu deste quadro entre a busca do código e a leitura (mudou, foi apagada).
    // O quadro abre e o leitor de tela ouve por que a tarefa não abriu, em vez de silêncio.
    // Revisão 8 do PR #623: se foi um mover que trouxe a pessoa até aqui (e a tarefa já saiu de novo, numa corrida), o
    // aviso do mover também é dito e fica na faixa: ela sabe que o mover deu certo e por que a tarefa não abriu.
    if (avisoSemTarefa) mudarFaixa({ tipo: "resposta", texto: avisoSemTarefa, loteId: null, mensagemId: "" });
    if (linkSemTarefa) anunciar(avisoSemTarefa ? `${avisoSemTarefa}. Tarefa não encontrada neste quadro.` : "Tarefa não encontrada neste quadro.");
  }

  /** NOD-422: abre ou fecha o painel "Trazer do Linear…"; o foco vai para o campo do time (ou volta ao botão). */
  function painelImportacao(p: PainelImportacao | null): void {
    importando = p;
    desenharVista();
    const alvo = vista()?.querySelector<HTMLElement>(p ? (p.fase === "previa" ? '[data-act="importar-confirmar"]' : "#ci-time-in") : '[data-act="trazer-linear"], .qm-cab-bt, .qd-cel-mais');
    alvo?.focus();
  }

  const RECUSA_DO_CODIGO: Record<string, PainelImportacao["erro"]> = {
    integracao_nao_configurada: "sem_conector", conector_indisponivel: "linear_indisponivel", nao_permitido: "importacao_indisponivel", estado_invalido: "importacao_em_andamento", entrada_invalida: "entrada_invalida",
  };

  async function lerPreviaImportacao(time: string, filtro: FiltroImportacao | null): Promise<void> {
    const a = dd?.api();
    if (!a?.previaImportacao || !agenteId) return;
    const c = chave;
    const de = agenteId;
    painelImportacao({ fase: "lendo", time, filtro });
    try {
      const r = await a.previaImportacao(de, time, filtro);
      if (c !== chave || de !== agenteId || !importando) return;
      if (r.ok) painelImportacao({ fase: "previa", time: r.time, filtro: r.filtro, previa: r.previa, anfitriaoNome: r.anfitriaoNome });
      else {
        const erro = ehRecusaDoPainel(r.erro) ? r.erro : undefined;
        painelImportacao({ fase: "recusa", time, filtro, ...(erro ? { erro } : {}), detalhe: r.detalhe });
      }
    } catch (e) {
      if (c !== chave || !importando) return;
      painelImportacao({ fase: "recusa", time, filtro, erro: RECUSA_DO_CODIGO[(e as { codigo?: string }).codigo ?? ""] ?? "rede" });
    }
  }

  async function confirmarImportacao(): Promise<void> {
    const a = dd?.api();
    const p = importando;
    if (!a?.importarTimeLinear || !agenteId || p?.fase !== "previa") return;
    const c = chave;
    const de = agenteId;
    painelImportacao({ ...p, fase: "enviando" });
    try {
      await a.importarTimeLinear(de, p.time, p.filtro);
      if (c !== chave || de !== agenteId) return;
      importando = null;
      mudarFaixa({ tipo: "resposta", texto: `Trazendo do Linear (${p.time}). O quadro só muda no fim, num lote com Desfazer.`, loteId: null, mensagemId: "" });
      await lerQuadro();
    } catch (e) {
      if (c !== chave) return;
      painelImportacao({ ...p, fase: "recusa", erro: RECUSA_DO_CODIGO[(e as { codigo?: string }).codigo ?? ""] ?? "rede" });
    }
  }

  /** NOD-416: o histórico da tarefa aberta (relido quando ela muda). Leitura velha (outra tarefa) é descartada. */
  async function lerHistorico(): Promise<void> {
    const a = dd?.api();
    if (!a?.historicoTarefa || !agenteId || !aberta) return;
    const minha = ++leituraHist;
    const de = agenteId;
    const id = aberta;
    try {
      const r = await a.historicoTarefa(de, id);
      if (minha !== leituraHist || de !== agenteId || id !== aberta) return;
      // ADA-7 (revisão 4): o mesmo histórico não regrava a tarefa aberta.
      if (histTarefa && JSON.stringify(histTarefa) === JSON.stringify(r.historico)) return;
      histTarefa = r.historico;
    } catch {
      if (minha !== leituraHist) return;
      histTarefa = [];
    }
    redesenharQuandoLivre();
  }

  /** Os quadros da pessoa, uma vez por conversa (o "Mover para…" só aparece com outro quadro). */
  async function lerQuadros(): Promise<void> {
    const a = dd?.api();
    if (!a?.quadros || quadros) return;
    const c = chave;
    try {
      const r = await a.quadros();
      if (c !== chave) return;
      quadros = r.quadros;
      if (aberta) redesenharQuandoLivre();
    } catch { /* sem a lista, o campo não aparece */ }
  }

  /** NOD-416: uma mudança na tarefa (criar, status, responsável): o lote volta com Desfazer, na faixa. */
  async function mudarTarefa(fazer: (a: ApiDoQuadro, de: string) => Promise<MutacaoQuadro> | undefined, recibo: string | ((r: MutacaoQuadro) => string), acoes?: (r: MutacaoQuadro) => AcoesDoRecibo | undefined): Promise<boolean> {
    const a = dd?.api();
    // Revisão 5 do PR #623: a mudança descartada (outra no ar) redesenha a tarefa, para o select não mostrar o que não valeu.
    if (!a || !agenteId || mexendo) { desenharVista(); return false; }
    const c = chave;
    const de = agenteId;
    mexendo = true;
    // ADA-12 (revisão 4): o frame da própria ação pode chegar antes da resposta; a janela do eco começa já.
    daPessoaAte = Date.now() + ECO_DA_PESSOA_MS;
    try {
      const p = fazer(a, de);
      // ADA-12 (revisão 5): a ação que não sai, ou que falha, não deixa a janela do eco aberta.
      if (!p) { daPessoaAte = 0; desenharVista(); return false; }
      const r = await p;
      if (c !== chave || de !== agenteId) return false;
      // ADA-12 (QA, bug 1): os comentários e o trabalho que a ação faz reler chegam logo depois; são eco dela, não ao vivo.
      daPessoaAte = Date.now() + ECO_DA_PESSOA_MS;
      aplicarQuadro(r.quadro);
      const comAcoes = acoes?.(r);
      mudarFaixa({ tipo: "resposta", texto: typeof recibo === "string" ? recibo : recibo(r), loteId: r.lote && !r.lote.desfeitoEm ? r.lote.id : null, mensagemId: "", ...(comAcoes ? { acoes: comAcoes } : {}) });
      return true;
    } catch (e) {
      daPessoaAte = 0;
      if (c !== chave) return false;
      const semRede = e instanceof ErroApi && (e.codigo === "servidor_indisponivel" || e.codigo === "sem_internet");
      mudarFaixa({ tipo: "erro", texto: semRede ? "Sem conexão com o servidor agora. Tente de novo em instantes." : "Não deu para mudar a tarefa: o quadro mudou. Relendo." });
      if (!semRede) void lerQuadro();
      else desenharVista();
      return false;
    } finally {
      mexendo = false;
    }
  }

  /**
   * Revisão do PR #623: o ponto ÚNICO por onde o Status e o Responsável da tarefa aberta mudam. Pôr A fazer, ou escolher
   * um responsável numa tarefa em A fazer, faz o bot começar: aí o recibo diz "<Agente> começou", com o Desfazer do lote
   * (que para o turno). Nos outros casos, o recibo de sempre. Definido em 2026-11-10 (o handoff do Multica): o Status numa
   * coluna com responsável que aciona muda e aciona na hora, sem "Confirmar · Não iniciar ainda"; o Desfazer é a rede.
   */
  function mudarNaTarefaAberta(t: TarefaDto, campos: { status: string } | { agente: string | null }): void {
    const ehStatus = "status" in campos;
    const col = ehStatus ? colunaDe(campos.status) : undefined;
    const recibo = ehStatus
      ? (col?.responsavel ? reciboDeMover(t.titulo, col) : `${t.titulo}: ${col?.nome ?? campos.status}`)
      : `${t.titulo}: com ${campos.agente ? (dd?.agente(campos.agente)?.nome ?? "outro bot") : "ninguém"}`;
    const comecou = (r: MutacaoQuadro): string => {
      const nomes = [...new Set((r.comecaram ?? []).map((c) => c.agenteNome))];
      return nomes.length ? `${nomes.join(" e ")} ${nomes.length === 1 ? "começou" : "começaram"}` : recibo;
    };
    const foco = ehStatus ? "qd-t-status" : "qd-t-resp";
    const envio = campos;
    // ADA-17: no celular o chip troca na hora (otimista); se não salvar, diz para onde voltou e oferece Tentar de novo.
    const cel = ehCelular();
    let minha: TrocaCel | null = null;
    if (cel) {
      // Revisão do PR #699: com outra mudança no ar esta não sai (mudarTarefa a descarta); não pode apagar o chip otimista
      // da que está no ar nem dizer "Não salvou".
      if (mexendo) { desenharVista(); return; }
      minha = { tarefa: t.id, seq: ++seqCel, ...(ehStatus ? { status: campos.status } : { agente: campos.agente }) };
      otimistaCel = minha;
      naoSalvouCel = null;
      desenharVista();
    }
    void mudarTarefa((a, de) => a.mudarTarefa?.(de, t.id, envio), comecou).then((ok) => {
      if (minha) {
        const fim = fimDaTrocaCel({ otimista: otimistaCel, naoSalvou: naoSalvouCel }, minha, ok, () => ({
          tarefa: t.id, qual: ehStatus ? "status" : "resp", refazer: () => { const atual = tarefaNoQuadro(q, t.id); if (atual) mudarNaTarefaAberta(atual, campos); },
        }));
        const mudou = fim.otimista !== otimistaCel || fim.naoSalvou !== naoSalvouCel;
        otimistaCel = fim.otimista; naoSalvouCel = fim.naoSalvou;
        if (mudou) desenharVista();
      }
      if (ok) focarSemRolar(doc.getElementById(foco));
    });
  }

  /** ADA-17: a folha de um chip da tarefa aberta no celular (Status, Responsável, Branch, Ajustes, Mover). */
  function abrirFolhaDaTarefa(qual: string, tarefaId: string, voltarPara?: string): void {
    const t = tarefaNoQuadro(q, tarefaId);
    if (!t || !q || !dd) return;
    const cs = comColunas(q).colunas;
    const bots = dd.agentes?.();
    const destinos = quadros && dd.api()?.moverTarefa ? destinosDaTarefa(quadros, q.id) : [];
    const volta = voltarPara ?? `#qd-t-${qual}`;
    const nomeResp = t.agenteId ? (dd.agente(t.agenteId)?.nome ?? t.agenteNome ?? "Outro bot") : "Ninguém";
    const conteudo: { titulo: string; corpo: string } | null =
      qual === "status" ? { titulo: "Status", corpo: folhaDeStatus(t, cs) }
      : qual === "resp" ? (bots ? { titulo: "Responsável", corpo: folhaDoResponsavel(t, bots) } : null)
      : qual === "branch" ? (t.branch ? { titulo: "Branch", corpo: folhaDoBranch(t.branch) } : null)
      : qual === "mover" ? (destinos.length ? { titulo: "Mover para…", corpo: folhaDeMover(destinos) } : null)
      : qual === "ajustes" ? { titulo: "Ajustes", corpo: folhaDeAjustes({ t, q, nomeStatus: colunaDe(t.status)?.nome ?? t.status, nomeResp, podeResp: !!bots, podeMover: destinos.length > 0 }) }
      : null;
    if (!conteudo) return;
    const f = abrirFolha(doc, { id: "qd-folha-tarefa", titulo: conteudo.titulo, corpo: conteudo.corpo, voltarPara: volta, aoClicar: (el, fo) => acaoNaFolha(el, fo, t.id, qual) });
    if (qual === "resp") {
      f.el.addEventListener("input", (ev) => {
        const busca = ev.target instanceof HTMLInputElement && ev.target.hasAttribute("data-folha-busca") ? ev.target.value : null;
        if (busca === null) return;
        for (const b of f.el.querySelectorAll<HTMLElement>("[data-busca]")) b.closest("li")!.hidden = !casaNaBusca(b.dataset["busca"] ?? "", busca);
      });
    }
  }

  function acaoNaFolha(el: HTMLElement, f: FolhaAberta, tarefaId: string, qual: string): void {
    const t = tarefaNoQuadro(q, tarefaId);
    if (!t || !q) { f.fechar(false); return; }
    const acao = el.dataset["folhaAcao"] ?? "";
    const valor = el.dataset["valor"] ?? "";
    if (acao === "status") {
      if (valor === t.status) { f.fechar(); return; }
      if (valor === "cancelado") { f.trocarCorpo(folhaDeCancelar(t.titulo)); return; }
      f.fechar();
      mudarNaTarefaAberta(t, { status: valor });
      return;
    }
    if (acao === "status-voltar") { f.trocarCorpo(folhaDeStatus(t, comColunas(q).colunas)); return; }
    if (acao === "cancelar-ok") { f.fechar(); mudarNaTarefaAberta(t, { status: "cancelado" }); return; }
    if (acao === "agente") {
      const novo = valor || null;
      f.fechar();
      if (novo !== t.agenteId) mudarNaTarefaAberta(t, { agente: novo });
      return;
    }
    if (acao === "copiar") { copiarNaFolha(el, valor, "Branch copiado"); return; }
    if (acao === "mover") { f.fechar(false); void moverDeQuadro(t.id, valor); return; }
    if (acao.startsWith("abrir-")) { abrirFolhaDaTarefa(acao.slice(6), t.id, qual === "ajustes" ? "#qd-t-ajustes" : undefined); return; }
  }

  function copiarNaFolha(el: HTMLElement, texto: string, anuncio: string): void {
    const cb = doc.defaultView?.navigator?.clipboard;
    const ok = (): void => { el.textContent = "Copiado"; anunciar(anuncio); };
    const falhou = (): void => { el.textContent = "Não copiou"; };
    if (!cb) { falhou(); return; }
    cb.writeText(texto).then(ok, falhou);
  }

  /**
   * 0159: labels e prazo da tarefa aberta, pelo mesmo quadro.mudar_tarefa da conversa (um lote com Desfazer). O foco volta
   * ao campo de onde veio (o id é o mesmo depois do redesenho).
   */
  function mudarLabelOuPrazo(tarefaId: string, campos: CamposDeLabel, recibo: string, foco: string | null): void {
    const t = tarefaNoQuadro(q, tarefaId);
    if (!t) return;
    void mudarTarefa((a, de) => a.mudarTarefa?.(de, t.id, campos), `${t.titulo}: ${recibo}`).then((ok) => { if (ok && foco) focarSemRolar(doc.getElementById(foco)); });
  }

  /** ADA-17: responder a um comentário (o link do card ou o toque longo): o composer diz a quem e a citação vai no texto (S2). */
  function responderA(comId: string): void {
    const cd = aberta ? coms.dados(aberta) : undefined;
    const c = cd?.lista.find((x) => x.id === comId);
    if (!c || !aberta || !dd) return;
    respondendo = { tarefa: aberta, comentario: c.id, nome: autorDoComentario(c, dd.agente).nome.replace(/ · no Linear$/, ""), trecho: trechoDe(c.texto), raiz: c.paiId ?? c.id };
    desenharVista();
    focarSemRolar(doc.getElementById(`qd-com-${aberta}`));
  }

  /** ADA-17: o toque longo (500 ms, sem arrastar) num comentário abre Responder · Copiar texto. É atalho: o Responder também está no card. */
  function folhaDoComentarioCel(comId: string): void {
    const cd = aberta ? coms.dados(aberta) : undefined;
    const c = cd?.lista.find((x) => x.id === comId);
    if (!c) return;
    abrirFolha(doc, { id: "qd-folha-comentario", titulo: "Comentário", corpo: folhaDoComentario(), voltarPara: `#c-${CSS.escape(comId)} .qd-com-resp`, aoClicar: (el, f) => {
      if (el.dataset["folhaAcao"] === "responder") { f.fechar(false); responderA(comId); return; }
      if (el.dataset["folhaAcao"] === "copiar-com") copiarNaFolha(el, c.texto, "Texto copiado");
    } });
  }

  /**
   * Status e Responsável (revisão do PR #623, WCAG 3.2.2): o que o teclado escolhe fica pendente e só vale no Enter ou ao
   * sair do campo; a escolha com o mouse (o popup do select) vale na hora.
   */
  function aplicarCampoDaTarefa(el: HTMLSelectElement): void {
    delete el.dataset["teclado"];
    const t = tarefaNoQuadro(q, el.dataset["id"] ?? "");
    if (!t) return;
    if (el.dataset["campo"] === "status") {
      if (el.value !== t.status) mudarNaTarefaAberta(t, { status: el.value });
    } else {
      const novo = el.value || null;
      if (novo !== t.agenteId) mudarNaTarefaAberta(t, { agente: novo });
    }
  }
  const ehCampoDaTarefa = (el: unknown): el is HTMLSelectElement =>
    el instanceof HTMLSelectElement && !!el.closest("#quadro .qd-conteudo") && (el.dataset["campo"] === "status" || el.dataset["campo"] === "agente");

  /**
   * NOD-416: a tarefa vai para o quadro de outro bot. Não tem lote nem Desfazer e ninguém começa. A pessoa escolhe o
   * quadro e confirma no botão Mover (revisão do PR #623). Este quadro é relido (a tarefa sai dele) e a faixa diz o
   * código novo.
   */
  async function moverDeQuadro(tarefaId: string, destino: string): Promise<void> {
    const a = dd?.api();
    const t = tarefaNoQuadro(q, tarefaId);
    const alvo = quadros?.find((x) => x.id === destino);
    if (!a?.moverTarefa || !agenteId || !t || !alvo || mexendo) return;
    const c = chave;
    const de = agenteId;
    mexendo = true;
    try {
      const r = await a.moverTarefa(de, tarefaId, destino);
      if (c !== chave || de !== agenteId) return;
      aberta = null;
      dd?.naUrl?.(null);
      const texto = `${t.titulo} foi para o quadro de ${alvo.agenteNome}${r.movida ? ` como ${r.movida.codigo} (${r.movida.codigoAntigo} continua abrindo)` : ""}`;
      // QA do PR #623 (D4): a pessoa vai junto com a tarefa, aberta no quadro destino; o aviso é dito lá.
      avisoDoMover = texto;
      if (dd?.irParaTarefa?.(alvo.agenteId, tarefaId, alvo.id)) return;
      avisoDoMover = null;
      mudarFaixa({ tipo: "resposta", texto, loteId: null, mensagemId: "" });
      await lerQuadro();
      if (c !== chave || de !== agenteId || aberta) return;
      // Revisão 5 do PR #623 (a11y): o select que tinha o foco sumiu com a tarefa. O foco vai para o quadro (o primeiro
      // card à vista, ou o quadro inteiro, vazio) e o leitor de tela ouve para onde ela foi.
      focarNoQuadro();
      anunciar(texto);
    } catch (e) {
      if (c !== chave) return;
      // Revisão 2 do PR #623: no 4xx, o porquê do servidor (o motivo da lista branca ou a frase dele), não um genérico.
      const f = fraseDoErroDoMover(e instanceof ErroApi ? e : null);
      mudarFaixa({ tipo: "erro", texto: f.texto });
      if (f.reler) void lerQuadro();
    } finally {
      mexendo = false;
    }
  }

  /**
   * ADA-7: a releitura pedida por um frame espera o gesto acabar (o dedo na tela ou a rolagem de agora há pouco): a
   * regravação recria a grade e mataria o arrasto entre colunas e o embalo. Adia no máximo ADIAR_ATE_MS.
   */
  function pedirReleitura(): void {
    if (timerReler) return;
    if (!releituraDesde) releituraDesde = Date.now();
    timerReler = setTimeout(() => {
      timerReler = null;
      if (segura(releituraDesde)) { pedirReleitura(); return; }
      const desde = releituraDesde;
      releituraDesde = 0;
      void lerQuadro(true, desde);
    }, dd?.juntarEm ?? 250);
  }
  /**
   * Revisão 3 e 4: o que chega de uma leitura sem a pessoa pedir agora (os comentários, o trabalho e o histórico da
   * tarefa aberta, a lista de quadros, a Atividade) espera o gesto como o quadro. Quem chama decide se há o que desenhar.
   */
  function redesenharQuandoLivre(desde?: number): void {
    if (timerDetalhe) return;
    if (!detalheDesde) detalheDesde = desde ?? Date.now();
    if (!segura(detalheDesde)) { detalheDesde = 0; aoVivo = Date.now() >= daPessoaAte; desenharVista(); return; }
    timerDetalhe = setTimeout(() => { timerDetalhe = null; redesenharQuandoLivre(); }, GESTO_MS);
  }
  /** O gesto segura a regravação até ADIAR_ATE_MS; o arrasto de card ou de coluna e o dedo que segue mexendo, até soltar
   * (revisão 3: a grade recriada no meio do arrasto mandava o dragend a um nó fora do documento e o card ficava preso;
   * revisão 5: a `.qd-grade` recriada aos 3 s cortava a rolagem horizontal com o dedo ainda na tela). */
  const arrastando = (): boolean => !!cardArrastado || !!arrasto?.ativo;
  const seguraGesto = (desde: number): boolean => Date.now() - desde < (arrastando() || gesto.dedoMexendo() ? ARRASTO_ATE_MS : gestoAtivo() ? ADIAR_ATE_MS : 0);
  // Revisão 10: só o que o desenho recria (a .qd-conteudo); a pílula do rodapé fica no lugar e não segura nada.
  const segura = (desde: number): boolean => seguraGesto(desde) || campoComFocoNoToque(doc, vista()?.querySelector(":scope > .qd-conteudo"));
  const naVista = (ev: Event): boolean => { const v = vista(); return !!v && ev.target instanceof Node && v.contains(ev.target); };
  const gesto = criarGestoNaTela(doc, naVista);
  const gestoAtivo = (): boolean => gesto.ativo();
  rol = criarAlvosDeRolagem(doc, { caixa: () => vista(), conteudo: () => vista()?.querySelector<HTMLElement>(":scope > .qd-conteudo") ?? null, segura: () => gesto.ativo(), esperaMs: GESTO_MS, aoRolarDaPessoa: () => reserva.aoRolarDaPessoa() });
  // ADA-12 (revisão 5): abrir ou fechar o histórico de movimentos (o clique no summary; o teclado também vira clique) é
  // gesto da pessoa: o corte que ele causa não é do navegador (a vista não volta ao lugar de antes) e a reserva de altura
  // sai. Não o toggle: o desenho que reabre o histórico também o dispara. Só ele (revisão 6): os outros details da vista
  // (o card de importação) não apagam o alvo da grade.
  doc.addEventListener("click", (ev) => { if (!naVista(ev) || !(ev.target instanceof Element) || !ev.target.closest("details.qd-hist > summary")) return; rol?.esquecer(); reserva.soltar(); }, true);

  /** Relê a conversa do anfitrião: o histórico da faixa e, se há um pedido esperando, a resposta dele. */
  async function lerConversa(conferir = false): Promise<void> {
    const a = dd?.api();
    if (!a || !chave || !agenteId) return;
    const minha = ++leituraConversa;
    const c = chave;
    const de = agenteId;
    try {
      const r = await a.conversa(c);
      if (minha !== leituraConversa || c !== chave) return;
      historico = historicoDaFaixa(r.mensagens, de);
      // Segue o pedido até o fim do turno: uma fala nova do bot depois da primeira troca o texto e o Desfazer (codex rodada 5).
      const pedidoId = pedidoSeguido(faixa);
      if (pedidoId) {
        const resp = respostaDoBot(r.mensagens, de, pedidoId, turnosDoPedido);
        // Revisão 2 do #646: com o turno rodando, a fala do meio não encerra a faixa (vira o status); só o fim do turno.
        // Revisão 5 do #646: só os turnos deste pedido contam (a frente ou outro pedido vivo na conversa não seguram a faixa).
        const vivos = vivosDoPedido(faixa, pedidoId, r.turnosEmCurso, r.turnosPendentes);
        const ev: EventoDaFaixa = { tipo: "conversa", resposta: resp, vivos, conferir, agora: Date.now() };
        const prox = proximaFaixa(faixa, ev);
        const responde = resp && (faixa.tipo === "resposta" ? faixa.mensagemId !== resp.id : prox.tipo === "resposta" && prox.mensagemId === resp.id);
        if (!responde && prox !== faixa) { despachar(ev); return; }
        if (resp && responde) {
          // A resposta chega depois do lote: relê o quadro antes, para o Desfazer apontar o lote deste pedido. Revisão 10:
          // quem traz a resposta é um frame (a pessoa pode estar rolando enquanto espera): o desenho espera o gesto.
          await lerQuadro(false, Date.now());
          // Revisão 5 do #646: um pedido novo saiu durante a leitura: a resposta do anterior não pisa no "Enviando…" dele.
          // Revisão 8 (M1): nem uma leitura da conversa mais nova (a resposta dela é a que vale).
          if (minha !== leituraConversa || c !== chave || pedidoSeguido(faixa) !== pedidoId) return;
          const lote = q?.ultimoLote ?? null;
          // Só o lote que o anfitrião gravou depois do pedido: o de outro bot ou de outro aparelho não ganha o Desfazer
          // aqui (revisão do PR #612; o servidor ainda recusa o que não for o último).
          const doAnfitriao = lote?.autor.tipo === "agente" && lote.autor.agenteId === de;
          const loteId = lote && doAnfitriao && lote.id !== loteAntes && !lote.desfeitoEm ? lote.id : null;
          trocarFaixa({ tipo: "resposta", texto: resp.texto, completo: resp.completo, loteId, mensagemId: resp.id, pedidoId });
          if (loteId && lote && lotePulsado !== loteId) { lotePulsado = loteId; pulsarCard(lote.tarefaIds); }
          return;
        }
      }
      // ADA-4: o turno acabou bem e o bot não falou nada: a faixa não fica girando ("Feito.", com o Desfazer do lote).
      if (faixa.tipo === "trabalhando" && faixa.encerrado) {
        const f = faixa;
        await lerQuadro(false, Date.now());
        if (minha !== leituraConversa || c !== chave || faixa !== f) return;
        const lote = q?.ultimoLote ?? null;
        const loteId = lote && lote.autor.tipo === "agente" && lote.autor.agenteId === de && lote.id !== loteAntes && !lote.desfeitoEm ? lote.id : null;
        trocarFaixa({ tipo: "resposta", texto: "Feito.", loteId, mensagemId: "", ...(f.pedidoId ? { pedidoId: f.pedidoId } : {}) });
        if (loteId && lote && lotePulsado !== loteId) { lotePulsado = loteId; pulsarCard(lote.tarefaIds); }
        return;
      }
      desenharFaixa();
    } catch {
      /* A faixa fica como está; o próximo frame tenta de novo. */
    }
  }

  /**
   * ADA-4: o envio pela pílula é otimista. O campo esvazia e a fala sobe na faixa antes do POST (síncrono); o 2º Enter
   * (ou Enter + clique) com o envio em voo não manda nada (`envios.iniciar` → null). Na falha, o texto volta ao campo
   * (se ele ainda estiver vazio) e a faixa oferece "Tentar de novo" com a MESMA chave (o servidor deduplica).
   * ADA-5: o ditado, os anexos da fila e os comandos "/" do composer do chat entram aqui.
   */
  function enviarPedido(form: HTMLFormElement): void {
    const a = dd?.api();
    const txt = form.querySelector<HTMLTextAreaElement>("#qc-txt");
    if (!a || !chave || !txt) return;
    // Revisão 2 do ADA-5: com um comando "/" da pílula em voo nesta conversa, o segundo é ignorado.
    if (enviandoEm.has(chave)) return;
    const cp = dd?.composer;
    // ADR-095: com o ditado gravando, o Enviar (e o Enter) param a gravação e enviam o texto direto.
    if (cp?.ditado?.ativo()) { cp.ditado.concluirEnviando(); return; }
    const bruto = txt.value.trim();
    // ADA-5: os anexos da fila (a mesma do chat); com um arquivo subindo, o Enviar não manda nada, como no chat.
    const ids = cp?.anexos ? cp.anexos.prontos(chave) : [];
    if (ids === null) return;
    if (!bruto && ids.length === 0) {
      if (pararNaPilula()) void pararPedido();
      return;
    }
    const c = chave;
    // ADA-5 (revisão 1): "/nova-sessao" e "/modelo" rodam na hora, como no chat (a lista "/" promete isso).
    const ehComando = bruto.startsWith("/") && !!comandoNoTexto(cp?.barra?.contexto().dto ?? null, bruto);
    if (ids.length === 0 && ehComando && cp?.comando) {
      // Revisão 3 do ADA-5: a trava entra antes do primeiro await (o comando "/" não roda duas vezes).
      enviandoEm.add(c);
      void (async () => {
        let rodou = false;
        try { rodou = await cp.comando!(bruto, c); } finally { enviandoEm.delete(c); }
        if (!rodou) { if (c === chave) pedir(c, txt, bruto, ids, ehComando); return; }
        if (cp.rascunhos?.ler(chaveDoRascunho(c, null)).trim() === bruto) cp.rascunhos.guardar(chaveDoRascunho(c, null), "");
        // Revisão 6: o campo da tela agora (A→B→A recria a pílula), como no envio comum.
        const agora = c === chave ? pilulaNaTela()?.querySelector<HTMLTextAreaElement>("#qc-txt") ?? txt : null;
        if (agora && agora.value.trim() === bruto) { agora.value = ""; composer?.atualizar(agora); }
      })();
      return;
    }
    pedir(c, txt, bruto, ids, ehComando);
  }

  /** O pedido otimista da pílula (a fala, os anexos prontos): a trava, a chave e o campo que esvazia na hora. */
  function pedir(c: string, txt: HTMLTextAreaElement, bruto: string, ids: readonly string[], ehComando: boolean): void {
    const t = tarefaNoQuadro(q, aberta);
    // Com uma tarefa aberta o recado vai sobre ela: só o id, que o bot lê pelo gerir_quadro. O título e o id do Linear
    // podem ter vindo de fora e não entram na fala confiável da pessoa (revisão do PR #612). Um comando "/" do CLI vai
    // cru: com o prefixo, o "/" deixaria de estar no começo e o CLI não o rodaria (ADA-5, revisão 1).
    const texto = t && !ehComando ? `Sobre a tarefa ${t.id} do quadro: ${bruto}` : bruto;
    // Revisão 14 do #646 (M1): reenviar pelo Enter com a chave da fala que falhou é repetir o pedido, como o Tentar.
    const reuso = ids.length === 0 ? chaveQueFalhou(c, texto) : undefined;
    const idEnvio = envios.iniciar(c, texto, ids, undefined, reuso ?? novaChave());
    // Revisão 8 (M3): com o envio anterior em voo, o Enter não manda nada, mas diz por quê (não parece quebrado).
    if (idEnvio === null) {
      const espera = "Aguarde: o envio anterior ainda não voltou.";
      if (pedidoEmCurso(faixa)) mostrarAviso(espera, false, null);
      // Revisão 9 (B1): sem pedido na faixa (a pessoa voltou à conversa com o POST em voo), o aviso é um recibo que recolhe.
      else { trocarFaixa({ tipo: "resposta", texto: espera, loteId: null, mensagemId: "" }); anunciar(espera); }
      return;
    }
    // Revisão 4 do ADA-5: o segundo clique de um clique duplo em Enviar não vira Parar do turno que acabou de começar.
    enviouEm.set(c, Date.now());
    // Revisão 5 do #646: o envio novo tira a fala que não saiu da faixa: ela volta ao campo, não some. Revisão 6: só a
    // que ficou só na faixa; a que já voltou ao campo é o que a pessoa editou (repor a antiga duplicaria o pedido).
    const soNaFaixa = faixa.tipo === "falhou" && !falhaNoCampo ? faixa.fala : faixa.tipo === "erro" ? (faixa.fala ?? "") : "";
    const naoSaiu = soNaFaixa !== bruto ? soNaFaixa : "";
    txt.value = naoSaiu;
    composer?.atualizar(txt);
    // ADA-5: o rascunho acompanha o campo (A→B→A no voo não traz a fala enviada de volta para sair duas vezes).
    guardarRascunho(txt);
    void mandarPedido(c, bruto, texto, idEnvio, !!reuso, ids);
  }

  /** ADA-4: "Tentar de novo" da faixa: a mesma fala, com a chave que ela já tem. */
  function tentarDeNovo(): void {
    if (faixa.tipo !== "falhou" || !chave) return;
    const f = faixa;
    const idEnvio = envios.iniciar(chave, f.texto, [], undefined, f.idEnvio);
    if (idEnvio === null) return;
    // O texto que voltou ao campo na falha sai de lá (senão o Enter mandaria a mesma fala outra vez).
    const txt = doc.getElementById("qc-txt") as HTMLTextAreaElement | null;
    if (txt && txt.value.trim() === f.fala) { txt.value = ""; composer?.atualizar(txt); }
    // ADA-5: os anexos que voltaram à fila na falha vão de novo com a fala.
    const ids = dd?.composer?.anexos?.prontos(chave) ?? [];
    void mandarPedido(chave, f.fala, f.texto, idEnvio, true, ids ?? []);
  }

  async function mandarPedido(c: string, fala: string, texto: string, idEnvio: string, repetido = false, ids: readonly string[] = []): Promise<void> {
    const a = dd?.api();
    const cp = dd?.composer;
    if (!a) { envios.concluir(c, false); return; }
    // Revisão 13 do #646 (B2): o "Tentar de novo" guarda o lote de antes do 1º envio (o retry deduplicado não o perde).
    // Revisão 14 (M1): o lote vem com a chave que falhou (outro pedido no meio pode ter trocado o `loteAntes`).
    const guardada = repetido ? chavesQueFalharam.get(chaveDaFala(c, texto)) : undefined;
    if (guardada) loteAntes = guardada.lote;
    else if (!repetido) loteAntes = q?.ultimoLote?.id ?? null;
    histAberto = false;
    despachar({ tipo: "enviou", fala, texto, idEnvio });
    falhaNoCampo = false;
    novasDoEnvio = [];
    let ok = false;
    // ADA-5 (revisão 2): os anexos saem da fila antes do POST (o envio do chat ou outro da pílula não os mandam de novo).
    const saem = ids.length > 0 ? cp?.anexos?.retirar(c, ids) ?? null : null;
    try {
      // Revisão 1 do #646: o POST que não volta (conexão meio aberta) não segura a faixa nem a trava do envio.
      const r = await comPrazo(a.enviar(c, texto, ids, idEnvio), dd?.envioEm ?? PRAZO_DO_ENVIO_MS);
      ok = true;
      saem?.confirmar();
      chavesQueFalharam.delete(chaveDaFala(c, texto));
      // ADA-5: o rascunho do que foi mandado não volta (mesmo noutro bot), salvo se a pessoa já escreveu outro.
      if (cp?.rascunhos?.ler(chaveDoRascunho(c, null)).trim() === fala) cp.rascunhos.guardar(chaveDoRascunho(c, null), "");
      if (c !== chave) return;
      despachar({ tipo: "aceito", pedidoId: r.ids["mensagem"] ?? null, turnoId: r.ids["turno"] ?? null, agora: Date.now() });
      // Revisão 3 do #646: o "Tentar de novo" pode cair num turno que já acabou (o 1º POST tinha chegado e os frames dele
      // foram descartados): a leitura confere se ele ainda está vivo.
      void lerConversa(repetido);
    } catch (erro) {
      saem?.devolver();
      // Revisão 7 do #646: o servidor recusou pela regra (4xx): tentar o mesmo falha igual. A faixa diz o porquê, sem
      // "Tentar de novo", e a chave sai (a próxima fala ganha outra). Só a rede, o 5xx e o prazo ganham o Tentar.
      const recusado = ehRecusaDoServidor(erro);
      if (recusado) { ok = true; chavesQueFalharam.delete(chaveDaFala(c, texto)); } else chavesQueFalharam.set(chaveDaFala(c, texto), { id: idEnvio, em: Date.now(), lote: loteAntes });
      // Revisão 6 do #646: a pessoa já está noutra conversa: a fala fica guardada e volta quando ela retornar.
      if (c !== chave) { perdidosDaPilula.set(c, fala); return; }
      // Revisão 13 do #646 (M1): a pessoa saiu e voltou com o POST em voo (a troca zerou a faixa): a falha volta a ter o
      // pedido na faixa, para o "Não saiu" (ou a fala recusada) aparecer em vez de sumir.
      if (!(faixa.tipo === "enviando" && faixa.idEnvio === idEnvio) && !pedidoEmCurso(faixa)) trocarFaixa({ tipo: "enviando", fala, texto, idEnvio, guardados: [] });
      // Só volta ao campo vazio: o que a pessoa começou a escrever enquanto este ia não é sobrescrito.
      const txt = doc.getElementById("qc-txt") as HTMLTextAreaElement | null;
      const voltou = !!txt && !txt.value.trim();
      if (txt && voltou) { txt.value = fala; falhaNoCampo = true; composer?.atualizar(txt); guardarRascunho(txt); }
      if (recusado) {
        const porque = erro instanceof ErroApi ? erro.message : "";
        // Revisão 12 do #646 (M1): com o campo ocupado, a fala recusada fica na faixa (não some).
        if (faixa.tipo === "enviando") trocarFaixa({ tipo: "erro", texto: `Não saiu: ${porque || "o servidor recusou o pedido."}`, ...(voltou ? {} : { fala }) });
        atualizarBotaoDaPilula();
        return;
      }
      // Revisão 7 do #646: o prazo venceu, mas o POST pode ter chegado: a conversa decide (senão a fala editada e
      // reenviada ganharia outra chave e o bot faria o pedido duas vezes).
      const duvida = erro instanceof Error && erro.message === "envio_sem_resposta";
      despachar({ tipo: "recusado", duvida });
      if (duvida) void conferirEnvio(c, texto, fala);
    } finally {
      envios.concluir(c, ok);
    }
  }

  /**
   * Revisão 7 do #646: o "Não saiu" em dúvida (o prazo venceu) confere a conversa: a fala da pessoa que apareceu depois do
   * envio, com o mesmo texto, é este pedido, e a faixa passa a seguir o turno dele.
   */
  async function conferirEnvio(c: string, texto: string, fala: string): Promise<void> {
    const a = dd?.api();
    const novas = novasDoEnvio.slice();
    if (!a || c !== chave || !novas.length) return;
    const f0 = faixa;
    try {
      const r = await a.conversa(c);
      if (c !== chave || faixa !== f0 || faixa.tipo !== "falhou" || !faixa.duvida || faixa.texto !== texto) return;
      const ids = new Set(novas.map((n) => n.mensagemId));
      const m = r.mensagens.find((x) => ids.has(x.id) && x.autoria.autor_tipo === "pessoa" && x.texto.trim() === texto.trim());
      if (!m) return;
      const turno = novas.find((n) => n.mensagemId === m.id)?.turnoId ?? (r.turnosEmCurso ?? []).find((t) => t.mensagemId === m.id)?.id ?? null;
      const txt = doc.getElementById("qc-txt") as HTMLTextAreaElement | null;
      if (txt && falhaNoCampo && txt.value.trim() === fala) txt.value = "";
      falhaNoCampo = false;
      chavesQueFalharam.delete(chaveDaFala(c, texto));
      envios.concluir(c, true);
      despachar({ tipo: "aceito", pedidoId: m.id, turnoId: turno, agora: Date.now() });
      void lerConversa(true);
    } catch { /* sem a conversa, vale o "Não saiu" (o Tentar reusa a chave) */ }
  }

  /** ADA-4: o ■ Parar da pílula. A faixa diz "Parando…" até o `turno.interrompido` (parado_pela_pessoa). */
  async function pararPedido(): Promise<void> {
    const a = dd?.api();
    const cp = dd?.composer;
    if (!chave || !pararNaPilula()) return;
    const c = chave;
    if (cp?.parar) {
      // ADA-5: o mesmo Parar do chat. Revisão 4: o segundo clique de um clique duplo em Enviar não para o turno novo.
      if (Date.now() - (enviouEm.get(c) ?? 0) < SEM_PARAR_DEPOIS_DE_ENVIAR_MS) return;
      // ADA-4: a faixa do pedido diz "Parando…" até o `turno.interrompido`.
      if (podeParar(faixa)) despachar({ tipo: "parar" });
      try { await cp.parar(); } catch { if (c === chave && faixa.tipo === "trabalhando" && faixa.parando) despachar({ tipo: "parar_falhou" }); }
      return;
    }
    if (!a?.pararConversa || !podeParar(faixa, Date.now())) return;
    despachar({ tipo: "parar" });
    try {
      const r = await a.pararConversa(c);
      if (c !== chave) return;
      // Nada rodava (o turno acabou no caminho): volta ao turno e relê a conversa, que traz a resposta.
      if (r?.nadaRodando) { despachar({ tipo: "parar_falhou" }); void lerConversa(); }
    } catch {
      if (c === chave) despachar({ tipo: "parar_falhou" });
    }
  }

  /**
   * ADA-4: o card do lote do anfitrião pisca uma vez e, fora da vista, rola até ela. Na coluna recolhida, a coluna abre
   * antes. Nunca durante um gesto (ADA-7): a pessoa que está rolando não perde o lugar.
   */
  /** Revisão 11 (M2): com o pedido seguido, o lote novo do anfitrião (gravado depois do pedido) pulsa o card dele. */
  function pulsarDoPedido(): void {
    const lote = q?.ultimoLote ?? null;
    if (!lote || (faixa.tipo !== "trabalhando" && faixa.tipo !== "enviando") || lote.id === loteAntes || lote.id === lotePulsado || lote.desfeitoEm) return;
    if (lote.autor.tipo !== "agente" || lote.autor.agenteId !== agenteId) return;
    lotePulsado = lote.id;
    pulsarCard(lote.tarefaIds);
  }

  function pulsarCard(ids: readonly string[], tentativas = 20): void {
    const v = vista();
    if (!v || !q || aberta || paginas[pagina]?.app) return;
    // Revisão 1 do #646: no gesto o desenho do lote espera (ADA-7) e o card ainda não está lá: tenta de novo depois.
    if (seguraGesto(Date.now()) && tentativas > 0) {
      if (timerPulso) clearTimeout(timerPulso);
      timerPulso = setTimeout(() => { timerPulso = null; pulsarCard(ids, tentativas - 1); }, 500);
      return;
    }
    const id = ids.find((i) => !!tarefaNoQuadro(q, i));
    if (!id) return;
    const sel = `.qd-card[data-tarefa="${CSS.escape(id)}"]`;
    const visivel = (): HTMLElement | null => [...v.querySelectorAll<HTMLElement>(sel)].find((el) => el.getClientRects().length > 0) ?? null;
    let card = visivel();
    const parado = !seguraGesto(Date.now());
    if (!card && parado) {
      const t = tarefaNoQuadro(q, id);
      const col = t ? v.querySelector<HTMLElement>(`.qd-col-recolhida[data-coluna="${CSS.escape(t.status)}"]`) : null;
      if (t && col) {
        if (alternadas.has(t.status)) alternadas.delete(t.status); else alternadas.add(t.status);
        desenharVista();
        card = visivel();
      }
    }
    if (!card) return;
    if (parado) {
      const r = card.getBoundingClientRect();
      const g = card.closest(".qd-grade")?.getBoundingClientRect();
      const alto = doc.defaultView?.innerHeight ?? 0;
      const fora = r.top < 0 || r.bottom > alto || (!!g && (r.left < g.left || r.right > g.right));
      if (fora) card.scrollIntoView({ block: "nearest", inline: "center", behavior: reduzido() ? "auto" : "smooth" });
    }
    card.classList.remove("pulsa");
    void card.offsetWidth;
    card.classList.add("pulsa");
    const el = card;
    const tirar = (): void => el.classList.remove("pulsa");
    el.addEventListener("animationend", tirar, { once: true });
    setTimeout(tirar, 1400);
  }

  async function responder(form: HTMLFormElement, avancar = false): Promise<void> {
    const a = dd?.api();
    const id = form.dataset["id"];
    const campo = form.querySelector<HTMLTextAreaElement>("textarea");
    const resposta = campo?.value.trim() ?? "";
    if (!a || !agenteId || !id || !campo || !resposta) return;
    const botoes = [...form.querySelectorAll<HTMLButtonElement>('button[type="submit"]')];
    // Enquanto envia, nem os botões nem o Enter mandam de novo (NOD-420).
    if (form.dataset["enviando"] === "1") return;
    form.dataset["enviando"] = "1";
    for (const b of botoes) b.disabled = true;
    campo.readOnly = true;
    // A pessoa pode trocar de bot antes da resposta voltar: o quadro de um não entra na tela do outro.
    const c = chave;
    const de = agenteId;
    try {
      const r = await a.responderTarefa(de, id, resposta, avancar);
      // O rascunho do que foi respondido não volta quando a tarefa pedir de novo (revisões 1 e 6).
      if (c) limparRespostaEnviada(c, id, resposta);
      if (c !== chave || de !== agenteId) return;
      campo.value = "";
      ultimaResposta = r.lote && !r.lote.desfeitoEm ? { loteId: r.lote.id, tarefaId: id, texto: resposta } : null;
      aplicarQuadro(r.quadro, [id]);
      // NOD-420: o recibo diz para onde voltou e quem segue. ADA-6: com Desfazer (o lote da resposta; o servidor volta a
      // tarefa para a pessoa e para o turno que a resposta abriu).
      mudarFaixa({ tipo: "resposta", texto: reciboDaResposta(r.quadro, id), loteId: r.lote && !r.lote.desfeitoEm ? r.lote.id : null, mensagemId: "" });
    } catch {
      if (c !== chave) return;
      mudarFaixa({ tipo: "erro", texto: "Não consegui mandar a resposta. Ela continua no campo." });
    } finally {
      delete form.dataset["enviando"];
      for (const b of botoes) b.disabled = false;
      campo.readOnly = false;
    }
  }

  /**
   * NOD-415 (ADR-141): criar o quadro e mudar a meta ou o prazo pela tela. A resposta sobe na faixa com o Desfazer do lote
   * (o mesmo lote do gerir_quadro). Trocar de bot no meio: a resposta de um não entra na tela do outro.
   */
  async function mexerNoQuadro(tipo: "criar" | "editar", campos: { meta?: string | null; prazo?: string | null }): Promise<void> {
    const a = dd?.api();
    if (!a || !agenteId) return;
    const c = chave;
    const de = agenteId;
    try {
      const r = tipo === "criar" ? await a.criarQuadro(de, campos) : await a.editarQuadro(de, campos);
      if (c !== chave || de !== agenteId) return;
      const ok = (r as { ok?: boolean }).ok !== false;
      if (!ok) throw new Error("recusado");
      editandoMeta = false;
      aplicarQuadro(r.quadro);
      const texto = tipo === "criar" ? "Quadro criado." : campos.meta !== undefined ? (campos.meta ? "Meta trocada." : "Meta tirada: fluxo contínuo.") : campos.prazo ? "Prazo trocado." : "Prazo tirado.";
      mudarFaixa({ tipo: "resposta", texto, loteId: r.lote?.id ?? null, mensagemId: "" });
      if (tipo === "editar" && campos.meta !== undefined) focarSemRolar(itemDaMeta());
    } catch {
      if (c !== chave) return;
      mudarFaixa({ tipo: "erro", texto: tipo === "criar" ? "Não consegui criar o quadro." : "Não consegui mudar o quadro." });
    }
  }

  /** NOD-415 (ADR-141): voltar a agente comum. Confirma antes (não tem Desfazer); depois, a vista mostra o "criar quadro". */
  async function removerQuadro(): Promise<void> {
    const a = dd?.api();
    if (!a || !agenteId || !q) return;
    const confirmar = dd?.confirmar ?? ((t: string) => doc.defaultView?.confirm(t) ?? false);
    if (!confirmar(`Remover o quadro de ${nome}? As tarefas e o histórico do quadro somem e não dá para desfazer. A conversa e a memória de ${nome} ficam.`)) return;
    const c = chave;
    const de = agenteId;
    try {
      const r = await a.removerQuadro(de);
      if (c !== chave || de !== agenteId) return;
      if ((r as { ok?: boolean }).ok === false) throw new Error("recusado");
      editandoMeta = false;
      aplicarQuadro(null);
      mudarFaixa({ tipo: "resposta", texto: `Quadro removido: ${nome} voltou a ser um bot comum.`, loteId: null, mensagemId: "" });
    } catch {
      if (c !== chave) return;
      mudarFaixa({ tipo: "erro", texto: "Não consegui remover o quadro." });
    }
  }

  /** O item Meta do menu do quadro (aberto) ou, sem ele, o nome do quadro (computador) ou o ⋯ (celular). */
  function itemDaMeta(): HTMLElement | null {
    const v = vista();
    return v?.querySelector<HTMLElement>('.qd-conteudo [data-act="editar-meta"]') ?? v?.querySelector<HTMLElement>(".qd-conteudo .qm-cab-bt, .qd-conteudo .qd-cel-mais") ?? null;
  }

  function editarMeta(sim: boolean): void {
    editandoMeta = sim;
    desenharVista();
    const alvo = sim ? vista()?.querySelector<HTMLElement>("#qd-meta-in") : itemDaMeta();
    alvo?.focus();
    if (sim && alvo instanceof HTMLInputElement) alvo.select();
  }

  async function desfazer(loteId: string): Promise<void> {
    const a = dd?.api();
    if (!a || !agenteId) return;
    const c = chave;
    const de = agenteId;
    try {
      const r = await a.desfazerLoteQuadro(de, loteId);
      if (c !== chave || de !== agenteId) return;
      aplicarQuadro(r.quadro, q?.ultimoLote?.tarefaIds ?? []);
      // ADA-6 (revisão A3): o Desfazer do Responder devolve o texto ao campo, para a pessoa corrigir e mandar de novo.
      const volta = ultimaResposta?.loteId === loteId ? ultimaResposta : null;
      ultimaResposta = null;
      let devolvida = false;
      if (volta) {
        for (const f of doc.querySelectorAll<HTMLFormElement>("#quadro form")) {
          // Revisão 4 (A1): só o campo de resposta; o Comentar e o Recado ao agente usam o mesmo data-id e não recebem o texto.
          if (f.dataset["id"] !== volta.tarefaId || f.dataset["form"] !== "responder-tarefa") continue;
          const campo = f.querySelector<HTMLTextAreaElement>("textarea[name='resposta']");
          if (campo && !campo.value.trim()) { campo.value = volta.texto; devolvida = true; }
        }
      }
      // Revisão 3: sem o campo à vista (ou com outro texto nele), a resposta não voltou: o recibo diz, para ela não sumir calada.
      const texto = devolvida ? "Desfeito. A resposta voltou ao campo." : volta ? "Desfeito. A resposta não voltou ao campo: abra a tarefa para responder de novo." : "Desfeito.";
      mudarFaixa({ tipo: "resposta", texto, loteId: null, mensagemId: "" });
    } catch {
      if (c !== chave) return;
      mudarFaixa({ tipo: "erro", texto: "Não deu para desfazer: o quadro mudou depois deste pedido." });
    }
  }

  /* ---------- NOD-443: as pessoas, o modo e o mural ---------- */

  async function lerMural(): Promise<void> {
    const a = dd?.api();
    if (!a?.atividadeQuadro || !agenteId) return;
    const n = ++leituraMural;
    const de = agenteId;
    try {
      const r = await a.atividadeQuadro(de);
      if (n !== leituraMural || de !== agenteId) return;
      // ADA-7 (revisão 4): a mesma Atividade não regrava a vista.
      if (mural && JSON.stringify(mural) === JSON.stringify(r.linhas)) return;
      mural = r.linhas;
    } catch {
      if (n !== leituraMural) return;
      mural = [];
      erroPessoas = "Não consegui ler a Atividade agora.";
    }
    if (painel === "atividade") redesenharQuandoLivre();
  }

  function abrirPainel(qual: Exclude<PainelDoQuadro, null>): void {
    painel = painel === qual ? null : qual;
    erroPessoas = null;
    if (painel === "atividade") { mural = null; void lerMural(); }
    desenharVista();
    // Quadro mínimo: aberto, o foco vai ao Fechar do painel; fechado, volta ao nome do quadro (o menu mora lá).
    (vista()?.querySelector<HTMLElement>(`.qd-conteudo [data-act="painel-${qual}"]`) ?? vista()?.querySelector<HTMLElement>(".qd-conteudo .qm-cab-bt, .qd-conteudo .qd-cel-mais"))?.focus();
  }

  /** Uma mudança nas pessoas ou no modo: um lote com Desfazer na faixa; a recusa do servidor fica no painel. */
  async function mexerNasPessoas(fazer: (a: ApiDoQuadro, de: string) => Promise<MutacaoQuadro> | undefined, recibo: string, foco?: string): Promise<boolean> {
    const a = dd?.api();
    if (!a || !agenteId || mexendo) return false;
    const c = chave;
    const de = agenteId;
    mexendo = true;
    try {
      const p = fazer(a, de);
      if (!p) return false;
      const r = await p;
      if (c !== chave || de !== agenteId) return false;
      erroPessoas = null;
      aplicarQuadro(r.quadro);
      mudarFaixa({ tipo: "resposta", texto: recibo, loteId: r.lote && !r.lote.desfeitoEm ? r.lote.id : null, mensagemId: "" });
      desenharFaixa();
      if (foco) focarSemRolar(vista()?.querySelector<HTMLElement>(foco));
      return true;
    } catch (e) {
      if (c !== chave) return false;
      erroPessoas = e instanceof ErroApi && e.message ? e.message : "Não deu para mudar as pessoas do quadro agora.";
      desenharVista();
      return false;
    } finally {
      mexendo = false;
    }
  }

  async function adicionarPessoa(form: HTMLFormElement): Promise<void> {
    const campo = form.querySelector<HTMLInputElement>('[name="pessoa"]');
    const pessoa = campo?.value.trim() ?? "";
    if (!pessoa) return;
    // D3: o modo escolhido junto com a primeira pessoa (o padrão já é "cada um na sua conversa") vai no MESMO lote
    // (revisão 1, achado 11): se a pessoa não entra, o modo não muda, e um Desfazer volta os dois.
    const escolhido = form.querySelector<HTMLInputElement>('[name="modo"]:checked')?.value as ModoConversa | undefined;
    const modo = !(q?.membros?.length) && escolhido && escolhido !== q?.modoConversa ? escolhido : undefined;
    const recibo = modo === "so_dono" ? `${pessoa} entrou no quadro; só você conversa com ele` : `${pessoa} entrou no quadro`;
    const ok = await mexerNasPessoas((a, de) => a.adicionarPessoa?.(de, pessoa, modo), recibo, "#qd-pessoa-in");
    if (!ok) return;
    const c = doc.getElementById("qd-pessoa-in");
    if (c instanceof HTMLInputElement) c.value = "";
  }

  /* ---------- NOD-448: as colunas pela tela ---------- */

  const colunaDe = (id: string | undefined) => (id ? q?.colunas.find((c) => c.id === id) ?? null : null);
  const tarefasNa = (id: string): number => q?.tarefas.filter((t) => t.status === id).length ?? 0;

  /** Abre (ou fecha) um pedaço da edição e leva o foco a ele. */
  function editar(ed: EdicaoDeColuna | null, foco?: string): void {
    edicao = ed;
    desenharVista();
    const v = vista();
    if (!v) return;
    if (foco) { visivel(v, foco)?.focus(); return; }
    const alvo = ed?.tipo === "renomear" ? "#qd-col-in" : ed?.tipo === "nova" ? ".qd-col-nova-f input[name=nome]" : ed?.tipo === "remover" ? "#qd-col-destino"
      : ed?.tipo === "menu" || ed?.tipo === "mover" ? '#qd-menu [role="menuitem"]:not([aria-disabled])' : ed?.tipo === "ordem" ? ".qd-folha-tit"
      : ed?.tipo === "passagem" ? ".qd-pop-passa input[name=modo]:checked" : ed?.tipo === "trava" ? ".qd-pop-trava input[name=sai_para]"
      : ed?.tipo === "prazo" ? "#qd-prz-valor" : null;
    const el = alvo ? visivel(v, alvo) : null;
    if (ed?.tipo === "ordem" && el) el.tabIndex = -1;
    el?.focus();
    if (el instanceof HTMLInputElement && ed?.tipo === "renomear") el.select();
  }

  /**
   * O primeiro que está na tela: a grade e a lista do celular são desenhadas juntas (uma some pelo CSS), e a confirmação
   * do card solto e o "Mover para…" existem nas duas.
   */
  const visivel = (v: ParentNode, sel: string): HTMLElement | null => {
    const els = [...v.querySelectorAll<HTMLElement>(sel)];
    return els.find((x) => x.getClientRects().length > 0) ?? els[0] ?? null;
  };

  /** Onde o foco volta depois do prazo: o ⋯ da coluna, ou o botão do prazo na folha do celular. */
  const focoDoPrazo = (id: string, folha: boolean): string =>
    folha ? `.qd-folha [data-act="col-prazo"][data-coluna="${CSS.escape(id)}"]` : `.qd-so-largo [data-act="col-menu"][data-coluna="${CSS.escape(id)}"]`;

  /** Fecha o que está aberto; dentro da folha do celular, volta para a folha. O card que se movia leva o foco de volta. */
  const fechar = (): void => {
    if (edicao?.tipo === "mover") {
      const t = CSS.escape(edicao.tarefa);
      editar(null, `[data-act="tarefa-mover"][data-tarefa="${t}"]`);
      return;
    }
    // NOD-420 (revisão 3 do PR #624): o prazo abre pelo ⋯ da coluna; fechar devolve o foco a ele. Na folha do celular
    // (revisão 4), volta para a folha, no botão do prazo.
    if (edicao?.tipo === "prazo") {
      if (edicao.naFolha) editar({ tipo: "ordem" }, focoDoPrazo(edicao.coluna, true));
      else editar(null, focoDoPrazo(edicao.coluna, false));
      return;
    }
    const volta = edicao && "naFolha" in edicao && edicao.naFolha ? ({ tipo: "ordem" } as const) : null;
    const col = edicao && "coluna" in edicao ? edicao.coluna : null;
    editar(volta, col && !volta ? `.qd-so-largo .qd-col-bt[data-coluna="${CSS.escape(col)}"]` : undefined);
  };

  /** Uma mudança de coluna: aplica o quadro que volta e diz o que mudou na faixa, com o Desfazer do lote. */
  async function mexer(fazer: (a: ApiDoQuadro, de: string) => Promise<MutacaoQuadro> | undefined, recibo: string, foco?: string, depois: EdicaoDeColuna | null = null, texto?: string, restaurarPrazoDigitado?: () => void): Promise<void> {
    const a = dd?.api();
    // Uma de cada vez: o Enter e a saída do campo não mandam o mesmo renomear duas vezes.
    if (!a || !agenteId || mexendo) return;
    const c = chave;
    const de = agenteId;
    mexendo = true;
    try {
      const p = fazer(a, de);
      if (!p) return;
      const r = await p;
      if (c !== chave || de !== agenteId) return;
      edicao = depois;
      aplicarQuadro(r.quadro);
      mudarFaixa({ tipo: "resposta", texto: recibo, loteId: r.lote && !r.lote.desfeitoEm ? r.lote.id : null, mensagemId: "" });
      if (foco) focarSemRolar(vista()?.querySelector<HTMLElement>(foco));
    } catch (e) {
      if (c !== chave) return;
      const aberta = edicao;
      const f = fraseDoErroDeColuna(e instanceof ErroApi ? e.codigo : null, aberta?.tipo === "prazo" ? "prazo" : undefined);
      // Recusado pelo dado (ou sem conexão): o campo fica aberto com o que foi digitado, e o porquê nele.
      if (f.manter && aberta?.tipo === "prazo" && restaurarPrazoDigitado) {
        editar({ ...aberta, erro: f.texto });
        restaurarPrazoDigitado();
        return;
      }
      if (f.manter && texto !== undefined && aberta && (aberta.tipo === "renomear" || aberta.tipo === "nova")) {
        editar({ ...aberta, erro: f.texto });
        restaurar(texto);
        return;
      }
      edicao = depois;
      mudarFaixa({ tipo: "erro", texto: f.texto });
      if (!f.manter) void lerQuadro();
    } finally {
      mexendo = false;
    }
  }

  function moverColuna(id: string, lado: Lado, foco?: string): void {
    if (!q) return;
    const passo = passoDeMover(q.colunas, id, lado);
    const c = colunaDe(id);
    if (!c) return;
    if (!passo.ok) { mudarFaixa({ tipo: "erro", texto: passo.porque }); return; }
    const { ok: _ok, ...onde } = passo;
    void mexer((a, de) => a.moverColuna?.(de, id, onde), `${c.nome} mudou de lugar`, foco, naFolha() ? { tipo: "ordem" } : null);
  }

  function soltar(id: string, alvo: string): void {
    if (!q) return;
    const onde = soltarEm(q.colunas, id, alvo);
    const c = colunaDe(id);
    if (!onde || !c) return;
    void mexer((a, de) => a.moverColuna?.(de, id, onde), `${c.nome} mudou de lugar`, undefined, naFolha() ? { tipo: "ordem" } : null);
  }

  const naFolha = (): boolean => !!edicao && (edicao.tipo === "ordem" || ("naFolha" in edicao && !!edicao.naFolha));

  function pedirRemover(id: string, el: HTMLElement): void {
    const c = colunaDe(id);
    if (!c || !q) return;
    const porque = porqueNaoRemove(q.colunas, id, nome);
    if (porque) { mudarFaixa({ tipo: "erro", texto: porque }); return; }
    const folha = !!el.closest(".qd-folha");
    // Decisão 9 do Gil: a vazia sai na hora (com Desfazer); com tarefas, pergunta para onde elas vão.
    if (tarefasNa(id) === 0) { void mexer((a, de) => a.removerColuna?.(de, id), `${c.nome} removida`, undefined, folha ? { tipo: "ordem" } : null); return; }
    editar({ tipo: "remover", coluna: id, ...(folha ? { naFolha: true } : {}) });
  }

  function enviarColuna(form: HTMLFormElement): void {
    if (!q) return;
    const qual = form.dataset["form"];
    const folha = !!form.closest(".qd-folha");
    const depois: EdicaoDeColuna | null = folha ? { tipo: "ordem" } : null;
    const campo = form.querySelector<HTMLInputElement>("input[name=nome]");
    const texto = (campo?.value ?? "").trim().replace(/\s+/g, " ");
    if (qual === "col-renomear") {
      const id = form.dataset["coluna"] ?? "";
      const c = colunaDe(id);
      if (!c) { editar(depois); return; }
      if (!texto || texto === c.nome) { fechar(); return; }
      const outra = nomeRepetido(q.colunas, texto, id);
      if (outra) { editar({ tipo: "renomear", coluna: id, erro: `Já existe uma coluna ${outra.nome}`, ...(folha ? { naFolha: true } : {}) }); restaurar(texto); return; }
      void mexer((a, de) => a.renomearColuna?.(de, id, texto), `${c.nome} agora é ${texto}`, folha ? undefined : `.qd-so-largo .qd-col-bt[data-coluna="${CSS.escape(id)}"]`, depois, texto);
    } else if (qual === "col-nova") {
      const grupo = form.querySelector<HTMLInputElement>("input[name=grupo]:checked")?.value as GrupoColuna | undefined;
      const depoisDe = form.dataset["depois"];
      const base = { tipo: "nova" as const, ...(depoisDe ? { depoisDe } : {}), ...(grupo ? { grupo } : {}), ...(folha ? { naFolha: true } : {}) };
      if (!texto) return;
      if (!grupo) { editar({ ...base, erro: "Escolha o grupo da coluna" }); restaurar(texto); return; }
      const outra = nomeRepetido(q.colunas, texto);
      if (outra) { editar({ ...base, erro: `Já existe uma coluna ${outra.nome}` }); restaurar(texto); return; }
      const junto = depoisDe ? colunaDe(depoisDe) : null;
      const recibo = junto && junto.grupo === grupo && !junto.fixa ? `${texto} criada, junto de ${junto.nome}` : `${texto} criada`;
      void mexer((a, de) => a.criarColuna?.(de, { nome: texto, grupo, ...(junto && junto.grupo === grupo && !junto.fixa ? { depois_de: junto.id } : {}) }), recibo, undefined, depois, texto);
    } else if (qual === "col-passagem") {
      const id = form.dataset["coluna"] ?? "";
      const c = colunaDe(id);
      if (!c) { editar(null); return; }
      const modo = form.querySelector<HTMLInputElement>("input[name=modo]:checked")?.value;
      const escolhido = form.querySelector<HTMLSelectElement>("select[name=agente]")?.value ?? "";
      const instrucoes = (form.querySelector<HTMLTextAreaElement>("textarea[name=instrucoes]")?.value ?? "").trim() || null;
      const agente = modo === "agente" ? escolhido || null : null;
      if (modo === "agente" && !agente) { form.querySelector<HTMLSelectElement>("select[name=agente]")?.focus(); return; }
      // 2026-11-10: as saídas da etapa ("" = o padrão). Sem os campos (popover antigo), não mexe.
      const saida = (nome: string): string | null | undefined => { const el = form.querySelector<HTMLSelectElement>(`select[name=${nome}]`); return el ? el.value || null : undefined; };
      const proxima = saida("proxima");
      const volta = saida("volta");
      const mudaSaidas = (proxima !== undefined && proxima !== (c.proxima ?? null)) || (volta !== undefined && volta !== (c.volta ?? null));
      if (agente === (c.responsavel ?? null) && instrucoes === (c.instrucoes ?? null) && !mudaSaidas) { fechar(); return; }
      const quem = agente ? dd?.agentes?.().find((x) => x.id === agente)?.nome ?? "o agente" : null;
      const mudaPassagem = agente !== (c.responsavel ?? null) || instrucoes !== (c.instrucoes ?? null);
      const recibo = !mudaPassagem ? `${c.nome}: saídas da etapa` : quem ? `${c.nome} passa para ${quem}` : agente === (c.responsavel ?? null) ? `${c.nome}: etapa descrita` : `${c.nome} sem passagem`;
      void mexer((a, de) => a.definirPassagem?.(de, id, { agente, instrucoes, ...(proxima !== undefined ? { proxima } : {}), ...(volta !== undefined ? { volta_para: volta } : {}) }), recibo, `.qd-so-largo [data-act="col-passagem"][data-coluna="${CSS.escape(id)}"]`);
    } else if (qual === "col-trava") {
      const id = form.dataset["coluna"] ?? "";
      const c = colunaDe(id);
      if (!c) { editar(null); return; }
      const sai = [...form.querySelectorAll<HTMLInputElement>("input[name=sai_para]:checked")].map((x) => x.value);
      const antes = c.trava?.saiPara ?? [];
      if (sai.length === antes.length && sai.every((x) => antes.includes(x))) { fechar(); return; }
      const frase = fraseDaTrava(q.colunas, sai.length ? { saiPara: sai } : undefined);
      void mexer((a, de) => a.travarColuna?.(de, id, { sai_para: sai.length ? sai : null }), frase ? `De ${c.nome} ${frase}` : `${c.nome} sem trava de destino`, `.qd-so-largo [data-act="col-menu"][data-coluna="${CSS.escape(id)}"]`);
    } else if (qual === "col-prazo") {
      const id = form.dataset["coluna"] ?? "";
      const c = colunaDe(id);
      if (!c) { editar(null); return; }
      const valor = form.querySelector<HTMLInputElement>("input[name=valor]")?.value ?? "";
      const unidade = (form.querySelector<HTMLSelectElement>("select[name=unidade]")?.value ?? "h") as UnidadeDePrazo;
      const min = prazoEmMin(valor, unidade);
      if (min === null) { editar({ tipo: "prazo", coluna: id, erro: `Use um número ${FAIXA_DO_PRAZO}`, ...(folha ? { naFolha: true } : {}) }); restaurarPrazo(valor, unidade); return; }
      if (min === (c.prazoMin ?? null)) { fechar(); return; }
      void mexer((a, de) => a.prazoDaColuna?.(de, id, min), `${c.nome}: prazo de ${prazoLegivelMin(min)}`, focoDoPrazo(id, folha), depois, undefined, () => restaurarPrazo(valor, unidade));
    } else if (qual === "col-remover") {
      const id = form.dataset["coluna"] ?? "";
      const c = colunaDe(id);
      const destino = form.querySelector<HTMLSelectElement>("select[name=destino]")?.value ?? "";
      const para = colunaDe(destino);
      if (!c || !para) return;
      const n = tarefasNa(id);
      void mexer((a, de) => a.removerColuna?.(de, id, destino), `${c.nome} removida · ${n === 1 ? "1 tarefa" : `${n} tarefas`} em ${para.nome}`, undefined, depois);
    }
  }

  /** Depois de regravar com o erro, o que a pessoa digitou volta ao campo. */
  function restaurar(texto: string): void {
    const c = vista()?.querySelector<HTMLInputElement>("#qd-col-in, .qd-col-nova-f input[name=nome]");
    if (c) { c.value = texto; c.focus(); }
  }

  /** NOD-420: o prazo recusado volta ao popover com o que foi digitado. */
  function restaurarPrazo(valor: string, unidade: string): void {
    const v = vista()?.querySelector<HTMLInputElement>("#qd-prz-valor");
    const u = vista()?.querySelector<HTMLSelectElement>("#qd-prz-unidade");
    if (u) u.value = unidade;
    if (v) { v.value = valor; v.focus(); }
  }

  /** O clique simples recolhe; o duplo renomeia (decisão 6). O simples espera um pouco para o duplo não recolher antes. */
  let timerClique: ReturnType<typeof setTimeout> | null = null;
  /** O arrasto de uma coluna (o cabeçalho no computador, a alça ≡ na folha): só dentro do grupo. */
  let arrasto: { id: string; x: number; y: number; ativo: boolean; alvo: HTMLElement | null; origem: HTMLElement | null } | null = null;
  let engolirClique = false;
  let mexendo = false;

  function aoFrame(frame: { tipo: string; dados: Record<string, unknown> }): void {
    if (!dd || chave === null || !agenteId) return;
    const d = frame.dados;
    if (frame.tipo === "quadro.mudou") {
      if (d["agenteId"] !== agenteId && (!q || d["quadroId"] !== q.id)) return;
      const ids = typeof d["tarefas"] === "string" ? d["tarefas"].split(",").filter(Boolean) : [];
      dica = [...dica, ...ids];
      if (aberta && (!ids.length || ids.includes(aberta))) void coms.reler();
      if (aberta) trabs.aoFrame(frame);
      pedirReleitura();
      return;
    }
    if (aberta && frame.tipo.startsWith("turno.")) trabs.aoFrame(frame);
    // A execução dos cards (rodando, na fila, falhou) vem dos turnos: com o quadro à vista e com tarefas, relê. Só o
    // começo e o fim de um turno mudam a execução; o delta, a fala e a atividade (várias por segundo enquanto qualquer
    // bot escreve) regravavam o quadro inteiro e travavam a rolagem (ADA-7, ADR-061).
    if (TURNO_MUDA_A_EXECUCAO.has(frame.tipo) && q && q.tarefas.length && modo === "quadro") pedirReleitura();
    // Revisão do PR #700: o turno que acabou pode ter trocado o Exibir pelo chat (de qualquer conversa da pessoa).
    if (frame.tipo === "turno.encerrado" && q && modo === "quadro") relerExibir();
    const daConversa = d["conversaId"] === chave;
    // ADA-4: os frames do turno da conversa vão à faixa (só o turno do pedido muda algo; outro bot ou turno é ignorado).
    if (daConversa && frame.tipo.startsWith("turno.")) despachar({ tipo: "frame", frame, agora: Date.now() });
    // Revisão 7 do #646: a fala nova da conversa durante o envio (ou com o "Não saiu" em dúvida) pode ser o pedido que
    // chegou sem a resposta HTTP.
    const emDuvida = faixa.tipo === "falhou" && faixa.duvida === true;
    if (daConversa && frame.tipo === "mensagem.nova" && typeof d["mensagem_id"] === "string" && (faixa.tipo === "enviando" || emDuvida)) {
      novasDoEnvio.push({ mensagemId: d["mensagem_id"], turnoId: typeof d["turnoId"] === "string" ? d["turnoId"] : null });
      if (faixa.tipo === "falhou") void conferirEnvio(chave, faixa.texto, faixa.fala);
    }
    if (daConversa && (frame.tipo === "mensagem.nova" || frame.tipo === "turno.encerrado" || frame.tipo === "turno.interrompido") && (pedidoSeguido(faixa) !== null || histAberto)) {
      // Com a resposta na faixa e o pedido ainda acompanhado, as falas seguintes do mesmo turno também sobem (a final traz o Desfazer).
      void lerConversa();
    }
  }

  /** NOD-430: abre a tarefa do quadro de `agente`; se a conversa dele ainda não está na tela, espera o sincronizar. */
  function abrirTarefaDe(agente: string, tarefaId: string): void {
    pedidoDoChat = { agenteId: agente, tarefaId };
    abrirPendente();
  }

  function abrirPendente(): void {
    if (!pedidoDoChat || chave === null || agenteId !== pedidoDoChat.agenteId) return;
    const { tarefaId } = pedidoDoChat;
    pedidoDoChat = null;
    // NOD-422: a trilha (tarefa_aberta pelo link) sai quando o quadro do agente chegar (o sincronizar).
    // NOD-445 (merge com o #627): a tarefa abre na página Tarefas da pílula, não na última página da vista (um app).
    const t = paginaDasTarefas();
    // NOD-469: a tarefa aberta pelo link (do chat) não volta a uma rolagem guardada de outra abertura.
    quadroAntesDaTarefa = null;
    if (modo !== "quadro") { marcarAberta(tarefaId, null); trocar("quadro", { pagina: t }); return; }
    // O irPara entre páginas da vista fecha a tarefa aberta: a pedida é marcada depois.
    if (pagina !== t) irPara(t);
    marcarAberta(tarefaId, null);
    desenharVista();
    void lerQuadro();
  }

  /**
   * A tarefa aberta passa a ser `id` (o histórico, a lista do "Mover para…" e os comentários dela são lidos). NOD-422: a
   * trilha da abertura sai já com `via`; sem `via`, fica pendente até o quadro chegar.
   */
  function marcarAberta(id: string, via: "card" | "link" | null): void {
    aberta = id;
    if (via) trilhar(id, via);
    else trilhaPendente = id;
    moverPara = null;
    histAberto = false;
    histTarefa = null;
    const t = tarefaNoQuadro(q, id);
    if (t) dd?.naUrl?.(codigoNaUrl(t));
    void lerHistorico();
    void lerQuadros();
    if (agenteId) { coms.abrir(agenteId, id); trabs.abrir(agenteId, id); }
  }

  function abrirTarefa(id: string, via: "card" | "link" = "link"): void {
    // NOD-469: só a abertura a partir do quadro guarda (de uma tarefa para outra, a guarda do quadro continua a de antes).
    if (!aberta) {
      const v = vista();
      const c = v?.querySelector<HTMLElement>(":scope > .qd-conteudo");
      quadroAntesDaTarefa = v && c && vistaDesenhada ? { vista: vistaDesenhada, de: chave, quadro: q?.id ?? null, rolagem: guardarRolagem(v, c) } : null;
    }
    marcarAberta(id, via);
    desenharVista();
    doc.getElementById("qd-t-tit")?.focus();
    vista()?.scrollTo?.({ top: 0 });
  }

  /** O foco no quadro: o primeiro card à vista; sem card (quadro vazio, aviso), o conteúdo inteiro. */
  function focarNoQuadro(): void {
    const conteudo = vista()?.querySelector<HTMLElement>(":scope > .qd-conteudo");
    if (!conteudo) return;
    const card = [...conteudo.querySelectorAll<HTMLElement>('[data-act="abrir-tarefa"]')].find((e) => e.getClientRects().length > 0);
    if (card) { card.focus(); return; }
    conteudo.tabIndex = -1;
    conteudo.focus();
  }

  /**
   * O anúncio só para o leitor de tela (`.qd-sr`, polite). A região viva nasce vazia no rodapé com o quadro (que a
   * regravação do conteúdo não troca): uma região criada já com o texto não é lida por todo leitor de tela. Revisão 6 do
   * PR #623: esvazia e põe o texto no próximo quadro de animação (o mesmo texto de antes também é lido de novo).
   */
  function anunciar(texto: string): void {
    const el = vista()?.querySelector<HTMLElement>(":scope > .qc-wrap > .qd-anuncio") ?? null;
    const raf = doc.defaultView?.requestAnimationFrame?.bind(doc.defaultView);
    anunciarEm(el, texto, (fn) => (raf ? raf(fn) : setTimeout(fn, 0)));
  }

  function voltarAoQuadro(): void {
    const id = aberta;
    aberta = null;
    leituraHist++;
    dd?.naUrl?.(null);
    coms.fechar();
    trabs.fechar();
    const antes = quadroAntesDaTarefa;
    quadroAntesDaTarefa = null;
    desenharVista();
    const v = vista();
    const c = v?.querySelector<HTMLElement>(":scope > .qd-conteudo");
    // NOD-469: a mesma vista de antes de abrir (página e forma, na mesma conversa e quadro) volta à rolagem guardada; o
    // foco no card não rola (ADA-7).
    if (v && c && antes && antes.vista === vistaDesenhada && antes.de === chave && antes.quadro === (q?.id ?? null)) restaurarRolagem(v, c, antes.rolagem);
    const card = id ? v?.querySelector<HTMLElement>(`.qd-conteudo [data-act="abrir-tarefa"][data-id="${CSS.escape(id)}"]`) : null;
    focarSemRolar(card);
    // Revisão do NOD-469 (a11y): o card fora da vista (a tarefa aberta pelo link, ou que mudou de coluna aberta) vem até
    // ela; o que já está à vista, mesmo cortado na borda, não rola (a rolagem devolvida fica).
    if (card && v && foraDaVista(card, [v, card.closest<HTMLElement>(".qd-grade, .pg-colunas, .qd-cel-cols")])) card.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }

  /** O elemento não aparece em nenhum pedaço de alguma das caixas que o cortam (nem da janela). */
  function foraDaVista(el: HTMLElement, caixas: (HTMLElement | null)[]): boolean {
    const r = el.getBoundingClientRect();
    const janela = doc.defaultView;
    const fora = (b: { left: number; right: number; top: number; bottom: number }): boolean => r.right <= b.left || r.left >= b.right || r.bottom <= b.top || r.top >= b.bottom;
    if (janela && fora({ left: 0, top: 0, right: janela.innerWidth, bottom: janela.innerHeight })) return true;
    return caixas.some((c) => !!c && fora(c.getBoundingClientRect()));
  }

  function mostrar(els: HTMLElement[]): void {
    for (const e of els) {
      e.classList.remove("qd-saiu");
      e.inert = false;
      if (e.id === "quadro") {
        e.hidden = false;
        // Revisão 5 do ADA-5: o rascunho volta com o #quadro escondido (scrollHeight 0); a altura só se mede à vista.
        const ta = e.querySelector<HTMLTextAreaElement>("#qc-txt");
        if (ta?.value) ajustarAltura(ta);
      }
    }
  }
  function esconder(els: HTMLElement[]): void {
    for (const e of els) {
      if (e.id === "quadro") { e.hidden = true; continue; }
      e.classList.add("qd-saiu");
      e.inert = true;
    }
  }

  function marcar(): void {
    if (pagina > 0) ultimaDaVista = pagina;
    const seg = doc.querySelector<HTMLElement>("#cabecalho .qd-seg");
    if (seg) {
      // Segmento recém-desenhado (cabeçalho regravado): nó novo não tem estilo anterior, então o indicador nasce no lugar.
      seg.dataset["atual"] = modo;
      for (const b of seg.querySelectorAll<HTMLElement>('[role="tab"]')) {
        const s = b.dataset["modo"] === modo;
        b.setAttribute("aria-selected", String(s));
        b.tabIndex = s ? 0 : -1;
      }
    }
    // NOD-445: a doca e os pontinhos (nós novos a cada desenho do cabeçalho; marcar de novo não anima nada).
    const pil = doc.querySelector<HTMLElement>("#cabecalho .qd-pil");
    if (pil) pil.dataset["pagina"] = String(pagina);
    for (const b of doc.querySelectorAll<HTMLElement>("#cabecalho .pg-ic")) {
      const s = Number(b.dataset["pagina"]) === pagina;
      if (b.getAttribute("aria-selected") !== String(s)) b.setAttribute("aria-selected", String(s));
      b.tabIndex = s ? 0 : -1;
    }
    for (const p of doc.querySelectorAll<HTMLElement>("#cabecalho .pg-pt")) p.classList.toggle("pg-pt-atual", Number(p.dataset["pagina"]) === pagina);
    if (chegou && Date.now() > chegou.ate) chegou = null;
    for (const e of doc.querySelectorAll<HTMLElement>("#cabecalho .pg-ic, #cabecalho .pg-pt")) e.classList.toggle("pg-chegou", !!chegou && e.dataset["pgId"] === chegou.id);
    doc.querySelector(".stage")?.classList.toggle("qd-no-quadro", modo === "quadro");
    const ativo = doc.activeElement;
    if (abaFocada && !abaFocada.el.isConnected && (!ativo || ativo === doc.body)) focarPagina(abaFocada.pagina);
  }

  /** O leitor de tela ouve a troca de página ("página 2 de 3, Tarefas"); a região mora no body, fora do cabeçalho regravado. */
  function anunciarPagina(texto?: string): void {
    if (paginas.length < 2) return;
    let r = doc.getElementById("pg-anuncio");
    if (!r) {
      r = doc.createElement("div");
      r.id = "pg-anuncio";
      r.className = "sr-only";
      r.setAttribute("aria-live", "polite");
      doc.body.append(r);
    }
    r.textContent = texto ?? anuncioDaPagina(posDe(pagina), paginas.length, paginas[pagina]?.nome ?? "");
  }

  /** A página de dentro é Tarefas (o quadro de verdade)? Sem Tarefas, a vista é só dos apps. */
  const ehTarefas = (i: number): boolean => { const p = paginas[i]; return !p || p.id === TAREFAS.id; };

  /* A ordem da pílula (por agente): a pílula mostra e anda nela; a 1ª posição é a casa, onde o agente abre. */
  const ordem = (): number[] => ordemDoAgente(agenteId, paginas);
  const posDe = (i: number): number => Math.max(0, ordem().indexOf(i));
  const naPos = (pos: number): number => ordem()[presa(pos, paginas.length)] ?? 0;
  /** Leva a página da posição `de` para `para` e guarda; a doca é redesenhada pelo main (`aoMudarOrdem`). */
  function moverPagina(de: number, para: number, op: { foco?: boolean } = {}): void {
    if (!agenteId || chave === null || paginas.length < 2) return;
    const atual = ordem();
    const i = atual[de];
    if (i === undefined) return;
    const nova = moverNaOrdem(atual, de, para);
    if (nova.join() === atual.join()) return;
    guardarOrdem(agenteId, paginas, nova);
    o.aoMudarOrdem?.();
    marcar();
    anunciarPagina(anuncioDaOrdem(paginas[i]?.nome ?? "", nova.indexOf(i), nova.length));
    if (op.foco) focarPagina(i);
  }

  /**
   * NOD-445: ir a uma página. Entre a conversa e uma página da vista é a troca de sempre (`trocar`); entre duas páginas da
   * vista, só o conteúdo desliza (a pílula de baixo e a faixa ficam).
   */
  function irPara(i: number, op: { foco?: boolean } = {}): void {
    if (chave === null || paginas.length < 2) return;
    homePendente = false;
    const alvo = presa(i, paginas.length);
    if (alvo === pagina) { if (op.foco) focarPagina(alvo); return; }
    fecharLeitura();
    const de = pagina;
    if (alvo === 0 || de === 0 || animacoes.length) {
      trocar(alvo === 0 ? "conversa" : "quadro", { ...op, pagina: alvo });
      return;
    }
    pagina = alvo;
    aberturaRegistrada = false;
    aberta = null;
    edicao = null;
    desenharVista();
    if (ehTarefas(alvo) && dd) void lerQuadro();
    marcar();
    anunciarPagina();
    const c = vista()?.querySelector<HTMLElement>(":scope > .qd-conteudo") ?? vista()?.firstElementChild;
    if (c instanceof HTMLElement && typeof c.animate === "function") {
      const mv = movimentoDaTroca(alvo > de ? "ida" : "volta", reduzido());
      c.animate(mv.entra, { duration: mv.ms, easing: mv.curva });
    }
    vista()?.scrollTo?.({ top: 0 });
    if (op.foco) focarPagina(alvo);
  }

  function cancelar(): void {
    vez++;
    for (const a of animacoes) a.cancel();
    animacoes = [];
    saindo = [];
    entrando = [];
  }

  /** Sem animação: o estado final do modo atual. */
  function assentar(): void {
    const v = vista();
    if (modo === "quadro") { mostrar(v ? [v] : []); esconder(conversa()); }
    else { mostrar(conversa()); esconder(v ? [v] : []); }
    marcar();
  }

  function trocar(para: ModoDaConversa, op: { foco?: boolean; pagina?: number } = {}): void {
    homePendente = false;
    const direcao = chave === null ? null : direcaoDaTroca(modo, para);
    // A página que vai ficar: a pedida, ou (pelo `trocar("quadro")` de fora) a última da vista, Tarefas na primeira vez.
    const alvo = para === "conversa" ? 0 : presa(op.pagina ?? (pagina || ultimaDaVista), Math.max(2, paginas.length));
    const focar = (): void => { if (op.foco) focarPagina(pagina); };
    if (direcao) fecharLeitura();
    if (!direcao) {
      if (para === "quadro" && alvo !== pagina && chave !== null) { irPara(alvo, op); return; }
      if (op.foco) focarPagina(pagina);
      return;
    }
    if (para === "conversa" || !ehTarefas(alvo)) aberturaRegistrada = false;
    if (animacoes.length) {
      // Volta no meio: a mesma animação anda para trás, do ponto onde está; quem saía passa a entrar.
      modo = para;
      const outra = alvo !== pagina && para === "quadro";
      pagina = alvo;
      trilharAbertura();
      if (outra) desenharVista();
      marcar();
      anunciarPagina();
      avisarTroca(para);
      [saindo, entrando] = [entrando, saindo];
      for (const e of saindo) e.inert = true;
      for (const e of entrando) e.inert = false;
      for (const a of animacoes) a.reverse();
      focar();
      return;
    }
    cancelar();
    const v = vista();
    if (!v) return;
    const outraPagina = para === "quadro" && alvo !== pagina;
    pagina = alvo;
    if (para === "quadro" && (!v.firstElementChild || outraPagina || v.dataset["pagina"] !== paginas[pagina]?.id)) desenharVista();
    if (para === "quadro" && dd && ehTarefas(pagina)) void lerQuadro();
    modo = para;
    trilharAbertura();
    marcar();
    anunciarPagina();
    // Depois de `modo = para`: quem ouve (o main, que marca a conversa como lida na volta) já vê o modo novo.
    avisarTroca(para);
    const sai = para === "quadro" ? conversa() : [v];
    const entra = para === "quadro" ? [v] : conversa();
    saindo = sai;
    entrando = entra;
    mostrar([...sai, ...entra]);
    for (const e of sai) e.inert = true;
    const mv = movimentoDaTroca(direcao, reduzido());
    const pode = typeof v.animate === "function";
    if (!pode) { assentar(); if (op.foco) focarPagina(pagina); return; }
    const opcoes: KeyframeAnimationOptions = { duration: mv.ms, easing: mv.curva };
    animacoes = [...sai.map((e) => e.animate(mv.sai, opcoes)), ...entra.map((e) => e.animate(mv.entra, opcoes))];
    const minha = vez;
    const fim = (): void => {
      if (minha !== vez) return;
      animacoes = [];
      saindo = [];
      entrando = [];
      assentar();
    };
    void Promise.all(animacoes.map((a) => a.finished)).then(fim, fim);
    if (op.foco) focarPagina(pagina);
  }

  /** O app que acabou de chegar acende por um instante (o cabeçalho é regravado: a marca vai de novo a cada desenho). */
  let chegou: { id: string; ate: number } | null = null;

  function focarPagina(i: number): void {
    doc.querySelector<HTMLElement>(`#cabecalho .pg-ic[data-pagina="${i}"]`)?.focus();
  }

  /** Abre a casa do agente sem animação (só chamada com a conversa à vista e nada animando). */
  function irParaCasa(): void {
    const v = vista();
    const casa = chave === null ? 0 : (ordem()[0] ?? 0);
    if (casa > 0 && v) {
      pagina = casa;
      ultimaDaVista = casa;
      modo = "quadro";
      desenharVista();
      if (ehTarefas(casa) && dd) void lerQuadro();
    }
  }

  function sincronizar(s: { chave: string | null; nome: string; agenteId?: string | null; paginas?: readonly Pagina[] }): void {
    // NOD-430 (revisão 1 do PR #627): a conversa do dono da tarefa pedida chegou sem quadro (excluído): o pedido cai aqui,
    // senão a tarefa velha abriria sozinha quando ele ganhasse um quadro novo.
    if (pedidoDoChat && s.chave === null && s.agenteId === pedidoDoChat.agenteId) pedidoDoChat = null;
    // Fora de uma conversa com quadro, e já sem quadro: nada a mexer (o palco é de outra tela).
    if (s.chave === null && chave === null) return;
    const assinatura = (ps: readonly Pagina[]): string => ps.map((p) => `${p.id}${p.pedeVoce ? "!" : ""}${p.apagado ? "~" : ""}${p.app ? `@${p.app.atualizadoEm}` : ""}`).join();
    if (s.paginas && assinatura(s.paginas) !== assinatura(paginas)) {
      const idAtual = paginas[pagina]?.id;
      const idUltima = paginas[ultimaDaVista]?.id;
      paginas = s.paginas.length ? s.paginas : [CONVERSA];
      if (chave === s.chave) {
        // A página à vista segue pelo id; se ela sumiu (app removido), volta para a conversa.
        const i = indicePeloId(paginas, idAtual);
        if (i < 0) {
          // O app à vista saiu (removido em outro aparelho): volta à conversa e avisa quem ouve, como numa troca.
          const estava = modo;
          cancelar();
          pagina = 0;
          modo = "conversa";
          // Fora do desenho em curso (o main desenha de novo ao ouvir a volta): numa microtarefa, se nada mudou no meio.
          const c = chave;
          if (estava !== "conversa") queueMicrotask(() => { if (c === chave && modo === "conversa") avisarTroca("conversa"); });
        } else pagina = i;
        const u = indicePeloId(paginas, idUltima);
        ultimaDaVista = u > 0 ? u : 1;
        // O retrato do app à vista mudou: redesenha.
        if (modo === "quadro" && paginas[pagina]?.app && vista()?.firstElementChild) desenharVista();
      }
    }
    // O esqueleto é só da leitura em curso: acabou (com ou sem novidade), o app vazio volta à frase e ao exemplo.
    if (s.chave === chave && modo === "quadro" && paginas[pagina]?.app && vista()?.querySelector('.pg-app[aria-busy="true"]') && !(agenteId !== null && o.paginas?.lendo?.(agenteId))) desenharVista();
    if (s.chave !== chave) {
      cancelar();
      zerarDados();
      agenteId = s.chave === null ? null : (s.agenteId ?? null);
      chave = s.chave;
      modo = "conversa";
      aberturaRegistrada = false;
      viaDaAbertura = "tela";
      pagina = 0;
      ultimaDaVista = 1;
      filtro = "todos";
      busca = "";
      maisAberto = exibirAberto = false;
      nova = null;
      alternadas = new Set();
      edicao = null;
      const v = vista();
      if (v) v.innerHTML = "";
      // A casa do agente (1ª posição da pílula) não é a conversa: ele abre direto nela, sem animação.
      homePendente = chave !== null && !paginasDtoDe(agenteId);
      if (!homePendente) irParaCasa();
    } else if (homePendente && paginasDtoDe(agenteId)) {
      // As páginas chegaram depois de a conversa abrir e a pessoa ficou onde estava: a casa vale agora.
      homePendente = false;
      if (modo === "conversa" && pagina === 0 && !animacoes.length) irParaCasa();
    }
    if (s.nome !== nome) { nome = s.nome; if (vista()?.firstElementChild) desenharVista(); }
    // No meio de uma animação o estado é dela; só o segmento (o cabeçalho pode ter sido regravado) é remarcado.
    if (animacoes.length) marcar();
    else assentar();
    // O link que chegou antes do quadro liberado: abre agora, na conversa do bot dele; em outra conversa, é esquecido.
    if (pendente && chave !== null) {
      if (pendente.agenteId !== agenteId) { pendente = null; avisoDoMover = null; }
      else if (modo !== "quadro") trocar("quadro");
    }
    abrirPendente();
    abrirPaginaPedida();
  }

  // ADA-18 (S9): o toque longo na linha do celular. Só dedo (o mouse tem o clique); rolar ou mexer cancela.
  const linhaDoToque = (alvo: EventTarget | null): HTMLElement | null =>
    alvo instanceof Element ? alvo.closest<HTMLElement>("#quadro .qd-cel .qd-cl[data-tarefa]") : null;
  doc.addEventListener("pointerdown", (ev) => {
    const li = ev.pointerType === "mouse" ? null : linhaDoToque(ev.target);
    if (li && noCelular() && !(ev.target as Element).closest("input, textarea, select, .qd-card-resp")) toque.comecar(li.dataset["tarefa"] ?? "", ev.clientX, ev.clientY);
  }, { passive: true });
  doc.addEventListener("pointermove", (ev) => { toque.mover(ev.clientX, ev.clientY); }, { passive: true });
  doc.addEventListener("pointerup", () => { toque.soltar(); }, { passive: true });
  doc.addEventListener("pointercancel", () => { toque.soltar(); }, { passive: true });
  // O clique que o navegador manda ao soltar não abre a tarefa; o menu do sistema (Android) não aparece sobre a linha.
  // O clique de soltar cai onde o dedo estava: já sobre o fundo da folha que abriu (não na linha). Engole qualquer alvo.
  doc.addEventListener("click", (ev) => { if (toque.engolirClique()) { ev.preventDefault(); ev.stopImmediatePropagation(); } }, { capture: true });
  doc.addEventListener("contextmenu", (ev) => { if (noCelular() && linhaDoToque(ev.target)) ev.preventDefault(); });

  // ADA-18: a rolagem do carrossel de colunas do celular acende o ponto da coluna à vista (scroll não sobe: captura).
  doc.addEventListener("scroll", (ev) => {
    toque.soltar();
    const el = ev.target;
    if (el instanceof HTMLElement && el.classList.contains("qd-cel-cols") && el.parentElement) atualizarPontos(el.parentElement);
  }, { capture: true, passive: true });

  // As ações do segmento e do quadro vazio moram aqui, não no mapa de ações do main: são só da tela.
  doc.addEventListener("click", (ev) => {
    const alvo = ev.target as Element | null;
    // Clicar no quadro recolhe o histórico da faixa (passo 9).
    if (histAberto && alvo?.closest?.("#quadro .qd-conteudo")) { histAberto = false; desenharFaixa(); }
    if (lendo && alvo?.closest?.("#quadro .qd-conteudo")) alternarLeitura({ focar: false });
    if (engolirClique) { engolirClique = false; ev.preventDefault(); ev.stopPropagation(); return; }
    // NOD-448: clicar fora do menu ou do popover fecha (a coluna nova e a folha fecham pelo Cancelar, Pronto ou Esc).
    const solta = edicao?.tipo === "menu" || edicao?.tipo === "passagem" || edicao?.tipo === "trava" || edicao?.tipo === "mover" || (edicao?.tipo === "remover" && !edicao.naFolha);
    if (solta && alvo?.closest?.("#quadro") && !alvo.closest(".qd-menu, .qd-pop, .qd-col-mais, .qd-col-passa, .qd-card-mover")) { edicao = null; desenharVista(); }
    // NOD-460: clicar fora do "+N" ou do Exibir fecha o menu.
    // Revisão do PR #645: quando o clique tem ação, ela redesenha (redesenhar antes soltaria o alvo do DOM e o clique se
    // perderia); sem ação, ou se a ação não redesenhou, o menu fecha aqui.
    if ((maisAberto || exibirAberto) && !alvo?.closest?.(".qd-chip-mais-l, .qd-exibir-l")) {
      maisAberto = exibirAberto = false;
      if (!alvo?.closest?.("#quadro [data-act]")) { if (vista()?.firstElementChild) desenharVista(); }
      else queueMicrotask(() => { if (vista()?.querySelector("#qd-menu-exibir, #qd-menu-agentes")) desenharVista(); });
    }
    // Quadro minimalista: o clique fora do funil, das Opções ou da pílula fecha o popover (como o do Exibir acima).
    if (dd && barraUi.aoClicarFora(alvo)) {
      if (!alvo?.closest?.("#quadro [data-act]")) { if (vista()?.firstElementChild) desenharVista(); }
      else queueMicrotask(() => { if (vista()?.querySelector(".qm-pop")) desenharVista(); });
    }
    const el = alvo?.closest?.<HTMLElement>("[data-act]");
    if (!el) return;
    const act = el.dataset["act"];
    if (dd && el.closest("#quadro") && !(noCelular() && el.closest(".qd-cel-folha")) && barraUi.aoClicar(el, act)) return;
    if (dd && el.closest("#quadro")) {
      // ADA-18: as folhas do celular primeiro; as ações do quadro de dentro delas fecham a folha e seguem abaixo.
      if (noCelular() && cel.aoClicar(el, act)) return;
      const id = el.dataset["id"] ?? "";
      if (act === "abrir-tarefa" && id) { abrirTarefa(id, "card"); return; }
      if (act === "tarefa-mover" || act === "tarefa-mover-para") { aoMoverCard(el, act); return; }
      if (act === "voltar-ao-quadro") { voltarAoQuadro(); return; }
      if (act === "cel-folha" && id) { abrirFolhaDaTarefa(el.dataset["folha"] ?? "", id); return; }
      if (act === "cel-tentar") { const n = naoSalvouCel; naoSalvouCel = null; if (n) n.refazer(); else desenharVista(); return; }
      if (act === "cel-responder") { responderA(el.dataset["com"] ?? ""); return; }
      if (act === "cel-responder-sair") { const de = aberta; respondendo = null; desenharVista(); focarSemRolar(doc.getElementById(`qd-com-${de ?? ""}`)); return; }
      if (act?.startsWith("trab-") && trabs.aoClicar(act)) return;
      // 0159: tirar uma label e limpar o prazo da tarefa aberta.
      if (act === "label-tirar" && id) { const nome = tarefaNoQuadro(q, id)?.labels?.find((l) => l.id === el.dataset["label"])?.nome ?? "label"; mudarLabelOuPrazo(id, { tirar_labels: [el.dataset["label"] ?? ""] }, `tirou ${nome}`, el.closest(".qd-tarefa-cel") ? "qd-t-label-cel" : "qd-t-label-lado"); return; }
      if (act === "prazo-tarefa-limpar" && id) { mudarLabelOuPrazo(id, { prazo_em: null }, "sem prazo", el.closest(".qd-tarefa-cel") ? "qd-t-prazo-em-cel" : "qd-t-prazo-em-lado"); return; }
      // 2026-11-10: a linha do tempo e a lateral da tarefa aberta (thread, chips, editar/apagar, runs, seções).
      if (act && aberta && coms.aoClicar(act, el, doc)) return;
      if (act === "mover-quadro" && id) {
        const destino = el.closest(".qd-mover")?.querySelector<HTMLSelectElement>('[data-campo="mover"]')?.value ?? "";
        if (destino) void moverDeQuadro(id, destino);
        return;
      }
      if (act === "qd-reler") { carga = "nada"; void lerQuadro(); return; }
      if (act === "quadro-seletor") { void abrirSeletor(!selAberto); return; }
      if (act === "quadro-seletor-fechar") { void abrirSeletor(false); return; }
      if (act === "quadro-escolher" && id) { void escolherQuadro(id); return; }
      if (act === "quadro-novo") { selCriando = { tipo: "quadro", projeto: null }; selErro = null; desenharVista(); focarNaVista("#qd-qs-novo-in"); return; }
      if (act === "projeto-novo") { selCriando = { tipo: "projeto" }; selErro = null; desenharVista(); focarNaVista("#qd-qs-novo-in"); return; }
      if (act === "quadro-novo-cancelar") { selCriando = null; selErro = null; desenharVista(); focarNaVista('[data-act="quadro-novo"]'); return; }
      if (act === "editar-meta") { editarMeta(true); return; }
      if (act === "remover-quadro") { void removerQuadro(); return; }
      if (act === "trazer-linear") { painelImportacao({ fase: "time", time: "", filtro: null }); return; }
      if (act === "importar-fechar") { painelImportacao(null); return; }
      if (act === "importar-confirmar") { void confirmarImportacao(); return; }
      if (act === "importar-sem-backlog" && importando) { void lerPreviaImportacao(importando.time, "sem_backlog"); return; }
      if (act === "qc-desfazer" && id) { void desfazer(id); return; }
      // ADA-6: o cartão-mensagem, o Mover do recibo e as sugestões da pílula.
      if (act === "qc-ler") { alternarLeitura(); return; }
      if (act === "qc-mover" && id && el.dataset["coluna"]) {
        // Revisão 2 (M1/M2): o Mover do recibo é o mesmo soltar do card (trava, recibo do mover) e confere a tarefa agora: a que já saiu de Não iniciado (o bot ou outro aparelho a levou) não volta.
        // QA 1: o quadro local pode estar velho (a releitura do frame espera o campo focado ou o dedo na tela): relê antes.
        const col = el.dataset["coluna"]; const ch = chave; const de = agenteId;
        void lerQuadro().then(() => {
          if (ch !== chave || de !== agenteId) return;
          const c = colunaDe(col);
          const t = q?.tarefas.find((x) => x.id === id);
          if (!c || !t || t.status === c.id || colunaDe(t.status)?.grupo !== "nao_iniciado") {
            mudarFaixa({ tipo: "erro", texto: t ? `${t.codigo ?? "A tarefa"} já saiu de onde estava; nada foi movido.` : "Essa tarefa não está mais no quadro." });
            return;
          }
          pessoaSolta(id, c);
        });
        return;
      }
      if (act === "qc-ideia") {
        const txt = doc.getElementById("qc-txt");
        if (txt instanceof HTMLTextAreaElement && !txt.value.trim()) { txt.value = el.dataset["texto"] ?? ""; desenharIdeias(); txt.focus(); txt.setSelectionRange(txt.value.length, txt.value.length); }
        return;
      }
      // Revisão 1 do #646: o "Tentar de novo" some no redesenho; o foco vai ao campo (não cai no body).
      if (act === "qc-tentar") { tentarDeNovo(); (doc.getElementById("qc-txt") as HTMLElement | null)?.focus(); return; }
      if (act === "com-tentar") {
        const de = agenteId;
        const ida = coms.tentar(doc);
        if (aberta) (doc.getElementById(`qd-com-${aberta}`) as HTMLElement | null)?.focus();
        void ida.then((r) => { if (r && de === agenteId) aplicarQuadro(r.quadro, aberta ? [aberta] : []); });
        return;
      }
      if (act === "qc-parar") { void pararPedido(); return; }
      if (act === "painel-pessoas") { abrirPainel("pessoas"); return; }
      if (act === "painel-atividade") { abrirPainel("atividade"); return; }
      if (act === "tirar-pessoa" && id) {
        const quem = q?.membros?.find((m) => m.pessoaId === id)?.nome ?? "A pessoa";
        void mexerNasPessoas((a, de) => a.tirarPessoa?.(de, id), `${quem} saiu do quadro`, '.qd-conteudo [data-act="painel-pessoas"]');
        return;
      }
      if (act === "tarefa-desfazer-movimento" && id) { desfazerMovimento(id); return; }
      if (act === "tarefa-mandar" && id) { const r = recusa; tirarRecusa(); const c = r?.tarefa === id ? colunaDe(r.destino) : null; if (c) pessoaSolta(id, c); return; }
      if (act === "qc-historico") {
        histAberto = !histAberto;
        lendo = false;
        if (timerRecolher && histAberto) { clearTimeout(timerRecolher); timerRecolher = null; }
        // Revisão M5: fechar o histórico volta a contar o recolher da resposta.
        if (!histAberto && faixa.tipo === "resposta") agendarRecolher();
        desenharFaixa();
        doc.querySelector<HTMLElement>('#qc-faixa [data-act="qc-historico"]')?.focus();
        if (histAberto) void lerConversa();
        return;
      }
      if (act === "qc-abrir-conversa") { histAberto = false; desenharFaixa(); trocar("conversa", { foco: true }); return; }
      if (aoClicarNaBarra(el, act)) return;
      if (act?.startsWith("col-")) { aoClicarColuna(el, act); return; }
      // Clique simples no nome de uma coluna que edita: espera o duplo (que renomeia) antes de recolher.
      if (act === "abrir-coluna" && el.matches(".qd-col-bt[aria-keyshortcuts]") && ev.detail >= 1) {
        if (timerClique) clearTimeout(timerClique);
        if (ev.detail >= 2) { timerClique = null; editar({ tipo: "renomear", coluna: el.dataset["coluna"] ?? "" }); return; }
        timerClique = setTimeout(() => { timerClique = null; if (el.isConnected) alternarColuna(el); }, 260);
        return;
      }
    }
    if (act === "pagina" && el.closest("#cabecalho")) {
      irPara(Number(el.dataset["pagina"]));
    } else if (act === "forma-das-tarefas" && el.closest("#quadro")) {
      const f = el.dataset["forma"];
      if (ehForma(f) && f !== forma) { forma = f; desenharVista(); vista()?.querySelector<HTMLElement>(`[data-act="forma-das-tarefas"][data-forma="${f}"]`)?.focus(); }
    } else if (act === "modo-da-conversa" && el.closest("#cabecalho")) {
      const m = el.dataset["modo"];
      if (ehModo(m)) trocar(m);
    } else if (el.closest("#quadro") && (act === "abrir-coluna" || act === "filtro-do-quadro")) {
      if (act === "filtro-do-quadro") escolherFiltro(el.dataset["filtro"]);
      else alternarColuna(el);
    }
  });

  /* ---------- NOD-460: a barra (filtro, busca, Exibir) e o "+" por coluna ---------- */
  /** O Exibir que vale neste quadro: o que a pessoa guardou (ou mudou aqui); sem nada, o padrão. */
  function exibirDoQuadro(): ExibirDoQuadro {
    lerExibirGuardado();
    return (q && exibirPorQuadro[q.id]) || EXIBIR_PADRAO;
  }

  /** Uma vez por tela: o Exibir guardado. O que a pessoa mudou antes de ele chegar vale por cima. */
  function lerExibirGuardado(): void {
    const a = dd?.api();
    if (exibirPedido || !a?.preferencias) return;
    exibirPedido = true;
    // Revisão do PR #645: uma leitura só; se falhar, vale o padrão (sem repetir o pedido a cada desenho). Com uma tarefa
    // aberta, o Exibir não aparece: o próximo desenho do quadro já o usa.
    void a.preferencias().then((p) => {
      const guardado = p.quadroExibir ?? {};
      const antes = q ? exibirPorQuadro[q.id] ?? EXIBIR_PADRAO : null;
      exibirPorQuadro = { ...guardado, ...exibirPorQuadro };
      const depois = q ? exibirPorQuadro[q.id] ?? EXIBIR_PADRAO : null;
      if (q && !aberta && JSON.stringify(antes) !== JSON.stringify(depois) && vista()?.firstElementChild) desenharVista();
    }, () => { /* sem as preferências, o padrão */ });
  }

  /**
   * Revisão do PR #700: o chat também muda o Exibir (gerir_quadro exibir, ADR-135) e não há frame disso. Quando um turno
   * termina, relê o Exibir deste quadro depois das gravações da tela; o do servidor vale, a não ser que a pessoa tenha
   * mudado algo aqui durante o pedido (a versão local mudou: o que ela escolheu vence e já está na fila).
   */
  function relerExibir(): void {
    const a = dd?.api();
    if (!q || !a?.preferencias) return;
    const quadroId = q.id;
    const versao = versaoDoExibir;
    void gravacaoDoExibir.then(() => a.preferencias!()).then((p) => {
      const doServidor = p.quadroExibir?.[quadroId];
      if (!doServidor || versao !== versaoDoExibir || q?.id !== quadroId) return;
      const antes = exibirPorQuadro[quadroId] ?? EXIBIR_PADRAO;
      exibirPorQuadro = { ...exibirPorQuadro, [quadroId]: doServidor };
      if (!aberta && JSON.stringify(antes) !== JSON.stringify(doServidor) && vista()?.firstElementChild) desenharVista();
    }, () => { /* fica o que a tela tem */ });
  }

  /**
   * Revisão do PR #700 (plano §7): a folha do celular é aria-modal e prende o foco; o Tab na última (ou o Shift+Tab na
   * primeira), ou vindo de fora dela, volta para dentro em vez de ir ao quadro atrás.
   */
  function prenderFocoNaFolha(ev: KeyboardEvent): void {
    const f = vista()?.querySelector<HTMLElement>(".qd-cel-folha");
    if (!f) return;
    const focaveis = [...f.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])')]
      .filter((e) => e.getClientRects().length);
    const i = focaveis.indexOf(doc.activeElement as HTMLElement);
    if (i !== -1 && (ev.shiftKey ? i > 0 : i < focaveis.length - 1)) return;
    ev.preventDefault();
    const alvo = ev.shiftKey ? focaveis.at(-1) : focaveis[0];
    focarSemRolar(alvo ?? f);
  }

  const focarNaVista = (seletor: string): void => { const e = vista()?.querySelector<HTMLElement>(seletor); if (e) focarSemRolar(e); };

  /** Diz a quem não vê quantas tarefas o filtro e a busca deixaram (a região viva do rodapé). */
  function anunciarVista(): void {
    if (!q) return;
    // A linha do vazio, quando há, é o que se diz (inclusive o "N em colunas recolhidas").
    const vazia = vista()?.querySelector(".qd-vazio-1 span")?.textContent;
    if (vazia) { anunciar(vazia); return; }
    const n = contarNaVista(q.tarefas, filtro, termoDaBusca(busca), comColunas(q).colunas);
    anunciar(filtro === "todos" && !busca.trim() ? `Todas as ${n === 1 ? "tarefa" : "tarefas"} à vista: ${n}.` : n === 0 ? "Nenhuma tarefa com esse filtro." : `${n} ${n === 1 ? "tarefa" : "tarefas"} à vista.`);
  }

  function escolherFiltro(f: string | undefined): void {
    if (!ehFiltro(f)) return;
    // Clicar no chip ligado volta a Todas.
    filtro = f === filtro && f !== "todos" ? "todos" : f;
    maisAberto = exibirAberto = false;
    desenharVista();
    focarNaVista(`.qd-barra-q [data-act="filtro-do-quadro"][data-filtro="${CSS.escape(filtro)}"]`);
    anunciarVista();
  }

  /** Revisão do PR #645: a busca anuncia a contagem quando a pessoa para de digitar, não a cada letra. */
  let timerAnuncioBusca: ReturnType<typeof setTimeout> | null = null;
  function mudarBusca(texto: string, foco = true): void {
    if (texto === busca) return;
    busca = texto;
    desenharVista();
    if (foco) focarNaVista("#qd-busca");
    if (timerAnuncioBusca) clearTimeout(timerAnuncioBusca);
    timerAnuncioBusca = setTimeout(() => { timerAnuncioBusca = null; if (q) anunciarVista(); }, 400);
  }

  function abrirNova(el: HTMLElement): void {
    const st = el.dataset["status"] ?? "";
    const estreito = !!el.closest(".qd-so-estreito");
    if (!st) return;
    nova = nova?.coluna === st && !!nova.estreito === estreito ? null : { coluna: st, estreito };
    edicao = null;
    desenharVista();
    if (nova) focarNaVista(`#${CSS.escape(idDaNovaTarefa(st, estreito ? "lista" : "grade"))}`);
    else focarNaVista(`${estreito ? ".qd-so-estreito" : ".qd-so-largo"} [data-act="col-nova-tarefa"][data-status="${CSS.escape(st)}"]`);
  }

  function fecharNova(): void {
    if (!nova) return;
    const { coluna, estreito } = nova;
    nova = null;
    desenharVista();
    // A tarefa criada pode mudar o padrão da coluna (o Backlog vazio nasce recolhido) e a alternância a recolheria: quem
    // acabou de criar nela continua vendo a coluna aberta.
    const mais = `${estreito ? ".qd-so-estreito" : ".qd-so-largo"} [data-act="col-nova-tarefa"][data-status="${CSS.escape(coluna)}"]`;
    if (!vista()?.querySelector(mais)) { if (alternadas.has(coluna)) alternadas.delete(coluna); else alternadas.add(coluna); desenharVista(); }
    focarNaVista(mais);
  }

  /**
   * Quadro minimalista (2026-11-10): muda qualquer campo do Exibir deste quadro (as Opções, as tiras, o compacto). A tela
   * mostra na hora; o servidor guarda na mesma fila do Exibir (só os campos que mudaram). A falha avisa e vale nesta tela.
   */
  function mudarExibir(m: Partial<ExibirDoQuadro>): void {
    if (!q) return;
    const quadroId = q.id;
    exibirPorQuadro = { ...exibirPorQuadro, [quadroId]: { ...exibirDoQuadro(), ...m } };
    versaoDoExibir++;
    desenharVista();
    const a = dd?.api();
    if (!a?.exibirQuadro) return;
    const gravar = gravacaoDoExibir.then(() => a.exibirQuadro!(quadroId, m));
    gravacaoDoExibir = gravar.then(() => undefined, () => undefined);
    gravar.catch(() => { if (q?.id === quadroId) mudarFaixa({ tipo: "erro", texto: "Não consegui guardar as opções do quadro. Elas valem só nesta tela." }); });
  }

  async function alternarExibir(chave: string | undefined): Promise<void> {
    if ((chave !== "recolhidas" && chave !== "compacto") || !q) return;
    const atual = exibirDoQuadro();
    const novo: ExibirDoQuadro = { ...atual, [chave]: !atual[chave] };
    const quadroId = q.id;
    // A tela já mostra o novo; o servidor só guarda (a falha avisa, e o Exibir vale nesta tela até ela fechar).
    exibirPorQuadro = { ...exibirPorQuadro, [quadroId]: novo };
    versaoDoExibir++;
    desenharVista();
    focarNaVista(`#qd-menu-exibir [data-chave="${chave}"]`);
    const a = dd?.api();
    if (!a?.exibirQuadro) return;
    // Revisão do PR #645: as gravações vão em fila, para a última escolha chegar por último ao servidor.
    const gravar = gravacaoDoExibir.then(() => a.exibirQuadro!(quadroId, { recolhidas: novo.recolhidas, compacto: novo.compacto }));
    gravacaoDoExibir = gravar.then(() => undefined, () => undefined);
    try { await gravar; }
    catch { if (q?.id === quadroId) mudarFaixa({ tipo: "erro", texto: "Não consegui guardar o Exibir. Ele vale só nesta tela." }); }
  }

  /**
   * ADA-18: troca a visão do celular. A tela muda na hora; o servidor guarda no Exibir do quadro, na mesma fila do Exibir.
   * A falha é silenciosa (a visão vale nesta tela até ela fechar; não é um dado do quadro).
   */
  function trocarVisao(v: VisaoDoQuadro): void {
    if (!q) return;
    const quadroId = q.id;
    exibirPorQuadro = { ...exibirPorQuadro, [quadroId]: { ...exibirDoQuadro(), visao: v } };
    versaoDoExibir++;
    desenharVista();
    const a = dd?.api();
    if (!a?.exibirQuadro) return;
    const gravar = gravacaoDoExibir.then(() => a.exibirQuadro!(quadroId, { visao: v }));
    gravacaoDoExibir = gravar.then(() => undefined, () => undefined);
  }

  /** As ações da barra e do "+" da coluna; true = tratou. */
  function aoClicarNaBarra(el: HTMLElement, act: string | undefined): boolean {
    if (act === "filtro-mais-agentes") { maisAberto = !maisAberto; exibirAberto = false; desenharVista(); focarNaVista(maisAberto ? "#qd-menu-agentes .qd-menu-it" : '[data-act="filtro-mais-agentes"]'); return true; }
    if (act === "busca-limpar") { mudarBusca(""); return true; }
    if (act === "exibir-abrir") { exibirAberto = !exibirAberto; maisAberto = false; desenharVista(); focarNaVista(exibirAberto ? "#qd-menu-exibir .qd-menu-it" : '[data-act="exibir-abrir"]'); return true; }
    if (act === "exibir-alternar") { void alternarExibir(el.dataset["chave"]); return true; }
    if (act === "col-nova-tarefa") { abrirNova(el); return true; }
    return false;
  }

  function alternarColuna(el: HTMLElement): void {
    const st = el.dataset["status"];
    if (st) { if (alternadas.has(st)) alternadas.delete(st); else alternadas.add(st); }
    const lugar = el.closest(".qd-so-estreito") ? ".qd-so-estreito" : ".qd-so-largo";
    if (edicao?.tipo === "menu") edicao = null;
    desenharVista();
    vista()?.querySelector<HTMLElement>(`${lugar} [data-act="abrir-coluna"][data-status="${CSS.escape(st ?? "")}"]`)?.focus();
  }

  /** ADR-142: o "Mover para…" do card. Coluna com responsável que aciona pede a mesma confirmação do card solto; as outras movem direto. */
  function aoMoverCard(el: HTMLElement, act: string): void {
    const tarefa = el.dataset["tarefa"] ?? "";
    if (act === "tarefa-mover") {
      const aberto = edicao?.tipo === "mover" && edicao.tarefa === tarefa;
      editar(aberto ? null : { tipo: "mover", tarefa, ...(el.closest(".qd-so-estreito") ? { estreito: true } : {}) }, aberto ? `[data-act="tarefa-mover"][data-tarefa="${CSS.escape(tarefa)}"]` : undefined);
      return;
    }
    if (el.getAttribute("aria-disabled") === "true") { const porque = el.getAttribute("title"); if (porque) mudarFaixa({ tipo: "erro", texto: porque }); return; }
    const c = colunaDe(el.dataset["coluna"]);
    if (!c) return;
    pessoaSolta(tarefa, c);
  }

  /**
   * A pessoa solta a tarefa numa coluna (o arrasto ou o "Mover para…"). A trava recusa no próprio card, com o "Mandar
   * para…"; o resto move direto (2026-11-10: entrar na coluna com responsável já aciona; o Desfazer é a rede).
   */
  function pessoaSolta(tarefa: string, c: NonNullable<ReturnType<typeof colunaDe>>): void {
    const t = q?.tarefas.find((x) => x.id === tarefa);
    const r = decidirSoltura(q?.colunas ?? [], t, c);
    if (r.tipo === "recusa") {
      tirarRecusa();
      recusa = { tarefa, destino: r.destino.id, aviso: { texto: r.texto, acao: `Mandar para ${r.destino.nome}`, recusa: true, act: "tarefa-mandar", id: tarefa } };
      // Revisão 9: no gesto (ou no arrasto) a recusa não sai pelo tempo: a saída regrava a vista; conta de novo.
      relogio = relogioDaRecusa(RECUSA_MS, () => { relogio = null; sairDaRecusa(); }, () => naRecusa(doc.activeElement) || !!cardDaRecusa()?.matches(":hover") || gestoAtivo() || arrastando());
      edicao = null;
      desenharVista();
      focarSemRolar(visivel(vista() ?? doc, `[data-act="tarefa-mandar"][data-id="${CSS.escape(tarefa)}"]`));
      return;
    }
    tirarRecusa();
    moverTarefa(tarefa, c.id);
  }

  function tirarRecusa(): void {
    relogio?.parar();
    relogio = null;
    recusa = null;
  }

  /** O card que tem a recusa, se o elemento está nele. */
  const naRecusa = (alvo: EventTarget | null): boolean =>
    !!recusa && !!(alvo as Element | null)?.closest?.(`#quadro li[data-tarefa="${CSS.escape(recusa.tarefa)}"].qd-com-aviso`);
  const cardDaRecusa = (): Element | null =>
    recusa ? visivel(vista() ?? doc, `li[data-tarefa="${CSS.escape(recusa.tarefa)}"].qd-com-aviso`) : null;

  /** A recusa sai (o tempo ou o Esc). Se o foco estava nela (ou caiu no vazio), volta ao card, não ao começo da página. */
  function sairDaRecusa(): void {
    const tarefa = recusa?.tarefa;
    const ativo = doc.activeElement;
    const tinhaFoco = naRecusa(ativo) || !ativo || ativo === doc.body;
    tirarRecusa();
    desenharVista();
    // Revisão 9: o foco devolvido não rola a vista (a pessoa pode ter rolado nos 8 s da recusa).
    if (tarefa && tinhaFoco) focarSemRolar(visivel(vista() ?? doc, `[data-act="abrir-tarefa"][data-id="${CSS.escape(tarefa)}"]`));
  }

  /** O Desfazer de um movimento (o eco do agente no card, ou o último do histórico da tarefa aberta). */
  function desfazerMovimento(movimento: string): void {
    const t = q?.tarefas.find((x) => x.movimentos?.some((m) => m.id === movimento));
    const m = t?.movimentos?.find((x) => x.id === movimento);
    if (!t || !m) return;
    void mexer((a, de) => a.desfazerMovimento?.(de, t.id, movimento), `${t.titulo} voltou para ${colunaDe(m.de)?.nome ?? m.de}`);
  }

  function aoClicarColuna(el: HTMLElement, act: string): void {
    const id = el.dataset["coluna"] ?? "";
    const folha = !!el.closest(".qd-folha");
    const desabilitado = el.getAttribute("aria-disabled") === "true";
    if (desabilitado) { const porque = el.getAttribute("title"); if (porque) mudarFaixa({ tipo: "erro", texto: porque }); return; }
    if (act === "col-menu") { editar(edicao?.tipo === "menu" && edicao.coluna === id ? null : { tipo: "menu", coluna: id }); return; }
    if (act === "col-renomear") { editar({ tipo: "renomear", coluna: id, ...(folha ? { naFolha: true } : {}) }); return; }
    if (act === "col-esquerda" || act === "col-direita") {
      const foco = folha ? `.qd-folha [data-act="${act}"][data-coluna="${CSS.escape(id)}"]` : `.qd-so-largo .qd-col-bt[data-coluna="${CSS.escape(id)}"]`;
      moverColuna(id, act === "col-esquerda" ? "esquerda" : "direita", foco);
      return;
    }
    if (act === "col-nova") {
      const c = colunaDe(id);
      editar({ tipo: "nova", ...(c && !c.fixa ? { depoisDe: c.id } : {}), ...(c ? { grupo: c.grupo } : {}), ...(folha ? { naFolha: true } : {}) });
      return;
    }
    if (act === "col-remover") { pedirRemover(id, el); return; }
    if (act === "col-trava") { editar(edicao?.tipo === "trava" && edicao.coluna === id ? null : { tipo: "trava", coluna: id }); return; }
    if (act === "col-trava-pessoa") {
      const c = colunaDe(id);
      if (!c) return;
      const so = c.trava?.soPessoa !== true;
      void mexer((a, de) => a.travarColuna?.(de, id, { so_pessoa: so }), so ? `De ${c.nome} só você tira a tarefa` : `${c.nome}: o agente também tira a tarefa`);
      return;
    }
    if (act === "col-prazo") { editar({ tipo: "prazo", coluna: id, ...(folha ? { naFolha: true } : {}) }); return; }
    if (act === "col-prazo-tirar") {
      const c = colunaDe(id);
      if (c) void mexer((a, de) => a.prazoDaColuna?.(de, id, null), `${c.nome} sem prazo`, focoDoPrazo(id, folha), folha ? { tipo: "ordem" } : null);
      return;
    }
    if (act === "col-passagem") { editar(edicao?.tipo === "passagem" && edicao.coluna === id ? null : { tipo: "passagem", coluna: id }); return; }
    if (act === "col-fechar") { fechar(); return; }
    if (act === "col-folha") { editar({ tipo: "ordem" }); return; }
    if (act === "col-fechar-folha") { editar(null, '.qd-so-estreito [data-act="col-folha"]'); return; }
  }

  // NOD-442: a pílula e a resposta do bloqueio. Enter envia na pílula (Shift+Enter quebra a linha); Esc na tarefa volta.
  doc.addEventListener("submit", (ev) => {
    const form = ev.target instanceof HTMLFormElement ? ev.target : null;
    if (!dd || !form?.closest("#quadro")) return;
    const qual = form.dataset["form"];
    if (barraUi.aoEnviar(form)) { ev.preventDefault(); return; }
    if (qual === "importar-previa") {
      ev.preventDefault();
      const time = form.querySelector<HTMLInputElement>('[name="time"]')?.value.trim().toUpperCase() ?? "";
      if (time) void lerPreviaImportacao(time, null);
      return;
    }
    if (qual === "col-renomear" || qual === "col-nova" || qual === "col-remover" || qual === "col-passagem" || qual === "col-trava" || qual === "col-prazo") { ev.preventDefault(); enviarColuna(form); return; }
    if (qual === "adicionar-pessoa") { ev.preventDefault(); void adicionarPessoa(form); return; }
    if (qual === "novo-quadro" || qual === "novo-projeto") { ev.preventDefault(); void criarNoSeletor(form, qual); return; }
    if (qual === "recado-trabalho") { ev.preventDefault(); trabs.enviarRecado(form, (c) => { if (c instanceof HTMLTextAreaElement) guardarRascunho(c); }, (c, texto) => {
      // Revisão 4: a chave é a do campo do envio; a pessoa pode ter trocado de bot ou de tarefa antes da volta. Revisão 7:
      // só sai se ainda é o texto enviado (o recado novo, digitado durante o voo, fica).
      const k = c instanceof HTMLTextAreaElement ? c.dataset["rascunho"] : undefined;
      const r = dd?.composer?.rascunhos;
      if (k && r && r.ler(k).trim() === texto) r.guardar(k, "");
    }); return; }
    if (qual === "editar-comentario") { ev.preventDefault(); coms.salvarEdicao(form); return; }
    if (qual === "comentar-tarefa") {
      ev.preventDefault();
      const de = agenteId;
      // ADA-12 (revisão 8): a releitura do próprio comentário é eco da pessoa, não ao vivo.
      daPessoaAte = Date.now() + ECO_DA_PESSOA_MS;
      const vq = vista();
      rol?.antes();
      fimDoComentarioDe = aberta;
      fimDoComentarioAte = vq && (rol?.alvo("caixa")?.colado || vq.scrollHeight - vq.clientHeight <= COLADO_PX) ? daPessoaAte : 0;
      const enviado = form.querySelector<HTMLTextAreaElement>("textarea.qd-com-in");
      // ADA-17 (S2): a resposta leva a citação no próprio texto ("> Ana: trecho"), sem campo novo no comentário.
      const resp = respondendo?.tarefa === form.dataset["id"] ? respondendo : null;
      if (resp && enviado?.value.trim() && !coms.ocupado()) { enviado.value = textoDaResposta(resp, enviado.value.trim()); respondendo = null; }
      const chaveCom = enviado?.dataset["rascunho"];
      const textoCom = enviado?.value.trim() ?? "";
      // ADA-4: a falha fica no próprio comentário ("Não saiu · Tentar de novo"), não na faixa. O campo esvazia na hora
      // (otimista) e o rascunho o acompanha; na falha, o texto que voltou ao campo volta ao rascunho.
      const ida = coms.enviar(form);
      if (enviado) guardarRascunho(enviado);
      void ida.then((r) => {
        if (!r) {
          daPessoaAte = 0; fimDoComentarioAte = 0;
          const atual = enviado ? doc.getElementById(enviado.id) : null;
          if (atual instanceof HTMLTextAreaElement && atual.value.trim()) guardarRascunho(atual);
        }
        else {
          // ADA-5: o comentário foi: o rascunho dele sai (o campo, se ainda está na tela, já está limpo).
          // A vista pode ter se redesenhado no meio: o campo da tela que ainda tem o texto enviado é limpo também.
          const atual = enviado ? doc.getElementById(enviado.id) : null;
          if (atual instanceof HTMLTextAreaElement && atual.value.trim() === textoCom) atual.value = "";
          if (chaveCom && (!(atual instanceof HTMLTextAreaElement) || !atual.value.trim())) dd.composer?.rascunhos?.guardar(chaveCom, "");
          if (de === agenteId) aplicarQuadro(r.quadro, aberta ? [aberta] : []);
        }
      });
      return;
    }
    if (qual === "nova-tarefa") {
      ev.preventDefault();
      const campo = form.querySelector<HTMLInputElement>('[name="titulo"]');
      const titulo = campo?.value.trim() ?? "";
      const status = form.dataset["status"] ?? "";
      // Revisão do PR #645: com uma mudança no ar (o Enter duplo, um arrasto), o Enter não faz nada: nem cria de novo nem
      // mostra um erro que não houve.
      if (!titulo || !nova || nova.coluna !== status || mexendo) return;
      const id = campo?.id ?? "";
      const pedido = nova;
      void mudarTarefa((a, de) => a.criarTarefa?.(de, { titulo, ...(status ? { status } : {}) }), (r) => reciboDaNovaTarefa(titulo, r), acoesDaNovaTarefa).then((ok) => {
        if (nova !== pedido) return;
        // Deu certo: o campo fica aberto e vazio, para a próxima; falhou: o título fica e o erro aparece no campo.
        nova = ok ? { coluna: pedido.coluna, ...(pedido.estreito ? { estreito: true } : {}) } : { ...pedido, erro: true };
        if (ok) { const c = doc.getElementById(id); if (c instanceof HTMLInputElement) c.value = ""; }
        desenharVista();
        const c = doc.getElementById(id);
        if (c instanceof HTMLInputElement) { if (ok) c.value = ""; focarSemRolar(c); }
      });
      return;
    }
    // 0159: adicionar label na tarefa aberta (Enter no campo; um nome novo cria a label no quadro).
    if (qual === "label-por") {
      ev.preventDefault();
      const campo = form.querySelector<HTMLInputElement>('[name="label"]');
      const nome = campo?.value.trim() ?? "";
      if (!nome || !form.dataset["id"]) return;
      mudarLabelOuPrazo(form.dataset["id"], { por_labels: [nome] }, `label ${nome}`, campo?.id ?? null);
      return;
    }
    if (qual !== "conversa-no-quadro" && qual !== "responder-tarefa" && qual !== "criar-quadro" && qual !== "editar-meta") return;
    ev.preventDefault();
    if (qual === "conversa-no-quadro") enviarPedido(form);
    // ADA-15: o "Responder e seguir" é o submitter com name=avancar; o Enter (sem submitter) só responde.
    else if (qual === "responder-tarefa") void responder(form, (ev as SubmitEvent).submitter?.getAttribute("name") === "avancar");
    else if (qual === "criar-quadro") {
      const meta = form.querySelector<HTMLInputElement>('[name="meta"]')?.value.trim() ?? "";
      const prazo = prazoDoForm(form);
      const botao = form.querySelector<HTMLButtonElement>('button[type="submit"]');
      if (botao) botao.disabled = true;
      void mexerNoQuadro("criar", { meta: meta || null, prazo }).finally(() => { if (botao) botao.disabled = false; });
    } else {
      const meta = form.querySelector<HTMLInputElement>('[name="meta"]')?.value.trim() ?? "";
      if (meta === (q?.meta ?? "")) { editarMeta(false); return; }
      void mexerNoQuadro("editar", { meta: meta || null });
    }
  });

  /** O prazo escolhido no menu (ou no campo de "Outra data…"); "" = sem prazo. */
  function prazoDoForm(lugar: ParentNode): string | null {
    const sel = lugar.querySelector<HTMLSelectElement>('[data-campo="prazo"]');
    const data = lugar.querySelector<HTMLInputElement>('[data-campo="prazo-data"]');
    const v = sel?.value === "outra" ? data?.value ?? "" : sel?.value ?? "";
    return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
  }

  // NOD-415: o menu de prazo. "Outra data…" abre o campo de data; no topo, a troca grava na hora (no criar, só no envio).
  doc.addEventListener("change", (ev) => {
    const el = ev.target as Element | null;
    if (!dd || !el?.closest?.("#quadro .qd-conteudo")) return;
    if (barraUi.aoMudar(el as HTMLElement)) return;
    const campo = (el as HTMLElement).dataset?.["campo"];
    if (campo === "modo-conversa") {
      const modo = (el as HTMLSelectElement).value as ModoConversa;
      if (modo === q?.modoConversa) return;
      void mexerNasPessoas((a, de) => a.mudarModo?.(de, modo), modo === "so_dono" ? "Agora só você conversa com o quadro" : "Agora cada um conversa pela própria conversa", "#qd-modo-sel");
      return;
    }
    // NOD-463: a prioridade da tarefa aberta (um lote com Desfazer, como o Status e o Responsável).
    if (campo === "prioridade" && el instanceof HTMLSelectElement) {
      const t = tarefaNoQuadro(q, el.dataset["id"] ?? null);
      const p = el.value;
      if (!t || !ehPrioridade(p) || p === prioridadeDe(t)) return;
      void mudarTarefa((a, de) => a.mudarTarefa?.(de, t.id, { prioridade: p }), `${t.titulo}: ${NOME_DA_PRIORIDADE[p].toLowerCase()}`);
      return;
    }
    // NOD-416: Status e Responsável da tarefa aberta (pelo teclado, a escolha espera o Enter ou a saída do campo).
    if (ehCampoDaTarefa(el)) { if (!el.dataset["teclado"]) aplicarCampoDaTarefa(el); return; }
    // "Mover para…": escolher só liga o botão Mover (revisão do PR #623).
    if (campo === "mover") {
      moverPara = (el as HTMLSelectElement).value || null;
      const bt = el.closest(".qd-mover")?.querySelector<HTMLButtonElement>('[data-act="mover-quadro"]');
      if (bt) bt.disabled = !(el as HTMLSelectElement).value;
      // QA do PR #623: o nome pode não caber no select; o title acompanha a escolha.
      const sel = el as HTMLSelectElement;
      sel.title = sel.selectedOptions[0]?.textContent ?? "";
      return;
    }
    // 0159: o prazo da tarefa aberta (o campo de data; vazio tira).
    if (campo === "prazo-tarefa") {
      const v = (el as HTMLInputElement).value;
      const id = (el as HTMLElement).dataset["id"] ?? "";
      const t = tarefaNoQuadro(q, id);
      const novo = /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
      if (t && novo !== (t.prazoEm ?? null)) mudarLabelOuPrazo(id, { prazo_em: novo }, novo ? `prazo ${novo.split("-").reverse().join("/")}` : "sem prazo", (el as HTMLElement).id);
      return;
    }
    // ADA-18: "Outra data" na folha do prazo do celular.
    if (campo === "cel-prazo-data") { cel.aoEscolherData((el as HTMLInputElement).value); return; }
    if (campo !== "prazo" && campo !== "prazo-data") return;
    const caixa = el.closest<HTMLElement>(".qd-prazo");
    const data = caixa?.querySelector<HTMLInputElement>('[data-campo="prazo-data"]');
    if (campo === "prazo" && (el as HTMLSelectElement).value === "outra") {
      if (data) { data.hidden = false; data.focus(); try { data.showPicker?.(); } catch { /* sem gesto: o campo fica à vista */ } }
      return;
    }
    if (el.closest('[data-form="criar-quadro"]') || !q || !caixa) return;
    const prazo = prazoDoForm(caixa);
    if (campo === "prazo-data" && !prazo) return;
    if (prazo === q.prazo) return;
    void mexerNoQuadro("editar", { prazo });
  });
  // QA do PR #617: sair do campo sem Enter nem Esc desiste (como o Esc), e "Outra data…" sem data volta ao prazo de
  // antes. Sem redesenhar agora: o clique que tirou o foco ainda vai chegar ao alvo dele.
  doc.addEventListener("focusout", (ev) => {
    // Trocar de janela ou de aba também tira o foco: aí o campo fica como está (revisão 4).
    if (!dd || !doc.hasFocus()) return;
    const el = ev.target as Element | null;
    if (editandoMeta && el instanceof HTMLInputElement && el.id === "qd-meta-in") {
      editandoMeta = false;
      setTimeout(() => { if (!editandoMeta && doc.activeElement?.id !== "qd-meta-in" && vista()?.querySelector("#qd-meta-in")) desenharVista(); }, 200);
    } else if (el instanceof HTMLInputElement && el.dataset["campo"] === "prazo-data" && !el.value) {
      const sel = el.closest(".qd-prazo")?.querySelector<HTMLSelectElement>('[data-campo="prazo"]');
      if (sel?.value === "outra") { sel.value = el.closest('[data-form="criar-quadro"]') ? "" : q?.prazo ?? ""; el.hidden = true; }
    }
  });
  // Revisão do PR #623: no select fechado, as setas, Home/End, PageUp/PageDown e a busca por letra trocam o valor (e o
  // Chrome dispara o change a cada uma). Marca o campo; o Enter aplica. O clique do mouse tira a marca.
  doc.addEventListener("keydown", (ev) => {
    const el = ev.target;
    if (!dd || !ehCampoDaTarefa(el) || ev.isComposing) return;
    if (ev.key === "Enter") { ev.preventDefault(); aplicarCampoDaTarefa(el); return; }
    if (/^(Arrow|Page)/.test(ev.key) || ev.key === "Home" || ev.key === "End" || (ev.key.length === 1 && ev.key !== " " && !ev.ctrlKey && !ev.metaKey)) el.dataset["teclado"] = "1";
  });
  doc.addEventListener("pointerdown", (ev) => { if (ehCampoDaTarefa(ev.target)) delete ev.target.dataset["teclado"]; });
  // ADA-5: "/" fora de campo, com uma tarefa aberta, foca a pílula (como no chat). Sem tarefa aberta e com a busca à vista,
  // o "/" é da busca (NOD-460), que anuncia o atalho no aria-keyshortcuts — revisão 4 do ADA-5, definido em 2026-11-04.
  doc.addEventListener("keydown", (ev) => {
    if (!dd || ev.key !== "/" || ev.ctrlKey || ev.metaKey || ev.altKey || ev.isComposing || ev.defaultPrevented || modo !== "quadro") return;
    if (!aberta && vista()?.querySelector("#qd-busca")) return;
    const el = ev.target;
    if (el instanceof Element && el.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]')) return;
    if (doc.querySelector("dialog[open]")) return;
    const txt = pilulaNaTela()?.querySelector<HTMLTextAreaElement>("#qc-txt");
    if (!txt) return;
    ev.preventDefault();
    txt.focus();
  });
  doc.addEventListener("focusout", (ev) => { if (dd && ehCampoDaTarefa(ev.target) && ev.target.dataset["teclado"]) aplicarCampoDaTarefa(ev.target); });
  // ADA-6: digitar na pílula esconde as sugestões e mostra o contador perto do limite.
  doc.addEventListener("input", (ev) => { if (dd && ev.target instanceof HTMLTextAreaElement && ev.target.id === "qc-txt") desenharIdeias(); });
  // ADA-28 (escopo D): a linha embaixo do campo diz se o comentário aciona alguém (local, sem rede).
  const desenharPrevia = (campo: HTMLTextAreaElement): void => {
    const form = campo.form;
    const tid = form?.dataset["id"];
    const linha = tid ? form?.parentElement?.querySelector<HTMLElement>(`[data-previa="${CSS.escape(tid)}"]`) : null;
    const t = q && tid ? q.tarefas.find((x) => x.id === tid) : null;
    if (!linha || !t || !q) return;
    const agentes = dd?.agentes?.() ?? [];
    const p = previaDoComentario({ tarefa: t, colunas: q.colunas, texto: campo.value, agentes });
    linha.textContent = textoDaPrevia(p, q.colunas.find((c) => c.id === t.status)?.nome ?? null);
  };
  // 2026-11-10: no campo da linha do tempo os chips vêm do servidor (a mesma conta do envio); o do celular segue local.
  const previaDoCampo = (campo: HTMLTextAreaElement): void => { if (campo.closest(".ta-campo")) coms.previa(campo); else desenharPrevia(campo); };
  doc.addEventListener("input", (ev) => { if (dd && ev.target instanceof HTMLTextAreaElement && ev.target.classList.contains("qd-com-in")) previaDoCampo(ev.target); });
  doc.addEventListener("focusin", (ev) => { if (dd && ev.target instanceof HTMLTextAreaElement && ev.target.classList.contains("qd-com-in")) previaDoCampo(ev.target); });
  // 2026-11-10: título e descrição se editam na própria tarefa aberta; sair do campo salva (mudar_tarefa, com Desfazer).
  const salvarTexto = (el: HTMLElement): void => {
    const campo = el.dataset["texto"];
    const t = tarefaNoQuadro(q, el.dataset["id"] ?? "");
    if (!t || (campo !== "titulo" && campo !== "descricao")) return;
    const novo = (el.textContent ?? "").replace(/\u00a0/g, " ").trim();
    const antes = el.dataset["salvo"] ?? "";
    if (novo === antes.trim()) return;
    if (campo === "titulo" && !novo) { el.textContent = antes; return; }
    el.dataset["salvo"] = novo;
    void mudarTarefa((a, de) => a.mudarTarefa?.(de, t.id, campo === "titulo" ? { titulo: novo.slice(0, 200) } : { descricao: novo.slice(0, 4000) }), () => `${t.titulo}: ${campo === "titulo" ? "título" : "descrição"} salvo`);
  };
  doc.addEventListener("focusout", (ev) => { if (dd && ev.target instanceof HTMLElement && ev.target.dataset["texto"] && ev.target.closest("#quadro .qd-tarefa")) salvarTexto(ev.target); });
  doc.addEventListener("keydown", (ev) => {
    const el = ev.target;
    if (!dd || !(el instanceof HTMLElement) || !el.dataset["texto"] || !el.closest("#quadro .qd-tarefa")) return;
    // O título é uma linha: Enter salva. A descrição: ⌘↵ salva. Esc desfaz o que foi digitado.
    if (ev.key === "Enter" && (el.dataset["texto"] === "titulo" || ev.metaKey || ev.ctrlKey)) { ev.preventDefault(); el.blur(); }
    else if (ev.key === "Escape") { el.textContent = el.dataset["salvo"] ?? ""; el.blur(); }
  });
  doc.addEventListener("keydown", (ev) => {
    if (!dd) return;
    const el = ev.target as Element | null;
    // NOD-420: a resposta também (no card e na tarefa aberta); a composição do IME (keyCode 229) não envia. ADA-5: no
    // celular o Enter quebra a linha (envia pelo botão); a pílula ligada ao composer decide no composer.
    const queEnvia = el instanceof HTMLTextAreaElement && ((el.id === "qc-txt" && !composer) || el.classList.contains("qd-com-in") || el.classList.contains("qd-resp-in"));
    if (queEnvia && ev.key === "Enter" && ev.keyCode !== 229 && enterEnvia(ev, dd.composer?.celular() ?? false)) {
      ev.preventDefault();
      // Responder vazio não envia (revisão do PR #624): o Enter só não pula linha.
      if (el.classList.contains("qd-resp-in") && !el.value.trim()) return;
      el.form?.requestSubmit();
    } else if (ev.key === "Escape" && (ev.isComposing || ev.keyCode === 229)) {
      // QA do ADA-5: o Esc da composição do IME é do IME (não sai do campo nem fecha a tarefa).
    } else if (ev.key === "Escape" && dd.composer?.ditado?.ativo()) {
      // ADR-095: Esc com o ditado aberto descarta a gravação (o main faz isso); aqui não sai do campo nem fecha a tarefa.
    } else if (ev.key === "Escape" && lendo && (el === doc.body || el?.closest?.("#qc-sobre, .qc-caixa"))) {
      // ADA-6: Esc fecha o cartão-mensagem.
      ev.preventDefault();
      alternarLeitura();
    } else if (ev.key === "Escape" && naRecusa(el)) {
      ev.preventDefault();
      sairDaRecusa();
    } else if (ev.key === "Escape" && cel.folha() && el?.closest?.("#quadro")) {
      cel.aoTeclar(ev);
    } else if (ev.key === "Tab" && !ev.altKey && !ev.ctrlKey && !ev.metaKey && cel.folha() && noCelular()) {
      prenderFocoNaFolha(ev);
    } else if (((ev.key === "F10" && ev.shiftKey) || ev.key === "ContextMenu") && noCelular() && linhaDoToque(el)) {
      // O teclado (e o leitor de tela) chega ao menu do toque longo pela linha focada.
      ev.preventDefault();
      cel.menuDaTarefa(linhaDoToque(el)?.dataset["tarefa"] ?? "");
    } else if (ev.key === "Escape" && editandoMeta && el instanceof HTMLInputElement && el.id === "qd-meta-in") {
      ev.preventDefault();
      editarMeta(false);
    } else if (ev.key === "Escape" && edicao && el?.closest?.("#quadro .qd-conteudo")) {
      ev.preventDefault();
      if (edicao.tipo === "ordem") editar(null, '.qd-so-estreito [data-act="col-folha"]');
      else fechar();
    } else if (ev.key === "Escape" && el instanceof HTMLTextAreaElement && el.value.trim() && el.closest("#quadro")) {
      // ADA-5: Esc com texto num campo do Quadro só tira o foco (o rascunho fica); fechar a tarefa é o Esc seguinte.
      ev.preventDefault();
      sairDoCampo(el);
    } else if (ev.key === "Escape" && aberta && el?.closest?.("#quadro .qd-conteudo")) {
      ev.preventDefault();
      voltarAoQuadro();
    } else if (el instanceof HTMLElement && el.matches("#quadro .qd-so-largo .qd-col-bt[aria-keyshortcuts]")) {
      // Decisão 6: F2 renomeia; Alt ← → move dentro do grupo.
      const id = el.dataset["coluna"] ?? "";
      if (ev.key === "F2") { ev.preventDefault(); editar({ tipo: "renomear", coluna: id }); }
      else if (ev.altKey && (ev.key === "ArrowLeft" || ev.key === "ArrowRight")) {
        ev.preventDefault();
        moverColuna(id, ev.key === "ArrowLeft" ? "esquerda" : "direita", `.qd-so-largo .qd-col-bt[data-coluna="${CSS.escape(id)}"]`);
      }
    } else if (el instanceof HTMLElement && el.matches(ITEM_DE_MENU) && (ev.key === "ArrowDown" || ev.key === "ArrowUp" || ev.key === "Home" || ev.key === "End")) {
      ev.preventDefault();
      // NOD-460 (revisão do PR #645): também os menus da barra (Exibir, com caixas, e o "+N", com a escolha única).
      const itens = [...(el.closest('[role="menu"]')?.querySelectorAll<HTMLElement>('[role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"]') ?? [])];
      const i = itens.indexOf(el);
      const j = ev.key === "Home" ? 0 : ev.key === "End" ? itens.length - 1 : (i + (ev.key === "ArrowDown" ? 1 : -1) + itens.length) % itens.length;
      itens[j]?.focus();
    }
  });

  // NOD-448: renomear grava ao sair do campo (Esc desiste antes: a edição já fechou quando o campo sai).
  doc.addEventListener("focusout", (ev) => {
    const el = ev.target;
    if (!(el instanceof HTMLInputElement) || el.id !== "qd-col-in" || edicao?.tipo !== "renomear") return;
    const form = el.form;
    if (!form?.isConnected) return;
    // O foco foi para outro lugar do próprio formulário (nada além do campo): deixa.
    if (ev.relatedTarget instanceof Node && form.contains(ev.relatedTarget)) return;
    // Com o erro na tela, sair do campo sem corrigir desiste (não prende a pessoa nele); corrigido, grava (revisão do PR #615).
    if (edicao.erro && saidaComErroDesiste(q?.colunas ?? [], edicao.coluna, el.value)) { fechar(); return; }
    enviarColuna(form);
  });

  /**
   * ADR-142: o card arrastado muda de coluna pelo mesmo mudar_tarefa da pessoa e do agente (as travas e o histórico pegam).
   * Definido em 2026-11-10 (o handoff do Multica): entrar numa coluna com responsável aciona na hora. O card vai já para a
   * coluna, com o responsável dela e "começando" (otimista), até a resposta do servidor trazer o estado real; se a mudança
   * não valeu, o quadro é relido e o card volta.
   */
  function moverTarefa(tarefa: string, coluna: string): void {
    const t = q?.tarefas.find((x) => x.id === tarefa);
    const c = colunaDe(coluna);
    if (!q || !t || !c || t.status === coluna) { editar(null); return; }
    if (mexendo) { desenharVista(); return; }
    const recibo = reciboDeMover(t.titulo, c);
    const otimista: QuadroDto = { ...q, tarefas: q.tarefas.map((x) => (x.id !== tarefa ? x : { ...x, status: coluna, ...(c.responsavel ? { agenteId: c.responsavel } : {}), ...(comecaAoEntrar(c) ? { execucao: "fila" as const } : {}) })) };
    q = otimista;
    edicao = null;
    desenharVista();
    void mexer((a, de) => a.mudarTarefa?.(de, tarefa, { status: coluna }), recibo).then(() => {
      // A resposta troca o quadro inteiro (aplicarQuadro); o mesmo objeto aqui = não valeu (recusa ou sem rede): relê.
      if (q === otimista) void lerQuadro();
    });
  }
  let cardArrastado: string | null = null;
  const colunaSob = (alvo: EventTarget | null): HTMLElement | null => (alvo as Element | null)?.closest?.<HTMLElement>("#quadro section.qd-col[data-coluna]") ?? null;
  // NOD-420 (revisão do PR #624): o campo Responder mora dentro do card arrastável. Medido em 2026-11-02 no Chrome (teste
  // quadro-jornada-chrome): selecionar sobre o texto já funcionava, mas apertar na borda de dentro do campo (o padding,
  // que ainda é o textarea) e arrastar pegava o card. Desligar no pointerdown chega tarde (o Chrome decide no apertar):
  // o card deixa de arrastar quando o ponteiro entra no campo ou o foco chega nele, e volta quando os dois saem.
  const cardDoCampo = (alvo: EventTarget | null): HTMLElement | null =>
    alvo instanceof HTMLTextAreaElement || alvo instanceof HTMLInputElement ? alvo.closest<HTMLElement>("#quadro li.qd-card[data-tarefa]") : null;
  const segurarCard = (ev: Event) => {
    const li = cardDoCampo(ev.target);
    if (li?.getAttribute("draggable") === "true") { li.setAttribute("draggable", "false"); li.dataset["arrastavel"] = "1"; }
  };
  const soltarCard = (ev: Event) => {
    const campo = ev.target as HTMLElement;
    const li = cardDoCampo(campo);
    if (li?.dataset["arrastavel"] !== "1") return;
    // Saiu o ponteiro mas o foco segue no campo (ou o contrário): continua sem arrastar.
    if (ev.type === "pointerout" ? doc.activeElement === campo : campo.matches(":hover")) return;
    li.setAttribute("draggable", "true");
    delete li.dataset["arrastavel"];
  };
  doc.addEventListener("pointerover", segurarCard);
  doc.addEventListener("focusin", segurarCard);
  doc.addEventListener("pointerout", soltarCard);
  doc.addEventListener("focusout", soltarCard);
  doc.addEventListener("dragstart", (ev) => {
    const li = (ev.target as Element | null)?.closest?.<HTMLElement>("#quadro li.qd-card[draggable='true'][data-tarefa]");
    if (!li || !q) return;
    cardArrastado = li.dataset["tarefa"] ?? null;
    // Revisão 9: o li pode sair do documento no meio do arrasto (um redesenho direto); o dragend dele não sobe ao doc e o
    // arrasto ficava preso, segurando toda releitura por ARRASTO_ATE_MS. O próprio li também solta.
    li.addEventListener("dragend", fimDoArrastoDoCard, { once: true });
    ev.dataTransfer?.setData("text/plain", cardArrastado ?? "");
    if (ev.dataTransfer) ev.dataTransfer.effectAllowed = "move";
    li.classList.add("qd-arrastando");
  });
  doc.addEventListener("dragover", (ev) => {
    const sec = cardArrastado ? colunaSob(ev.target) : null;
    if (!sec) return;
    ev.preventDefault();
    vista()?.querySelectorAll(".qd-alvo").forEach((x) => { if (x !== sec) x.classList.remove("qd-alvo"); });
    sec.classList.add("qd-alvo");
  });
  function fimDoArrastoDoCard(): void {
    cardArrastado = null;
    vista()?.querySelectorAll(".qd-alvo, .qd-arrastando").forEach((x) => x.classList.remove("qd-alvo", "qd-arrastando"));
  }
  doc.addEventListener("dragend", fimDoArrastoDoCard);
  // O navegador não manda eventos de ponteiro durante o arrasto nativo: um movimento sem botão depois dele é o fim perdido.
  doc.addEventListener("pointermove", (ev) => { if (cardArrastado && ev.buttons === 0) fimDoArrastoDoCard(); }, { passive: true });
  doc.addEventListener("drop", (ev) => {
    const sec = cardArrastado ? colunaSob(ev.target) : null;
    const tarefa = cardArrastado;
    if (!sec || !tarefa) return;
    ev.preventDefault();
    cardArrastado = null;
    const c = colunaDe(sec.dataset["coluna"]);
    if (!c || q?.tarefas.find((x) => x.id === tarefa)?.status === c.id) { desenharVista(); return; }
    const naoRecebe = porqueNaoRecebeCard(c, nome);
    if (naoRecebe) { desenharVista(); mudarFaixa({ tipo: "erro", texto: naoRecebe }); return; }
    pessoaSolta(tarefa, c);
  });

  // NOD-448: arrastar a coluna (o cabeçalho, ou a alça ≡ na folha do celular), só dentro do grupo.
  doc.addEventListener("pointerdown", (ev) => {
    const el = (ev.target as Element | null)?.closest?.<HTMLElement>("#quadro [data-arrasta][data-coluna]");
    if (!el || ev.button !== 0 || !q) return;
    arrasto = { id: el.dataset["coluna"] ?? "", x: ev.clientX, y: ev.clientY, ativo: false, alvo: null, origem: el.closest<HTMLElement>("section[data-coluna], li[data-coluna]") };
    if (el.classList.contains("qd-alca")) { ev.preventDefault(); el.setPointerCapture?.(ev.pointerId); }
  });
  doc.addEventListener("pointermove", (ev) => {
    if (!arrasto || !q) return;
    if (!arrasto.ativo && Math.hypot(ev.clientX - arrasto.x, ev.clientY - arrasto.y) < 6) return;
    arrasto.ativo = true;
    arrasto.origem?.classList.add("qd-arrastando");
    const sob = doc.elementFromPoint?.(ev.clientX, ev.clientY)?.closest?.<HTMLElement>("#quadro section[data-coluna], #quadro li[data-coluna][data-grupo]") ?? null;
    const valido = sob && soltarEm(q.colunas, arrasto.id, sob.dataset["coluna"] ?? "") ? sob : null;
    if (valido !== arrasto.alvo) { arrasto.alvo?.classList.remove("qd-alvo"); valido?.classList.add("qd-alvo"); arrasto.alvo = valido; }
  });
  const fimDoArrasto = (soltou: boolean): void => {
    const a = arrasto;
    arrasto = null;
    if (!a?.ativo) return;
    a.origem?.classList.remove("qd-arrastando");
    a.alvo?.classList.remove("qd-alvo");
    // O pointerup vira um click no cabeçalho: ele não recolhe a coluna que acabou de ser arrastada.
    engolirClique = true;
    setTimeout(() => { engolirClique = false; }, 0);
    if (soltou && a.alvo) soltar(a.id, a.alvo.dataset["coluna"] ?? "");
  };
  doc.addEventListener("pointerup", () => fimDoArrasto(true));
  doc.addEventListener("pointercancel", () => fimDoArrasto(false));

  // Quadro minimalista: o que se digita no funil e no modal; o teclado da barra (Esc, ⌘↵, Tab no modal, C) vem antes dos outros.
  doc.addEventListener("input", (ev) => {
    const el = ev.target;
    if (dd && el instanceof HTMLElement && el.closest("#quadro") && !(ev as InputEvent).isComposing) barraUi.aoDigitar(el);
  });
  doc.addEventListener("keydown", (ev) => {
    if (!dd || ev.isComposing || !vista()?.querySelector(".qm-barra")) return;
    const el = ev.target as Element | null;
    const digitando = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement || (el instanceof HTMLElement && el.isContentEditable);
    if (barraUi.aoTeclar(ev, digitando) && ev.key !== "Tab") ev.stopImmediatePropagation();
  }, true);
  // NOD-460: a busca filtra a cada letra; "/" leva à busca (fora de um campo); Esc limpa a busca, fecha o "+" e os menus.
  doc.addEventListener("input", (ev) => {
    const el = ev.target;
    if (!dd || !(el instanceof HTMLInputElement) || el.id !== "qd-busca") return;
    // Revisão do PR #645: a tecla morta (´ ~ ^) abre uma composição; regravar o campo no meio dela quebra o acento. A busca
    // espera a composição acabar (o compositionend abaixo).
    if ((ev as InputEvent).isComposing) return;
    mudarBusca(el.value);
  });
  doc.addEventListener("compositionend", (ev) => {
    const el = ev.target;
    if (!dd || !(el instanceof HTMLInputElement) || el.id !== "qd-busca") return;
    mudarBusca(el.value);
  });
  doc.addEventListener("keydown", (ev) => {
    if (!dd || ev.defaultPrevented || ev.isComposing) return;
    const el = ev.target as Element | null;
    const v = vista();
    if (!v || !v.querySelector("#qd-busca")) return;
    const digitando = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement || (el instanceof HTMLElement && el.isContentEditable);
    if (ev.key === "/" && !digitando && !ev.ctrlKey && !ev.metaKey && !ev.altKey && modo === "quadro") {
      ev.preventDefault();
      focarNaVista("#qd-busca");
      return;
    }
    if (ev.key !== "Escape") return;
    if (el instanceof HTMLInputElement && el.id === "qd-busca") {
      if (!busca) return;
      ev.preventDefault();
      mudarBusca("");
      return;
    }
    if (el instanceof HTMLInputElement && el.classList.contains("qd-nova-in")) { ev.preventDefault(); fecharNova(); return; }
    if (maisAberto || exibirAberto) {
      ev.preventDefault();
      const volta = maisAberto ? '[data-act="filtro-mais-agentes"]' : '[data-act="exibir-abrir"]';
      maisAberto = exibirAberto = false;
      desenharVista();
      focarNaVista(volta);
    }
  });

  // O teclado do tablist (APG, ativação automática): ← → Home End trocam de página e levam o foco. No nome do bot (a
  // pílula), só as setas: Home e End ficam para quem lê.
  doc.addEventListener("keydown", (ev) => {
    const alvo = ev.target as Element | null;
    const aba = alvo?.closest?.<HTMLElement>("#cabecalho .pg-ic");
    const noNome = !aba && !!alvo?.closest?.("#cabecalho .qd-pil > .pilula-bot") && (ev.key === "ArrowLeft" || ev.key === "ArrowRight");
    // ⌥← → e ⌥⇧← → (também no ícone focado) são do despachante de atalhos (NOD-461: web/lib/atalhos.ts, setaDaPilula).
    if ((!aba && !noNome) || ev.altKey || ev.ctrlKey || ev.metaKey || ev.shiftKey) return;
    const prox = paginaPelaTecla(posDe(pagina), paginas.length, ev.key);
    if (prox === null) return;
    ev.preventDefault();
    irPara(naPos(prox), { foco: !!aba });
  });

  const abaDe = (alvo: EventTarget | null): HTMLElement | null => (alvo as Element | null)?.closest?.<HTMLElement>("#cabecalho .pg-ic") ?? null;
  doc.addEventListener("focusin", (ev) => {
    const el = abaDe(ev.target);
    abaFocada = el ? { el, pagina: Number(el.dataset["pagina"]) } : null;
  });
  // A recusa da trava não some com a pessoa no card: o foco ou o ponteiro seguram a conta (revisão 2 do PR #629).
  doc.addEventListener("focusin", (ev) => { if (naRecusa(ev.target)) relogio?.segurar("foco"); else relogio?.soltar("foco"); });
  doc.addEventListener("focusout", (ev) => { if (!naRecusa(ev.relatedTarget)) relogio?.soltar("foco"); });
  doc.addEventListener("pointerover", (ev) => { if (naRecusa(ev.target)) relogio?.segurar("ponteiro"); else relogio?.soltar("ponteiro"); });
  // ADA-4: a faixa não recolhe com o ponteiro em cima nem com o foco dentro; ao sair, os 12 s recomeçam.
  const naFaixa = (n: EventTarget | null): boolean => n instanceof Node && !!doc.getElementById("qc-faixa")?.contains(n);
  const segurarFaixa = (qual: "ponteiro" | "foco", sim: boolean): void => {
    if (faixaSegura[qual] === sim) return;
    faixaSegura[qual] = sim;
    if (dd) agendarRecolher();
  };
  // Revisão 2 do #646: o toque não segura (não há "sair" dele), e o ponteiro que sai da janela solta.
  doc.addEventListener("pointerover", (ev) => { if (ev.pointerType !== "touch") segurarFaixa("ponteiro", naFaixa(ev.target)); });
  doc.addEventListener("pointerout", (ev) => { if (!ev.relatedTarget) segurarFaixa("ponteiro", false); });
  doc.addEventListener("focusin", (ev) => segurarFaixa("foco", naFaixa(ev.target)));
  doc.addEventListener("focusout", (ev) => { if (!naFaixa(ev.relatedTarget)) segurarFaixa("foco", false); });
  // ADA-4: com texto no campo, o ■ Parar volta a Enviar (e vice-versa), como no chat.
  doc.addEventListener("input", (ev) => { if (dd && ev.target instanceof HTMLTextAreaElement && ev.target.id === "qc-txt") atualizarBotaoDaPilula(); });
  // A pessoa tirou o foco da aba com um clique ou toque fora dela (no vazio o foco cai no body, sem focusin): esquece.
  // Não dá para usar o focusout: o Chrome também o dispara quando a regravação tira o nó, e aí o foco tem de voltar.
  doc.addEventListener("pointerdown", (ev) => { if (!abaDe(ev.target)) abaFocada = null; }, true);

  /** A conexão voltou sem o replay (SSE resumed:false): relê o quadro e, com um pedido esperando, a conversa. */
  function reler(): void {
    if (!dd || chave === null || !agenteId) return;
    pedirReleitura();
    // Revisão 2 do #646: os frames perdidos na queda podem ter sido o fim do turno: a leitura confere.
    if (pedidoSeguido(faixa) !== null || histAberto) void lerConversa(true);
  }

  /* ---------- NOD-445: o menu do ícone (segurar, botão direito, Shift+F10 ou a tecla de menu) ---------- */
  let menu: { id: string; volta: string } | null = null;
  function fecharMenu(foco = false): void {
    const m = doc.getElementById("pg-menu");
    if (m) m.remove();
    const volta = menu?.volta;
    menu = null;
    if (foco && volta) doc.querySelector<HTMLElement>(`#cabecalho .pg-ic[data-pg-id="${volta}"]`)?.focus();
  }
  function abrirMenu(i: number, ancora: HTMLElement | null): void {
    const p = paginas[i];
    if (!p || chave === null || paginas.length < 2) return;
    fecharMenu();
    const r = ancora?.getBoundingClientRect();
    doc.body.insertAdjacentHTML("beforeend", menuDaPagina({ p, pos: posDe(i), total: paginas.length }));
    const m = doc.getElementById("pg-menu");
    if (!m) return;
    if (r) { m.style.top = `${Math.round(r.bottom + 6)}px`; m.style.left = `${Math.round(Math.max(8, r.left))}px`; }
    menu = { id: p.id, volta: p.id };
    m.querySelector<HTMLElement>('[role="menuitem"]:not([aria-disabled])')?.focus();
  }
  function noMenu(act: string): void {
    const i = indicePeloId(paginas, menu?.id);
    const p = paginas[i];
    if (!p) { fecharMenu(); return; }
    if (act === "pagina-antes" || act === "pagina-depois") {
      fecharMenu();
      const de = posDe(i);
      moverPagina(de, de + (act === "pagina-antes" ? -1 : 1), { foco: true });
      return;
    }
    fecharMenu();
    if (act === "app-editar") o.paginas?.editarApp(p);
    else if (act === "app-remover") o.paginas?.removerApp(p);
  }
  doc.addEventListener("click", (ev) => {
    const alvo = ev.target as Element | null;
    const m = alvo?.closest?.<HTMLElement>("#pg-menu");
    if (m) {
      const it = alvo?.closest?.<HTMLElement>('[role="menuitem"]');
      if (it && it.getAttribute("aria-disabled") !== "true") noMenu(it.dataset["act"] ?? "");
      return;
    }
    if (menu) fecharMenu();
    const el = alvo?.closest?.<HTMLElement>("[data-act]");
    const act = el?.dataset["act"];
    if (act === "pedir-app" && el?.closest("#cabecalho")) {
      if (el.getAttribute("aria-disabled") === "true") anunciarPagina(el.getAttribute("aria-label") ?? "");
      else o.paginas?.pedirApp();
    } else if (act === "app-reconectar" && el?.closest("#quadro")) {
      const p = paginas.find((x) => x.app?.id === el.dataset["app"]);
      if (p) o.paginas?.reconectar(p);
    }
  });
  /** ADA-17: no celular, o topo encolhido mostra "VER-1 · título" da tarefa aberta (web/celular-base.css). */
  function marcarTopo(): void {
    const cab = doc.getElementById("cabecalho");
    if (!cab) return;
    const t = ehCelular() && q && dd && (paginas[pagina]?.id ?? TAREFAS.id) === TAREFAS.id ? tarefaNoQuadro(q, aberta) : null;
    const titulo = t ? `${codigoDaTarefa(t)} · ${t.titulo}` : null;
    if (titulo) { if (cab.dataset["titulo"] !== titulo) cab.dataset["titulo"] = titulo; }
    else if (cab.hasAttribute("data-titulo")) delete cab.dataset["titulo"];
  }
  // ADA-17: virar o aparelho (ou a janela entrar/sair da consulta) troca a árvore da tarefa aberta.
  doc.defaultView?.matchMedia?.(CONSULTA_CELULAR).addEventListener?.("change", () => { folhaAberta()?.fechar(false); if (aberta) desenharVista(); else marcarTopo(); });
  // ADA-17: o toque longo num comentário (500 ms parado) abre Responder · Copiar texto. Arrastar (rolar) mais de 8 px desiste.
  let toqueLongo: { timer: ReturnType<typeof setTimeout>; x: number; y: number } | null = null;
  const desistirDoToque = (): void => { if (toqueLongo) clearTimeout(toqueLongo.timer); toqueLongo = null; };
  doc.addEventListener("pointerdown", (ev) => {
    desistirDoToque();
    const c = (ev.target as Element | null)?.closest?.<HTMLElement>("#quadro .qd-tarefa-cel .qd-com[data-com]");
    if (!c || ev.pointerType === "mouse") return;
    const comId = c.dataset["com"] ?? "";
    toqueLongo = { x: ev.clientX, y: ev.clientY, timer: setTimeout(() => {
      toqueLongo = null;
      // O clique que vem ao soltar o dedo não pode cair na folha recém-aberta (o fundo a fecharia).
      engolirCliqueDoToque(doc, setTimeout);
      folhaDoComentarioCel(comId);
    }, 500) };
  });
  doc.addEventListener("pointermove", (ev) => { if (toqueLongo && Math.hypot(ev.clientX - toqueLongo.x, ev.clientY - toqueLongo.y) > 8) desistirDoToque(); });
  doc.addEventListener("pointerup", desistirDoToque);
  doc.addEventListener("pointercancel", desistirDoToque);
  doc.addEventListener("contextmenu", (ev) => {
    if ((ev.target as Element | null)?.closest?.("#quadro .qd-tarefa-cel .qd-com[data-com]")) { ev.preventDefault(); return; }
    const ic = (ev.target as Element | null)?.closest?.<HTMLElement>("#cabecalho .pg-ic");
    if (!ic) return;
    ev.preventDefault();
    abrirMenu(Number(ic.dataset["pagina"]), ic);
  });
  doc.addEventListener("keydown", (ev) => {
    const alvo = ev.target as Element | null;
    const m = alvo?.closest?.<HTMLElement>("#pg-menu");
    if (m) {
      const itens = [...m.querySelectorAll<HTMLElement>('[role="menuitem"]:not([aria-disabled])')];
      const at = itens.indexOf(alvo as HTMLElement);
      if (ev.key === "Escape" || ev.key === "Tab") { ev.preventDefault(); fecharMenu(true); return; }
      if (ev.key === "ArrowDown" || ev.key === "ArrowUp") { ev.preventDefault(); itens[(at + (ev.key === "ArrowDown" ? 1 : itens.length - 1)) % itens.length]?.focus(); return; }
      return;
    }
    const ic = alvo?.closest?.<HTMLElement>("#cabecalho .pg-ic");
    if (ic && (ev.key === "ContextMenu" || (ev.shiftKey && ev.key === "F10"))) { ev.preventDefault(); abrirMenu(Number(ic.dataset["pagina"]), ic); }
  });

  /**
   * Anda uma página na ordem da pílula (a arrastada), parando nas pontas: ⌘[ ⌘] e ⌥← →. Com `foco` (a tecla veio do ícone
   * da doca) o foco vai junto; longe da pílula, a doca abre por um instante (NOD-461). false = não andou (sem pílula, uma
   * página só ou já na ponta).
   */
  function andar(passo: -1 | 1, op: { foco?: boolean; espiar?: boolean } = {}): boolean {
    if (chave === null || paginas.length < 2) return false;
    const pos = posDe(pagina) + passo;
    if (pos < 0 || pos >= paginas.length) return false;
    irPara(naPos(pos), { foco: op.foco });
    if (op.espiar && !op.foco) gestos.espiar();
    return true;
  }
  /** NOD-461: ⌥⇧← → leva a página atual uma posição na ordem; longe da pílula, a doca abre por um instante. */
  function moverAtual(passo: -1 | 1, op: { foco?: boolean } = {}): boolean {
    if (!agenteId || chave === null || paginas.length < 2) return false;
    const de = posDe(pagina);
    if (de + passo < 0 || de + passo >= paginas.length) return false;
    moverPagina(de, de + passo, { foco: op.foco });
    if (!op.foco) gestos.espiar();
    return true;
  }
  /** Quantas páginas a pílula mostra agora (0 = sem pílula: experimento desligado ou outra tela). */
  const totalDePaginas = (): number => (chave === null ? 0 : paginas.length);
  /**
   * ADA-19 (QA do PR #704): o quadro tocado na aba Quadros do celular abre a conversa e pede a página na mesma hora, antes
   * de as páginas da pílula chegarem. Sem ela ainda, o pedido espera o `sincronizar` que as traz (o da conversa do mesmo
   * bot); outra conversa, ou as páginas lidas sem ela, o esquecem.
   */
  let paginaPedida: { agenteId: string; id: string } | null = null;
  function abrirPagina(id: string): void {
    const i = indicePeloId(paginas, id);
    paginaPedida = i < 0 && agenteId !== null && chave !== null ? { agenteId, id } : null;
    if (i >= 0) irPara(i);
  }
  function abrirPaginaPedida(): void {
    if (!paginaPedida) return;
    if (chave === null || paginaPedida.agenteId !== agenteId) { paginaPedida = null; return; }
    const i = indicePeloId(paginas, paginaPedida.id);
    if (i >= 0) { paginaPedida = null; irPara(i); }
    else if (paginasDtoDe(agenteId)) paginaPedida = null;
  }
  function marcarChegada(id: string): void {
    chegou = { id, ate: Date.now() + 1200 };
    marcar();
  }

  const gestos = ligarGestosDaPilula(doc, {
    irPara: (pos) => irPara(naPos(pos)), atual: () => posDe(pagina), total: totalDePaginas, reduzido,
    mover: (de, para) => moverPagina(de, para), menu: (pos, el) => abrirMenu(naPos(pos), el),
    busca: o.busca, menuDaPilula: o.menuDaPilula,
  });

  /**
   * ADA-14 (ADR-153): a lista do seletor, lida antes do 1º quadro do bot. O quadro que a tela abre é o que um link pediu,
   * senão o último aberto (o servidor guarda), senão o padrão. Sem a API dos N quadros (ou se a lista falhar), segue o
   * quadro único de antes: o servidor dá o padrão.
   */
  async function prepararSeletor(a: ApiDoQuadro, de: string): Promise<void> {
    const pedido = quadroPedido?.agenteId === de ? quadroPedido.quadroId : null;
    if (pedido) quadroPedido = null;
    if (!a.quadrosDoBot) { if (pedido) a.usarQuadro?.(de, pedido); return; }
    if (selDe === de && !pedido) return;
    try {
      const lido = await a.quadrosDoBot(de);
      if (de !== agenteId) return;
      sel = lido; selDe = de;
    } catch { if (de === agenteId) { sel = null; selDe = de; } }
    const { alvo, gravar } = quadroQueAbre(sel, pedido);
    a.usarQuadro?.(de, alvo);
    if (gravar && sel && alvo) {
      sel = { ...sel, aberto: alvo };
      void a.abrirQuadroDoBot?.(de, alvo).catch(() => undefined);
    }
  }

  /** Abre ou fecha o seletor. Aberto, relê a lista (as contagens mudam com o trabalho) e põe o foco no quadro atual. */
  async function abrirSeletor(abrir: boolean): Promise<void> {
    selAberto = abrir; selBusca = ""; selCriando = null; selErro = null;
    desenharVista();
    if (!abrir) { focarNaVista('.qm-cab-bt, [data-act="quadro-seletor"]'); return; }
    focarNaVista('#qd-qs-busca, .qd-qs-it[aria-current="true"], .qd-qs-it');
    const a = dd?.api();
    const de = agenteId;
    if (!a?.quadrosDoBot || !de) return;
    try {
      const lido = await a.quadrosDoBot(de);
      if (de !== agenteId || !selAberto) return;
      // A lista nova não troca o quadro na tela: o aberto continua o desta tela.
      sel = { ...lido, aberto: sel?.aberto ?? lido.aberto };
      if (!vista()?.querySelector("#qd-qs-pop")?.contains(doc.activeElement)) return void desenharVista();
      const foco = doc.activeElement instanceof HTMLElement ? doc.activeElement : null;
      const id = foco?.id || null;
      const qid = foco?.dataset["id"] ?? null;
      desenharVista();
      focarNaVista(id ? `#${CSS.escape(id)}` : qid ? `.qd-qs-it[data-id="${CSS.escape(qid)}"]` : ".qd-qs-it");
    } catch { /* fica a lista que já estava */ }
  }

  /** Troca o quadro na tela: o servidor guarda como o último aberto deste bot; a tarefa aberta fecha. */
  async function escolherQuadro(quadroId: string): Promise<void> {
    const a = dd?.api();
    const de = agenteId;
    if (!a || !de || !sel) return;
    selAberto = false; selBusca = ""; selCriando = null; selErro = null;
    if (quadroId === sel.aberto && q?.id === quadroId) { desenharVista(); focarNaVista('[data-act="quadro-seletor"]'); return; }
    sel = { ...sel, aberto: quadroId };
    a.usarQuadro?.(de, quadroId);
    if (aberta) { aberta = null; dd?.naUrl?.(null); }
    edicao = null; editandoMeta = false; nova = null; filtro = "todos"; busca = "";
    carga = "carregando"; desenharVista();
    void a.abrirQuadroDoBot?.(de, quadroId).catch(() => undefined);
    await lerQuadro();
    if (de === agenteId) { anunciar(`Quadro ${sel?.quadros.find((x) => x.id === quadroId)?.nome ?? ""} aberto`); focarNaVista('[data-act="quadro-seletor"]'); }
  }

  /** "+ Novo quadro" (no projeto escolhido) e "+ Novo projeto" pela tela: as mesmas ações do gerir_quadro. */
  async function criarNoSeletor(form: HTMLFormElement, qual: "novo-quadro" | "novo-projeto"): Promise<void> {
    const a = dd?.api();
    const de = agenteId;
    if (!a || !de) return;
    const nomeNovo = (form.querySelector<HTMLInputElement>('[name="nome"]')?.value ?? "").trim().replace(/\s+/g, " ");
    if (!nomeNovo) return;
    if (form.dataset["enviando"] === "1") return;
    form.dataset["enviando"] = "1";
    const voltar = (erro: string) => {
      if (de !== agenteId) return;
      selErro = erro; desenharVista();
      const c = vista()?.querySelector<HTMLInputElement>("#qd-qs-novo-in");
      if (c) { c.value = nomeNovo; c.focus(); }
    };
    try {
      if (qual === "novo-projeto") {
        const p = await a.criarProjeto?.({ nome: nomeNovo });
        if (de !== agenteId || !p) return;
        sel = a.quadrosDoBot ? await a.quadrosDoBot(de).then((l) => ({ ...l, aberto: sel?.aberto ?? l.aberto })) : sel;
        selCriando = { tipo: "quadro", projeto: p.id }; selErro = null;
        desenharVista(); focarNaVista("#qd-qs-novo-in");
        anunciar(`Projeto ${nomeNovo} criado. Agora o nome do quadro.`);
        return;
      }
      const projeto = form.querySelector<HTMLSelectElement>('[name="projeto"]')?.value || null;
      const r = await a.criarQuadro(de, { nome: nomeNovo, ...(projeto ? { projeto } : {}) });
      if (de !== agenteId) return;
      const novo = r.quadro;
      if (!novo) throw new Error("sem quadro");
      a.usarQuadro?.(de, novo.id);
      void a.abrirQuadroDoBot?.(de, novo.id).catch(() => undefined);
      selAberto = false; selCriando = null; selErro = null; selBusca = "";
      if (aberta) { aberta = null; dd?.naUrl?.(null); }
      if (a.quadrosDoBot) { try { sel = { ...(await a.quadrosDoBot(de)), aberto: novo.id }; } catch { /* a lista antiga serve */ } }
      if (de !== agenteId) return;
      aplicarQuadro(r.quadro);
      mudarFaixa({ tipo: "resposta", texto: `Quadro ${nomeNovo} criado.`, loteId: r.lote?.id ?? null, mensagemId: "" });
      focarNaVista('[data-act="quadro-seletor"]');
    } catch (e) {
      voltar(e instanceof ErroApi ? e.message : "Não deu para criar agora. Tente de novo.");
    } finally { delete form.dataset["enviando"]; }
  }

  // ADA-14: a busca do seletor filtra a cada tecla (o foco e o cursor voltam ao campo depois do desenho).
  doc.addEventListener("input", (ev) => {
    const el = ev.target;
    if (!dd || !selAberto || !(el instanceof HTMLInputElement) || el.id !== "qd-qs-busca") return;
    selBusca = el.value;
    const fim = el.selectionStart ?? el.value.length;
    desenharVista();
    const c = vista()?.querySelector<HTMLInputElement>("#qd-qs-busca");
    if (c) { focarSemRolar(c); c.setSelectionRange(fim, fim); }
  });
  // Esc fecha o seletor (o formulário de criar primeiro); Enter na busca abre o único quadro que sobrou.
  doc.addEventListener("keydown", (ev) => {
    if (!dd || !selAberto) return;
    const el = ev.target instanceof Element ? ev.target : null;
    if (ev.key === "Escape" && el?.closest("#qd-qs-pop, .qd-qs")) {
      ev.preventDefault(); ev.stopPropagation();
      if (selCriando) { selCriando = null; selErro = null; desenharVista(); focarNaVista('[data-act="quadro-novo"]'); }
      else void abrirSeletor(false);
      return;
    }
    if (ev.key === "Enter" && el instanceof HTMLInputElement && el.id === "qd-qs-busca") {
      ev.preventDefault();
      const itens = vista()?.querySelectorAll<HTMLElement>(".qd-qs-it") ?? [];
      if (itens.length === 1) void escolherQuadro(itens[0]!.dataset["id"] ?? "");
    }
  }, true);
  // Clique fora do seletor fecha (no computador; no celular o fundo da folha faz o mesmo).
  doc.addEventListener("click", (ev) => {
    if (!dd || !selAberto || !(ev.target instanceof Element)) return;
    if (ev.target.closest(".qd-qs")) return;
    selAberto = false; selCriando = null; selErro = null; selBusca = "";
    desenharVista();
  }, true);

  /**
   * NOD-416: o link da tarefa. Com o quadro já lido, abre; senão espera a leitura (aplicarQuadro). Sem o quadro liberado
   * ainda (chave nula: as preferências chegam depois da frota no boot), guarda o pedido; o próximo `sincronizar` com a
   * conversa deste bot o consome, e o de outra conversa o esquece (revisão 5 do PR #623).
   */
  function abrirPeloLink(de: string, tarefaId: string, quadroId?: string): void {
    if (!dd) return;
    // ADA-14: o link sabe o quadro da tarefa (um dos N do bot): a próxima leitura abre nele.
    if (quadroId) quadroPedido = { agenteId: de, quadroId };
    if (chave === null) { viaDaAbertura = "link"; pendente = { agenteId: de, tarefaId }; return; }
    if (agenteId !== de) return;
    if (carga === "ok" && tarefaNoQuadro(q, tarefaId)) {
      quadroPedido = null;
      if (modo !== "quadro") { viaDaAbertura = "link"; trocar("quadro", { pagina: paginaDasTarefas() }); }
      else if (pagina !== paginaDasTarefas()) { viaDaAbertura = "link"; irPara(paginaDasTarefas()); }
      abrirTarefa(tarefaId);
      return;
    }
    pendente = { agenteId: de, tarefaId };
    if (modo !== "quadro") { viaDaAbertura = "link"; trocar("quadro", { pagina: paginaDasTarefas() }); }
    else if (pagina !== paginaDasTarefas()) { viaDaAbertura = "link"; irPara(paginaDasTarefas()); }
    else { void lerQuadro(); return; }
    // O quadro já lido é outro dos N do bot: relê no quadro do link.
    if (quadroPedido?.agenteId === de && carga === "ok") void lerQuadro();
  }

  const aCaminhoDoQuadro = (de: string): boolean => pendente?.agenteId === de || pedidoDoChat?.agenteId === de;

  /** NOD-445: a página Tarefas da pílula (a 1 sem pílula). */
  function paginaDasTarefas(): number {
    return Math.max(1, indicePeloId(paginas, TAREFAS.id));
  }

  return { sincronizar, trocar, irPara, andar, moverAtual, totalDePaginas, abrirPagina, marcarChegada, aoFrame, reler, abrirTarefaDe, modo: () => modo, pagina: () => pagina, abrirTarefa: abrirPeloLink, aCaminhoDoQuadro,
    atualizarPilula: atualizarBotaoDaPilula, pilula: () => (modo === "quadro" ? pilulaNaTela() : null) };
}
