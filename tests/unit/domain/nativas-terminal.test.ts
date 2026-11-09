import { describe, expect, it } from "vitest";
import { tocaChaveDoNod, tocaCredencial } from "../../../src/domain/comando.ts";
import { decidirNativa, NATIVAS_DE_ARQUIVO, NATIVAS_DO_TERMINAL, nativasDoTurno, pastaDoBot } from "../../../src/domain/nativas.ts";

const decidir = (ferramenta: string, entrada: Record<string, unknown>) => decidirNativa({ ferramenta, entrada });

describe("kit do terminal (ADR-052, revisto pelas ADR-055 e ADR-066)", () => {
  it("ADR-066: com o harness Claude (hook), o kit vale em todo modo menos o peer e com qualquer confiança; sem ele, só arquivo, só na conversa confiável e com pasta", () => {
    for (const modo of ["conversa", "criacao", "rotina", "delegacao", "sala"] as const) {
      for (const confianca of ["confiavel", "nao_confiavel"] as const) {
        for (const pastasAutorizadas of [false, true]) {
          expect(nativasDoTurno({ modo, confianca, pastasAutorizadas, terminal: true }), `${modo} ${confianca} ${pastasAutorizadas}`).toEqual(NATIVAS_DO_TERMINAL);
        }
      }
    }
    // Só o peer legado fica sem, com ou sem o hook.
    expect(nativasDoTurno({ modo: "peer", confianca: "confiavel", pastasAutorizadas: true, terminal: true })).toEqual([]);
    // Sem o hook (só --restricted), ninguém decide as nativas: ficam na conversa confiável com pasta.
    expect(nativasDoTurno({ modo: "conversa", confianca: "confiavel", pastasAutorizadas: true })).toEqual(NATIVAS_DE_ARQUIVO);
    expect(nativasDoTurno({ modo: "conversa", confianca: "confiavel", pastasAutorizadas: false })).toEqual([]);
    expect(nativasDoTurno({ modo: "conversa", confianca: "nao_confiavel", pastasAutorizadas: true })).toEqual([]);
    expect(nativasDoTurno({ modo: "rotina", confianca: "confiavel", pastasAutorizadas: true })).toEqual([]);
  });

  it("emenda da ADR-055: as skills da pessoa e os subagentes estão no kit, e o hook os deixa passar", () => {
    expect(NATIVAS_DO_TERMINAL).toEqual(expect.arrayContaining(["Skill", "Agent"]));
    expect(decidir("Skill", { skill: "review", args: "420" })).toEqual({ permitir: true, motivo: "skill da pessoa: cada ferramenta que ela usar passa pelo nod", contamina: false });
    expect(decidir("Agent", { subagent_type: "general-purpose", prompt: "revise" })).toMatchObject({ permitir: true, contamina: false });
    // O nome antigo do subagente (o `init` ainda o lista) não entra por engano: o hook recebe "Agent".
    expect(decidir("Task", {})).toMatchObject({ permitir: false });
    // A lista de tarefas do bot só organiza o trabalho da sessão.
    for (const f of ["TaskCreate", "TaskGet", "TaskList", "TaskUpdate"]) {
      expect(NATIVAS_DO_TERMINAL).toContain(f);
      expect(decidir(f, {})).toMatchObject({ permitir: true, contamina: false });
    }
    // Fora do terminal (só arquivo, com pasta), nada de skill.
    expect(nativasDoTurno({ modo: "conversa", confianca: "confiavel", pastasAutorizadas: true })).not.toContain("Skill");
  });

  it("a pasta do bot é o nome dele, sem o que o sistema de arquivos recusa", () => {
    expect(pastaDoBot("Ada")).toBe("Ada");
    expect(pastaDoBot("Dev 1 (cópia)")).toBe("Dev 1 (cópia)");
    expect(pastaDoBot("a/b:c")).toBe("a-b-c");
    expect(pastaDoBot("..")).toBe("bot");
  });

  it("ADR-055: arquivo em qualquer lugar do Mac, como a pessoa no Claude Code", () => {
    for (const [f, entrada] of [
      ["Write", { file_path: "/Users/marlon/nod/Ada/checklist.html" }],
      ["Edit", { file_path: "/Users/marlon/Inhouse/acme/src/app.ts" }],
      ["Read", { file_path: "/Users/marlon/.zshrc" }],
      ["Grep", { path: "/etc" }],
      ["NotebookEdit", { notebook_path: "/tmp/x.ipynb" }],
    ] as const) expect(decidir(f, entrada), f).toMatchObject({ permitir: true, contamina: false });
  });

  it("PR 6 dos modos de aprovação: onde moram as credenciais, o hook não nega sozinho — manda `credencial` ao servidor, que decide pelo modo", () => {
    for (const [f, entrada, credencial] of [
      ["Read", { file_path: "/Users/marlon/.ssh/id_ed25519" }, "/Users/marlon/.ssh/id_ed25519"],
      ["Read", { file_path: "/Users/marlon/.aws/credentials" }, "/Users/marlon/.aws/credentials"],
      ["Read", { file_path: "/Users/marlon/.config/gh/hosts.yml" }, "/Users/marlon/.config/gh/hosts.yml"],
      ["Grep", { pattern: "token", path: "/Users/marlon/.config/gh" }, "/Users/marlon/.config/gh"],
      ["Glob", { pattern: "**/*.pem" }, "**/*.pem"],
      ["Write", { file_path: "/Users/marlon/.ssh/authorized_keys" }, "/Users/marlon/.ssh/authorized_keys"],
      ["Edit", { file_path: "/Users/marlon/.npmrc" }, "/Users/marlon/.npmrc"],
    ] as const) {
      const d = decidir(f, entrada);
      expect(d, `${f} ${JSON.stringify(entrada)}`).toMatchObject({ permitir: true, contamina: false, credencial });
      // A gravação de credencial não vai como `arquivo`: um servidor antigo a trataria como gravação comum.
      expect(d.arquivo, f).toBeUndefined();
    }
  });

  it("revisão do PR 6: o `glob` do Grep também é olhado, e todos os caminhos de credencial vão juntos (a chave do nod não se esconde atrás de outra)", () => {
    expect(decidir("Grep", { path: "/Users/marlon", glob: ".config/nod-motor/*", pattern: "." }).credencial).toBe(".config/nod-motor/*");
    const d = decidir("Grep", { path: "/Users/marlon/.ssh/..", glob: ".config/nod-motor/conexao.json", pattern: "." });
    expect(d.credencial).toBe("/Users/marlon/.ssh/.. .config/nod-motor/conexao.json");
    expect(tocaChaveDoNod(d.credencial ?? "")).toBe(true);
  });

  it("PR 6: o arquivo comum não leva `credencial` (o servidor só decide o que o hook marcou)", () => {
    expect(decidir("Read", { file_path: "/Users/marlon/code/app/README.md" }).credencial).toBeUndefined();
    expect(decidir("Write", { file_path: "/tmp/x.txt" }).credencial).toBeUndefined();
  });

  it("Bash vai ao servidor com o comando; web contamina o turno; o que não é do kit é negado", () => {
    expect(decidir("Bash", { command: "gh pr list -R acme-edtech/acme" })).toMatchObject({ permitir: true, contamina: false, comando: "gh pr list -R acme-edtech/acme" });
    expect(decidir("Bash", { command: "  " }).permitir).toBe(false);
    expect(decidir("Bash", {}).permitir).toBe(false);
    expect(decidir("WebFetch", { url: "https://example.com" })).toMatchObject({ permitir: true, contamina: true });
    expect(decidir("WebSearch", { query: "x" })).toMatchObject({ permitir: true, contamina: true });
    expect(decidir("Task", {}).permitir).toBe(false);
    expect(decidir("mcp__nod__publicar_artefato", {})).toMatchObject({ permitir: true, contamina: false });
    expect(decidir("", {}).permitir).toBe(false);
  });

  it("ADR-067: Monitor roda um comando como o Bash — vai ao servidor com ele e passa pela cerca do git; TaskStop só para o que o bot pôs em segundo plano", () => {
    expect(NATIVAS_DO_TERMINAL).toEqual(expect.arrayContaining(["Monitor", "TaskStop"]));
    const ciVerde = "until gh pr checks 505 -R acme-edtech/acme | grep -qv pending; do sleep 30; done";
    expect(decidir("Monitor", { command: ciVerde, description: "CI do #505" })).toMatchObject({ permitir: true, contamina: false, comando: ciVerde });
    expect(decidir("Monitor", { command: " " }).permitir).toBe(false);
    const pasta = { cwd: "/Users/m/code/acme", pastaDoBot: "/Users/m/nod/Dev 4", home: "/Users/m" };
    expect(decidirNativa({ ferramenta: "Monitor", entrada: { command: "git checkout main && npm test" }, pasta })).toMatchObject({ permitir: false });
    expect(decidirNativa({ ferramenta: "Bash", entrada: { command: "git checkout main && npm test" }, pasta })).toMatchObject({ permitir: false });
    expect(decidir("TaskStop", { task_id: "b1" })).toMatchObject({ permitir: true, contamina: false });
  });
});

