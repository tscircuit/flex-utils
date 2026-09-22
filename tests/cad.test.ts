import { expect, test } from "bun:test";
import {
	createPcbFold,
	transformCadComponent,
	transformCircuitJsonCadComponents,
	rotateVector,
	type CadComponentWithFoldState,
	type PcbBendRecord,
	foldSurfaceMesh,
	extrudePolygon,
} from "../lib";
import type { AnyCircuitElement } from "circuit-json";
const bend: PcbBendRecord = {
	type: "pcb_bend",
	pcb_bend_id: "b",
	pcb_board_id: "board",
	start: { x: 0, y: -20 },
	end: { x: 0, y: 20 },
	bend_angle: 90,
	bend_radius: 2,
	bend_side: "right",
};
const close = (a: { x: number; y: number; z: number }, b: typeof a) => {
	for (const k of ["x", "y", "z"] as const) expect(a[k]).toBeCloseTo(b[k], 7);
};
const base: CadComponentWithFoldState = {
	type: "cad_component",
	cad_component_id: "cad",
	source_component_id: "src",
	pcb_component_id: "pcb",
	position: { x: 20, y: 7, z: 0.5 },
	rotation: { x: 17, y: 29, z: 43 },
	model_object_fit: "contain_within_bounds",
	anchor_alignment: "center",
};

test("CAD pose forward/inverse, all layers, oblique axes, arbitrary rotations and gimbal lock", () => {
	for (const angle of [-130, 90, 180])
		for (const bottom of [false, true])
			for (const z of [0, 37, 90, 180, 270]) {
				const fold = createPcbFold(
					[
						{
							...bend,
							bend_angle: angle,
							start: { x: 10, y: -10 },
							end: { x: -10, y: 10 },
						},
					],
					0.15,
				);
				const cad = {
					...base,
					position: { x: 20, y: 17, z: bottom ? -0.5 : 0.5 },
					rotation: { x: bottom ? 180 : 17, y: 29, z },
				};
				const ctx = {
					fold,
					boardCenter: { x: 5, y: 3 },
					flatMount: { x: 20, y: 17 },
				};
				const folded = transformCadComponent(cad, ctx, true);
				expect(folded.is_on_folded_board).toBe(true);
				expect(transformCadComponent(folded, ctx, true)).toBe(folded);
				const restored = transformCadComponent(folded, ctx, false);
				close(restored.position, cad.position);
				for (const v of [
					{ x: 1, y: 0, z: 0 },
					{ x: 0, y: 1, z: 0 },
					{ x: 0, y: 0, z: 1 },
				])
					close(
						rotateVector(v, restored.rotation!),
						rotateVector(v, cad.rotation),
					);
			}
	const fold = createPcbFold([bend], 0.15);
	const ctx = { fold, boardCenter: { x: 0, y: 0 }, flatMount: { x: 6, y: 3 } };
	const moved = transformCadComponent(
		{
			...base,
			position: { x: 6, y: 3, z: 0.4 },
			rotation: { x: 0, y: 0, z: 0 },
		},
		ctx,
		true,
	);
	// At a +90-degree bend, height becomes -X and distance past the tangent becomes +Z.
	close(moved.position, {
		x: 2 - Math.PI / 2 - 0.4,
		y: 3,
		z: 2 + 6 - Math.PI / 2,
	});
	close(rotateVector({ x: 0, y: 0, z: 1 }, moved.rotation!), {
		x: -1,
		y: 0,
		z: 0,
	});
	close(transformCadComponent(moved, ctx, false).position, {
		x: 6,
		y: 3,
		z: 0.4,
	});
});

test("mixed Circuit JSON poses normalize without mutating PCB data and reject orphan folded CAD", () => {
	const json = [
		{
			type: "pcb_board",
			pcb_board_id: "board",
			center: { x: 10, y: 5 },
			thickness: 0.15,
		},
		bend,
		{
			type: "pcb_component",
			pcb_component_id: "pcb",
			center: { x: 20, y: 7 },
			layer: "top",
		},
		base,
	] as AnyCircuitElement[];
	const before = JSON.stringify(json);
	const folded = transformCircuitJsonCadComponents(json, { foldPcbs: true });
	expect(JSON.stringify(json)).toBe(before);
	for (let i = 0; i < 3; i++) expect(folded[i]).toBe(json[i]);
	expect(transformCircuitJsonCadComponents(folded, { foldPcbs: true })).toEqual(
		folded,
	);
	const restored = transformCircuitJsonCadComponents(folded, {
		foldPcbs: false,
	});
	close((restored[3] as CadComponentWithFoldState).position, base.position);
	const orphan = {
		...base,
		pcb_component_id: undefined,
		is_on_folded_board: true,
	};
	expect(() =>
		transformCircuitJsonCadComponents([orphan], { foldPcbs: false }),
	).toThrow("flat pcb_component");
});

