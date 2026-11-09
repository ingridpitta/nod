import { describe, expect, it } from "vitest";
import { componenteWindows, dentroDe, nomeDoPrograma, normalizarCaminho, PREFIXO_UNC } from "../../../src/domain/caminhos.ts";
import { arquivoForaDaPastaDoBot, caminhoDentroDe, caminhoGravado, foraDoSubconjuntoDoWindows, gitForaDaPastaDoBot } from "../../../src/domain/git-na-pasta-do-bot.ts";
import { decidirNativa } from "../../../src/domain/nativas.ts";

/** ADA-11 (ADR-147): a cerca do git e o hook comparando caminhos do Windows. */
const HOME = "C:\\Users\\Bia";
const PASTA = "C:\\Users\\Bia\\nod\\ze-1";
const win = (comando: string, cwd: string | null = PASTA) => gitForaDaPastaDoBot(comando, { cwd, pastaDoBot: PASTA, home: HOME, windows: true });

describe("normalizarCaminho (ADR-147)", () => {
  it("drive, barra invertida, \\\\?\\, cygdrive e Git Bash viram a mesma forma", () => {
    expect(normalizarCaminho("C:\\a\\b", true)).toBe("/c/a/b");
    expect(normalizarCaminho("c:/a/b", true)).toBe("/c/a/b");
    expect(normalizarCaminho("\\\\?\\C:\\a", true)).toBe("/c/a");
    expect(normalizarCaminho("/cygdrive/C/a", true)).toBe("/c/a");
    expect(normalizarCaminho("/c/a", true)).toBe("/c/a");
  });
  it("UNC vira o prefixo que nunca cai numa pasta de disco; C:x relativo ao drive não é conferível", () => {
    expect(normalizarCaminho("\\\\srv\\share\\x", true)).toBe(`${PREFIXO_UNC}/srv/share/x`);
    expect(normalizarCaminho("\\\\?\\UNC\\srv\\share", true)).toBe(`${PREFIXO_UNC}/srv/share`);
    expect(normalizarCaminho("C:x", true)).toBeNull();
  });
  it("no POSIX a barra invertida é nome comum", () => expect(normalizarCaminho("a\\b", false)).toBe("a\\b"));
  it("componente: pontos e espaços do fim saem; só pontos não é conferível", () => {
    expect(componenteWindows("pasta. ")).toBe("pasta");
    expect(componenteWindows("..")).toBe("..");
    expect(componenteWindows("...")).toBeNull();
  });
  it("dentroDe não aceita prefixo falso e ignora caixa", () => {
    expect(dentroDe("/c/a", "/c/ab")).toBe(false);
    expect(dentroDe("/c/a/", "/C/A/b")).toBe(true);
  });
  it("nomeDoPrograma: git.exe, GIT e o caminho absoluto são o git", () => {
    for (const p of ["git.exe", "GIT", "C:\\Program Files\\Git\\cmd\\git.exe", "/mingw64/bin/git"]) expect(nomeDoPrograma(p, true)).toBe("git");
    expect(nomeDoPrograma("/usr/bin/git", false)).toBe("git");
    expect(nomeDoPrograma("GIT", false)).toBe("GIT");
  });
});

describe("cerca do git no Windows (ADR-147)", () => {
  it("dentro da pasta do bot, em qualquer grafia, passa", () => {
    expect(win("git commit -m x")).toBeNull();
    expect(win("git -C c:/users/bia/nod/ZE-1/repo commit -m x", null)).toBeNull();
    expect(win('git -C "C:\\Users\\Bia\\nod\\ze-1\\repo" commit -m x', null)).toBeNull();
    expect(win("git.exe commit -m x", "C:\\Users\\Bia\\nod\\ze-1\\repo")).toBeNull();
  });
  it("`cd ..\\..` e `-C ..\\` saem da pasta e são negados (antes viravam nome de pasta)", () => {
    expect(win("cd ..\\.. && git commit -m x")).toMatch(/git commit/);
    expect(win('git -C "..\\outro" commit -m x')).toMatch(/git commit/);
    // Sem aspas o Git Bash come a `\\`: `..\\outro` é a pasta `..outro`, dentro da pasta do bot, e passa como no bash.
    expect(win("git -C ..\\outro commit -m x")).toBeNull();
    expect(win('Set-Location "..\\.."; git commit -m x')).toMatch(/git commit/);
    expect(win('cd "..\\.." && git commit -m x')).toMatch(/git commit/);
    expect(win('cd "repo" && git commit -m x')).toBeNull();
  });
  it("prefixo falso, UNC, outro drive, %VAR% e `...` são negados", () => {
    expect(win("git -C C:\\Users\\Bia\\nod\\ze-10 commit -m x", null)).toMatch(/git commit/);
    expect(win("git -C \\\\srv\\share\\ze-1 commit -m x", null)).toMatch(/git commit/);
    expect(win("git -C D:\\Users\\Bia\\nod\\ze-1 commit -m x", null)).toMatch(/git commit/);
    expect(win("git -C %USERPROFILE%\\nod\\ze-1 commit -m x", null)).toMatch(/git commit|forma simples/);
    expect(win("git -C C:\\Users\\Bia\\nod\\ze-1\\...\\x commit -m x", null)).toMatch(/git commit/);
  });
  it("o git pelo caminho absoluto e em maiúsculas também passa pela cerca", () => {
    expect(win('"C:\\Program Files\\Git\\cmd\\git.exe" -C D:\\x commit -m x', null)).toMatch(/git commit|forma simples/);
    expect(win("GIT -C D:\\x commit -m x", null)).toMatch(/git commit/);
  });
  it("o git dentro de powershell, pwsh, cmd e bash passa pela mesma cerca, a partir da pasta de fora (revisão do PR #642, A3)", () => {
    expect(win('powershell -Command "git -C D:\\x reset --hard"')).toMatch(/git reset|forma simples/);
    expect(win('pwsh.exe -NoProfile -c "git -C C:\\Users\\Bia commit -m x"')).toMatch(/git commit|forma simples/);
    expect(win("cmd /c git -C D:\\x checkout main")).toMatch(/git checkout|forma simples/);
    expect(win("CMD.EXE /C git -C D:\\x checkout main")).toMatch(/git checkout|forma simples/);
    expect(win("bash -c 'git -C /d/x clean -fd'")).toMatch(/git clean|forma simples/);
    expect(win('cd "..\\.."; cmd /c "git commit -m x"')).toMatch(/git commit|forma simples/);
    // Dentro da pasta passa; o shell sem git segue livre.
    expect(win('powershell -Command "git commit -m x"')).not.toBeNull();
    expect(win("cmd /c dir")).toBeNull();
    expect(win("powershell -NoProfile -Command Get-ChildItem")).toBeNull();
  });
  it("-EncodedCommand do PowerShell e git que não deu para ler negam no Windows; maiúsculas no fallback (M5)", () => {
    const linux = { cwd: "/home/nod/nod/ze-1", pastaDoBot: "/home/nod/nod/ze-1", home: "/home/nod" };
    expect(win("powershell -EncodedCommand ZwBpAHQA")).toMatch(/não deu para conferir|forma simples/);
    expect(win("pwsh -enc ZwBpAHQA")).toMatch(/não deu para conferir|forma simples/);
    expect(win("powershell -ExecutionPolicy Bypass -File x.ps1")).toBeNull();
    // Aspa sem fechar: a leitura desiste.
    expect(win('git log "aberto')).toMatch(/não deu para conferir|forma simples/);
    expect(gitForaDaPastaDoBot('GIT COMMIT -m "aberto', linux)).toMatch(/git commit/);
    expect(gitForaDaPastaDoBot('git log "aberto', linux)).toBeNull();
  });
  it("o `..` não sobe acima do drive", () => {
    expect(caminhoDentroDe("C:\\", "C:\\..\\..\\x", true)).toBe(true);
    expect(caminhoDentroDe("C:\\a", "C:\\a\\..\\b", true)).toBe(false);
  });
  it("arquivos: dentro livre, fora volta o caminho; o gravado sai na forma do Node do Windows", () => {
    const ctx = { cwd: PASTA, pastaDoBot: PASTA, home: HOME, windows: true };
    expect(arquivoForaDaPastaDoBot("repo\\a.ts", ctx)).toBeNull();
    expect(arquivoForaDaPastaDoBot("..\\..\\.ssh\\config", ctx)).toBe("c:/Users/Bia/.ssh/config");
    expect(caminhoGravado("repo\\a.ts", ctx)).toBe("c:/Users/Bia/nod/ze-1/repo/a.ts");
  });
  it("no POSIX nada muda: `..\\` é nome de pasta", () => {
    expect(gitForaDaPastaDoBot("git -C ..\\x commit -m x", { cwd: "/home/nod/nod/ze-1", pastaDoBot: "/home/nod/nod/ze-1", home: "/home/nod" })).toBeNull();
  });
});

describe("cerca do git no PowerShell e no cmd (revisão do PR #642, médio 3)", () => {
  const FORA = "C:\\Users\\bia\\outro\\clone";
  it.each([
    `cd -Path '${FORA}'; git commit -am x`,
    `cd -LiteralPath ${FORA}; git commit -am x`,
    `pushd -Path ${FORA}; git commit -am x`,
    `cd /d ${FORA} && git commit -am x`,
    `Set-Location FileSystem::${FORA}; git commit -am x`,
    `cd Microsoft.PowerShell.Core\\FileSystem::${FORA}; git commit -am x`,
    `$env:GIT_DIR='${FORA}\\.git'; git commit -am x`,
    `set GIT_DIR=${FORA}\\.git && git commit -am x`,
    `chdir ${FORA} & git commit -am x`,
  ])("nega %s", (comando) => {
    expect(win(comando)).not.toBeNull();
  });
  it("continua liberando o cd com flag para dentro da pasta", () => {
    expect(win(`cd -Path '${PASTA}\\repo'; git commit -am x`)).toBeNull();
    // Sem aspas, o tokenizador POSIX come as barras e a cerca nega (falha fechada, já era assim): o teste usa aspas.
    expect(win(`cd /d "${PASTA}\\repo" && git commit -am x`)).toBeNull();
    expect(win(`chdir "${PASTA}\\repo" & git commit -am x`)).not.toBeNull();
  });
});

