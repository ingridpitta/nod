import type { PayloadPropostaCredencial, Proposta } from "../contracts/conversa.ts";
import type { CapacidadeConector, Conector } from "../contracts/conector.ts";
import type { RuntimeEvent } from "../contracts/evento.ts";
import { chavePedivel, conectorGeridoPeloNod, validarCredenciais } from "../domain/credenciais-conector.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import { autoriaPessoa, evento, PRAZO_DECISAO_PADRAO_MS } from "./autoria-evento.ts";
import { enfileirarRetomada } from "./enfileirar-retomada.ts";
import { payloadDaPropostaDecidida } from "./proposta-decidida.ts";
import { conectorPublico } from "./registrar-conector.ts";
import type { CasoDeUso, Deps } from "./tipos.ts";
import { sincronizarDasDecisoes } from "./trabalhos.ts";

/**
 * O lado da pessoa no cartão de credencial (definido em 2026-10-28, NOD-50). Três fases:
 *   1. `pedidoDeCredencialAberto`: o cartão é da pessoa, é 'credencial' e a decisão de mesmo id está aberta (travada: duas
 *      tentativas no mesmo cartão se serializam e a segunda acha a decisão fechada).
 *   2. alvo 'conector': `chaveCandidataDoConector` monta o env com só a chave pedida trocada, `sondarChaveCandidata` o sonda
 *      FORA da tx e `gravarChaveCandidata` grava (compare-and-set) se passou, já na tx que fecha o cartão.
 *   3. `fecharPedidoDeCredencial`: a decisão fecha, a proposta confirma (guardada) ou recusa, o recibo encolhe o cartão e
 *      o turno que pediu retoma sabendo só "guardada" ou "recusada".
 * O VALOR nunca sai destas funções: não vai a evento, mensagem, payload, `cause` de erro, log nem entrada de turno. O
 * teste tests/integration/credencial.test.ts procura o valor no banco inteiro depois do fluxo.
 */

export type ResultadoCredencial = "guardada" | "recusada";

/** O teto do valor colado (o mesmo da chave do Composio em /marketplace/configurar). */
export const TETO_VALOR_CREDENCIAL = 4096;

/**
 * O valor do campo, aparado, ou entrada_invalida: vazio, grande demais ou com caractere de controle (a quebra de linha
 * viraria header; o NUL faz o spawn lançar um erro cuja mensagem carrega o valor).
 */
export function valorDeCredencial(bruto: unknown): string {
  const valor = typeof bruto === "string" ? bruto.trim() : "";
  // eslint-disable-next-line no-control-regex
  if (!valor || valor.length > TETO_VALOR_CREDENCIAL || /[\x00-\x1f\x7f]/.test(valor)) throw new ErroDeDominio("entrada_invalida");
  // Revisão 8: o invisível que vem colado de PDF ou chat (U+200B, U+FEFF, NBSP…) quebraria a chave sem ninguém ver.
  if (/[\p{Cf}\u0080-\u009f\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]/u.test(valor)) throw new ErroDeDominio("entrada_invalida");
  return valor;
}

/** Fase 1: o cartão aberto (travado até o fim da tx). Proposta de outra pessoa = nao_encontrado (a busca é da dona). */
export const pedidoDeCredencialAberto: CasoDeUso<{ propostaId: string }, { proposta: Proposta; payload: PayloadPropostaCredencial }> = async (deps, input) => {
  const proposta = await deps.repos.propostas.buscarParaAtualizar(input.propostaId);
  if (!proposta || proposta.payload.kind !== "credencial") throw new ErroDeDominio("nao_encontrado");
  const decisao = await deps.repos.decisoes.buscar(proposta.id);
  if (proposta.estado !== "pendente" || !decisao || (decisao.estado !== "pendente" && decisao.estado !== "reaberta")) throw new ErroDeDominio("estado_invalido");
  return { data: { proposta, payload: proposta.payload } };
};

export type SondaDaChave = { ok: true } | { ok: false; causa: "acesso_recusado" | "indisponivel" };

/** O env candidato (em claro, só em memória) e o env cifrado lido junto, que o compare-and-set da gravação confere. */
export type ChaveCandidata = { conector: Conector; env: Record<string, string>; envAntes: string | null };

