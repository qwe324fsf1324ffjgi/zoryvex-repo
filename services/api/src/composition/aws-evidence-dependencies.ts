import { randomUUID } from 'node:crypto';
import { SystemClock } from '../repositories/clock-repository';
import {
  createPendingFile,
  getFile,
  markFileClean,
  markFileRejected,
} from '../repositories/evidence-file-repository';
import {
  createEvidenceDownloadUrl,
  createEvidenceUploadPost,
} from '../repositories/s3-presign-repository';
import { deleteObject, getObjectBytes, putObject } from '../repositories/s3-object-repository';
import { appendAuditEvent } from '../repositories/audit-event-repository';
import type { EvidenceUploadDependencies } from '../domain/evidence-upload-service';
import type { EvidenceDownloadDependencies } from '../domain/evidence-download-service';
import type { EvidenceScanDependencies } from '../domain/evidence-scan-service';

function evidenceBucket(): string {
  const name = process.env.EVIDENCE_BUCKET_NAME;
  if (!name) throw new Error('EVIDENCE_BUCKET_NAME environment variable is not set');
  return name;
}

export function createAwsEvidenceUploadDependencies(): EvidenceUploadDependencies {
  return {
    clock: new SystemClock(),
    createPendingFile,
    createUploadPost: (input) => createEvidenceUploadPost({ bucket: evidenceBucket(), ...input }),
  };
}

export function createAwsEvidenceDownloadDependencies(): EvidenceDownloadDependencies {
  return {
    getFile,
    createDownloadUrl: (input) => createEvidenceDownloadUrl({ bucket: evidenceBucket(), ...input }),
  };
}

export function createAwsEvidenceScanDependencies(): EvidenceScanDependencies {
  return {
    clock: new SystemClock(),
    getFile,
    markFileClean,
    markFileRejected,
    getObjectBytes,
    putAcceptedObject: putObject,
    deleteObject,
    appendAuditEvent,
    generateId: randomUUID,
  };
}