describe("cerca do git: revisão 2 do PR #642", () => {
  it.each([
    // bloqueante 1: `..\` relativo dentro do PowerShell/cmd
    `powershell -Command "cd ..\\..\\repo; git checkout main"`,
    `pwsh -c "cd ..\\..\\repo; git checkout main"`,
    `cmd /c "cd ..\\..\\repo && git checkout main"`,
    `powershell -Command "git -C ..\\..\\repo checkout main"`,
    `powershell -Command "cd ~\\..\\x; git checkout main"`,
    `cmd /c"cd ..\\..\\repo && git checkout main"`,
    // alto 2: troca de drive
    `cmd /c "D: && cd proj && git checkout main"`,
    `powershell -Command "D:; cd proj; git checkout main"`,
    `D: && git checkout main`,
    // médio 3: -EncodedCommand e embrulhos
    `powershell /enc ZwBpAHQA; git status`,
    `powershell -EncodedComm ZwBpAHQA; git status`,
    `iex 'git -C C:\\x checkout main'`,
    `powershell -Command "Invoke-Expression 'git checkout main'"`,
    `Start-Process git -ArgumentList 'checkout main'`,
    `start git checkout main`,
    `wsl git -C /mnt/c/x checkout main`,
    `echo 'git checkout main' | powershell -Command -`,
    `echo git checkout main | cmd`,
    // médio 4: GIT_* pelo ambiente
    `\${env:GIT_DIR}='C:\\x\\.git'; git checkout main`,
    `si env:GIT_DIR C:\\x\\.git; git checkout main`,
    `GIT_WORK_TREE=C:/x git checkout main`,
    `export GIT_DIR=C:/x/.git; git checkout main`,
    `git -c core.worktree=C:/x checkout main`,
  ])("nega %s", (comando) => {
    expect(win(comando)).not.toBeNull();
  });
  it("continua liberando o que fica dentro da pasta", () => {
    expect(win(`powershell -Command "cd repo; git commit -am x"`)).not.toBeNull();
    expect(win(`cmd /c "cd repo\\sub && git commit -am x"`)).not.toBeNull();
    expect(win(`powershell -ExecutionPolicy Bypass -Command "git -C repo commit -am x"`)).not.toBeNull();
    expect(win(`git bisect start`)).not.toBeNull();
    expect(win(`GIT_AUTHOR_NAME=x git commit -am x`)).toBeNull();
  });
});

describe("cerca do git: revisão 3 do PR #642", () => {
  it.each([
    // alto 1: `cmd //c` do Git Bash
    `cmd //c "cd /d C:\\Users\\bia\\code\\acme && git checkout main"`,
    `cd /c/Users/bia/code/acme && cmd //c git checkout main`,
    `cd ~ && cmd //c "git checkout main"`,
    `cmd //c"cd ..\\..\\repo && git checkout main"`,
    `powershell "git -C ..\\..\\repo checkout main"`,
    // médio 5: prefixos que só rodam o de dentro
    `winpty git -C C:/x checkout main`,
    `env GIT_DIR=C:/x/.git git checkout main`,
    `timeout 30 git -C C:/x checkout main`,
    `echo "git checkout main" | bash`,
    // baixo 6: opções entre aspas e -File
    `powershell '-enc' ZwBpAHQA`,
    `powershell -File x.ps1; git status`,
    `[Environment]::SetEnvironmentVariable('GIT_DIR','C:\\x'); git checkout main`,
    `bash <<'EOF'\ngit -C C:/x checkout main\nEOF`,
  ])("nega %s", (comando) => {
    expect(win(comando)).not.toBeNull();
  });
  it("nega o `cmd //c` com a cwd fora da pasta", () => {
    expect(win(`cmd //c "git checkout main"`, "C:\\Users\\bia\\code\\acme")).not.toBeNull();
    expect(win(`cmd //C "git checkout main"`, "C:\\Users\\bia\\code\\acme")).not.toBeNull();
    expect(win(`cmd //c "git commit -am x"`)).not.toBeNull();
  });
  it.each([
    // médio 2: o texto entre aspas não é programa
    `git commit -m "Start Windows support"`,
    `git commit -m 'WSL notes'`,
    `git log --pretty=format:"%h::%s"`,
    `git commit -m "fix: std::string"`,
    `git commit -m "Set GIT_DIR handling"`,
    `git commit -m "usa -Command - no stdin | powershell"`,
    `git status; powershell -c "Write-Host -e"`,
    `git commit -F - <<'EOF'\nStart Windows support\n\nwsl e iex no texto\nEOF`,
  ])("libera %s", (comando) => {
    // ADA-11 (subconjunto do win32): só a forma simples segue livre no Windows; o resto nega.
    expect(win(comando) === null).toBe(["git commit -m \"Start Windows support\"", "git commit -m 'WSL notes'", "git commit -m \"fix: std::string\"", "git commit -m \"Set GIT_DIR handling\"", "git commit -m \"usa -Command - no stdin | powershell\""].includes(comando));
  });
});

describe("cerca do git: revisão 4 do PR #642", () => {
  it.each([
    // alto 1: -EncodedCommand e iex aninhados, sem git à vista
    `cmd /c "powershell -enc ZwBpAHQA"`,
    `bash -c 'powershell -EncodedCommand ZwBpAHQA'`,
    `cmd //c pwsh -e ZwBpAHQA`,
    `pwsh -c "iex ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('ZwBpAHQA')))"`,
    `iex ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('ZwBpAHQA')))`,
    // médio 2: -WorkingDirectory
    `pwsh -wd C:/repo -c 'git reset --hard'`,
    `pwsh -WorkingDirectory C:\\repo -Command "git commit -am x"`,
    // médio 3: heredoc lido por shell
    `source /dev/stdin <<'EOF'\ngit -C C:/repo commit -am x\nEOF`,
    `. /dev/stdin <<EOF\ngit -C C:/repo commit -am x\nEOF`,
    // médio 5: prefixos
    `call git -C C:/repo reset --hard`,
    `cmd /c call git -C C:/repo reset --hard`,
    `pwsh -c ". git -C C:/repo reset --hard"`,
    `exec git -C C:/repo reset --hard`,
    `nice -n 10 git -C C:/repo reset --hard`,
    `echo C:/repo | xargs git -C`,
  ])("nega %s", (comando) => {
    expect(win(comando)).not.toBeNull();
  });
  it.each([
    `cd ${PASTA.replace(/\\/g, "/")}/fix-cmd-parser && git commit -F - <<'EOF'\nUpdate git hooks\nEOF`,
    `./test.sh && git commit -F - <<EOF\nmexe no git\nEOF`,
    `git commit -m 'sh fix' -F - <<EOF\nfala de git\nEOF`,
    `pwsh -wd repo -c "git commit -am x"`,
    `bash -lc 'git status'`,
  ])("libera %s", (comando) => {
    expect(win(comando)).not.toBeNull();
  });
});

describe("cerca do git: revisão 5 do PR #642", () => {
  it.each([
    `powershell -NoProfile -Command "[Environment]::OSVersion"`,
    `powershell -NoProfile -Command "[Convert]::ToBase64String([IO.File]::ReadAllBytes('a.png'))"`,
    `powershell -c "[IO.File]::ReadAllText('a')"`,
  ])("libera %s (sem git)", (comando) => {
    expect(win(comando)).toBeNull();
  });
  it("continua negando o :: com git ou GIT_*", () => {
    expect(win(`[Environment]::SetEnvironmentVariable('GIT_DIR','C:\\x','User')`)).not.toBeNull();
    expect(win(`Set-Location FileSystem::C:\\x; git checkout main`)).not.toBeNull();
  });
});

describe("cerca do git: revisão 6 do PR #642 (médio 2)", () => {
  it.each([
    `git diff --name-only origin/main...HEAD | xargs npx eslint`,
    `git ls-files '*.ts' | xargs wc -l`,
    `find . -name '*.ts' | xargs grep -l git`,
    `git log -1 | cat; start .`,
    `bash scripts/git-hooks.sh`,
    `sh .git/hooks/pre-commit`,
  ])("libera %s (dentro da pasta do bot)", (comando) => {
    expect(win(comando)).not.toBeNull();
  });
  it.each([
    `echo x | xargs -I{} git -C C:/repo checkout {}`,
    `echo x | xargs -n 1 git -C C:/repo checkout`,
    `git ls-files | xargs sh -c 'git -C C:/repo reset --hard'`,
    `echo x | xargs env git -C C:/repo checkout main`,
    `git status; start git checkout main`,
    `git status; Start-Process pwsh -ArgumentList '-c git reset --hard'`,
    `bash -c 'git -C C:/repo checkout main'`,
    `bash -x -c 'git -C C:/repo checkout main'`,
  ])("continua negando %s", (comando) => {
    expect(win(comando)).not.toBeNull();
  });
});

describe("cerca do git: revisão 7 do PR #642", () => {
  it.each([
    // bloqueantes 1-5: o que a revisão 6 tinha reaberto
    `bash -cx 'git -C C:/repo checkout main'`,
    `sh -cv 'git -C C:/repo checkout main'`,
    `bash -s <<< 'git -C C:/repo checkout main'`,
    `sh -s -- x <<< "git -C C:/repo reset --hard"`,
    `echo main | xargs --max-args 1 git -C C:/repo checkout`,
    `echo main | xargs --arg-file a.txt git -C C:/repo checkout`,
    `echo main | xargs --delimiter , git -C C:/repo checkout`,
    `echo main | xargs timeout -s KILL 5 git -C C:/repo checkout`,
    `$g='git'; Start-Process $g -ArgumentList 'checkout','main' -WorkingDirectory C:\\repo`,
    // altos 6-9
    `env --chdir=C:/repo git checkout main`,
    `env -C C:/repo git checkout main`,
    `env -u X git -C C:/repo checkout main`,
    `bash -c -- 'git -C C:/repo checkout main'`,
    `bash -c -x 'git -C C:/repo checkout main'`,
    `start powershell -EncodedCommand ZwBpAHQA`,
    `Start-Process powershell -ArgumentList '-enc','ZwBpAHQA'`,
    `$g='git'; & $g -C C:\\repo checkout main`,
  ])("nega %s", (comando) => {
    expect(win(comando)).not.toBeNull();
  });
  it.each([
    `git ls-files | xargs -n 1 wc -l`,
    `git diff --name-only | xargs --no-run-if-empty npx eslint`,
    `env -C repo git status`,
    `env -u FOO git status`,
    `bash -c -- 'git status'`,
    `start .`,
  ])("libera %s (dentro da pasta do bot)", (comando) => {
    // ADA-11 (subconjunto do win32): só a forma simples segue livre no Windows; o resto nega.
    expect(win(comando) === null).toBe(["start ."].includes(comando));
  });
});

describe("cerca do git: QA do PR #642 (médios)", () => {
  const lin = (comando: string) => gitForaDaPastaDoBot(comando, { cwd: "/home/nod/nod/Bot/pasta", pastaDoBot: "/home/nod/nod/Bot/pasta", home: "/home/nod", windows: false });
  it.each([
    `git --git-dir=C:/x/.git checkout main`,
    `git --git-dir C:/x/.git reset --hard`,
    `$env:GIT_DIR='C:/x/.git'; git checkout main`,
    `(cd C:/x && git checkout main)`,
    `( cd C:/x; git reset --hard )`,
  ])("no Windows nega %s", (comando) => {
    expect(win(comando)).not.toBeNull();
  });
  it.each([
    `git --git-dir=/srv/x/.git checkout main`,
    `GIT_DIR=/srv/x/.git git commit -m x`,
    `(cd /srv/x && git checkout main)`,
  ])("no Linux nega %s", (comando) => {
    expect(lin(comando)).not.toBeNull();
  });
  it.each([
    `git --git-dir=.git checkout -b frente/x`,
    `(cd sub && git status)`,
    `(git status)`,
  ])("libera %s", (comando) => {
    // ADA-11 (subconjunto do win32): só a forma simples segue livre no Windows; o resto nega.
    expect(win(comando) === null).toBe(["git --git-dir=.git checkout -b frente/x"].includes(comando));
    expect(lin(comando)).toBeNull();
  });
});

