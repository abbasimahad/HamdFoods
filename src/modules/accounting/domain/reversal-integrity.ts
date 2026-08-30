export function hasReversalConflict(document: {
  reversalOfId: string | null;
  hasLinkedReversal: boolean;
}) {
  return document.reversalOfId !== null || document.hasLinkedReversal;
}
