import { semCitacao } from "./citacao.ts";
import type { AnexoMeta } from "../contracts/anexo.ts";
import type { PlataformaMaquina } from "../contracts/ponte.ts";
import { comandoDaConversa, traduzirParaOCli } from "./comandos.ts";
import { COMANDO_CONFIGURAR, entradaDaReconfiguracao } from "./reconfiguracao.ts";
import type { Agente, EsforcoAgente } from "../contracts/agente.ts";
import type { Concessao } from "../contracts/concessao.ts";
import type { Conector } from "../contracts/conector.ts";
import type { Autoria, Executor } from "../contracts/evento.ts";
import { FERRAMENTAS_NOD, type NomeFerramentaNod } from "../contracts/ferramentas-nod.ts";
import { HARNESS_LEGADO, type IdHarness } from "../contracts/harness.ts";
import type { Inventario } from "../contracts/inventario.ts";
import type { Memoria } from "../contracts/memoria.ts";
import type { Confianca } from "../contracts/mensagem.ts";
import type { FerramentaPlano, ModoTurno, PlanoTurno, ServidorPlano } from "../contracts/plano-turno.ts";
import type { Profundidade, Turno } from "../contracts/turno.ts";
import { ORCAMENTO_RESULTADO_CHARS } from "../shared/constantes.ts";
import { nuncaPermanente } from "./aprovacao-permanente.ts";
import { conectorTocaDadoPessoal } from "./dado-pessoal.ts";
import { ErroDeDominio } from "./erro.ts";
import { comArquivoDoMac } from "./arquivo-do-mac.ts";
import { resolverLocalidade } from "./localidade-turno.ts";
import { montarFerramentas } from "./montagem-ferramentas.ts";
import { ehPastaDeTask, motivoSemTerminal, nativasDoTurno, pastaDoBot } from "./nativas.ts";
import { aPedidoDeOutraPessoa, modoNoTurno } from "./modo-aprovacao.ts";
import { caminhoDoClone, CLONE_DA_MAQUINA, repoDoGithub, type MotivoSaida } from "./clone-da-maquina.ts";
import { podeAbrirTask, podeMandarParaTask } from "./trabalho.ts";
import { daFaixaDaPessoa } from "./triagem.ts";
import { ehFrente, FERRAMENTA_DA_FRENTE, FERRAMENTAS_FORA_DA_FRENTE, worktreeDaFrente } from "./frente.ts";
import type { OrigemTrabalho } from "../contracts/trabalho.ts";
import type { FormaTrabalho } from "../contracts/frente.ts";
import { manualDoNod } from "./manual-do-nod.ts";
import { ehNod } from "./nod.ts";
import { FERRAMENTA_RESPONDER_PEDIDO, temPedidosNoTurno, type PedidoPendenteNoPrompt } from "./pedidos-pendentes.ts";
import { janelaDoModelo, orcamentoDoTurno, precisaEnxugar, type OrcamentoContexto } from "./orcamento-contexto.ts";
import { partesDoPromptSistema, trechoComClone, trechoDoClone, type BastidorNoPrompt, type EntradaPromptSistema, type RotinaNoPrompt, type TrabalhoNoPrompt } from "./prompt-sistema.ts";
import { FERRAMENTAS_COMPUTADOR } from "../contracts/ferramentas-computador.ts";
import { FERRAMENTA_ANEXAR_MIDIA, FERRAMENTA_LER_MAIS } from "../contracts/ferramentas-proxy.ts";
import type { ComputadorFora } from "./prompt-sistema.ts";
import { FERRAMENTAS_WORKSPACE } from "../contracts/ferramentas-workspace.ts";