describe("hook do Windows: credencial sem caixa (revisão 10 do PR #642, médio 1)", () => {
  const pasta = { cwd: "C:\\Users\\bia\\nod\\ze", pastaDoBot: "C:\\Users\\bia\\nod\\ze", home: "C:\\Users\\bia", windows: true };
  it("no win32 nega o `.AWS` em maiúsculas, que no Linux é outra pasta", () => {
    expect(decidirNativa({ ferramenta: "Bash", entrada: { command: "cat ~/.AWS/credentials" }, pasta }).permitir).toBe(false);
    expect(decidirNativa({ ferramenta: "Bash", entrada: { command: "cat ~/.AWS/credentials" }, pasta: { ...pasta, windows: false } }).permitir).not.toBe(false);
  });
});

describe("hook do Windows: o padrão de busca não é caminho (revisão 13 do PR #642, médio 4)", () => {
  const pasta = { cwd: "C:\\Users\\bia\\nod\\ze", pastaDoBot: "C:\\Users\\bia\\nod\\ze", home: "C:\\Users\\bia", windows: true };
  const bash = (command: string) => decidirNativa({ ferramenta: "Bash", entrada: { command }, pasta });
  it.each([`rg -n "cmdkey" src`, `rg -n "\\.SSH" docs`, `findstr /s "cmdkey" src\\*.ts`, `git grep -n "\\.AWS"`])("busca no código segue para o servidor: %s", (command) => {
    expect(bash(command).permitir).toBe(true);
  });
  it.each([`rg -n key ~/.AWS/credentials`, `rg -e x ~/.AWS/credentials`, `grep -f ~/.AWS/credentials x`, `rg "x" ; cmdkey /list`, `Select-String -Path ~\\.AWS\\credentials -Pattern key`])("o caminho continua pego (negado no hook ou credencial no servidor): %s", (command) => {
    expect(bash(command).permitir === false || tocaCredencial(command)).toBe(true);
  });
});

