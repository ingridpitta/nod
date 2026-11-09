import { comandoDaConversa } from "../domain/comandos.ts";
import { COMANDO_CONFIGURAR, JANELA_RECONFIGURACAO_MS, podeReconfigurar } from "../domain/reconfiguracao.ts";
import type { AcaoDoModoNaFala } from "../contracts/acoes-do-modo.ts";
import type { TipoAnexo } from "../contracts/anexo.ts";
import type { ConversaDto } from "../contracts/api.ts";
import { comFilaDosPedidos } from "./fila-do-pedido.ts";
import type { Executor } from "../contracts/evento.ts";
import type { IdHarness } from "../contracts/harness.ts";
import type { Inventario } from "../contracts/inventario.ts";
import type { Mensagem } from "../contracts/mensagem.ts";
import type { OrigemTurno, Turno } from "../contracts/turno.ts";
import { grupoNaFala, linhaNaFala } from "../domain/acoes-do-modo.ts";
import { fraseNoMeio } from "../domain/frase-da-acao.ts";
import { fraseDoItem, type ConectoresDaLeitura } from "./frase-da-acao.ts";
import { excedeQuantidade, motorLe, tipoDoAnexo } from "../domain/anexo.ts";
import { comCitacao, confiancaDaCitacao, trechoDaCitacao } from "../domain/citacao.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import { horaDaFrase } from "../domain/erro-fornecedor.ts";
import { harnessFixado, iaDaNegacao, inventarioHarnessSemSonda, motivoHarnessIndisponivel, motivoSemIaPronta } from "../domain/harness.ts";
import { resolverLocalidade } from "../domain/localidade-turno.ts";
import { redigir } from "../domain/redacao.ts";
import { aguardaIa, falaSemIa, PRAZO_SEM_IA_MS } from "../domain/sem-ia.ts";
import { log } from "../obs/log.ts";
import { autoriaAgente, autoriaPessoa, evento, inventarioAusente, motorDe, PRAZO_DECISAO_PADRAO_MS } from "./autoria-evento.ts";
import { fiosDaConversa } from "./fios-da-pergunta.ts";
import { donosDosBots, presencaDasMaquinas } from "./estado-do-dono.ts";
import { trabalhosParaDto } from "./trabalhos.ts";
import type { CasoDeUso, Deps } from "./tipos.ts";

export type EntradaEnviarMensagem = {
  conversaId: string;
  texto: string;
  /** ADR-046: ids de anexos já enviados (soltos) desta conversa. Com anexo, o texto pode vir vazio. */
  anexos?: readonly string[];
  /** Só para conversa de SALA (a própria já sabe o agente): quem responde, decidido por postarNaSala (L7). */
  agenteId?: string;
  /** Prazo de DECISÃO do turno (relógio de parede, ADR-007); default 24 h. */
  prazoMs?: number;
  executor?: Executor;
  /** Inventário do motor já sondado (ADR-019); ausente = lê o registrado; nenhum = 'ausente' (fail-closed). */
  inventario?: Inventario;
  /** Chave de idempotência (UUID) que o compositor cria, uma por fala (NOD-156): o reenvio devolve a mesma mensagem e o mesmo turno. */
  idEnvio?: string;
  /** #313: as IAs de todas as máquinas vivas da pessoa (modo compartilhado) — a negação do bot fixado nomeia a IA DELE. */
  harnessesDaPessoa?: Partial<Record<IdHarness, Inventario>>;
  /**
   * ADR-113 (plano "pergunta com botões", Parte 3b): o id da fala a que esta mensagem responde (o "Responder" da barra de
   * ações). Só o id: o trecho é recalculado aqui, da fala, que tem de ser da MESMA conversa.
   */
  respondeA?: string;
  /**
   * Jornada C do onboarding (NOD_ONBOARDING_TEXTO=1): sem IA pronta, a fala da pessoa na conversa própria fica guardada —
   * o turno nasce `pendente` por PRAZO_SEM_IA_MS e o bot responde com a fala fixa (negação `aguardaIa`), em vez de nascer
   * interrompido. Ausente/false = o caminho de sempre.
   */
  guardarSemIa?: boolean;
};

