import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const roots = [
  path.join(repoRoot, 'src/web/pages'),
  path.join(repoRoot, 'src/web/components'),
];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const fullPath = path.join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) return walk(fullPath);
    if (!entry.endsWith('.tsx')) return [];
    if (entry.includes('.test.')) return [];
    return [fullPath];
  });
}

function importPathFor(filePath: string): string {
  const relativePath = path.relative(path.dirname(filePath), path.join(repoRoot, 'src/web/components/ui/card/index.js'));
  return relativePath.startsWith('.') ? relativePath : `./${relativePath}`;
}

function ensureCardImport(source: string, filePath: string): string {
  const importPath = importPathFor(filePath);
  const existingImportPattern = new RegExp(`import \\{([^}]+)\\} from ['"]${escapeRegExp(importPath)}['"];`);
  const existing = source.match(existingImportPattern);
  if (existing) {
    const names = existing[1].split(',').map((item) => item.trim()).filter(Boolean);
    if (names.includes('Card')) return source;
    const nextNames = [...names, 'Card'].sort().join(', ');
    return source.replace(existingImportPattern, `import { ${nextNames} } from '${importPath}';`);
  }
  if (source.includes(`from '${importPath}'`) || source.includes(`from "${importPath}"`)) return source;
  const importLine = `import { Card } from '${importPath}';\n`;
  const importMatches = [...source.matchAll(/^import .*?;\n/gm)];
  if (importMatches.length === 0) return importLine + source;
  const last = importMatches[importMatches.length - 1];
  return source.slice(0, last.index! + last[0].length) + importLine + source.slice(last.index! + last[0].length);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function findTagEnd(source: string, start: number): number {
  let quote: '"' | "'" | '`' | null = null;
  let braceDepth = 0;
  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    const previous = source[index - 1];
    if (quote) {
      if (char === quote && previous !== '\\') quote = null;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      continue;
    }
    if (char === '{') braceDepth += 1;
    if (char === '}') braceDepth = Math.max(0, braceDepth - 1);
    if (char === '>' && braceDepth === 0) return index;
  }
  return -1;
}

function getAttribute(tag: string, name: string): string | null {
  const start = tag.search(new RegExp(`\\s${name}=`));
  if (start === -1) return null;
  let index = start + name.length + 2;
  const first = tag[index];
  if (first === '"' || first === "'") {
    const end = tag.indexOf(first, index + 1);
    return end === -1 ? null : tag.slice(index, end + 1);
  }
  if (first === '{') {
    let depth = 0;
    let quote: '"' | "'" | '`' | null = null;
    for (let cursor = index; cursor < tag.length; cursor += 1) {
      const char = tag[cursor];
      const previous = tag[cursor - 1];
      if (quote) {
        if (char === quote && previous !== '\\') quote = null;
        continue;
      }
      if (char === '"' || char === "'" || char === '`') {
        quote = char;
        continue;
      }
      if (char === '{') depth += 1;
      if (char === '}') {
        depth -= 1;
        if (depth === 0) return tag.slice(index, cursor + 1);
      }
    }
  }
  return null;
}

function replaceAttribute(tag: string, name: string, nextValue: string | null): string {
  const start = tag.search(new RegExp(`\\s${name}=`));
  if (start === -1) return nextValue ? tag.replace(/>$/, ` ${name}=${nextValue}>`) : tag;
  const value = getAttribute(tag, name);
  if (!value) return tag;
  const valueStart = tag.indexOf(value, start);
  if (!nextValue) return tag.slice(0, start) + tag.slice(valueStart + value.length);
  return tag.slice(0, valueStart) + nextValue + tag.slice(valueStart + value.length);
}

function normalizeClassName(value: string): string | null {
  if (value.startsWith('"') || value.startsWith("'")) {
    const quote = value[0];
    const classes = value.slice(1, -1).split(/\s+/).filter((item) => item && item !== 'card');
    return classes.length > 0 ? `${quote}${classes.join(' ')}${quote}` : null;
  }
  if (value.startsWith('{`') && value.endsWith('`}')) {
    const template = value.slice(2, -2).replace(/\bcard\s*/g, '').trim();
    return template ? '{`' + template + '`}' : null;
  }
  return value.includes('card') ? value.replace(/\bcard\s*/g, '') : value;
}

function hasCardToken(value: string): boolean {
  if (value.startsWith('"') || value.startsWith("'")) {
    return value.slice(1, -1).split(/\s+/).includes('card');
  }
  return /\bcard\b/.test(value);
}

function findMatchingClose(source: string, openEnd: number): number {
  let depth = 1;
  let cursor = openEnd + 1;
  while (cursor < source.length) {
    const nextOpen = source.indexOf('<div', cursor);
    const nextClose = source.indexOf('</div>', cursor);
    if (nextClose === -1) return -1;
    if (nextOpen !== -1 && nextOpen < nextClose) {
      const openEndInner = findTagEnd(source, nextOpen);
      if (openEndInner === -1) return -1;
      const innerTag = source.slice(nextOpen, openEndInner + 1);
      if (!innerTag.endsWith('/>')) depth += 1;
      cursor = openEndInner + 1;
      continue;
    }
    depth -= 1;
    if (depth === 0) return nextClose;
    cursor = nextClose + '</div>'.length;
  }
  return -1;
}

function migrateSource(source: string, filePath: string): { source: string; changed: boolean } {
  let output = '';
  let cursor = 0;
  let changed = false;

  while (cursor < source.length) {
    const openStart = source.indexOf('<div', cursor);
    if (openStart === -1) {
      output += source.slice(cursor);
      break;
    }
    const openEnd = findTagEnd(source, openStart);
    if (openEnd === -1) {
      output += source.slice(cursor);
      break;
    }
    const tag = source.slice(openStart, openEnd + 1);
    const className = getAttribute(tag, 'className');
    if (!className || !hasCardToken(className) || tag.endsWith('/>')) {
      output += source.slice(cursor, openEnd + 1);
      cursor = openEnd + 1;
      continue;
    }
    const closeStart = findMatchingClose(source, openEnd);
    if (closeStart === -1) {
      output += source.slice(cursor, openEnd + 1);
      cursor = openEnd + 1;
      continue;
    }
    const normalizedClassName = normalizeClassName(className);
    let nextTag = '<Card' + tag.slice('<div'.length);
    nextTag = replaceAttribute(nextTag, 'className', normalizedClassName);
    output += source.slice(cursor, openStart);
    output += nextTag;
    output += source.slice(openEnd + 1, closeStart);
    output += '</Card>';
    cursor = closeStart + '</div>'.length;
    changed = true;
  }

  return {
    source: changed ? ensureCardImport(output, filePath) : output,
    changed,
  };
}

let changedCount = 0;
for (const root of roots) {
  for (const filePath of walk(root)) {
    const source = readFileSync(filePath, 'utf8');
    const migrated = migrateSource(source, filePath);
    if (!migrated.changed) continue;
    writeFileSync(filePath, migrated.source);
    changedCount += 1;
  }
}

console.log(`Migrated cards in ${changedCount} files.`);
