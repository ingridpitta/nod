import { randomUUID } from "node:crypto";
import type { RuntimeEvent } from "../contracts/evento.ts";
import type { PlanoTurno } from "../contracts/plano-turno.ts";
import { classificarComando, comandoArriscado, enviaPeloTerminal, tocaChaveDoNod, tocaCredencial } from "../domain/comando.ts";
import { FRASE_ARQUIVO_DE_CREDENCIAL, FRASE_MCP_COM_CREDENCIAL, NATIVA_MCP_DA_PESSOA } from "../domain/nativas.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import { decidirPeloModo, modoNoTurno, REGRA_MODO_TOTAL, semRevisor, type DecisaoSemRevisor, type GatilhoDeRevisao } from "../domain/modo-aprovacao.ts";
import { resumoDeTexto, RISCO_DO_GATILHO } from "../domain/revisor.ts";
import type { GatilhoAcaoDoModo, TipoAcaoDoModo } from "../repositories/acoes-pelo-modo.repo.ts";
import { terminalLiberadoNaTarefa } from "./liberar-na-tarefa.ts";
import { avaliarRevisao, medirRevisao, type OrigemDaRevisao } from "./medir-revisao.ts";
import { revisarAcaoFase1, type PedidoNaFila } from "./revisar-acao.ts";
import { PRAZO_DECISAO_MS } from "./pedir-a-pessoa.ts";
import { autoriaDoAgente } from "./registrar-negacao.ts";
import type { CasoDeUso, Deps } from "./tipos.ts";
import { registrarCartoes } from "./trilha-decisoes.ts";

/** O destino do item de aprovação de um comando: não é conector, é o terminal do Mac da pessoa (ADR-055). */
export const DESTINO_TERMINAL = { conector: "terminal", ferramenta: "bash" } as const;

/**
 * Por que o comando rodou sem card — vai à trilha e aos testes, nunca ao modelo como permissão. `revisor` (ADR-115): a
 * segunda consulta do hook achou a ação liberada pelo revisor (a trilha leva `regra:revisor`). `revisao`: o pedido que a
 * rota entrega ao executor do revisor depois do commit (a decisão `em_revisao`).
 */
export type PorqueRoda = "leitura" | "aprovado" | "revisor" | "liberado_na_tarefa" | "modo_automatico" | "modo_total";
/**
 * `negar` (PR 6 dos modos de aprovação): o arquivo de credencial no manual — o manual não muda, e a frase é a que o hook
 * dizia sozinho antes. Só o pedido de credencial nega por aqui; o resto que o modo não aprova vira cartão.
 */
export type SaidaAutorizarComando = { permitir: true; porque: PorqueRoda } | { aguardar: string; revisao?: PedidoNaFila } | { negar: string };

/**
 * Cada comando do terminal do Mac da pessoa (definido em 2026-09-28, ADR-055, "terminal de verdade, como o
 * inhouse"). O hook do nod manda o comando ANTES de ele rodar; aqui se decide, nesta ordem:
 *
 *  1. só lê (classificarComando) e o turno não trouxe conteúdo da web → roda;
 *  2. a pessoa já aprovou ESTE comando nesta tarefa (a retomada refaz o que ela aprovou depois da espera) → roda;
 *  3. ela respondeu "Pode fazer e o resto desta tarefa" num comando, o turno está limpo e fora do gate de
 *     rotina, e o comando não toca credencial nem é arriscado → roda;
 *  4. ADR-059: o modo do bot aprova (`decidirPeloModo`): no automático, o que não é arriscado num turno limpo;
 *     no total, tudo — até a credencial do Mac, desde o PR 6 dos modos de aprovação (ADR-115), menos a chave do nod.
 *     No automático, credencial → card; no manual, o arquivo de credencial é negado (o comando, card);
 *  5. senão → card de aprovação na conversa, e o hook espera a resposta no próprio turno.
 *
 * ADR-115 (2026-10-18, PR 3a dos modos de aprovação): com a chave `NOD_REVISOR` ligada, o automático manda o arriscado e
 * o envio para fora depois de conteúdo de fora ao REVISOR (revisar-acao.ts): a decisão nasce `em_revisao`, o hook espera
 * por ela como espera a pessoa, e a liberação do revisor é achada no passo 2 (só no mesmo turno, enquanto limpo).
 * Desligada, tudo acima vale exatamente como antes.
 *
 * Turno contaminado pela web (0033) pede até a leitura no manual: um texto de página pode ter mandado o modelo "só
 * olhar" algo que vaza. Plano sem Bash é recusa — o hook de uma máquina antiga não abre porta. O modo é o ATUAL do
 * agente, lido aqui: a dona que volta para o manual no meio de uma tarefa vale no comando seguinte.
 *
 * `arquivo` (definido em 2026-10-01, ADR-066): Write/Edit/NotebookEdit fora de ~/nod/<bot> passam pela MESMA decisão —
 * nunca é leitura, nunca é arriscado (o arriscado de arquivo é a credencial, que chega como `credencial`). Antes a gravação
 * ignorava o modo: no manual, o bot gravava em qualquer arquivo do Mac sem card.
 */
