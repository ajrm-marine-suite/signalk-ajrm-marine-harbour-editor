const harbourPrefix = "Harbour:";
const apiBase = "/plugins/signalk-ajrm-marine-harbour-editor";

const elements = {
	map: document.querySelector("#map"),
	openEditor: document.querySelector("#openEditor"),
	closeEditor: document.querySelector("#closeEditor"),
	openMoveControls: document.querySelector("#openMoveControls"),
	closeMoveControls: document.querySelector("#closeMoveControls"),
	moveControls: document.querySelector("#moveControls"),
	moveControlsHandle: document.querySelector("#moveControlsHandle"),
	openSettings: document.querySelector("#openSettings"),
	closeSettings: document.querySelector("#closeSettings"),
	editorDrawer: document.querySelector("#editorDrawer"),
	settingsDrawer: document.querySelector("#settingsDrawer"),
	baseMapChoices: [...document.querySelectorAll('input[name="baseMap"]')],
	autoCharts: document.querySelector("#checkAutoCharts"),
	openSeaMap: document.querySelector("#checkOpenSeaMap"),
	selectedSummary: document.querySelector("#selectedSummary"),
	regionList: document.querySelector("#regionList"),
	refreshRegions: document.querySelector("#refreshRegions"),
	mergeHarbours: document.querySelector("#mergeHarbours"),
	importHarbours: document.querySelector("#importHarbours"),
	exportHarbours: document.querySelector("#exportHarbours"),
	harbourImportFile: document.querySelector("#harbourImportFile"),
	syncMessages: document.querySelector("#syncMessages"),
	newRegion: document.querySelector("#newRegion"),
	regionName: document.querySelector("#regionName"),
	regionId: document.querySelector("#regionId"),
	radiusNm: document.querySelector("#radiusNm"),
	decreaseRadius: document.querySelector("#decreaseRadius"),
	applyRadius: document.querySelector("#applyRadius"),
	increaseRadius: document.querySelector("#increaseRadius"),
	nudgeNorth: document.querySelector("#nudgeNorth"),
	nudgeSouth: document.querySelector("#nudgeSouth"),
	nudgeWest: document.querySelector("#nudgeWest"),
	nudgeEast: document.querySelector("#nudgeEast"),
	makeCircle: document.querySelector("#makeCircle"),
	points: document.querySelector("#points"),
	saveRegion: document.querySelector("#saveRegion"),
	saveRegionFloating: document.querySelector("#saveRegionFloating"),
	deleteRegion: document.querySelector("#deleteRegion"),
	status: document.querySelector("#status"),
};

let regions = [];
let selectedId = null;
let localPreviewVisible = false;
const editStepNm = 0.025;
const previewRenderDelayMs = 1200;
const previewRenderMaxDelayMs = 2500;
const chartLayerZIndex = 650;
const seamarkLayerZIndex = 750;
let map = null;
let savedRegionLayer = null;
let previewRegionLayer = null;
let autoChartGroup = null;
let autoChartLayer = null;
let autoChartFallbackLayer = null;
let autoChartId = null;
let autoChartList = [];
let seamarkLayer = null;
let baseLayers = {};
let currentBaseLayer = null;
let previewRenderTimer = null;
let previewRenderPendingSince = 0;

function showStatus(message, isError = false) {
	elements.status.textContent = message;
	elements.status.style.background = isError ? "#7f1d1d" : "#0f172a";
	elements.status.classList.add("visible");
	setTimeout(() => elements.status.classList.remove("visible"), 3500);
}

function setSyncMessages(lines) {
	const messages = Array.isArray(lines) ? lines : [lines];
	elements.syncMessages.textContent = messages.filter(Boolean).join("\n") || "Ready.";
	elements.syncMessages.scrollTop = elements.syncMessages.scrollHeight;
}

function downloadJson(filename, payload) {
	const blob = new Blob([`${JSON.stringify(payload, null, 2)}\n`], {
		type: "application/json",
	});
	const url = URL.createObjectURL(blob);
	const link = document.createElement("a");
	link.href = url;
	link.download = filename;
	document.body.appendChild(link);
	link.click();
	link.remove();
	URL.revokeObjectURL(url);
}

function chooseHarbourJsonFile() {
	return new Promise((resolve, reject) => {
		elements.harbourImportFile.value = "";
		const cleanup = () => {
			elements.harbourImportFile.removeEventListener("change", onChange);
		};
		const onChange = () => {
			const file = elements.harbourImportFile.files?.[0];
			cleanup();
			if (!file) {
				resolve(null);
				return;
			}
			const reader = new FileReader();
			reader.addEventListener("load", () => {
				try {
					resolve({
						file,
						payload: JSON.parse(String(reader.result || "")),
					});
				} catch (error) {
					reject(new Error(`Could not read ${file.name}: ${error.message}`));
				}
			});
			reader.addEventListener("error", () =>
				reject(new Error(`Could not read ${file.name}.`)),
			);
			reader.readAsText(file);
		};
		elements.harbourImportFile.addEventListener("change", onChange, { once: true });
		elements.harbourImportFile.click();
	});
}