/**
 * Ferramentas nod por modo (definido em 2026-09-16): conversa e sala têm o kit completo; rotina
 * pede a colega (definido em 2026-09-17; pedir_a_bot desde 2026-09-29, ADR-058) e encerra em silêncio por sem_novidade
 * (definido em 2026-09-21 — só faz sentido onde ninguém está esperando resposta, por isso não entra
 * em conversa nem em sala); peer é texto-só, sem salto (E12.4). pedir_a_pessoa (EMENDA 16) entra
 * onde há pessoa para destravar: criação, conversa, sala e rotina — não em peer (o remetente é outro bot).
 *
 * Criação (revisto em 2026-09-28, ADR-050, "bot novo é bot completo"): é o kit da conversa MAIS
 * atualizar_perfil. Antes eram só quatro ferramentas, e a Teodora, pedida para assumir o que três
 * colegas faziam, respondeu "não consigo" cinco vezes — não via os colegas, não perguntava, não
 * delegava. Perfil vazio não é trava de capacidade: é uma linha no prompt (prompt-sistema.ts).
 * ver_colegas (ADR-050) entra onde a pessoa está: criação, conversa e sala.
 *
 * pedir_acesso entra na rotina desde 2026-09-24 (ADR-044): ele só PROPÕE — quem decide é a pessoa,
 * num botão —, e sem ele a rotina sem acesso pedia por pedir_a_pessoa em texto a cada execução. No
 * turno de rotina o domínio só aceita leitura (pedido-acesso.ts).
 *
 * Ciclo de vida de rotina (listar/pausar/reativar, definido em 2026-09-21) só em conversa e sala,
 * onde a pessoa está presente para pedir e conferir — e, desde a ADR-050, na criação, pelo mesmo motivo.
 * FORA de propósito em: peer (quem fala é outro bot,
 * e mexer em rotina por pedido de bot burlaria o corte de segundo salto do ADR-035) e rotina — este
 * é o caso perigoso: um turno acordado por agendamento que pudesse se pausar sozinho viraria uma
 * rotina que se desliga por conta própria, e o modo rotina já é explicitamente "a própria execução",
 * não a hora de reconfigurar. Quem reconfigura é a pessoa, na conversa.
 *
 * delegacao (definido em 2026-09-24, ADR-047; revisto em 2026-09-29, ADR-058): o turno de quem cumpre um
 * pedido de colega (pedir_a_bot), com os acessos dele. Tem pedir_acesso (inclusive escrita) e os caminhos
 * de aprovação; não tem rotina. pedir_a_bot entra em todo modo em que um bot trabalha para a pessoa: criação,
 * conversa, sala e rotina — e, desde 2026-09-30 (ADR-063), também na delegação: o Chico, pedido pela Clarice a
 * acionar os Devs, não tinha como. Quem corta o salto é a profundidade (montarFerramentas), não o modo.
 * peer é legado (perguntar_a_bot saiu na ADR-058).
 *
 * publicar_artefato/ler_artefato (definido em 2026-09-28, ADR-051) entram onde o bot fala com UMA pessoa
 * na conversa dele: conversa e rotina — e a retomada, que cai num dos dois (modoDoTurno). Fora da sala
 * (o estado é por pessoa e a sala tem várias; a RLS do artefato não tem perna de sala), da criação, do
 * peer (quem lê é outro bot) e da delegação (o resultado volta ao remetente, não à pessoa).
 *
 * revisto em 2026-10-01 (ADR-066, "o bot tem o que você deu; o modo decide"): rotina e delegação ganham ver_colegas
 * (leitura confiável que "não incomoda ninguém"), e a delegação, o artefato — o turno dela roda na conversa própria
 * de quem recebe, onde o artefato aparece. Criar e mudar rotina continuam fora da rotina e da delegação: a rotina
 * zera a corrente (ADR-063), e isso lavaria o limite de passes.
 *
 * me_chame_as (definido em 2026-10-08, ADR-086): esperar algo de fora fora do Mac — em todo modo em que o bot trabalha
 * com tempo (criação, conversa, rotina e delegação). A sala (várias pessoas) e a ligação (ao vivo) não esperam assim.
 *
 * Tasks (definido em 2026-10-07, ADR-083 §7): abrir_task e mandar_para_task são da conversa coordenadora; a rotina abre
 * tasks (profundidade 1). Quem decide no turno é `podeAbrirTask`/`podeMandarParaTask` pelo trabalho dele: o turno de uma
 * task da pessoa, de colega, da rede ou filha de rotina não abre nem repassa (montarPlano filtra).
 *
 * buscar_conversas/ler_conversa (definido em 2026-10-29, NOD-61): leitura do histórico do próprio bot em todo modo em que ele
 * trabalha para a pessoa (criação, conversa, sala, rotina e ligação); não no peer. O recorte por bot (e o de membro na sala)
 * é do repo. Revisão 3 (M1/M2): nem no pedido de outro bot — a delegação e todo turno que herdou `sobProcuracaoDe` (frente,
 * retomada, lote de um pedido) ficam sem as duas: quem pediu pode ser de outra pessoa ou estar numa sala, e a resposta volta
 * para lá com o histórico largo do bot.
 *
 * ver_agenda (definido em 2026-10-29, NOD-85, revisão 1 do PR #595): lê as rotinas de TODOS os bots que a pessoa vê, não
 * só as do bot do turno (listar_rotinas). Por isso segue a regra do histórico: fora da sala (outras pessoas leem) e fora
 * do pedido de outro bot (a resposta volta para quem pediu).
 *
 * Frentes (definido em 2026-10-12, ADR-099, I2): abrir_frentes e mandar_para_frente entram no lugar de abrir_task e
 * mandar_para_task (que seguem atendidos como sinônimos, fora do catálogo). O turno de uma frente perde me_chame_as e
 * esperar_comando (ela devolve o fato e termina; quem espera é o dono) e ganha devolver_resumo (montarPlano).
 *
 * Triagem (definido em 2026-10-12, ADR-099 item 1a, I7 revista): o pedido de colega e o de rotina entram como um turno do
 * dono fora de trabalho; ali ele abre frentes (abrir_frentes) ou junta o pedido a uma frente aberta (mandar_para_frente).
 * Por isso a delegação e a rotina têm as duas; `podeAbrirTask`/`podeMandarParaTask` as tiram do turno que já é trabalho
 * (a task de colega de antes, a filha de rotina, a frente), e a execução de rotina com mãe só abre, como antes.
 */
/** NOD-449: nao_lidos também (quem falou com a pessoa e quando; marcar é dela): fora do turno a pedido de outro bot. */
const FERRAMENTAS_DO_HISTORICO: readonly NomeFerramentaNod[] = ["buscar_conversas", "ler_conversa", "ver_agenda", "nao_lidos"];
const aPedidoDeOutroBot = (t: { sobProcuracaoDe?: string | null }) => !!t.sobProcuracaoDe;
/**
 * NOD-443 (ADR-143, revisão 3 do PR #628): o turno a pedido de outra pessoa não fala com colegas nem pede a chave em nome
 * da dona. pedir_a_bot e encaminhar levariam a procuração adiante (um salto a mais sob o pedido do membro); pedir_credencial
 * abriria um cartão de chave para a dona por vontade de outra pessoa. O pedido_a_bot recusa também no caso de uso.
 */
/**
 * Revisão 4 do PR #628, achado 2: nem grava estado da dona por vontade de outra pessoa. lembrar (a memória dela),
 * abrir_frentes/mandar_para_frente (as frentes dela), me_chame_as (um despertar na conta dela), publicar_artefato (um
 * artefato dela), as rotinas (automação dela), atualizar_perfil e ajustar_barra_lateral (o bot e a tela dela) e
 * pedir_acesso (uma concessão de conector, como pedir_credencial). O resultado volta pela tarefa (gerir_quadro).
 */
export const FORA_DO_PEDIDO_DE_OUTRA_PESSOA: readonly NomeFerramentaNod[] = [
  "pedir_a_bot", "encaminhar", "pedir_credencial", "pedir_acesso", "lembrar", "abrir_frentes", "mandar_para_frente", "me_chame_as", "publicar_artefato",
  "criar_rotina", "atualizar_rotina", "excluir_rotina", "pausar_rotina", "reativar_rotina", "atualizar_perfil", "ajustar_barra_lateral",
  // Revisão 6 do PR #628, achados 2 e 4: nem lê o que é da dona — os bots dela com rotinas e apps (ver_colegas), as rotinas
  // do bot (listar_rotinas) e os artefatos da conversa dela (ler_artefato).
  "ver_colegas", "listar_rotinas", "ler_artefato",
  // ADA-13: os canvas são da dona (protótipos e comentários dela).
  "gerir_canvas",
];

/**
 * Revisão 6 do PR #628, achado 5: a lista que o caso de uso (chamarFerramenta) confere de novo no turno a pedido de outra
 * pessoa, para qualquer plano que chegue — só ferramenta do nod, fora das que leem ou gravam o que é da dona e fora do
 * histórico. montarPlano corta pelo mesmo critério.
 */
export function permitidaAPedidoDeOutraPessoa(f: Pick<FerramentaPlano, "nome" | "origem">): boolean {
  const fora: readonly string[] = [...FORA_DO_PEDIDO_DE_OUTRA_PESSOA, ...FERRAMENTAS_DO_HISTORICO];
  return f.origem === "nod" && !fora.includes(f.nome);
}

