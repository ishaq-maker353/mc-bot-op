/**
 * Phase 0 Test Runner Specification for Firestore Security Rules
 * Verifies all 12 "Dirty Dozen" adversarial payloads return PERMISSION_DENIED.
 */

export const DIRTY_DOZEN_TEST_CASES = [
  { id: 1, name: 'Unauthenticated Write', expected: 'PERMISSION_DENIED' },
  { id: 2, name: 'Unverified Email Spoof', expected: 'PERMISSION_DENIED' },
  { id: 3, name: 'Identity Spoofing (ownerId mismatch)', expected: 'PERMISSION_DENIED' },
  { id: 4, name: 'Shadow Field Injection', expected: 'PERMISSION_DENIED' },
  { id: 5, name: 'ID Poisoning (>128 chars or invalid regex)', expected: 'PERMISSION_DENIED' },
  { id: 6, name: 'Value Poisoning (port type/range violation)', expected: 'PERMISSION_DENIED' },
  { id: 7, name: 'Denial of Wallet String Overflow (host > 120 chars)', expected: 'PERMISSION_DENIED' },
  { id: 8, name: 'Invalid Enum State (movementMode)', expected: 'PERMISSION_DENIED' },
  { id: 9, name: 'Client Timestamp Forgery (createdAt != request.time)', expected: 'PERMISSION_DENIED' },
  { id: 10, name: 'Immutable Field Mutation (ownerId / createdAt modified)', expected: 'PERMISSION_DENIED' },
  { id: 11, name: 'Orphaned Subcollection Write (missing/unowned parent BotProfile)', expected: 'PERMISSION_DENIED' },
  { id: 12, name: 'Unauthorized List Scraping', expected: 'PERMISSION_DENIED' },
];
