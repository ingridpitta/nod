/**
 * Por que o nod barrou uma ferramenta nativa (Bash, Monitor, Write…), lido do motivo que o hook devolveu ao modelo
 * (`PreToolUse:Bash hook error: nod: <motivo>`). Definido em 2026-10-11: a pílula da conversa dizia "alcance
 * insuficiente — peça aprovação" para toda negação, e em 482 negações levantadas nas sessões dos bots (VM e Mac,
 * 28/09 a 11/10) quase nenhuma se resolvia com aprovação — eram a cerca do git, a espera com sleep, o servidor fora de
 * alcance. O texto lido aqui é do próprio nod (hook, cerca, rota interna), nunca do modelo. Puro.
 */
import type { CausaNativa } from "../contracts/negacao.ts";

/** A ordem importa: o primeiro que casa decide. */
const REGRAS: readonly [RegExp, CausaNativa][] = [
  [/não deu para conferir|fora da sua pasta|fora da pasta desta task|criaria a worktree/, "git_fora_da_pasta"],
  [/segura este processo/, "espera_com_sleep"],
  [/continua na conversa/, "esperando_aprovacao"],
  [/a pessoa não aprovou/, "recusado_pela_pessoa"],
  [/credencial/, "credencial"],
  [/fora do plano deste turno|fora do kit do nod/, "fora_do_plano"],
  [/não foi possível decidir|não confirmou|token de turno|não foi encontrada|não liberou|resposta inesperada/, "sem_conferencia"],
];

export function causaDaNegacaoNativa(motivo: string): CausaNativa {
  return REGRAS.find(([re]) => re.test(motivo))?.[1] ?? "outra";
}

/** O que a pessoa lê na pílula da conversa, depois de "ferramenta <nome> negada: ". */
export const CAUSA_NATIVA_HUMANA: Record<CausaNativa, string> = {
  git_fora_da_pasta: "git fora da pasta da task; o bot recebeu o caminho certo",
  espera_com_sleep: "espera com sleep; o bot foi orientado a marcar a volta em vez de esperar",
  esperando_aprovacao: "esperando sua aprovação na conversa",
  recusado_pela_pessoa: "você não aprovou o comando",
  credencial: "o comando tocava um arquivo de credencial, que o nod não abre",
  fora_do_plano: "fora das ferramentas deste turno",
  sem_conferencia: "o nod não conseguiu conferir o comando (servidor fora de alcance)",
  outra: "barrada pelo nod",
};

/**
 * As pílulas de negação de um turno: uma por ferramenta e causa, com quantas vezes (a Teodora teve 5 iguais num turno
 * só em 11/10). Sem os motivos do hook (motor anterior), uma por nome em `negacoesPermissao`, como antes. O nome que o
 * CLI negou fora do hook do nod (não está entre os motivos) continua sem causa.
 */
export function negacoesDoTurno(r: { negacoesPermissao: readonly string[]; negacoesDoNod?: readonly { nome: string; motivo: string }[] }): { nome: string; causa?: CausaNativa; vezes: number }[] {
  const doNod = r.negacoesDoNod ?? [];
  if (doNod.length === 0) return r.negacoesPermissao.map((nome) => ({ nome, vezes: 1 }));
  const grupos = new Map<string, { nome: string; causa: CausaNativa; vezes: number }>();
  for (const n of doNod) {
    const nome = n.nome || r.negacoesPermissao[0] || "Bash";
    const causa = causaDaNegacaoNativa(n.motivo);
    const chave = `${nome}\u0000${causa}`;
    const g = grupos.get(chave);
    if (g) g.vezes++;
    else grupos.set(chave, { nome, causa, vezes: 1 });
  }
  const cobertos = new Set([...grupos.values()].map((g) => g.nome));
  const fora = [...new Set(r.negacoesPermissao)].filter((nome) => !cobertos.has(nome)).map((nome) => ({ nome, vezes: 1 }));
  return [...grupos.values(), ...fora];
}

/** O motivo do hook no texto de um tool_result do Claude Code, ou null quando a recusa não é do nod. */
export function motivoDoHookDoNod(texto: string): string | null {
  const m = /hook error: nod: ([\s\S]*)$/.exec(texto);
  return m ? m[1]!.trim() : null;
}