/**
 * revisto em 2026-10-11: era 8.000. O levantamento das sessões dos bots (VM e Mac, 28/09 a 11/10) achou 27 recusas
 * "entrada inválida", todas de comandos entre 8.017 e 24.613 caracteres — o `python3 - <<'EOF'` que edita um arquivo
 * grande. O corpo da rota já tem teto de 1 MB; este limite só segura o comando absurdo.
 */
export const COMANDO_MAX = 64_000;

type Permitir = { permitir: true; porque: PorqueRoda };
/** O que o total rodou sem a pessoa e vai para a Atividade (`acoes_pelo_modo`, veredito nulo; PR 6). */
type RegistroDoTotal = { tipo: TipoAcaoDoModo; gatilho: GatilhoAcaoDoModo; risco: string | null };
type AgenteDoPedido = { nome: string; titulo: string; descricao: string } | null;
type PedeCard = { card: { agenteNome: string | null; motivo: Extract<DecisaoSemRevisor, { automatico: false }> | null; risco: string | null } };
/** ADR-115: o modo mandou ao revisor (só com a chave `NOD_REVISOR` ligada). */
type VaiAoRevisor = { revisar: { gatilho: GatilhoDeRevisao; contaminado: boolean; agente: AgenteDoPedido; risco: string | null } };

/**
 * O que a chamada pede (revisto em 2026-10-14, ADR-103): um comando do terminal, gravar um arquivo, ou usar um app (MCP)
 * da pessoa. O app nunca é leitura nem arriscado pelo texto: ninguém sabe pelo nome se a ferramenta só lê, então segue o
 * modo como o comando que muda algo.
 */
/**
 * `credencial` (definido em 2026-10-19, plano dos modos de aprovação, PR 6): o hook manda ao servidor o arquivo de
 * credencial que antes negava sozinho — ler (Read, Glob, Grep, view_image), gravar (Write, Edit, NotebookEdit,
 * apply_patch) ou o pedido de um MCP da pessoa que cita uma. Nunca é leitura livre nem vai ao revisor.
 */
type AcaoNaCredencial = "ler" | "gravar" | "mcp";
type Pedido = { tipo: "comando" } | { tipo: "arquivo"; arquivo: string } | { tipo: "mcp" } | { tipo: "credencial"; caminho: string; acao: AcaoNaCredencial };

const ORIGEM_DO_PEDIDO: Record<Pedido["tipo"], OrigemDaRevisao> = { comando: "terminal", arquivo: "arquivo", mcp: "mcp", credencial: "arquivo" };

/** O tipo da linha em `acoes_pelo_modo` e o gatilho (o que o manual pediria): credencial, arriscado, fora da pasta, comum. */
function registroDoTotal(pedido: Pedido, credencial: boolean, risco: string | null): RegistroDoTotal {
  const tipo: TipoAcaoDoModo = pedido.tipo === "credencial" ? (pedido.acao === "ler" ? "leitura_credencial" : pedido.acao === "gravar" ? "arquivo" : "mcp") : pedido.tipo;
  if (credencial) return { tipo, gatilho: "credencial", risco };
  return { tipo, gatilho: risco !== null ? "arriscado" : pedido.tipo === "arquivo" ? "fora_da_pasta" : "comum", risco };
}

