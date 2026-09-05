/** Human-readable names for clips, profiles, and sides. */
import type { ProfileID } from "../rig/types.ts"

const animationLabels: Record<string, string> = {
  idle: "Idle breathing",
  staffIdle: "Staff idle",
  staffMoveForward: "Staff moving forward",
  staffMoveBackward: "Staff moving backward",
  run: "Run cycle",
  shieldUp: "Shield up",
  staffShieldUp: "Staff shield up",
  shieldMoveForward: "Guard walking forward",
  shieldMoveBackward: "Guard walking backward",
  staffShieldMoveForward: "Staff guard walking forward",
  staffShieldMoveBackward: "Staff guard walking backward",
  dodgeForward: "Dodge forward",
  dodgeBackward: "Dodge backward",
  swordSwing: "Sword swing",
  blocked: "Blocked recoil",
  sneakAttack: "Sneak attack",
  spellCast: "Spell cast",
  spellMoveForward: "Spell moving forward",
  spellMoveBackward: "Spell moving backward",
  bowDraw: "Bow draw",
  bowReload: "Bow reload",
  bowMoveForward: "Bow moving forward",
  bowMoveBackward: "Bow moving backward",
}

/** A clip's display name, falling back to its camel-case id spaced out. */
export function animationLabel(name: string): string {
  return (
    animationLabels[name] ??
    name.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/^./, (character) => character.toUpperCase())
  )
}

export const profileLabels: Record<ProfileID, string> = {
  maleV1: "Male V1",
  femaleV1: "Female V1",
}
