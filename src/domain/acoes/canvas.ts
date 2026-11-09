import type { DefinicaoAcao } from "../../contracts/acoes.ts";
import { PROPRIEDADES_CANVAS as P } from "../../contracts/ferramentas-canvas.ts";
import type { JsonSchema } from "../../contracts/json-schema.ts";

/**
 * As ações do app Canvas (definido em 2026-11-04, ADA-13, ADR-150). Comentar e resolver são `vivo`: a rota da tela
 * (src/adapters/http/rotas/canvas.ts) e o gerir_canvas de qualquer bot com acesso passam pelas mesmas regras
 * (src/use-cases/canvas.ts), e o teste de contrato (tests/integration/paridade-canvas.test.ts) leva os dois ao mesmo
 * estado no banco. Instalar, desinstalar e dar acesso ficam `falta` (onda NOD-394, apps e acessos): é a pessoa que decide
 * quem usa o app, como os conectores; o bot que não tem o app nem vê a ferramenta.
 *
 * Risco "muda": o canvas é da pessoa, o comentário não apaga nada e resolver reabre. Depois de conteúdo de fora, o
 * comentário do bot grava "não confiável" e o resolver pelo bot recusa (gerir-canvas.ts).
 */

const objeto = (properties: Record<string, JsonSchema>, required: readonly string[]): JsonSchema => ({ type: "object", properties, required, additionalProperties: false });
const vivo = { estado: "vivo", via: { ferramenta: "gerir_canvas" }, contrato: "tests/integration/paridade-canvas.test.ts" } as const;
const falta = { estado: "falta", onda: "NOD-394" } as const;

export const ACOES_CANVAS = [
  {
    id: "canvas.comentar",
    titulo: "Comentar num canvas (pino numa tela, post-it numa jornada ou resposta)",
    schema: objeto({ canvas: P.canvas, endereco: P.endereco, tipo: P.tipo, x: P.x, y: P.y, texto: P.texto, pai_id: P.pai_id }, ["canvas", "texto"]),
    risco: "muda",
    cartaoNoChat: false,
    chat: vivo,
    casoDeUso: "canvas.comentar",
  },
  {
    id: "canvas.resolver_comentario",
    titulo: "Resolver ou reabrir um comentário do canvas (com as respostas)",
    schema: objeto({ comentario_id: P.comentario_id, resolvido: P.resolvido }, ["comentario_id"]),
    risco: "muda",
    cartaoNoChat: false,
    chat: vivo,
    casoDeUso: "canvas.resolver_comentario",
  },
  { id: "canvas.instalar", titulo: "Instalar o app Canvas", risco: "muda", cartaoNoChat: false, chat: falta },
  { id: "canvas.desinstalar", titulo: "Desinstalar o app Canvas (tira o acesso de todos os bots; os canvas ficam)", risco: "muda", cartaoNoChat: false, chat: falta },
  { id: "canvas.dar_acesso", titulo: "Dar ou tirar o acesso de um bot ao Canvas (ver e comentar, ou criar e publicar)", risco: "muda", cartaoNoChat: true, chat: falta },
] as const satisfies readonly DefinicaoAcao[];
