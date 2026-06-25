const assert = require("node:assert/strict");
const { test } = require("node:test");

const createPlugin = require("../plugin/index.cjs");

const existingHarbour = {
	id: "11111111-1111-4111-8111-111111111111",
	name: "Harbour: Local Test Harbour",
	feature: {
		type: "Feature",
		geometry: {
			type: "Polygon",
			coordinates: [
				[
					[-5.0, 56.0],
					[-5.0, 56.1],
					[-4.9, 56.1],
					[-5.0, 56.0],
				],
			],
		},
	},
};

function createApp(initialRegions = {}) {
	const regions = { ...initialRegions };
	const writes = [];
	return {
		regions,
		writes,
		setPluginStatus(message) {
			this.status = message;
		},
		setPluginError(message) {
			this.error = message;
		},
		error() {},
		debug() {},
		resourcesApi: {
			async listResources(type) {
				assert.equal(type, "regions");
				return regions;
			},
			async setResource(type, id, body) {
				assert.equal(type, "regions");
				writes.push({ id, body });
				regions[id] = { ...body, id };
			},
			async deleteResource(type, id) {
				assert.equal(type, "regions");
				delete regions[id];
			},
		},
	};
}

async function waitFor(condition) {
	const started = Date.now();
	while (!condition()) {
		if (Date.now() - started > 2000) {
			throw new Error("Timed out waiting for harbour seed.");
		}
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
}

test("seeds bundled default harbours on a fresh install", async () => {
	const app = createApp();
	const plugin = createPlugin(app);

	plugin.start({});

	await waitFor(() => app.writes.length > 0);
	assert.equal(Object.keys(app.regions).length, 572);
	assert.match(app.status, /seeded 572 default harbour regions/);
});

test("does not overwrite existing local harbour data on startup", async () => {
	const app = createApp({ [existingHarbour.id]: existingHarbour });
	const plugin = createPlugin(app);

	plugin.start({});

	await new Promise((resolve) => setTimeout(resolve, 50));
	assert.equal(app.writes.length, 0);
	assert.deepEqual(app.regions[existingHarbour.id], existingHarbour);
});
