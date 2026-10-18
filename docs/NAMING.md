<!-- Generated 2026-10-10 by a multi-agent brainstorm (one candidate-list per subsystem) -> compile. A MENU to pick from; nothing locked. -->

# Celestia — Codename Menu (NAMING.md)

## The theme

**Celestia** is the umbrella for a cozy LLM-NPC life-sim MMO — a living sky-world of villages, farms, and the heavenly beings (our NPC villagers) who dwell in it. Every subsystem draws its codename from the **celestial canon**: real stars, constellations, planets, moons, comets, mythic sky-figures, and sky phenomena. The guiding rule is **resonance** — a subsystem's name should quietly describe what it *does* (the auth gate is a god of doorways; the ledger is a goddess of the mint; the event-log is the cosmic archive).

This file is a **menu**, not a verdict. Each section lists every candidate with a short rationale and a distinctiveness read; the current front-runner is marked with a **★**. Pick one ★ per subsystem — or an alternative that sings to you — then run the trademark/npm/domain checks noted in "How to pick."

*Distinctiveness legend:* **Common** = widely used elsewhere, collision-prone; **Moderate** = recognizable but ownable; **Distinctive** = obscure/clean, highly ownable.

---

## 1. Umbrella — the product name for the entire living sky-world

| Name | Type | Why it fits | Distinctiveness |
|---|---|---|---|
| **Celestia ★** | Phenomenon | Latin *caelestia*, "the heavens / all heavenly things" — names the whole living sky-world in one warm word | Moderate |
| Caelum | Constellation | A real constellation and literally Latin for "the whole sky/heaven" — the complete celestial canopy the world lives under | Distinctive |
| Empyrean | Phenomenon | The highest heaven of pure light in classical cosmology — an entire luminous, blissful world above | Distinctive |
| Arcadia | Myth-figure + body | The mythic pastoral paradise (Arcadia Planitia on Mars; asteroid 1020) — an idyllic farming utopia | Common |
| Astraea | Myth-figure + body | Goddess who dwelt among mortals in a peaceful Golden Age; constellation/asteroid 5 — heavenly beings living in a gentle world | Distinctive |
| Hesperia | Myth-figure + body | The golden "evening land" of the western star (Hesperia Planum; asteroid 69) — a warm, dusk-lit realm | Distinctive |
| Elysium | Myth-figure + body | The blessed paradise realm (Elysium Planitia on Mars) — a serene, idealized world to live in forever | Common |
| Aurora | Phenomenon | The living glow across the whole sky — a wondrous celestial world that feels alive and ever-shifting | Common |

---

## 2. Polaris tier — accounts, matchmaking, central hub/directory, zone routing

| Name | Type | Why it fits | Distinctiveness |
|---|---|---|---|
| **Polaris ★** | Star | The fixed pole star the whole sky wheels around and everyone navigates by — the anchor/directory everything orbits and routes from | Common |
| Vesta | Myth-figure + body | Goddess of the central hearth-fire the household gathers around (asteroid 4) — the cozy "home base" holding account state | Moderate |
| Barycenter | Phenomenon | The shared center of mass all orbiting bodies revolve around — the balance-point nexus players orbit; a touch technical | Distinctive |
| Kochab | Star | A "Guardian of the Pole" circling tight around the celestial pole — a watchful keeper holding account state | Distinctive |
| Thuban | Star | The ancient Egyptian-era pole star the sky once turned around — a timeless central anchor | Distinctive |
| Janus | Myth-figure + body | Two-faced god of gates and transitions (moon of Saturn) — the gateway that admits accounts and routes them to zones | Moderate |
| Atlas | Myth-figure + body | Bears the celestial sphere (moon of Saturn) and "atlas" = a directory/index — holds all state and maps players to zones | Common |
| Dubhe | Star | A Big Dipper "Pointer" star directing you to the pole — a router pointing each player toward their destination zone | Distinctive |

---

## 3. Auth — authentication: proving who you are and admitting you through the login gate

