// NOD-93 passo 2 (ADR-127 §1): o bloco do computador reusável no disco da VM do Mac (arquivos locais, sem ligar).
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ARQUIVOS_DO_COMPUTADOR, blocoDoComputador } from "../../../src/adapters/http/computador-instalacao.ts";

const ANTES = readFileSync(new URL("./fixtures/bloco-do-computador.sh", import.meta.url), "utf8");

describe("blocoDoComputador com opções (ADR-127)", () => {
  it("o padrão é byte a byte o bloco de antes (servidor, ligar)", () => {
    expect(blocoDoComputador()).toBe(ANTES);
    expect(blocoDoComputador({})).toBe(ANTES);
    expect(blocoDoComputador({ arquivos: "servidor", ligar: true })).toBe(ANTES);
  });

  it("locais copia de $ORIGEM, sem curl do servidor", () => {
    const b = blocoDoComputador({ arquivos: "locais" });
    expect(b).not.toContain("curl");
    expect(b).not.toContain("$NOD_SERVIDOR");
    for (const a of ARQUIVOS_DO_COMPUTADOR) expect(b).toContain(`"$ORIGEM/${a}"`);
    expect(b).toContain('"$ORIGEM/computador-supervisor.mjs" "$PASTA/computador/supervisor.mjs"');
    // O resto (pacotes, usuários, Chromium, units) é o mesmo.
    expect(b).toContain("systemctl enable --now nod-computador-terminal.socket nod-computador.socket");
    expect(spawnSync("sh", ["-n"], { input: b }).status).toBe(0);
  });

  it("ligar:false só habilita: sem --now, daemon-reload nem try-restart (roda em chroot)", () => {
    const b = blocoDoComputador({ arquivos: "locais", ligar: false });
    expect(b).toContain("$SUDO systemctl enable nod-computador-terminal.socket nod-computador.socket");
    expect(b).not.toContain("--now nod-computador");
    expect(b).not.toContain("daemon-reload");
    expect(b).not.toContain("try-restart");
    expect(b).toContain("nod-computador.service >/dev/null <<'NODUNIDADE'");
    expect(spawnSync("sh", ["-n"], { input: b }).status).toBe(0);
  });
});
