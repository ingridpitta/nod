import { describe, expect, it } from "vitest";
import {
  aposFalha,
  classificarErroDeOperacao,
  classificarErroNuvem,
  condicaoLerProjeto,
  DESISTIR_SEM_CAPACIDADE_MS,
  NOVA_TENTATIVA_MS,
  PAPEL_GERENCIAR,
  PAPEL_LER,
  PERMISSOES_DOS_PAPEIS,
  REDE_NOD,
} from "../../../src/domain/maquina-nuvem.ts";

// NOD-92 (revisão, B5): fixtures dos erros do Google no formato real (REST síncrono e operação da Compute).
const rest = (code: number, status: string, reason?: string) => ({ error: { code, status, message: "x", errors: reason ? [{ reason, domain: "global", message: "x" }] : [] } });

describe("domínio: classificarErroNuvem", () => {
  it.each([
    ["cota (REST)", 403, rest(403, "PERMISSION_DENIED", "quotaExceeded"), { motivo: "cota_ou_cobranca" }],
    ["faturamento desligado", 403, rest(403, "PERMISSION_DENIED", "billingNotEnabled"), { motivo: "cota_ou_cobranca" }],
    ["política da organização", 412, rest(412, "FAILED_PRECONDITION", "conditionNotMet"), { motivo: "cota_ou_cobranca" }],
    ["zona sem capacidade", 503, rest(503, "UNAVAILABLE", "resourceNotReady"), { motivo: "sem_capacidade" }],
    ["credencial recusada", 401, rest(401, "UNAUTHENTICATED"), { motivo: "credencial_nuvem" }],
    ["VM apagada", 404, rest(404, "NOT_FOUND", "notFound"), { motivo: "excluida" }],
  ])("%s", (_nome, status, corpo, esperado) => {
    expect(classificarErroNuvem(status, corpo)).toEqual(esperado);
  });

  it("5xx, 429 e rede caída são transitórios", () => {
    expect(classificarErroNuvem(503, rest(503, "UNAVAILABLE", "backendError"))).toBe("transitorio");
    expect(classificarErroNuvem(429, rest(429, "RESOURCE_EXHAUSTED", "rateLimitExceeded"))).toBe("transitorio");
    expect(classificarErroNuvem(0, null)).toBe("transitorio");
  });

  it("operação assíncrona: QUOTA_EXCEEDED e ZONE_RESOURCE_POOL_EXHAUSTED pelo code", () => {
    expect(classificarErroDeOperacao({ errors: [{ code: "QUOTA_EXCEEDED", message: "CPUS" }] })).toEqual({ motivo: "cota_ou_cobranca" });
    expect(classificarErroDeOperacao({ errors: [{ code: "ZONE_RESOURCE_POOL_EXHAUSTED", message: "x" }] })).toEqual({ motivo: "sem_capacidade" });
  });

  it("criar_chave: só a pré-condição é a organização; 400 genérico não", () => {
    const org = { motivo: "credencial_nuvem", detalhe: "org_bloqueia_chave" };
    expect(classificarErroNuvem(400, rest(400, "FAILED_PRECONDITION"), "criar_chave")).toEqual(org);
    expect(classificarErroNuvem(412, null, "criar_chave")).toEqual(org);
    expect(classificarErroNuvem(400, { error: { message: "constraints/iam.disableServiceAccountKeyCreation" } }, "criar_chave")).toEqual(org);
    expect(classificarErroNuvem(400, rest(400, "INVALID_ARGUMENT"), "criar_chave")).toEqual({ motivo: "credencial_nuvem" });
  });
});

describe("domínio: aposFalha (item 10)", () => {
  const t0 = Date.parse("2026-10-23T12:00:00Z");
  it("sem capacidade tenta de novo em 5 min até 30 min desde o primeiro Acordando…", () => {
    expect(aposFalha("acordando", "sem_capacidade", t0 + 29 * 60_000, t0)).toEqual({ estado: "acordando", motivo: "sem_capacidade", proximaTentativaEm: t0 + 29 * 60_000 + NOVA_TENTATIVA_MS });
    expect(aposFalha("acordando", "sem_capacidade", t0 + DESISTIR_SEM_CAPACIDADE_MS, t0)).toEqual({ estado: "falhou_ao_acordar", motivo: "sem_capacidade", proximaTentativaEm: null });
  });
  it("vindo de dormindo, a primeira falta de capacidade vira acordando; excluida é terminal; adormecendo volta a acordada", () => {
    expect(aposFalha("dormindo", "sem_capacidade", t0).estado).toBe("acordando");
    expect(aposFalha("acordando", "excluida", t0).estado).toBe("excluida");
    expect(aposFalha("adormecendo", "credencial_nuvem", t0)).toEqual({ estado: "acordada", motivo: "credencial_nuvem", proximaTentativaEm: t0 + NOVA_TENTATIVA_MS });
    expect(aposFalha("acordando", "cota_ou_cobranca", t0).estado).toBe("falhou_ao_acordar");
  });
});

describe("domínio: papéis (B6)", () => {
  it("disks.use fica no papel com a condição do prefixo; nada do papel de ler usa disco", () => {
    expect(PERMISSOES_DOS_PAPEIS[PAPEL_GERENCIAR]).toContain("compute.disks.use");
    expect(PERMISSOES_DOS_PAPEIS[PAPEL_LER].some((p) => p.startsWith("compute.disks."))).toBe(false);
  });
  it("o papel de ler deixa a VM criada usar IP externo na sub-rede do nod", () => {
    expect(PERMISSOES_DOS_PAPEIS[PAPEL_LER]).toContain("compute.subnetworks.useExternalIp");
  });
  it("a condição de ler limita ao projeto, à sub-rede do nod e às operações", () => {
    expect(condicaoLerProjeto("p1")).toBe(
      `resource.name.startsWith("projects/p1/") && (resource.name.extract("/subnetworks/{nome}") == "${REDE_NOD}" || resource.name.extract("/operations/{op}") != "")`,
    );
  });
});
