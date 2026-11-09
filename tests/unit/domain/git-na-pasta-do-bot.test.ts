import { describe, expect, it } from "vitest";
import { decidirHook, type Confirmar } from "../../../src/adapters/executor/hook-nativas.ts";
import { arquivoForaDaPastaDoBot, gitForaDaPastaDoBot } from "../../../src/domain/git-na-pasta-do-bot.ts";

const HOME = "/Users/m";
const PASTA = "/Users/m/nod/Dev 4";
const CLONE = "/Users/m/code/acme/main-repos/acme";
const naPasta = (comando: string, cwd: string | null = PASTA) => gitForaDaPastaDoBot(comando, { cwd, pastaDoBot: PASTA, home: HOME });

describe("git que mexe na pasta de trabalho só dentro de ~/nod/<bot> (ADR-065)", () => {
  it("nega trocar de branch, commitar ou descartar no clone da pessoa, por cd, -C ou cwd", () => {
    expect(naPasta(`cd ${CLONE} && git switch -c feat/filtros`)).toContain(`mexeria em ${CLONE}, fora da sua pasta`);
    expect(naPasta("cd ~/code/acme/main-repos/acme && git checkout main")).toContain(CLONE);
    expect(naPasta(`git -C ${CLONE} commit -am "fix"`)).toContain("git commit");
    expect(naPasta("git pull", CLONE)).toContain("git pull");
    expect(naPasta("git stash", CLONE)).toContain("git stash");
    expect(naPasta("gh pr checkout 481", CLONE)).toContain("gh pr checkout");
    // O commit que o Claude Code escreve, com heredoc numa substituição: a pasta vem do cd que está antes.
    expect(naPasta(`cd ${CLONE} && git commit -m "$(cat <<'EOF'\nfeat: x\nEOF\n)"`)).toContain("git commit");
  });

  it("a mensagem diz como fazer certo: worktree na pasta do bot", () => {
    expect(naPasta("git switch main", CLONE)).toContain(`worktree add "${PASTA}/<repo>-<task>" -b <branch> origin/main`);
  });

  it("deixa rodar dentro da worktree do bot, inclusive com espaço no nome e heredoc no commit", () => {
    expect(naPasta(`cd ~/nod/"Dev 4"/acme-86akr9u9u && git commit -m "$(cat <<'EOF'\nfeat: filtros\nEOF\n)"`)).toBeNull();
    expect(naPasta("git switch -c feat/filtros", `${PASTA}/acme-86akr9u9u`)).toBeNull();
    expect(naPasta(`git -C "${PASTA}/acme-86akr9u9u" rebase origin/main`, CLONE)).toBeNull();
  });

  it("o que só lê, o fetch, o push e o worktree add no clone da pessoa passam: é por eles que a worktree nasce", () => {
    for (const comando of [
      `git -C ${CLONE} fetch origin`,
      `git -C ${CLONE} worktree add "${PASTA}/acme-86akr9u9u" -b feat/filtros origin/main`,
      "git status && git log --oneline -5",
      "git stash list",
      "git push -u origin feat/filtros",
      "gh pr view 481",
      "npm test",
    ]) expect(naPasta(comando, CLONE), comando).toBeNull();
  });

  it("ADR-088: na task, a worktree nova nasce dentro da pasta dela; fora (a raiz do bot, outro lugar) é negada com o caminho certo", () => {
    const TASK = `${PASTA}/fix-filtros-abc123`;
    const naTask = (comando: string, cwd: string | null = TASK) => gitForaDaPastaDoBot(comando, { cwd, pastaDoBot: TASK, home: HOME, daTask: true });
    for (const comando of [
      `git -C ${CLONE} worktree add "${TASK}/acme" -b feat/filtros origin/main`,
      `git -C ${CLONE} worktree add -b feat/filtros ~/nod/"Dev 4"/fix-filtros-abc123/acme origin/main`,
      `cd ${TASK} && git -C ${CLONE} worktree add --detach "${TASK}/acme"`,
      `git worktree add acme -b feat/x`,
      `git -C ${CLONE} worktree list`,
    ]) expect(naTask(comando), comando).toBeNull();
    const naRaiz = naTask(`git -C ${CLONE} worktree add "${PASTA}/acme-86akr9u9u" -b feat/filtros origin/main`);
    expect(naRaiz).toContain(`criaria a worktree em ${PASTA}/acme-86akr9u9u, fora da pasta desta task`);
    expect(naRaiz).toContain(`worktree add "${TASK}/<repo>" -b <branch> origin/main`);
    expect(naRaiz).toContain("o nod apaga a worktree");
    expect(naTask(`git -C ${CLONE} worktree add ../outra -b x`)).toContain("/Users/m/code/acme/main-repos/outra");
    expect(naTask(`git -C ${CLONE} worktree add "$DESTINO" -b x`)).toContain("numa pasta que não deu para conferir");
    // Revisão do #225: `worktree move` segue a regra do add; caixa e acento (NFD) não enganam a comparação.
    expect(naTask(`git -C ${CLONE} worktree move "${TASK}/acme" "${PASTA}/acme"`)).toContain("fora da pasta desta task");
    expect(naTask(`git -C ${CLONE} worktree move "${TASK}/acme" "${TASK}/acme-2"`)).toBeNull();
    expect(naTask(`git -C ${CLONE} worktree add "/users/m/NOD/dev 4/fix-filtros-abc123/acme" -b x`)).toBeNull();
    expect(gitForaDaPastaDoBot(`git -C ${CLONE} worktree add "/Users/m/nod/Cecília/t-1/acme" -b x`, { cwd: null, pastaDoBot: "/Users/m/nod/Cecília/t-1".normalize("NFD"), home: HOME, daTask: true })).toBeNull();
    // A mensagem do git que mexe fora da pasta também ensina a worktree dentro da task.
    expect(naTask("git switch main", CLONE)).toContain(`worktree add "${TASK}/<repo>"`);
  });

  it("ADR-088: sem task, a worktree nasce dentro da pasta do bot, como antes", () => {
    expect(naPasta(`git -C ${CLONE} worktree add /tmp/acme -b x`)).toContain("criaria a worktree em /tmp/acme, fora da sua pasta");
    expect(naPasta(`git -C ${CLONE} worktree add "${PASTA}" -b x`)).toContain("fora da sua pasta");
    expect(naPasta(`git -C ${CLONE} worktree add "${PASTA}/acme-86akr9u9u" -b x`)).toBeNull();
  });

  it("definido em 2026-10-11: variável que o próprio comando definiu é lida (167 das 177 recusas 'não deu para conferir')", () => {
    const TASK = "/home/nod/nod/Ze 1/jornada-recompensas-08aff6";
    const BOT_CLONE = "/home/nod/nod/Ze 1/gamefik";
    const naTask = (comando: string, cwd: string | null = BOT_CLONE) => gitForaDaPastaDoBot(comando, { cwd, pastaDoBot: TASK, home: "/home/nod", daTask: true });
    // Os dois comandos do Ze 1 recusados em 11/10 às 14:11 e 14:12.
    for (const comando of [
      `cd ~/nod/"Ze 1"/gamefik && git fetch -q origin && T=~/nod/"Ze 1"/jornada-recompensas-08aff6; git worktree add -q "$T/pr757" --detach origin/b09; cd "$T/pr757" && git checkout -q -B b09 origin/b09`,
      `C="${BOT_CLONE}"; W="${TASK}/pr758"; git -C "$C" worktree add -q "$W" -b ze1/pr758 origin/b09; cd "$W" && git merge --no-edit origin/b09-t1`,
      // Atribuição encadeada por &&, `\${T}`, `export` e $PWD depois do cd.
      `cd ${BOT_CLONE} && T="${TASK}/w845" && git worktree add "\${T}" -b x origin/main -q && cd "$T" && git commit -m x`,
      `export D=${TASK}; git -C ${BOT_CLONE} worktree add "$D/repo" -b x`,
      `cd ${TASK} && git -C ${BOT_CLONE} worktree add "$PWD/repo" -b x`,
      `cd ${TASK}; D=$PWD; git -C ${BOT_CLONE} worktree add --detach "$D/base" origin/main`,
      // Variável do bot que aponta para outra variável já conhecida.
      `B=~/nod/"Ze 1"; T="$B/jornada-recompensas-08aff6"; git worktree add "$T/r" -b x`,
    ]) expect(naTask(comando), comando).toBeNull();

    // O valor conhecido também nega: a variável aponta para fora da task.
    expect(naTask(`T=~/nod/"Ze 1"; git worktree add "$T/repo" -b x`)).toContain(`criaria a worktree em /home/nod/nod/Ze 1/repo`);
    expect(naTask(`W="${BOT_CLONE}"; cd "$W" && git checkout main`, TASK)).toContain(`mexeria em ${BOT_CLONE}`);
    // Sem aspas, o espaço corta a atribuição (o shell roda `1/gamefik`): o valor fica desconhecido.
    expect(naTask(`W=${BOT_CLONE}; cd "$W" && git checkout main`, TASK)).toContain("não deu para conferir");
    // O que continua sem valor certo: variável do laço, atribuição depois de || ou num pipe, prefixo do mesmo comando
    // (`W=x git -C "$W"` expande antes de atribuir) e `$T` entre aspas simples (literal no shell).
    for (const comando of [
      `T=${TASK}; for b in a b; do git worktree add "$T/$b" -b x; done`,
      `test -d x || T=${TASK}; git worktree add "$T/r" -b x`,
      `echo | T=${TASK}; git worktree add "$T/r" -b x`,
      `W="${TASK}/r" git -C "$W" commit -m x`,
      `T=${TASK}; git worktree add '$T/r' -b x`,
      `git worktree add "$SEM_VALOR/r" -b x`,
    ]) expect(naTask(comando), comando).toContain("não deu para conferir");
  });

  it("definido em 2026-10-11: o git depois de do/then/else é conferido (antes passava sem olhar)", () => {
    for (const comando of [
      `for b in a b; do git -C ${CLONE} checkout main; done`,
      `if true; then git -C ${CLONE} commit -m x; fi`,
      `if false; then :; else git -C ${CLONE} reset --hard; fi`,
      `while true; do git -C ${CLONE} pull; break; done`,
    ]) expect(naPasta(comando), comando).toContain(`mexeria em ${CLONE}`);
    expect(naPasta(`for f in a b; do git -C "${PASTA}/acme" add "$f"; done`)).toBeNull();
  });

  it("pasta que depende do shell, ou cwd desconhecido, não passa quando o git mexe", () => {
    expect(naPasta("cd $REPO && git commit -m x")).toContain("roda numa pasta que não deu para conferir");
    expect(naPasta("git commit -m x", null)).toContain("não deu para conferir");
    expect(naPasta("git status", null)).toBeNull();
  });

  it("ADR-066: gravar fora da pasta do bot vai ao servidor com o arquivo (o modo decide); dentro, só a trilha", async () => {
    expect(arquivoForaDaPastaDoBot(`${CLONE}/apps/web/filtros.tsx`, { cwd: PASTA, pastaDoBot: PASTA, home: HOME })).toBe(`${CLONE}/apps/web/filtros.tsx`);
    expect(arquivoForaDaPastaDoBot(`${PASTA}/acme-86akr9u9u/apps/web/filtros.tsx`, { cwd: CLONE, pastaDoBot: PASTA, home: HOME })).toBeNull();
    expect(arquivoForaDaPastaDoBot("notas.md", { cwd: PASTA, pastaDoBot: PASTA, home: HOME })).toBeNull();
    const pedidos: unknown[] = [];
    const confirmar: Confirmar = async (p) => { pedidos.push(p); return { permitir: true }; };
    const pastas = { pastaDoBot: PASTA, home: HOME };
    await decidirHook({ tool_name: "Edit", tool_input: { file_path: `${CLONE}/apps/web/filtros.tsx` }, cwd: PASTA }, confirmar, pastas);
    await decidirHook({ tool_name: "Write", tool_input: { file_path: `${PASTA}/acme-x/a.ts` }, cwd: PASTA }, confirmar, pastas);
    await decidirHook({ tool_name: "Read", tool_input: { file_path: `${CLONE}/README.md` }, cwd: PASTA }, confirmar, pastas);
    expect(pedidos).toEqual([
      { ferramenta: "Edit", contamina: false, arquivo: `${CLONE}/apps/web/filtros.tsx` },
      { ferramenta: "Write", contamina: false },
      { ferramenta: "Read", contamina: false },
    ]);
  });

  it("o hook nega antes do servidor quando o config traz a pasta do bot; config antigo não liga a cerca", async () => {
    const pedidos: unknown[] = [];
    const confirmar: Confirmar = async (p) => { pedidos.push(p); return { permitir: true }; };
    const evento = { tool_name: "Bash", tool_input: { command: "git switch main" }, cwd: CLONE };
    const negado = await decidirHook(evento, confirmar, { pastaDoBot: PASTA, home: HOME });
    expect(negado.hookSpecificOutput.permissionDecision).toBe("deny");
    expect(negado.hookSpecificOutput.permissionDecisionReason).toContain("fora da sua pasta");
    expect(pedidos).toEqual([]);
    expect((await decidirHook(evento, confirmar)).hookSpecificOutput.permissionDecision).toBe("allow");
  });

  it("NOD-315: o clone da máquina é de todos — branch de outra frente, worktree de fora e manutenção no clone são negados", () => {
    const H = "/home/nod";
    const TASK = `${H}/nod/Eng 1/login-safari-abc123`;
    const C = `${H}/nod/.clones/gamefik/nod.git`;
    const naTask = (comando: string, cwd: string | null = `${TASK}/nod`) => gitForaDaPastaDoBot(comando, { cwd, pastaDoBot: TASK, home: H, daTask: true });
    for (const comando of [
      `git -C ${C} branch -D frente/outra-xyz`,
      "git branch -d frente/outra-xyz",
      "git branch -Df frente/outra-xyz",
      "git branch -m frente/outra-xyz minha",
      `git -C ${C} update-ref -d refs/heads/frente/outra-xyz`,
      // QA do #456: sem -d o update-ref também regrava; o fetch com refspec grava no destino.
      `git -C ${C} update-ref refs/heads/frente/outra-xyz 0123456789012345678901234567890123456789`,
      `git -C ${C} fetch origin +refs/heads/main:refs/heads/frente/outra-xyz`,
      "git fetch . HEAD:frente/outra-xyz",
    ]) expect(naTask(comando), comando).toContain("O clone da máquina é de todos os bots: só o nod mexe nele.");
    expect(naTask("git branch -D frente/outra-xyz")).toContain("Mexa só no seu (frente/login-safari-abc123)");
    for (const comando of [
      `git -C ${C} worktree remove "${H}/nod/Ze 1/outra-task/nod"`,
      `git -C ${C} worktree remove --force "../../Ze 1/x"`,
      `git -C ${C} worktree lock "${H}/nod/Ze 1/outra/nod"`,
      `git -C ${C} worktree repair`,
      `git -C ${C} worktree prune`,
      `git -C ${C} gc --prune=now`,
      `git -C ${C} prune`,
      `git -C ${C} repack -ad`,
      `git -C ${C} reflog expire --all`,
      `git -C ${C} config core.bare false`,
      `git -C ${C} remote set-url origin https://x`,
      `cd ${C} && git filter-branch --all`,
      `git --git-dir ${C} -C ${C} maintenance run`,
      // revisão do #456: o git lê a opção depois do nome como argumento — estes gravam.
      `git -C ${C} config core.bare false --get`,
      `git -C ${C} config core.hooksPath /tmp/x --list`,
      `git -C ${C} remote -v add outro https://x`,
      `git -C ${C} remote --verbose set-url origin https://x`,
      // revisão do #456: o repositório pelo --git-dir e pelo GIT_DIR, com o cwd na pasta da task.
      `git --git-dir ${C} gc`,
      `git --git-dir=${C} config core.bare false`,
      `GIT_DIR=${C} git remote remove origin`,
      `export GIT_DIR=${C}; git repack -ad`,
    ]) expect(naTask(comando), comando).toContain("só o nod mexe nele");
    // O que a frente precisa continua livre.
    for (const comando of [
      `git -C ${C} fetch origin`,
      `git -C ${C} fetch origin main:frente/login-safari-abc123`,
      "git update-ref refs/heads/frente/login-safari-abc123 HEAD",
      `git -C ${C} worktree add "${TASK}/nod" -b frente/login-safari-abc123 origin/main`,
      `git -C ${C} show origin/HEAD:package.json`,
      `git -C ${C} worktree list`,
      `git -C ${C} branch -D frente/login-safari-abc123`,
      `git -C ${C} worktree remove "${TASK}/nod"`,
      "git worktree remove .",
      `git -C ${C} config --get remote.origin.url`,
      `git -C ${C} remote -v`,
      `git -C ${C} remote -v show origin`,
      `git -C ${C} config -l`,
      `git --git-dir=${C} log -1 origin/HEAD`,
      `git -C ${C} reflog`,
      "git branch -a",
      "git branch frente/nova-sub origin/main",
      "git branch -D feat/minha",
      "git push origin frente/login-safari-abc123",
      "git gc",
    ]) expect(naTask(comando), comando).toBeNull();
  });
});