/**
 * Authorization (revisões 6, 7 e 9): a pessoa cola só o token. Sem esquema, ganha o Bearer do valor antigo (que sempre
 * existe: Authorization só se pede se declarado); com esquema, ou se o antigo não era Bearer, fica como veio.
 */
export function valorDoHeader(nome: string, valor: string, antigo: unknown, transporte: Conector["transporte"]): string {
  if (transporte !== "http" || nome.toLowerCase() !== "authorization" || /^[A-Za-z][\w-]*\s+\S/.test(valor)) return valor;
  // Só Bearer se herda (revisão 9): em Basic o valor é usuário:senha em base64, não "o token" — cola-se completo.
  const esquema = typeof antigo === "string" ? /^(bearer)\s+\S/i.exec(antigo)?.[1] : undefined;
  return esquema ? `${esquema} ${valor}` : valor;
}

/**
 * Fase 2a (alvo 'conector', tx curta): decifra o env e troca SÓ a chave pedida em memória. Nada é gravado. As recusas são
 * as da escrita de credenciais (atualizar-credenciais-conector.ts): conector de outra pessoa = nao_encontrado, nativo =
 * entrada_invalida, nome fora de `chavePedivel` = entrada_invalida.
 */
export const chaveCandidataDoConector: CasoDeUso<{ conectorId: string; chave: string; valor: string; decifrar: (s: string) => string }, ChaveCandidata> = async (deps, input) => {
  const c = await deps.repos.conectores.buscar(input.conectorId);
  if (!c || c.ownerId !== deps.escopo.pessoaId) throw new ErroDeDominio("nao_encontrado", { cause: "conector" });
  if (conectorGeridoPeloNod(c, (await deps.repos.composio.sessao(c.slug))?.conectorId)) throw new ErroDeDominio("entrada_invalida", { cause: "conector gerido pelo nod" });
  if (!chavePedivel(input.chave, c.transporte, Object.keys(c.env))) throw new ErroDeDominio("entrada_invalida", { cause: "nome da chave" });
  const atual: unknown = c.envCifrado ? JSON.parse(input.decifrar(c.envCifrado)) : {};
  const antes: Record<string, unknown> = typeof atual === "object" && atual !== null ? { ...atual } : {};
  // http (revisão 6): header não diferencia caixa — troca o declarado (x-api-key → X-API-Key), nunca duplica.
  const nome = c.transporte === "http" ? (Object.keys(antes).find((d) => d.toLowerCase() === input.chave.toLowerCase()) ?? input.chave) : input.chave;
  // Header só leva Latin-1: fora disso o fetch lança e a pessoa veria "não respondeu" (revisão 8).
  if (c.transporte === "http" && /[^\x20-\xff]/.test(input.valor)) throw new ErroDeDominio("entrada_invalida", { cause: "valor fora do que um header leva" });
  const env = validarCredenciais({ ...antes, [nome]: valorDoHeader(nome, input.valor, antes[nome], c.transporte) }, c.transporte);
  return { data: { conector: conectorPublico(c), env, envAntes: c.envCifrado } };
};

/**
 * Fase 2b (FORA de transação): sonda o env candidato no lugar do guardado. A sonda (spawn stdio, rede) leva segundos;
 * fora da tx ela não segura a proposta travada nem uma conexão do pool (revisão 3 do PR #553).
 */
export async function sondarChaveCandidata(conectores: Pick<Deps["services"]["conectores"], "sondar">, k: ChaveCandidata): Promise<SondaDaChave & { ferramentas: CapacidadeConector[] }> {
  // manterVivos: a candidata pode ser reprovada; os clientes vivos (com a chave que funciona) só caem depois do commit.
  const r = await conectores.sondar(k.conector, { env: k.env, manterVivos: true });
  if (!r.ok) return { ok: false, causa: r.causa === "acesso_recusado" ? "acesso_recusado" : "indisponivel", ferramentas: [] };
  return { ok: true, ferramentas: r.ferramentas };
}

