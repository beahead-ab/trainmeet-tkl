#!/usr/bin/env node
// Audits that every user-visible text in TrainMeet TKL exists in all five
// languages (en, sv, da, nb, de) in the catalogue the app loads:
// src/i18n/messages.js (vendored from TrainMeet Server, translations/ui.txt)
// and src/i18n/workspace-messages.js (TKL's own rows).
//
//   node scripts/i18n-audit.mjs          summary; exit code 1 on any gap
//   node scripts/i18n-audit.mjs --list   every gap with file:line
//
// React has no annotate(): only t() translates. So:
//   missing    t("…") (also a ? "…" : "…", and local helpers that pass a
//              parameter on to t()), new Error("…") texts (shown with
//              t(error.message)) and other prose literals need a row with all
//              five languages;
//   unwrapped  JSX text, title/placeholder/aria-label/alt literals, literals
//              straight inside {…} in JSX and t(`…${x}…`) never pass t().
// The same rules as TrainMeet Server's tools/i18n-audit.mjs, which runs this
// file for its TKL report when the two checkouts sit side by side.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';

export const LOCALES = ['en', 'sv', 'da', 'nb', 'de'];
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ATTRIBUTES = ['title', 'placeholder', 'aria-label', 'alt'];

// ── What is language at all ───────────────────────────────────────────────
// Product names, codes and units read the same in every language.
const NEUTRAL_WORDS = new Set(['TrainMeet', 'Server', 'TMBox', 'TMBoxes', 'TMBoxar', 'TMBoxen', 'TKL', 'Cloud', 'US', 'EU',
  'Wi-Fi', 'WiFi', 'MQTT', 'QR', 'ID', 'OK', 'TWC', 'MP', 'ESP32', 'ESP8266', 'iPhone', 'iOS', 'Android', 'Raspberry', 'Pi',
  'Inter', 'Linux', 'macOS', 'Windows', 'GitHub', 'HTTP', 'HTTPS', 'URL', 'SSID', 'LCD', 'PIN', 'API', 'JSON', 'CSV', 'PDF',
  'v1', 'v2', 'UTC', 'Train', 'Meet', 'SE', 'DK', 'DE', 'NO', 'GB', 'FastClock', 'TrainMeetMessages', 'build']);