export type SaidaEnviarMensagem = { mensagem: Mensagem; turno: Turno; negacao: Mensagem | null };

/**
 * Mensagem da pessoa = mensagem (confiável) + turno enfileirado + eventos, tudo na MESMA tx (ADR-010:
 * o rollback derruba os três). Localidade via resolverLocalidade com o inventário (ADR-022): recusada →
 * o turno NASCE interrompido 'executor_indisponivel' com mensagem de negação renderizável (E9.3, ADR-029).
 * Falar de novo libera a fila: encerra as paradas abertas que cobrem a conversa (E5.4/E8.1).
 *
 * definido em 2026-10-06 (NOD-156): com `idEnvio`, a fala já gravada com a mesma chave volta como está (mesma
 * mensagem, mesmo turno, sem eventos e sem mexer em paradas). Na corrida, o `on conflict do nothing` do insert
 * faz a perdedora esperar o commit da vencedora e voltar sem linha; aí ela lê a vencedora. Pegar a violação do
 * índice não serve: no Postgres ela aborta a transação inteira.
 */
export const enviarMensagem: CasoDeUso<EntradaEnviarMensagem, SaidaEnviarMensagem> = async (deps, input) => {
  const texto = typeof input.texto === "string" ? input.texto.trim() : "";
  const anexoIds = [...new Set(input.anexos ?? [])];
  if (texto === "" && anexoIds.length === 0) throw new ErroDeDominio("texto_vazio");
  if (excedeQuantidade(anexoIds.length)) throw new ErroDeDominio("entrada_invalida", { cause: "anexos demais" });
  const conversa = await deps.repos.conversas.buscar(input.conversaId);
  if (!conversa) throw new ErroDeDominio("nao_encontrado");
  const agenteId = conversa.tipo === "propria" ? conversa.agenteId : (input.agenteId ?? null);
  if (!agenteId) throw new ErroDeDominio("estado_invalido", { cause: "conversa de sala sem agente respondente" });
  const agente = await deps.repos.agentes.buscar(agenteId);
  if (!agente) throw new ErroDeDominio("nao_encontrado");
  const origem: OrigemTurno = conversa.tipo === "sala" ? "sala" : "conversa";
  const agora = deps.agora();
  const executor = input.executor ?? "catcher";
  const idEnvio = input.idEnvio;

  if (idEnvio) {
    const existente = await deps.repos.mensagens.buscarPorIdEnvio(conversa.id, idEnvio);
    if (existente) return { data: await envioRepetido(deps, existente, texto, anexoIds), events: [] };
  }

  // ADR-113 (Parte 3b): a citação. A fala citada é lida sob a RLS e tem de ser desta conversa; o trecho sai dela (o do
  // cliente nunca chega aqui), e citar conteúdo não confiável faz a mensagem e o turno nascerem não confiáveis (ADR-062).
  const citada = input.respondeA ? await deps.repos.mensagens.buscar(input.respondeA) : null;
  if (input.respondeA && (!citada || citada.conversaId !== conversa.id)) throw new ErroDeDominio("entrada_invalida", { cause: "respondeA de outra conversa ou inexistente" });
  const respondeA = citada ? { mensagemId: citada.id, trecho: trechoDaCitacao(citada.texto) } : null;
  const confianca = citada ? confiancaDaCitacao(citada.confianca) : "confiavel";

  const autoria = autoriaPessoa(deps.escopo, executor);
  const criada = await deps.repos.mensagens.criar({ conversaId: conversa.id, autoria, kind: "texto", texto, confianca, idEnvio, ...(respondeA ? { payload: { kind: "resposta_a_fala", respondeA } } : {}) });
  if (!criada && idEnvio) {
    // Perdeu a corrida: a outra transação gravou a mesma chave e já fez commit.
    const vencedora = await deps.repos.mensagens.buscarPorIdEnvio(conversa.id, idEnvio);
    if (vencedora) return { data: await envioRepetido(deps, vencedora, texto, anexoIds), events: [] };
  }
  if (!criada) throw new ErroDeDominio("nao_permitido");
  // Depois do insert (NOD-156): o reenvio de uma fala já gravada não pode encerrar uma parada aberta depois dela.
  await deps.repos.paradas.encerrarAbertas({ conversaId: conversa.id, agora });
  // Prende só o que é solto, desta conversa e da dona; qualquer id que sobrar derruba a tx inteira.
  const anexos = await deps.repos.anexos.prender(anexoIds, { conversaId: conversa.id, mensagemId: criada.id });
  if (anexos.length !== anexoIds.length) throw new ErroDeDominio("entrada_invalida", { cause: "anexo de outra conversa, já enviado ou inexistente" });
  // PDF para um agente cujo motor declarado não lê PDF: recusa escrita em vez de o modelo não ver o arquivo. O bot `auto`
  // (ou sem harness) não é conferido aqui: a IA só se decide no despacho (NOD-207 manteve assim).
  const fixo = agente.harness && agente.harness !== "auto" ? agente.harness : null;
  const naoLido = fixo ? anexos.find((a) => !motorLe(fixo, tipoDoAnexo(a.mime))) : undefined;
  if (naoLido) throw new ErroDeDominio("entrada_invalida", { cause: `${agente.harness} não lê ${tipoDoAnexo(naoLido.mime)}` });
  const mensagem: Mensagem = anexos.length > 0 ? { ...criada, anexos } : criada;
  const inventario = input.inventario ?? (await deps.repos.inventario.buscar(motorDe(executor))) ?? inventarioAusente(agora);
  const localidade = resolverLocalidade({ origem, tocaDadoPessoal: false, motorExigido: agente.modelo, inventario });
  const recusado = "recusado" in localidade;
  // Jornada C: o turno recusado por falta de IA que só espera (spec, critério 1). Lê os guardados antes de enfileirar:
  // a primeira fala é a da tela C; as seguintes, a linha curta que aponta o card (critério 2).
  const guarda = recusado && aguardaIa({ ligado: input.guardarSemIa === true, origem, daPessoa: true, trabalho: false });
  const jaHaGuardada = guarda && (await deps.repos.turnos.vivosDaConversa(conversa.id)).some((t) => t.estado === "pendente" && !!t.mensagemOrigemId && !t.trabalhoId);

  const turno = await deps.repos.turnos.enfileirar({
    conversaId: conversa.id,
    agenteId: agente.id,
    origem,
    prazoEm: agora + (guarda ? PRAZO_SEM_IA_MS : (input.prazoMs ?? PRAZO_DECISAO_PADRAO_MS)),
    profundidade: 0,
    // ADR-113: com sessão retomada o bot só lê a entrada; a citação vai nela, e no histórico pelo payload.
    entradaTexto: respondeA ? comCitacao(texto, respondeA.trecho) : texto,
    mensagemOrigemId: mensagem.id,
    entradaAnexos: anexos.map((a) => a.id),
    entradaConfianca: confianca,
    modelo: agente.modelo,
    harness: agente.harness,
    executor,
    localityReason: localidade.motivo,
    decididoPor: localidade.decididoPor,
    interrompidoCom: recusado && !guarda ? "executor_indisponivel" : undefined,
  });
  if (!turno) throw new ErroDeDominio("nao_permitido");
  // NOD-23: /configurar na conversa própria com bot elegível liga a reconfiguração na mesma transação do turno; o plano
  // do turno lê a coluna. Fora disso o comando segue como texto (montarPlano o traduz para uma explicação curta). Depois
  // do enfileirar: a trava consultiva do agente (gatilho da 0011) vem antes da linha, na ordem de agentes.excluir.
  if (conversa.tipo === "propria" && comandoDaConversa(texto)?.comando.nome === COMANDO_CONFIGURAR && podeReconfigurar(agente, deps.escopo.pessoaId)) {
    await deps.repos.agentes.iniciarConfiguracao(agente.id, agora, turno.id, agora - JANELA_RECONFIGURACAO_MS);
  }

  const events = [evento(deps.escopo, { kind: "mensagem_criada", autoria, agora, conversaId: conversa.id, turnoId: turno.id, dados: { mensagem_id: mensagem.id, kind: "texto" } })];
  let negacao: Mensagem | null = null;
  if (guarda) {
    negacao = await deps.repos.mensagens.criar({
      conversaId: conversa.id,
      turnoId: turno.id,
      autoria: autoriaAgente({ agenteId: agente.id, contaDeExecucao: deps.escopo.pessoaId, executor, localityReason: "motor_ausente" }),
      kind: "negacao",
      texto: falaSemIa({ jaHaGuardada }),
      payload: { kind: "negacao", classe: "plano_ausente", nome: motorDe(executor), motivo: "plano_ausente", terminal: false, aguardaIa: true },
      confianca: "confiavel",
    });
    events.push(evento(deps.escopo, { kind: "turno_criado", autoria, agora, conversaId: conversa.id, turnoId: turno.id, dados: { origem, agente_id: agente.id, aguarda_ia: true } }));
    if (negacao) events.push(evento(deps.escopo, { kind: "mensagem_criada", autoria, agora, conversaId: conversa.id, turnoId: turno.id, dados: { mensagem_id: negacao.id, kind: "negacao" } }));
  } else if (recusado) {
    // #313: o bot fixado nomeia a IA dele, com o estado dela (como o despacho, NOD-171); o Automático diz que nenhuma IA
    // está pronta — o `inventario` aqui é o da máquina, e chamá-lo de "Claude Code" confundia quem só tem o ChatGPT.
    const fixo = harnessFixado(agente.harness, agente.modelo);
    negacao = fixo
      ? await mensagemExecutorIndisponivel(deps, { conversaId: conversa.id, turnoId: turno.id, agenteId: agente.id, executor, inventario: input.harnessesDaPessoa?.[fixo] ?? inventarioHarnessSemSonda(agora), agora, harness: fixo })
      : await mensagemExecutorIndisponivel(deps, { conversaId: conversa.id, turnoId: turno.id, agenteId: agente.id, executor, inventario, agora, semIaOnde: "maquinas" });
    events.push(evento(deps.escopo, { kind: "turno_interrompido", autoria, agora, conversaId: conversa.id, turnoId: turno.id, dados: { motivo: "executor_indisponivel", inventario: inventario.estado } }));
    if (negacao) events.push(evento(deps.escopo, { kind: "mensagem_criada", autoria, agora, conversaId: conversa.id, turnoId: turno.id, dados: { mensagem_id: negacao.id, kind: "negacao" } }));
  } else {
    events.push(evento(deps.escopo, { kind: "turno_criado", autoria, agora, conversaId: conversa.id, turnoId: turno.id, dados: { origem, agente_id: agente.id } }));
  }
  return { data: { mensagem, turno, negacao }, events };
};