| Name | Type | Why it fits | Distinctiveness |
|---|---|---|---|
| **Janus ★** | Myth-figure + body (moon of Saturn) | Two-faced god of gates, doorways, and beginnings — the literal guardian of every threshold, exactly what login is | Moderate |
| Iris | Myth-figure + body (asteroid 7) | Rainbow goddess bridging mortal and divine; "iris" is also the biometric eye-scan of identity — crossing-in + proof-of-who-you-are | Moderate |
| Charon | Myth-figure + body (moon of Pluto) | The ferryman who alone decides who may cross — the controlled, one-at-a-time passage of a login gate | Moderate |
| Hekate | Myth-figure + body (asteroid 100) | Goddess of keys, gates, and liminal thresholds who holds the keys that let you pass; cozy-witch charm | Distinctive — note: a Switch bootloader uses the name |
| Kerberos | Myth-figure + body (moon of Pluto) | The hound guarding the underworld gate — and the world's best-known auth protocol | Common — heavily claimed; reads as "we use Kerberos" |
| Keystone | Constellation (Hercules asterism) | The block that locks the gateway arch; "key" = credentials | Common — OpenStack ships its identity service as Keystone |
| Bifrost | Phenomenon (rainbow bridge) | The sole guarded crossing into the realm of the gods — the one road in | Common — Netflix, OpenStack, and Mojang all ship a "Bifrost" |
| Hermes | Myth-figure + body (asteroid 69230) | God of boundaries, travelers, and crossing thresholds; patron of safe passage past the gate | Common — collides with Meta's Hermes JS engine, logistics apps |

---

## 4. Authz — authorization/policy: the judge weighing permissions, the `allow()` allow/deny verdict

| Name | Type | Why it fits | Distinctiveness |
|---|---|---|---|
| **Libra ★** | Constellation | The celestial Scales — literally weighs allow vs deny, exactly the `allow()` verdict | Common — FLAG: Meta's Libra/Diem crypto + zodiac ubiquity |
| Astraea | Myth-figure + body | Greek "Star Maiden" goddess of justice holding the scales (asteroid 5) — a judge whose name means "star" | Distinctive — warm and ownable |
| Themis | Myth-figure + body | Titaness of divine law, scales in hand (asteroid 24) — she *is* codified policy | Moderate — FLAG: some security/legal tools |
| Equinox | Phenomenon | The moment light and dark hang in perfect balance — the knife-edge of allow vs deny | Common — FLAG: Eclipse Equinox OSGi runtime, games/cars |
| Libration | Phenomenon | The Moon's gentle balancing wobble; shares the Libra root, echoes "deliberate" — rocking the scale before it settles | Distinctive — a clean deep cut |
| Pallas | Myth-figure + body | Pallas Athena cast the deciding vote at the first trial (asteroid 2) — the wise tie-breaking verdict | Moderate |
| Maat | Myth-figure + body | Egyptian goddess of cosmic order; the heart weighed against her feather — permission granted iff you meet policy (Maat Mons, Venus) | Moderate |
| Dike | Myth-figure + body | Greek goddess of justice and the verdict itself (asteroid 99) — pure allow/deny ruling | Moderate — FLAG: English spelling reads awkwardly |

---

## 5. World-server — realtime authoritative simulation of the villages/zones (the trusted core / TCB)

| Name | Type | Why it fits | Distinctiveness |
|---|---|---|---|
| **Atlas ★** | Myth-figure + body | The Titan who bears the whole sky/world — the authoritative core holding the entire living sim up; also a Saturn moon | Common |
| Polaris | Star | The fixed North Star everything wheels around — the single authoritative point the world orbits and steers by | Common |
| Vesta | Myth-figure + body | Goddess of the hearth whose flame must never go out — the always-on trusted core; a major asteroid | Moderate — warm and cozy |
| Ceres | Myth-figure + body | Goddess of harvest and growing things (a dwarf planet) — the fertile world where the farming sim lives and grows | Moderate |
| Rhea | Myth-figure + body | Mother of the gods who shelters her children — the nurturing core cradling every village and NPC; second-largest Saturn moon | Moderate |
| Hestia | Myth-figure + body | Hearth-and-home goddess, the still warm center the household gathers around (asteroid 46) | Moderate |
| Gaia | Myth-figure + body | The primordial Earth herself — the living world the server embodies; also the great sky-mapping mission (map of everything) | Common |
| Sol | Star | The Sun at the center — the one source the world orbits and stays in sync with; short and warm | Common |

---

## 6. Decision-model — System-1 tiny fast model making ~50ms snap typed decisions (reflex / instinct)

