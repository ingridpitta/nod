// NOD-203: a verificação do pacote assinado do Mac, depois do electron-builder e da notarização do DMG.
// Duas camadas: `main` roda os comandos do macOS e captura stdout E stderr (codesign -dv e spctl escrevem no
// stderr); as funções `interpretar*`/`comparar*` são puras e testadas no Linux com saídas reais de exemplo
// (tests/unit/desktop/verificar-pacote-mac.test.ts). Toda conferência devolve { item, ok, esperado, veio }, e o
// script junta TODAS as falhas antes de sair com 1. Só módulos do Node: nada de dependência transitiva para YAML.
//
// Uso no CI (job `mac`, com ARCH e APPLE_TEAM_ID no ambiente):
//   node scripts/desktop/verificar-pacote-mac.mjs pacote <nod.app> <nod.dmg>
//   node scripts/desktop/verificar-pacote-mac.mjs notarizacao <saida-json-do-notarytool>   (imprime o id no stdout)
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

const resultado = (item, ok, esperado, veio) => ({ item, ok, esperado, veio });
const linhas = (texto) => String(texto ?? "").split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== "");
const resumo = (texto) => linhas(texto).slice(0, 3).join(" | ") || "(sem saída)";
const lista = (itens) => (itens.length ? itens.join(", ") : "(nenhuma)");

/** Arquitetura do job (`matrix.arch`, nome do electron-builder) → nome do `lipo`. */
export const ARCH_DO_LIPO = { arm64: "arm64", x64: "x86_64" };

/** `codesign --verify --deep --strict`: vale o código de saída; a saída só entra no "veio". */
export function interpretarVerify(alvo, { codigo, saida }) {
  return resultado(`codesign --verify --deep --strict (${alvo})`, codigo === 0, "assinatura válida (saída 0)", codigo === 0 ? "assinatura válida" : `saída ${codigo}: ${resumo(saida)}`);
}

/** Valor de `Chave=valor` numa saída do codesign, tolerante a espaços e à ordem das linhas. */
function campos(saida, chave) {
  const re = new RegExp(`^${chave}\\s*=\\s*(.*)$`);
  return linhas(saida).map((l) => re.exec(l)?.[1]?.trim()).filter((v) => v !== undefined);
}

/** `codesign -dv --verbose=4`: o certificado folha é Developer ID Application e o Team ID é o do secret. */
export function interpretarCodesign(alvo, saida, teamId) {
  const autoridades = campos(saida, "Authority");
  // A folha costuma vir primeiro, mas a ordem das linhas não é garantida entre versões do macOS.
  const folha = autoridades.find((a) => a.startsWith("Developer ID Application:")) ?? autoridades[0];
  const assinatura = campos(saida, "Signature")[0];
  const veioAutoridade = folha ?? (assinatura === "adhoc" ? "assinatura ad-hoc, sem Authority" : "sem Authority");
  const team = campos(saida, "TeamIdentifier")[0] ?? "sem TeamIdentifier";
  const esperadoTeam = teamId ? teamId : "o valor de APPLE_TEAM_ID (vazio no ambiente)";
  return [
    resultado(`Authority (${alvo})`, Boolean(folha?.startsWith("Developer ID Application:")), "Authority=Developer ID Application: …", veioAutoridade),
    resultado(`TeamIdentifier (${alvo})`, Boolean(teamId) && team === teamId, esperadoTeam, team),
  ];
}

/** `codesign -dv`: a linha CodeDirectory traz `flags=0x10000(runtime)`; sem `runtime` não há hardened runtime. */
export function interpretarFlags(alvo, saida) {
  const m = /flags=(0x[0-9a-f]+)(?:\(([^)]*)\))?/i.exec(String(saida ?? ""));
  const nomes = m?.[2] ? m[2].split(",").map((f) => f.trim()) : [];
  return resultado(`hardened runtime (${alvo})`, nomes.includes("runtime"), "flags com runtime", m ? `flags=${m[1]}${m[2] ? `(${m[2]})` : ""}` : "sem flags na saída");
}