/**
 * A fala já gravada com a mesma chave (NOD-156). Texto ou anexos diferentes com a mesma chave são erro do cliente,
 * não reenvio: recusa sem gravar nada (devolver a fala antiga perderia os anexos novos em silêncio). O turno se acha
 * por `mensagemOrigemId`.
 */
async function envioRepetido(deps: Deps, existente: Mensagem, texto: string, anexoIds: readonly string[]): Promise<SaidaEnviarMensagem> {
  if (existente.texto !== texto) throw new ErroDeDominio("estado_invalido", { cause: "id_envio_reusado" });
  const anexos = (await deps.repos.anexos.daMensagens([existente.id])).get(existente.id) ?? [];
  const gravados = anexos.map((a) => a.id).sort();
  const pedidos = anexoIds.map((id) => id.toLowerCase()).sort();
  if (gravados.length !== pedidos.length || gravados.some((id, i) => id !== pedidos[i])) throw new ErroDeDominio("estado_invalido", { cause: "id_envio_reusado" });
  const turno = await deps.repos.turnos.buscarPorMensagemOrigem(existente.id);
  if (!turno) throw new ErroDeDominio("estado_invalido", { cause: "id_envio sem turno" });
  log("info", "envio_repetido", { conversa_id: existente.conversaId, mensagem_id: existente.id });
  return { mensagem: anexos.length > 0 ? { ...existente, anexos } : existente, turno, negacao: null };
}