/**
 * Os passos 1–4 acima, sem efeito: roda (e por quê) ou pede card. Quem cria o card é `autorizarComando`. `medir`: o PR 1
 * do plano dos modos de aprovação conta, no ponto em que o modo seria consultado, o que o Automático novo faria (só o
 * card do terminal; o `esperar_comando` não abre card e fica sem revisor).
 */
async function decidirComando(deps: Deps, plano: PlanoTurno, texto: string, pedido: Pedido, medir = false): Promise<(Permitir & { registro?: RegistroDoTotal }) | PedeCard | VaiAoRevisor | { negar: string }> {
  const contaminado = plano.confiancaEntrada !== "confiavel" || (await deps.repos.turnos.contaminado(plano.turnoId));
  if (pedido.tipo === "comando" && classificarComando(texto).tipo === "leitura" && !contaminado) return { permitir: true, porque: "leitura" };
  // revisto em 2026-10-18 (revisão de engenharia 4): pelo texto do item, que acha também a gravação de arquivo aprovada.
  const aprovado = await deps.repos.itensAprovacao.aprovadoNaCadeia(plano.turnoId, texto, guardaArquivo(pedido));
  if (aprovado === "pessoa") return { permitir: true, porque: "aprovado" };
  // A liberação do REVISOR vale só enquanto ele vale (revisão do PR 3a): a pessoa que volta o bot para o manual, ou a
  // chave desligada no meio do turno, faz o mesmo comando seguir a regra de agora — não a liberação de antes.
  if (aprovado === "revisor" && deps.services.revisor?.config.ligado === true && modoNoTurno((await deps.repos.agentes.buscar(plano.agenteId))?.modoAprovacao, plano.autoria) === "automatico") {
    return { permitir: true, porque: "revisor" };
  }
  const risco = pedido.tipo === "comando" ? comandoArriscado(texto) : null;
  const alvo = pedido.tipo === "arquivo" ? pedido.arquivo : pedido.tipo === "credencial" ? pedido.caminho : texto;
  // PR 6: o pedido de credencial é credencial por definição (o hook já casou `tocaCredencial`); o servidor confere de novo
  // só para a chave do próprio nod, que nem o total libera.
  const credencial = pedido.tipo === "credencial" || tocaCredencial(alvo);
  const chaveDoNod = credencial && tocaChaveDoNod(alvo);
  // definido em 2026-09-30 (ADR-062, auditoria das aprovações): "o resto desta tarefa" libera o comando comum, não
  // a credencial nem o arriscado — antes esta linha vinha antes das duas cercas, e um "pode fazer" num `ls` liberava
  // o `security find-generic-password` e o `rm -rf` seguintes, que nem o modo total libera sem a pessoa.
  if (!contaminado && !credencial && risco === null && (await terminalLiberadoNaTarefa(deps, plano.turnoId))) {
    return { permitir: true, porque: "liberado_na_tarefa" };
  }
  const agente = await deps.repos.agentes.buscar(plano.agenteId);
  // NOD-443 (ADR-143, revisão 3): no turno a pedido de outra pessoa vale o manual, qualquer que seja o modo da dona.
  const modoAprovacao = modoNoTurno(agente?.modoAprovacao, plano.autoria);
  // ADR-115: a chave `NOD_REVISOR`. Desligada, a decisão é exatamente a de hoje (envio e contaminado não pesam).
  const revisor = deps.services.revisor?.config.ligado === true;
  // Envio para fora: no terminal, `enviaPeloTerminal`; todo MCP da pessoa (o nome não diz se só lê); gravar arquivo, nunca.
  const envioParaFora = pedido.tipo === "mcp" || (pedido.tipo === "comando" && enviaPeloTerminal(texto));
  const medida = { origem: ORIGEM_DO_PEDIDO[pedido.tipo], arriscada: risco !== null, credencial, envioParaFora, contaminado };
  const avaliacao = medir ? await medirRevisao(deps, plano, modoAprovacao, medida) : revisor ? await avaliarRevisao(deps, plano, medida).catch(() => null) : null;
  // ADR-066: conteúdo de fora não para o automático nem o total — só o manual, que já chega aqui pedindo. Com o revisor
  // ligado, o envio para fora depois de conteúdo de fora (turno ou conversa em 24 h) vai a ele (plano, 3a). Se a leitura
  // da conversa falhou (avaliação nula), o lado seguro: conta como contaminado — o envio vai ao revisor, nunca roda direto.
  const contaminadoParaRevisor = avaliacao ? avaliacao.contaminado : revisor || contaminado;
  const decidido = decidirPeloModo(modoAprovacao, { arriscada: risco !== null, credencial, chaveDoNod, envioParaFora, contaminado: contaminadoParaRevisor }, revisor);
  // O manual não muda (PR 6): o arquivo de credencial continua negado ali, com a frase que o hook dizia sozinho.
  if (decidido === null && pedido.tipo === "credencial") return { negar: pedido.acao === "mcp" ? FRASE_MCP_COM_CREDENCIAL : FRASE_ARQUIVO_DE_CREDENCIAL };
  // O `esperar_comando` (medir = false) não abre cartão nem tem revisor: o que seria revisado não roda por ali.
  if (decidido && "revisar" in decidido && medir) {
    return { revisar: { gatilho: decidido.gatilho, contaminado: contaminadoParaRevisor, agente: agente ? { nome: agente.nome, titulo: agente.titulo, descricao: agente.descricao } : null, risco } };
  }
  const doModo = semRevisor(decidido);
  if (doModo?.automatico) return doModo.regra === REGRA_MODO_TOTAL ? { permitir: true, porque: "modo_total", registro: registroDoTotal(pedido, credencial, risco) } : { permitir: true, porque: "modo_automatico" };
  return { card: { agenteNome: agente?.nome ?? null, motivo: doModo ?? null, risco } };
}

