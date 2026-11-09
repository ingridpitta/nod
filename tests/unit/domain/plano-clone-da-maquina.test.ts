import { describe, expect, it } from "vitest";
import type { Agente } from "../../../src/contracts/agente.ts";
import type { Concessao } from "../../../src/contracts/concessao.ts";
import type { Conector } from "../../../src/contracts/conector.ts";
import type { Turno } from "../../../src/contracts/turno.ts";
import { trocarNoPrompt } from "../../../src/domain/clone-da-maquina.ts";
import { DONO_INTEGRA, worktreeDaFrente } from "../../../src/domain/frente.ts";
import { montarPlano, saidaDoCloneDaMaquina, type EntradaPlano } from "../../../src/domain/plano-turno.ts";
import { trechoComClone, trechoDoClone } from "../../../src/domain/prompt-sistema.ts";

/** NOD-315 (ADR-119): o plano manda `cloneDaMaquina` só para a frente na máquina Linux, com repo e GitHub concedido. */
const agora = 1_000_000;
const agente: Agente = { tenantId: "t", id: "a1", ownerId: "p", visibility: "privado", nome: "Vera", titulo: "", descricao: "", dono: "pessoa", forma: "shape-square", cor: "c-red", fixado: false, oculto: false, confirmado: true, modelo: "sonnet", duplicadoDe: null, criadoEm: 0 };
const turno: Turno = { executor: "local", tenantId: "t", id: "t1", conversaId: "c1", agenteId: "a1", ownerId: "p", origem: "conversa", estado: "despachando", sinais: { attempted: true, rejected: false, promptSubmitted: false, producedOutput: false }, machineId: null, leaseAte: null, prazoEm: agora + 86_400_000, motivoInterrupcao: null, motivoFalha: null, semNovidadeMotivo: null, retomaTurnoId: null, profundidade: 0, reenvios: 0, pararSolicitadoEm: null, entradaTexto: "oi", entradaAnexos: [], entradaConfianca: "confiavel", custoUsd: null, modelo: "sonnet", criadoEm: agora, mensagemOrigemId: "m0" };
const github: Conector = { tenantId: "t", id: "gh", ownerId: "p", visibility: "privado", nome: "GitHub", slug: "github", transporte: "stdio", comando: "node", args: [], url: null, env: {}, declaracao: "nao-toca", habilitado: true, catalogo: [{ nome: "GITHUB_GET_A_REPOSITORY", descricao: "lê", schema: { type: "object" }, readOnlyHint: true }], sondadoEm: agora, ultimaFalha: null, criadoEm: 0 };
const concessoes: Concessao[] = [{ tenantId: "t", id: "g1", ownerId: "p", agenteId: "a1", conectorId: "gh", capacidade: "GITHUB_GET_A_REPOSITORY", mensagemId: "m", criadoEm: 0 }];
const pasta = "Vera/login-no-safari-abc123";
const frente: EntradaPlano = {
  turno, agente, memorias: [], concessoes, conectores: [github], modo: "conversa", confianca: "confiavel", profundidade: 0, inventario: { estado: "pronto", versao: "2.1.272", em: agora }, executor: "local", sessaoCli: null, pessoaNome: "Marlon", agora,
  terminal: true, maquina: { nome: "vm-sp", plataforma: "linux" }, pastaTrabalho: pasta,
  trabalho: { titulo: "Login no Safari", origem: "pessoa", trabalhoMaeId: null, forma: "frente", repo: "gamefik/nod" },
};
const caminho = "~/nod/.clones/gamefik/nod.git";

