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
  const relativePath = path.relative(path.dirname(filePath), path.join(repoRoot, 'src/web/components/ToneBadge.js'));
  return relativePath.startsWith('.') ? relativePath : `./${relativePath}`;
}

function ensureToneBadgeImport(source: string, filePath: string): string {
  if (source.includes('ToneBadge.js')) return source;
  const importLine = `import ToneBadge from '${importPathFor(filePath)}';\n`;
  const importMatches = [...source.matchAll(/^import .*?;\n/gm)];
  if (importMatches.length === 0) return importLine + source;
  const last = importMatches[importMatches.length - 1];
  return source.slice(0, last.index! + last[0].length) + importLine + source.slice(last.index! + last[0].length);
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

function removeAttribute(tag: string, name: string): string {
  const start = tag.search(new RegExp(`\\s${name}=`));
  if (start === -1) return tag;
  const value = getAttribute(tag, name);
  if (!value) return tag;
  const valueStart = tag.indexOf(value, start);
  return tag.slice(0, start) + tag.slice(valueStart + value.length);
}

function isBadgeClass(value: string): boolean {
  if (value.includes('badge-link')) return false;
  if (value.startsWith('"') || value.startsWith("'")) {
    return value.slice(1, -1).split(/\s+/).includes('badge');
  }
  if (value.startsWith('{`')) return value.includes('badge ');
  return false;
}

function toneExpression(value: string): string {
  if (value.startsWith('"') || value.startsWith("'")) {
    return JSON.stringify(value.slice(1, -1).replace(/\bbadge\b/g, '').trim());
  }
  if (value.startsWith('{`') && value.endsWith('`}')) {
    const template = value.slice(1, -1);
    return `{${template}.replace(/\\bbadge\\b/g, '').trim()}`;
  }
  return '""';
}

function migrateSource(source: string, filePath: string): { source: string; changed: boolean } {
  let cursor = 0;
  let output = '';
  let changed = false;

  while (cursor < source.length) {
    const openStart = source.indexOf('<span', cursor);
    if (openStart === -1) {
      output += source.slice(cursor);
      break;
    }
    const openEnd = findTagEnd(source, openStart);
    if (openEnd === -1) {
      output += source.slice(cursor);
      break;
    }
    const closeStart = source.indexOf('</span>', openEnd + 1);
    if (closeStart === -1) {
      output += source.slice(cursor, openEnd + 1);
      cursor = openEnd + 1;
      continue;
    }
    const tag = source.slice(openStart, openEnd + 1);
    const className = getAttribute(tag, 'className');
    if (!className || !isBadgeClass(className)) {
      output += source.slice(cursor, openEnd + 1);
      cursor = openEnd + 1;
      continue;
    }
    let nextTag = '<ToneBadge' + tag.slice('<span'.length, -1);
    nextTag = removeAttribute(nextTag, 'className');
    nextTag = removeAttribute(nextTag, 'style');
    nextTag = nextTag.replace(/^<ToneBadge/, `<ToneBadge tone=${toneExpression(className)}`);
    nextTag = nextTag.replace(/\s+>/, '>');

    output += source.slice(cursor, openStart);
    output += nextTag + '>';
    output += source.slice(openEnd + 1, closeStart);
    output += '</ToneBadge>';
    cursor = closeStart + '</span>'.length;
    changed = true;
  }

  return {
    source: changed ? ensureToneBadgeImport(output, filePath) : output,
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

console.log(`Migrated badges in ${changedCount} files.`);
