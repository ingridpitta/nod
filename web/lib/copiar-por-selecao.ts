/**
 * NOD-84 (QA do PR #608): o plano B do Copiar quando a API da área de transferência falha (navegador sem permissão,
 * página fora de HTTPS). Põe o texto num campo fora da tela, copia pela seleção e tira o campo NA HORA: o endereço
 * inteiro não fica no HTML (ADR-139). Devolve se copiou.
 */
type Campo = { value: string; style: { position: string; left: string; opacity: string }; setAttribute(n: string, v: string): void; select(): void; remove(): void };
export type DocParaCopiar = { createElement(tag: "textarea"): Campo; body: { appendChild(c: Campo): unknown }; execCommand(cmd: "copy"): boolean };

export function copiarPorSelecao(doc: DocParaCopiar, texto: string): boolean {
  const campo = doc.createElement("textarea");
  campo.value = texto;
  campo.setAttribute("readonly", "");
  campo.setAttribute("aria-hidden", "true");
  campo.style.position = "fixed";
  campo.style.left = "-9999px";
  campo.style.opacity = "0";
  doc.body.appendChild(campo);
  try {
    campo.select();
    return doc.execCommand("copy");
  } catch {
    return false;
  } finally {
    campo.value = "";
    campo.remove();
  }
}
