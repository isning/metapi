import React from 'react';
import type { ConversationDraftFile } from '../helpers/modelTesterSession.js';
import { Button } from '../../components/ui/button/index.js';
import { Input } from '../../components/ui/input/index.js';
import { Textarea } from '../../components/ui/textarea/index.js';

type ConversationCapability = {
  supported: boolean;
  reason?: string | null;
};

type ConversationComposerProps = {
  isMobile: boolean;
  sending: boolean;
  customRequestMode: boolean;
  conversationFileCapability: ConversationCapability;
  conversationFileSupported: boolean;
  conversationFileAccept: string;
  conversationFileHint: string;
  conversationFiles: ConversationDraftFile[];
  conversationFileInputRef: React.RefObject<HTMLInputElement>;
  input: string;
  canSend: boolean;
  onInputChange: (value: string) => void;
  onFilesChange: (fileList: FileList | null) => Promise<void> | void;
  onRemoveConversationFile: (localId: string) => void;
  onSend: () => Promise<void> | void;
  onStop: () => Promise<void> | void;
};

export default function ConversationComposer({
  isMobile,
  sending,
  customRequestMode,
  conversationFileCapability,
  conversationFileSupported,
  conversationFileAccept,
  conversationFileHint,
  conversationFiles,
  conversationFileInputRef,
  input,
  canSend,
  onInputChange,
  onFilesChange,
  onRemoveConversationFile,
  onSend,
  onStop,
}: ConversationComposerProps) {
  return (
    <div className={`flex gap-3 ${isMobile ? 'flex-col items-stretch' : 'items-end'}`}>
      <div className="flex flex-1 flex-col gap-2">
        <div className="rounded-md border bg-muted/40 px-3 py-2">
          <Input
            ref={conversationFileInputRef}
            type="file"
            multiple
            accept={conversationFileAccept}
            className="hidden"
            onChange={(event) => {
              void onFilesChange(event.target.files);
              event.target.value = '';
            }}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline"
              type="button"
             
             
              disabled={sending || customRequestMode || !conversationFileSupported}
              onClick={() => conversationFileInputRef.current?.click()}
            >
              添加文件
            </Button>
            <span className="text-xs text-muted-foreground">
              {customRequestMode
                ? '自定义请求模式不会自动上传这些附件；关闭自定义模式后可走标准 /v1/files 链路。'
                : !conversationFileSupported
                  ? (conversationFileCapability.reason || '当前协议暂不支持会话附件注入。')
                  : conversationFileHint}
            </span>
          </div>
          {conversationFiles.length > 0 ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {conversationFiles.map((file) => {
                const statusText = file.status === 'uploading'
                  ? '上传中'
                  : file.status === 'uploaded'
                    ? '已上传'
                    : file.status === 'error'
                      ? '失败'
                      : '待上传';
                const statusClass = file.status === 'error'
                  ? 'text-destructive'
                  : file.status === 'uploaded'
                    ? 'text-foreground'
                    : 'text-muted-foreground';

                return (
                  <span
                    key={file.localId}
                    className="inline-flex max-w-full items-center gap-1.5 rounded-full border bg-card px-2.5 py-1 text-xs"
                    title={file.errorMessage || file.fileId || file.name}
                  >
                    <span>📎</span>
                    <span className="max-w-56 truncate">
                      {file.name}
                    </span>
                    <span className={statusClass}>· {statusText}</span>
                    {!sending ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => onRemoveConversationFile(file.localId)}
                        aria-label={`移除附件 ${file.name || file.localId || '附件'}`}
                      >
                        ×
                      </Button>
                    ) : null}
                  </span>
                );
              })}
            </div>
          ) : null}
        </div>

        <Textarea
          value={input}
          onChange={(event) => onInputChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              if (sending) {
                void onStop();
                return;
              }
              void onSend();
            }
          }}
          placeholder={customRequestMode
            ? '自定义模式下输入可选。回车发送时将优先使用右侧自定义请求体。'
            : '输入提示词，或只上传文件后直接发送…（回车发送，Shift+回车换行）'}
          rows={3}
          className="flex-1 resize-none"
        />
      </div>
      <Button type="button"
        onClick={() => {
          if (sending) {
            void onStop();
            return;
          }
          void onSend();
        }}
        disabled={sending ? false : !canSend}
       
       
      >
        {sending ? (
          <>
            <span className="text-lg leading-none">■</span>
            <span className="text-xs">停止</span>
          </>
        ) : (
          <>
            <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
            </svg>
            <span className="text-xs">发送</span>
          </>
        )}
      </Button>
    </div>
  );
}