/**
 * definido em 2026-10-12 (ADR-099, parte 2): `esperar_comando` passa o comando pelas MESMAS regras do terminal do bot, mas
 * não abre card — o turno vai encerrar logo depois, e ninguém esperaria a resposta. null = o comando pediria aprovação.
 */
/**
 * `registrar` (revisão do PR 6): grava em `acoes_pelo_modo` o que o total liberou (nada nos outros casos). Quem chama o
 * chama só quando a espera foi criada de fato, na mesma transação — antes, a segunda espera do turno (`ja_esperando`)
 * deixava na Atividade um "Rodou sem perguntar" de um comando que não ia rodar.
 */
export async function comandoRodaSemCard(deps: Deps, plano: PlanoTurno, comando: string): Promise<(Permitir & { registrar: () => Promise<void> }) | null> {
  if (!(plano.nativas ?? []).includes("Bash")) return null;
  const texto = comando.trim();
  // PR 6: o total libera a credencial só no terminal do bot, onde fica registrada na Atividade; a espera, que roda fora
  // do CLI e não registra, continua como antes — comando com credencial não roda por ali, em nenhum modo.
  if (texto === "" || texto.length > COMANDO_MAX || tocaCredencial(texto)) return null;
  const r = await decidirComando(deps, plano, texto, { tipo: "comando" });
  if (!("permitir" in r)) return null;
  const { registro } = r;
  return { permitir: true, porque: r.porque, registrar: async () => (registro ? registrarNoTotal(deps, plano, texto, registro) : undefined) };
}

/**
 * PR 6 (ADR-115): o que o "Ignorar todas as aprovações" rodou e o manual pediria fica em `acoes_pelo_modo`, a fonte da
 * Atividade (filtro "Sem aprovação") e da linha embaixo da fala. Texto redigido, nunca na trilha.
 */
async function registrarNoTotal(deps: Deps, plano: PlanoTurno, texto: string, registro: RegistroDoTotal): Promise<void> {
  await deps.repos.acoesPeloModo.registrar({ agenteId: plano.agenteId, conversaId: plano.conversaId, turnoId: plano.turnoId, decisaoId: null, modo: "total", resumo: resumoDeTexto(texto), ...registro });
}