describe("cerca do git: revisão 8 do PR #642 (médio 2, depois da substituição)", () => {
  const lin = (comando: string) => gitForaDaPastaDoBot(comando, { cwd: "/home/nod/nod/Bot/pasta", pastaDoBot: "/home/nod/nod/Bot/pasta", home: "/home/nod", windows: false });
  it.each([
    `BR=$(git branch --show-current); cd ~/code/acme && git checkout $BR`,
    "echo $(date) && cd ../.. && git checkout main",
    `cd acme && git commit -m "$(cat msg.txt)" && cd ../../.. && git checkout main`,
    "echo `date` && cd ../.. && git reset --hard",
    `cd $(git rev-parse --show-toplevel)/../outro && git checkout main`,
  ])("nega %s (Windows e Linux)", (comando) => {
    expect(lin(comando)).not.toBeNull();
    expect(win(comando)).not.toBeNull();
  });
  it.each([
    `git commit -m "$(cat <<'EOF'\nfix: o (caso) do x\n\nCo-Authored-By: A <a@b>\nEOF\n)"`,
    `git commit -m "$(cat <<'EOF'\nfix: 1) sem par\nEOF\n)"`,
    `BR=$(git branch --show-current) && git push origin $BR`,
    `echo "don't $(date)" && git status`,
  ])("libera %s (Windows e Linux)", (comando) => {
    expect(lin(comando)).toBeNull();
    expect(win(comando)).not.toBeNull();
  });
});

describe("cerca do git: revisão 8 do PR #642 (médio 1, bloco e subexpressão do PowerShell)", () => {
  it.each([
    `powershell -Command "cd C:\\repo; if ($?) { git checkout main }"`,
    `pwsh -c "foreach ($b in 'main') { git -C C:/repo checkout $b }"`,
    `pwsh -c "git -C (Resolve-Path ..\\..) checkout main"`,
    `git -C (Resolve-Path ../..) checkout main`,
  ])("nega %s", (comando) => {
    expect(win(comando)).not.toBeNull();
  });
  it.each([
    `pwsh -c "git status"`,
    `powershell -Command "Get-ChildItem (Get-Location)"`,
  ])("libera %s", (comando) => {
    // ADA-11 (subconjunto do win32): só a forma simples segue livre no Windows; o resto nega.
    expect(win(comando) === null).toBe(["powershell -Command \"Get-ChildItem (Get-Location)\""].includes(comando));
  });
});

describe("cerca do git: revisão 8 do PR #642 (médio 3, xargs git na pasta)", () => {
  const lin = (comando: string) => gitForaDaPastaDoBot(comando, { cwd: "/home/nod/nod/Bot/pasta", pastaDoBot: "/home/nod/nod/Bot/pasta", home: "/home/nod", windows: false });
  it.each([
    `find . -name '*.ts' | xargs git add`,
    `git diff --name-only | xargs git add --`,
    `git ls-files -m | xargs -0 git checkout --`,
  ])("libera %s (Windows e Linux)", (comando) => {
    expect(win(comando)).not.toBeNull();
    expect(lin(comando)).toBeNull();
  });
  it.each([
    `cd ../.. && git ls-files | xargs git checkout --`,
    `git diff --name-only | xargs -I{} git -C C:/repo add {}`,
    `echo C:/repo | xargs git -C`,
  ])("no Windows nega %s", (comando) => {
    expect(win(comando)).not.toBeNull();
  });
  it("no Linux nega o xargs git depois de sair da pasta", () => {
    expect(lin(`cd ../.. && git ls-files | xargs git checkout --`)).not.toBeNull();
  });
});

describe("cerca do git: revisão 9 do PR #642", () => {
  const lin = (comando: string) => gitForaDaPastaDoBot(comando, { cwd: "/home/nod/nod/Bot/pasta", pastaDoBot: "/home/nod/nod/Bot/pasta", home: "/home/nod", windows: false });
  const repo = `${PASTA}\\repo`;
  it.each([
    `cmd /c "cd.. & cd.. & git checkout main"`,
    `cmd /c "cd\\ & git checkout main"`,
    `cmd /c "cd/d C:\\code & git checkout main"`,
    `powershell -c "cd..; cd..; git checkout main"`,
    `cmd /c "chdir C:\\code & git checkout main"`,
    `git -c core.worktree=C:/x checkout main`,
    `git -c include.path=C:/x/cfg checkout main`,
    `git --config-env=core.worktree=X checkout main`,
  ])("no Windows nega %s (alto 1, baixo 2)", (comando) => {
    expect(win(comando, repo)).not.toBeNull();
  });
  it.each([
    `git -c core.worktree=/srv/x checkout main`,
    `git --config-env=core.worktree=X checkout main`,
  ])("no Linux nega %s (baixo 2)", (comando) => {
    expect(lin(comando)).not.toBeNull();
  });
  it.each([
    `(cd /tmp/x && git status) && git checkout -b frente/y`,
    `git -c core.pager=cat log`,
  ])("no Linux libera %s (baixo 3: o cd do subshell não vaza)", (comando) => {
    expect(lin(comando)).toBeNull();
  });
  it("no Windows libera cd.. que continua dentro da pasta", () => {
    expect(win(`cmd /c "cd.. & git status"`, repo)).not.toBeNull();
  });
});

describe("cerca do git: revisão 10 do PR #642", () => {
  const H = "C:\\Users\\bia";
  const P = "C:\\Users\\bia\\nod\\ze\\t1";
  const w = (comando: string) => gitForaDaPastaDoBot(comando, { cwd: `${P}\\repo`, pastaDoBot: P, home: H, windows: true });
  it.each([
    `cmd //c "cd ^C:\\x & git checkout main"`,
    `cmd //c "c^d C:\\x & git checkout main"`,
    `cmd //c "cd C:\\x & g^it ch^eckout main"`,
    `cmd //c "(cd C:\\x) & git checkout main"`,
    `cmd //c "cd,C:\\x & git checkout main"`,
    `cmd //c "cd=C:\\x & git checkout main"`,
  ])("o cmd com ^, ( ) e cd, nega: %s (alto 1)", (comando) => {
    expect(w(comando)).not.toBeNull();
  });
  const L = "/home/nod/nod/Bot/pasta";
  const lin = (comando: string) => gitForaDaPastaDoBot(comando, { cwd: `${L}/repo`, pastaDoBot: L, home: "/home/nod", windows: false });
  it.each([
    `cd "$(git rev-parse --show-toplevel)" && git add -A`,
    `git -C "$(git rev-parse --show-toplevel)" add -A`,
    `cd "$(pwd)/src" && git add .`,
    "cd \"`pwd`/src\" && git add .",
    `git tag -l`,
    `git submodule status`,
    `git bisect log`,
  ])("o $(pwd) e a raiz do repositório são a pasta atual: %s (médio 2)", (comando) => {
    expect(lin(comando)).toBeNull();
  });
  it.each([
    `git -c alias.sw=switch sw main`,
    `git --git-dir="$D" checkout main`,
    `D=/tmp/x; GIT_DIR=$D git checkout main`,
    `builtin cd /home/nod/code && git checkout main`,
    `>/dev/null cd /home/nod/code && git checkout main`,
    `cd /home/nod/code && git bisect start`,
    `cd /home/nod/code && git tag -d x`,
    `CDPATH=/home/nod/code; cd repo && git checkout main`,
    `pushd /home/nod/nod/Bot/pasta && popd && git checkout main`,
  ])("nega: %s (médio 5)", (comando) => {
    expect(lin(comando)).not.toBeNull();
  });
});

describe("cerca do git: revisão 11 do PR #642", () => {
  const ACME = "C:\\Users\\Bia\\code\\acme";
  it.each([
    `powershell -c 'cd ${ACME}; g\`it checkout main'`,
    `powershell -c 'cd ${ACME}; git check\`out main'`,
    `powershell -c 'cd ${ACME}; git \`checkout main'`,
  ])("a crase do PowerShell não esconde o git: %s (bloqueante 1)", (comando) => {
    expect(win(comando)).not.toBeNull();
  });
  it.each([
    `powershell -c '$g="gi"+"t"; & $g -C ${ACME} checkout main'`,
    `powershell -c 'Set-Alias g git; cd ${ACME}; g checkout main'`,
    `powershell -c 'sal g git; g -C ${ACME} checkout main'`,
    `cmd /v:on /c "set g=git& cd /d ${ACME}& !g! checkout main"`,
  ])("o programa numa variável ou alias nega: %s (alto 1)", (comando) => {
    expect(win(comando)).not.toBeNull();
  });
  it.each([
    `powershell -c 'ni env:\\GIT_DIR -Value ${ACME}\\.git; git checkout main'`,
    `powershell -c 'Set-Item -Path Env:\\GIT_DIR -Value ${ACME}\\.git; git checkout main'`,
    `powershell -c 'New-Item -Path Env:\\GIT_DIR -Value ${ACME}\\.git; git checkout main'`,
  ])("o GIT_DIR por Env:\\ nega: %s (alto 2)", (comando) => {
    expect(win(comando)).not.toBeNull();
  });
  const L = "/home/bia/nod/ze-1";
  const lin = (comando: string) => gitForaDaPastaDoBot(comando, { cwd: L, pastaDoBot: L, home: "/home/bia", windows: false });
  it.each([
    `cd a && cd "$(git rev-parse --show-toplevel)/home/bia/code/acme" && git checkout main`,
    `cd repo/a/b/c && cd "$(git rev-parse --show-toplevel)/../../../code/acme" && git checkout main`,
    `cd "$(git rev-parse --show-toplevel)"/../../code/acme && git checkout main`,
  ])("a raiz do repositório com caminho grudado é pasta desconhecida: %s (alto 3)", (comando) => {
    expect(lin(comando)).not.toBeNull();
  });
});