describe("plano com o clone da máquina (NOD-315)", () => {
  it.each(["claude-cli", "codex-cli"] as const)("%s: frente + Linux + repo + GitHub → o campo; trocado, o prompt cita o caminho e não manda gh repo clone", (harness) => {
    const p = montarPlano({ ...frente, harness });
    expect(p.cloneDaMaquina).toEqual({ repo: "gamefik/nod", caminho, semClone: trechoDoClone({ pastaDoBot: pasta, worktree: worktreeDaFrente(pasta) }), comClone: trechoComClone({ pastaDoBot: pasta, caminho, repo: "gamefik/nod" }) });
    // Sem a troca (executor antigo ou saída), o texto de hoje.
    expect(p.promptSistema).toContain("gh repo clone dono/repo ~/nod/Vera/login-no-safari-abc123/<repo>");
    expect(p.promptSistema).not.toContain(".clones/gamefik");
    const trocado = trocarNoPrompt(p, p.cloneDaMaquina!.semClone, p.cloneDaMaquina!.comClone)!;
    expect(trocado).not.toBeNull();
    expect(trocado.promptSistema).not.toContain("gh repo clone");
    expect(trocado.promptSistema).toContain(`O clone de gamefik/nod nesta máquina é ${caminho}, um só para todos os bots`);
    expect(trocado.promptSistema).toContain(`git -C ${caminho} worktree add ~/nod/${pasta}/<repo> -b frente/login-no-safari-abc123 origin/<branch_base>`);
    expect(trocado.promptSistema).toContain(`git -C ${caminho} show origin/HEAD:<arquivo>`);
    expect(trocado.promptSistema).toContain("se der cannot lock ref, espere alguns segundos e repita");
    expect(trocado.promptSistema).toContain("Se o worktree add falhar, clone o repo na sua pasta e siga.");
    expect(trocado.promptSistemaPartes!.estavel).toContain(caminho);
    expect(saidaDoCloneDaMaquina(frente, p)).toBeNull();
  });

  it("sem GitHub concedido: sem o campo, nada cita .clones e o motivo é sem_credencial", () => {
    const p = montarPlano({ ...frente, concessoes: [] });
    expect(p.cloneDaMaquina).toBeUndefined();
    expect(p.promptSistema).not.toContain(".clones");
    expect(saidaDoCloneDaMaquina(frente, p)).toEqual({ repo: "gamefik/nod", motivo: "sem_credencial" });
    // github_mcp também vale como GitHub.
    expect(montarPlano({ ...frente, conectores: [{ ...github, slug: "github_mcp" }] }).cloneDaMaquina?.caminho).toBe(caminho);
  });

  it("Mac, task, conversa, frente sem repo ou com repo inválido: sem campo e sem motivo (igual a hoje)", () => {
    const casos: EntradaPlano[] = [
      { ...frente, maquina: { nome: "MacBook", plataforma: "darwin" } },
      { ...frente, maquina: null },
      { ...frente, trabalho: { ...frente.trabalho!, forma: "task" } },
      { ...frente, trabalho: null, pastaTrabalho: null },
      { ...frente, trabalho: { ...frente.trabalho!, repo: null } },
      { ...frente, trabalho: { ...frente.trabalho!, repo: "../x" } },
      { ...frente, terminal: false },
    ];
    for (const e of casos) {
      const p = montarPlano(e);
      expect(p.cloneDaMaquina).toBeUndefined();
      expect(saidaDoCloneDaMaquina(e, p)).toBeNull();
      expect(p.promptSistema).not.toContain(".clones/gamefik");
    }
  });

  it("o texto sem clone é byte a byte o de antes, no Claude e no Codex", () => {
    const antes = `Os clones do Mac dela não estão aqui: se ainda não houver clone nesta máquina, clone na sua pasta (gh repo clone dono/repo ~/nod/${pasta}/<repo>). Para mexer num repositório, trabalhe numa worktree dentro da pasta desta frente, num branch só seu, a partir do clone: git -C <clone> fetch origin && git -C <clone> worktree add ~/nod/${pasta}/<repo> -b frente/login-no-safari-abc123 <branch_base> (o branch de onde a entrada mandou partir; sem ele, origin/main).`;
    for (const harness of ["claude-cli", "codex-cli"] as const) {
      const sem = montarPlano({ ...frente, harness, concessoes: [] });
      expect(sem.promptSistema).toContain(antes);
    }
  });

  it("worktreeDaFrente com o clone da máquina parte de origin/<branch_base> (origin/HEAD sem ele); DONO_INTEGRA diz de onde buscar", () => {
    const w = worktreeDaFrente(pasta, caminho);
    expect(w).toContain("a partir desse clone:");
    expect(w).toContain("(o branch de onde a entrada mandou partir; sem ele, origin/HEAD)");
    expect(w).not.toContain("<clone>");
    expect(w).not.toContain("fetch origin &&");
    expect(DONO_INTEGRA).toContain("O branch da frente fica no clone de onde a worktree dela nasceu (o clone da máquina, ~/nod/.clones/<dono>/<repo>.git, quando houver)");
    expect(DONO_INTEGRA).toContain("git fetch <esse clone> <branch>");
  });
});
