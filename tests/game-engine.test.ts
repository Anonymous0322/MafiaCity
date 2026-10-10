import assert from "node:assert/strict";
import { test } from "node:test";
import {
  allNightActionsSubmitted,
  allVotesSubmitted,
  assignRoles,
  evaluateWinState,
  MAX_PLAYERS,
  MIN_PLAYERS,
  nightActionSubmitted,
  resolveNight,
  resolveVotes,
  rolePlan,
  rolesFor,
  shuffle,
  validateNightTarget,
  validateVote,
} from "@/lib/game/rules";
import type { GamePlayer, GameRole } from "@/lib/types";

function player(id: string, role: GameRole, alive = true): GamePlayer {
  return { id, name: id, username: id, avatar: null, alive, role };
}

function table(count: number): GamePlayer[] {
  return Array.from({ length: count }, (_, index) => player(`p${index + 1}`, "citizen"));
}

/* -------------------------------------------------------------------------- */
/* role distribution                                                          */
/* -------------------------------------------------------------------------- */

test("role plan always covers exactly `count` seats", () => {
  for (let count = MIN_PLAYERS; count <= MAX_PLAYERS; count += 1) {
    const total = rolePlan(count).reduce((sum, entry) => sum + entry.count, 0);
    assert.equal(total, count, `plan mismatch for ${count} players`);
  }
});

test("role plan always contains exactly one doctor and one detective", () => {
  for (let count = MIN_PLAYERS; count <= MAX_PLAYERS; count += 1) {
    const plan = rolePlan(count);
    assert.equal(plan.find((entry) => entry.role === "doctor")?.count, 1);
    assert.equal(plan.find((entry) => entry.role === "detective")?.count, 1);
  }
});

test("mafia count follows the preserved thresholds", () => {
  assert.equal(rolePlan(5).find((entry) => entry.role === "mafia")?.count, 1);
  assert.equal(rolePlan(6).find((entry) => entry.role === "mafia")?.count, 1);
  assert.equal(rolePlan(7).find((entry) => entry.role === "mafia")?.count, 2);
  assert.equal(rolePlan(9).find((entry) => entry.role === "mafia")?.count, 2);
  assert.equal(rolePlan(10).find((entry) => entry.role === "mafia")?.count, 3);
  assert.equal(rolePlan(20).find((entry) => entry.role === "mafia")?.count, 3);
});

test("rolesFor returns a multiset matching the plan", () => {
  const roles = rolesFor(9);
  assert.equal(roles.length, 9);
  assert.equal(roles.filter((role) => role === "mafia").length, 2);
  assert.equal(roles.filter((role) => role === "doctor").length, 1);
  assert.equal(roles.filter((role) => role === "detective").length, 1);
  assert.equal(roles.filter((role) => role === "citizen").length, 5);
});

test("assignRoles produces a complete, shuffled assignment", () => {
  const roles = assignRoles(8);
  assert.equal(roles.length, 8);
  assert.deepEqual(
    [...roles].sort(),
    rolesFor(8).sort(),
  );
});

test("shuffle preserves every element and honours the injected RNG", () => {
  const input = [1, 2, 3, 4, 5, 6];
  // pick() always returns 0 -> Fisher-Yates bubbles the first element to the end
  const output = shuffle(input, () => 0);
  assert.deepEqual([...output].sort(), input);
  assert.equal(output[output.length - 1], input[0]);
  assert.deepEqual(input, [1, 2, 3, 4, 5, 6], "shuffle must not mutate its input");
});

test("shuffle actually permutes for a real RNG", () => {
  const input = Array.from({ length: 12 }, (_, index) => index);
  const permutations = new Set<string>();
  for (let i = 0; i < 25; i += 1) permutations.add(shuffle(input).join(","));
  assert.ok(permutations.size > 1, "expected more than one permutation");
});

/* -------------------------------------------------------------------------- */
/* win conditions                                                             */
/* -------------------------------------------------------------------------- */

test("town wins when the last mafia is eliminated", () => {
  const players = table(6);
  players[0].role = "mafia";
  players[0].alive = false;
  const result = evaluateWinState(players);
  assert.equal(result.winner, "town");
  assert.equal(result.reason, "mafia-eliminated");
});

test("mafia wins when they equal the rest of the table", () => {
  const players = [player("m1", "mafia"), player("m2", "mafia"), player("t1", "citizen")];
  const result = evaluateWinState(players);
  assert.equal(result.winner, "mafia");
  assert.equal(result.reason, "mafia-controls-city");
});

test("no winner while both sides can still act", () => {
  const players = [player("m1", "mafia"), player("t1", "citizen"), player("t2", "citizen")];
  const result = evaluateWinState(players);
  assert.equal(result.winner, null);
  assert.equal(result.reason, "continue");
});

/* -------------------------------------------------------------------------- */
/* night                                                                      */
/* -------------------------------------------------------------------------- */

