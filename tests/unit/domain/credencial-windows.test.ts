import { describe, expect, it } from "vitest";
import { comoOBashLe, qualCredencial, tocaChaveDoNod, tocaCredencial } from "../../../src/domain/comando.ts";

// ADA-11 (revisão do PR #642, alto 2): caminhos do Windows vêm com `\` e sem caixa; a guarda de credencial e a da chave
// do nod têm de pegá-los como pegam os de `/`.
describe("guarda de credencial com caminhos do Windows", () => {
  const credenciais: readonly (readonly [string, string])[] = [
    ["C:\\Users\\bia\\.aws\\credentials", "as credenciais da AWS"],
    ["C:\\Users\\bia\\.AWS\\credentials", "as credenciais da AWS"],
    ["C:\\Users\\bia\\.ssh\\config", "uma chave SSH"],
    ["C:\\Users\\bia\\.config\\gh\\hosts.yml", "o token do GitHub"],
    ["C:\\Users\\bia\\.claude\\.credentials.json", "o login do Claude"],
    ["C:\\Users\\bia\\.codex\\auth.json", "o login do Codex"],
    ["type C:\\Users\\bia\\.git-credentials", "uma credencial"],
    ["C:\\Users\\bia\\AppData\\Roaming\\GitHub CLI\\hosts.yml", "o token do GitHub"],
    ["type \"%APPDATA%\\GitHub CLI\\hosts.yml\"", "o token do GitHub"],
    ["Get-Content $env:USERPROFILE\\.docker\\config.json", "o login do Docker"],
  ];
  for (const [texto, nome] of credenciais) {
    it(`pega ${texto}`, () => {
      expect(tocaCredencial(texto)).toBe(true);
      expect(qualCredencial(texto)).toBe(nome);
    });
  }

  const chaves = [
    "C:\\Users\\bia\\AppData\\Roaming\\nod-motor\\conexao.json",
    "C:\\Users\\bia\\AppData\\Roaming\\nod-motor",
    "c:/users/bia/appdata/roaming/NOD-MOTOR/x.json",
    "dir %APPDATA%\\nod-motor",
    "Get-ChildItem $env:APPDATA\\nod-motor\\",
    "C:\\Users\\bia\\.config\\nod-motor\\conexao.json",
  ];
  for (const texto of chaves) {
    it(`a chave do nod em ${texto} nunca é leitura livre`, () => {
      expect(tocaChaveDoNod(texto)).toBe(true);
      expect(tocaCredencial(texto)).toBe(true);
      expect(qualCredencial(texto)).toBe("a chave do nod nesta máquina");
    });
  }

  it("não pega o que não é credencial", () => {
    for (const t of ["C:\\Users\\bia\\nod\\ze\\repo\\src\\index.ts", "C:\\Users\\bia\\AppData\\Local\\Temp\\x.txt", "git status", "Get-ChildItem C:\\Projetos"]) {
      expect(tocaCredencial(t)).toBe(false);
      expect(tocaChaveDoNod(t)).toBe(false);
    }
  });
});

describe("guarda de credencial com o $APPDATA do Git Bash (revisão 2 do PR #642, médio 5)", () => {
  const casos: readonly (readonly [string, string])[] = [
    ['cat "$APPDATA/GitHub CLI/hosts.yml"', "o token do GitHub"],
    ['cat "${APPDATA}/GitHub CLI/hosts.yml"', "o token do GitHub"],
    ['Get-Content "${env:APPDATA}\\GitHub CLI\\hosts.yml"', "o token do GitHub"],
    ['cp -r "$APPDATA/nod-motor" .', "a chave do nod nesta máquina"],
    ['tar czf x.tgz "${APPDATA}/nod-motor/"', "a chave do nod nesta máquina"],
  ];
  for (const [texto, nome] of casos) {
    it(`pega ${texto}`, () => {
      expect(tocaCredencial(texto)).toBe(true);
      expect(qualCredencial(texto)).toBe(nome);
    });
  }
});

