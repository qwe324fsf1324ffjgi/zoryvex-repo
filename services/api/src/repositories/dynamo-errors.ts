export function isConditionalCheckFailed(error: unknown): boolean {
  return error instanceof Error && error.name === 'ConditionalCheckFailedException';
}

export function isTransactionCanceledByCondition(error: unknown): boolean {
  return error instanceof Error && error.name === 'TransactionCanceledException';
}