const LETTER = /[A-Za-zÅÄÖåäöÆØæøÜüßÉé]/;
const WORD = /[A-Za-zÅÄÖåäöÆØæøÜüßÉé0-9-]+/g;
export function isLanguage(text) {
  const stripped = String(text).replace(/__TM_ARG_\d+__/g, ' ').replace(/\{\w+\}/g, ' ');
  if (!LETTER.test(stripped) || /^\s*\/[\w/.-]*\s*$/.test(stripped) || /^\s*https?:\/\/\S+\s*$/.test(stripped)) return false; // a path or URL
  // Codes such as station signatures (CDA), track numbers (1a) and units (km/h).
  return (stripped.match(WORD) || []).some((word) => LETTER.test(word) && !NEUTRAL_WORDS.has(word)
    && !/^[A-ZÅÄÖ]{1,4}\d*$/.test(word) && !/^\d+[a-z]{0,2}$/.test(word) && !/^(km|h|min|s|ms|px|kB|MB|GB)$/.test(word)
    && !/^[a-z]$/.test(word));
}
// Prose: a word with å/ä/ö, or a capitalised phrase of at least two words.
// Selectors, class lists, identifiers, URLs, markup and CSS are not prose.
export function isProse(text) {
  const value = String(text).trim();
  if (!isLanguage(value) || /[<>]|=>|^[#.[/@]|https?:|[{};]\s*$|^\w+:\s|\b(?:var|calc|rgba?)\(/.test(value)) return false;
  if (/^[\w$.-]+$/.test(value) && !/[åäöÅÄÖ]/.test(value)) return false; // one identifier-like word
  if (/^[MmLlHhVvCcSsQqTtAaZz][\d\s.,MmLlHhVvCcSsQqTtAaZz-]*$/.test(value)) return false; // SVG path data
  if (value === value.toUpperCase()) return false; // all capitals: codes and LCD-style labels
  if (/^[a-z][\w-]*(?: [a-z][\w-]*)*$/.test(value) && !/[åäö]/.test(value)) return false; // class list / lowercase code
  return /[åäöÅÄÖæøÆØüÜß]/.test(value) || /^[A-ZÅÄÖ][^\s]*\s+\S/.test(value);
}
const normalizeKey = (text) => String(text).trim().replace(/\s+/g, ' ');


// ── TSX: React has no annotate(), only t(). JSX text is unwrapped. ────────
export function tsxStrings(text, file) {
  const sourceFile = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const found = [], captured = new Set();
  const lineOf = (node) => sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
  const isText = (node) => ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node);
  const parts = (node, result = {literals: [], idents: []}) => {
    if (!node) return result;
    if (isText(node)) result.literals.push(node);
    else if (ts.isIdentifier(node)) result.idents.push(node);
    else if (ts.isConditionalExpression(node)) { parts(node.whenTrue, result); parts(node.whenFalse, result); }
    else if (ts.isBinaryExpression(node) && [ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(node.operatorToken.kind)) { parts(node.left, result); parts(node.right, result); }
    else if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node)) parts(node.expression, result);
    else if (ts.isElementAccessExpression(node) && ts.isObjectLiteralExpression(node.expression)) {
      for (const property of node.expression.properties) if (ts.isPropertyAssignment(property) && isText(property.initializer)) result.literals.push(property.initializer);
    }
    return result;
  };
  const add = (node, kind, value = node.text) => { captured.add(node); if (isLanguage(value)) found.push({source: normalizeKey(value), line: lineOf(node), kind, file}); };
  const calleeName = (call) => ts.isIdentifier(call.expression) ? call.expression.text : null;
  const enclosing = (node) => { for (let p = node.parent; p; p = p.parent) if (ts.isFunctionDeclaration(p) || ts.isArrowFunction(p) || ts.isFunctionExpression(p)) return p; return null; };
  const nameOf = (fn) => fn.name?.text ?? (ts.isVariableDeclaration(fn.parent) && ts.isIdentifier(fn.parent.name) ? fn.parent.name.text : null);
  const wrappers = new Map();
  for (let round = 0; round < 4; round++) {
    const visit = (node) => {
      if (ts.isCallExpression(node)) {
        const callee = calleeName(node);
        const indices = callee === 't' ? new Set([0]) : wrappers.get(callee);
        if (indices) node.arguments.forEach((arg, index) => {
          if (!indices.has(index)) return;
          const fn = enclosing(node), name = fn && nameOf(fn);
          if (!name) return;
          const params = fn.parameters.map((parameter) => ts.isIdentifier(parameter.name) ? parameter.name.text : null);
          for (const ident of parts(arg).idents) if (params.includes(ident.text)) { if (!wrappers.has(name)) wrappers.set(name, new Set()); wrappers.get(name).add(params.indexOf(ident.text)); }
        });
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }
  const visit = (node) => {
    if (ts.isCallExpression(node)) {
      const callee = calleeName(node);
      const indices = callee === 't' ? new Set([0]) : wrappers.get(callee);
      if (indices) node.arguments.forEach((arg, index) => {
        if (!indices.has(index)) return;
        for (const literal of parts(arg).literals) add(literal, callee === 't' ? 't()' : callee + '()');
        if (ts.isTemplateExpression(arg) && isLanguage(arg.head.text + arg.templateSpans.map((span) => span.literal.text).join(' '))) add(arg, 'unwrapped', arg.getText(sourceFile));
      });
    }
    if (ts.isNewExpression(node) && node.expression.getText(sourceFile) === 'Error') for (const literal of parts(node.arguments?.[0]).literals) if (isProse(literal.text)) add(literal, 'Error()');
    if (ts.isJsxText(node) && isLanguage(node.text)) add(node, 'unwrapped', node.text);
    // {cond && "…"}, {a ?? "…"}, {x ? "…" : "…"} inside JSX: a literal straight onto the page.
    if (ts.isJsxExpression(node) && node.expression) {
      const shown = (expression) => !expression ? [] : isText(expression) ? [expression]
        : ts.isConditionalExpression(expression) ? [...shown(expression.whenTrue), ...shown(expression.whenFalse)]
        : ts.isParenthesizedExpression(expression) ? shown(expression.expression)
        : ts.isBinaryExpression(expression) && expression.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ? shown(expression.right)
        : ts.isBinaryExpression(expression) && [ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(expression.operatorToken.kind) ? [...shown(expression.left), ...shown(expression.right)]
        : [];
      for (const literal of shown(node.expression)) if (!captured.has(literal) && isLanguage(literal.text) && !(ts.isJsxAttribute(node.parent) && !ATTRIBUTES.includes(node.parent.name.getText(sourceFile)))) add(literal, 'unwrapped');
    }
    if (ts.isJsxAttribute(node) && ATTRIBUTES.includes(node.name.getText(sourceFile)) && node.initializer && ts.isStringLiteral(node.initializer)) add(node.initializer, 'unwrapped');
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  const inConsole = (node) => { for (let p = node.parent; p; p = p.parent) if (ts.isCallExpression(p) && /^console\./.test(p.expression.getText(sourceFile))) return true; return false; };
  const literals = (node) => {
    if (inConsole(node)) return;
    if (isText(node) && !captured.has(node) && isProse(node.text) && !ts.isImportDeclaration(node.parent) && !ts.isLiteralTypeNode(node.parent)
        && !(ts.isPropertyAssignment(node.parent) && node.parent.name === node)) found.push({source: normalizeKey(node.text), line: lineOf(node), kind: 'literal', file});
    if (ts.isTemplateExpression(node) && !captured.has(node) && [node.head, ...node.templateSpans.map((span) => span.literal)].some((part) => isProse(part.text))) {
      found.push({source: [node.head, ...node.templateSpans.map((span) => span.literal)].map((part) => part.text).join('${…}'), line: lineOf(node), kind: 'unwrapped', file});
    }
    ts.forEachChild(node, literals);
  };
  literals(sourceFile);
  return found;
}

// Prose literals that are not UI text, each with the reason.
export const IGNORE = new Map([
  ['Björkstad', 'Demo: a place name on the practice line (src/demo.ts), data.'],
  ['TKL Demo', 'Demo: the practice meet and terminal name (src/demo.ts), a name.'],
]);

export function loadCatalog(root = repo) {
  const context = {navigator: {languages: []}};
  context.globalThis = context;
  vm.createContext(context);
  for (const name of ['messages.js', 'workspace-messages.js']) vm.runInContext(fs.readFileSync(path.join(root, 'src/i18n', name), 'utf8'), context);
  return context.TrainMeetMessages || {};
}
export const lookup = (catalog, source) => catalog[source] || catalog[normalizeKey(source)] || null;

export function auditTkl({root = repo} = {}) {
  const catalog = loadCatalog(root), files = [];
  const walk = (dir) => { for (const entry of fs.readdirSync(dir, {withFileTypes: true})) { const file = path.join(dir, entry.name); if (entry.isDirectory()) walk(file); else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith('.d.ts')) files.push(file); } };
  walk(path.join(root, 'src'));
  const sources = new Map();
  for (const file of files.sort()) for (const item of tsxStrings(fs.readFileSync(file, 'utf8'), file)) {
    if (item.kind === 'literal' && IGNORE.has(item.source)) continue;
    if (!sources.has(item.source)) sources.set(item.source, {source: item.source, places: [], kinds: new Set()});
    const entry = sources.get(item.source);
    entry.places.push(`${path.relative(path.dirname(root), file)}:${item.line} ${item.kind}`);
    entry.kinds.add(item.kind === 'unwrapped' || item.kind === 'literal' ? item.kind : 'message');
  }
  const missing = [], unwrapped = [];
  for (const entry of sources.values()) {
    const row = lookup(catalog, entry.source), gaps = LOCALES.filter((locale) => !row?.[locale]);
    if (gaps.length && (entry.kinds.has('message') || entry.kinds.has('literal'))) missing.push({source: entry.source, missing: gaps, places: entry.places});
    if (entry.kinds.has('unwrapped')) unwrapped.push({source: entry.source, places: entry.places.filter((place) => place.endsWith(' unwrapped'))});
  }
  return {strings: sources.size, missing, unwrapped};
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = auditTkl();
  console.log(`TKL: ${result.strings} texts, ${result.missing.length} lacking a language, ${result.unwrapped.length} written without a lookup`);
  if (process.argv.includes('--list')) {
    for (const entry of result.missing) console.log(`  missing ${entry.missing.join(',')}: ${JSON.stringify(entry.source)}\n      ${entry.places.slice(0, 4).join('\n      ')}`);
    for (const entry of result.unwrapped) console.log(`  unwrapped: ${JSON.stringify(entry.source)}\n      ${entry.places.slice(0, 4).join('\n      ')}`);
  }
  process.exitCode = result.missing.length + result.unwrapped.length ? 1 : 0;
}