/**
 * Negação renderizável de executor indisponível (ADR-029): classe 'plano_ausente' porque nenhum plano
 * pode ser emitido sem motor 'pronto'; o texto vem da redação fixa com motivo e instante.
 */
export async function mensagemExecutorIndisponivel(
  deps: Deps,
  p: { conversaId: string; turnoId: string; agenteId: string; executor: Executor; inventario: Inventario; agora: number; harness?: string; modeloInvalido?: string; anexoNaoLido?: TipoAnexo; semIaOnde?: "maquinas" | "maquina_do_bot" },
): Promise<Mensagem | null> {
  // NOD-171: o harness escolhido e o inventário DELE; sem harness (turno antigo, catcher), o do motor.
  const nome = p.harness ?? motorDe(p.executor);
  // #313: sem IA para nomear, quem chama diz onde faltou (envio: nas máquinas; despacho: na máquina do bot).
  const motivo = !p.harness && p.semIaOnde ? motivoSemIaPronta(p.semIaOnde, p.inventario) : motivoHarnessIndisponivel(nome, p.inventario, p.modeloInvalido, p.anexoNaoLido);
  // NOD-220: a IA que negou vai no payload; a web decide "já voltou" pela sonda DELA, nunca pela do motor em uso.
  // Só o harness do turno é IA que negou: sem ele, quem faltou foi o executor (motorDe), e `nome` "claude-cli" é o motor
  // local, não a IA. Gravar `ia` aí prenderia a web esperando o Claude Code num bot que roda no Codex (revisão do #303).
  // NOD-285: na negação por anexo a IA nomeada está pronta (só não lê o arquivo); com `ia`, a web ofereceria tentar de novo
  // assim que ela "voltasse", e a fala cairia na mesma negação. Sem `ia`, a negação é só a frase.
  const ia = p.anexoNaoLido ? undefined : iaDaNegacao(p.harness);
  return deps.repos.mensagens.criar({
    conversaId: p.conversaId,
    turnoId: p.turnoId,
    autoria: autoriaAgente({ agenteId: p.agenteId, contaDeExecucao: deps.escopo.pessoaId, executor: p.executor, localityReason: "motor_ausente" }),
    kind: "negacao",
    // NOD-285 (revisão do Gil no #345): o tipo do arquivo vai no payload para a web dar à negação o aviso próprio.
    texto: p.anexoNaoLido ? redigir("anexo-nao-lido", p.agora, { motivo }) : redigir("executor-indisponivel", p.agora, { motivo, desde: horaDaFrase(p.inventario.em, p.agora) }),
    payload: { kind: "negacao", classe: "plano_ausente", nome, motivo: "plano_ausente", terminal: true, ...(ia ? { ia } : {}), ...(p.modeloInvalido !== undefined ? { modelo: p.modeloInvalido } : {}), ...(p.anexoNaoLido ? { anexo: p.anexoNaoLido } : {}) },
    confianca: "confiavel",
  });
}