| Name | Type | Why it fits | Distinctiveness |
|---|---|---|---|
| **Mercury ★** | Planet / myth-figure + body | Swiftest planet and winged messenger god — pure speed-and-relay of a reflex answering in a blink | Common |
| Atalanta | Myth-figure + body | The huntress who outran every suitor, never beaten to the draw — fastest reflexes in myth; asteroid 36 | Distinctive |
| Camilla | Myth-figure + body | Virgil's warrior who ran over grain-tips without bending them — a reaction so fast it leaves no trace; asteroid 107 | Distinctive |
| Lepus | Constellation | The Hare — pure prey-animal instinct that darts before it thinks; reflex as a constellation, cozy | Distinctive |
| Pulsar | Phenomenon | A neutron star firing precise pulses every few ms — the tireless rapid-fire cadence of ~50ms snap calls | Common |
| Sagitta | Constellation | The Arrow — loosed fast and flying straight to one target; a single swift typed decision | Distinctive |
| Lynx | Constellation | Senses so sharp you'd need a lynx's eyes — keen instinct reading a situation at a glance | Moderate |
| Iris | Myth-figure + body | The swift rainbow-messenger, and the eye's iris — perceives and reacts in one instant; asteroid 7 | Common |

---

## 7. Dialogue — System-2 generative NPC voice / conversation

| Name | Type | Why it fits | Distinctiveness |
|---|---|---|---|
| **Calliope ★** | Myth-figure + body | Muse of eloquence and epic poetry (asteroid 22 Kalliope) — the literal patron of flowing speech, the NPC voice layer | Moderate |
| Euterpe | Myth-figure + body | Muse of lyric song and "giver of delight" (asteroid 27) — a warm, melodic voice that charms rather than lectures | Distinctive |
| Aoede | Moon | Muse whose name means "song/voice"; a moon of Jupiter — the subsystem that *is* the NPCs' voice | Moderate — note: also a Gemini TTS voice name |
| Lyra | Constellation | The bard's lyre — campfire storytelling, song, the poet's spoken voice | Moderate — note: Google "Lyra" speech codec, same-domain clash |
| Polyhymnia | Myth-figure + body | Muse of hymn, rhetoric and eloquence (asteroid 33) — the most on-the-nose patron of expressive speech | Distinctive — long to say |
| Echo | Myth-figure + body | Nymph of the answering voice (asteroid 60) — dialogue is call-and-response, the villager who speaks back | Common — thematically perfect but crowded |
| Hermes | Myth-figure + body | Messenger god of eloquence and persuasion (asteroid 69230) — carries words between player and villager | Common |
| Fama | Myth-figure + body | Roman goddess of talk, report and rumor (asteroid 408) — the living chatter and gossip of a village given voice | Distinctive — reads a bit like "fame" |

---

## 8. Memory — Memory/RAG: what NPCs remember about you; recall, long-term memory, recognition

| Name | Type | Why it fits | Distinctiveness |
|---|---|---|---|
| **Mnemosyne ★** | Myth-figure + body | Literally the Titaness of memory (asteroid 57) — the archetype for everything villagers remember about you | Moderate |
| Mneme | Moon | A Jupiter moon named for the Muse of Memory; the Greek word means "memory" — named for exactly what it does | Distinctive |
| Clio | Myth-figure + body | Muse of history who records and recounts past deeds (asteroid 84 Klio) — long-term logging of your shared history | Moderate — note: Clio legal-software clash |
| Analemma | Phenomenon | The figure-eight the Sun traces over a year — a trace accumulated across time; a vivid long-term-memory metaphor | Distinctive |
| Epimetheus | Moon | A Saturn moon whose name means "hindsight/afterthought" — recalling what already happened | Distinctive — slightly a mouthful |
| Metis | Moon | Jupiter moon / asteroid 9; Titaness of wise counsel — surfacing the right stored knowledge at the right moment, the heart of RAG | Moderate — note: Metis crypto L2 + bootcamp clash |
| Theia | Myth-figure + body | Titaness of sight (and protoplanet Theia) — recognition is seeing and knowing a returning face | Moderate — note: Eclipse Theia IDE clash in dev contexts |
| Lethe | Myth-figure + body | The mythic river of forgetting (asteroid 77) — a warm fit for the memory-decay/pruning side: what gently fades | Moderate |

