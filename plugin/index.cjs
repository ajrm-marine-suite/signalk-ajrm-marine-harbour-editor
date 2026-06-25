const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const HARBOUR_PREFIX = "Harbour:";
const RESOURCE_ID_PATTERN =
	/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const packageJson = JSON.parse(
	fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"),
);
const defaultHarbours = JSON.parse(
	fs.readFileSync(path.join(__dirname, "..", "defaults", "harbours.json"), "utf8"),
);

function normalizeRegions(value) {
	if (!value) {
		return [];
	}
	if (Array.isArray(value)) {
		return value.map((region, index) => ({
			...region,
			id: region.id ?? region.identifier ?? String(index),
		}));
	}
	return Object.entries(value).map(([id, region]) => ({
		...(region || {}),
		id: region?.id ?? region?.identifier ?? id,
	}));
}

function isHarbourRegion(region) {
	return String(region?.name || "")
		.toLowerCase()
		.startsWith(HARBOUR_PREFIX.toLowerCase());
}

function harbourBaseName(region) {
	return String(region?.name || "")
		.replace(new RegExp(`^${HARBOUR_PREFIX}\\s*`, "i"), "")
		.trim();
}

function harbourMergeKey(region) {
	return harbourBaseName(region)
		.toLowerCase()
		.normalize("NFKD")
		.replace(/[\u0300-\u036f]/g, "")
		.replace(/&/g, " and ")
		.replace(/[^a-z0-9]+/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

function isResourceId(value) {
	return RESOURCE_ID_PATTERN.test(String(value || ""));
}

function validateHarbourRegion(region) {
	if (!region || typeof region !== "object") {
		throw new Error("Invalid harbour region entry.");
	}
	if (!region.id || typeof region.id !== "string") {
		throw new Error("Every harbour region must have an id.");
	}
	if (!isResourceId(region.id)) {
		throw new Error(`Region "${region.id}" does not have a valid resource id.`);
	}
	if (!isHarbourRegion(region)) {
		throw new Error(`Region "${region.id}" is not named with ${HARBOUR_PREFIX}.`);
	}
	const geometry = region.feature?.geometry || region.feature || region.geometry;
	if (geometry?.type !== "Polygon" && geometry?.type !== "MultiPolygon") {
		throw new Error(`Region "${region.id}" does not contain a polygon geometry.`);
	}
}

function normalizeImportRegion(region, { preserveId = false } = {}) {
	const { id, identifier, ...resource } = region || {};
	const incomingId = id || identifier;
	return {
		...resource,
		id: preserveId && isResourceId(incomingId) ? incomingId : crypto.randomUUID(),
	};
}

function exportRegion(region) {
	return {
		...region,
	};
}

function resourceBody(region) {
	const { id, identifier, ...resource } = region;
	return resource;
}

function readHarboursFromPayload(payload, { preserveIds = false, log = [] } = {}) {
	if (!payload || typeof payload !== "object") {
		throw new Error("Import file did not contain a harbour JSON object.");
	}
	const source = Array.isArray(payload) ? payload : payload.regions;
	const incoming = normalizeRegions(source).map((region) =>
		normalizeImportRegion(region, { preserveId: preserveIds }),
	);
	incoming.forEach(validateHarbourRegion);
	log.push(`Read ${incoming.length} harbour region(s) from local JSON.`);
	return incoming;
}

module.exports = function ajrmMarineHarbourEditor(app) {
	const plugin = {};

	plugin.id = "signalk-ajrm-marine-harbour-editor";
	plugin.name = "AJRM Marine Harbour Editor";
	plugin.description =
		"Create and manage Signal K harbour regions for automatic profile switching";

	plugin.start = () => {
		app.setPluginStatus(`Started v${packageJson.version}`);
		seedDefaultHarbours().catch((error) => {
			app.setPluginError(`Default harbour seed failed: ${error.message}`);
			app.error?.(`[${plugin.id}] Default harbour seed failed`, error);
		});
	};

	plugin.stop = () => {};

	plugin.schema = {
		type: "object",
		properties: {},
	};

	plugin.registerWithRouter = (router) => {
		router.get("/regions", async (_req, res) => {
			try {
				const regions = await app.resourcesApi.listResources("regions", {});
				res.json({ regions: normalizeRegions(regions) });
			} catch (error) {
				res.status(500).json({ error: error.message });
			}
		});

		router.put("/regions/:id", async (req, res) => {
			try {
				if (!isResourceId(req.params.id)) {
					throw new Error("Invalid resource id. Harbour region ids must be UUIDs.");
				}
				await app.resourcesApi.setResource("regions", req.params.id, req.body);
				res.json({ ok: true, id: req.params.id });
			} catch (error) {
				res.status(400).json({ error: error.message });
			}
		});

		router.delete("/regions/:id", async (req, res) => {
			try {
				await app.resourcesApi.deleteResource("regions", req.params.id);
				res.json({ ok: true });
			} catch (error) {
				res.status(400).json({ error: error.message });
			}
		});

		router.get("/local/export", async (_req, res) => {
			try {
				res.json(await exportHarboursToJson());
			} catch (error) {
				res.status(400).json({ error: error.message });
			}
		});

		router.post("/local/import", async (req, res) => {
			try {
				if (!req.body?.confirm) {
					throw new Error("Import must be confirmed.");
				}
				res.json(await importHarboursFromPayload(req.body?.payload));
			} catch (error) {
				res.status(400).json({
					error: error.message,
					details: error.details,
					log: error.log,
				});
			}
		});

		router.post("/local/merge", async (req, res) => {
			try {
				if (!req.body?.confirm) {
					throw new Error("Merge must be confirmed.");
				}
				res.json(await mergeHarboursFromPayload(req.body?.payload));
			} catch (error) {
				res.status(400).json({
					error: error.message,
					details: error.details,
					log: error.log,
				});
			}
		});
	};

	async function currentHarbourRegions() {
		const regions = await app.resourcesApi.listResources("regions", {});
		return normalizeRegions(regions)
			.filter(isHarbourRegion)
			.map(exportRegion);
	}

	async function seedDefaultHarbours() {
		const existing = await currentHarbourRegions();
		if (existing.length > 0) {
			app.debug?.(
				`[${plugin.id}] Default harbour seed skipped; ${existing.length} harbour region(s) already present.`,
			);
			return;
		}
		const log = [];
		const defaults = readHarboursFromPayload(defaultHarbours, {
			preserveIds: true,
			log,
		});
		for (const region of defaults) {
			await app.resourcesApi.setResource("regions", region.id, resourceBody(region));
		}
		app.setPluginStatus(
			`Started v${packageJson.version}; seeded ${defaults.length} default harbour regions`,
		);
	}

	async function exportHarboursToJson() {
		const regions = await currentHarbourRegions();
		return {
			ok: true,
			version: 1,
			exportedAt: new Date().toISOString(),
			count: regions.length,
			regions,
		};
	}

	async function importHarboursFromPayload(payload) {
		const log = ["Import started."];
		const incoming = readHarboursFromPayload(payload, {
			preserveIds: true,
			log,
		});

		const existing = await currentHarbourRegions();
		for (const region of existing) {
			if (!isResourceId(region.id)) {
				app.debug?.(
					`[${plugin.id}] Skipping existing harbour with invalid resource id: ${region.id}`,
				);
				continue;
			}
			await app.resourcesApi.deleteResource("regions", region.id);
		}
		log.push(`Deleted ${existing.length} existing harbour region(s).`);

		for (const region of incoming) {
			await app.resourcesApi.setResource("regions", region.id, resourceBody(region));
		}
		log.push(`Imported ${incoming.length} harbour region(s).`);

		return {
			ok: true,
			action: "imported",
			imported: incoming.length,
			deleted: existing.length,
			log,
		};
	}

	async function mergeHarboursFromPayload(payload) {
		const log = ["Merge started."];
		const incoming = readHarboursFromPayload(payload, { log });
		const existing = await currentHarbourRegions();
		const existingKeys = new Set(
			existing.map(harbourMergeKey).filter((key) => key.length > 0),
		);
		const toAdd = [];
		let skipped = 0;

		for (const region of incoming) {
			const key = harbourMergeKey(region);
			if (key && existingKeys.has(key)) {
				skipped++;
				continue;
			}
			toAdd.push(region);
			if (key) {
				existingKeys.add(key);
			}
		}

		for (const region of toAdd) {
			await app.resourcesApi.setResource("regions", region.id, resourceBody(region));
		}

		log.push(`Found ${existing.length} existing harbour region(s) on this Signal K server.`);
		log.push(`Skipped ${skipped} JSON harbour region(s) already present locally.`);
		log.push(`Added ${toAdd.length} missing harbour region(s) from local JSON.`);

		return {
			ok: true,
			action: "merged",
			incoming: incoming.length,
			existing: existing.length,
			added: toAdd.length,
			skipped,
			log,
		};
	}

	return plugin;
};
