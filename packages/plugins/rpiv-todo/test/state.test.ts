import assert from "node:assert/strict";
import test from "node:test";
import { applyTaskMutation } from "../state/state-reducer";
import { EMPTY_STATE } from "../state/state";

test("creates dependency-aware tasks and enforces status transitions", () => {
	const first = applyTaskMutation(EMPTY_STATE, "create", { subject: "Implement widget" });
	assert.equal(first.op.kind, "create");
	const firstId = first.state.tasks[0]?.id;
	assert.ok(firstId);

	const second = applyTaskMutation(first.state, "create", {
		subject: "Verify widget",
		blockedBy: [firstId],
	});
	assert.equal(second.op.kind, "create");
	const secondId = second.state.tasks.find((task) => task.subject === "Verify widget")?.id;
	assert.ok(secondId);

	const completed = applyTaskMutation(second.state, "update", {
		id: firstId,
		status: "completed",
	});
	assert.equal(completed.op.kind, "update");
	const invalidReopen = applyTaskMutation(completed.state, "update", {
		id: firstId,
		status: "pending",
	});
	assert.equal(invalidReopen.op.kind, "error");
	if (invalidReopen.op.kind === "error") assert.match(invalidReopen.op.message, /illegal transition/);
});

test("rejects dependency cycles", () => {
	const first = applyTaskMutation(EMPTY_STATE, "create", { subject: "A" });
	const firstId = first.state.tasks[0]?.id;
	assert.ok(firstId);
	const second = applyTaskMutation(first.state, "create", { subject: "B", blockedBy: [firstId] });
	const secondId = second.state.tasks.find((task) => task.subject === "B")?.id;
	assert.ok(secondId);

	const cycle = applyTaskMutation(second.state, "update", { id: firstId, addBlockedBy: [secondId] });
	assert.equal(cycle.op.kind, "error");
	if (cycle.op.kind === "error") assert.match(cycle.op.message, /cycle/);
});