export const FERRAMENTAS_NOD_POR_MODO: Record<ModoTurno, readonly NomeFerramentaNod[]> = {
  criacao: ["atualizar_perfil", "lembrar", "pedir_aprovacao", "pedir_acesso", "pedir_credencial", "criar_rotina", "listar_rotinas", "ver_agenda", "pausar_rotina", "reativar_rotina", "atualizar_rotina", "excluir_rotina", "ver_colegas", "pedir_a_bot", "pedir_a_pessoa", "publicar_artefato", "ler_artefato", "abrir_frentes", "mandar_para_frente", "me_chame_as", "avisar_pessoa", "buscar_conversas", "ler_conversa", "ajustar_barra_lateral", "nao_lidos", "gerir_times", "gerir_acessos", "gerir_maquinas", "remover_computador"],
  // NOD-119: o card da barra lateral só onde a pessoa olha o chat (conversa e criação). NOD-449: nao_lidos também (o card e o recibo). ADA-243: gerir_maquinas também (a máquina padrão é a pedido da pessoa).
  conversa: ["lembrar", "pedir_aprovacao", "pedir_acesso", "pedir_credencial", "criar_rotina", "listar_rotinas", "ver_agenda", "pausar_rotina", "reativar_rotina", "atualizar_rotina", "excluir_rotina", "ver_colegas", "pedir_a_bot", "pedir_a_pessoa", "publicar_artefato", "ler_artefato", "abrir_frentes", "mandar_para_frente", "me_chame_as", "avisar_pessoa", "buscar_conversas", "ler_conversa", "ajustar_barra_lateral", "nao_lidos", "gerir_times", "gerir_acessos", "gerir_maquinas", "remover_computador"],
  sala: ["lembrar", "pedir_aprovacao", "pedir_acesso", "pedir_credencial", "criar_rotina", "listar_rotinas", "pausar_rotina", "reativar_rotina", "atualizar_rotina", "excluir_rotina", "ver_colegas", "pedir_a_bot", "pedir_a_pessoa", "passar", "encaminhar", "buscar_conversas", "ler_conversa"],
  // NOD-50 (revisão 6 do PR #553): rotina sem pedir_credencial — o cartão não segura a execução seguinte, que abriria outro a cada
  // disparo; a rotina que precisa de chave pede pela pessoa (pedir_a_pessoa) ou pela conversa.
  rotina: ["lembrar", "pedir_aprovacao", "pedir_acesso", "ver_colegas", "pedir_a_pessoa", "pedir_a_bot", "sem_novidade", "publicar_artefato", "ler_artefato", "abrir_frentes", "mandar_para_frente", "me_chame_as", "avisar_pessoa", "buscar_conversas", "ler_conversa"],
  peer: ["lembrar"],
  // NOD-114: avisar_pessoa na conversa e na criação (a task que roda sem a pessoa olhando), na rotina e no pedido de colega.
  delegacao: ["lembrar", "pedir_acesso", "pedir_credencial", "pedir_aprovacao", "ver_colegas", "pedir_a_pessoa", "pedir_a_bot", "publicar_artefato", "ler_artefato", "abrir_frentes", "mandar_para_frente", "me_chame_as", "avisar_pessoa"],
  // definido em 2026-10-04 (ADR-072): a ligação fala com a pessoa ao vivo. O kit da conversa sem pedir_a_pessoa (a
  // pergunta é a própria fala) e sem artefatos (não há tela para lê-los); trabalho demorado vai por iniciar_tarefa.
  ligacao: ["lembrar", "pedir_aprovacao", "pedir_acesso", "criar_rotina", "listar_rotinas", "ver_agenda", "pausar_rotina", "reativar_rotina", "atualizar_rotina", "excluir_rotina", "ver_colegas", "pedir_a_bot", "iniciar_tarefa", "desligar", "buscar_conversas", "ler_conversa"],
};

/**
 * revisto em 2026-10-01 (ADR-067): o plano vale enquanto o turno vive. Era 1 h (a janela do cache ephemeral_1h do CLI,
 * 2026-09-16) — e um turno de testes, CI ou QA que passava de uma hora ficava sem nenhuma ferramenta. Quem encerra o
 * plano é o fim do turno: a entrega revoga o token, o Parar e a exclusão do agente negam a chamada (execucaoBloqueada,
 * paradas) e o lease vencido assenta o turno. O campo `expiraEm` continua no contrato, com este valor.
 */
/**
 * definido em 2026-10-04 (ADR-077): as três ferramentas do onboarding por ligação. Somam-se ao catálogo `ligacao` só
 * quando o plano é da ligação que o produto iniciou com o onboarding da pessoa em curso (`EntradaPlano.onboarding`).
 */
export const FERRAMENTAS_NOD_ONBOARDING: readonly NomeFerramentaNod[] = ["anotar_entrevista", "concluir_entrevista", "propor_bot"];

/**
 * definido em 2026-10-07 (ADR-081/082): as ferramentas que só o Nod tem. Somam-se ao catálogo quando o bot do turno é o
 * Nod E quem fala é a pessoa (conversa, criação) — a cerca 2: nem rotina, nem sala, nem ligação, nem pedido de colega.
 * O caso de uso confere de novo (turnoDoNodComAPessoa).
 */
export const FERRAMENTAS_DO_NOD: readonly NomeFerramentaNod[] = ["gerir_bots", "ver_apps_conectados", "registrar_relato"];
const MODOS_DAS_MAOS_DO_NOD: readonly ModoTurno[] = ["conversa", "criacao"];

/**
 * definido em 2026-10-13 (NOD-210, ADR-104): criar_bots é dos bots comuns, nos mesmos modos em que a pessoa fala com o
 * bot (conversa, criação). O Nod fica com gerir_bots, que já cria; rotina, sala, ligação e pedido de colega não criam
 * bots. O caso de uso confere de novo (criar-bots.ts).
 */
export const FERRAMENTA_CRIAR_BOTS: NomeFerramentaNod = "criar_bots";

/** NOD-23 (emenda da ADR-050): a ferramenta que a conversa ganha em reconfiguração (src/domain/reconfiguracao.ts). */
export const FERRAMENTA_RECONFIGURACAO: NomeFerramentaNod = "atualizar_perfil";

/**
 * NOD-23: a reconfiguração só vale na conversa da pessoa com um bot comum, fora de task (a frente e a task filha não
 * mudam o perfil de quem as abriu). Quem diz se a janela está viva e se o bot é elegível é emitir-plano-turno.
 */
export function emReconfiguracaoNoPlano(entrada: Pick<EntradaPlano, "reconfiguracao" | "modo" | "agente" | "trabalho">): boolean {
  return entrada.reconfiguracao === true && entrada.modo === "conversa" && !ehNod(entrada.agente) && !entrada.trabalho;
}

/** NOD-23: fora da reconfiguração, /configurar não vai cru ao CLI (que não o conhece); o bot só explica onde vale. */
const CONFIGURAR_FORA = "A pessoa escreveu /configurar, que reconfigura um bot próprio já confirmado. Aqui ele não vale. Diga isso em uma frase, sem usar ferramentas.";

