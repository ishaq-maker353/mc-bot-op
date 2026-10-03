# Security Specification (Phase 0 TDD)

## 1. Data Invariants
1. **Identity Ownership (`ownerId`)**: Every `BotProfile` (`/botProfiles/{profileId}`) and `KeepaliveCheckpoint` (`/botProfiles/{profileId}/checkpoints/{checkpointId}`) must have `ownerId == request.auth.uid` and `request.auth.token.email_verified == true`.
2. **Master Gate Relational Sync**: A `KeepaliveCheckpoint` in `/botProfiles/{profileId}/checkpoints/{checkpointId}` cannot exist or be read/created unless the parent `/botProfiles/{profileId}` exists and its `ownerId == request.auth.uid`.
3. **Strict Schema & Bounds**: All required keys must be present, no shadow/extra keys are permitted (`hasAll` + `hasOnly`), string lengths and numeric bounds are strictly enforced, and document IDs must pass `isValidId()`.
4. **Immutability & Temporal Integrity**: `ownerId`, `profileId`, and `createdAt` are immutable after creation; `createdAt` and `updatedAt` must equal `request.time`.

## 2. The "Dirty Dozen" Payloads
1. **Unauthenticated Write**: `auth = null` attempting `create` on `/botProfiles/prof_1`.
2. **Unverified Email Spoof**: `auth = { uid: 'user_1', token: { email_verified: false } }` attempting `create` on `/botProfiles/prof_1`.
3. **Identity Spoofing (`ownerId` mismatch)**: `auth.uid = 'user_1'` creating `/botProfiles/prof_1` with `ownerId: 'user_2'`.
4. **Shadow Field Injection**: Adding `isAdmin: true` to `/botProfiles/prof_1` on `create` or `update`.
5. **ID Poisoning**: Document ID containing invalid characters or > 128 chars.
6. **Value Poisoning (`port` out of range)**: Setting `port: "46958"` (string instead of number) or `port: 999999`.
7. **Denial of Wallet String Overflow**: Setting `host` to a 5,000-character string (`size() > 120`).
8. **Invalid Enum State (`movementMode`)**: Setting `movementMode: 'fly_hack'` (not in `['anchor_step_return', 'in_place_jump_look', 'bounded_radius']`).
9. **Client Timestamp Forgery**: Setting `createdAt` or `updatedAt` to a past/future timestamp instead of `request.time`.
10. **Immutable Field Mutation**: Updating `ownerId` or `createdAt` on an existing `BotProfile`.
11. **Orphaned Subcollection Write**: Creating `/botProfiles/non_existent/checkpoints/cp_1` where parent profile does not exist or belongs to another user.
12. **Unauthorized List Scraping**: Listing `/botProfiles` without `resource.data.ownerId == request.auth.uid`.