describe("hook do Windows: texto que só cita o cofre não nega seco (revisão 15 do PR #642, médio 3)", () => {
  const pasta = { cwd: "C:\\Users\\bia\\nod\\ze", pastaDoBot: "C:\\Users\\bia\\nod\\ze", home: "C:\\Users\\bia", windows: true };
  const bash = (command: string) => decidirNativa({ ferramenta: "Bash", entrada: { command }, pasta });
  it.each([
    `cat docs/cmdkey.md`,
    `git log --grep cmdkey`,
    `git log -S "cmdkey" --oneline`,
    `git commit -m "docs: como usar o cmdkey no Windows"`,
    `git commit --message="fix: nao chamar git credential fill"`,
    `echo "veja Microsoft/Credentials" > notas.md`,
  ])("segue para o servidor: %s", (command) => {
    expect(bash(command).permitir).toBe(true);
  });
  it.each([
    `cmdkey /list`,
    `git commit -m "$(cmdkey /list)"`,
    `echo x; cmdkey /list`,
    `echo x > ~/.AWS/credentials`,
    `git log --grep x ~/.AWS/credentials`,
    `cat %APPDATA%\\Microsoft\\Credentials\\x`,
    `cmd /c "cmdkey /list"`,
  ])("continua negado: %s", (command) => {
    const d = bash(command);
    expect(d.permitir === false || tocaCredencial(command)).toBe(true);
  });
});

describe("hook do Windows: o eco por pipe não é texto livre (revisão 19 do PR #642, médio 2)", () => {
  const pasta = { cwd: "C:\\Users\\bia\\nod\\ze", pastaDoBot: "C:\\Users\\bia\\nod\\ze", home: "C:\\Users\\bia", windows: true };
  const bash = (command: string) => decidirNativa({ ferramenta: "Bash", entrada: { command }, pasta });
  it.each([`echo "/c/Users/bia/.AWS/credentials" | xargs cat`, `echo "cmdkey" | xargs -I{} {} /list`, `printf '%s' "~/.aws./credentials" | xargs cat`])("nega: %s", (command) => {
    expect(bash(command).permitir).toBe(false);
  });
  it("o eco que vai para arquivo segue texto livre", () => {
    expect(bash(`echo "veja Microsoft/Credentials" > notas.md`).permitir).toBe(true);
  });
});
