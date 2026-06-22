import React from 'react';
import type { ConversationDraftFile } from '../helpers/modelTesterSession.js';
import { Button } from '../../components/ui/button/index.js';
import { Input } from '../../components/ui/input/index.js';
import { Textarea } from '../../components/ui/textarea/index.js';

import { tr } from '../../i18n.js';
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
              {tr('pages.modelTester.conversationComposer.add')}
            </Button>
            <span className="text-xs text-muted-foreground">
              {customRequestMode
                ? tr('pages.modelTester.conversationComposer.customRequestmodeAutomaticAttachmentsCloseModeV1')
                : !conversationFileSupported
                  ? (conversationFileCapability.reason || tr('pages.modelTester.conversationComposer.currentProtocolDoesNotSupportSessionAttachment'))
                  : conversationFileHint}
            </span>
          </div>
          {conversationFiles.length > 0 ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {conversationFiles.map((file) => {
                const statusText = file.status === 'uploading'
                  ? tr('pages.modelTester.conversationComposer.zh')
                  : file.status === 'uploaded'
                    ? tr('pages.modelTester.conversationComposer.uploaded')
                    : file.status === 'error'
                      ? tr('pages.checkinLog.failed')
                      : tr('pages.modelTester.conversationComposer.pendingUpload');
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
                        aria-label={`移除附件 ${file.name || file.localId || tr('pages.modelTester.attachments')}`}
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
            ? tr('pages.modelTester.conversationComposer.modeInputSendUsageCustomRequest')
            : tr('pages.modelTester.conversationComposer.inputtipSendSendShift')}
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
            <span className="text-xs">{tr('pages.modelTester.stop')}</span>
          </>
        ) : (
          <>
            <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
            </svg>
            <span className="text-xs">{tr('pages.modelTester.conversationComposer.send')}</span>
          </>
        )}
      </Button>
    </div>
  );
}
