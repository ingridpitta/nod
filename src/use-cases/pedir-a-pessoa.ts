import { randomUUID } from "node:crypto";
import { ligarDecisaoATarefa } from "./tarefa-casa.ts";
import type { Decisao, TipoDecisao } from "../contracts/decisao.ts";
import type { RuntimeEvent } from "../contracts/evento.ts";
import type { PayloadMensagem } from "../contracts/mensagem.ts";
import { MAX_CARACTERES_OPCAO, MAX_OPCOES, TIPOS_PEDIDO_A_PESSOA, type ArgsPedirAPessoa } from "../contracts/pedido.ts";
import type { CasoNod, ContextoFerramenta } from "../contracts/servicos.ts";
import { chaveDoFio } from "../domain/fio-da-pergunta.ts";
import { chaveDaOpcao, textoDaOpcao } from "../domain/opcoes-da-pergunta.ts";
import { rotinaDoTurno, SALTOS_DE_RETOMADA } from "./apoio-l7.ts";
import { autoriaDoAgente } from "./registrar-negacao.ts";
import type { Deps } from "./tipos.ts";

/** definido em 2026-09-16: 24 h de relógio de parede para a pessoa responder (mesmo valor do NOD_PRAZO_DECISAO_MS do .env.example). */
export const PRAZO_DECISAO_MS = 24 * 60 * 60 * 1000;

/**
 * definido em 2026-09-24 (emenda da ADR-045): as respostas prontas viram botões, e o toque manda o
 * texto da opção COMO a resposta da pessoa. Por isso a opção que não cabe (mais de 60 caracteres) SAI
 * em vez de ser cortada — cortada, a pessoa mandaria uma frase que ninguém escreveu. Não-texto,
 * vazia e repetida (sem diferença de caixa) também saem; ficam as quatro primeiras.
 * revisto em 2026-10-18 (plano "pergunta com botões", Parte 1): `de[i]` é o índice que a opção `i` tinha na lista bruta,
 * e `gemea` leva o índice bruto de uma repetida ao da que ficou — é por eles que a recomendada segue a opção certa.
 */
function opcoesComOrigem(valor: unknown): { opcoes: string[]; de: number[]; gemea: Map<number, number> } {
  const saida = { opcoes: [] as string[], de: [] as number[], gemea: new Map<number, number>() };
  if (!Array.isArray(valor)) return saida;
  const vistas = new Map<string, number>();
  for (const [i, bruta] of valor.entries()) {
    if (typeof bruta !== "string") continue;
    const opcao = textoDaOpcao(bruta);
    const chave = chaveDaOpcao(opcao);
    const ficou = vistas.get(chave);
    // A repetida aponta para a gêmea que ficou mesmo depois da 4ª (revisão do PR #389): ["Sim", …, "sim"] com a
    // recomendada na última segue para "Sim", em vez de sumir só porque a lista já estava cheia.
    if (ficou !== undefined) {
      saida.gemea.set(i, ficou);
      continue;
    }
    if (saida.opcoes.length === MAX_OPCOES || opcao === "" || [...opcao].length > MAX_CARACTERES_OPCAO) continue;
    vistas.set(chave, i);
    saida.opcoes.push(opcao);
    saida.de.push(i);
  }
  return saida;
}

export function normalizarOpcoes(valor: unknown): string[] {
  return opcoesComOrigem(valor).opcoes;
}

/**
 * definido em 2026-10-18 (plano "pergunta com botões", Parte 1): as opções normalizadas com a recomendada em PRIMEIRO
 * (`recomendada: 0`). A recomendada segue a opção pela origem: se ela era uma repetida que saiu, vale a gêmea que ficou.
 * Índice inválido (não inteiro, fora da lista), opção recomendada que saiu por tamanho ou lista vazia: sem recomendada,
 * sem erro — a pergunta nunca é recusada pelos args (EMENDA 16).
 */
export function normalizarOpcoesComRecomendada(opcoesBrutas: unknown, recomendadaBruta: unknown): { opcoes: string[]; recomendada?: number } {
  const { opcoes, de, gemea } = opcoesComOrigem(opcoesBrutas);
  if (typeof recomendadaBruta !== "number" || !Number.isInteger(recomendadaBruta)) return { opcoes };
  const origem = gemea.get(recomendadaBruta) ?? recomendadaBruta;
  const i = de.indexOf(origem);
  if (i === -1) return { opcoes };
  const recomendada = opcoes[i] as string;
  return { opcoes: [recomendada, ...opcoes.filter((_, k) => k !== i)], recomendada: 0 };
}