describe("guarda de credencial: cofres e escapes do Windows (revisão 3 do PR #642, médio 4)", () => {
  const casos: readonly (readonly [string, string])[] = [
    ["cat /c/Users/bia/AppData/Roaming/GitHub\\ CLI/hosts.yml", "o token do GitHub"],
    ["gc $env:APPDATA\\GitHub` CLI\\hosts.yml", "o token do GitHub"],
    ["printf 'host=github.com\\n' | git credential fill", "o token do Git"],
    ["git credential-manager get", "o token do Git"],
    ["git credential-manager.exe get", "o token do Git"],
    ["cmdkey /list", "o cofre de credenciais do Windows"],
    ["Get-StoredCredential -Target git:https://github.com", "o cofre de credenciais do Windows"],
    ["dir %APPDATA%\\Microsoft\\Protect", "o cofre de credenciais do Windows"],
    ["dir $env:LOCALAPPDATA\\Microsoft\\Credentials", "o cofre de credenciais do Windows"],
  ];
  for (const [texto, nome] of casos) {
    it(`pega ${texto}`, () => {
      expect(tocaCredencial(texto)).toBe(true);
      expect(qualCredencial(texto)).toBe(nome);
    });
  }
  it("não pega o que só parece", () => {
    for (const t of ["git config credential.helper", "echo `date`", "git commit -m \"Start Windows\""]) expect(tocaCredencial(t)).toBe(false);
  });
});

describe("guarda de credencial: formas do Windows da revisão 7 do PR #642 (médio 14)", () => {
  const casos: readonly (readonly [string, string])[] = [
    ["git -c credential.helper= credential fill", "o token do Git"],
    ['"C:\\Program Files\\Git\\mingw64\\bin\\git-credential-manager.exe" get', "o token do Git"],
    ["type %APPDATA%\\GITHUB~1\\hosts.yml", "o token do GitHub"],
    ["type %USERPROFILE%\\AWS~1\\credentials", "uma credencial"],
  ];
  for (const [texto, nome] of casos) {
    it(`pega ${texto}`, () => {
      expect(tocaCredencial(texto)).toBe(true);
      expect(qualCredencial(texto)).toBe(nome);
    });
  }
  it("o nome curto da pasta do motor é a chave do nod", () => {
    expect(tocaChaveDoNod("type %APPDATA%\\NOD-MO~1\\conexao.json")).toBe(true);
    expect(tocaChaveDoNod("type C:\\Users\\bia\\AppData\\Roaming\\NOD-MO~1\\x")).toBe(true);
  });
  it("não pega o que só parece", () => {
    for (const t of ["git -c core.pager= log", "git config credential.helper", "dir PROGRA~1"]) expect(tocaCredencial(t)).toBe(false);
  });
});

describe("guarda de credencial: revisão 8 do PR #642 (médio 4 e baixos 1-2)", () => {
  it.each([
    [`cat "$APPDATA"/GitHub\\ CLI/hosts.yml`, "o token do GitHub"],
    [`cat ~/AppData/Roaming/GitHub*/hosts.yml`, "o token do GitHub"],
    [`powershell -c "gc $env:APPDATA\\'GitHub CLI'\\hosts.yml"`, "o token do GitHub"],
    [`cat "$LOCALAPPDATA/../Roaming/GitHub CLI/hosts.yml"`, "o token do GitHub"],
    [`ls "$APPDATA"/nod-motor`, "a chave do nod nesta máquina"],
    [`type %USERPROFILE%\\.claude\\.CREDE~1.JSO`, null],
    [`cat ~/GITCRE~1`, null],
    [`dir %USERPROFILE%\\CLAUDE~1`, null],
    [`git credential-wincred get`, null],
    [`powershell -c "New-Object Windows.Security.Credentials.PasswordVault"`, null],
  ])("pega %s", (comando, nome) => {
    expect(tocaCredencial(comando)).toBe(true);
    if (nome) expect(qualCredencial(comando)).toBe(nome);
  });
  it("a chave do nod também sai pelo tocaChaveDoNod com aspas no caminho", () => {
    expect(tocaChaveDoNod(`ls "$APPDATA"/nod-motor`)).toBe(true);
    expect(tocaChaveDoNod(`cat "$APPDATA"/GitHub\\ CLI/hosts.yml`)).toBe(false);
  });
  it.each([
    `git commit -m "fix: 'aspas' no texto"`,
    `cat "$APPDATA"/Code/User/settings.json`,
    `ls ~/AppData/Roaming/npm`,
  ])("não pega %s", (comando) => {
    expect(tocaCredencial(comando)).toBe(false);
  });
});

