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

function importPathFor(filePath: string, target: string): string {
  const relativePath = path.relative(path.dirname(filePath), path.join(repoRoot, target));
  return relativePath.startsWith('.') ? relativePath : `./${relativePath}`;
}

function ensureNamedImport(source: string, filePath: string, target: string, name: string): string {
  const importPath = importPathFor(filePath, target);
  const existingImportPattern = new RegExp(`import \\{([^}]+)\\} from ['"]${escapeRegExp(importPath)}['"];`);
  const existing = source.match(existingImportPattern);
  if (existing) {
    const names = existing[1].split(',').map((item) => item.trim()).filter(Boolean);
    if (names.includes(name)) return source;
    const nextNames = [...names, name].sort().join(', ');
    return source.replace(existingImportPattern, `import { ${nextNames} } from '${importPath}';`);
  }
  if (source.includes(`from '${importPath}'`) || source.includes(`from "${importPath}"`)) return source;
  const importLine = `import { ${name} } from '${importPath}';\n`;
  const importMatches = [...source.matchAll(/^import .*?;\n/gm)];
  if (importMatches.length === 0) return importLine + source;
  const last = importMatches[importMatches.length - 1];
  return source.slice(0, last.index! + last[0].length) + importLine + source.slice(last.index! + last[0].length);
}

function ensureLucideImport(source: string): string {
  const existing = source.match(/import \{([^}]+)\} from ['"]lucide-react['"];/);
  if (existing) {
    const names = existing[1].split(',').map((item) => item.trim()).filter(Boolean);
    if (names.includes('LoaderCircle')) return source;
    const nextNames = [...names, 'LoaderCircle'].sort().join(', ');
    return source.replace(/import \{([^}]+)\} from ['"]lucide-react['"];/, `import { ${nextNames} } from 'lucide-react';`);
  }
  const importLine = "import { LoaderCircle } from 'lucide-react';\n";
  const importMatches = [...source.matchAll(/^import .*?;\n/gm)];
  if (importMatches.length === 0) return importLine + source;
  const last = importMatches[importMatches.length - 1];
  return source.slice(0, last.index! + last[0].length) + importLine + source.slice(last.index! + last[0].length);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function migrateSource(source: string, filePath: string): { source: string; changed: boolean } {
  let next = source;

  next = next.replace(/<span\s+className="spinner spinner-sm"\s*\/>/g, '<LoaderCircle className="size-4 animate-spin" />');
  next = next.replace(/<span\s+className="spinner"\s*\/>/g, '<LoaderCircle className="size-5 animate-spin" />');
  next = next.replace(/<span\s+className="spinner spinner-sm"\s*><\/span>/g, '<LoaderCircle className="size-4 animate-spin" />');
  next = next.replace(/<span\s+className="spinner"\s*><\/span>/g, '<LoaderCircle className="size-5 animate-spin" />');
  next = next.replace(
    /<span\s+className="spinner spinner-sm"\s+style=\{\{[^}]*\}\}\s*\/>/g,
    '<LoaderCircle className="size-4 animate-spin" />',
  );
  next = next.replace(
    /<span\s+className="spinner spinner-sm"\s+style=\{\{[^}]*\}\}\s*><\/span>/g,
    '<LoaderCircle className="size-4 animate-spin" />',
  );

  next = next.replace(
    /<div\s+className="skeleton"\s+style=\{\{\s*width:\s*([^,}]+),\s*height:\s*([^,}]+)(?:,\s*borderRadius:\s*[^,}]+)?(?:,\s*marginBottom:\s*([^,}]+))?\s*\}\}\s*\/>/g,
    (_match, width, height, marginBottom) => `<Skeleton className="${marginBottom ? 'mb-2 ' : ''}w-full" style={{ width: ${width}, height: ${height} }} />`,
  );

  const changed = next !== source;
  if (changed && next.includes('<LoaderCircle')) {
    next = ensureLucideImport(next);
  }
  if (changed && next.includes('<Skeleton')) {
    next = ensureNamedImport(next, filePath, 'src/web/components/ui/skeleton/index.js', 'Skeleton');
  }
  return { source: next, changed };
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

console.log(`Migrated loading indicators in ${changedCount} files.`);
