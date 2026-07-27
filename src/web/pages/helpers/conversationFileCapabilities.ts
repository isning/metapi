import type { PlaygroundProtocol } from './modelTesterSession.js';
import {
  buildConversationAcceptList,
  detectConversationFileKind,
} from '../../../shared/conversationFileTypes.js';

import { tr } from '../../i18n.js';
export type ConversationFileTransportMode = 'native' | 'inline_only' | 'unsupported';

export type ConversationFileCapability = {
  supported: boolean;
  imageMode: ConversationFileTransportMode;
  audioMode: ConversationFileTransportMode;
  documentMode: ConversationFileTransportMode;
  reason: string;
};

type ConversationFileDescriptor = {
  filename?: string | null;
  mimeType?: string | null;
};

const isSupportedMode = (mode: ConversationFileTransportMode): boolean => mode !== 'unsupported';

function buildSupportedTypeLabel(capability: ConversationFileCapability): string {
  const labels: string[] = [];
  if (isSupportedMode(capability.documentMode)) labels.push('PDF / TXT / Markdown / JSON');
  if (isSupportedMode(capability.imageMode)) labels.push(tr('pages.helpers.conversationFileCapabilities.image'));
  if (isSupportedMode(capability.audioMode)) labels.push(tr('pages.helpers.conversationFileCapabilities.audio'));
  return labels.join(' / ');
}

function buildTransportNotes(capability: ConversationFileCapability): string[] {
  const notes: string[] = [];
  if (capability.documentMode === 'inline_only') notes.push(tr('pages.helpers.conversationFileCapabilities.documentsInjectedInlineData'));
  if (capability.imageMode === 'native' && capability.documentMode === 'inline_only') {
    notes.push(tr('pages.helpers.conversationFileCapabilities.imagesSentImageParts'));
  }
  if (capability.audioMode === 'native' && capability.documentMode === 'inline_only') {
    notes.push(tr('pages.helpers.conversationFileCapabilities.audioSentAudioParts'));
  }
  return notes;
}

export function resolveConversationFileCapability(
  protocol: PlaygroundProtocol,
): ConversationFileCapability {
  if (protocol === 'openai' || protocol === 'responses') {
    return {
      supported: true,
      imageMode: 'native',
      audioMode: 'native',
      documentMode: 'native',
      reason: '',
    };
  }

  if (protocol === 'claude') {
    return {
      supported: true,
      imageMode: 'native',
      audioMode: 'unsupported',
      documentMode: 'inline_only',
      reason: tr('pages.helpers.conversationFileCapabilities.sessionAttachmentsScreenSentInlineDocuments'),
    };
  }

  if (protocol === 'gemini') {
    return {
      supported: true,
      imageMode: 'native',
      audioMode: 'native',
      documentMode: 'inline_only',
      reason: tr('pages.helpers.conversationFileCapabilities.sessionAttachmentsScreenSentInlineDocuments'),
    };
  }

  return {
    supported: false,
    imageMode: 'unsupported',
    audioMode: 'unsupported',
    documentMode: 'unsupported',
    reason: tr('pages.modelTester.currentProtocolDoesNotSupportSessionAttachments'),
  };
}

export function buildConversationFileAccept(capability: ConversationFileCapability): string {
  return buildConversationAcceptList({
    document: isSupportedMode(capability.documentMode),
    image: isSupportedMode(capability.imageMode),
    audio: isSupportedMode(capability.audioMode),
  });
}

export function buildConversationFileHint(capability: ConversationFileCapability): string {
  if (!capability.supported) {
    return capability.reason || tr('pages.modelTester.currentProtocolDoesNotSupportSessionAttachments');
  }

  const typeLabel = buildSupportedTypeLabel(capability);
  if (!typeLabel) {
    return capability.reason || tr('pages.modelTester.currentProtocolDoesNotSupportSessionAttachments');
  }

  if (
    capability.documentMode === 'native'
    && capability.imageMode === 'native'
    && capability.audioMode === 'native'
  ) {
    return `支持 ${typeLabel}；发送前会先上传到 /v1/files。`;
  }

  const notes = buildTransportNotes(capability);
  if (notes.length <= 0) {
    return `支持 ${typeLabel}。`;
  }
  return `支持 ${typeLabel}；${notes.join('，')}。`;
}

export function isConversationUploadedFileSupported(
  capability: ConversationFileCapability,
  file: ConversationFileDescriptor,
): boolean {
  const kind = detectConversationFileKind(file);
  if (kind === 'document') return isSupportedMode(capability.documentMode);
  if (kind === 'image') return isSupportedMode(capability.imageMode);
  if (kind === 'audio') return isSupportedMode(capability.audioMode);
  return false;
}