describe("cerca do git: revisão 12 do PR #642", () => {
  it.each([
    `powershell -c "Push-Location C:\\Users\\Bia\\code\\x; Push-Location C:\\Users\\Bia\\nod\\ze-1; Pop-Location; git checkout main"`,
    `powershell -c "sl C:\\Users\\Bia\\code\\x; sl C:\\Users\\Bia\\nod\\ze-1; Pop-Location; git checkout main"`,
    `powershell -c "Set-Location -Path:C:\\Users\\Bia\\code\\x; git checkout main"`,
    `powershell -c "Set-Location -Path:C:\\Users\\Bia\\code\\x; sl nod\\ze-1; git checkout main"`,
  ])("nega: %s (altos C e médio D)", (comando) => {
    expect(win(comando)).not.toBeNull();
  });
  it("o Set-Location -Path:<pasta do bot> continua livre", () => {
    expect(win(`powershell -c "Set-Location -Path:${PASTA}; git checkout main"`)).not.toBeNull();
  });
});

describe("cerca do git: revisão 13 do PR #642", () => {
  it.each([
    `cmd //c "cd .. & @git checkout main"`,
    `cmd //c "@cd .. && git checkout main"`,
    `cmd //c "if 1==1 cd .. && git checkout main"`,
    `cmd //c "for %d in (..) do cd %d && git checkout main"`,
    `powershell -c "Set-Location -ErrorAction Stop ..; git checkout main"`,
    `powershell -c "cd -ea 0 ..; git checkout main"`,
    `powershell -c "Set-Location -StackName x ..; git checkout main"`,
    `powershell -c "Set-Location -ErrorAction:Stop ..; git checkout main"`,
  ])("nega: %s (altos 1 e 2)", (comando) => {
    expect(win(comando)).not.toBeNull();
  });
  it.each([
    `cmd //c "@git status"`,
    `powershell -c "Set-Location -Path ${PASTA}; git checkout main"`,
    `powershell -c "Set-Location -PassThru ${PASTA}; git checkout main"`,
    `cmd //c "cd /d ${PASTA} && git checkout main"`,
  ])("continua livre: %s", (comando) => {
    expect(win(comando)).not.toBeNull();
  });
});

describe("revisão 14 do PR #642", () => {
  it.each([
    "\\\\?\\GLOBALROOT\\Device\\HarddiskVolume3\\Users\\Bia\\code\\x",
    "\\\\?\\Volume{0b1c2d3e-0000-0000-0000-000000000000}\\Users\\Bia\\code\\x",
    "//?/GLOBALROOT/Device/HarddiskVolume3/x",
    "\\\\?\\pipe\\x",
  ])("o \\\\?\\ que não é drive nem UNC não é conferível (bloqueante 1): %s", (c) => {
    expect(normalizarCaminho(c, true)).toBeNull();
  });
  it.each([
    `git -C '\\\\?\\GLOBALROOT\\Device\\HarddiskVolume3\\Users\\Bia\\code\\x' checkout main`,
    `git -C '\\\\?\\Volume{0b1c2d3e-0000}\\Users\\Bia\\code\\x' checkout main`,
    `cd '\\\\?\\GLOBALROOT\\Device\\HarddiskVolume3\\Users\\Bia\\code\\x' && git reset --hard`,
    `git -C //?/GLOBALROOT/Device/HarddiskVolume3/x checkout main`,
  ])("a cerca nega: %s", (comando) => {
    expect(win(comando)).not.toBeNull();
  });
  it("o \\\\?\\C:\\ dentro da pasta continua livre", () => {
    expect(normalizarCaminho("\\\\?\\C:\\a", true)).toBe("/c/a");
    expect(win(`git -C '\\\\?\\C:\\Users\\Bia\\nod\\ze-1' checkout main`)).toBeNull();
  });
  it("o Write num \\\\?\\GLOBALROOT não passa calado (vai à aprovação ou nega)", () => {
    const pasta = { cwd: PASTA, pastaDoBot: PASTA, home: HOME, windows: true };
    const d = decidirNativa({ ferramenta: "Write", entrada: { file_path: "\\\\?\\GLOBALROOT\\Device\\HarddiskVolume3\\Users\\Bia\\code\\x\\a.ts" }, pasta });
    expect(d.permitir === false || d.arquivo !== undefined).toBe(true);
    expect(String(d.arquivo ?? "")).not.toMatch(/ze-1\/GLOBALROOT/i);
  });
  const L = "/home/nod/nod/Bot/pasta";
  const lin = (comando: string) => gitForaDaPastaDoBot(comando, { cwd: L, pastaDoBot: L, home: "/home/nod", windows: false });
  it.each([
    "git -c alias.st=status st",
    "git -c alias.lg='log --oneline' lg",
    "git -C ~/code/x tag --column",
    "git -C ~/code/x tag -l 'v*' --column",
    "git -C ~/code/x tag -n5",
    "git -C ~/code/x submodule foreach git status",
    "git -C ~/code/x submodule foreach --recursive 'git log -1'",
  ])("no Linux, livre como no main (médio 2): %s", (comando) => {
    expect(lin(comando)).toBeNull();
  });
  it.each([
    "git -c alias.st=checkout -C ~/code/x st main",
    "git -c 'alias.x=!cd ~/code/x && git reset --hard' x",
    "git -c alias.a=b -c alias.b=checkout -C ~/code/x a main",
    "git -c alias.o=-C -C ~/code/x o",
    "git -C ~/code/x tag v1",
    "git -C ~/code/x tag -d v1",
    "git -C ~/code/x tag -am msg v1",
    "git -C ~/code/x tag -f v1 HEAD",
    "git -C ~/code/x submodule foreach git checkout main",
    "git -C ~/code/x submodule foreach 'git status; git reset --hard'",
    "git -C ~/code/x submodule foreach 'cd .. && git status'",
    "git -C ~/code/x submodule update",
  ])("continua negado: %s", (comando) => {
    expect(lin(comando)).not.toBeNull();
  });
});

describe("revisão 15 do PR #642", () => {
  const L = "/home/nod/nod/Bot/pasta";
  const lin = (comando: string) => gitForaDaPastaDoBot(comando, { cwd: L, pastaDoBot: L, home: "/home/nod", windows: false });
  it.each([
    "cd web && npm test; cd - && git commit -am x",
    "cd web && npm run build && cd - && git add -A",
    "cd ~/code/x && git log -1; cd - && git checkout main",
  ])("no Linux, o cd - volta à anterior (alto 1): %s", (comando) => {
    expect(lin(comando)).toBeNull();
  });
  it.each([
    "cd - && git checkout main",
    "cd web && cd ~/code/x && cd - && cd - && git checkout main",
    "(cd web); cd - && git checkout main",
    "cd + && git checkout main",
    "pushd && git checkout main",
    "pushd +1 && git checkout main",
  ])("o cd - sem anterior conhecida continua negado: %s", (comando) => {
    expect(lin(comando)).not.toBeNull();
  });
  it.each([
    "git -C ~/code/acme tag --sort=-creatordate --format '%(refname)'",
    "git -C ~/code/acme tag --sort -creatordate",
    "git -C ~/code/acme tag --format '%(refname:short)'",
    "git -C ~/code/acme tag --contains HEAD",
  ])("o tag que só lista fica livre (médio 2): %s", (comando) => {
    expect(lin(comando)).toBeNull();
  });
  it.each([
    "git -C ~/code/acme tag --sort=-creatordate v1",
    "git -C ~/code/acme tag -m msg v1",
    "git -C ~/code/acme tag -- v1",
  ])("o tag que cria continua negado: %s", (comando) => {
    expect(lin(comando)).not.toBeNull();
  });
});

describe("cerca do git: revisão 14b do PR #642 (M3)", () => {
  it.each([
    `cmd /c "for %d in (C:\\Users\\Bia\\code\\acme) do git -C %d reset --hard"`,
    `cmd /c "for /d %d in (..\\*) do git -C %d commit"`,
    `cmd /c "for %d in (..) do git -C %d commit"`,
    `cmd //c "for %%d in (..) do @git -C %%d commit"`,
    `cmd /c "for %d in (..) do (git -C %d commit)"`,
  ])("nega o git dentro de um for do cmd: %s", (comando) => {
    expect(win(comando)).not.toBeNull();
  });
  it("o for do cmd passa pelo subconjunto e é negado (confirmação da revisão final: `%i` pode virar o programa)", () => {
    expect(win(`cmd /c "for %f in (*.txt) do type %f"`)).not.toBeNull();
  });
});

describe("cerca do git: revisão 16 do PR #642", () => {
  const L = "/home/nod/nod/Bot/pasta";
  const lin = (comando: string) => gitForaDaPastaDoBot(comando, { cwd: L, pastaDoBot: L, home: "/home/nod", windows: false });
  it.each([
    `pwsh -c 'New-PSDrive -Name Repo -PSProvider FileSystem -Root C:\\clone; cd Repo:; git checkout main'`,
    `pwsh -c 'ndr Repo FileSystem C:\\clone; cd Repo:\\; git checkout main'`,
    `pwsh -c 'cd Temp:\\clone; git checkout main'`,
    `git -C Repo:\\x checkout main`,
  ])("alto 1: o PSDrive do PowerShell não é pasta conferível: %s", (comando) => {
    expect(win(comando)).not.toBeNull();
  });
  it.each([
    `pushd /c/clone && pushd ${"C:/Users/Bia/nod/ze-1"} && pushd +1 && git checkout main`,
    `bash -c 'pushd /c/clone; pushd /c/Users/Bia/nod/ze-1; pushd +1; git checkout main'`,
    `pushd /c/clone && pushd /c/Users/Bia/nod/ze-1 && pushd && git checkout main`,
  ])("alto 2: o pushd que gira a pilha também no win32: %s", (comando) => {
    expect(win(comando)).not.toBeNull();
  });
  it.each([`cd /tmp/clone && cd ${L} && cd ~- && git checkout main`, `cd ~bia/../../clone && git checkout main`, `cd ~+/../x && git commit -m x`])(
    "médio 3: ~-, ~+ e ~usuario viram pasta desconhecida: %s",
    (comando) => {
      expect(lin(comando)).not.toBeNull();
      expect(win(comando)).not.toBeNull();
    },
  );
  it("o ~ e o ~/ seguem a home, e o drive C: segue conferível", () => {
    expect(lin("cd ~/nod/Bot/pasta && git commit -m x")).toBeNull();
    expect(win(`cd "C:\\Users\\Bia\\nod\\ze-1" && git commit -m x`)).toBeNull();
  });
});

describe("cerca do git: revisão 17 do PR #642 (médio 1)", () => {
  const L = "/home/nod/nod/Bot/pasta";
  const lin = (comando: string) => gitForaDaPastaDoBot(comando, { cwd: L, pastaDoBot: L, home: "/home/nod", windows: false });
  it.each([`case x in *) cd ../.. ;; esac; git reset --hard`, `case x in x) cd ../..;; esac; git reset --hard`, `case "$X" in a) pushd /tmp ;; esac && git checkout main`])(
    "o case que troca de pasta nega no Linux e no win32: %s",
    (comando) => {
      expect(lin(comando)).not.toBeNull();
      expect(win(comando)).not.toBeNull();
    },
  );
  it("o case sem troca de pasta segue livre", () => {
    expect(lin(`case x in *) echo oi ;; esac; git status`)).toBeNull();
  });
});