/** A entrada do turno: /configurar vira o pedido da entrevista (ou a explicação); os outros comandos, o do CLI. */
function entradaDoTurno(texto: string, harness: IdHarness | null | undefined, reconfigura: boolean): string {
  const c = comandoDaConversa(semCitacao(texto));
  if (c?.comando.nome === COMANDO_CONFIGURAR) return reconfigura ? entradaDaReconfiguracao(c.resto) : CONFIGURAR_FORA;
  return traduzirParaOCli(texto, harness);
}

export const PLANO_SEM_VALIDADE = Number.MAX_SAFE_INTEGER;

export const REGRA_MONTAGEM = "regra:montagem-ferramentas" as const;

const SO_LEITURA: ReadonlySet<NomeFerramentaNod> = new Set(["ler_artefato", "buscar_conversas", "ler_conversa", "ver_agenda"]);

function ferramentaNod(nome: NomeFerramentaNod): FerramentaPlano {
  const base: FerramentaPlano = { nome, nomeMcp: `mcp__nod__${nome}`, origem: "nod", conectorId: null, readOnlyHint: false, tocaDadoPessoal: false, schema: FERRAMENTAS_NOD[nome] };
  // definido em 2026-09-28 (ADR-051): ler_artefato só lê, e o resultado dela tem orçamento próprio no
  // proxy — o do turno (8 000) cortaria o HTML que a ferramenta promete devolver.
  // NOD-61: buscar_conversas e ler_conversa também só leem.
  return SO_LEITURA.has(nome) ? { ...base, readOnlyHint: true } : base;
}

/** conector habilitado ∩ concessão do agente por capacidade → `${slug}__${tool}` (E6). */
function ferramentasDeConectores(conectores: readonly Conector[], concessoes: readonly Concessao[], agenteId: string): { ferramentas: FerramentaPlano[]; servidores: ServidorPlano[] } {
  const ferramentas: FerramentaPlano[] = [];
  const servidores: ServidorPlano[] = [];
  for (const c of conectores) {
    if (!c.habilitado) continue;
    const minhas = concessoes.filter((g) => g.agenteId === agenteId && g.conectorId === c.id).map((g) => g.capacidade);
    const caps = c.catalogo.filter((cap) => minhas.includes(cap.nome));
    if (caps.length === 0) continue;
    // definido em 2026-09-16: todo conteúdo de conector é não confiável (ADR-026), logo o servidor é 'untrusted' sempre
    servidores.push({ conectorId: c.id, nome: c.slug, trust: "untrusted", transporte: c.transporte });
    for (const cap of caps) {
      const nome = `${c.slug}__${cap.nome}`;
      // ADR-068: o campo de arquivo do app (`s3key`) diz ao bot que aceita o caminho do Mac.
      ferramentas.push({ nome, nomeMcp: `mcp__nod__${nome}`, origem: "conector", conectorId: c.id, readOnlyHint: cap.readOnlyHint, tocaDadoPessoal: conectorTocaDadoPessoal(c), schema: comArquivoDoMac(cap.schema) });
    }
  }
  return { ferramentas, servidores };
}

