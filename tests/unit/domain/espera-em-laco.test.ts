import { describe, expect, it } from "vitest";
import { esperaEmLaco, motivoDaEsperaNegada } from "../../../src/domain/espera-em-laco.ts";

/**
 * ADR-089 (#217): o laço de espera (sleep de 10 s ou mais dentro) e o sleep longo são negados; o comando demorado de
 * verdade e o laço de sleep curto que espera algo local subir, nunca. Os primeiros casos são os medidos no Mac do Marlon
 * em 09/10 (Cecília com 30 s, Ze com 10/15 s).
 */
describe("espera em laço (ADR-089)", () => {
  it.each([
    ["while :; do gh run list --branch fix/x --limit 1; sleep 30; done", 30],
    ["while true; do sleep 10; gh pr checks 42; done", 10],
    ["until gh run view 123 --json status | grep -q completed; do sleep 15; done", 15],
    ["while sleep 20; do gh run list; done", 20],
    ["while :\ndo\n  gh run list\n  sleep 30\ndone", 30],
    ["cd ~/nod/Ze && while :; do git fetch; sleep 15; done > /dev/null 2>&1 &", 15],
    ["nohup bash -c 'while :; do curl -s https://x; sleep 60; done' &", 60],
    ["timeout 3600 sh -c \"until curl -sf http://deploy; do sleep 30; done\"", 30],
    ["while :; do echo $(sleep 15); done", 15],
    ["gh pr list | while read -r pr; do gh pr checks \"$pr\"; sleep 10; done", 10],
    ["while :; do for i in 1 2; do echo $i; done; sleep 30; done", 30],
    ["bash <<EOF\nwhile :; do gh run list; sleep 30; done\nEOF", 30],
    ["for i in $(seq 100); do gh run list; sleep 60; done", 60],
    // `timeout 0` desliga o limite; 11m e 1h passam de 10 min
    ["timeout 0 bash -c 'while :; do gh run list; sleep 30; done'", 30],
    ["timeout 11m bash -c 'while :; do gh run list; sleep 30; done'", 30],
    ["timeout -k 5 1h sh -c 'until gh pr checks 1; do sleep 20; done'", 20],
  ])("nega o laço: %s", (comando, segundos) => {
    expect(esperaEmLaco(comando)).toEqual({ tipo: "laco_com_sleep", segundos });
  });

  it.each([
    ["sleep 120", 120],
    ["sleep 5m", 300],
    ["sleep 1h && gh run list", 3_600],
    ["nohup sleep 90 &", 90],
    ["/bin/sleep 61", 61],
    ["sleep 30; gh run list; sleep 40", 70],
  ])("sleep longo (somado no comando): %s", (comando, segundos) => {
    expect(esperaEmLaco(comando)).toEqual({ tipo: "sleep_longo", segundos });
  });

  it("sleep sem fim é longo", () => {
    expect(esperaEmLaco("sleep infinity")).toEqual({ tipo: "sleep_longo", segundos: Number.POSITIVE_INFINITY });
  });

  it.each([
    "npm test",
    "npm ci",
    "npm run build",
    "docker compose up -d",
    "npx vitest run tests/unit",
    "sleep 2 && curl -s http://127.0.0.1:8888/api/saude",
    "sleep 60; gh run list",
    "sleep 30 30",
    // revisão do #223: laço de sleep curto é esperar algo local subir, ou um lote respeitando limite de API.
    "until pg_isready -h 127.0.0.1 -p 5447; do sleep 1; done",
    "until docker compose ps | grep healthy; do sleep 2; done",
    "while :; do sleep 5; done",
    "for id in a b c; do gh api repos/x/issues/$id; sleep 1; done",
    "for i in $(seq 30); do curl -sf http://127.0.0.1:5274 && break; sleep 1; done",
    // laço dentro de timeout de até 10 min tem fim garantido
    "timeout 60 bash -c 'until curl -sf http://127.0.0.1:8897; do sleep 1; done'",
    "timeout 600 bash -c 'while :; do gh run list; sleep 30; done'",
    "timeout 5m sh -c 'sleep 200'",
    "timeout 10m bash -c 'while :; do gh run list; sleep 30; done'",
    "timeout -s KILL 90s bash -c 'until curl -sf x; do sleep 15; done'",
    "while read -r linha; do echo \"$linha\"; done < lista.txt",
    "tail -f /tmp/dev.log | grep --line-buffered ERRO",
    "grep -rn sleep src",
    "grep -rn \"while :; do sleep 30; done\" docs",
    "echo 'until pronto; do sleep 300; done'",
    "# while :; do sleep 30; done\nnpm test",
    "git commit -m \"$(cat <<'EOF'\nTroca o while com sleep 90 por me_chame_as\n\nsleep 300 era o laço antigo\nEOF\n)\"",
    "cat <<EOF > notas.md\nwhile :; do sleep 30; done\nEOF",
    "git commit -m \"$(cat <<'EOF'\nIt's the bot's fix (1) for while loops\nsleep 90\nEOF\n)\"",
    "gh pr create --body \"Linha 1\nsleep 300\nwhile :; do x; done\"",
    "echo ok # sleep 300",
    "python3 -c 'import time; time.sleep(120)'",
    "node -e \"setTimeout(() => {}, 1000)\"",
  ])("passa: %s", (comando) => {
    expect(esperaEmLaco(comando)).toBeNull();
  });

  it("a mensagem aponta o me_chame_as quando ele existe e manda encerrar quando não existe", () => {
    const com = motivoDaEsperaNegada({ tipo: "laco_com_sleep", segundos: 30 }, true);
    expect(com).toContain("me_chame_as");
    expect(com).toContain("laço de espera com sleep de 30 s");
    expect(com).toContain("npm ci");
    const sem = motivoDaEsperaNegada({ tipo: "sleep_longo", segundos: 300 }, false);
    expect(sem).not.toContain("me_chame_as");
    expect(sem).toContain("encerre o turno dizendo o que falta");
    expect(sem).toContain("sleep de 300 s");
  });
});