test("a single mafia vote eliminates the target", () => {
  const players = [
    player("m1", "mafia"),
    player("m2", "mafia"),
    player("t1", "citizen"),
    player("t2", "citizen"),
    player("d1", "doctor"),
    player("det1", "detective"),
  ];
  const outcome = resolveNight(players, { mafiaVotes: { m1: "t1", m2: "t1" } });
  assert.equal(outcome.killedId, "t1");
  assert.equal(players.find((entry) => entry.id === "t1")?.alive, false);
});

test("the doctor save blocks the elimination", () => {
  const players = [
    player("m1", "mafia"),
    player("t1", "citizen"),
    player("d1", "doctor"),
    player("det1", "detective"),
    player("t2", "citizen"),
  ];
  const outcome = resolveNight(players, { mafiaVotes: { m1: "t1" }, doctorTarget: "t1" });
  assert.equal(outcome.killedId, null);
  assert.equal(outcome.savedId, "t1");
  assert.equal(players.find((entry) => entry.id === "t1")?.alive, true);
});

test("a split mafia vote eliminates nobody", () => {
  const players = [
    player("m1", "mafia"),
    player("m2", "mafia"),
    player("t1", "citizen"),
    player("t2", "citizen"),
  ];
  const outcome = resolveNight(players, { mafiaVotes: { m1: "t1", m2: "t2" } });
  assert.equal(outcome.killedId, null);
  assert.equal(outcome.disagreement, true);
  assert.ok(players.every((entry) => entry.alive));
});

test("the detective learns the target alignment", () => {
  const players = [
    player("m1", "mafia"),
    player("t1", "citizen"),
    player("det1", "detective"),
    player("d1", "doctor"),
    player("t2", "citizen"),
  ];
  const outcome = resolveNight(players, { mafiaVotes: { m1: "t2" }, detectiveTarget: "t1" });
  assert.equal(outcome.investigatedTargetId, "t1");
  assert.equal(outcome.detectiveId, "det1");
});

test("a dead detective cannot investigate", () => {
  const players = [
    player("m1", "mafia"),
    player("t1", "citizen"),
    player("det1", "detective", false),
    player("d1", "doctor"),
    player("t2", "citizen"),
  ];
  const outcome = resolveNight(players, { mafiaVotes: { m1: "t2" }, detectiveTarget: "t1" });
  assert.equal(outcome.detectiveId, null);
  assert.equal(outcome.investigatedTargetId, null);
});

/* -------------------------------------------------------------------------- */
/* voting                                                                     */
/* -------------------------------------------------------------------------- */

test("a plurality vote eliminates exactly one player", () => {
  const players = table(5);
  const outcome = resolveVotes(players, {
    p1: "p5",
    p2: "p5",
    p3: "p4",
    p4: "p5",
    p5: "p1",
  });
  assert.equal(outcome.eliminatedId, "p5");
  assert.equal(players.find((entry) => entry.id === "p5")?.alive, false);
  assert.ok(players.filter((entry) => entry.alive).length === 4);
});

test("a tied vote eliminates nobody", () => {
  const players = table(4);
  const outcome = resolveVotes(players, { p1: "p4", p2: "p4", p3: "p3", p4: "p3" });
  assert.equal(outcome.eliminatedId, null);
  assert.equal(outcome.tie, true);
  assert.ok(players.every((entry) => entry.alive));
});

test("votes from eliminated players are ignored", () => {
  const players = table(4);
  players[0].alive = false; // p1 is out but still sends a vote
  const outcome = resolveVotes(players, { p1: "p2", p2: "p3", p3: "p4", p4: "p4" });
  assert.equal(outcome.eliminatedId, "p4");
});

test("votes for already-dead targets are discarded", () => {
  const players = table(5);
  players[1].alive = false; // p2 already eliminated earlier in the day
  const outcome = resolveVotes(players, {
    p1: "p2", // dead target -> discarded
    p3: "p4",
    p4: "p4",
    p5: "p3",
  });
  assert.equal(outcome.eliminatedId, "p4");
  assert.equal(players.find((entry) => entry.id === "p2")?.alive, false);
});

/* -------------------------------------------------------------------------- */
/* validation                                                                 */
/* -------------------------------------------------------------------------- */

test("dead players cannot act", () => {
  const actor = player("a", "citizen", false);
  assert.equal(validateVote(actor, player("b", "citizen"), "day", {}), "not-alive");
  assert.equal(validateNightTarget(actor, player("b", "citizen"), "night"), "not-alive");
});

test("actions are rejected outside their phase", () => {
  const actor = player("a", "citizen");
  assert.equal(validateVote(actor, player("b", "citizen"), "night", {}), "wrong-phase");
  assert.equal(validateNightTarget(actor, player("b", "citizen"), "day"), "wrong-phase");
});