export type EntradaPlano = {
  workspace?: boolean;
  /** Já existe projeto autorizado? Sem ele o catálogo oferece só consultar e propor. */
  workspaceVinculado?: boolean;
  computador?: boolean;
  /**
   * definido em 2026-09-24 (emenda da ADR-037): o computador do bot existe mas não serve AGORA — a
   * pessoa desligou, ou três falhas seguidas o tiraram do ar. As ferramentas computador_* saem e o
   * prompt ganha uma linha (antes o plano as oferecia até com o computador desligado).
   */
  computadorFora?: ComputadorFora | null;
  turno: Turno;
  agente: Agente;
  memorias: readonly Memoria[];
  concessoes: readonly Concessao[];
  conectores: readonly Conector[];
  modo: ModoTurno;
  confianca: Confianca;
  profundidade: Profundidade;
  inventario: Inventario;
  executor: Executor;
  sessaoCli: string | null;
  /** ADR-046: metadados dos anexos da mensagem do turno, lidos pelo caso de uso. ADR-111: com a memória longa, também os anteriores. */
  anexos?: readonly AnexoMeta[];
  /** ADR-111: a chave "Calibração" da pessoa (preferencias.exp_calibracao). Ausente = desligada. */
  calibracao?: boolean;
  /** ADR-112: a chave "Modo WhatsApp" da pessoa (preferencias.exp_whatsapp). Ausente = desligada. */
  whatsapp?: boolean;
  /** ADR-115: o revisor do Automático ligado (`NOD_REVISOR`); só muda o texto do Automático no prompt. Ausente = desligado. */
  revisor?: boolean;
  /** NOD-346: o "Sobre mim" da pessoa, só quando o bot é dela (emitir-plano-turno confere). Ausente = sem a linha. */
  sobreMim?: string | null;
  pessoaNome: string;
  /** ADR-090: a máquina que roda o turno (nome e plataforma, do anúncio); ausente = o texto do Mac de sempre. */
  maquina?: { nome: string; plataforma: PlataformaMaquina } | null;
  colegas?: readonly Pick<Agente, "id" | "nome" | "titulo" | "descricao">[];
  contextoConversa?: string;
  /** Inventário para o modelo escolher SOBRE QUAL rotina agir; não confundir com `rotina` acima. */
  rotinasDoAgente?: readonly RotinaNoPrompt[];
  /** Nomes `${slug}__${tool}` das regras ATIVAS da pessoa para este agente (ADR-042). */
  semprePermitir?: readonly string[];
  /** Turno de quem cumpre um pedido de colega (ADR-047/058): de quem é o trabalho e quem pediu, para a linha do prompt. */
  delegacao?: { pessoaNome: string; remetenteNome: string } | null;
  /** A conversa tem projeto autorizado (ADR-039): só então as nativas de arquivo podem entrar (`nativasDoTurno`). */
  pastasAutorizadas?: boolean;
  /** O harness do turno tem o hook do nod (ADR-052; o Codex desde a ADR-103): libera o kit do terminal. */
  terminal?: boolean;
  /** NOD-323: a máquina do turno anunciou que não atende `anexar_midia` (app anterior): a ferramenta e a linha do prompt ficam fora. */
  semAnexarMidia?: boolean;
  /** A IA que roda o turno; ausente ou null = Claude Code (catcher, legado). Decide a tradução dos comandos da conversa. */
  harness?: IdHarness | null;
  /**
   * definido em 2026-10-10 (emenda da ADR-036): o raciocínio resolvido para a IA do turno (resolverHarness: a escolha do
   * bot ou o médio). Ausente (catcher, sem IA escolhida) = o `esforco` do agente, como antes.
   */
  raciocinio?: EsforcoAgente;
  /** ADR-077: ligação de onboarding (iniciada pelo produto, onboarding em curso): entram as ferramentas do onboarding. */
  onboarding?: boolean;
  /**
   * definido em 2026-10-07 (ADR-083): a pasta do trabalho relativa a `~/nod` (`<bot>/<slug>`). Com o terminal, ela vira a
   * `pastaDoBot` do plano: o driver a cria e a usa como diretório, e a cerca do git vale para ela. Ausente = a do bot.
   */
  pastaTrabalho?: string | null;
  /**
   * ADR-083: o trabalho deste turno (null = turno da conversa). Decide abrir_frentes/mandar_para_frente e a linha da task.
   * ADR-099 (I2): `forma` = `frente` muda o catálogo (devolver_resumo; sem me_chame_as nem esperar_comando) e o prompt.
   */
  /** `repo`: NOD-315 (ADR-119), o `dono/nome` da frente, para o clone da máquina. */
  trabalho?: { titulo: string; origem: OrigemTrabalho; trabalhoMaeId: string | null; forma?: FormaTrabalho; repo?: string | null } | null;
  /** ADR-083: as tasks abertas do bot, para a seção "Trabalhos em andamento" da conversa coordenadora. */
  trabalhosAbertos?: readonly TrabalhoNoPrompt[];
  /** ADR-130: o que o bot faz agora nos bastidores desta conversa; só chega ao prompt no turno da conversa. */
  bastidores?: readonly BastidorNoPrompt[];
  /** ADR-082: NOD_GERIR_BOTS=0 tira as ferramentas do Nod do catálogo (o interruptor de rollback sem reverter o PR). */
  semFerramentasDoNod?: boolean;
  /** ADR-104 (revisão do PR #309): NOD_CRIAR_BOTS=0 tira criar_bots do catálogo dos bots comuns, o mesmo interruptor. */
  semCriarBots?: boolean;
  /**
   * NOD-351: NOD_CONTAS=1 põe abrir_conta no catálogo da conversa, da criação e da sala (onde a pessoa está falando com o
   * bot e o cartão aparece). Fora de rotina, delegação, ligação, peer e frente: ninguém está ali para preencher o cartão.
   */
  contas?: boolean;
  /**
   * ADA-245 (revisão do PR #694): NOD_ONBOARDING_TEXTO=1 (desligada por padrão). Desligada, remover_computador sai do
   * catálogo: a jornada D inteira (tela e chat) fica atrás da flag, e um card aprovado desinstalaria o computador.
   */
  onboardingTexto?: boolean;
  /**
   * NOD-442: o experimento "Quadro" da pessoa ligado. Põe gerir_quadro no catálogo de QUALQUER bot (o Nod também) na
   * conversa, na criação, na rotina e no pedido de colega (a tarefa que o quadro começou é uma delegação). Desligado,
   * a ferramenta nem aparece (o caso de uso recusa de novo).
   */
  quadro?: boolean;
  /**
   * ADA-13 (ADR-150): o bot tem o app Canvas instalado e acesso concedido (o nível). Põe gerir_canvas na conversa, na
   * criação, na rotina e na delegação. Sem acesso, a ferramenta nem aparece (o caso de uso confere de novo).
   */
  canvas?: boolean;
  /**
   * definido em 2026-10-15 (NOD-262): os pedidos de colegas na fila do bot (delegações pendentes), os mais antigos
   * primeiro. Na conversa e na sala, com ao menos um, entram a linha do prompt e responder_pedido; ausente ou vazio = nada.
   */
  pedidosPendentes?: readonly PedidoPendenteNoPrompt[];
  /**
   * NOD-23: a conversa está em reconfiguração (/configurar há menos de 2 h, bot elegível; emitir-plano-turno confere).
   * Só vale no modo conversa, fora de task e fora do Nod: soma atualizar_perfil e troca a linha do modo pela da entrevista.
   */
  reconfiguracao?: boolean;
  /**
   * NOD-480 (emenda da ADR-040): a janela que o Claude Code informou no último turno deste bot com o mesmo modelo (Raio-X).
   * Ausente = pela tabela de `janelaDoModelo`.
   */
  janelaObservada?: number | null;
  agora: number;
};

/**
 * Plano de turno (ADR-024) montado no PUXAR, uma vez por turno: catálogo = nod por modo +
 * (conector ∩ concessão) ∩ profundidade — sem redução por confiança desde a ADR-066. Lança executor_indisponivel
 * quando a localidade recusa (inventário não 'pronto'). tokenDeTurno e machineId são do servidor.
 */
/** NOD-351: os modos com a pessoa na conversa, onde abrir_conta entra com NOD_CONTAS=1. Fora de task e frente: a tela delas não mostra o cartão. */
const MODOS_DA_CONTA: readonly ModoTurno[] = ["conversa", "criacao", "sala"];
const FERRAMENTA_ABRIR_CONTA: NomeFerramentaNod = "abrir_conta";
/** NOD-442: os modos com gerir_quadro (com o experimento ligado): onde a pessoa fala, a rotina e a tarefa delegada. */
export const MODOS_DO_QUADRO: readonly ModoTurno[] = ["conversa", "criacao", "rotina", "delegacao"];
/** ADA-13: onde o gerir_canvas entra (os do quadro: onde a pessoa ou a tarefa pede um protótipo). */
export const MODOS_DO_CANVAS: readonly ModoTurno[] = MODOS_DO_QUADRO;
/** NOD-445: os modos com gerir_apps (o mesmo experimento): a conversa (pedir, ordenar, remover) e a rotina (o retrato do app). */
export const MODOS_DOS_APPS: readonly ModoTurno[] = ["conversa", "criacao", "rotina"];