describe("cerca do git: revisão 18 do PR #642", () => {
  const L = "/home/nod/nod/Bot/pasta";
  const lin = (comando: string) => gitForaDaPastaDoBot(comando, { cwd: L, pastaDoBot: L, home: "/home/nod", windows: false });
  it.each([
    'echo "<<EOF"\ncd ../..\ngit checkout main\nEOF',
    "cat <<<EOF\ncd ../..\ngit checkout main\nEOF",
    "echo x # <<EOF\ngit -C ../.. checkout main\nEOF",
  ])("alto 1: o heredoc falso (aspas, <<<, comentário) não esconde o git no win32: %s", (comando) => {
    expect(win(comando)).not.toBeNull();
    expect(lin(comando)).not.toBeNull();
  });
  it("alto 1: o heredoc de verdade segue sendo dado", () => {
    expect(win("git commit -F - <<'EOF'\nStart the thing\nEOF")).not.toBeNull();
  });
  it.each([`PWD=${"/c/Users/bia/nod/ze"}; cd /c/code; git -C "$PWD" checkout main`])("médio 2: o PWD atribuído não vale depois do cd (win32): %s", (comando) => {
    expect(win(comando)).not.toBeNull();
  });
  it("médio 2: o PWD atribuído não vale depois do cd (Linux)", () => {
    expect(lin(`PWD=${L}; cd /home/bia/code; git -C "$PWD" checkout main`)).not.toBeNull();
  });
  it.each([
    `eval "cd ../.."; git checkout main`,
    `f() { cd ../..; }; f; git checkout main`,
    `function f { cd ../..; }; f; git checkout main`,
    `. /dev/stdin <<< "cd ../.."; git checkout main`,
    `source x.sh; git checkout main`,
  ])("médio 3: eval, função e source escondem o cd no win32: %s", (comando) => {
    expect(win(comando)).not.toBeNull();
  });
});

describe("cerca do git: revisão 19 do PR #642", () => {
  const L = "/home/bia/nod/ze/task";
  const lin = (comando: string, cwd = `${L}/repo`) => gitForaDaPastaDoBot(comando, { cwd, pastaDoBot: L, home: "/home/bia", windows: false });
  const W = "C:\\Users\\bia\\nod\\ze\\task";
  const wi = (comando: string) => gitForaDaPastaDoBot(comando, { cwd: `${W}\\repo`, pastaDoBot: W, home: "C:\\Users\\bia", windows: true });
  it.each([
    `cd ~/code/acme; cd ~/nod/ze/task/nao-existe; git checkout main`,
    `cd ~/code/acme\ncd ~/nod/ze/task/x\ngit checkout main`,
    `cd ~/nod/ze/task/a/b; cd ../..; git checkout main`,
    `cd ~/code/acme; cd ~/nod/ze/task/repo || true; git checkout main`,
  ])("alto 1: o cd que pode falhar não põe a cerca na pasta do bot: %s", (comando) => {
    expect(lin(comando)).not.toBeNull();
    expect(wi(comando)).not.toBeNull();
  });
  it.each([
    `cd ~/nod/ze/task/x; git checkout main`,
    `cd ~/code/acme && cd ~/nod/ze/task/x && git checkout main`,
    `cd ~/code/acme; cd ~/nod/ze/task/x || exit 1; git checkout main`,
    `cd web && npm test; cd - && git commit -am x`,
  ])("alto 1: segue livre quando todas as pastas possíveis são do bot: %s", (comando) => {
    expect(lin(comando)).toBeNull();
  });
  it.each([`cd ../../.. && git --namespace x checkout main`, `cd ../../.. && git --no-pager --namespace x reset --hard`, `cd ../../.. && git --attr-source HEAD checkout main`])(
    "médio 1: --namespace e --attr-source levam valor: %s",
    (comando) => {
      expect(lin(comando)).not.toBeNull();
      expect(wi(comando)).not.toBeNull();
    },
  );
});

describe("cerca do git: revisão 20 do PR #642", () => {
  const B = "/home/n/nod/ze-1";
  const lin = (comando: string) => gitForaDaPastaDoBot(comando, { cwd: "/home/n/code/acme", pastaDoBot: B, home: "/home/n", windows: false });
  const WB = "C:\\Users\\Bia\\nod\\ze-1";
  const wi = (comando: string) => gitForaDaPastaDoBot(comando, { cwd: "C:\\Users\\Bia\\code\\acme", pastaDoBot: WB, home: "C:\\Users\\Bia", windows: true });
  it.each([
    `cd ~/nod/ze-1 && true || git checkout main`,
    `cd ~/nod/ze-1 && true; git checkout main`,
    `! cd ~/nod/ze-1 && git checkout main`,
    `[ -d x ] || cd ~/nod/ze-1 && git checkout main`,
  ])("médio 1: o cd de uma cadeia que pode ter sido pulado: %s", (comando) => {
    expect(lin(comando)).not.toBeNull();
    expect(wi(comando)).not.toBeNull();
  });
  it.each([`cd ~/nod/ze-1 && git checkout main`, `cd ~/nod/ze-1 || exit 1; git checkout main`, `cd ~/nod/ze-1 && cd sub && git checkout main`])(
    "médio 1: o cd certo segue livre: %s",
    (comando) => {
      expect(lin(comando)).toBeNull();
    },
  );
  it.each([`cd ~/code/acme && /usr/lib/git-core/git-reset --hard`, `cd ../.. && "$(git --exec-path)/git-checkout" main`])("médio 2: o binário git-<sub> é o git: %s", (comando) => {
    expect(lin(comando)).not.toBeNull();
    expect(wi(comando)).not.toBeNull();
  });
  it("médio 2: o binário git-<sub> segue livre na pasta do bot", () => {
    expect(lin(`cd ~/nod/ze-1 && git-lfs pull`)).toBeNull();
  });
  it.each([`cd ~/code/acme && gh co 12`, `cd ~/code/acme && gh pr --repo a/b checkout 12`])("médio 3: o gh que troca de branch: %s", (comando) => {
    expect(lin(comando)).not.toBeNull();
    expect(wi(comando)).not.toBeNull();
  });
  it.each([`cd /d && git -C nod/ze-1 reset --hard`, `pushd /e && git -C nod/ze-1 reset --hard`])("baixo 1: no Git Bash `/d` é o drive D:: %s", (comando) => {
    expect(wi(comando)).not.toBeNull();
  });
});

describe("cerca do git: revisão 21 do PR #642", () => {
  const B = "/home/u/nod/dev/t1";
  const lin = (comando: string, cwd = B) => gitForaDaPastaDoBot(comando, { cwd, pastaDoBot: B, home: "/home/u", windows: false });
  const WB = "C:\\Users\\u\\nod\\dev\\t1";
  const wi = (comando: string, cwd = WB) => gitForaDaPastaDoBot(comando, { cwd, pastaDoBot: WB, home: "C:\\Users\\u", windows: true });
  it.each([
    `cd ~/code/acme; true & git checkout main`,
    `cd ~/code/acme; npm test & git reset --hard origin/main`,
    `git -C ~/code/acme status & git -C ~/code/acme switch main`,
    `cd ~/code/acme\nsleep 1 & git stash`,
  ])("alto 1: o & separa também no POSIX: %s", (comando) => {
    expect(lin(comando)).not.toBeNull();
    expect(wi(comando)).not.toBeNull();
  });
  it("alto 1: o redirecionamento 2>&1 e o &> seguem lidos", () => {
    expect(lin(`git commit -am x 2>&1 | tail -3`)).toBeNull();
    expect(lin(`git status &> /dev/null`)).toBeNull();
  });
  it.each([
    `git commit -m 'fix: corrige parse() no loader'`,
    `cd repo && git commit -m "fix: use function foo() in bar"`,
    `cd repo && echo 'function x() {}' > a.js && git add a.js`,
    `git commit -m "$(cat <<'EOF'\nfeat: adiciona f() e g()\n\nCo-Authored-By: x\nEOF\n)"`,
  ])("médio 1: f() entre aspas não é função no win32: %s", (comando) => {
    // ADA-11 (subconjunto do win32): só a forma simples segue livre no Windows; o resto nega.
    expect(wi(comando) === null).toBe(["git commit -m 'fix: corrige parse() no loader'", "cd repo && git commit -m \"fix: use function foo() in bar\""].includes(comando));
  });
  it("médio 1: a função dentro do bash -c segue negada no win32", () => {
    expect(wi(`bash -c "f() { cd ../..; }; f; git checkout main"`)).not.toBeNull();
  });
  it("baixo 1: case … esac citado na mensagem não nega", () => {
    expect(lin(`cd repo && git add -A && git commit -m 'docs: case ... esac and cd'`)).toBeNull();
    expect(wi(`cd repo && git add -A && git commit -m 'docs: case ... esac and cd'`)).toBeNull();
  });
  it.each([
    `cd ~/nod/dev/t1/nope || return 1; git checkout main`,
    `cd ~/nod/dev/t1/nope || exit 1 | cat; git checkout main`,
    `cd ~/nod/dev/t1/nope || exit 1 & git checkout main`,
  ])("baixo 2: o exit que não encerra o shell: %s", (comando) => {
    expect(lin(comando, "/home/u/code/acme")).not.toBeNull();
  });
  it("baixo 2: o || exit de verdade segue certo", () => {
    expect(lin(`cd ~/nod/dev/t1/x || exit 1; git checkout main`, "/home/u/code/acme")).toBeNull();
  });
});

describe("cerca do git: revisão 22 do PR #642", () => {
  // O baixo 2 (monorepo: `cd packages/api && npm test; cd ../.. && git commit`) fica negando: se o primeiro cd falha, o
  // `cd ../..` cai acima da pasta do bot, onde o git pode achar outro repositório (o `~` com dotfiles). Na ADR-147.
  const B = "/home/u/nod/dev/t1";
  const lin = (comando: string, cwd = B) => gitForaDaPastaDoBot(comando, { cwd, pastaDoBot: B, home: "/home/u", windows: false });
  const WB = "C:\\Users\\u\\nod\\dev\\t1";
  const wi = (comando: string, cwd = WB) => gitForaDaPastaDoBot(comando, { cwd, pastaDoBot: WB, home: "C:\\Users\\u", windows: true });
  it.each([
    `"(" ; cd ~/code/acme ; echo ")" ; git checkout main`,
    `"(true"; cd ~/code/acme; echo "fim)"; git checkout main`,
    `\\(true; cd ~/code/acme; echo \\); git reset --hard`,
    `'(' ; cd ~/code/acme ; echo ')' ; git checkout main`,
    `(cd ~/code/acme && echo "fix(x)" && git checkout main)`,
  ])("bloqueante 1: parênteses entre aspas ou com \\ não abrem nem fecham subshell: %s", (comando) => {
    expect(lin(comando)).not.toBeNull();
    expect(wi(comando)).not.toBeNull();
  });
  it.each([
    `(cd ~/code/acme && git status); git checkout main`,
    `git commit -m "feat(cerca): x" && git checkout -b y`,
    `((cd ~/code/acme)); git checkout main`,
  ])("bloqueante 1: o subshell de verdade e o texto com parênteses seguem livres: %s", (comando) => {
    expect(lin(comando)).toBeNull();
  });
  it.each([
    [`cd ../../outro/x; git checkout main`, `${B}/repo`],
    [`cd ~/code/acme; cd ~/nod/dev; git checkout main`, B],
  ])("baixo 2: a pasta possível fora da pasta do bot continua negando: %s", (comando, cwd) => {
    expect(lin(comando, cwd)).not.toBeNull();
  });
});

