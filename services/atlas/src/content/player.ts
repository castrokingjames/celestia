// content/player.ts — GAME CONTENT: player combat stats. Placeholders until characters carry their own stats
// (level/hp/damage from game_character). DATA, not logic. PLAYER_LEVEL exists so a mob's situation frame can
// compare its level to a player's; drop it once characters have a real level.
export const PLAYER_MAX_HP = 20;
export const PLAYER_DAMAGE = 3; // damage a player deals per landed attack (the server computes it; G1)
export const PLAYER_ATTACK_REACH = 48; // world units a player must be within to land an attack (~1.5 tiles)
export const PLAYER_LEVEL = 5; // placeholder level used only for the mob's perception frame