/**
 * Pergunta ≠ permissão (E4.4, EMENDA 16): args malformados caem no caminho de JULGAMENTO HUMANO
 * ('pergunta'), nunca em 'permissao'. Usada por chamar-ferramenta ANTES da validação de schema:
 * pedir_a_pessoa nunca é recusada por args_invalidos — vira pergunta. `opcoes` fora do limite
 * também não recusa nada: sai o que não cabe (normalizarOpcoes). Campo que esta função não copia
 * some antes do caso de uso (por isso `recomendada` passa por aqui, revisão de engenharia de 2026-10-18).
 */
export function normalizarPedidoAPessoa(args: unknown): ArgsPedirAPessoa {
  const a = (typeof args === "object" && args !== null ? args : {}) as Record<string, unknown>;
  const tipo = TIPOS_PEDIDO_A_PESSOA.find((t) => t === a.tipo) ?? "pergunta";
  const texto = typeof a.texto === "string" && a.texto.trim() !== "" ? a.texto.trim() : "(pedido sem texto)";
  const saida: ArgsPedirAPessoa = { tipo, texto };
  if (typeof a.dado === "string" && a.dado.trim() !== "") saida.dado = a.dado.trim();
  if (typeof a.quem_destrava === "string" && a.quem_destrava.trim() !== "") saida.quem_destrava = a.quem_destrava.trim();
  const { opcoes, recomendada } = normalizarOpcoesComRecomendada(a.opcoes, a.recomendada);
  if (opcoes.length > 0) saida.opcoes = opcoes;
  if (recomendada !== undefined) saida.recomendada = recomendada;
  return saida;
}

/** Resolve a pessoa nomeada entre as pessoas do tenant (nome inteiro ou primeiro nome, sem caixa); ausente/desconhecida = dona. */
export async function resolverDecisor(deps: Deps, nome: string | undefined): Promise<{ id: string; nome: string }> {
  const pessoas = await deps.repos.pessoas.listarDoTenant();
  const dona = pessoas.find((p) => p.id === deps.escopo.pessoaId) ?? { id: deps.escopo.pessoaId, nome: "você" };
  if (!nome) return { id: dona.id, nome: dona.nome };
  const alvo = nome.trim().toLowerCase();
  const achada = pessoas.find((p) => p.nome.toLowerCase() === alvo) ?? pessoas.find((p) => p.nome.toLowerCase().split(/\s+/)[0] === alvo);
  return achada ? { id: achada.id, nome: achada.nome } : { id: dona.id, nome: dona.nome };
}

/**
 * A frase da FILA ("Sua vez"), gravada em decisoes.frase. revisto em 2026-10-18 (plano "pergunta com botões", Parte 1):
 * é o `texto` inteiro, a fala do bot — saiu o molde "parei: falta X; quem destrava: Y; não vou tentar de novo" (E5.2).
 * Sem corte no banco (a coluna é `text`): a entrada da retomada cita a frase (responder-decisao.ts) e a retomada de rotina
 * roda em sessão nova, então cortada o bot perderia a própria pergunta. Quem mostra corta (avisos, CSS da fila).
 */
function fraseDoPedido(args: ArgsPedirAPessoa): string {
  return args.texto;
}

/**
 * definido em 2026-09-24 (ADR-044): a rotina que dispara às 8h, 13h e 18h e esbarra no mesmo buraco
 * perguntaria de novo a cada disparo — a Nina deixava um card por execução. Num turno de rotina, a
 * decisão PENDENTE do mesmo agente e tipo cujo turno leva à MESMA rotina já é a pergunta: reaproveita,
 * sem mensagem nem evento novos. Fora de rotina nada muda (cada conversa pergunta o que precisa).
 */