/**
 * GET conversas/:id/mensagens (EMENDA 13): mensagens + turnos pendentes renderizáveis ("na fila — ocupado em …").
 * definido em 2026-09-24 (fio da pergunta): + os fios das perguntas com mensagem na janela, já com o estado.
 * definido em 2026-10-07 (ADR-083, S2): cada mensagem leva `origemTurno`, `trabalhoId` e `fimDoTurno`, e a conversa, as
 * tasks abertas do bot dela (a faixa). As falas do meio dos turnos de trabalho continuam na página: quem as esconde é a
 * web. revisto em 2026-10-18 (chat limpo, PR 2): na conversa própria elas não contam mais no `limite` (vêm como `anexo`,
 * desde o corte), e uma task muito falante não empurra as falas da conversa para fora da janela.
 */
/**
 * NOD-380 (critério 4): `?ate=<mensagem>` faz a janela crescer até incluir a mensagem achada na busca, mesmo antiga. Conta
 * todas as mensagens desde ela (a janela da conversa própria conta só itens de chat, que são no máximo isso) mais uma folga,
 * até o teto: uma conversa de semanas não vira um dump. definido em 2026-10-28: 200 é a janela de sempre (listarComTurno).
 */
export const JANELA_PADRAO = 200;
export const TETO_JANELA_ATE = 1000;
const FOLGA_JANELA_ATE = 20;

export function janelaAte(desde: number | null, limite = JANELA_PADRAO): number {
  if (desde === null) return limite;
  return Math.min(TETO_JANELA_ATE, Math.max(limite, desde + FOLGA_JANELA_ATE));
}