describe("guarda de credencial: revisão 9 do PR #642", () => {
  it.each([
    `Get-Content (Join-Path $env:APPDATA 'GitHub CLI' 'hosts.yml')`,
    `cd $env:APPDATA; gc 'GitHub CLI\\hosts.yml'`,
    `cat "GitHub CLI/hosts.yml"`,
  ])("pega o login do gh no Windows: %s (médio 1)", (comando) => {
    expect(qualCredencial(comando)).toBe("o token do GitHub");
  });
  it.each([
    `grep -rn "\\.aws" src`,
    `rg '\\.ssh' docs`,
    `grep -rn "\\.config/nod-motor" src`,
  ])("o escape de regex não é pasta: %s (médio 2)", (comando) => {
    expect(tocaCredencial(comando)).toBe(false);
    expect(tocaChaveDoNod(comando)).toBe(false);
  });
  it.each([
    `type C:\\Users\\bia\\.aws\\credentials`,
    `type %USERPROFILE%\\.ssh\\id_ed25519`,
  ])("a pasta do Windows continua pega: %s", (comando) => {
    expect(tocaCredencial(comando)).toBe(true);
  });
});

describe("guarda de credencial: revisão 10 do PR #642", () => {
  it.each([
    [`type C:\\Users\\bia\\.aws.\\credentials`, true],
    [`type C:\\Users\\bia\\.claude\\.credentials.json::$DATA`, true],
    [`cat ~/.aws./credentials`, false],
    [`cat ~/.claude/.credentials.json::$DATA`, false],
  ])("ponto no fim e ADS no Windows: %s (alto 2)", (comando, comCaraDeWindows) => {
    expect(tocaCredencial(comando, { windows: true })).toBe(true);
    if (comCaraDeWindows) expect(tocaCredencial(comando)).toBe(true);
  });
  it("a `\\` depois de $HOME no Join-Path é pasta (alto 3)", () => {
    expect(tocaCredencial(`powershell -c 'gc (Join-Path $HOME "\\.aws\\credentials")'`)).toBe(true);
  });
  it.each([`cat ~/.config/nod-motor*/c*`, `cat $APPDATA/nod?motor/c*`])("glob na chave do nod: %s (médio 3)", (comando) => {
    expect(tocaChaveDoNod(comando)).toBe(true);
  });
  it("o _netrc do Windows (médio 4)", () => {
    expect(tocaCredencial(`cat ~/_netrc`)).toBe(true);
  });
  it.each([
    `rg "cmdkey" src`,
    `grep -n "git credential fill" docs/*.md`,
    `git commit -m "nao usa git credential fill"`,
    `cat docs/PasswordVault.md`,
    `git log --grep="GitHub CLI hosts.yml"`,
    `echo "Use ~/.SSH"`,
    `sed -i 's/\\.Aws/x/' f`,
    `ls Microsoft/Credentials`,
    `grep -rn 'id_RSA' .`,
    `find . -name "*.KEY"`,
    `echo $HOME/.Npmrc`,
  ])("no Linux não pega o que só cita: %s (médio 1)", (comando) => {
    expect(tocaCredencial(comando)).toBe(false);
  });
  it.each([`echo "Use ~/.SSH"`, `cat ~/.AWS/credentials`, `ls Microsoft/Credentials`])("no Windows a caixa não importa: %s", (comando) => {
    expect(tocaCredencial(comando, { windows: true })).toBe(true);
  });
});

