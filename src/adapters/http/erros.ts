import type { ServerResponse } from "node:http";
import { ehErroDeDominio, ErroDeDominio, type CodigoErro } from "../../domain/erro.ts";
import { redigirECortar } from "../../domain/segredos.ts";
import { ehTimeoutDaTx, ErroBancoOcupado } from "../../db/tx.ts";
import { contextoAtual } from "../../obs/contexto.ts";
import { log } from "../../obs/log.ts";
import { json } from "./util.ts";

/**
 * definido em 2026-10-05 (NOD-174): cada mensagem é frase completa em pt-BR, com a ação quando há uma — é o que a
 * pessoa lê no banner da web, que não mostra mais o código. O código continua no corpo, para quem depura.
 *
 * A mensagem de erro é canal de vazamento (ADR-002/004 refinados): só sai o que está nesta tabela
 * FIXA, indexada pelo código fechado. Nunca err.message. Erro desconhecido vira 500 + correlation_id
 * para achar no log.
 */
export const TABELA_ERROS: Readonly<Record<CodigoErro, { status: number; mensagem: string }>> = {
  conector_indisponivel: { status: 502, mensagem: "Não foi possível acessar o serviço. Tente novamente ou refaça a conexão." },
  integracao_nao_configurada: { status: 409, mensagem: "Configure sua chave Composio no marketplace para conectar os apps." },
  integracao_autenticacao: { status: 403, mensagem: "O Composio recusou a autenticação. Confira a chave e as permissões do seu projeto." },
  nao_encontrado: { status: 404, mensagem: "Não encontramos o que você pediu. Talvez tenha sido apagado; atualize a página." },
  entrada_invalida: { status: 400, mensagem: "Algum dado do pedido não está certo. Confira e tente de novo." },
  escopo_vazio: { status: 400, mensagem: "Escolha pelo menos uma permissão antes de continuar." },
  limite_atingido: { status: 429, mensagem: "Você chegou ao limite por agora. Espere um pouco e tente de novo." },
  nao_permitido: { status: 403, mensagem: "Você não tem permissão para fazer isso." },
  mudou_depois: { status: 409, mensagem: "Esta memória foi alterada depois. Desfaça a mudança mais nova primeiro." },
  estado_invalido: { status: 409, mensagem: "Isso não pode ser feito agora. Atualize a página e tente de novo." },
  executor_indisponivel: { status: 503, mensagem: "A inteligência não está disponível neste Mac agora. Abra o nod no Mac e tente de novo." },
  fuso_invalido: { status: 400, mensagem: "Fuso horário inválido. Use o nome de uma região, como America/Sao_Paulo, e não uma diferença de horas." },
  cron_sem_futuro: { status: 400, mensagem: "Esse horário não acontece mais. Escolha outro." },
  sala_tamanho: { status: 400, mensagem: "Uma sala tem de 2 a 6 bots." },
  http_toca_dado_pessoal: { status: 400, mensagem: "Use HTTPS para conectar um serviço que acessa dados pessoais." },
  env_placeholder_chave_nova: { status: 400, mensagem: "O valor oculto só vale para uma chave que já existe. Preencha o valor da chave nova." },
  dono_imutavel: { status: 403, mensagem: "O dono do agente não pode ser trocado." },
  texto_vazio: { status: 400, mensagem: "Escreva algo antes de enviar." },
  cota_provisorio: { status: 429, mensagem: "Você usou as mensagens sem conta. Crie uma conta para continuar: nada do que você fez se perde, e sua mensagem ficou no campo." },
  webhook_so_compartilhado: { status: 400, mensagem: "Rotina por webhook só funciona no nod compartilhado, que tem um endereço público." },
  nod_protegido: { status: 403, mensagem: "O Nod fica sempre com você: não dá para excluir, ocultar, renomear, mover nem duplicar." },
};

/** O 500: sem detalhe (ADR-002), mas com o que fazer. */
export const MENSAGEM_FALHA_INTERNA = "Algo deu errado do nosso lado. Tente de novo; se repetir, relate o problema.";

export interface ErroDto {
  codigo: string;
  mensagem: string;
  motivo?: string;
  correlation_id?: string | null;
}

/**
 * definido em 2026-09-16 (EMENDA-L9 §2): um id de CORPO fora do formato uuid chega ao Postgres como
 * 22P02 (invalid_text_representation). É entrada inválida da pessoa, não falha interna — vira 400 com o
 * código fechado; a mensagem do driver (que ecoa o valor) nunca sai.
 */
const SQLSTATE_TEXTO_INVALIDO = "22P02";