/** O item do pedido guarda `{ arquivo }` (gravar fora da pasta, e ler ou gravar arquivo de credencial) ou `{ comando }`. */
function guardaArquivo(pedido: Pedido): boolean {
  return pedido.tipo === "arquivo" || (pedido.tipo === "credencial" && pedido.acao !== "mcp");
}

/** ADR-103: gravar arquivo é o Write no Claude e o apply_patch no Codex; o plano traz um ou outro. */
const NATIVAS_QUE_GRAVAM = ["Write", "apply_patch"];

/** Quem mandou o arquivo de credencial (o hook, pela ferramenta): o que a pessoa está deixando o bot fazer com ele. */
export function acaoNaCredencial(ferramenta: string): AcaoNaCredencial {
  if (ferramenta === NATIVA_MCP_DA_PESSOA) return "mcp";
  return ["Write", "Edit", "NotebookEdit", "apply_patch"].includes(ferramenta) ? "gravar" : "ler";
}

const FRASE_DA_CREDENCIAL: Record<AcaoNaCredencial, string> = { ler: "ler um arquivo de credencial do seu Mac", gravar: "mudar um arquivo de credencial do seu Mac", mcp: "usar um app seu com uma credencial" };

type EntradaAutorizar =
  | { plano: PlanoTurno; comando: string }
  | { plano: PlanoTurno; arquivo: string }
  | { plano: PlanoTurno; mcp: string }
  /** PR 6: `ferramenta` é a nativa que o hook mandou (tem de estar no plano); `credencial`, o caminho ou o pedido do MCP. */
  | { plano: PlanoTurno; credencial: string; ferramenta: string };

/** O pedido, o texto do item (o que a pessoa lê no cartão e o que a segunda consulta compara) e a nativa que o plano exige. */
function pedidoDaEntrada(entrada: EntradaAutorizar): { pedido: Pedido; texto: string; noPlano: boolean; campo: string } {
  const nativas = entrada.plano.nativas ?? [];
  if ("credencial" in entrada) {
    const caminho = entrada.credencial.trim();
    const acao = acaoNaCredencial(entrada.ferramenta);
    return { pedido: { tipo: "credencial", caminho, acao }, texto: caminho === "" ? "" : acao === "ler" ? `Ler ${caminho}` : acao === "gravar" ? `Gravar ${caminho}` : caminho, noPlano: nativas.includes(entrada.ferramenta), campo: "credencial" };
  }
  if ("arquivo" in entrada) {
    const arquivo = entrada.arquivo.trim();
    return { pedido: { tipo: "arquivo", arquivo }, texto: arquivo === "" ? "" : `Gravar ${arquivo}`, noPlano: NATIVAS_QUE_GRAVAM.some((n) => nativas.includes(n)), campo: "arquivo" };
  }
  if ("mcp" in entrada) return { pedido: { tipo: "mcp" }, texto: entrada.mcp.trim(), noPlano: nativas.includes(NATIVA_MCP_DA_PESSOA), campo: "mcp" };
  return { pedido: { tipo: "comando" }, texto: entrada.comando.trim(), noPlano: nativas.includes("Bash"), campo: "comando" };
}