async function pedidoDaMesmaRotina(deps: Deps, input: ContextoFerramenta, tipo: TipoDecisao): Promise<Decisao | null> {
  const daRotina = await rotinaDoTurno(deps.repos, input.turnoId);
  if (!daRotina) return null;
  for (const d of await deps.repos.decisoes.pendentesDaConversa(input.conversaId)) {
    if (d.agenteId !== input.agenteId || d.tipo !== tipo || d.turnoId === null) continue;
    if ((await rotinaDoTurno(deps.repos, d.turnoId))?.rotina.id === daRotina.rotina.id) return d;
  }
  return null;
}

const PEDIDOS: ReadonlySet<TipoDecisao> = new Set<TipoDecisao>(TIPOS_PEDIDO_A_PESSOA);

/** Respondida = fechada pela resposta da pessoa (desfecho 'decidida'); dispensada não conta. */
function respondida(d: Decisao): boolean {
  return PEDIDOS.has(d.tipo) && d.estado === "decidida" && d.desfecho?.tipo === "decidida";
}

/**
 * definido em 2026-09-24 (fio da pergunta, emenda da ADR-045): a pergunta respondida que ESTE turno
 * continua — a de um dos três tipos cujo `turno_id` é o `retomaTurnoId` do turno, fechada pela resposta.
 * Achada, a pergunta nova é a rodada seguinte do mesmo fio: a pessoa pediu explicação, o agente explicou
 * e pergunta de novo. Duas respostas ao mesmo turno (duas perguntas numa chamada só) desempatam pela
 * resposta que criou ESTE turno (`turnoRetomadaId`). Sem pergunta no turno de cima, a busca só sobe
 * por uma retomada INTERROMPIDA (queda do Mac, Parar): o "Retomar" continua o mesmo trabalho. Retomada
 * que terminou normalmente encerrou o fio — a pergunta dela começa outro.
 */
async function perguntaQueEsteTurnoContinua(deps: Deps, turnoId: string): Promise<Decisao | null> {
  let turno = await deps.repos.turnos.buscar(turnoId);
  for (let saltos = 0; turno?.origem === "retomada" && turno.retomaTurnoId && saltos < SALTOS_DE_RETOMADA; saltos++) {
    const candidatas = (await deps.repos.decisoes.doTurno(turno.retomaTurnoId)).filter(respondida);
    if (candidatas.length === 1) return candidatas[0] ?? null;
    if (candidatas.length > 1) {
      const atual = turno.id;
      const [ligada] = (await deps.repos.mensagens.listarDaConversa(turno.conversaId)).flatMap((m) => (m.payload?.kind === "resposta_a_pedido" && m.payload.turnoRetomadaId === atual ? [m.payload.decisaoId] : []));
      return candidatas.find((d) => d.id === ligada) ?? candidatas.at(-1) ?? null;
    }
    const acima = await deps.repos.turnos.buscar(turno.retomaTurnoId);
    if (acima?.estado !== "interrompido") return null;
    turno = acima;
  }
  return null;
}

/**
 * Nona ferramenta nod (EMENDA 16): cria uma Decisao TIPADA ('pergunta' | 'falta_de_dado' |
 * 'permissao') dirigida à pessoa nomeada (perna extra da RLS, EMENDA 1) ou à dona e manda o modelo
 * encerrar o turno. A resposta da pessoa (POST decisoes/:id/responder, L9) cria o turno de retomada.
 * O evento vai para a DONA (o outbox só aceita a pessoa da sessão como destino); a decisora vê pela
 * fila "Sua vez".
 *
 * definido em 2026-09-24 (emenda da ADR-045, perguntas viram conversa): a mensagem na conversa é a
 * fala do próprio agente (`texto`), com payload `pedido_a_pessoa` ligando-a à decisão — a web desenha
 * a pergunta como balão, sem card e sem a frase repetida. Antes a conversa recebia o molde robótico
 * da fila E um card com a mesma frase.
 */
export const pedirAPessoa: CasoNod<Deps, "pedir_a_pessoa"> = (deps, input) => criarPedidoAPessoa(deps, input, false);

/**
 * definido em 2026-10-18 (plano "pergunta com botões", revisão de engenharia): o pedido de ajuda do computador
 * (`computador_pedir_ajuda`, adapters/fundo/computadores.ts) se responde com "Assumir controle", não com texto. O payload
 * leva `ajudaDoComputador` para a web não oferecer "Ou responda no chat abaixo" nem fechar a ajuda com a mensagem digitada
 * — o controle ficaria em `aguardando_pessoa` com o bot já retomado. A ferramenta do modelo nunca chega aqui.
 */
