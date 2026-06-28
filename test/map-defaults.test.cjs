const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

test("map defaults OpenSeaMap on and Auto Charts off on first run", () => {
	const app = fs.readFileSync(
		path.join(__dirname, "..", "public", "app.js"),
		"utf8",
	);

	assert.match(
		app,
		/localStorage\.getItem\("ajrmMarineHarbourEditorAutoCharts"\) === "true"/,
	);
	assert.match(
		app,
		/localStorage\.getItem\("ajrmMarineHarbourEditorOpenSeaMap"\) !== "false"/,
	);
});