test("players cannot target themselves (the doctor may protect itself)", () => {
  const citizen = player("a", "citizen");
  assert.equal(validateVote(citizen, citizen, "day", {}), "self-target");
  assert.equal(validateNightTarget(citizen, citizen, "night"), "self-target");
  const doctor = player("d", "doctor");
  assert.equal(validateNightTarget(doctor, doctor, "night"), null);
});

test("mafia cannot target a teammate", () => {
  const mafia = player("m1", "mafia");
  assert.equal(validateNightTarget(mafia, player("m2", "mafia"), "night"), "ally-target");
});

test("duplicate votes are rejected", () => {
  const actor = player("a", "citizen");
  assert.equal(validateVote(actor, player("b", "citizen"), "day", { a: "c" }), "duplicate");
});

test("dead targets are rejected", () => {
  const actor = player("a", "citizen");
  assert.equal(validateVote(actor, player("b", "citizen", false), "day", {}), "dead-target");
});

/* -------------------------------------------------------------------------- */
/* phase completion                                                           */
/* -------------------------------------------------------------------------- */

test("the night only resolves once every special role has acted", () => {
  const players = [
    player("m1", "mafia"),
    player("t1", "citizen"),
    player("d1", "doctor"),
    player("det1", "detective"),
    player("t2", "citizen"),
    player("t3", "citizen"),
  ];
  const state = { nightActions: { mafiaVotes: { m1: "t1" } } };
  assert.equal(nightActionSubmitted({ ...state, nightActions: state.nightActions } as never, players[0]), true);
  assert.equal(allNightActionsSubmitted({ ...state, nightActions: state.nightActions } as never, players), false);

  const complete = { mafiaVotes: { m1: "t1" }, doctorTarget: "t2", detectiveTarget: "t3" };
  assert.equal(allNightActionsSubmitted({ nightActions: complete } as never, players), true);
});

test("citizens have nothing to do at night", () => {
  const players = [
    player("m1", "mafia"),
    player("d1", "doctor"),
    player("det1", "detective"),
    player("t1", "citizen"),
    player("t2", "citizen"),
    player("t3", "citizen"),
  ];
  const state = { nightActions: { mafiaVotes: { m1: "t1" }, doctorTarget: "t1", detectiveTarget: "t1" } };
  assert.equal(nightActionSubmitted({ nightActions: state.nightActions } as never, players[3]), true);
  assert.equal(allNightActionsSubmitted({ nightActions: state.nightActions } as never, players), true);
});

test("the day resolves once every living player has voted", () => {
  const players = table(5);
  const votes = { p1: "p5", p2: "p5", p3: "p4", p4: "p5" };
  assert.equal(allVotesSubmitted({ votes } as never, players), false);
  assert.equal(allVotesSubmitted({ votes: { ...votes, p5: "p1" } } as never, players), true);
});

test("eliminated players are not required to vote", () => {
  const players = table(5);
  players[4].alive = false; // p5 is out
  const votes = { p1: "p4", p2: "p4", p3: "p3", p4: "p1" };
  assert.equal(allVotesSubmitted({ votes } as never, players), true);
});

/* -------------------------------------------------------------------------- */
/* full-game simulation                                                       */
/* -------------------------------------------------------------------------- */

test("a scripted game always terminates with a single winner", () => {
  const seats = table(8);
  const roles = assignRoles(8);
  seats.forEach((seat, index) => {
    seat.role = roles[index];
  });

  let rounds = 0;
  while (rounds < 25) {
    rounds += 1;
    const verdict = evaluateWinState(seats);
    if (verdict.winner) {
      assert.ok(verdict.winner === "mafia" || verdict.winner === "town");
      return;
    }
    // night: mafia votes the first alive non-mafia, doctor protects, detective checks
    const alive = seats.filter((seat) => seat.alive);
    const mafia = alive.filter((seat) => seat.role === "mafia");
    const targets = alive.filter((seat) => seat.role !== "mafia");
    if (mafia.length === 0 || targets.length === 0) break;
    const votes: Record<string, string> = {};
    mafia.forEach((seat) => {
      votes[seat.id] = targets[Math.min(targets.length - 1, mafia.indexOf(seat))].id;
    });
    const doctor = alive.find((seat) => seat.role === "doctor");
    const detective = alive.find((seat) => seat.role === "detective");
    resolveNight(seats, {
      mafiaVotes: votes,
      doctorTarget: doctor?.id,
      detectiveTarget: detective?.id,
    });

    // day: everyone piles onto the first living non-mafia
    const remaining = seats.filter((seat) => seat.alive);
    const suspect = remaining.find((seat) => seat.role !== "mafia");
    if (!suspect) break;
    const dayVotes: Record<string, string> = {};
    for (const seat of remaining) {
      if (seat.id !== suspect.id) dayVotes[seat.id] = suspect.id;
    }
    resolveVotes(seats, dayVotes);
  }
  assert.fail("game did not terminate");
});
