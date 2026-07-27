import type { CompiledRuntimeJsonValue } from './compiledRuntimeRequest.js';

export type ModelTesterProxyMethod = 'POST' | 'GET' | 'DELETE';

export type ModelTesterProxyMultipartFile = {
  field: string;
  name: string;
  mimeType: string;
  dataUrl: string;
};

type ModelTesterProxyEnvelopeBase = {
  method: ModelTesterProxyMethod;
  path: string;
  stream?: boolean;
  jobMode?: boolean;
  forcedExecutionAttemptId?: string | null;
};

export type ModelTesterProxyEnvelope =
  | (ModelTesterProxyEnvelopeBase & {
      requestKind: 'json';
      rawMode?: false;
      jsonBody?: CompiledRuntimeJsonValue;
      rawJsonText?: never;
      multipartFields?: never;
      multipartFiles?: never;
    })
  | (ModelTesterProxyEnvelopeBase & {
      requestKind: 'json';
      rawMode: true;
      rawJsonText: string;
      jsonBody?: never;
      multipartFields?: never;
      multipartFiles?: never;
    })
  | (ModelTesterProxyEnvelopeBase & {
      requestKind: 'multipart';
      rawMode?: false;
      jsonBody?: never;
      rawJsonText?: never;
      multipartFields?: Record<string, string>;
      multipartFiles?: ModelTesterProxyMultipartFile[];
    })
  | (ModelTesterProxyEnvelopeBase & {
      requestKind: 'empty';
      rawMode?: false;
      jsonBody?: never;
      rawJsonText?: never;
      multipartFields?: never;
      multipartFiles?: never;
    });

export type ModelTesterProxyJobStatus =
  | 'pending'
  | 'succeeded'
  | 'failed'
  | 'cancelled';

export type ModelTesterProxyJobCreated = {
  jobId: string;
  status: 'pending';
  createdAt: string;
  expiresAt: string;
};

export type ModelTesterProxyJob = {
  jobId: string;
  status: ModelTesterProxyJobStatus;
  result?: unknown;
  error?: unknown;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
};

export type ModelTesterProxyDeleteResult = { success: true };

export type ModelTesterProxyCommandErrorCode =
  | 'model_tester_payload_invalid'
  | 'model_tester_path_required'
  | 'model_tester_path_not_allowed'
  | 'model_tester_method_body_not_allowed'
  | 'model_tester_json_body_invalid'
  | 'model_tester_raw_json_required'
  | 'model_tester_multipart_body_required'
  | 'model_tester_multipart_file_invalid'
  | 'model_tester_job_not_found';

export type ModelTesterProxyCommandError = {
  success: false;
  code: ModelTesterProxyCommandErrorCode;
  params: Record<string, string | number | boolean | null>;
};
