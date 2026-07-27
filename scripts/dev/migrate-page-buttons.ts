import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const pagesRoot = path.join(repoRoot, 'src/web/pages');

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
    if (char === '{') {
      braceDepth += 1;
      continue;
    }
    if (char === '}') {
      braceDepth = Math.max(0, braceDepth - 1);
      continue;
    }
    if (char === '>' && braceDepth === 0) return index;
  }
  return -1;
}

function findMatchingClose(source: string, openEnd: number): number {
  let depth = 1;
  let cursor = openEnd + 1;
  while (cursor < source.length) {
    const nextOpen = source.indexOf('<button', cursor);
    const nextClose = source.indexOf('</button>', cursor);
    if (nextClose === -1) return -1;
    if (nextOpen !== -1 && nextOpen < nextClose) {
      depth += 1;
      cursor = nextOpen + '<button'.length;
      continue;
    }
    depth -= 1;
    if (depth === 0) return nextClose;
    cursor = nextClose + '</button>'.length;
  }
  return -1;
}

function getAttribute(tag: string, name: string): string | null {
  const start = tag.search(new RegExp(`\\s${name}=`));
  if (start === -1) return null;
  let index = start + name.length + 2;
  while (tag[index] === ' ') index += 1;
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
  const end = tag.slice(index).search(/\s/);
  return end === -1 ? tag.slice(index) : tag.slice(index, index + end);
}

function removeAttribute(tag: string, name: string): string {
  const start = tag.search(new RegExp(`\\s${name}=`));
  if (start === -1) return tag;
  const value = getAttribute(tag, name);
  if (!value) return tag;
  const absoluteValueStart = tag.indexOf(value, start);
  return tag.slice(0, start) + tag.slice(absoluteValueStart + value.length);
}

function classText(value: string): string {
  if (value.startsWith('{`') && value.endsWith('`}')) return value.slice(2, -2);
  if (value.startsWith('"') || value.startsWith("'")) return value.slice(1, -1);
  return value;
}

function buttonProps(className: string, hasType: boolean): string {
  const text = classText(className);
  const variant = text.includes('btn-link-danger') || text.includes('btn-danger')
    ? 'destructive'
    : text.includes('btn-link-warning')
      ? 'secondary'
      : text.includes('btn-primary') || text.includes('btn-success') || text.includes('btn-soft-primary')
        ? 'default'
        : text.includes('btn-link')
          ? 'ghost'
          : 'outline';
  const size = text.includes('btn-sm') || text.includes('btn-link') ? 'sm' : undefined;
  return [
    hasType ? null : 'type="button"',
    variant === 'default' ? null : `variant="${variant}"`,
    size ? `size="${size}"` : null,
  ].filter(Boolean).join(' ');
}

function importPathFor(filePath: string): string {
  const relativeDir = path.relative(path.dirname(filePath), path.join(repoRoot, 'src/web/components/ui/button/index.js'));
  return relativeDir.startsWith('.') ? relativeDir : `./${relativeDir}`;
}

function ensureButtonImport(source: string, filePath: string): string {
  if (source.includes("components/ui/button/index.js")) return source;
  const importPath = importPathFor(filePath);
  const importLine = `import { Button } from '${importPath}';\n`;
  const importMatches = [...source.matchAll(/^import .*?;\n/gm)];
  if (importMatches.length === 0) return importLine + source;
  const last = importMatches[importMatches.length - 1];
  return source.slice(0, last.index! + last[0].length) + importLine + source.slice(last.index! + last[0].length);
}

function migrateSource(source: string, filePath: string): { source: string; changed: boolean } {
  let changed = false;
  let cursor = 0;
  let output = '';

  while (cursor < source.length) {
    const openStart = source.indexOf('<button', cursor);
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
    if (!className || !classText(className).includes('btn')) {
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

    const hasType = /\stype=/.test(tag);
    const shadcnProps = buttonProps(className, hasType);
    let nextTag = '<Button' + tag.slice('<button'.length, -1);
    nextTag = removeAttribute(nextTag, 'className');
    nextTag = removeAttribute(nextTag, 'style');
    nextTag = shadcnProps ? nextTag.replace(/^<Button/, `<Button ${shadcnProps}`) : nextTag;
    nextTag = nextTag.replace(/\s+>/, '>');

    output += source.slice(cursor, openStart);
    output += nextTag + '>';
    output += source.slice(openEnd + 1, closeStart);
    output += '</Button>';
    cursor = closeStart + '</button>'.length;
    changed = true;
  }

  return {
    source: changed ? ensureButtonImport(output, filePath) : output,
    changed,
  };
}

let changedCount = 0;
for (const filePath of walk(pagesRoot)) {
  const source = readFileSync(filePath, 'utf8');
  const migrated = migrateSource(source, filePath);
  if (!migrated.changed) continue;
  writeFileSync(filePath, migrated.source);
  changedCount += 1;
}

console.log(`Migrated page buttons in ${changedCount} files.`);