describe("cerca do git: revisão 23 do PR #642", () => {
  const B = "/home/u/nod/dev/t1";
  const lin = (comando: string, cwd = B) => gitForaDaPastaDoBot(comando, { cwd, pastaDoBot: B, home: "/home/u", windows: false });
  const WB = "C:\\Users\\u\\nod\\dev\\t1";
  const wi = (comando: string, cwd = WB) => gitForaDaPastaDoBot(comando, { cwd, pastaDoBot: WB, home: "C:\\Users\\u", windows: true });
  it.each([
    [`(D=/home/u/nod/dev/t1); cd /home/u/code && git -C "$D" checkout main`, `(D=C:/Users/u/nod/dev/t1); cd C:/code && git -C "$D" checkout main`],
    [`cd /home/u/code && (D=/home/u/nod/dev/t1) && git -C "$D" checkout main`, `cd C:/code && (D=C:/Users/u/nod/dev/t1) && git -C "$D" checkout main`],
    [`D=/home/u/nod/dev/t1 | true; cd /home/u/code && git -C "$D" checkout main`, `D=C:/Users/u/nod/dev/t1 | true; cd C:/code && git -C "$D" checkout main`],
    [`D=/home/u/nod/dev/t1 & cd /home/u/code && git -C "$D" checkout main`, `D=C:/Users/u/nod/dev/t1 & cd C:/code && git -C "$D" checkout main`],
  ])("bloqueante 1: a variável do subshell, do pipe ou do fundo não vale fora dele: %s", (l, w) => {
    expect(lin(l)).not.toBeNull();
    expect(wi(w)).not.toBeNull();
  });
  it("bloqueante 1: a variável de antes do subshell e a de dentro dele seguem valendo", () => {
    expect(lin(`D=/home/u/nod/dev/t1/x; (cd /home/u/code); git -C "$D" checkout main`)).toBeNull();
    expect(lin(`cd /home/u/code; (D=/home/u/nod/dev/t1 && git -C "$D" checkout main)`)).toBeNull();
  });
  it.each([
    `(cd C:/code && a=(1 2) && git checkout main)`,
    `(cd /c/code; arr=(x); git reset --hard)`,
    `(cd C:/code; x=@(1,2); git checkout main)`,
  ])("alto 2: o ) do array não fecha o subshell: %s", (comando) => {
    expect(wi(comando)).not.toBeNull();
  });
  it("alto 2: o subshell depois de um array fecha no lugar certo", () => {
    expect(lin(`a=(1 2); (cd /home/u/code && git status); git checkout main`)).toBeNull();
  });
  it.each([
    `(cd C:/code # volta)\ngit checkout main)`,
    `true # ; D=C:/Users/u/nod/dev/t1\ncd C:/code && git -C "$D" checkout main`,
    `cd C:/code # && cd C:/Users/u/nod/dev/t1\ngit checkout main`,
  ])("médio 3: comentário com comando nega: %s", (comando) => {
    expect(wi(comando)).not.toBeNull();
    expect(lin(comando.replaceAll("C:/Users/u", "/home/u").replaceAll("C:/code", "/home/u/code"))).not.toBeNull();
  });
  it.each([`git status # só olha`, `git commit -m "fix #12 (x)" && git push`, "echo ${#a}; git commit -am x"])("médio 3: comentário sem comando e # no meio seguem livres: %s", (comando) => {
    expect(lin(comando)).toBeNull();
    // ADA-11 (subconjunto do win32): só a forma simples segue livre no Windows; o resto nega.
    expect(wi(comando) === null).toBe(["git commit -m \"fix #12 (x)\" && git push"].includes(comando));
  });
});

describe("cerca do git: revisão 24 do PR #642", () => {
  const B = "/home/u/nod/dev/t1";
  const lin = (comando: string, cwd = B) => gitForaDaPastaDoBot(comando, { cwd, pastaDoBot: B, home: "/home/u", windows: false });
  const WB = "C:\\Users\\u\\nod\\dev\\t1";
  const wi = (comando: string, cwd = WB) => gitForaDaPastaDoBot(comando, { cwd, pastaDoBot: WB, home: "C:\\Users\\u", windows: true });
  it.each([
    "git -C ~/code/x \\\n  checkout main",
    "cd ~/code/x && \\\ngit checkout main",
    "cd ~/code/x && git \\\n  checkout main",
    "git \\\n  -C ~/code/x checkout main",
  ])("alto 1: a \\ com a quebra de linha só continua a linha: %j", (comando) => {
    expect(lin(comando)).not.toBeNull();
    expect(wi(comando)).not.toBeNull();
  });
  it("alto 1: dentro do bash -c do win32 (no POSIX o bash -c é lacuna da ADR-147)", () => {
    expect(wi("bash -c 'git -C ~/code/x \\\n checkout main'")).not.toBeNull();
  });
  it("alto 1: a continuação dentro da pasta do bot segue livre", () => {
    expect(lin("git add -A && \\\n  git commit -m \"x \\\ny\"")).toBeNull();
  });
  it.each([
    `git -C ~/code/x -c core.fsmonitor='git checkout -q outra; true #' status`,
    `git -C ~/code/x -c core.hooksPath=/tmp status`,
    `git -c core.sshCommand=x -C ~/code/x fetch`,
    `git -C ~/code/x -c diff.external=x diff`,
  ])("médio 2: -c que roda programa no repositório de fora nega: %s", (comando) => {
    expect(lin(comando)).not.toBeNull();
    expect(wi(comando)).not.toBeNull();
  });
  it("médio 2: o -c que roda programa na pasta do bot segue livre", () => {
    expect(lin(`git -c core.pager=cat log -1`)).toBeNull();
    expect(lin(`git -c core.hooksPath=/dev/null commit -m x`)).toBeNull();
  });
  it.each([
    `env git -C ~/code/x checkout main`,
    `nohup git -C ~/code/x checkout main`,
    `timeout 5 git -C ~/code/x checkout main`,
    `exec git -C ~/code/x checkout main`,
    `exec -a x git -C ~/code/x checkout main`,
    `command cd ~/code/x && git checkout main`,
    `sudo git -C ~/code/x checkout main`,
    `sudo -u bob git -C ~/code/x checkout main`,
    `sudo -D ~/code/x git checkout main`,
    `doas git -C ~/code/x checkout main`,
    `cd -- ~/code/x && git checkout main`,
    `cd -L ~/code/x && git checkout main`,
    `cd -e ~/code/x && git checkout main`,
  ])("médio 3: prefixos e opções do cd também no POSIX: %s", (comando) => {
    expect(lin(comando)).not.toBeNull();
    expect(wi(comando)).not.toBeNull();
  });
  it.each([`env FOO=1 git commit -am x`, `timeout 60 git push`, `cd -- sub && git commit -am x`, `command -v git && git status`])("médio 3: prefixo na pasta do bot segue livre: %s", (comando) => {
    expect(lin(comando)).toBeNull();
  });
});

describe("cerca do git: revisão 25 do PR #642", () => {
  const B = "/home/u/nod/bot/task1";
  const lin = (comando: string, cwd = `${B}/repo`) => gitForaDaPastaDoBot(comando, { cwd, pastaDoBot: B, home: "/home/u", windows: false });
  const WB = "C:\\Users\\u\\nod\\bot\\task1";
  const wi = (comando: string, cwd = `${WB}\\repo`) => gitForaDaPastaDoBot(comando, { cwd, pastaDoBot: WB, home: "C:\\Users\\u", windows: true });
  it.each([
    "# check git status\ngit status\ngit add -A\ngit commit -m x",
    "# Commit (sem push)\ngit commit -m x",
    "# 1) testes\nnpm test\ngit add -A",
    "git commit -m x # fix; done",
    "git commit -F - <<'EOF'\nfeat: x\n\n# Notas (importante)\nEOF",
    "gh pr create --title x --body-file - <<'EOF'\n## Summary\n- corrige (#12)\nEOF",
  ])("médio 1: comentário comum na pasta do bot segue livre: %j", (comando) => {
    expect(lin(comando)).toBeNull();
    expect(wi(comando)).not.toBeNull();
  });
  it("médio 1: o apóstrofo no comentário não quebra a leitura no POSIX (no win32 nega, falha fechada)", () => {
    expect(lin("# don't push yet\ngit commit -am x")).toBeNull();
  });
  it.each([
    "(cd /home/u/code # volta)\ngit checkout main)",
    "true # ; D=/home/u/nod/bot/task1\ncd /home/u/code && git -C \"$D\" checkout main",
    "cd /home/u/code # && cd /home/u/nod/bot/task1\ngit checkout main",
  ])("médio 1: o comentário não esconde a troca de pasta: %j", (comando) => {
    expect(lin(comando)).not.toBeNull();
  });
  it.each([
    `git -c protocol.version=2 fetch origin`,
    `git -c pager.diff=false diff`,
    `git -c credential.helper= fetch`,
    `git -c core.pager=cat log`,
    `git -C ~/code/acme -c core.pager=cat log -5`,
  ])("baixo 1: -c que não roda programa no clone da pessoa segue livre: %s", (comando) => {
    expect(lin(comando, "/home/u/code/acme")).toBeNull();
  });
  it("baixo 1: o pager de verdade fora da pasta do bot continua negando", () => {
    expect(lin(`git -C ~/code/acme -c core.pager='git checkout main' log`, "/home/u/code/acme")).not.toBeNull();
  });
  it("baixo 2: nice -10 git commit na pasta do bot segue livre", () => {
    expect(lin(`nice -10 git commit -m x`)).toBeNull();
    expect(lin(`nice -10 git -C ~/code/acme checkout main`)).not.toBeNull();
  });
});

