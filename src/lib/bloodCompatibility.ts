import { BloodGroup } from "../generated/prisma/enums.js";

export type MatchType = "EXACT" | "COMPATIBLE";

const COMPATIBLE_DONOR_GROUPS: Record<BloodGroup, readonly BloodGroup[]> = {
  [BloodGroup.O_NEGATIVE]: [BloodGroup.O_NEGATIVE],
  [BloodGroup.O_POSITIVE]: [BloodGroup.O_POSITIVE, BloodGroup.O_NEGATIVE],
  [BloodGroup.A_NEGATIVE]: [BloodGroup.A_NEGATIVE, BloodGroup.O_NEGATIVE],
  [BloodGroup.A_POSITIVE]: [
    BloodGroup.A_POSITIVE,
    BloodGroup.A_NEGATIVE,
    BloodGroup.O_POSITIVE,
    BloodGroup.O_NEGATIVE,
  ],
  [BloodGroup.B_NEGATIVE]: [BloodGroup.B_NEGATIVE, BloodGroup.O_NEGATIVE],
  [BloodGroup.B_POSITIVE]: [
    BloodGroup.B_POSITIVE,
    BloodGroup.B_NEGATIVE,
    BloodGroup.O_POSITIVE,
    BloodGroup.O_NEGATIVE,
  ],
  [BloodGroup.AB_NEGATIVE]: [
    BloodGroup.AB_NEGATIVE,
    BloodGroup.A_NEGATIVE,
    BloodGroup.B_NEGATIVE,
    BloodGroup.O_NEGATIVE,
  ],
  [BloodGroup.AB_POSITIVE]: [
    BloodGroup.AB_POSITIVE,
    BloodGroup.AB_NEGATIVE,
    BloodGroup.A_POSITIVE,
    BloodGroup.A_NEGATIVE,
    BloodGroup.B_POSITIVE,
    BloodGroup.B_NEGATIVE,
    BloodGroup.O_POSITIVE,
    BloodGroup.O_NEGATIVE,
  ],
};

/**
 * Returns all donor blood groups that can safely donate red blood cells to the given recipient.
 */
export function getCompatibleDonorGroups(
  recipientGroup: BloodGroup,
): BloodGroup[] {
  return [...COMPATIBLE_DONOR_GROUPS[recipientGroup]];
}

/**
 * Classifies a compatible donor as an exact or cross-group compatible match for the recipient.
 */
export function getMatchType(
  recipientGroup: BloodGroup,
  donorGroup: BloodGroup,
): MatchType {
  return recipientGroup === donorGroup ? "EXACT" : "COMPATIBLE";
}
