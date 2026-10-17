import type { SQSHandler } from 'aws-lambda';
import { processScanResult, type ScanResultEvent } from '../../src/domain/evidence-scan-service';
import { createAwsEvidenceScanDependencies } from '../../src/composition/aws-evidence-dependencies';

const deps = createAwsEvidenceScanDependencies();

interface GuardDutyScanResultDetail {
  scanStatus: 'COMPLETED' | 'SKIPPED' | 'FAILED';
  resourceType: string;
  s3ObjectDetails: { bucketName: string; objectKey: string };
  scanResultDetails: {
    scanResultStatus: ScanResultEvent['scanResultStatus'];
    statusReasons: string[] | null;
  };
}

/**
 * SQS-triggered (EventBridge → evidence_processing queue). Never trusts the
 * message blindly — re-checks the envelope shape even though the
 * EventBridge rule is already scoped to exactly this detail-type/bucket, in
 * case the rule is ever loosened without this handler being reviewed too.
 */
export const handler: SQSHandler = async (event) => {
  for (const record of event.Records) {
    const envelope = JSON.parse(record.body) as {
      'detail-type'?: string;
      detail?: GuardDutyScanResultDetail;
    };
    if (
      envelope['detail-type'] !== 'GuardDuty Malware Protection Object Scan Result' ||
      !envelope.detail ||
      envelope.detail.resourceType !== 'S3_OBJECT'
    ) {
      continue;
    }

    const { detail } = envelope;
    await processScanResult(
      {
        bucket: detail.s3ObjectDetails.bucketName,
        objectKey: detail.s3ObjectDetails.objectKey,
        scanStatus: detail.scanStatus,
        scanResultStatus: detail.scanResultDetails.scanResultStatus,
        statusReasons: detail.scanResultDetails.statusReasons,
      },
      deps,
    );
  }
};