export function montarPlano(entrada: EntradaPlano): Omit<PlanoTurno, "tokenDeTurno" | "machineId"> {
  const esforco = entrada.raciocinio ?? entrada.agente.esforco ?? undefined;
  const tocaDadoPessoal = entrada.conectores.some((c) => c.habilitado && conectorTocaDadoPessoal(c));
  const localidade = resolverLocalidade({ origem: entrada.turno.origem, tocaDadoPessoal, motorExigido: entrada.turno.modelo, inventario: entrada.inventario });
  if ("recusado" in localidade) throw new ErroDeDominio("executor_indisponivel", { cause: localidade.motivo });

  // revisto em 2026-09-29 (ADR-058): profundidade não é mais "peer". No limite (ADR-063: três passes) ela corta o
  // salto (montarFerramentas tira pedir_a_bot e encaminhar), e o modo vem de modoDoTurno: quem cumpre o pedido é
  // 'delegacao', e a continuação de quem pediu é a retomada do turno dele (conversa, sala, rotina ou delegação).
  const modo: ModoTurno = entrada.modo;
  const doNod = ehNod(entrada.agente) && MODOS_DAS_MAOS_DO_NOD.includes(modo) && !entrada.semFerramentasDoNod ? FERRAMENTAS_DO_NOD : [];
  const criaBots: readonly NomeFerramentaNod[] = !ehNod(entrada.agente) && MODOS_DAS_MAOS_DO_NOD.includes(modo) && !entrada.semCriarBots ? [FERRAMENTA_CRIAR_BOTS] : [];
  // NOD-262: responder_pedido só na conversa e na sala, e só com pedido de colega na fila (o caso de uso confere de novo).
  const comPedidos = temPedidosNoTurno(modo, entrada.pedidosPendentes);
  const respondePedido: readonly NomeFerramentaNod[] = comPedidos ? [FERRAMENTA_RESPONDER_PEDIDO] : [];
  // NOD-443 (ADR-143, revisão 3 do PR #628): o turno a pedido de outra pessoa (quem participa do quadro da dona) roda no
  // manual, sem terminal, sem computador, sem pasta e sem pedir a colegas — o bot é da dona, a vontade é de outra pessoa
  // (confused deputy). O que muda algo fora vira pedido de aprovação para a dona; nada nativo escapa do proxy.
  const deOutraPessoa = aPedidoDeOutraPessoa(entrada.turno.sobProcuracaoDe, entrada.turno.ownerId);
  const nativas = deOutraPessoa ? [] : nativasDoTurno({ modo, confianca: entrada.confianca, pastasAutorizadas: entrada.pastasAutorizadas === true, terminal: entrada.terminal === true, harness: entrada.harness ?? null });
  // definido em 2026-10-12 (ADR-099, parte 2): esperar_comando entra onde o bot espera com tempo (os modos do me_chame_as)
  // E tem terminal — o comando roda pelas regras do Bash dele, na máquina e na pasta do turno. Sem terminal (Codex, sala,
  // ligação), não há onde rodar: fica o me_chame_as.
  const esperaComando: readonly NomeFerramentaNod[] = nativas.includes("Bash") && FERRAMENTAS_NOD_POR_MODO[modo].includes("me_chame_as") ? ["esperar_comando"] : [];
  const frente = ehFrente(entrada.trabalho);
  const reconfigura = emReconfiguracaoNoPlano(entrada);
  const abreConta: readonly NomeFerramentaNod[] = entrada.contas && MODOS_DA_CONTA.includes(modo) && !entrada.trabalho ? [FERRAMENTA_ABRIR_CONTA] : [];
  const geraQuadro: readonly NomeFerramentaNod[] = entrada.quadro && MODOS_DO_QUADRO.includes(modo) ? ["gerir_quadro", ...(MODOS_DOS_APPS.includes(modo) ? (["gerir_apps"] as const) : [])] : [];
  const usaCanvas: readonly NomeFerramentaNod[] = entrada.canvas && MODOS_DO_CANVAS.includes(modo) ? ["gerir_canvas"] : [];
  const nod = [...(reconfigura ? [FERRAMENTA_RECONFIGURACAO] : []), ...FERRAMENTAS_NOD_POR_MODO[modo], ...esperaComando, ...(modo === "ligacao" && entrada.onboarding ? FERRAMENTAS_NOD_ONBOARDING : []), ...doNod, ...criaBots, ...respondePedido, ...abreConta, ...geraQuadro, ...usaCanvas]
    .filter((n) => (n !== "abrir_frentes" || podeAbrirTask(entrada.trabalho ?? null)) && (n !== "mandar_para_frente" || podeMandarParaTask(entrada.trabalho ?? null)))
    .filter((n) => !frente || !FERRAMENTAS_FORA_DA_FRENTE.includes(n))
    .filter((n) => n !== "remover_computador" || entrada.onboardingTexto === true)
    // NOD-61 (revisões 2 e 3 do PR #594): pedido de outro bot (sobProcuracaoDe, herdado por frente/retomada/lote) não leva o
    // histórico. Aceito na revisão 5: o turno da conversa com responder_pedido mantém — a pessoa está ali e responde ela.
    .filter((n) => !aPedidoDeOutroBot(entrada.turno) || !FERRAMENTAS_DO_HISTORICO.includes(n))
    .filter((n) => !deOutraPessoa || !FORA_DO_PEDIDO_DE_OUTRA_PESSOA.includes(n))
    .concat(frente ? [FERRAMENTA_DA_FRENTE] : [])
    .map(ferramentaNod);
  // NOD-443 (revisão 5 do PR #628, achado 1): no pedido de outra pessoa, nenhuma ferramenta de conector da dona — nem a
  // leitura (readOnlyHint sai sem aprovação no manual e devolveria o e-mail, a agenda ou o Drive dela a quem pediu). Pelo
  // mesmo motivo a memória do bot e a lista de apps dele não entram no prompt (o histórico sai em emitir-plano-turno).
  // Revisão 6 (achados 1 e 2): nem o "Sobre mim" da dona, nem o diretório dos bots dela, nem o inventário das rotinas.
  const conectoresDoTurno = deOutraPessoa ? [] : entrada.conectores;
  const { ferramentas: deConectores, servidores } = ferramentasDeConectores(conectoresDoTurno, entrada.concessoes, entrada.agente.id);
  // definido em 2026-09-24 (ADR-047): delegação sem computador na v1 — o alcance é o dos conectores concedidos.
  // revisto em 2026-09-28 (ADR-050): a criação também tem computador — bot novo é bot completo.
  // revisto em 2026-10-01 (ADR-066): a delegação também — era escopo da v1, sem argumento de risco, e a rotina, sem
  // ninguém olhando, já tinha. Só o peer legado fica sem.
  const temComputador = entrada.computador === true && modo !== "peer" && !deOutraPessoa;
  const computador: FerramentaPlano[] = temComputador && !entrada.computadorFora ? Object.entries(FERRAMENTAS_COMPUTADOR).map(([nome, schema]) => ({ nome, nomeMcp: `mcp__nod__${nome}`, origem: "computador", conectorId: null, readOnlyHint: ["computador_observar", "computador_arquivos", "computador_ler_arquivo", "computador_ler_texto"].includes(nome), tocaDadoPessoal: true, schema })) : [];
  /**
   * definido em 2026-09-18: sem projeto autorizado o agente só enxerga consultar e propor. Ver um
   * martelo que ainda não pode usar era o que o levava a tentar, falhar e virar tutorial de menu.
   */
  const SEM_PROJETO = ["workspace_consultar", "workspace_propor_pasta"];
  // revisto em 2026-10-01 (ADR-066): em todo modo menos o peer legado — a emenda da ADR-039 já dizia "em qualquer turno",
  // e o corte só na conversa (18/09) não tinha motivo escrito. O workspace passa pelo proxy e o modo decide.
  const workspace: FerramentaPlano[] = entrada.workspace && modo !== "peer" && !deOutraPessoa
    ? Object.entries(FERRAMENTAS_WORKSPACE)
      .filter(([nome]) => entrada.workspaceVinculado || SEM_PROJETO.includes(nome))
      .map(([nome, schema]) => ({ nome, nomeMcp: `mcp__nod__${nome}`, origem: "workspace", conectorId: null, readOnlyHint: ["workspace_consultar", "workspace_arquivos", "workspace_ler_texto", "workspace_propor_pasta"].includes(nome), tocaDadoPessoal: true, schema }))
    : [];
  // revisto em 2026-10-01 (ADR-066): o catálogo não encolhe mais por confiança. Em 30/09 a Clarice não mandava Slack nem
  // punha label no Gmail na rotina (0 de 269 turnos, contra 67 de 67 na conversa) e o Chico não movia task no ClickUp
  // na rotina de 10 min: a fonte citava um app "de fora" e as ferramentas de escrita sumiam caladas. Conteúdo de fora
  // agora só pesa no modo manual, na hora de decidir cada ação (aprovacao-permanente.ts).
  let ferramentas = montarFerramentas({ catalogo: [...nod, ...deConectores, ...computador, ...workspace], allowlistAgente: null, alcanceCanal: null, profundidade: entrada.profundidade });
  const decididoPor: `regra:${string}` = REGRA_MONTAGEM;
  // definido em 2026-09-28: quem pode receber resposta grande (conector, computador, pasta) recebe também
  // `ler_mais`, atendida pelo proxy. Leitura pura, em todo turno. NOD-61 (revisão do /codex no PR #594, P2): ler_conversa
  // também — 20 falas de 2.000 caracteres podem passar do orçamento do proxy, que manda chamar ler_mais.
  if (ferramentas.some((f) => f.origem !== "nod" || f.nome === "ler_conversa")) ferramentas = [...ferramentas, FERRAMENTA_LER_MAIS];
  const conectoresUsados = new Set(ferramentas.map((f) => f.conectorId));
  const servidoresUsados = servidores.filter((s) => conectoresUsados.has(s.conectorId));

  const autoria: Autoria = {
    autor_tipo: "agente",
    autor_id: entrada.agente.id,
    sob_procuracao_de: entrada.turno.sobProcuracaoDe ?? null,
    conta_de_execucao: entrada.turno.ownerId,
    executor: entrada.executor,
    locality: "local",
    locality_reason: localidade.motivo,
    machine_id: null,
    decidido_por: localidade.decididoPor,
    regra_versao: localidade.regraVersao,
  };

  const prazoMs = Math.max(0, entrada.turno.prazoEm - entrada.agora);
  const pasta = nativas.includes("Bash") ? (entrada.pastaTrabalho ?? pastaDoBot(entrada.agente.nome)) : undefined;
  // NOD-323 (ADR-126): quem tem pasta e terminal gera arquivos; `anexar_midia` os mostra no chat (atendida pelo proxy).
  // A sala fica fora nesta PR (a fala da sala vai por postarNaSala, que não prende a mídia).
  if (pasta && modo !== "sala" && entrada.semAnexarMidia !== true) ferramentas = [...ferramentas, FERRAMENTA_ANEXAR_MIDIA];
  const entradaDoPrompt: EntradaPromptSistema = { agente: deOutraPessoa ? { ...entrada.agente, modoAprovacao: "manual" } : entrada.agente, memorias: deOutraPessoa ? [] : entrada.memorias, ferramentas, nativas, pastaDoBot: pasta, pessoaNome: entrada.pessoaNome, modo, colegas: deOutraPessoa ? [] : entrada.colegas, contextoConversa: entrada.contextoConversa, conectores: conectoresDoTurno, rotinas: deOutraPessoa ? [] : entrada.rotinasDoAgente, computadorFora: temComputador ? entrada.computadorFora ?? null : null, delegacao: modo === "delegacao" ? entrada.delegacao ?? null : null, profundidade: entrada.profundidade, semTerminal: motivoSemTerminal({ modo, confianca: entrada.confianca, terminal: entrada.terminal === true, deOutraPessoa }), harness: entrada.harness ?? null, trabalho: entrada.trabalho ?? null, trabalhosAbertos: podeAbrirTask(entrada.trabalho ?? null) && !deOutraPessoa ? entrada.trabalhosAbertos ?? [] : [], ...(comPedidos ? { pedidosPendentes: entrada.pedidosPendentes } : {}), ...(modo === "conversa" && entrada.bastidores?.length ? { bastidores: entrada.bastidores } : {}), ...(ehNod(entrada.agente) ? { manualDoNod: manualDoNod(entrada.revisor === true) } : {}), ...(entrada.maquina ? { maquina: entrada.maquina } : {}), ...(entrada.calibracao ? { calibracao: true } : {}), ...(entrada.whatsapp ? { whatsapp: true } : {}), ...(entrada.revisor ? { revisor: true } : {}), ...(entrada.sobreMim && !deOutraPessoa ? { sobreMim: entrada.sobreMim } : {}), ...(reconfigura ? { reconfiguracao: true } : {}) };
  // NOD-480 (emenda da ADR-040): o orçamento pela janela do modelo. A decisão de enxugar mede só a parte estável (a do
  // bot), para o prompt não mudar de um turno para outro e o cache não se perder. A ligação tem o prompt de voz.
  const { prompt, orcamento } = comOrcamento(entrada, modo, entradaDoPrompt, ferramentas.length);
  const clone = cloneDaMaquina(entrada, pasta, ferramentas, prompt.promptSistema);
  return {
    tenantId: entrada.turno.tenantId,
    turnoId: entrada.turno.id,
    conversaId: entrada.turno.conversaId,
    agenteId: entrada.agente.id,
    ...(entrada.turno.bastidores && !entrada.turno.trabalhoId ? { bastidores: true as const } : {}),
    localidade: "local",
    executor: entrada.executor,
    superficie: "maquina_da_pessoa",
    decididoPor,
    autoria,
    confiancaEntrada: entrada.confianca,
    profundidade: entrada.profundidade,
    catalogo: { ferramentas, servidores: servidoresUsados },
    nativas,
    ...(pasta ? { pastaDoBot: pasta } : {}),
    ...prompt,
    ...(clone && "caminho" in clone ? { cloneDaMaquina: clone } : {}),
    entrada: { texto: entradaDoTurno(entrada.turno.entradaTexto, entrada.harness, reconfigura), sessaoCli: entrada.sessaoCli, modelo: entrada.turno.modelo, ...(entrada.anexos?.length ? { anexos: [...entrada.anexos] } : {}), ...(esforco ? { esforco } : {}) },
    politicaExecucao: {
      prazoMs,
      orcamentoResultadoChars: orcamento?.resultadoChars ?? ORCAMENTO_RESULTADO_CHARS,
    },
    ...(orcamento ? { orcamento } : {}),
    modoAprovacao: modoNoTurno(entrada.agente.modoAprovacao, autoria) ?? "manual",
    modoTurno: modo,
    daPessoa: daFaixaDaPessoa(entrada.turno),
    /**
     * ADR-042: resolvido aqui, no PUXAR, e cruzado com o catálogo JÁ montado — a regra
     * evita a pergunta, nunca amplia alcance (ADR-038). Turno não confiável recebe lista VAZIA: o
     * domínio também recusa por confiança, e as duas camadas são de propósito (a lista vazia é o
     * estado, a recusa é a explicação que a pessoa lê). Ação que nunca é permanente (ADR-047: aprovar
     * PR, merge) sai mesmo com linha ativa — uma regra gravada antes da lista não vale.
     */
    semprePermitir: entrada.confianca === "nao_confiavel" ? [] : semprePermitirNoCatalogo(entrada.semprePermitir ?? [], ferramentas),
    expiraEm: PLANO_SEM_VALIDADE,
  };
}