test("surface subdivision keeps top UVs tied to the flat sheet and spans the arc", () => {
	const mesh = extrudePolygon(
		[
			{ x: -5, y: -1 },
			{ x: 6, y: -1 },
			{ x: 6, y: 1 },
			{ x: -5, y: 1 },
		],
		-0.075,
		0.075,
	);
	const folded = foldSurfaceMesh(mesh, createPcbFold([bend], 0.15));
	expect(folded.triangles.length).toBeGreaterThan(mesh.triangles.length);
	expect(folded.boundingBox.max.z).toBeCloseTo(2 + 6 - Math.PI / 2, 5);
	const tops = folded.triangles.filter((t) => t.pcbFace === "top");
	expect(tops.some((t) => t.normal.x < -0.99)).toBe(true);
	for (const t of tops)
		for (const uv of t.uvs!) {
			expect(uv.u).toBeGreaterThanOrEqual(0);
			expect(uv.u).toBeLessThanOrEqual(1);
		}
});

test("four bends stack three distinct mounts and each inverse recovers its own disc", () => {
	const pitch = 22,
		spacing = 6 + Math.PI / 2 - 2,
		a = (pitch - spacing) / 2,
		b = (pitch + spacing) / 2;
	const bends = [a, b, pitch + a, pitch + b].map((x, i) => ({
		...bend,
		pcb_bend_id: `b${i}`,
		start: { x: x - pitch, y: -6 },
		end: { x: x - pitch, y: 6 },
		bend_radius: 1,
		bend_angle: i < 2 ? 90 : -90,
	}));
	for (const order of [bends, [...bends].reverse()]) {
		const fold = createPcbFold(order, 0.15);
		for (let i = 0; i < 3; i++) {
			const mount = { x: (i - 1) * pitch, y: 2, z: 0 },
				surface = fold.point(mount);
			close(surface, { x: -pitch, y: 2, z: i * 6 });
			close(fold.inversePoint(surface, mount), mount);
			const cad = {
				...base,
				position: { ...mount, z: 0.3 },
				rotation: { x: 0, y: 0, z: 37 },
			};
			const ctx = { fold, boardCenter: { x: 0, y: 0 }, flatMount: mount };
			const posed = transformCadComponent(cad, ctx, true);
			close(posed.position, {
				x: -pitch,
				y: 2,
				z: i * 6 + (i === 1 ? -0.3 : 0.3),
			});
			close(transformCadComponent(posed, ctx, false).position, cad.position);
		}
	}
});

test("board ownership is explicit for panels and ambiguous mounts are rejected", () => {
	const json = [
		{
			type: "pcb_board",
			pcb_board_id: "board",
			center: { x: 10, y: 5 },
			thickness: 0.15,
		},
		{
			type: "pcb_board",
			pcb_board_id: "other",
			center: { x: -100, y: 50 },
			thickness: 0.15,
		},
		bend,
		{
			type: "pcb_component",
			pcb_component_id: "pcb",
			center: { x: 20, y: 7 },
			layer: "top",
			positioned_relative_to_pcb_board_id: "board",
		},
		base,
	] as AnyCircuitElement[];
	const folded = transformCircuitJsonCadComponents(json, { foldPcbs: true });
	close(
		(
			transformCircuitJsonCadComponents(folded, {
				foldPcbs: false,
			})[4] as CadComponentWithFoldState
		).position,
		base.position,
	);
	const ambiguous = json.map((e) =>
		e.type === "pcb_component"
			? { ...e, positioned_relative_to_pcb_board_id: undefined }
			: e,
	);
	expect(() =>
		transformCircuitJsonCadComponents(ambiguous, { foldPcbs: true }),
	).toThrow("unambiguously");
});

test("ordinary PCB data is unchanged when folding is requested", () => {
	const json = [
		{ ...base },
		{ type: "pcb_component", pcb_component_id: "pcb", center: { x: 0, y: 0 } },
	] as AnyCircuitElement[];
	expect(transformCircuitJsonCadComponents(json, { foldPcbs: true })).toEqual(
		json,
	);
});