/**
 * Fase 2c (na tx que fecha o cartão, depois de `pedidoDeCredencialAberto` de novo): grava a candidata aprovada por
 * compare-and-set sobre o env lido na 2a. Se outra gravação (outro cartão, o PATCH da tela) veio no meio, nada é gravado
 * (estado_invalido). Não há env provisório no cofre nem restauração; a reprovação nem chega aqui, e não vira
 * `ultimaFalha` de um conector que segue funcionando com a chave de antes.
 */
export const gravarChaveCandidata: CasoDeUso<{ candidata: ChaveCandidata; ferramentas: CapacidadeConector[]; cifrar: (s: string) => string }, { slug: string }> = async (deps, input) => {
  const { conector, env, envAntes } = input.candidata;
  const gravou = await deps.repos.conectores.atualizarEnvSe(conector.id, envAntes, { envCifrado: input.cifrar(JSON.stringify(env)), envChaves: Object.keys(env).sort() });
  // Outra gravação veio no meio: nada muda e a pessoa tenta de novo (o cartão mostra "Tentar de novo"; a próxima relê o env).
  if (!gravou) throw new ErroDeDominio("conector_indisponivel", { cause: "o env do conector mudou durante a sonda" });
  const sondado = await deps.repos.conectores.registrarSonda(conector.id, { ok: true, catalogo: input.ferramentas, agora: deps.agora() });
  if (!sondado) throw new ErroDeDominio("nao_encontrado", { cause: "conector" });
  return { data: { slug: conector.slug } };
};

/**
 * O que se sabe da guarda (revisões 4 e 5 do PR #553): `aceita` = o app conferiu (GitHub, Composio, sonda http);
 * `nao_testada` = stdio, cuja sonda (tools/list) não autentica; `ja_havia` = o Composio do time foi configurado enquanto o
 * cartão estava aberto, e a chave colada NÃO foi usada; `nao_habilitado` = o GitHub aceitou o token, mas a sonda do conector
 * falhou (revisão 8): o bot não ouve que as ferramentas já o usam.
 */
export type DetalheDaGuarda = "aceita" | "nao_testada" | "ja_havia" | "nao_habilitado";

function textoDoRecibo(p: PayloadPropostaCredencial, resultado: ResultadoCredencial, detalhe: DetalheDaGuarda): string {
  const o_que = p.alvo === "github_token" ? "Token do GitHub" : p.alvo === "composio" ? "Chave do Composio" : `Chave do ${p.app}`;
  if (resultado === "recusada") return `${o_que} deixada de lado.`;
  return detalhe === "ja_havia" ? "O time já tinha uma chave do Composio; a colada não foi usada." : `${o_que} guardada no cofre.`;
}

/** O que o turno de retomada lê: o resultado e nada do valor. */
/**
 * `testada`: a sonda conferiu a chave (http: o servidor do app respondeu com ela). Em stdio a sonda é um tools/list que
 * quase nenhum servidor autentica, então o bot ouve que a chave só se confere no primeiro uso (revisão 4 do PR #553).
 */
function entradaDaRetomada(p: PayloadPropostaCredencial, resultado: ResultadoCredencial, original: string, detalhe: DetalheDaGuarda): string {
  const alvo = p.alvo === "github_token" ? "o token do GitHub" : p.alvo === "composio" ? "a chave do Composio" : `a chave ${p.chave ?? ""} do conector ${p.app}`;
  const como = detalhe === "aceita" ? (p.alvo === "conector" ? "e a conexão foi testada com ela" : `e o ${p.app} aceitou`) : "e o conector subiu com ela (a chave só se confere no primeiro uso)";
  return [
    resultado === "guardada" && detalhe === "ja_havia"
      ? "pedir_credencial: guardada. O time já tinha uma chave do Composio configurada (a que a pessoa colou não foi usada). Você não vê o valor e não precisa dele: siga com as ferramentas do Composio."
      : resultado === "guardada" && detalhe === "nao_habilitado"
      ? `pedir_credencial: guardada. A pessoa guardou ${alvo} no cofre e o GitHub aceitou, mas o conector não subiu com ele. Você não vê o valor e não precisa dele: chame ver_apps_conectados e, se o GitHub seguir fora, diga à pessoa que a tela de apps mostra o que falhou (não peça o token de novo).`
      : resultado === "guardada"
      ? `pedir_credencial: guardada. A pessoa guardou ${alvo} no cofre ${como}. Você não vê o valor e não precisa dele: as ferramentas do app passam a usá-lo (se uma delas ainda falhar, chame ver_apps_conectados antes de pedir de novo).`
      : `pedir_credencial: recusada. A pessoa deixou ${alvo} de lado. Siga sem ele: diga o que não dá para fazer sem a chave e não peça o valor no chat.`,
    "Retome a tarefa que motivou o pedido, usando o contexto da conversa e a entrada original abaixo. Confira o que já foi feito e não duplique envios.",
    "Entrada do turno original:",
    original,
  ].join("\n");
}