/**
 * As entitlements concedidas num plist XML (o do repositório ou o de `codesign -d --entitlements - --xml`).
 * Entra toda chave cujo valor não é `<false/>`: uma entitlement com array ou string também é concedida.
 */
export function lerEntitlements(xml) {
  const texto = String(xml ?? "");
  const chaves = new Set();
  const re = /<key>\s*([^<]+?)\s*<\/key>\s*<([a-z]+)\s*\/?>/gi;
  for (let m = re.exec(texto); m; m = re.exec(texto)) if (m[2].toLowerCase() !== "false") chaves.add(m[1]);
  return [...chaves].sort();
}

/** Igualdade EXATA de conjunto: entitlement a mais ou a menos reprova. */
export function compararEntitlements(alvo, xml, esperadas) {
  const veio = lerEntitlements(xml);
  const esperado = [...esperadas].sort();
  const aMais = veio.filter((e) => !esperado.includes(e));
  const aMenos = esperado.filter((e) => !veio.includes(e));
  const ok = aMais.length === 0 && aMenos.length === 0;
  const detalhe = ok ? "" : ` (${[aMais.length ? `a mais: ${aMais.join(", ")}` : "", aMenos.length ? `a menos: ${aMenos.join(", ")}` : ""].filter(Boolean).join("; ")})`;
  return resultado(`entitlements (${alvo})`, ok, lista(esperado), `${lista(veio)}${detalhe}`);
}

/** Os helpers do Electron em `Contents/Frameworks`. Nenhum reprova: aprovar sem conferir nada não vale. */
export function filtrarHelpers(nomes) {
  return nomes.filter((n) => /^nod Helper.*\.app$/.test(n)).sort();
}

export function conferirHelpersEncontrados(helpers) {
  return resultado("helpers em Contents/Frameworks", helpers.length > 0, "ao menos um nod Helper*.app", helpers.length ? lista(helpers) : "nenhum");
}

/** O texto do microfone, lido da linha `NSMicrophoneUsageDescription:` do electron-builder.yml. */
export function lerTextoMicrofone(yaml) {
  const m = /^\s*NSMicrophoneUsageDescription:\s*(.*?)\s*$/m.exec(String(yaml ?? ""));
  if (!m) throw new Error("electron-builder.yml sem NSMicrophoneUsageDescription");
  const valor = m[1];
  if (/^'.*'$/.test(valor)) return valor.slice(1, -1).replace(/''/g, "'");
  if (/^".*"$/.test(valor)) return JSON.parse(valor);
  return valor;
}

/** `plutil -extract NSMicrophoneUsageDescription raw` do Info.plist do app, contra o texto do yml. */
export function compararMicrofone({ codigo, saida }, esperado) {
  const veio = codigo === 0 ? String(saida ?? "").replace(/\r?\n$/, "") : `ausente no Info.plist (saída ${codigo}: ${resumo(saida)})`;
  return resultado("NSMicrophoneUsageDescription", codigo === 0 && veio === esperado, esperado, veio);
}

/** NOD-136: o esquema `nod://` registrado no Info.plist (`plutil -extract CFBundleURLTypes.0.CFBundleURLSchemes.0 raw`). */
export function compararEsquemaUrl({ codigo, saida }, esperado = "nod") {
  const veio = codigo === 0 ? String(saida ?? "").replace(/\r?\n$/, "") : `ausente no Info.plist (saída ${codigo}: ${resumo(saida)})`;
  return resultado("CFBundleURLTypes (esquema)", codigo === 0 && veio === esperado, esperado, veio);
}

/** `lipo -archs`: exatamente a arquitetura do job, nem a outra nem as duas. */
export function interpretarLipo(saida, arch) {
  const esperado = ARCH_DO_LIPO[arch] ?? `arquitetura conhecida (arm64 ou x64), veio ARCH=${arch}`;
  const veio = String(saida ?? "").trim().split(/\s+/).filter(Boolean);
  return resultado("lipo -archs (Contents/MacOS/nod)", veio.length === 1 && veio[0] === ARCH_DO_LIPO[arch], esperado, veio.join(" ") || "(sem saída)");
}