---

## 9. Economy — economy/ledger: coins, treasury, double-entry balances

| Name | Type | Why it fits | Distinctiveness |
|---|---|---|---|
| **Moneta ★** | Myth-figure + body | Juno Moneta's temple *was* Rome's mint — the literal root of "money," "mint," "monetary" (asteroid 114) | Distinctive |
| Pluto | Planet | Pluto-Plutus, god of wealth beneath the earth ("plutocracy") — strong wealth resonance; was also a stated front-runner | Common — heavy clashes (Disney's dog, "Plutus" fintech); underworld tone off for cozy |
| Fortuna | Myth-figure + body | Goddess of fortune and prosperity with the cornucopia and wheel (asteroid 19) — warm and lucky for a growing balance | Moderate |
| Libra | Constellation | The celestial Scales — perfect emblem for a double-entry ledger that must always balance (debits = credits) | Common — major clash: Meta's Libra/Diem, collision-prone in finance |
| Juno | Myth-figure + body | As Juno Moneta she guarded Rome's treasury and mint (asteroid 3) — guardian-of-the-coffers energy, warm | Moderate |
| Abundantia | Myth-figure + body | Goddess of abundance and overflowing plenty (asteroid 151) — a thriving treasury; very ownable | Distinctive — a touch long |
| Spica | Star | Brightest star in Virgo; Latin for "ear of grain" — in a farming economy grain is the first currency, tying ledger to harvest | Moderate |
| Mercury | Planet | Roman god of commerce and merchants — the swift circulation of coin through the market | Common — heavily taken (fintech bank, element, Freddie Mercury) |

---

## 10. Bridge — Web3 bridge between the off-chain game and on-chain tokens (deposits/withdrawals)

| Name | Type | Why it fits | Distinctiveness |
|---|---|---|---|
| **Iris ★** | Myth-figure + body | Goddess who *is* the rainbow bridge linking heaven and earth, and the divine messenger — the exact two-realms-plus-messenger metaphor; asteroid 7 | Moderate |
| Janus | Moon | Saturn's moon, the two-faced god of gates who looks both ways — a gateway facing both the off-chain and on-chain sides | Moderate |
| Charon | Moon | Pluto's largest moon, the ferryman carrying passengers across the boundary between two worlds — a literal transfer agent | Moderate |
| Hermes | Myth-figure + body | Messenger god who crosses between realms AND god of commerce/coins — ideal double meaning for a token bridge; asteroid 69230 | Common |
| Pollux | Star | Brightest star of Gemini; shared his immortality so the twins alternate between Olympus and the underworld — perpetually bridging two realms (sidesteps the taken "Gemini") | Distinctive |
| Equinox | Phenomenon | The Sun crossing the celestial equator — a balanced two-way crossing point; warm and seasonal | Moderate |
| Transit | Phenomenon | One body passing across the face of another — names both the crossing AND the transfer of value, matching deposits/withdrawals | Common |
| Pons | Comet | Comet 12P/Pons-Brooks is a real body, and "pons" is Latin for "bridge" — names the function outright while staying celestial | Distinctive — a quiet dark-horse |

---

## 11. Coordination — cache/coordination ephemeral medium: presence, pub/sub, locks, signals (Valkey/Redis)

| Name | Type | Why it fits | Distinctiveness |
|---|---|---|---|
| **Aether ★** | Phenomenon | The classical pervasive medium all light/signals propagate through — the invisible substrate every process passes messages across | Moderate |
| Iris | Myth-figure + body | Messenger goddess darting between realms with word (asteroid 7, the rainbow bridge) — the pub/sub carrier connecting processes | Moderate |
| Caelum | Constellation | Latin for "the heavens" and a real constellation — the all-encompassing firmament everything lives inside; nests cleanly under Celestia | Distinctive |
| Reticulum | Constellation | "The Net," named for a reticle/mesh — reads directly as the connective grid every signal and lock is wired through | Distinctive |
| Pulsar | Star | A neutron star beaming perfectly regular pulses — the heartbeat/presence-ping cadence of a pub/sub bus | Common |
| Mercury | Planet | The swift messenger planet — fastest, closest orbit; the low-latency carrier shuttling signals between processes | Common |
| Aurora | Phenomenon | Charged particles rippling across the whole sky — signals and presence shimmering across a shared medium; warm | Common — note: AWS Aurora in the data space |
| Corona | Phenomenon | The Sun's outer plasma envelope — a glowing medium radiating energy to everything | Common — carries beer/virus baggage |

---

## 12. Moderation — the all-seeing guardian: watching for abuse, handling reports, issuing sanctions

| Name | Type | Why it fits | Distinctiveness |
|---|---|---|---|
| **Custos ★** | Constellation | From Custos Messium, the obsolete "Harvest Keeper" constellation; Latin *custos* = "guardian/watchman," and it guards the *harvest* — fuses protector role with the farming theme in one ownable word | Distinctive — strongest pick |
| Argus | Myth-figure + body | Argus Panoptes, the hundred-eyed watchman who never fully sleeps = literal all-seeing moderation; was the stated front-runner | Common — thin celestial grounding; near-universal name for surveillance software, heavy collisions |
| Pavo | Constellation | The Peacock, whose tail carries Argus's hundred watching eyes — the exact all-seeing idea with genuine celestial grounding and far less collision | Moderate |
| Lynx | Constellation | Named because you need a lynx's eyes to spot its faint stars; proverbial for keenest sight — the watcher that catches what others miss | Common |
| Arcturus | Star | Greek *Arktouros* = "Guardian of the Bear" — the name means guardian/watcher; a bright, steady watch-star over the flock | Moderate |
| Aquila | Constellation | The Eagle — sharp-eyed sentinel surveying from above and bearer of Zeus's thunderbolt, matching both watching and sanction | Moderate |
| Astraea | Myth-figure + body | Star-maiden goddess of justice (became Virgo; asteroid 5) holding the scales — weighing reports fairly and dispensing measured sanctions | Distinctive — warm rather than punitive |
| Horus | Myth-figure + body | The Eye of Horus is the archetypal all-seeing protective eye; the falcon sky-god has keen sight (asteroid 1924) | Moderate — note: Warhammer "Horus Heresy" + slot-machine clashes |

---

## 13. Client-SDK — Godot client library: the player's window/instrument into the world

| Name | Type | Why it fits | Distinctiveness |
|---|---|---|---|
| **Astrolabe ★** | Phenomenon | Instrument for observing AND navigating the heavens — the hand-held device you look through to find your way, exactly what the client is | Moderate |
| Pyxis | Constellation | The Mariner's Compass — the instrument you steer and navigate by; short, warm, on-theme for a wayfinding client | Moderate |
| Telescopium | Constellation | The "Telescope" — the instrument you look *through* to bring the distant world into view; the most literal "window into Celestia" | Distinctive |
| Sextans | Constellation | The "Sextant" — the sighting instrument that fixes your position; a client that sights and orients you in the world | Distinctive |
| Lucida | Star | The brightest star of a constellation, "the one you see by" — the bright point through which the player perceives everything | Moderate |
| Vega | Star | Brilliant navigation star of the Summer Triangle — the bright thing you look at and steer by | Common — collision-heavy |
| Sirius | Star | The brightest star in the night sky — the ultimate "thing you look at / see by" | Common — very widely used (SiriusXM, etc.) |
| Polaris | Star | The North Star every traveler orients by — a fixed reference the client anchors wayfinding to | Common — heavily reused in software/brands |

---

## 14. Event-log — append-only immutable record of everything that ever happened (cosmic history / archive)

| Name | Type | Why it fits | Distinctiveness |
|---|---|---|---|
| **Akasha ★** | Phenomenon (Akashic record) | The cosmic archive of every event, word and thought that ever occurred — a one-to-one match for an append-only source of truth | Moderate |
| Mnemosyne | Myth-figure + body (asteroid 57) | Goddess of Memory herself — the faculty holding all that has happened; perfect total recall | Moderate |
| Mneme | Moon | A Jovian moon meaning "memory" — a tidy, ownable word for the system that remembers everything | Distinctive |
| Clio | Myth-figure + body (asteroid 84 Klio) | Muse of History recording the deeds of the past — exactly what an immutable event log is | Moderate — note: Clio legal-software clash |
| Thoth | Myth-figure + body (Moon god, divine scribe) | Scribe of the gods logging every deed and judgment — the archetypal immutable ledger-keeper | Distinctive — celestial basis is lunar godhood; no asteroid, flag before locking |
| Oort | Phenomenon (Oort Cloud) | A vast outer reservoir preserving pristine primordial material — a deep-frozen, untouched, append-only archive of origins | Distinctive |
| Firmament | Phenomenon | The ancient fixed vault of heaven holding the stars in place — the immutable, unchanging record everything is written on | Moderate |
| Polaris | Star | The one point that never moves — the fixed reference everything is measured against, the single source of truth | Common — heavily used in software/design systems |

---

## Package naming convention

Three ways to map codenames onto actual package/service names. Pick one and apply it uniformly.

### (a) RECOMMENDED — codename = service friendly-name, packages stay descriptive

Services carry the celestial codename (dashboards, repos, Slack channels, war-room talk), but published packages keep **descriptive, boring, greppable** names. New engineers can read the dependency graph without a decoder ring, and you never rename a package if a service is re-themed.

```
Service "Janus"   → package @celestia/auth
Service "Libra"   → package @celestia/authz
Service "Atlas"   → package @celestia/world-server
Service "Moneta"  → package @celestia/economy
Service "Aether"  → package @celestia/coordination
```

### (b) Pure-codename

The celestial name *is* the package name. Maximum theme and brand cohesion; weakest discoverability (you must know that "Libra" = authorization).

```
@celestia/janus     (auth)
@celestia/libra     (authz)
@celestia/atlas     (world-server)
@celestia/moneta    (economy)
@celestia/aether    (coordination)
```

### (c) Hybrid — codename + descriptor

Both names in the package, codename first. Keeps the theme visible while staying self-documenting; cost is longer, more verbose import paths.

```
@celestia/janus-auth
@celestia/libra-authz
@celestia/atlas-world-server
@celestia/moneta-economy
@celestia/aether-coordination
```

---

## How to pick

- **Choose exactly one name per subsystem** — the **★** front-runner, or a listed alternative that resonates more with your team.
- **Favor "distinctive" picks for anything user-facing or trademarkable** — the umbrella (**Celestia**), the client-SDK, and any name that appears in marketing, store listings, or the player UI. Distinctive names are easier to own, protect, and search for.
- **Internal-only subsystems can tolerate "common" or "moderate"** names, since collisions matter less when the name never leaves the codebase — but still prefer the hybrid or descriptive package convention so grep stays honest.
- **Flag: any "common" pick needs a clearance check before locking** — search npm/package registries, domains, and a trademark lookup. The known hot spots already surfaced above: **Libra** (Meta/Diem), **Keystone** (OpenStack), **Bifrost** (Netflix/OpenStack/Mojang), **Hermes** (Meta JS engine), **Argus** (surveillance software), **Aurora** (AWS), **Metis**, **Clio**, **Theia**, **Mercury**, **Sirius**, and **Polaris** (reused widely). **Thoth** has no asteroid namesake — confirm the celestial grounding you want before locking.
- When two subsystems both want the same figure (e.g. **Iris** fits auth, decision-model, bridge, and coordination; **Janus** fits auth, the Polaris tier, and bridge; **Astraea** fits umbrella, authz, and moderation), assign it to the single subsystem where the metaphor is strongest and give the others their next-best ★ alternative.


---

## LOCKED — Client SDK (2026-10-11): **Jupiter**

The client SDK is **Jupiter** (facade autoload), chunked into *moon* modules:

`jupiter/io` auth · `jupiter/europa` transport · `jupiter/ganymede` state · `jupiter/callisto` intents · `jupiter/metis` contract · `jupiter/amalthea` dialogue *(opt)* · `jupiter/thebe` wallet/web3 *(opt)*

*(The per-service names elsewhere in this file — Janus/Astraea/Atlas/Vesta/… and the server-SDK name — remain **proposals pending confirmation**; the client = Jupiter was locked first.)*

---

## LOCKED — Services (2026-10-13): **Atlas** + **Polaris**

The two live backend services carry a celestial codename as **both their directory and package name** (pure-codename, convention (b) — not the earlier role-nouns `realtime`/`meta`, which conflicted with guardrail G10):

- **Atlas** — the realtime world-server (`services/atlas` · `@celestia/atlas`): Colyseus 20 Hz authoritative sim + connect-ticket `onAuth`. (§5 world-server ★.)
- **Polaris** — the HTTP/account (meta) tier (`services/polaris` · `@celestia/polaris`): auth, accounts, sessions, connect-ticket issuance; later matchmaking/social. (§2 Polaris tier ★.)

Shared leaf packages were originally descriptive; per the "no plain names" call the wire contract is now codenamed **Norma** (`@celestia/norma`) — see the infrastructure-codenames note below. Future services take their ★ from the menu above when built (cognition → Mercury/Calliope, authz → Libra, economy → Moneta, …).

---

## LOCKED — Client surfaces (2026-10-13): **Astrolabe** + **Phaethon**

The two client frontends carry a celestial codename as their directory (the engine — Godot/Phaser — is a descriptor, not the name). Both embed the **Jupiter** SDK:

- **Astrolabe** — the destination **Godot** client (`client/astrolabe`): the primary window into the world (§13 instrument-menu ★).
- **Phaethon** — the throwaway **Phaser** netcode POC harness (`client/phaethon` · `@celestia/phaethon`): asteroid 3200 Phaethon / the sun-charioteer myth, and the "Pha-" echoes "Phaser". A scrappy preview, discarded once the netcode graduates onto Astrolabe.

The shared client SDK stays **Jupiter** (moon-modules per the lock above); it currently lives inside Phaethon and extracts to its own `jupiter` module when it graduates out of the POC.

---

## LOCKED/RESERVED — Atlas engine modules (2026-10-17)

**Atlas** (world-server) composes named NestJS sub-modules. **Caelum** is shared via `@celestia/firmament`
(Polaris + Atlas load it at boot); the rest are Atlas game-side (genre-neutral mechanisms, extractable to engine
packages later per G3). Full map + slice mapping in `docs/REFACTOR.md`.

**Building now (S1–S3):**

- **Caelum** — config/topology loader (world → zones → map/sectors). *(instrument family, alongside Astrolabe.)*
- **Janus** — Lobby: the gateway into the game (world + character selection). *(§3 ★ "god of doorways/beginnings" — repurposed from auth, since login now lives in Polaris.)*
- **Orrery** — the game loop: movement, AoI/sectors, zone transitions, tick. *(a clockwork of moving bodies that ticks — literally the sim loop.)*
- **Astraea** — in-game authz: the `allow()`/`qualify()` action gates. *(§4 "star-maiden of justice" — weighs allow/deny.)*
- **Fornax** — the in-game action pipeline (`services/atlas/src/fornax`): the thin orchestrator that runs `enumerate → allow → qualify → execute → event → signal`, threading **Astraea** (the gates) and **Orrery** (the write side — `EventSink` + the signal bus). *(constellation "the Furnace" — raw untrusted intents go in, are refined through the gates, and validated truth (events) comes out.)*
- **Themis** — in-game enforcement (`services/atlas/src/themis`): the `SessionRegistry` (one-session/account, 4409 displacement) + the revocation sweep that evicts banned/suspended players. *(§4 Titaness of divine law — the enforcement counterpart to Astraea's permission; GM chat-spam/harassment moderation is the next layer on this module.)*

**Reserved (not built — naming held):**

- **Iris** / **Hermes** — social, two purposes (chat / presence / friends). *(§10/§11 messenger figures.)*

**Infrastructure codenames (not Atlas modules):**

- **Firmament** — the shared NestJS infra package (`@celestia/firmament`): `config` · `persistence` · `tickets`. *(the fixed vault that holds the stars — the substrate every service rests on; renamed from the generic `platform`.)*
- **Gaia** — the local datastore stack (`docker-compose.gaia.yml`; `pnpm gaia:up`/`gaia:down`): Postgres + Valkey. *(the primordial earth — the ground the world's data lives in; renamed from the generic `infra`.)*
- **Norma** — the shared wire contract (`@celestia/norma`): `PROTOCOL_VERSION`, intent types, shared constants (`MOVE_SPEED`…), ticket claims, message shapes — imported by client + servers so the wire can't drift. *(constellation "the Carpenter's Square / Level"; `norma` = Latin for standard/rule — the protocol both sides conform to; renamed from the generic `net-contract`.)*