describe("cerca do git: revisão 26 do PR #642", () => {
  const B = "/home/u/nod/bot/task1";
  const lin = (comando: string, cwd = `${B}/repo`) => gitForaDaPastaDoBot(comando, { cwd, pastaDoBot: B, home: "/home/u", windows: false });
  const WB = "C:\\Users\\u\\nod\\bot\\task1";
  const wi = (comando: string, cwd = `${WB}\\repo`) => gitForaDaPastaDoBot(comando, { cwd, pastaDoBot: WB, home: "C:\\Users\\u", windows: true });
  it("alto 1: o # depois do \\r solto não é comentário (no bash o \\r é parte da palavra)", () => {
    expect(lin("true\r# ; cd /home/u/code && git checkout main")).not.toBeNull();
    expect(wi("true\r# ; git -C C:\\Users\\u\\code checkout main")).not.toBeNull();
  });
  it.each([
    `powershell -Command "<# x #> git -C C:\\Users\\u\\code checkout main"`,
    `pwsh -c "<#x#>git -C C:/Users/u/code checkout main"`,
    `<#x#> git -C C:/Users/u/code checkout main`,
    "# x\rgit -C C:\\Users\\u\\code checkout main",
  ])("alto 2: o comentário de bloco do PowerShell e o \\r que acaba a linha não escondem o git: %j", (comando) => {
    expect(wi(comando)).not.toBeNull();
  });
  it("alto 2: o comentário com \\r\\n na pasta do bot segue livre", () => {
    expect(lin("# Commit (sem push)\r\ngit commit -m x")).toBeNull();
    expect(wi("# Commit (sem push)\r\ngit commit -m x")).not.toBeNull();
  });
  it("baixo: protocol.*.allow (o ext:: roda programa) fora da pasta do bot nega; protocol.version segue livre", () => {
    expect(lin(`git -C ~/code/acme -c protocol.ext.allow=always ls-remote 'ext::sh -c touch% x'`, "/home/u/code/acme")).not.toBeNull();
    expect(lin(`git -c protocol.version=2 fetch origin`, "/home/u/code/acme")).toBeNull();
  });
});

describe("cerca do git: revisão 27 do PR #642", () => {
  const B = "/home/u/nod/bot/task1";
  const lin = (comando: string, cwd = `${B}/repo`) => gitForaDaPastaDoBot(comando, { cwd, pastaDoBot: B, home: "/home/u", windows: false });
  const WB = "C:\\Users\\u\\nod\\bot\\task1";
  const wi = (comando: string, cwd = `${WB}\\repo`) => gitForaDaPastaDoBot(comando, { cwd, pastaDoBot: WB, home: "C:\\Users\\u", windows: true });
  it("bloqueante: a \\ antes do \\r\\n não continua a linha (no bash ela escapa o \\r e o \\n acaba o comando)", () => {
    expect(lin("cd ~/code/x && true \\\r\ngit checkout main")).not.toBeNull();
    expect(wi("cd ~/code/x && true \\\r\ngit checkout main")).not.toBeNull();
  });
  it("baixo: o # logo depois do ) também comenta", () => {
    expect(lin(`cd ~/code/x && (true)# ; cd ${B} || exit 1\ngit checkout main`)).not.toBeNull();
  });
  it("baixo: o \\r solto num comentário (acaba a linha no PowerShell, não no bash) falha fechada", () => {
    expect(lin(`cd ~/code/x # \rcd ${B} || exit 1\ngit checkout main`)).not.toBeNull();
    expect(wi(`cd ~/code/x # \rcd ${WB} || exit 1\ngit checkout main`)).not.toBeNull();
  });
  it("baixo: o -p do time não é o programa", () => {
    expect(lin("time -p git -C ~/code/x checkout main")).not.toBeNull();
    expect(lin("time -p git status")).toBeNull();
  });
});

describe("ADA-11: a cerca do win32 falha fechada fora do subconjunto simples", () => {
  const WB = "C:\\Users\\u\\nod\\bot\\task1";
  const wi = (comando: string, cwd = `${WB}\\repo`) => gitForaDaPastaDoBot(comando, { cwd, pastaDoBot: WB, home: "C:\\Users\\u", windows: true });
  // Uma por classe achada nas revisões 14 a 27 do PR #642, todas dentro da pasta do bot (onde antes passavam ou dependiam do parser).
  it.each([
    ["\\r solto (R26)", "true\r# ; git checkout main"],
    ["\\r\\n (R26/R27)", "git status\r\ngit checkout main"],
    ["quebra de linha", "git status\ngit checkout main"],
    ["continuação de linha (R24/R27)", "git -C C:/Users/u/code \\\r\n checkout main"],
    ["comentário # (R23/R25)", "git status # ; git checkout main"],
    ["comentário <# #> do PowerShell (R26)", "<#x#> git -C C:/Users/u/code checkout main"],
    ["subshell (R19/R23)", "(cd C:/Users/u/code) ; git checkout main"],
    ["array do PowerShell (R23)", "x=@(1,2); git checkout main"],
    ["bloco { } (R8)", "if (1) { git checkout main }"],
    ["$ e substituição (R8)", "git -C $HOME/code checkout main"],
    ["$( ) (R8)", "git -C $(pwd) checkout main"],
    ["crase do PowerShell (R8)", "git -C C:/Users/u/code` checkout main"],
    ["%VAR% do cmd (R2)", "git -C %USERPROFILE%\\code checkout main"],
    ["^ do cmd (R10)", "g^it -C C:/Users/u/code checkout main"],
    ["! do cmd com /v (R11)", "cmd /v:on /c git status"],
    ["pipe (R6/R8)", "git ls-files | xargs git checkout --"],
    ["redirecionamento (R3)", "git status > x.txt"],
    ["heredoc (R3/R18)", "git commit -F - <<'EOF'\nx\nEOF"],
    ["& sozinho (R21)", "git status & git checkout main"],
    ["bash -c (R4/R7)", "bash -c 'git checkout main'"],
    ["powershell -c (R8/R13)", "powershell -c \"git checkout main\""],
    ["pwsh -EncodedCommand (R2)", "pwsh -EncodedCommand ZwBpAHQA"],
    ["cmd /c (R10/R13)", "cmd /c git checkout main"],
    ["wsl (R2)", "wsl git checkout main"],
    ["env (R7)", "env -S \"git checkout main\""],
    ["iex (R2)", "iex 'git checkout main'"],
    ["Start-Process (R2)", "Start-Process git -ArgumentList checkout"],
    ["& do PowerShell com aspas (R11)", "& 'git' checkout main"],
    ["programa entre aspas", "\"git\" checkout main"],
    ["@ no começo da palavra (R13)", "@git checkout main"],
    ["aspas sem fechar", "git commit -m \"x"],
    ["aspas coladas em aspas (PowerShell lê '' como ')", "git -C 'C:\\Users\\u\\code''x' checkout main"],
    ["\\ antes de aspas (bash e PowerShell leem diferente)", "git commit -m \"x\\\" && git checkout main\""],
    ["\\ que escapa espaço", "git -C C:/x\\ y checkout main"],
    ["git escondido por aspas no meio (R27)", "g''it -C C:/Users/u/code checkout main"],
  ])("nega %s", (_classe, comando) => {
    expect(foraDoSubconjuntoDoWindows(comando)).not.toBeNull();
    expect(wi(comando)).toMatch(/forma simples/);
  });
  it.each([
    "git status",
    "git -C C:/Users/u/nod/bot/task1/repo commit -m \"fix (parser): x #12\"",
    `git -C C:\\Users\\u\\code fetch origin && git -C C:\\Users\\u\\code worktree add "${WB}\\repo-x" -b frente/x origin/main`,
    "cd repo && git add -A && git commit -m 'feat: x' && git push -u origin HEAD",
    "git log --oneline -5; git diff --stat",
    "git commit -m \"linha 1\n\nlinha 2\"",
    "gh pr create --title \"ADA-11: x\" --body \"corpo | com pipe & e > no texto\"",
    "npm test",
    "npm test | tee saida.txt",
  ])("a forma simples segue livre na pasta do bot: %j", (comando) => {
    expect(wi(comando)).toBeNull();
  });
  it("fora da pasta do bot, a forma simples continua passando pela cerca de sempre", () => {
    expect(wi("git -C C:/Users/u/code checkout main")).toMatch(/mexeria em/);
    expect(wi("cd C:\\Users\\u\\code && git reset --hard")).not.toBeNull();
  });
});

describe("revisões 28 e 29 do PR #642: \\r solto e curinga no programa falham fechado", () => {
  const posix = (comando: string) => gitForaDaPastaDoBot(comando, { cwd: "/home/u/nod/ze", pastaDoBot: "/home/u/nod/ze", home: "/home/u" });
  it.each([
    "cd /tmp/x # nota\rok\ngit stash",
    "cd /tmp/x # nota\rok\ngit add -A",
  ])("o \\r solto com git no POSIX nega: %j", (c) => {
    expect(posix(c)).toMatch(/\\r solto/);
  });
  it.each([
    "/usr/bin/gi? -C /home/u/code checkout main",
    "/usr/bin/g*t -C /home/u/code checkout main",
    "/usr/bin/g[i]t -C /home/u/code checkout main",
    "cd /tmp && sudo /usr/bin/gi? -C /home/u/code checkout main",
    "X=1 /usr/bin/g?t -C /home/u/code checkout main",
  ])("curinga no programa nega no POSIX: %j", (c) => {
    expect(posix(c)).toMatch(/curinga/);
  });
  it.each([
    "gi? -C C:/Users/Bia/code checkout main",
    "g*t -C C:/Users/Bia/code checkout main",
    "C:/Progra~1/Git/cmd/gi?.exe -C C:/Users/Bia/code checkout main",
  ])("curinga no programa nega no win32: %j", (c) => {
    expect(win(c)).toMatch(/curinga/);
  });
  it.each([
    "ls *.ts",
    "[ -f x ] && echo ok",
    "[[ -n x ]] && echo ok",
    'git commit -m "fix; *nota* [x]"',
    "npx vitest run tests/unit/*.test.ts",
    "cd /tmp/x && git status\r\n",
  ])("sem curinga no programa segue livre: %j", (c) => {
    expect(posix(c)).toBeNull();
  });
});