/** `xcrun stapler validate`: saída 0 e "The validate action worked!". */
export function interpretarStapler(alvo, { codigo, saida }) {
  const ok = codigo === 0 && /The validate action worked!/.test(String(saida ?? ""));
  return resultado(`stapler validate (${alvo})`, ok, "The validate action worked! (bilhete grampeado)", ok ? "The validate action worked!" : `saída ${codigo}: ${resumo(saida)}`);
}

/** `spctl --assess --verbose=2`: `accepted` e `source=Notarized Developer ID`. */
export function interpretarSpctl(alvo, { codigo, saida }) {
  const texto = String(saida ?? "");
  const veredito = /:\s*(accepted|rejected)\b/.exec(texto)?.[1] ?? "sem veredito";
  const fonte = campos(texto, "source")[0] ?? "sem source";
  const ok = codigo === 0 && veredito === "accepted" && fonte === "Notarized Developer ID";
  return resultado(`spctl --assess (${alvo})`, ok, "accepted, source=Notarized Developer ID", `${veredito}, source=${fonte}${codigo === 0 ? "" : ` (saída ${codigo})`}`);
}

/** JSON do `notarytool submit --wait --output-format json`. O `--wait` sai com 0 mesmo com status Invalid. */
export function interpretarNotarytool(saida) {
  const texto = String(saida ?? "");
  const inicio = texto.indexOf("{");
  const fim = texto.lastIndexOf("}");
  let dados = null;
  if (inicio >= 0 && fim > inicio) {
    try { dados = JSON.parse(texto.slice(inicio, fim + 1)); } catch { dados = null; }
  }
  if (!dados || typeof dados !== "object") return { ...resultado("notarytool submit (DMG)", false, "status Accepted", `saída sem JSON: ${resumo(texto)}`), id: null };
  const status = typeof dados.status === "string" ? dados.status : "sem status";
  const id = typeof dados.id === "string" ? dados.id : null;
  const mensagem = typeof dados.message === "string" ? ` (${dados.message})` : "";
  return { ...resultado("notarytool submit (DMG)", status === "Accepted", "status Accepted", `status ${status}${mensagem}`), id };
}

/**
 * Junta as conferências do pacote a partir das saídas já capturadas.
 * @param saidas as saídas dos comandos (ver `main`).
 * @param esperado { teamId, arch, entitlements, microfone }.
 */
export function conferirPacote(saidas, esperado) {
  const helpers = saidas.helpers ?? [];
  return [
    interpretarVerify("nod.app", saidas.verify),
    ...interpretarCodesign("nod.app", saidas.detalhes, esperado.teamId),
    interpretarFlags("nod.app", saidas.detalhes),
    compararEntitlements("nod.app", saidas.entitlementsApp, esperado.entitlements),
    conferirHelpersEncontrados(helpers.map((h) => h.nome)),
    ...helpers.map((h) => compararEntitlements(h.nome, h.entitlements, esperado.entitlements)),
    compararMicrofone(saidas.microfone, esperado.microfone),
    compararEsquemaUrl(saidas.esquemaUrl),
    interpretarLipo(saidas.lipo, esperado.arch),
    interpretarStapler("nod.app", saidas.staplerApp),
    interpretarStapler("DMG", saidas.staplerDmg),
    interpretarSpctl("nod.app", saidas.spctlApp),
    interpretarSpctl("DMG", saidas.spctlDmg),
  ];
}

/** As falhas em pt-BR, uma por linha, no formato "item: esperava X, veio Y". */
export function formatarFalhas(resultados) {
  return resultados.filter((r) => !r.ok).map((r) => `${r.item}: esperava ${r.esperado}, veio ${r.veio}`);
}

