import type { CapacidadeConector } from "../contracts/conector.ts";

type Cap = Pick<CapacidadeConector, "nome" | "readOnlyHint" | "destructiveHint">;
type Catalogo = readonly Cap[];

/** Os níveis que a pessoa escolhe por bot e por app; "nenhum" revoga tudo o que o bot tinha no app. */
export type NivelDeAcesso = "nenhum" | "leitura" | "escrita";

export type IdGrupoAcesso = NonNullable<CapacidadeConector["grupo"]>;

export type GrupoDeAcesso = { id: IdGrupoAcesso; rotulo: string; capacidades: string[] };

export const ROTULOS_GRUPO: Record<IdGrupoAcesso, string> = {
  ler: "Ler",
  criar: "Criar e enviar",
  alterar: "Editar",
  comentar: "Comentar",
  outras: "Outras ações",
  apagar: "Apagar e desfazer",
};

const ORDEM: readonly IdGrupoAcesso[] = ["ler", "criar", "alterar", "comentar", "outras", "apagar"];

/** Os grupos que "Ler e alterar" concede. Apagar e as ações que o nome não diz o que fazem ficam de fora. */
export const GRUPOS_DA_ESCRITA: ReadonlySet<IdGrupoAcesso> = new Set(["ler", "criar", "alterar", "comentar"]);

/**
 * definido em 2026-09-25: o catálogo do Composio tem dezenas de ações por app (SLACK_ADD_EMOJI,
 * CLICKUP_CREATE_TASK…) e a pessoa decide por GRUPO, não por nome técnico.
 * revisto em 2026-09-25 (revisão do PR #68): a regra FALHA FECHADO. Só entra num grupo de escrita o que o
 * nome diz que cria, edita ou comenta; o resto vai para "outras", que "Ler e alterar" não concede. Apagar e
 * desfazer ganham de TUDO — do readOnlyHint inclusive — e o `destructiveHint` da sonda também leva para lá.
 * O nome é partido em camelCase e lido em inglês e português (tarefa_excluir, deleteEvent).
 */
const VERBOS: readonly [IdGrupoAcesso, RegExp][] = [
  ["apagar", /(^|_)(DELETE|REMOVE|ARCHIVE|TRASH|DESTROY|PURGE|UNINSTALL|DEACTIVATE|REVOKE|KICK|LEAVE|CLEAR|ERASE|WIPE|EMPTY|CANCEL|DROP|RESET|UNLINK|DETACH|BAN|BLOCK|DISABLE|OVERWRITE|REPLACE|MERGE|TRUNCATE|TRANSFER|EXCLUIR|APAGAR|REMOVER|ARQUIVAR|CANCELAR|LIMPAR|DESFAZER|MESCLAR|BLOQUEAR|DESATIVAR|TRANSFERIR)(_|$)/],
  ["comentar", /(^|_)(COMMENT|COMMENTS|REPLY|REACTION|REACT|COMENTAR|RESPONDER)(_|$)/],
  ["criar", /(^|_)(CREATE|ADD|NEW|POST|SEND|UPLOAD|INSERT|INVITE|SCHEDULE|DUPLICATE|COPY|FORWARD|CRIAR|ENVIAR|ADICIONAR)(_|$)/],
  ["alterar", /(^|_)(UPDATE|EDIT|SET|MODIFY|PATCH|RENAME|MOVE|ASSIGN|UNASSIGN|MARK|STAR|UNSTAR|PIN|UNPIN|TAG|LABEL|CHANGE|TOGGLE|ENABLE|UPSERT|SAVE|WRITE|APPEND|ATTACH|START|STOP|COMPLETE|REORDER|EDITAR|ATUALIZAR|MOVER|MARCAR|ATRIBUIR)(_|$)/],
];

/** "deleteEvent" → "DELETE_EVENT"; "tarefa-excluir" → "TAREFA_EXCLUIR". */
function tokens(nome: string): string {
  return nome.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toUpperCase().replace(/[^A-Z0-9]+/g, "_");
}

export function grupoDaCapacidade(c: Cap): IdGrupoAcesso {
  const n = tokens(c.nome);
  const apagar = VERBOS[0];
  if (c.destructiveHint === true || (apagar && apagar[1].test(n))) return "apagar";
  if (c.readOnlyHint === true) return "ler";
  for (const [id, re] of VERBOS) if (re.test(n)) return id;
  return "outras";
}

/** Os grupos NÃO vazios do catálogo, na ordem fixa em que a pessoa os lê no card. */
export function gruposDoCatalogo(catalogo: Catalogo): GrupoDeAcesso[] {
  const por = new Map<IdGrupoAcesso, string[]>();
  for (const c of catalogo) {
    const id = grupoDaCapacidade(c);
    por.set(id, [...(por.get(id) ?? []), c.nome]);
  }
  return ORDEM.filter((id) => por.has(id)).map((id) => ({ id, rotulo: ROTULOS_GRUPO[id], capacidades: por.get(id) ?? [] }));
}

/** O que cada nível concede: leitura = o grupo ler; escrita = ler, criar, editar e comentar. */
export function capacidadesDoNivel(catalogo: Catalogo, nivel: NivelDeAcesso): string[] {
  if (nivel === "nenhum") return [];
  return catalogo.filter((c) => {
    const g = grupoDaCapacidade(c);
    return nivel === "leitura" ? g === "ler" : GRUPOS_DA_ESCRITA.has(g);
  }).map((c) => c.nome);
}

/** As ações que um nível pode mexer: o que ele concede ou revoga. Apagar e "outras" nunca entram por nível. */
export function doNivel(catalogo: Catalogo, nome: string): boolean {
  const c = catalogo.find((x) => x.nome === nome);
  return c !== undefined && GRUPOS_DA_ESCRITA.has(grupoDaCapacidade(c));
}