/** Onde a recusa aconteceu, para o log. Ids viram `:id`: a linha diz a ROTA, não o registro. */
export type OrigemRequisicao = { metodo: string; caminho: string };

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/** NOD-84 (ADR-139): o token do webhook mora no path (`/api/w/<token>`) e nunca vai ao log. */
const TOKEN_WEBHOOK = /\/w\/[^/?]+/g;

/** A rota da requisição para o log: sem query, ids viram `:id` e o token do webhook vira `:token`. */
export function rotaDoLog(origem: OrigemRequisicao | undefined): string | undefined {
  return origem?.caminho.split("?")[0]?.replace(TOKEN_WEBHOOK, "/w/:token").replace(UUID, ":id");
}

/**
 * definido em 2026-09-24: a recusa de domínio (4xx) também vai para o log, com a rota e o `cause`.
 * Motivo: um banner `entrada_invalida` na tela da Nina não deixou rastro nenhum no servidor — havia
 * uma dúzia de lugares que lançam esse código e nada dizia qual. O `cause` sai só quando é texto
 * (é o que os casos de uso escrevem para quem depura) e cortado; nunca vai para o cliente.
 */
function logarRecusa(err: ErroDeDominio, status: number, origem: OrigemRequisicao | undefined, causa?: string): void {
  const bruta = causa ?? (typeof err.cause === "string" ? err.cause : err.cause instanceof SyntaxError ? "json_malformado" : undefined);
  log(status >= 500 ? "erro" : "aviso", "requisicao_recusada", {
    codigo: err.codigo,
    status,
    metodo: origem?.metodo,
    rota: rotaDoLog(origem),
    // NOD-158: redige antes de cortar; cortar primeiro deixaria um pedaço de segredo que o log não reconhece.
    causa: redigirECortar(bruta, 200) ?? undefined,
  });
}

/**
 * `motivo` (QA do #626): só quem chama com um valor de lista fechada o passa (ex.: MOTIVOS_RECUSA_APP); vai ao corpo ao lado
 * do código e da frase fixa, para a tela dizer a frase dele. Nunca o `cause`.
 */
export function responderErro(res: ServerResponse, err: unknown, origem?: OrigemRequisicao, motivo?: string): void {
  if (ehErroDeDominio(err)) {
    const { status, mensagem } = TABELA_ERROS[err.codigo];
    logarRecusa(err, status, origem);
    const corpo: ErroDto = { codigo: err.codigo, mensagem, ...(motivo ? { motivo } : {}) };
    json(res, status, corpo);
    return;
  }
  if (typeof err === "object" && err !== null && (err as { code?: unknown }).code === SQLSTATE_TEXTO_INVALIDO) {
    logarRecusa(new ErroDeDominio("entrada_invalida"), 400, origem, "id_malformado");
    json(res, 400, { codigo: "entrada_invalida", mensagem: TABELA_ERROS.entrada_invalida.mensagem });
    return;
  }
  if (err instanceof ErroBancoOcupado) {
    // NOD-266: pool cheio além do prazo. 503 com a mensagem genérica (nada do driver sai) e o correlation_id do log
    // `banco_ocupado`, gerado antes do BEGIN — a requisição ainda não tinha contexto de tx.
    log("aviso", "requisicao_recusada", { codigo: "banco_ocupado", status: 503, metodo: origem?.metodo, rota: rotaDoLog(origem), correlation_id: err.correlationId });
    const corpo: ErroDto = { codigo: "banco_ocupado", mensagem: MENSAGEM_FALHA_INTERNA, correlation_id: err.correlationId };
    json(res, 503, corpo);
    return;
  }
  const correlationId = contextoAtual()?.correlationId ?? null;
  if (ehTimeoutDaTx(err)) {
    // Revisão do PR #321: timeout da tx (57014/55P03/25P02) é o banco sob pressão, não erro de programa: 503 como o
    // banco_ocupado do prazo de conexão. O sqlstate vai para o log (a causa), nunca a mensagem do driver.
    log("aviso", "requisicao_recusada", { codigo: "banco_ocupado", status: 503, metodo: origem?.metodo, rota: rotaDoLog(origem), causa: String(Reflect.get(Object(err), "code")), correlation_id: correlationId });
    json(res, 503, { codigo: "banco_ocupado", mensagem: MENSAGEM_FALHA_INTERNA, correlation_id: correlationId } satisfies ErroDto);
    return;
  }
  log("erro", "falha_interna", {
    erro: err instanceof Error ? err.name : "desconhecido",
    correlation_id: correlationId,
  });
  const corpo: ErroDto = { codigo: "falha_interna", mensagem: MENSAGEM_FALHA_INTERNA, correlation_id: correlationId };
  json(res, 500, corpo);
}