describe("guarda de credencial: revisão 11 do PR #642", () => {
  it.each([`rg "config\\.aws" src`, `grep -rn "settings\\.ssh" src`, `sed -i 's/cfg\\.kube/cfg.k8s/' src/a.ts`, `rg -n "this\\.npmrc" .`])(
    "o escape de regex no meio da palavra não é cara de Windows: %s (médio 1)",
    (comando) => {
      expect(tocaCredencial(comando)).toBe(false);
    },
  );
  it.each([`gc ~\\.claude\\CREDEN~1.JSO`, `gc ~\\GIT-CR~1`, `gc ~\\KUBE~1\\config`, `gc ~\\NPMRC~1`, `gc ~\\NETRC~1`])("o nome curto que o Windows gera: %s (médio 2)", (comando) => {
    expect(tocaCredencial(comando, { windows: true })).toBe(true);
  });
});

describe("guarda de credencial: revisão 12 do PR #642", () => {
  it.each([
    `rg "\\.aws\\b" src`,
    `grep -E "config\\.aws\\b" src`,
    `rg "\\.ssh\\b" src`,
    `grep -rn "\\.npmrc\\b" .`,
    `sed -i 's/\\.kube\\//X/' a.txt`,
    `printf "ok\\n"; ls ~/.Kube`,
    `rg -n "foo\\d+" src && rg cmdkey docs`,
  ])("a `\\` de regex no Linux não liga as formas do Windows: %s (alto A)", (comando) => {
    expect(tocaCredencial(comando)).toBe(false);
  });
  it("nem a chave do nod com `\\b` (alto A)", () => {
    expect(tocaChaveDoNod(`rg "\\.config/nod-motor\\b" src`)).toBe(false);
  });
  it.each([
    `type C:\\Users\\bia\\.aws::$INDEX_ALLOCATION\\credentials`,
    `type C:\\Users\\bia\\.aws:$I30:$INDEX_ALLOCATION\\credentials`,
    `type C:\\Users\\bia\\.ssh::$INDEX_ALLOCATION\\id_ed25519`,
  ])("o fluxo do NTFS no meio do caminho: %s (alto B)", (comando) => {
    expect(tocaCredencial(comando)).toBe(true);
  });
  it("o fluxo no meio do caminho da chave do nod (alto B)", () => {
    expect(tocaChaveDoNod(`gc "$env:APPDATA\\nod-motor::$INDEX_ALLOCATION\\conexao.json"`)).toBe(true);
  });
});

describe("revisão 13 do PR #642: o ^ do cmd e as pistas fortes de Windows", () => {
  it.each([
    `cmd //c "type %USERPROFILE%\\.a^ws\\credentials"`,
    `cmd //c "type %USERPROFILE%\\.ss^h\\id_ed2^5519"`,
    `cmd //c "type %APPDATA%\\GitHub^ CLI\\hosts.yml"`,
    `cmd //c "^cmdkey /list"`,
  ])("o ^ do cmd não esconde a credencial (médio 1): %s", (comando) => {
    expect(tocaCredencial(comando, { windows: true })).toBe(true);
    expect(tocaCredencial(comando)).toBe(true);
  });
  it.each([
    `git log --format=%H%n -5 && rg "\\.aws\\b" src`,
    `file dist/app.exe && grep -rn "\\.ssh\\b" src`,
    `rg -n "cmdkey\\.exe" src`,
    `rg "AppData" docs && rg -n "Microsoft/Credentials" src`,
    `rg -n "GITHUB~1" src`,
  ])("no Linux, texto de busca não é credencial (médio 3): %s", (comando) => {
    expect(tocaCredencial(comando)).toBe(false);
  });
  it.each(["ls ~/.config/*", "du -sh ~/.config/*", "ls ~/.config/[a-z]*"])("o glob sem letra em ~/.config não é a chave do nod (médio 2): %s", (comando) => {
    expect(tocaChaveDoNod(comando)).toBe(false);
  });
  it.each(["cp -r ~/.config/n* /tmp/bk", "cat ~/.config/nod?motor/conexao.json", "ls ~/.config/nod-m*"])("o glob que mira o nome continua a chave: %s", (comando) => {
    expect(tocaChaveDoNod(comando)).toBe(true);
  });
  it.each([
    `cat "$APPDATA/GITHUB~1/hosts.yml"`,
    `cat $APPDATA/GitHub\\ CLI/hosts.yml`,
    `"C:\\Program Files\\Git\\bin\\git.exe" credential fill`,
  ])("as pistas fortes continuam: %s", (comando) => {
    expect(tocaCredencial(comando)).toBe(true);
  });
});

