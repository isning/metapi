import { describe, expect, it } from 'vitest';
import ts from 'typescript';
import { readFileSync } from 'node:fs';
import { globSync } from 'node:fs';
import { translateText } from './i18n.js';

const HAS_HAN_RE = /[\u3400-\u9fff]/;
const I18N_KEY_RE = /^[a-z][A-Za-z0-9]*(?:\.[A-Za-z0-9]+)+$/;
const RUNTIME_TRANSLATION_CALLS = new Set(['t', 'tr', 'translateText']);
const FORBIDDEN_I18N_PATTERNS = [
  'legacy.',
  'legacySemantic.',
  'autoI18n.',
  'i18nKey',
  'legacyKeyToZh',
  'zhToEn',
  'zhToEnSupplemental',
];

const ALLOWED_RUNTIME_CHINESE_LITERALS = new Set([
  'src/web/App.tsx:管理员',
  'src/web/pages/Sites.tsx:其他',
]);

const RUNTIME_SOURCE_GLOB_OPTIONS = {
  exclude: [
    'src/web/**/*.test.*',
    'src/web/i18n.tsx',
    'src/web/i18n/resources/**/*.ts',
  ],
} as const;

function runtimeSourceFiles() {
  return globSync('src/web/**/*.{ts,tsx}', RUNTIME_SOURCE_GLOB_OPTIONS).sort();
}

function createSourceFile(file: string) {
  return ts.createSourceFile(
    file,
    readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

function collectRuntimeTranslationKeys() {
  const values = new Map<string, Set<string>>();

  for (const file of runtimeSourceFiles()) {
    const sf = createSourceFile(file);
    const visit = (node: ts.Node) => {
      if (
        ts.isCallExpression(node)
        && ts.isIdentifier(node.expression)
        && RUNTIME_TRANSLATION_CALLS.has(node.expression.text)
        && node.arguments[0]
        && ts.isStringLiteralLike(node.arguments[0])
      ) {
        const value = node.arguments[0].text;
        if (I18N_KEY_RE.test(value)) {
          if (!values.has(value)) values.set(value, new Set());
          values.get(value)!.add(file);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }

  return values;
}

describe('translateText', () => {
  it('translates migrated domain keys', () => {
    expect(translateText('app.modelMarketplace', 'zh')).toBe('模型广场');
    expect(translateText('app.modelMarketplace', 'en')).toBe('Model Marketplace');
    expect(translateText('upstreamCompatibility.title', 'zh')).toBe('上游兼容性');
    expect(translateText('upstreamCompatibility.title', 'en')).toBe('Upstream compatibility');
    expect(translateText('upstreamCostPricing.title', 'zh')).toBe('上游模型成本');
    expect(translateText('upstreamCostPricing.title', 'en')).toBe('Upstream Model Cost');
  });

  it('returns unknown keys unchanged', () => {
    expect(translateText('missing.key', 'zh')).toBe('missing.key');
    expect(translateText('missing.key', 'en')).toBe('missing.key');
  });

  it('resolves every runtime i18next key in zh and en', () => {
    const missing: string[] = [];

    for (const [key, files] of collectRuntimeTranslationKeys()) {
      const zh = translateText(key, 'zh');
      const en = translateText(key, 'en');
      if (zh !== key && en !== key && !HAS_HAN_RE.test(en)) continue;
      missing.push(`${key} -> zh:${zh} en:${en} (${[...files].sort().join(', ')})`);
    }

    expect(missing).toEqual([]);
  });

  it('keeps explicit translation calls on named keys instead of Chinese source literals', () => {
    const violations: string[] = [];

    for (const file of runtimeSourceFiles()) {
      const sf = createSourceFile(file);
      const visit = (node: ts.Node) => {
        if (
          ts.isCallExpression(node)
          && ts.isIdentifier(node.expression)
          && RUNTIME_TRANSLATION_CALLS.has(node.expression.text)
          && node.arguments[0]
          && ts.isStringLiteralLike(node.arguments[0])
          && HAS_HAN_RE.test(node.arguments[0].text)
        ) {
          violations.push(`${node.arguments[0].text} (${file})`);
        }
        ts.forEachChild(node, visit);
      };
      visit(sf);
    }

    expect(violations).toEqual([]);
  });

  it('keeps remaining runtime Chinese literals limited to explicit data constants', () => {
    const violations: string[] = [];

    for (const file of runtimeSourceFiles()) {
      const sf = createSourceFile(file);
      const visit = (node: ts.Node) => {
        if (ts.isStringLiteralLike(node) && HAS_HAN_RE.test(node.text)) {
          const allowedKey = `${file}:${node.text}`;
          if (!ALLOWED_RUNTIME_CHINESE_LITERALS.has(allowedKey)) {
            violations.push(`${file}:${sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1} ${node.text}`);
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(sf);
    }

    expect(violations).toEqual([]);
  });

  it('keeps production code off legacy i18n compatibility APIs', () => {
    const violations: string[] = [];

    for (const file of runtimeSourceFiles()) {
      const source = readFileSync(file, 'utf8');
      for (const pattern of FORBIDDEN_I18N_PATTERNS) {
        if (source.includes(pattern)) violations.push(`${file}: ${pattern}`);
      }
    }

    expect(violations).toEqual([]);
  });
});