function harbourMergeKey(region) {
	return stripHarbourPrefix(region?.name)
		.toLowerCase()
		.normalize("NFKD")
		.replace(/[\u0300-\u036f]/g, "")
		.replace(/&/g, " and ")
		.replace(/[^a-z0-9]+/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

function normalizeImportedHarbours(payload, { preserveIds = false } = {}) {
	const source = Array.isArray(payload) ? payload : payload?.regions;
	if (!Array.isArray(source)) {
		throw new Error("Harbour JSON must contain a regions array.");
	}
	return source.map((region) => {
		const id = preserveIds && region.id ? region.id : createResourceId();
		return {
			...region,
			id,
		};
	});
}

function regionResourceBody(region) {
	const { id, identifier, ...body } = region;
	return body;
}

async function saveImportedRegion(region) {
	await requestJson(`${apiBase}/regions/${encodeURIComponent(region.id)}`, {
		method: "PUT",
		body: JSON.stringify(regionResourceBody(region)),
	});
}

function refreshMapLayout() {
	map?.invalidateSize({ pan: false });
	updateAutoChart();
}

function syncDrawerButtons() {
	elements.openEditor.setAttribute(
		"aria-pressed",
		String(elements.editorDrawer.classList.contains("open")),
	);
	elements.openMoveControls.setAttribute(
		"aria-pressed",
		String(elements.moveControls.classList.contains("open")),
	);
	elements.openSettings.setAttribute(
		"aria-pressed",
		String(elements.settingsDrawer.classList.contains("open")),
	);
}

function setDrawerOpen(drawer, isOpen) {
	drawer?.classList.toggle("open", isOpen);
	syncDrawerButtons();
	setTimeout(refreshMapLayout, 180);
	setTimeout(refreshMapLayout, 320);
}

function closeDrawer(drawer) {
	setDrawerOpen(drawer, false);
}

function toggleDrawer(drawer) {
	setDrawerOpen(drawer, !drawer?.classList.contains("open"));
}

function setMoveControlsOpen(isOpen) {
	elements.moveControls.classList.toggle("open", isOpen);
	syncDrawerButtons();
}

function toggleMoveControls() {
	setMoveControlsOpen(!elements.moveControls.classList.contains("open"));
}

function makeMoveControlsDraggable() {
	let drag = null;
	elements.moveControlsHandle.addEventListener("pointerdown", (event) => {
		if (event.target.closest("button")) {
			return;
		}
		const rect = elements.moveControls.getBoundingClientRect();
		drag = {
			offsetX: event.clientX - rect.left,
			offsetY: event.clientY - rect.top,
		};
		elements.moveControlsHandle.setPointerCapture(event.pointerId);
	});
	elements.moveControlsHandle.addEventListener("pointermove", (event) => {
		if (!drag) {
			return;
		}
		const width = elements.moveControls.offsetWidth;
		const height = elements.moveControls.offsetHeight;
		const left = Math.max(
			8,
			Math.min(window.innerWidth - width - 8, event.clientX - drag.offsetX),
		);
		const top = Math.max(
			8,
			Math.min(window.innerHeight - height - 8, event.clientY - drag.offsetY),
		);
		elements.moveControls.style.left = `${left}px`;
		elements.moveControls.style.top = `${top}px`;
		elements.moveControls.style.right = "auto";
	});
	elements.moveControlsHandle.addEventListener("pointerup", (event) => {
		drag = null;
		elements.moveControlsHandle.releasePointerCapture(event.pointerId);
	});
}

function stripHarbourPrefix(name) {
	const value = String(name || "").trim();
	return value.toLowerCase().startsWith(harbourPrefix.toLowerCase())
		? value.slice(harbourPrefix.length).trim()
		: value;
}

function makeRegionName(name) {
	const clean = stripHarbourPrefix(name);
	return `${harbourPrefix} ${clean}`.trim();
}

function createResourceId() {
	if (crypto?.randomUUID) {
		return crypto.randomUUID();
	}
	const bytes = crypto.getRandomValues(new Uint8Array(16));
	bytes[6] = (bytes[6] & 0x0f) | 0x40;
	bytes[8] = (bytes[8] & 0x3f) | 0x80;
	const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0"));
	return [
		hex.slice(0, 4).join(""),
		hex.slice(4, 6).join(""),
		hex.slice(6, 8).join(""),
		hex.slice(8, 10).join(""),
		hex.slice(10, 16).join(""),
	].join("-");
}

function getOrCreateRegionId() {
	const existing = elements.regionId.value.trim();
	if (existing) {
		return existing;
	}
	const id = createResourceId();
	elements.regionId.value = id;
	return id;
}

function parsePoints() {
	return elements.points.value
		.split(/\n+/)
		.map((line) => line.trim())
		.filter(Boolean)
		.map((line) => {
			const parts = line.split(/[,\s]+/).map(Number);
			if (parts.length < 2 || !Number.isFinite(parts[0]) || !Number.isFinite(parts[1])) {
				throw new Error(`Invalid point: ${line}`);
			}
			return { lat: parts[0], lon: parts[1] };
		});
}

function formatPoints(points) {
	return points.map((point) => `${point.lat.toFixed(6)}, ${point.lon.toFixed(6)}`).join("\n");
}

function toRadians(value) {
	return (value * Math.PI) / 180;
}

function distanceNm(a, b) {
	const radiusNm = 3440.065;
	const deltaLat = toRadians(b.lat - a.lat);
	const deltaLon = toRadians(b.lon - a.lon);
	const lat1 = toRadians(a.lat);
	const lat2 = toRadians(b.lat);
	const sinLat = Math.sin(deltaLat / 2);
	const sinLon = Math.sin(deltaLon / 2);
	const value =
		sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLon * sinLon;
	return 2 * radiusNm * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

function estimateCircle(points) {
	if (points.length < 3) {
		throw new Error("A circle needs at least three polygon points.");
	}
	const center = points.reduce(
		(total, point) => ({
			lat: total.lat + point.lat / points.length,
			lon: total.lon + point.lon / points.length,
		}),
		{ lat: 0, lon: 0 },
	);
	const radiusNm =
		points.reduce((total, point) => total + distanceNm(center, point), 0) /
		points.length;
	return { center, radiusNm };
}

function closeRing(coordinates) {
	const first = coordinates[0];
	const last = coordinates[coordinates.length - 1];
	if (!first || !last || first[0] !== last[0] || first[1] !== last[1]) {
		coordinates.push([...first]);
	}
	return coordinates;
}

function geometryToPoints(region) {
	const geometry = region.feature?.geometry || region.feature || region.geometry;
	const ring = geometry?.type === "Polygon" ? geometry.coordinates?.[0] : null;
	if (!Array.isArray(ring)) {
		return [];
	}
	const points = ring.slice();
	const first = points[0];
	const last = points[points.length - 1];
	if (first && last && first[0] === last[0] && first[1] === last[1]) {
		points.pop();
	}
	return points.map(([lon, lat]) => ({ lat, lon }));
}

function regionGeometry(region) {
	return region.feature?.geometry || region.feature || region.geometry;
}

function geometryToLatLngs(region) {
	const geometry = regionGeometry(region);
	if (geometry?.type === "Polygon") {
		return geometry.coordinates
			.map((ring) =>
				ring
					.map(([lon, lat]) => [Number(lat), Number(lon)])
					.filter(([lat, lon]) => Number.isFinite(lat) && Number.isFinite(lon)),
			)
			.filter((ring) => ring.length >= 3);
	}
	if (geometry?.type === "MultiPolygon") {
		return geometry.coordinates
			.flatMap((polygon) =>
				polygon.map((ring) =>
					ring
						.map(([lon, lat]) => [Number(lat), Number(lon)])
						.filter(([lat, lon]) => Number.isFinite(lat) && Number.isFinite(lon)),
				),
			)
			.filter((ring) => ring.length >= 3);
	}
	return [];
}

function labelPointForRegion(region) {
	const points = geometryToPoints(region);
	if (!points.length) {
		return null;
	}
	const south = Math.min(...points.map((point) => point.lat));
	const southern = points.filter((point) => Math.abs(point.lat - south) < 1e-7);
	const lon =
		southern.reduce((total, point) => total + point.lon, 0) / southern.length;
	return [south, lon];
}

function getHarbourRegions() {
	return regions
		.filter((region) =>
			String(region.name || "").toLowerCase().startsWith(harbourPrefix.toLowerCase()),
		)
		.sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
}

function renderRegionList() {
	const harbourRegions = getHarbourRegions();
	elements.regionList.innerHTML = "";
	if (harbourRegions.length === 0) {
		elements.regionList.textContent = "No harbour regions yet.";
		return;
	}
	for (const region of harbourRegions) {
		const button = document.createElement("button");
		button.type = "button";
		button.className = `region-item${region.id === selectedId ? " selected" : ""}`;
		button.textContent = stripHarbourPrefix(region.name) || region.id;
		button.addEventListener("click", () => selectRegion(region.id));
		elements.regionList.append(button);
	}
}

function renderMapRegions() {
	if (!map || !savedRegionLayer || !previewRegionLayer) {
		return;
	}
	cancelScheduledPreviewRender();
	savedRegionLayer.clearLayers();
	previewRegionLayer.clearLayers();
	for (const region of getHarbourRegions()) {
		const rings = geometryToLatLngs(region);
		for (const ring of rings) {
			L.polygon(ring, {
				color: region.id === selectedId ? "#0f766e" : "#22c55e",
				weight: region.id === selectedId ? 5 : 3,
				opacity: 0.95,
				fill: false,
				dashArray: "7 8",
				interactive: true,
			})
				.on("click", () => selectRegion(region.id))
				.addTo(savedRegionLayer);
		}
		const labelPoint = labelPointForRegion(region);
		if (labelPoint) {
			L.tooltip({
				permanent: true,
				direction: "bottom",
				opacity: 0.92,
				offset: [0, 8],
				className: "harbour-label",
			})
				.setLatLng(labelPoint)
				.setContent(stripHarbourPrefix(region.name))
				.addTo(savedRegionLayer);
		}
	}
	renderPreviewRegion();
}

function renderPreviewRegion() {
	if (!previewRegionLayer) {
		return;
	}
	previewRegionLayer.clearLayers();
	if (!localPreviewVisible) {
		return;
	}
	try {
		const preview = buildRegion();
		for (const ring of geometryToLatLngs(preview)) {
			L.polygon(ring, {
				color: "#ef4444",
				weight: 9,
				opacity: 0.95,
				fill: false,
				dashArray: "7 8",
				interactive: false,
			}).addTo(previewRegionLayer);
		}
	} catch {
		// No valid edit geometry yet.
	}
}

function cancelScheduledPreviewRender() {
	if (previewRenderTimer) {
		clearTimeout(previewRenderTimer);
		previewRenderTimer = null;
	}
	previewRenderPendingSince = 0;
}

function schedulePreviewRender() {
	if (!previewRegionLayer) {
		return;
	}
	const now = Date.now();
	if (!previewRenderPendingSince) {
		previewRenderPendingSince = now;
	}
	const maxDelayRemaining = Math.max(
		0,
		previewRenderMaxDelayMs - (now - previewRenderPendingSince),
	);
	const delay = Math.min(previewRenderDelayMs, maxDelayRemaining);
	if (previewRenderTimer) {
		clearTimeout(previewRenderTimer);
	}
	previewRenderTimer = setTimeout(() => {
		previewRenderTimer = null;
		previewRenderPendingSince = 0;
		renderPreviewRegion();
	}, delay);
}

function setCircleCentreCrosshairVisible(isVisible) {
	elements.map?.classList.toggle("show-circle-centre-crosshair", isVisible);
}

function selectRegion(id) {
	setCircleCentreCrosshairVisible(false);
	localPreviewVisible = false;
	const region = regions.find((item) => item.id === id);
	if (!region) {
		return;
	}
	selectedId = id;
	elements.regionName.value = stripHarbourPrefix(region.name);
	elements.regionId.value = region.id;
	elements.selectedSummary.textContent = stripHarbourPrefix(region.name) || region.id;
	const points = geometryToPoints(region);
	elements.points.value = formatPoints(points);
	if (points.length >= 3) {
		const circle = estimateCircle(points);
		elements.radiusNm.value = circle.radiusNm.toFixed(2);
	}
	renderRegionList();
	renderMapRegions();
	const rings = geometryToLatLngs(region);
	if (rings.length && map) {
		map.fitBounds(L.latLngBounds(rings[0]), { padding: [60, 60], maxZoom: 15 });
	}
}

function resetEditor({ keepName = false } = {}) {
	const existingName = elements.regionName.value;
	selectedId = null;
	localPreviewVisible = false;
	elements.regionName.value = keepName ? existingName : "";
	elements.regionId.value = "";
	elements.points.value = "";
	elements.selectedSummary.textContent =
		keepName && existingName.trim() ? existingName.trim() : "New harbour";
	setCircleCentreCrosshairVisible(true);
	renderRegionList();
	renderMapRegions();
}

async function requestJson(url, options = {}) {
	const response = await fetch(url, {
		headers: { "Content-Type": "application/json" },
		...options,
	});
	if (!response.ok) {
		const body = await response.json().catch(() => ({}));
		const error = new Error(body.error || `${response.status} ${response.statusText}`);
		error.details = body.details || body.log || null;
		throw error;
	}
	return response.json();
}

function chartUrl(chart) {
	return chart?.tilemapUrl || chart?.url || chart?.tileUrl || chart?.href || "";
}

function chartZoom(chart) {
	const min = Number(chart?.minzoom ?? chart?.minZoom ?? 0);
	const max = Number(chart?.maxzoom ?? chart?.maxZoom ?? 24);
	return {
		min: Number.isFinite(min) ? min : 0,
		max: Number.isFinite(max) ? max : 24,
	};
}

function chartBoundsCandidates(chart) {
	const source =
		chart?.bounds ||
		chart?.boundingBox ||
		chart?.extent ||
		chart?.bbox ||
		chart?.properties?.bounds ||
		chart?.properties?.bbox ||
		chart?.metadata?.bounds;
	let candidates = [];
	if (Array.isArray(source) && source.some(Array.isArray)) {
		const points = source
			.filter(Array.isArray)
			.map((point) => point.slice(0, 2).map(Number))
			.filter((point) => point.length === 2 && point.every(Number.isFinite));
		if (points.length >= 2) {
			const xs = points.map((point) => point[0]);
			const ys = points.map((point) => point[1]);
			candidates.push([Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]);
			candidates.push([Math.min(...ys), Math.min(...xs), Math.max(...ys), Math.max(...xs)]);
		}
	} else {
		let bounds = null;
		if (Array.isArray(source)) {
			bounds = source.slice(0, 4).map(Number);
		} else if (typeof source === "string") {
			bounds = source.split(/[\\s,]+/).map(Number).filter(Number.isFinite).slice(0, 4);
		} else if (source && typeof source === "object") {
			if (source.sw && source.ne) {
				bounds = [
					source.sw.lng ?? source.sw.lon ?? source.sw[1],
					source.sw.lat ?? source.sw[0],
					source.ne.lng ?? source.ne.lon ?? source.ne[1],
					source.ne.lat ?? source.ne[0],
				].map(Number);
			} else {
				bounds = [
					source.minLon ?? source.west ?? source.left ?? source.minx ?? source.xmin,
					source.minLat ?? source.south ?? source.bottom ?? source.miny ?? source.ymin,
					source.maxLon ?? source.east ?? source.right ?? source.maxx ?? source.xmax,
					source.maxLat ?? source.north ?? source.top ?? source.maxy ?? source.ymax,
				].map(Number);
			}
		}
		if (bounds?.length >= 4) {
			const [a, b, c, d] = bounds;
			candidates.push([Math.min(a, c), Math.min(b, d), Math.max(a, c), Math.max(b, d)]);
			candidates.push([Math.min(b, d), Math.min(a, c), Math.max(b, d), Math.max(a, c)]);
		}
	}
	return candidates.filter(
		(bounds) =>
			bounds.every(Number.isFinite) &&
			bounds[0] >= -180 &&
			bounds[2] <= 180 &&
			bounds[1] >= -90 &&
			bounds[3] <= 90 &&
			bounds[0] < bounds[2] &&
			bounds[1] < bounds[3],
	);
}

function chartBounds(chart, lat, lon) {
	const candidates = chartBoundsCandidates(chart);
	return (
		candidates.find(
			(bounds) =>
				lon >= bounds[0] && lon <= bounds[2] && lat >= bounds[1] && lat <= bounds[3],
		) ||
		candidates[0] ||
		null
	);
}

function chartContains(chart, lat, lon) {
	const bounds = chartBounds(chart, lat, lon);
	return Boolean(
		bounds && lon >= bounds[0] && lon <= bounds[2] && lat >= bounds[1] && lat <= bounds[3],
	);
}

function chartArea(chart, lat, lon) {
	const bounds = chartBounds(chart, lat, lon);
	return bounds ? Math.abs((bounds[2] - bounds[0]) * (bounds[3] - bounds[1])) : Number.MAX_VALUE;
}

function makeAutoChartFallbackLayer() {
	return L.tileLayer("", { attribution: "" });
}

function makeAutoChartLayer(chart) {
	const url = chartUrl(chart);
	if (!url) {
		return null;
	}
	const zoom = chartZoom(chart);
	return L.tileLayer(url, {
		minNativeZoom: zoom.min,
		maxNativeZoom: zoom.max,
		maxZoom: 22,
		minZoom: zoom.min,
		zIndex: chartLayerZIndex,
		attribution: "",
		errorTileUrl:
			"data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=",
	});
}

function keepChartLayersOnTop() {
	autoChartGroup?.eachLayer((layer) => layer.setZIndex?.(chartLayerZIndex));
	if (seamarkLayer && map?.hasLayer(seamarkLayer)) {
		seamarkLayer.setZIndex?.(seamarkLayerZIndex);
		seamarkLayer.bringToFront?.();
	}
	savedRegionLayer?.bringToFront?.();
	previewRegionLayer?.bringToFront?.();
}

function setBaseMap(name) {
	if (!map || !baseLayers[name]) {
		return;
	}
	if (currentBaseLayer) {
		map.removeLayer(currentBaseLayer);
	}
	currentBaseLayer = baseLayers[name];
	currentBaseLayer.addTo(map);
	localStorage.setItem("ajrmMarineHarbourEditorBaseMap", name);
	for (const choice of elements.baseMapChoices) {
		choice.checked = choice.value === name;
	}
	keepChartLayersOnTop();
}

function setOverlay(layer, enabled, storageKey) {
	if (!map || !layer) {
		return;
	}
	if (enabled) {
		layer.addTo(map);
	} else {
		map.removeLayer(layer);
	}
	localStorage.setItem(storageKey, String(enabled));
	updateAutoChart();
	keepChartLayersOnTop();
}

function syncChartControlsFromMap() {
	elements.autoCharts.checked = Boolean(autoChartGroup && map?.hasLayer(autoChartGroup));
	elements.openSeaMap.checked = Boolean(seamarkLayer && map?.hasLayer(seamarkLayer));
}

function chooseAutoChart() {
	if (!map) {
		return null;
	}
	const center = map.getCenter();
	const zoom = map.getZoom();
	const containing = autoChartList.filter((chart) =>
		chartContains(chart, center.lat, center.lng),
	);
	const matches = containing.filter((chart) => {
		const chartZoomRange = chartZoom(chart);
		return zoom >= chartZoomRange.min - 0.1 && zoom <= map.getMaxZoom() + 0.1;
	});
	return (
		matches.sort((a, b) => {
			const zoomA = chartZoom(a);
			const zoomB = chartZoom(b);
			return (
				zoomB.min - zoomA.min ||
				chartArea(a, center.lat, center.lng) - chartArea(b, center.lat, center.lng) ||
				zoomB.max - zoomA.max
			);
		})[0] || null
	);
}

function updateAutoChart() {
	if (!map || !autoChartGroup || !map.hasLayer(autoChartGroup)) {
		return;
	}
	const chart = chooseAutoChart();
	if (!chart) {
		if (autoChartId === "__fallback") {
			keepChartLayersOnTop();
			return;
		}
		autoChartGroup.clearLayers();
		autoChartLayer = null;
		autoChartId = "__fallback";
		autoChartFallbackLayer = makeAutoChartFallbackLayer();
		autoChartGroup.addLayer(autoChartFallbackLayer);
		keepChartLayersOnTop();
		return;
	}
	if (autoChartId === chart.__autoChartId && autoChartLayer && autoChartGroup.hasLayer(autoChartLayer)) {
		keepChartLayersOnTop();
		return;
	}
	autoChartGroup.clearLayers();
	autoChartLayer = makeAutoChartLayer(chart);
	autoChartId = chart.__autoChartId;
	if (autoChartLayer) {
		autoChartGroup.addLayer(autoChartLayer);
	}
	keepChartLayersOnTop();
}

async function loadChartResources() {
	try {
		const charts = await requestJson("/signalk/v1/api/resources/charts");
		autoChartList = Object.entries(charts || {}).map(([id, chart]) => ({
			...(chart || {}),
			__autoChartId: id,
		}));
		updateAutoChart();
	} catch {
		autoChartList = [];
	}
}

function makeNaturalEarthLayer() {
	if (window.protomapsL?.leafletLayer) {
		const options = {
			url: "./ne_10m_land.pmtiles",
			flavor: "light",
			theme: "light",
			lang: "en",
			maxDataZoom: 5,
		};
		if (
			window.protomapsL.light &&
			window.protomapsL.paintRules &&
			window.protomapsL.labelRules
		) {
			const theme = {
				...window.protomapsL.light,
				water: "rgba(0,0,0,0)",
			};
			options.paintRules = window.protomapsL.paintRules(theme);
			options.labelRules = window.protomapsL.labelRules(theme);
		}
		const layer = window.protomapsL.leafletLayer(options);
		layer.setZIndex?.(100);
		return layer;
	}
	return L.tileLayer("", {
		attribution: "NaturalEarth unavailable",
	});
}

function initMap() {
	if (!window.L || !elements.map) {
		showStatus("Chart library did not load.", true);
		return;
	}
	map = L.map(elements.map, {
		center: [55.8, -5.2],
		zoom: 7,
		minZoom: 3,
		maxZoom: 22,
	});
	const empty = L.tileLayer("");
	const openStreetMap = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
		maxNativeZoom: 19,
		maxZoom: 22,
		attribution: "© OpenStreetMap",
	});
	const openTopoMap = L.tileLayer("https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", {
		maxNativeZoom: 17,
		maxZoom: 22,
		attribution: "Map data © OpenStreetMap contributors | Style © OpenTopoMap",
	});
	const satellite = L.tileLayer(
		"https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
		{ maxNativeZoom: 17, maxZoom: 22, attribution: "© Esri © OpenStreetMap Contributors" },
	);
	const naturalEarth = makeNaturalEarthLayer();
	baseLayers = {
		Empty: empty,
		"NaturalEarth (offline)": naturalEarth,
		OpenStreetMap: openStreetMap,
		OpenTopoMap: openTopoMap,
		Satellite: satellite,
	};
	autoChartGroup = L.layerGroup();
	seamarkLayer = L.tileLayer("https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png", {
		maxNativeZoom: 19,
		maxZoom: 22,
		zIndex: seamarkLayerZIndex,
		attribution: "",
	});
	savedRegionLayer = L.layerGroup().addTo(map);
	previewRegionLayer = L.layerGroup().addTo(map);
	L.control
		.layers(
			baseLayers,
			{
				"Auto Charts": autoChartGroup,
				OpenSeaMap: seamarkLayer,
			},
			{ position: "topright" },
		)
		.addTo(map);
	const savedBaseMap = localStorage.getItem("ajrmMarineHarbourEditorBaseMap");
	setBaseMap(
		savedBaseMap && savedBaseMap !== "Empty"
			? savedBaseMap
			: "NaturalEarth (offline)",
	);
	elements.autoCharts.checked = localStorage.getItem("ajrmMarineHarbourEditorAutoCharts") === "true";
	elements.openSeaMap.checked = localStorage.getItem("ajrmMarineHarbourEditorOpenSeaMap") !== "false";
	setOverlay(autoChartGroup, elements.autoCharts.checked, "ajrmMarineHarbourEditorAutoCharts");
	setOverlay(seamarkLayer, elements.openSeaMap.checked, "ajrmMarineHarbourEditorOpenSeaMap");
	map.on("moveend zoomend", updateAutoChart);
	map.on("overlayadd overlayremove baselayerchange", () => {
		syncChartControlsFromMap();
		updateAutoChart();
	});
	loadChartResources();
}

async function loadRegions() {
	const data = await requestJson(`${apiBase}/regions`);
	regions = data.regions || [];
	renderRegionList();
	renderMapRegions();
}

function makeCirclePoints(center, radiusNm, count = 32) {
	const radiusDegLat = radiusNm / 60;
	const radiusDegLon = radiusDegLat / Math.cos((center.lat * Math.PI) / 180);
	return Array.from({ length: count }, (_, index) => {
		const angle = (index / count) * Math.PI * 2;
		return {
			lat: center.lat + Math.sin(angle) * radiusDegLat,
			lon: center.lon + Math.cos(angle) * radiusDegLon,
		};
	});
}

function getMapCentre() {
	if (!map) {
		throw new Error("Map is not ready yet.");
	}
	const center = map.getCenter();
	return { lat: center.lat, lon: center.lng };
}

function applyRadiusChange(deltaNm = 0) {
	const points = parsePoints();
	const circle = estimateCircle(points);
	const requestedRadius = Number(elements.radiusNm.value || circle.radiusNm);
	const radiusNm = Math.max(0.05, requestedRadius + deltaNm);
	elements.radiusNm.value = radiusNm.toFixed(2);
	elements.points.value = formatPoints(
		makeCirclePoints(circle.center, radiusNm, points.length),
	);
	localPreviewVisible = true;
	schedulePreviewRender();
}

function moveCircleCenter(deltaNorthNm = 0, deltaEastNm = 0) {
	const points = parsePoints();
	const circle = estimateCircle(points);
	const radiusNm = Math.max(0.05, Number(elements.radiusNm.value || circle.radiusNm));
	const nextCenter = {
		lat: circle.center.lat + deltaNorthNm / 60,
		lon:
			circle.center.lon +
			deltaEastNm / (60 * Math.cos((circle.center.lat * Math.PI) / 180)),
	};
	elements.radiusNm.value = radiusNm.toFixed(2);
	elements.points.value = formatPoints(makeCirclePoints(nextCenter, radiusNm, points.length));
	localPreviewVisible = true;
	schedulePreviewRender();
}

function buildRegion() {
	const name = makeRegionName(elements.regionName.value);
	if (name === harbourPrefix) {
		throw new Error("Enter a harbour name.");
	}
	const points = parsePoints();
	if (points.length < 3) {
		throw new Error("A harbour region needs at least three points.");
	}
	const coordinates = closeRing(points.map((point) => [point.lon, point.lat]));
	return {
		name,
			description: "Harbour trigger region",
		feature: {
			type: "Feature",
			properties: {
				"aisPlus:profile": "harbor",
			},
			geometry: {
				type: "Polygon",
				coordinates: [coordinates],
			},
		},
	};
}

async function saveRegion() {
	const region = buildRegion();
	const id = getOrCreateRegionId();
	elements.regionId.value = id;
	await requestJson(`${apiBase}/regions/${encodeURIComponent(id)}`, {
		method: "PUT",
		body: JSON.stringify(region),
	});
	selectedId = id;
	await loadRegions();
	localPreviewVisible = false;
	selectRegion(id);
	setCircleCentreCrosshairVisible(false);
	renderMapRegions();
	showStatus("Harbour region saved.");
}

async function deleteRegion() {
	const id = elements.regionId.value.trim();
	if (!id) {
		return;
	}
	await requestJson(`${apiBase}/regions/${encodeURIComponent(id)}`, {
		method: "DELETE",
	});
	resetEditor();
	await loadRegions();
	renderMapRegions();
	showStatus("Harbour region deleted.");
}

async function importHarbours() {
	const selected = await chooseHarbourJsonFile();
	if (!selected) {
		return;
	}
	const confirmed = window.confirm(
		`Import harbour regions from ${selected.file.name}?\n\nThis will replace the current Harbour: regions on this Signal K server.`,
	);
	if (!confirmed) {
		return;
	}
	setSyncMessages([
		"Import started.",
		`Reading ${selected.file.name}...`,
	]);
	try {
		const incoming = normalizeImportedHarbours(selected.payload, { preserveIds: true });
		const existing = getHarbourRegions();
		for (const region of existing) {
			await requestJson(`${apiBase}/regions/${encodeURIComponent(region.id)}`, {
				method: "DELETE",
			});
		}
		for (const region of incoming) {
			await saveImportedRegion(region);
		}
		setSyncMessages([
			`Read ${incoming.length} harbour region(s) from ${selected.file.name}.`,
			`Deleted ${existing.length} existing harbour region(s).`,
			`Imported ${incoming.length} harbour region(s).`,
		]);
		resetEditor();
		await loadRegions();
		showStatus(
			`Imported ${incoming.length} harbour region(s), replaced ${existing.length}.`,
		);
	} catch (error) {
		setSyncMessages(["Import failed.", error.message, error.details].filter(Boolean));
		throw error;
	}
}

async function mergeHarbours() {
	const selected = await chooseHarbourJsonFile();
	if (!selected) {
		return;
	}
	const confirmed = window.confirm(
		`Merge missing harbours from ${selected.file.name}?\n\nExisting local harbours will not be changed.`,
	);
	if (!confirmed) {
		return;
	}
	setSyncMessages([
		"Merge started.",
		`Reading ${selected.file.name}...`,
	]);
	try {
		const incoming = normalizeImportedHarbours(selected.payload);
		const existing = getHarbourRegions();
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
			await saveImportedRegion(region);
		}
		setSyncMessages([
			`Read ${incoming.length} harbour region(s) from ${selected.file.name}.`,
			`Found ${existing.length} existing harbour region(s) on this Signal K server.`,
			`Skipped ${skipped} JSON harbour region(s) already present locally.`,
			`Added ${toAdd.length} missing harbour region(s).`,
		]);
		resetEditor();
		await loadRegions();
		showStatus(
			`Merged ${toAdd.length} missing harbour(s), skipped ${skipped}.`,
		);
	} catch (error) {
		setSyncMessages(["Merge failed.", error.message, error.details].filter(Boolean));
		throw error;
	}
}