function rodar(comando, args) {
  const r = spawnSync(comando, args, { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  if (r.error) return { codigo: 127, saida: `${comando} não executou: ${r.error.message}` };
  return { codigo: r.status ?? 1, saida: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

/** 5/11/2026: o stapler busca o bilhete no CloudKit da Apple a cada `validate`; a queda de rede sai com 68 e passa (scripts/desktop/stapler.sh). */
export const STAPLER_TENTATIVAS = 6;
export const STAPLER_ESPERA_MS = 20_000;
export function deveRepetirStapler({ codigo }, tentativa, tentativas = STAPLER_TENTATIVAS) {
  return codigo === 68 && tentativa < tentativas;
}
function rodarStapler(alvo, esperar = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)) {
  let r = rodar("xcrun", ["stapler", "validate", alvo]);
  for (let tentativa = 1; deveRepetirStapler(r, tentativa); tentativa++) {
    process.stderr.write(`stapler validate (${alvo}): CloudKit da Apple não respondeu (saída 68), tentativa ${tentativa} de ${STAPLER_TENTATIVAS}\n`);
    esperar(STAPLER_ESPERA_MS);
    r = rodar("xcrun", ["stapler", "validate", alvo]);
  }
  return r;
}

function relatar(falhas) {
  const prefixo = process.env.GITHUB_ACTIONS === "true" ? "::error::" : "";
  process.stderr.write(`${falhas.map((f) => `${prefixo}${f}`).join("\n")}\n`);
}

function verificarPacote(app, dmg) {
  const frameworks = join(app, "Contents", "Frameworks");
  let nomes = [];
  try { nomes = readdirSync(frameworks); } catch { nomes = []; }
  const helpers = filtrarHelpers(nomes).map((nome) => ({ nome, entitlements: rodar("codesign", ["-d", "--entitlements", "-", "--xml", join(frameworks, nome)]).saida }));
  const saidas = {
    verify: rodar("codesign", ["--verify", "--deep", "--strict", "--verbose=2", app]),
    detalhes: rodar("codesign", ["-dv", "--verbose=4", app]).saida,
    entitlementsApp: rodar("codesign", ["-d", "--entitlements", "-", "--xml", app]).saida,
    helpers,
    microfone: rodar("plutil", ["-extract", "NSMicrophoneUsageDescription", "raw", "-o", "-", join(app, "Contents", "Info.plist")]),
    esquemaUrl: rodar("plutil", ["-extract", "CFBundleURLTypes.0.CFBundleURLSchemes.0", "raw", "-o", "-", join(app, "Contents", "Info.plist")]),
    lipo: rodar("lipo", ["-archs", join(app, "Contents", "MacOS", "nod")]).saida,
    staplerApp: rodarStapler(app),
    staplerDmg: rodarStapler(dmg),
    spctlApp: rodar("spctl", ["--assess", "--type", "execute", "--verbose=2", app]),
    spctlDmg: rodar("spctl", ["--assess", "--type", "open", "--context", "context:primary-signature", "--verbose=2", dmg]),
  };
  const esperado = {
    teamId: (process.env.APPLE_TEAM_ID ?? "").trim(),
    arch: process.env.ARCH ?? "",
    entitlements: lerEntitlements(readFileSync(join(RAIZ, "desktop", "entitlements.mac.plist"), "utf8")),
    microfone: lerTextoMicrofone(readFileSync(join(RAIZ, "electron-builder.yml"), "utf8")),
  };
  const resultados = conferirPacote(saidas, esperado);
  const falhas = formatarFalhas(resultados);
  if (falhas.length) {
    process.stderr.write(`Verificação do pacote do Mac reprovada (${falhas.length} de ${resultados.length}):\n`);
    relatar(falhas);
    process.exitCode = 1;
    return;
  }
  process.stdout.write(`Verificação do pacote do Mac: ${resultados.length} conferências passaram (${helpers.length} helpers).\n`);
}

function verificarNotarizacao(arquivo) {
  const r = interpretarNotarytool(readFileSync(arquivo, "utf8"));
  if (r.id) process.stdout.write(`${r.id}\n`);
  if (r.ok) { process.stderr.write(`Notarização do DMG aceita (id ${r.id}).\n`); return; }
  relatar(formatarFalhas([r]));
  process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [modo, ...args] = process.argv.slice(2);
  if (modo === "pacote" && args.length === 2) verificarPacote(args[0], args[1]);
  else if (modo === "notarizacao" && args.length === 1) verificarNotarizacao(args[0]);
  else throw new Error("Uso: verificar-pacote-mac.mjs pacote <nod.app> <nod.dmg> | notarizacao <saida.json>");
}
