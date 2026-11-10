import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/** NOD-132 (ADR-149, item 3): o provisionamento cria o bucket privado e dá à VM só o signBlob. */
describe("NOD-132: IAM da atualização do app no provisionar.sh", () => {
  const script = readFileSync("infra/gcp/provisionar.sh", "utf8").split("\n").filter((l) => !l.trim().startsWith("#")).join("\n");
  it("bucket privado, de acesso uniforme, com a VM só lendo", () => {
    expect(script).toMatch(/buckets create "\$BUCKET_ATUALIZACOES" .*--uniform-bucket-level-access --public-access-prevention/);
    expect(script).toMatch(/buckets add-iam-policy-binding "\$BUCKET_ATUALIZACOES" --member="serviceAccount:\$SA_VM" --role=roles\/storage\.objectViewer/);
  });
  it("papel custom só com o signBlob, nunca o serviceAccountTokenCreator", () => {
    expect(script).toMatch(/papel_customizado nodAssinarBlob "[^"]+" iam\.serviceAccounts\.signBlob$/m);
    expect(script).toMatch(/--role="projects\/\$PROJETO\/roles\/nodAssinarBlob"/);
    expect(script).not.toMatch(/serviceAccountTokenCreator/);
  });
});
