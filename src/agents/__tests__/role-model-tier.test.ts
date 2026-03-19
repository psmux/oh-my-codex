import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AGENT_DEFINITIONS } from "../definitions.js";

function preferredModelTier(role: string) {
	return AGENT_DEFINITIONS[role]?.preferredModelTier;
}

describe("agent preferred model tiers", () => {
	it("encodes the approved role split in explicit preferredModelTier metadata", () => {
		const expected = {
			analyst: "frontier",
			architect: "frontier",
			"build-fixer": "mini",
			"code-reviewer": "frontier",
			"code-simplifier": "frontier",
			critic: "frontier",
			debugger: "mini",
			"dependency-expert": "mini",
			designer: "mini",
			executor: "mini",
			explore: "spark",
			"git-master": "mini",
			planner: "frontier",
			researcher: "mini",
			"security-reviewer": "frontier",
			"team-executor": "frontier",
			"test-engineer": "frontier",
			verifier: "mini",
			vision: "frontier",
			writer: "mini",
		} as const;

		for (const [role, tier] of Object.entries(expected)) {
			assert.equal(
				preferredModelTier(role),
				tier,
				`${role} should resolve to ${tier}`,
			);
		}
	});

	it("keeps explore as the only spark-tier role in the first rollout", () => {
		const sparkRoles = Object.entries(AGENT_DEFINITIONS)
			.filter(([, definition]) => definition.preferredModelTier === "spark")
			.map(([role]) => role)
			.sort();

		assert.deepEqual(sparkRoles, ["explore"]);
		assert.equal(preferredModelTier("style-reviewer"), "default");
		assert.equal(preferredModelTier("quality-reviewer"), "default");
	});
});