async function exportHarbours() {
	setSyncMessages([
		"Export started.",
		"Reading local Signal K harbour regions...",
	]);
	try {
		const harbourRegions = getHarbourRegions();
		const payload = {
			version: 1,
			exportedAt: new Date().toISOString(),
			count: harbourRegions.length,
			regions: harbourRegions,
		};
		const count = payload.count || 0;
		downloadJson("harbours.json", payload);
		setSyncMessages([`Exported ${count} harbour region(s) to harbours.json.`]);
		showStatus(`Downloaded ${count} harbour region(s).`);
	} catch (error) {
		setSyncMessages(["Export failed.", error.message, error.details].filter(Boolean));
		throw error;
	}
}

elements.refreshRegions.addEventListener("click", () =>
	loadRegions().catch((error) => showStatus(error.message, true)),
);
elements.mergeHarbours.addEventListener("click", () =>
	mergeHarbours().catch((error) => showStatus(error.message, true)),
);
elements.importHarbours.addEventListener("click", () =>
	importHarbours().catch((error) => showStatus(error.message, true)),
);
elements.exportHarbours.addEventListener("click", () =>
	exportHarbours().catch((error) => showStatus(error.message, true)),
);
elements.openEditor.addEventListener("click", () => toggleDrawer(elements.editorDrawer));
elements.closeEditor.addEventListener("click", () => closeDrawer(elements.editorDrawer));
elements.openMoveControls.addEventListener("click", toggleMoveControls);
elements.closeMoveControls.addEventListener("click", () => setMoveControlsOpen(false));
elements.openSettings.addEventListener("click", () => toggleDrawer(elements.settingsDrawer));
elements.closeSettings.addEventListener("click", () => closeDrawer(elements.settingsDrawer));
for (const choice of elements.baseMapChoices) {
	choice.addEventListener("change", () => {
		if (choice.checked) {
			setBaseMap(choice.value);
		}
	});
}
elements.autoCharts.addEventListener("change", () =>
	setOverlay(autoChartGroup, elements.autoCharts.checked, "ajrmMarineHarbourEditorAutoCharts"),
);
elements.openSeaMap.addEventListener("change", () =>
	setOverlay(seamarkLayer, elements.openSeaMap.checked, "ajrmMarineHarbourEditorOpenSeaMap"),
);
elements.newRegion.addEventListener("click", () => resetEditor({ keepName: true }));
elements.makeCircle.addEventListener("click", async () => {
	try {
		const center = getMapCentre();
		const radiusNm = Number(elements.radiusNm.value || 0.5);
		const points = makeCirclePoints(center, radiusNm);
		elements.points.value = formatPoints(points);
		localPreviewVisible = true;
		setCircleCentreCrosshairVisible(false);
		renderMapRegions();
		map?.fitBounds(L.latLngBounds(points.map((point) => [point.lat, point.lon])), {
			padding: [60, 60],
			maxZoom: 15,
		});
		showStatus("Circle polygon created.");
	} catch (error) {
		showStatus(error.message, true);
	}
});
elements.decreaseRadius.addEventListener("click", () => {
	try {
		applyRadiusChange(-editStepNm);
		showStatus("Circle radius decreased.");
	} catch (error) {
		showStatus(error.message, true);
	}
});
elements.applyRadius.addEventListener("click", () => {
	try {
		applyRadiusChange(0);
		showStatus("Circle radius applied.");
	} catch (error) {
		showStatus(error.message, true);
	}
});
elements.increaseRadius.addEventListener("click", () => {
	try {
		applyRadiusChange(editStepNm);
		showStatus("Circle radius increased.");
	} catch (error) {
		showStatus(error.message, true);
	}
});
elements.nudgeNorth.addEventListener("click", () => {
	try {
		moveCircleCenter(editStepNm, 0);
		showStatus("Circle moved north.");
	} catch (error) {
		showStatus(error.message, true);
	}
});
elements.nudgeSouth.addEventListener("click", () => {
	try {
		moveCircleCenter(-editStepNm, 0);
		showStatus("Circle moved south.");
	} catch (error) {
		showStatus(error.message, true);
	}
});
elements.nudgeWest.addEventListener("click", () => {
	try {
		moveCircleCenter(0, -editStepNm);
		showStatus("Circle moved west.");
	} catch (error) {
		showStatus(error.message, true);
	}
});
elements.nudgeEast.addEventListener("click", () => {
	try {
		moveCircleCenter(0, editStepNm);
		showStatus("Circle moved east.");
	} catch (error) {
		showStatus(error.message, true);
	}
});
elements.saveRegion.addEventListener("click", () =>
	saveRegion().catch((error) => showStatus(error.message, true)),
);
elements.saveRegionFloating.addEventListener("click", () =>
	saveRegion().catch((error) => showStatus(error.message, true)),
);
elements.deleteRegion.addEventListener("click", () =>
	deleteRegion().catch((error) => showStatus(error.message, true)),
);
elements.regionName.addEventListener("input", () => {
	localPreviewVisible = true;
	schedulePreviewRender();
});
elements.points.addEventListener("input", () => {
	localPreviewVisible = true;
	schedulePreviewRender();
});
elements.radiusNm.addEventListener("input", () => {
	localPreviewVisible = true;
	schedulePreviewRender();
});

initMap();
syncDrawerButtons();
makeMoveControlsDraggable();
loadRegions().catch((error) => showStatus(error.message, true));