export const autorizarComando: CasoDeUso<EntradaAutorizar, SaidaAutorizarComando> = async (deps, entrada) => {
  const { plano } = entrada;
  const { pedido, texto, noPlano, campo } = pedidoDaEntrada(entrada);
  if (!noPlano) throw new ErroDeDominio("nao_permitido", { cause: `${campo === "arquivo" ? "gravar arquivo" : campo === "mcp" ? NATIVA_MCP_DA_PESSOA : campo === "credencial" ? "credencial" : "Bash"} fora do plano deste turno` });
  if (texto === "" || texto.length > COMANDO_MAX) throw new ErroDeDominio("entrada_invalida", { cause: campo });
  const decidido = await decidirComando(deps, plano, texto, pedido, true);
  if ("negar" in decidido) return { data: { negar: decidido.negar } };
  if ("permitir" in decidido) {
    if (decidido.registro) await registrarNoTotal(deps, plano, texto, decidido.registro);
    return { data: { permitir: true, porque: decidido.porque } };
  }
  const arquivoDoItem = pedido.tipo === "arquivo" ? pedido.arquivo : pedido.tipo === "credencial" && pedido.acao !== "mcp" ? pedido.caminho : null;
  const destino = { ...DESTINO_TERMINAL, argumentos: arquivoDoItem === null ? { comando: texto } : { arquivo: arquivoDoItem } };
  const oQue = pedido.tipo === "credencial" ? FRASE_DA_CREDENCIAL[pedido.acao] : pedido.tipo === "arquivo" ? "gravar um arquivo no seu Mac" : pedido.tipo === "mcp" ? "usar um app seu" : "rodar um comando no seu Mac";
  const fraseDoPedido = (nome: string | null) => `${nome ?? "O bot"} quer ${oQue}`;
  if ("revisar" in decidido && pedido.tipo !== "credencial") {
    // ADR-115: fase 1 do revisor (revisar-acao.ts) em vez do cartão. O hook não muda: espera a decisão `em_revisao`.
    // A credencial nunca chega aqui: no Automático ela é cartão, sem revisor (decidirPeloModo).
    const { gatilho, contaminado, agente, risco } = decidido.revisar;
    const acao = pedido.tipo === "arquivo" ? { tipo: "arquivo" as const, caminho: pedido.arquivo } : pedido.tipo === "mcp" ? { tipo: "mcp" as const, pedido: texto } : { tipo: "comando" as const, comando: texto };
    const r = await revisarAcaoFase1(deps, { plano, tipo: pedido.tipo, itens: [{ texto, destino }], acao, gatilho, risco: risco ?? RISCO_DO_GATILHO[gatilho], contaminado, frase: fraseDoPedido(agente?.nome ?? null), agente });
    return { data: r.data.revisao ? { aguardar: r.data.aguardar, revisao: r.data.revisao } : { aguardar: r.data.aguardar }, events: r.events ?? [] };
  }
  if (!("card" in decidido)) throw new ErroDeDominio("estado_invalido", { cause: "credencial mandada ao revisor" });
  const { agenteNome, motivo: doModo, risco } = decidido.card;

  const agora = deps.agora();
  const decisao = await deps.repos.decisoes.criar({
    tipo: "aprovacao",
    agenteId: plano.agenteId,
    conversaId: plano.conversaId,
    turnoId: plano.turnoId,
    prazoDecisaoEm: agora + PRAZO_DECISAO_MS,
    frase: fraseDoPedido(agenteNome),
  });
  if (!decisao) throw new ErroDeDominio("estado_invalido", { cause: "decisão não criada" });
  await deps.repos.itensAprovacao.criarLote(decisao.id, [{ idx: 0, texto, destino, origemSensivel: false, motivoManual: doModo?.motivo ?? "destino_terminal",
    // ADR-059: o porquê do arriscado, em frase fixa do domínio (nunca texto do modelo), para o card dizer o que parou.
    ...(doModo?.motivo === "acao_arriscada" && risco ? { justificativa: risco } : {}) }]);
  // NOD-70: o comando que parou no cartão vira linha `cartao` (o hook não grava nada ao aguardar).
  await registrarCartoes(deps, { agenteId: plano.agenteId, turnoId: plano.turnoId, itens: [{ destino, motivo: doModo?.motivo ?? "destino_terminal" }] });
  const evento: RuntimeEvent = {
    tenantId: deps.escopo.tenantId,
    id: randomUUID(),
    createdAt: agora,
    kind: "decisao_criada",
    autoria: autoriaDoAgente(deps.escopo, plano.agenteId),
    pessoaDestinoId: deps.escopo.pessoaId,
    conversaId: plano.conversaId,
    turnoId: plano.turnoId,
    dados: { decisao_id: decisao.id, tipo: "aprovacao", itens: 1, sensiveis: 0 },
  };
  return { data: { aguardar: decisao.id }, events: [evento] };
};