/** O teto dos anexos com `?ate=`: o da janela crescida quando ela cresceu; senão, nenhum (fica o de sempre, 300). */
export function tetoAnexosAte(desde: number | null, limite = JANELA_PADRAO): number | undefined {
  return desde !== null && janelaAte(desde, limite) > limite ? TETO_JANELA_ATE : undefined;
}

export const lerConversa: CasoDeUso<{ conversaId: string; limite?: number; ate?: string }, ConversaDto> = async (deps, input) => {
  const conversa = await deps.repos.conversas.buscar(input.conversaId);
  if (!conversa) throw new ErroDeDominio("nao_encontrado");
  const desde = input.ate ? await deps.repos.mensagens.contarDesde(conversa.id, input.ate, TETO_JANELA_ATE + 1) : null;
  const limite = input.ate ? janelaAte(desde, input.limite) : input.limite;
  // Revisão 5 do PR #551: os anexos só sobem ao teto quando a fala achada está mesmo fora da janela de sempre; um `ate` de
  // outra conversa, invisível ou já nas 200 recentes (a web o repete a cada releitura) não pesa a leitura.
  const tetoAnexos = tetoAnexosAte(desde, input.limite);
  const [lidas, turnosPendentes, vivos, propostas] = await Promise.all([
    // Chat limpo (ADR-114, PR 2): na conversa própria a janela conta só os itens de chat (os avisos que saem moram na
    // Atividade do bot), traz os `anexo` desde o corte e cada mensagem leva o destino resolvido no servidor. Na sala, nada muda.
    // NOD-380: com `ate` fora da janela de sempre, os anexos têm o mesmo teto da janela; com o teto de sempre (300), o piso deles cortava a fala achada.
    deps.repos.mensagens.listarComTurno(conversa.id, limite, { comDestino: conversa.tipo === "propria", ...(tetoAnexos ? { tetoAnexos } : {}) }),
    deps.repos.turnos.pendentesRenderizaveis(conversa.id),
    deps.repos.turnos.vivosDaConversa(conversa.id),
    deps.repos.propostas.pendentesDaConversa(conversa.id),
  ]);
  // NOD-200: a fala do bot também pode ter anexo (a captura de tela do turno), e não só a mensagem da pessoa.
  const anexos = await deps.repos.anexos.daConversa(lidas.filter((m) => m.autoria.autor_tipo === "pessoa" || m.kind === "texto").map((m) => m.id));
  const comAnexos = anexos.size === 0 ? lidas : lidas.map((m) => (anexos.has(m.id) ? { ...m, anexos: anexos.get(m.id) } : m));
  // NOD-257 (H5): o pedido a colega na fila leva o porquê no card.
  const mensagens = await comFilaDosPedidos(deps, comAnexos);
  // Cancelado antes de rodar = interrompido pela pessoa sem nunca ter sido reivindicado (attempted
  // nasce false e só o reivindicar o liga). Um Parar no meio da execução não entra: aquele rodou.
  const turnosCancelados = (await deps.repos.turnos.listarDaConversa(conversa.id))
    .filter((t) => t.estado === "interrompido" && t.motivoInterrupcao === "parado_pela_pessoa" && !t.sinais.attempted && t.mensagemOrigemId)
    .map((t) => ({ id: t.id, mensagemId: t.mensagemOrigemId as string }));
  const turnosEmCurso = vivos
    .filter((t): t is typeof t & { estado: "pendente" | "despachando" } => t.estado === "pendente" || t.estado === "despachando")
    .map((t) => ({ id: t.id, estado: t.estado, desde: Math.max(t.criadoEm, t.acordarEm ?? 0), mensagemId: t.mensagemOrigemId ?? null, trabalhoId: t.trabalhoId ?? null, origem: t.origem, despachadoEm: t.despachadoEm ?? null, maquinaDestaVez: t.maquinaDestaVez ?? null, agenteId: t.agenteId, ...(t.bastidores && !t.trabalhoId ? { bastidores: true } : {}) }));
  const fios = await fiosDaConversa(deps.repos, mensagens);
  const doBot = conversa.tipo === "propria" ? conversa.agenteId : null;
  // Os abertos do bot da conversa (a faixa, ADR-083); conversa de sala não tem bot próprio: lista vazia.
  const abertos = doBot ? await deps.repos.trabalhos.abertosDoAgente(doBot) : [];
  const trabalhos = await trabalhosParaDto(deps, abertos);
  // ADR-099 (I10): o dono do bot da conversa própria — a linha acima do campo (estado, esperas e fila).
  // NOD-300: a frente presa a máquina sem contato espera, pela regra do chip.
  const dono = doBot ? ((await donosDosBots(deps, [doBot], abertos, await presencaDasMaquinas(deps, deps.services.maquinas))).get(doBot) ?? null) : null;
  // ADR-113: as reações das falas da janela, numa consulta (o chip "👍 1" embaixo de cada fala).
  const reacoes = await deps.repos.reacoes.dasMensagens(mensagens.map((m) => m.id));
  // Chat limpo (PR 3, plano decisão 18): quem pediu cada turno de delegação da janela (próprio ou raiz), numa consulta à
  // parte — a troca agrupada diz o nome mesmo com o `peer_pedido` fora da janela. Só na conversa própria.
  const pedidosDeColega = conversa.tipo === "propria" ? await deps.repos.mensagens.pedidosDeColega(turnosDeDelegacao(mensagens)) : undefined;
  // PR 6 dos modos de aprovação (telas Y1 e Y2): o que o "Ignorar todas" rodou nos turnos da janela e entra na linha
  // embaixo da fala (credencial e arriscado), numa consulta à parte. Só na conversa própria; nada vira mensagem. PR 4
  // (telas A1 e A2): também o que o revisor do Automático liberou.
  const acoesDoModo = conversa.tipo === "propria" ? await acoesDoModoNaConversa(deps, mensagens) : undefined;
  return { data: { conversa, mensagens, turnosPendentes, turnosEmCurso, turnosCancelados, propostas, fios, trabalhos, dono, reacoes, ...(pedidosDeColega ? { pedidosDeColega } : {}), ...(acoesDoModo ? { acoesDoModo } : {}) } };
};

