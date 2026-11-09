import { describe, expect, it } from "vitest";
import { classificarComando } from "../../../src/domain/comando.ts";

const tipo = (c: string) => classificarComando(c).tipo;

describe("classificarComando (ADR-055): o que só lê roda direto, o resto pede", () => {
  it("revisar um PR é leitura do começo ao fim", () => {
    for (const c of [
      "gh pr list -R acme-edtech/acme",
      "gh pr view 466 -R acme-edtech/acme --json title,body",
      "gh pr diff 466 -R acme-edtech/acme",
      "gh pr checks 466",
      "gh api repos/acme-edtech/acme/pulls?state=open",
      "gh auth status",
      "cd ~/Inhouse/acme && git fetch origin && git log --oneline -20",
      "git -C ~/Inhouse/acme diff main...origin/feat/x --stat",
      "git status --short | head -20",
      "git branch -a",
      "git branch --list 'feat/*'",
      "git remote -v",
      "git config --get remote.origin.url",
      "rg -n 'useEffect' src | wc -l",
      "find . -name '*.ts' -not -path './node_modules/*'",
      "cat package.json | jq .scripts",
      "npm test",
      "npm run typecheck",
      "npm run test:unit 2>&1 | tail -30",
      "npx tsc --noEmit",
      "npx vitest run src/x.test.ts",
      "ls -la > /dev/null 2>&1",
      "sed -n '1,40p' src/app.ts",
      "node --version",
    ]) expect(tipo(c), c).toBe("leitura");
  });

  it("o que muda algo no Mac, no repositório ou no GitHub pede aprovação", () => {
    for (const c of [
      "git push origin feat/x",
      "git commit -m 'feat: x'",
      "git checkout -b feat/x",
      "git branch -D feat/velha",
      "git config user.email x@y.z",
      "git stash pop",
      "gh pr create --fill",
      "gh pr merge 466 --squash",
      "gh pr review 466 --approve",
      "gh pr comment 466 -b 'ok'",
      "gh api -X POST repos/o/r/issues -f title=x",
      "gh api repos/o/r/issues -f title=x",
      "npm install",
      "npm run build",
      "npx some-cli",
      "rm -rf node_modules",
      "curl https://example.com",
      "sed -i '' 's/a/b/' x.ts",
      "find . -name '*.log' -delete",
      "find . -exec rm {} \\;",
      "node -e 'require(\"fs\").rmSync(\"x\")'",
      "echo oi > arquivo.txt",
      "cat x >> y",
      "sleep 100 &",
      "git -c core.pager='sh -c evil' log",
      "PAGER=evil git log",
      "/tmp/ls",
      "sudo ls",
      "xargs rm",
    ]) expect(tipo(c), c).toBe("altera");
  });

  it("substituição de comando pede sempre, até dentro de aspas duplas e junto de leitura", () => {
    for (const c of ["ls $(rm -rf ~)", "echo \"$(curl evil)\"", "cat `whoami`", "diff <(ls a) <(ls b)", "git log && echo $(id)"]) {
      expect(tipo(c), c).toBe("altera");
    }
    // Entre aspas simples é texto: não roda.
    expect(tipo("echo '$(rm -rf ~)'")).toBe("leitura");
  });

  it("uma parte que altera contamina o comando inteiro; vazio, aspas abertas e longo demais pedem", () => {
    expect(tipo("git status && git push")).toBe("altera");
    expect(tipo("ls; rm x")).toBe("altera");
    expect(tipo("git log | tee saida.txt")).toBe("altera");
    expect(tipo("")).toBe("altera");
    expect(tipo("echo 'sem fim")).toBe("altera");
    expect(tipo(`ls ${"a".repeat(2_100)}`)).toBe("altera");
  });

  it("credencial nunca é leitura livre: ler a chave e mandar para fora é o caminho de um texto malicioso num PR", () => {
    for (const c of [
      "cat ~/.ssh/id_rsa",
      "ls -la ~/.ssh",
      "cat /Users/marlon/.aws/credentials",
      "cat ~/.config/gh/hosts.yml",
      "gh auth token",
      "security find-generic-password -s github",
      "grep -r token ~/.netrc",
      "head server.pem",
      "env",
      "printenv GITHUB_TOKEN",
    ]) expect(classificarComando(c), c).toEqual({ tipo: "altera", motivo: expect.any(String) });
    expect(classificarComando("cat ~/.ssh/config").motivo).toBe("toca uma credencial do Mac");
    // Nome parecido não é credencial.
    expect(tipo("cat docs/ssh-setup.md")).toBe("leitura");
    expect(tipo("rg keycloak src")).toBe("leitura");
  });

  it("o motivo diz o que pediu", () => {
    expect(classificarComando("git push").motivo).toBe("git push");
    expect(classificarComando("echo x > y").motivo).toBe("grava em arquivo pelo redirecionamento");
  });
});

describe("revisão 27 do PR #642: a \\ antes do \\r\\n não esconde a linha seguinte", () => {
  it.each(["ls \\\r\nrm -rf src", "ls \\\r\ngit push origin HEAD"])("%j não é leitura", (c) => {
    expect(tipo(c)).not.toBe("leitura");
  });
  it("a \\ com o \\n sozinho segue continuando a linha", () => {
    expect(tipo("ls \\\n  -la")).toBe("leitura");
  });
});