/**
 * NOD-480 (emenda da ADR-040): o prompt do turno com o orçamento da janela. Só no Claude Code (o autocompact é dele; o
 * Codex fica como está) e fora da ligação. Acima da fração segura do limiar, o catálogo de apps vai enxuto.
 */
export function comOrcamento(entrada: Pick<EntradaPlano, "harness" | "turno" | "janelaObservada">, modo: ModoTurno, doPrompt: EntradaPromptSistema, ferramentas: number): { prompt: Pick<PlanoTurno, "promptSistema" | "promptSistemaPartes">; orcamento: OrcamentoContexto | null } {
  const cheio = promptEmPartes(doPrompt);
  if (modo === "ligacao" || (entrada.harness ?? HARNESS_LEGADO) !== "claude-cli") return { prompt: cheio, orcamento: null };
  const janela = janelaDoModelo(entrada.turno.modelo, entrada.janelaObservada);
  const medida = (p: Pick<PlanoTurno, "promptSistema" | "promptSistemaPartes">) => ({ promptChars: (p.promptSistemaPartes?.estavel ?? p.promptSistema).length, ferramentas });
  const enxuto = precisaEnxugar(janela, medida(cheio));
  const prompt = enxuto ? promptEmPartes({ ...doPrompt, catalogoEnxuto: true }) : cheio;
  return { prompt, orcamento: orcamentoDoTurno({ janela, enxuto, medida: medida(prompt) }) };
}