describe("revisão final do PR #642: curinga sem falso positivo e a entrada do subconjunto do win32", () => {
  const posix = (comando: string) => gitForaDaPastaDoBot(comando, { cwd: "/home/u/nod/ze", pastaDoBot: "/home/u/nod/ze", home: "/home/u" });
  const livres = [
    "echo $((3*4))",
    "x=$((i*2)); echo $x",
    "ls {src,tests}/*.ts",
    "cp src/{a,b}*.ts /tmp",
    'case "$f" in\n  *.ts) echo ts;;\n  *) echo outro;;\nesac',
    "cat <<'EOF' > notas.md\n* item\nEOF",
    "git commit -F - <<'EOF'\nfeat: x\n\n* item um\nEOF",
    "rm -f *",
    "git add src/*.ts",
  ];
  it.each(livres)("alto 1: comando comum segue livre no POSIX: %j", (c) => {
    expect(posix(c)).toBeNull();
  });
  it.each([
    "sudo -u x /usr/bin/g?t -C /home/u/code/outro reset --hard",
    "env -i /usr/bin/g?t -C /home/u/code/outro reset --hard",
    "timeout -s KILL 5 /usr/bin/g?t -C /home/u/code/outro reset --hard",
    "nice -n 5 /usr/bin/g*t -C /home/u/code/outro reset --hard",
    "exec -a x /usr/bin/gi[t] -C /home/u/code/outro reset --hard",
    "echo /home/u/code/outro | xargs -I{} /usr/bin/g?t -C {} reset --hard",
    "*",
  ])("médio: o curinga depois das opções do prefixo nega: %j", (c) => {
    expect(posix(c)).toMatch(/curinga/);
  });
  it.each([
    "g$(echo it) -C C:/Users/Bia/code/outro reset --hard",
    "g`echo it` -C C:/Users/Bia/code/outro reset --hard",
    "powershell -c '&(\"gi\"+\"t\") -C C:/Users/Bia/code/outro reset --hard'",
    "powershell -c '. (\"gi\"+\"t\") -C C:/Users/Bia/code/outro reset --hard'",
    'cmd //v:on //c "set x=gi&& !x!t -C C:/Users/Bia/code/outro reset --hard"',
    "eval g\\it -C C:/Users/Bia/code/outro reset --hard",
  ])("altos 2 a 4: nega no win32: %j", (c) => {
    expect(win(c)).not.toBeNull();
  });
  it.each(["npm test", "npm start", "ls *.ts", "git status"])("win32 livre: %j", (c) => {
    expect(win(c)).toBeNull();
  });
});

describe("confirmação da revisão final do PR #642: classe de curinga ilegível, montagem no PowerShell e no cmd", () => {
  const posix = (comando: string) => gitForaDaPastaDoBot(comando, { cwd: "/home/u/nod/ze", pastaDoBot: "/home/u/nod/ze", home: "/home/u" });
  it.each([
    "/usr/bin/g[[:alpha:]]t -C /home/u/code/outro reset --hard",
    "/usr/bin/g[!]]t -C /home/u/code/outro reset --hard",
    "/usr/bin/g[\\i]t -C /home/u/code/outro reset --hard",
    "/usr/bin/g[z-a]t -C /home/u/code/outro reset --hard",
    "shopt -s extglob; /usr/bin/g@(i)t -C /home/u/code/outro reset --hard",
    "cd /home/u/code/outro && {gi,rese}t --hard",
    "/usr/bin/g{i..i}t -C /home/u/code/outro reset --hard",
  ])("bloqueante: o curinga que a cerca não lê nega no POSIX: %j", (c) => {
    expect(posix(c)).toMatch(/curinga/);
  });
  it("o git picotado por aspas vazias também é lido no POSIX", () => {
    expect(posix("g''it -C /home/u/code/outro reset --hard")).not.toBeNull();
  });
  it.each([
    "/usr/bin/g[[:alpha:]]t -C C:/Users/Bia/code/outro reset --hard",
    "cd C:/Users/Bia/code/outro && {gi,rese}t --hard",
    "powershell -c \"$ExecutionContext.InvokeCommand.InvokeScript('gi'+'t -C C:/Users/Bia/code/outro reset --hard')\"",
    "powershell -c \"[Diagnostics.Process]::Start('gi'+'t','-C C:/Users/Bia/code/outro reset --hard')\"",
    'cmd /c "for %i in (gi) do %it -C C:/Users/Bia/code/outro reset --hard"',
    "powershell -c \"(New-Object -ComObject WScript.Shell).Run('gi'+'t -C C:/Users/Bia/code/outro reset --hard')\"",
  ])("alto: nega no win32: %j", (c) => {
    expect(win(c)).not.toBeNull();
  });
  it.each(["ls g*", "ls src/[a-z]*", "rm -f build/*.exe", "dir *.exe", "[[ $b == g* ]] && echo sim"])(
    "médio: o curinga de argumento de quem não executa segue livre no POSIX: %j",
    (c) => {
      expect(posix(c)).toBeNull();
    },
  );
  it.each(["find . -name g?t -exec g?t status \\;", "xargs g*t status"])("quem executa argumento segue checado: %j", (c) => {
    expect(posix(c)).toMatch(/curinga/);
  });
  it.each([
    "cat <(/usr/bin/g?t -C /home/u/code/outro reset --hard)",
    "diff <(/usr/bin/g?t -C /home/u/code/outro stash) x",
    "echo >(/usr/bin/g*t -C /home/u/code/outro reset --hard)",
    "cat <(git -C /home/u/code/outro reset --hard)",
    "cd /home/u/code/outro && rg --pre /usr/bin/g?t x stash",
  ])("segunda confirmação (alto): a substituição de processo e o rg --pre seguem checados: %j", (c) => {
    expect(posix(c)).not.toBeNull();
  });
  it("segunda confirmação (alto): no win32 também", () => {
    expect(win("cat <(/usr/bin/g?t -C C:/Users/Bia/code/outro reset --hard)")).not.toBeNull();
  });
  it.each(["tr [:upper:] [:lower:] < a.txt"])("segunda confirmação (médio): sem falso positivo no POSIX: %j", (c) => {
    expect(posix(c)).toBeNull();
  });
  it.each(['powershell -c "Invoke-WebRequest https://example.com -OutFile a.zip"', 'powershell -c "Invoke-RestMethod https://example.com"'])(
    "segunda confirmação (baixo): o download comum segue livre no win32: %j",
    (c) => {
      expect(win(c)).toBeNull();
    },
  );
  it("segunda confirmação (médio): heredocs com delimitadores distintos saem rápido", () => {
    let s = "";
    for (let i = 0; s.length < 100_000; i += 1) s += "cat <<A" + i.toString(36) + "\n";
    const inicio = Date.now();
    posix(s);
    win(s);
    // medido em 2026-11-04: linear, ~100 ms (posix+win) a 100 KB e ~200 ms a 200 KB numa máquina sem carga; no
    // runner do CI sob o unit inteiro em paralelo (collect 533 s) deu 1300 ms e estourou o teto antigo de 1 s
    // (run 41871672575, PR #646). O teste guarda contra a volta do custo quadrático (segundos a dezenas de
    // segundos com ~14 mil heredocs), então 3 s mantém ~30x de folga sobre o normal e ainda pega a regressão.
    expect(Date.now() - inicio).toBeLessThan(3_000);
  });
  it("desempenho: muitos `[` sem fecho e muitos heredocs sem fim saem rápido", () => {
    const inicio = Date.now();
    posix("npx " + "[".repeat(50_000));
    posix("cat <<EOF\n".repeat(20_000));
    win("cat <<EOF\n".repeat(20_000));
    expect(Date.now() - inicio).toBeLessThan(2_000);
  });
});

describe("QA do PR #642 (médios): lançadores no win32 e o git.cmd", () => {
  it.each([
    "conhost git -C C:/code checkout main",
    "conhost.exe git -C C:/code reset --hard",
    "wt -d C:/code git checkout main",
    'C:/PROGRA~1/Git/git-bash.exe -c "cd /c/code && git checkout main"',
    'mintty -e "bash" -c "cd /c/code && git checkout main"',
    "stdbuf -oL git -C C:/code checkout main",
    'find . -maxdepth 0 -exec git -C C:/code checkout main ";"',
    "node -e \"require('child_process').execSync('git -C C:/code checkout main')\"",
    'forfiles /p C:/code /m .git /c "git checkout main"',
    'schtasks /create /tn x /tr "git -C C:/code checkout main" /sc once /st 00:00',
    "git.cmd -C C:/code checkout main",
    "C:/PROGRA~1/Git/cmd/git.cmd -C C:/code reset --hard",
    "npm test && conhost gh repo delete x",
  ])("no win32 nega: %s", (c) => {
    expect(win(c)).not.toBeNull();
  });
  it("o git como programa do segmento, com git no texto ou .git no caminho, segue livre", () => {
    for (const c of ['git commit -m "fix: git no Windows"', "ls .gitignore && git add -A", "npm test && git status", "cat .git/HEAD"]) {
      expect(foraDoSubconjuntoDoWindows(c), c).toBeNull();
    }
  });
  it.each([
    String.raw`cd C:/Users/u/code ; $'\147it' reset --hard`,
    String.raw`cd C:/Users/u/code ; $'\x67it' reset --hard`,
    String.raw`cd C:/Users/u/code ; $'\147'it clean -fdx`,
    "printf -v a g; printf -v b it; cd C:/Users/u/code; $a$b reset --hard",
    String.raw`cd C:/Users/u/code; /mingw64/bin/$'\147it' reset --hard`,
    "printf -v x git; cd C:/Users/u/code; $x reset --hard",
    "printf -v x git; X=1 $x -C C:/Users/u/code reset --hard",
    "printf -v x git; nohup $x -C C:/Users/u/code reset --hard",
    'printf -v x git; find . -maxdepth 0 -exec $x -C C:/Users/u/code reset --hard ";"',
    "cd C:/Users/u/code; /mingw64/bin/$x reset --hard",
    // Sem o texto git em lugar nenhum: só a regra do embrulho e do -exec pega.
    "cd C:/Users/u/code; nohup $x reset --hard",
    'cd C:/Users/u/code; find . -maxdepth 0 -exec $x reset --hard ";"',
    "cd C:/Users/u/code; timeout 5 $x reset --hard",
    "node -e $x",
    // O $'…' depois de um lançador fora da lista (xargs): só o regex do $' pega.
    String.raw`cd C:/Users/u/code ; xargs $'\147it' reset --hard`,
  ])("QA do PR #642 (alto): o git montado por variável, sem o texto git, nega no win32: %s", (c) => {
    expect(win(c)).not.toBeNull();
  });
  it("o $ num argumento comum ou entre aspas não faz o comando sem git entrar no subconjunto", () => {
    for (const c of ["cd $HOME/x && ls", 'echo "$PATH"', "ls $TMP", "npm test -- $ARQ"]) {
      expect(foraDoSubconjuntoDoWindows(c), c).toBeNull();
    }
  });
  it("o \\r e a \\ antes de aspas negam no subconjunto (mutantes M6 e M8 do QA)", () => {
    expect(foraDoSubconjuntoDoWindows("git status\r")).toMatch(/\\r/);
    expect(foraDoSubconjuntoDoWindows('git commit -m "a\\"b"')).toMatch(/antes de aspas/);
    expect(foraDoSubconjuntoDoWindows('git commit -m "a\\"')).toMatch(/antes de aspas/);
  });
  it("o nome do programa reconhece o git.cmd e o gh.cmd em qualquer caixa", () => {
    expect(nomeDoPrograma("Git.Cmd", true)).toBe("git");
    expect(nomeDoPrograma("C:\\Program Files\\GitHub CLI\\gh.CMD", true)).toBe("gh");
  });
});