export const pedirAjudaDoComputador: CasoNod<Deps, "pedir_a_pessoa"> = (deps, input) => criarPedidoAPessoa(deps, input, true);

async function criarPedidoAPessoa(deps: Deps, input: Parameters<typeof pedirAPessoa>[1], ajudaDoComputador: boolean): ReturnType<typeof pedirAPessoa> {
  const agora = deps.agora();
  const args = normalizarPedidoAPessoa(input);
  const tipo: TipoDecisao = args.tipo;
  // definido em 2026-09-24 (fio da pergunta): a rodada seguinte de uma pergunta respondida nunca é
  // "a mesma pergunta da rotina" — é o agente explicando e perguntando de novo, então não reaproveita.
  const anterior = await perguntaQueEsteTurnoContinua(deps, input.turnoId);
  const repetida = anterior ? null : await pedidoDaMesmaRotina(deps, input, tipo);
  if (repetida) return { data: { estado: "pendente", decisao_id: repetida.id, instrucao: "encerre o turno; a resposta retoma depois" }, events: [] };
  const decisor = await resolverDecisor(deps, args.quem_destrava);
  const frase = fraseDoPedido(args);
  const decisao = await deps.repos.decisoes.criar({
    tipo,
    decisorId: decisor.id,
    agenteId: input.agenteId,
    conversaId: input.conversaId,
    turnoId: input.turnoId,
    // Cada rodada tem o próprio prazo (24 h a partir desta pergunta) e as próprias opções.
    prazoDecisaoEm: agora + PRAZO_DECISAO_MS,
    frase,
    fioId: anterior ? chaveDoFio(anterior) : null,
  });
  if (!decisao) throw new Error("decisão não criada");
  const autoria = autoriaDoAgente(deps.escopo, input.agenteId);
  const payload: PayloadMensagem = { kind: "pedido_a_pessoa", decisaoId: decisao.id, ...(args.opcoes ? { opcoes: args.opcoes } : {}), ...(args.recomendada !== undefined ? { recomendada: args.recomendada } : {}), ...(ajudaDoComputador ? { ajudaDoComputador: true as const } : {}) };
  const criada = await deps.repos.mensagens.criar({ conversaId: input.conversaId, turnoId: input.turnoId, autoria, kind: "texto", texto: args.texto, payload, confianca: "confiavel" });
  // NOD-402 (ADR-130): a pergunta da rotina, do colega ou da retomada deles vai no frame com a marca dos bastidores, como
  // no GET; sem ela a web a punha no meio do turno da pessoa até a releitura.
  const doTurno = criada ? await deps.repos.turnos.buscar(input.turnoId) : null;
  const mensagem = criada && doTurno?.bastidores && !doTurno.trabalhoId ? { ...criada, bastidores: true } : criada;
  const evento: RuntimeEvent = {
    tenantId: deps.escopo.tenantId,
    id: randomUUID(),
    createdAt: agora,
    kind: "decisao_criada",
    autoria,
    pessoaDestinoId: deps.escopo.pessoaId,
    conversaId: input.conversaId,
    turnoId: input.turnoId,
    // Parte 4 do plano "o pensamento no chat" (2026-10-26): a fala da pergunta vai no frame (JSON, porque `DadosEvento` é
    // chato), e a web desenha o cartão na hora, sem esperar a releitura. Cliente de antes ignora o campo.
    dados: { decisao_id: decisao.id, tipo, decisor_id: decisor.id, prazo_decisao_em: decisao.prazoDecisaoEm, ...(decisao.fioId ? { fio_id: decisao.fioId } : {}), ...(mensagem ? { mensagem_json: JSON.stringify(mensagem) } : {}) },
  };
  // ADA-28 (ADR-159): a pergunta feita durante uma tarefa é a espera dela (um único "Precisa de você").
  const daTarefa = await ligarDecisaoATarefa(deps, decisao);
  return { data: { estado: "pendente", decisao_id: decisao.id, instrucao: "encerre o turno; a resposta retoma depois" }, events: [evento, ...daTarefa] };
}
