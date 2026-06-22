import { useEffect, useMemo, useState } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { json, jsonParseLinter } from '@codemirror/lang-json';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { linter, lintGutter } from '@codemirror/lint';
import { EditorView } from '@codemirror/view';
import { tags } from '@lezer/highlight';
import { cn } from '../lib/utils.js';
import { Textarea } from './ui/textarea/index.js';

type JsonCodeEditorProps = {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  readOnly?: boolean;
  minHeight?: number;
  maxHeight?: number;
  placeholder?: string;
  className?: string;
  ariaLabel?: string;
};

function useDarkMode() {
  const resolveDark = () => {
    if (typeof document === 'undefined' || !document.documentElement) return false;
    const root = document.documentElement;
    const theme = root.getAttribute('data-theme');
    if (theme === 'dark') return true;
    if (theme === 'light') return false;
    if (root.classList.contains('dark')) return true;
    return typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches === true;
  };
  const [dark, setDark] = useState(resolveDark);
  useEffect(() => {
    if (typeof document === 'undefined' || !document.documentElement) return undefined;
    const update = () => setDark(resolveDark());
    const observer = typeof MutationObserver === 'undefined'
      ? null
      : new MutationObserver(update);
    observer?.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme'] });
    const media = typeof window !== 'undefined' && window.matchMedia
      ? window.matchMedia('(prefers-color-scheme: dark)')
      : null;
    media?.addEventListener?.('change', update);
    update();
    return () => {
      observer?.disconnect();
      media?.removeEventListener?.('change', update);
    };
  }, []);
  return dark;
}

export default function JsonCodeEditor({
  value,
  onChange,
  disabled = false,
  readOnly = false,
  minHeight = 220,
  maxHeight = 520,
  placeholder,
  className,
  ariaLabel = 'JSON editor',
}: JsonCodeEditorProps) {
  const dark = useDarkMode();
  const canUseCodeMirror = (
    typeof window !== 'undefined'
    && typeof document !== 'undefined'
    && !!document.documentElement
    && !!document.body
    && typeof document.createElement === 'function'
  );

  if (!canUseCodeMirror) {
    return (
      <Textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled || readOnly}
        placeholder={placeholder}
        aria-label={ariaLabel}
        className={cn('min-w-0 max-w-full font-mono text-xs', className)}
        style={{ minHeight, maxHeight }}
      />
    );
  }
  const editorTheme = useMemo(() => EditorView.theme({
    '&': {
      minHeight: `${minHeight}px`,
      maxHeight: `${maxHeight}px`,
      width: '100%',
      maxWidth: '100%',
      fontSize: '12px',
      backgroundColor: 'var(--card)',
      color: 'var(--foreground)',
      border: '1px solid var(--input)',
      borderRadius: 'var(--radius-md)',
      overflow: 'hidden',
    },
    '&.cm-focused': {
      outline: 'none',
      borderColor: 'var(--ring)',
      boxShadow: '0 0 0 3px color-mix(in srgb, var(--ring) 22%, transparent)',
    },
    '.cm-editor': {
      backgroundColor: 'var(--card)',
      color: 'var(--foreground)',
    },
    '.cm-scroller': {
      minHeight: `${minHeight}px`,
      maxHeight: `${maxHeight}px`,
      maxWidth: '100%',
      overflow: 'auto',
      fontFamily: 'var(--font-mono)',
      backgroundColor: 'var(--card)',
    },
    '.cm-content': {
      minWidth: '0',
      padding: '10px 0',
      caretColor: 'var(--foreground)',
    },
    '.cm-cursor, .cm-dropCursor': {
      borderLeftColor: 'var(--foreground)',
    },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
      backgroundColor: 'color-mix(in srgb, var(--primary) 24%, transparent)',
    },
    '.cm-line': {
      padding: '0 12px',
      lineHeight: '1.55',
    },
    '.cm-gutters': {
      backgroundColor: 'color-mix(in srgb, var(--muted) 70%, var(--card))',
      color: 'var(--muted-foreground)',
      borderRight: '1px solid var(--border)',
    },
    '.cm-activeLine': {
      backgroundColor: 'color-mix(in srgb, var(--accent) 48%, transparent)',
    },
    '.cm-activeLineGutter': {
      backgroundColor: 'color-mix(in srgb, var(--accent) 62%, transparent)',
      color: 'var(--foreground)',
    },
    '.cm-placeholder': {
      color: 'var(--muted-foreground)',
    },
    '.cm-lintRange-error': {
      backgroundImage: 'linear-gradient(45deg, transparent 65%, var(--destructive) 80%, transparent 90%)',
    },
    '.cm-diagnostic': {
      borderLeft: '3px solid var(--destructive)',
    },
    '.cm-tooltip, .cm-tooltip-autocomplete': {
      border: '1px solid var(--border)',
      backgroundColor: 'var(--popover)',
      color: 'var(--popover-foreground)',
      borderRadius: 'var(--radius-md)',
      boxShadow: 'var(--shadow-md)',
    },
    '.cm-tooltip-autocomplete ul li[aria-selected]': {
      backgroundColor: 'var(--accent)',
      color: 'var(--accent-foreground)',
    },
    '&[data-disabled="true"]': {
      opacity: '0.55',
    },
  }, { dark }), [dark, maxHeight, minHeight]);

  const syntaxTheme = useMemo(() => syntaxHighlighting(HighlightStyle.define([
    { tag: [tags.propertyName, tags.attributeName], color: 'var(--info)' },
    { tag: [tags.string, tags.special(tags.string)], color: 'var(--success)' },
    { tag: [tags.number, tags.bool, tags.null], color: 'var(--warning)' },
    { tag: [tags.keyword, tags.operatorKeyword], color: 'var(--primary)' },
    { tag: [tags.punctuation, tags.separator], color: 'var(--muted-foreground)' },
    { tag: [tags.invalid], color: 'var(--destructive)' },
  ])), []);

  return (
    <div className={cn('json-code-editor min-w-0 w-full max-w-full overflow-hidden', className)} data-disabled={disabled || readOnly ? 'true' : undefined}>
      <CodeMirror
        value={value}
        onChange={onChange}
        editable={!disabled && !readOnly}
        readOnly={readOnly}
        basicSetup={{
          foldGutter: true,
          lineNumbers: true,
          highlightActiveLine: true,
          highlightSelectionMatches: true,
          autocompletion: true,
          closeBrackets: true,
          bracketMatching: true,
        }}
        extensions={[json(), lintGutter(), linter(jsonParseLinter()), editorTheme, syntaxTheme]}
        theme="none"
        placeholder={placeholder}
        aria-label={ariaLabel}
      />
    </div>
  );
}