// Revisão 14 do PR #642 (M2): a `\` de escape do bash (o Git Bash no win32) e as aspas no meio do nome não furam a guarda.
describe("guarda de credencial: revisão 14 do PR #642 (M2)", () => {
  it.each([
    "cat ~/.a\\ws/credentials",
    "cat ~/.aw\\s/credentials",
    "cat ~/.claude/.credentials.j\\son",
    "g\\it credential fill",
    "git credential fil\\l",
    `cat ~/.a"w"s/credentials`,
    `cat ~/'.aws'/credentials`,
  ])("pega nas duas plataformas: %s", (comando) => {
    expect(tocaCredencial(comando, { windows: true })).toBe(true);
    expect(tocaCredencial(comando)).toBe(true);
  });
  it.each([`grep -rn "\\.aws" src`, `rg '\\.ssh' docs`, `printf "ok\\n"`, `echo a\\*b`])("a `\\` de regex dentro das aspas continua texto no Linux: %s", (comando) => {
    expect(tocaCredencial(comando)).toBe(false);
  });
  it("comoOBashLe segue as regras de aspas do bash", () => {
    expect(comoOBashLe("a\\ws")).toBe("aws");
    expect(comoOBashLe(`"a\\.b"`)).toBe("a\\.b");
    expect(comoOBashLe(`'a\\b'`)).toBe("a\\b");
    expect(comoOBashLe(`"a\\"b"`)).toBe(`a"b`);
    expect(comoOBashLe(`x"y"'z'`)).toBe("xyz");
  });
});

// Revisão 17 do PR #642 (médio 2): o gh do Windows chamado pelo nome com extensão ou pelo caminho inteiro.
describe("gh auth token com o executável do Windows", () => {
  it.each([`gh.exe auth token`, `GH.EXE auth token`, `gh.cmd auth token`, `& 'C:\\Program Files\\GitHub CLI\\gh.exe' auth token`, `C:/Program\\ Files/GitHub\\ CLI/gh.exe auth token`, `"C:\\x\\gh.exe" auth token`])(
    "pega %s",
    (comando) => {
      expect(tocaCredencial(comando, { windows: true })).toBe(true);
      expect(tocaCredencial(comando)).toBe(true);
      expect(qualCredencial(comando)).toBe("o token do GitHub");
    },
  );
  it("gh auth status segue livre", () => {
    expect(tocaCredencial(`gh.exe auth status`, { windows: true })).toBe(false);
  });
});

// Revisão 20 do PR #642 (médio 4): os outros helpers do git que imprimem o token.
describe("git credential-<helper> get", () => {
  it.each([`printf "protocol=https\\nhost=github.com\\n" | git credential-store get`, `echo host=github.com | git credential-cache get`, `git-credential-libsecret get`, `git credential-osxkeychain get`])(
    "pega %s",
    (comando) => {
      expect(tocaCredencial(comando)).toBe(true);
      expect(tocaCredencial(comando, { windows: true })).toBe(true);
    },
  );
  it("git credential-cache exit segue livre", () => {
    expect(tocaCredencial(`git credential-cache exit`)).toBe(false);
  });
});
