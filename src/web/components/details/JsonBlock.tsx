import { Copy } from 'lucide-react';
import { Button } from '../ui/button/index.js';

type JsonBlockProps = {
  value: unknown;
  onCopy?: (text: string) => void;
};

export default function JsonBlock({ value, onCopy }: JsonBlockProps) {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  return (
    <div className="grid gap-2">
      <div className="flex justify-end">
        <Button type="button" variant="outline" size="sm" onClick={() => onCopy?.(text)}>
          <Copy className="size-4" />
          Copy
        </Button>
      </div>
      <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-md border bg-muted p-3 font-mono text-xs">
        {text}
      </pre>
    </div>
  );
}
