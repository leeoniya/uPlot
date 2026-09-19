import assert from 'node:assert/strict';

function resolveId(value, index) {
	const id = value ?? String(index);
	assert.ok(typeof id === 'string' && /^[A-Za-z0-9_-]+$/.test(id),
		'Demo IDs must be nonempty strings containing only letters, digits, underscores, or hyphens.');
	return id;
}

export function getDemoSteps(groups) {
	const groupIds = new Set();
	const snapshotIds = new Set();
	const steps = [];

	groups.forEach((group, groupIdx) => {
		const groupId = resolveId(group.id, groupIdx);
		assert.ok(!groupIds.has(groupId), `Duplicate demo group ID: ${groupId}`);
		groupIds.add(groupId);

		group.steps.forEach((step, stepIdx) => {
			const id = `${groupId}-${resolveId(step.id, stepIdx)}`;
			assert.ok(!snapshotIds.has(id), `Duplicate demo snapshot ID: ${id}`);
			snapshotIds.add(id);
			steps.push({ id, step });
		});
	});

	return steps;
}

export async function captureStep(step, id, visit) {
	const plots = await step.render();
	assert.ok(Array.isArray(plots) && plots.length > 0, `Demo step ${id} must return a nonempty plot array.`);

	try {
		await new Promise(requestAnimationFrame);
		for (let plotIdx = 0; plotIdx < plots.length; plotIdx++) {
			const u = plots[plotIdx];
			const actual = {
				html: u.root.outerHTML,
				width: u.ctx.width,
				height: u.ctx.height,
				ctxlog: u.ctx.log,
			};
			const snapshotId = plots.length === 1 ? id : `${id}/${plotIdx}`;
			await visit(actual, snapshotId);
		}
	}
	finally {
		for (const plot of plots)
			plot.destroy();
	}
}