/**
 * Fase 3: fecha o cartão. Ordem proposta → decisão (a de "Sua vez" desde a NOD-197): quem chega depois relê a proposta
 * travada e acha a decisão fechada (estado_invalido). Roda na tx da DONA. Retoma o turno que pediu, se ele ainda puder.
 */
export const fecharPedidoDeCredencial: CasoDeUso<{ propostaId: string; resultado: ResultadoCredencial; detalhe?: DetalheDaGuarda }, { turnoId: string | null }> = async (deps, input) => {
  const agora = deps.agora();
  const proposta = await deps.repos.propostas.buscarParaAtualizar(input.propostaId);
  if (!proposta || proposta.payload.kind !== "credencial") throw new ErroDeDominio("nao_encontrado");
  const p = proposta.payload;
  const decisao = await deps.repos.decisoes.decidir(proposta.id, { por: deps.escopo.pessoaId, agora });
  if (!decisao) throw new ErroDeDominio("estado_invalido", { cause: "decisão fechada" });
  const decidida = await deps.repos.propostas.decidir(proposta.id, input.resultado === "guardada" ? "confirmada" : "recusada");
  if (!decidida) throw new ErroDeDominio("estado_invalido", { cause: `proposta ${proposta.estado}` });
  const autoria = autoriaPessoa(deps.escopo);
  const events: RuntimeEvent[] = [
    evento(deps.escopo, { kind: "decisao_decidida", autoria, agora, conversaId: decisao.conversaId, turnoId: decisao.turnoId, dados: { decisao_id: decisao.id, tipo: "credencial", recusada: input.resultado === "recusada" } }),
  ];
  const mensagem = await deps.repos.mensagens.criar({
    conversaId: proposta.conversaId,
    autoria,
    kind: "sistema",
    texto: textoDoRecibo(p, input.resultado, input.detalhe ?? "aceita"),
    payload: await payloadDaPropostaDecidida(deps, decidida, input.resultado === "guardada" ? "confirmada" : "recusada"),
    confianca: "confiavel",
  });
  if (mensagem) events.push(evento(deps.escopo, { kind: "mensagem_criada", autoria, agora, conversaId: proposta.conversaId, dados: { mensagem_id: mensagem.id, kind: "sistema" } }));
  events.push(...(await sincronizarDasDecisoes(deps, [decisao])));

  const turnoId = decisao.turnoId ?? p.turnoId ?? null;
  const original = turnoId ? await deps.repos.turnos.buscar(turnoId) : null;
  if (!original || original.agenteId !== decisao.agenteId || original.conversaId !== decisao.conversaId) return { data: { turnoId: null }, events };
  if (await deps.repos.agentes.execucaoBloqueada(original.id)) return { data: { turnoId: null }, events };
  const { turno, nova } = await enfileirarRetomada(deps, {
    original,
    prazoEm: agora + PRAZO_DECISAO_PADRAO_MS,
    entradaTexto: entradaDaRetomada(p, input.resultado, original.entradaTexto, input.detalhe ?? "aceita"),
    reenvios: original.reenvios + 1,
  });
  if (nova && turno) events.push(evento(deps.escopo, { kind: "turno_criado", autoria, agora, conversaId: turno.conversaId, turnoId: turno.id, dados: { origem: "retomada", retoma_turno_id: original.id, decisao_id: decisao.id } }));
  return { data: { turnoId: turno?.id ?? null }, events };
};