/** O que o clone da máquina precisa do turno, menos a credencial: Linux, frente na pasta dela e um repo válido. */
function repoDoCloneDaMaquina(entrada: Pick<EntradaPlano, "maquina" | "trabalho">, pasta: string | undefined): string | null {
  if (!CLONE_DA_MAQUINA || entrada.maquina?.plataforma !== "linux" || !pasta || !ehPastaDeTask(pasta) || !ehFrente(entrada.trabalho ?? null)) return null;
  return repoDoGithub(entrada.trabalho?.repo ?? "");
}

const ehDoGithub = (f: FerramentaPlano): boolean => f.origem === "conector" && (f.nome.startsWith("github__") || f.nome.startsWith("github_mcp__"));

/**
 * definido em 2026-10-22 (NOD-315, ADR-119): o campo `cloneDaMaquina` do plano. Só na máquina Linux, para a frente com
 * repo, com o GitHub concedido ao bot (decisão do Marlon de 19/10: nenhum bot lê pelo clone da máquina o que não leria
 * sozinho) e com o trecho de hoje presente no prompt. Sem o GitHub, `{ motivo: "sem_credencial" }`: o caso de uso
 * registra e o prompt não cita `.clones`. `null` = não se aplica.
 */
export function cloneDaMaquina(entrada: Pick<EntradaPlano, "maquina" | "trabalho">, pasta: string | undefined, ferramentas: readonly FerramentaPlano[], promptSistema: string): NonNullable<PlanoTurno["cloneDaMaquina"]> | { repo: string; motivo: MotivoSaida } | null {
  const repo = repoDoCloneDaMaquina(entrada, pasta);
  if (!repo || !pasta) return null;
  if (!ferramentas.some(ehDoGithub)) return { repo, motivo: "sem_credencial" };
  const semClone = trechoDoClone({ pastaDoBot: pasta, worktree: worktreeDaFrente(pasta) });
  if (!promptSistema.includes(semClone)) return null;
  const caminho = caminhoDoClone("~", repo);
  return { repo, caminho, semClone, comClone: trechoComClone({ pastaDoBot: pasta, caminho, repo }) };
}

/** O motivo da saída que o servidor já sabe (hoje, só `sem_credencial`), para o caso de uso registrar no log. */
export function saidaDoCloneDaMaquina(entrada: Pick<EntradaPlano, "maquina" | "trabalho">, plano: Pick<PlanoTurno, "pastaDoBot" | "catalogo" | "promptSistema">): { repo: string; motivo: MotivoSaida } | null {
  const r = cloneDaMaquina(entrada, plano.pastaDoBot, plano.catalogo.ferramentas, plano.promptSistema);
  return r && "motivo" in r ? r : null;
}

/**
 * definido em 2026-10-06 (NOD-183, ADR-080): o prompt de texto vai inteiro em `promptSistema` (Codex, Raio-X) e em
 * duas partes em `promptSistemaPartes`, que o driver do claude-cli separa com o marcador de cache. Juntadas com "\n",
 * as partes dão o `promptSistema` (a volátil pode vir vazia: aí ele é só a estável).
 */
export function promptEmPartes(entrada: EntradaPromptSistema): Pick<PlanoTurno, "promptSistema" | "promptSistemaPartes"> {
  const p = partesDoPromptSistema(entrada);
  return { promptSistema: [...p.estavel, ...p.volatil].join("\n"), promptSistemaPartes: { estavel: p.estavel.join("\n"), volatil: p.volatil.join("\n") } };
}

/**
 * As regras "Sempre permitir" que valem num catálogo: só ferramenta de conector que está nele e que pode ser
 * permanente (ADR-047). O plano usa no PUXAR; desde 2026-09-30 (ADR-062) o pedir_aprovacao e a chamada direta usam
 * de novo, lendo as regras AGORA, para o clique valer já no turno que ainda está rodando.
 */
export function semprePermitirNoCatalogo(nomes: readonly string[], ferramentas: readonly FerramentaPlano[]): string[] {
  return nomes.filter((n) => ferramentas.some((f) => f.nome === n && f.origem === "conector" && !nuncaPermanente(n, f.readOnlyHint)));
}