/**
 * As ações do total e as liberadas pelo revisor (PR 4), por turno da janela, com a frase pronta (`linhaNaFala`). PR 4b: a
 * liberada com um item só diz a ação como o cartão diria ("Revisor liberou o push forçado na feat/login: você pediu").
 */
async function acoesDoModoNaConversa(deps: Deps, mensagens: readonly Mensagem[]): Promise<Record<string, AcaoDoModoNaFala[]>> {
  const turnos = [...new Set(mensagens.map((m) => m.turnoId).filter((t): t is string => t !== null))];
  const porTurno: Record<string, AcaoDoModoNaFala[]> = {};
  const conectores: ConectoresDaLeitura = new Map();
  for (const a of await deps.repos.acoesPeloModo.naFalaDosTurnos(turnos)) {
    const gatilho = grupoNaFala(a);
    if (!gatilho) continue;
    const acao = gatilho === "revisor" && a.item ? await fraseDoItem(deps, a.tipo, { textoFinal: a.item.texto_final, destino: a.item.destino }, conectores) : null;
    const { frase, codigo } = linhaNaFala(a, a.linux, acao ? fraseNoMeio(acao) : null);
    (porTurno[a.turno_id] ??= []).push({ id: a.id, turnoId: a.turno_id, em: a.criado_em.getTime(), gatilho, frase, ...(codigo ? { codigo } : {}) });
  }
  return porTurno;
}

/**
 * Os turnos de delegação da janela: o da própria mensagem ou a raiz da cadeia de retomadas dela (ADR-099, I7 revista), o do
 * `peer_pedido` (o turno de outra pessoa não vem no join, e a origem fica nula) e a raiz gravada no `pedido_respondido`.
 */
function turnosDeDelegacao(mensagens: readonly Mensagem[]): string[] {
  const ids = new Set<string>();
  for (const m of mensagens) {
    if ((m.origemTurno === "delegacao" || m.payload?.kind === "peer_pedido") && m.turnoId) ids.add(m.turnoId);
    if (m.raiz?.origem === "delegacao") ids.add(m.raiz.turnoId);
    if (m.payload?.kind === "pedido_respondido" && m.payload.turnoRaizId) ids.add(m.payload.turnoRaizId);
  }
  return [...ids];
}
