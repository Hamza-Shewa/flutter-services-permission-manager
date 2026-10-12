import * as fs from "fs";
import * as path from "path";
import { resolveRoutes } from "./route-paths.js";
import {
  TRAIL_STEP_KINDS,
  type Trail,
  type TrailFile,
  type TrailGraph,
  type TrailStep,
  type TrailWithIssues,
} from "./types.js";

/** Trails an AI agent worked out live in the project, so they can be committed and shared with the team. */
export const TRAILS_FILE = ".flutter-config-manager/trails.json";

const MAX_TRAILS = 100;
const MAX_STEPS = 80;
const MAX_BRANCHES = 6;
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const TRAIL_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const STEP_ID = /^[A-Za-z0-9_-]{1,40}$/;

export type TrailValidation =
  | { ok: true; trail: Trail; warnings: string[] }
  | { ok: false; errors: string[] };

export function trailsFilePath(root: string): string {
  return path.join(root, ...TRAILS_FILE.split("/"));
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/-+$/g, "");
}

function text(value: unknown, field: string, limit: number, errors: string[], required = false): string | undefined {
  if (value === undefined || value === null || value === "") {
    if (required) {
      errors.push(`${field} is required.`);
    }
    return undefined;
  }
  if (typeof value !== "string") {
    errors.push(`${field} must be a string.`);
    return undefined;
  }
  const trimmed = value.trim();
  if (trimmed.length > limit) {
    errors.push(`${field} is longer than ${limit} characters.`);
    return undefined;
  }
  if (required && !trimmed) {
    errors.push(`${field} is required.`);
  }
  return trimmed || undefined;
}

/** A project-relative path inside the project, or undefined when it escapes it or does not exist. */
function projectFile(root: string, value: string): string | undefined {
  const normalized = value.replace(/\\/g, "/").replace(/^\.\//, "");
  if (!normalized || normalized.startsWith("/") || /^[A-Za-z]:/.test(normalized) || normalized.split("/").includes("..")) {
    return undefined;
  }
  const absolute = path.resolve(root, normalized);
  const rootWithSeparator = `${path.resolve(root)}${path.sep}`;
  return absolute.startsWith(rootWithSeparator) && fs.existsSync(absolute) ? normalized : undefined;
}

function validateStep(raw: unknown, index: number, root: string, graph: TrailGraph, errors: string[], warnings: string[]): TrailStep | undefined {
  const label = `steps[${index}]`;
  if (!raw || typeof raw !== "object") {
    errors.push(`${label} must be an object.`);
    return undefined;
  }
  const input = raw as Record<string, unknown>;
  const stepErrors: string[] = [];
  const id = typeof input.id === "string" && input.id.trim() ? input.id.trim() : `s${index + 1}`;
  if (!STEP_ID.test(id)) {
    stepErrors.push(`${label}.id "${id}" may only contain letters, digits, "-" and "_" (max 40).`);
  }
  const title = text(input.title, `${label}.title`, 160, stepErrors, true);
  const kind = input.kind;
  if (typeof kind !== "string" || !TRAIL_STEP_KINDS.includes(kind as TrailStep["kind"])) {
    stepErrors.push(`${label}.kind must be one of ${TRAIL_STEP_KINDS.join(", ")}.`);
  }
  const step: TrailStep = { id, title: title ?? "", kind: kind as TrailStep["kind"] };

  if (input.route !== undefined && input.route !== null && input.route !== "") {
    if (typeof input.route !== "string") {
      stepErrors.push(`${label}.route must be a route id string.`);
    } else if (graph.routes.some((route) => route.id === input.route)) {
      step.route = input.route;
    } else {
      const matches = resolveRoutes(graph, input.route);
      if (matches.length === 1) {
        step.route = matches[0].id;
        warnings.push(`${label}.route "${input.route}" was matched to "${matches[0].id}".`);
      } else {
        const hint = matches.length ? ` Did you mean: ${matches.map((route) => route.id).join(", ")}?` : " Run scan_routes for the list of route ids.";
        stepErrors.push(`${label}.route "${input.route}" is not a route in the graph.${hint}`);
      }
    }
  }
  if (input.source !== undefined && input.source !== null) {
    const source = input.source as Record<string, unknown>;
    if (typeof source !== "object" || typeof source.path !== "string") {
      stepErrors.push(`${label}.source must be { path, line? }.`);
    } else {
      const file = projectFile(root, source.path);
      if (!file) {
        stepErrors.push(`${label}.source.path "${source.path}" is not an existing file inside the project (use a project-relative path).`);
      } else {
        const line = typeof source.line === "number" && Number.isInteger(source.line) && source.line > 0 ? source.line : undefined;
        step.source = line ? { path: file, line } : { path: file };
      }
    }
  }
  const condition = text(input.condition, `${label}.condition`, 300, stepErrors);
  if (condition) {
    step.condition = condition;
  }
  const note = text(input.note, `${label}.note`, 600, stepErrors);
  if (note) {
    step.note = note;
  }
  if (input.optional !== undefined) {
    if (typeof input.optional !== "boolean") {
      stepErrors.push(`${label}.optional must be a boolean.`);
    } else if (input.optional) {
      step.optional = true;
    }
  }
  if (input.branches !== undefined && input.branches !== null) {
    if (!Array.isArray(input.branches) || input.branches.length > MAX_BRANCHES) {
      stepErrors.push(`${label}.branches must be an array of at most ${MAX_BRANCHES} items.`);
    } else {
      const branches: NonNullable<TrailStep["branches"]> = [];
      input.branches.forEach((branch: unknown, branchIndex: number) => {
        const item = branch as Record<string, unknown>;
        const branchLabel = text(item?.label, `${label}.branches[${branchIndex}].label`, 120, stepErrors, true);
        const to = typeof item?.to === "string" ? item.to.trim() : "";
        if (!to) {
          stepErrors.push(`${label}.branches[${branchIndex}].to is required.`);
        } else if (branchLabel) {
          branches.push({ label: branchLabel, to });
        }
      });
      if (branches.length) {
        step.branches = branches;
      }
    }
  }
  // The partly valid step is still returned so cross-step checks (duplicate ids, branch targets) report in the same pass.
  errors.push(...stepErrors);
  return step;
}

export function validateTrail(root: string, input: unknown, graph: TrailGraph): TrailValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!input || typeof input !== "object") {
    return { ok: false, errors: ["The trail must be an object."] };
  }
  const raw = input as Record<string, unknown>;
  const title = text(raw.title, "title", 120, errors, true);
  const goal = text(raw.goal, "goal", 500, errors);
  const summary = text(raw.summary, "summary", 1000, errors);
  let id = typeof raw.id === "string" && raw.id.trim() ? raw.id.trim() : slugify(title ?? "");
  if (!TRAIL_ID.test(id)) {
    errors.push(`id "${id}" must be lowercase letters, digits and "-" (max 64). Omit it to derive one from the title.`);
    id = "";
  }
  if (!Array.isArray(raw.steps) || raw.steps.length === 0) {
    errors.push("steps must be a non-empty array.");
    return { ok: false, errors };
  }
  if (raw.steps.length > MAX_STEPS) {
    errors.push(`A trail can have at most ${MAX_STEPS} steps.`);
    return { ok: false, errors };
  }
  const steps: TrailStep[] = [];
  raw.steps.forEach((step: unknown, index: number) => {
    const validated = validateStep(step, index, root, graph, errors, warnings);
    if (validated) {
      steps.push(validated);
    }
  });
  const seen = new Set<string>();
  for (const step of steps) {
    if (seen.has(step.id)) {
      errors.push(`Step id "${step.id}" is used twice.`);
    }
    seen.add(step.id);
  }
  for (const step of steps) {
    for (const branch of step.branches ?? []) {
      if (!seen.has(branch.to)) {
        errors.push(`Step "${step.id}" branches to "${branch.to}", which is not a step of this trail.`);
      }
    }
  }
  if (errors.length) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    warnings,
    trail: { id, title: title!, goal, summary, steps, updatedAt: new Date().toISOString() },
  };
}

export function readTrailFile(root: string): TrailFile {
  const file = trailsFilePath(root);
  if (!fs.existsSync(file)) {
    return { version: 1, trails: [] };
  }
  const stat = fs.statSync(file);
  if (stat.size > MAX_FILE_BYTES) {
    throw new Error(`${TRAILS_FILE} is larger than ${MAX_FILE_BYTES / 1024 / 1024} MB; refusing to read it.`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(`${TRAILS_FILE} is not valid JSON (${error instanceof Error ? error.message : String(error)}). Fix or delete it; it was left untouched.`);
  }
  const data = parsed as Partial<TrailFile>;
  if (!data || data.version !== 1 || !Array.isArray(data.trails)) {
    throw new Error(`${TRAILS_FILE} has an unsupported format (expected { "version": 1, "trails": [] }). It was left untouched.`);
  }
  return { version: 1, trails: data.trails };
}

function writeTrailFile(root: string, data: TrailFile): void {
  const file = trailsFilePath(root);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  fs.renameSync(temporary, file);
}

export function readTrails(root: string): Trail[] {
  return readTrailFile(root).trails;
}

export interface SaveTrailResult {
  trail: Trail;
  created: boolean;
  warnings: string[];
  file: string;
}

export function saveTrail(root: string, input: unknown, graph: TrailGraph): SaveTrailResult {
  const validation = validateTrail(root, input, graph);
  if (!validation.ok) {
    throw new Error(`The trail was not saved:\n- ${validation.errors.join("\n- ")}`);
  }
  const data = readTrailFile(root);
  const index = data.trails.findIndex((trail) => trail.id === validation.trail.id);
  if (index < 0 && data.trails.length >= MAX_TRAILS) {
    throw new Error(`A project can hold at most ${MAX_TRAILS} trails; delete one first.`);
  }
  if (index >= 0) {
    data.trails[index] = validation.trail;
  } else {
    data.trails.push(validation.trail);
  }
  writeTrailFile(root, data);
  return { trail: validation.trail, created: index < 0, warnings: validation.warnings, file: TRAILS_FILE };
}

export function deleteTrail(root: string, id: string): boolean {
  const data = readTrailFile(root);
  const remaining = data.trails.filter((trail) => trail.id !== id);
  if (remaining.length === data.trails.length) {
    return false;
  }
  writeTrailFile(root, { version: 1, trails: remaining });
  return true;
}

/** Marks what no longer matches the code: a route that was removed or renamed, a file that moved. */
export function annotateTrails(root: string, trails: Trail[], graph?: TrailGraph): TrailWithIssues[] {
  const routeIds = graph ? new Set(graph.routes.map((route) => route.id)) : undefined;
  return trails.map((trail) => {
    const issues: string[] = [];
    for (const step of trail.steps) {
      if (routeIds && step.route && !routeIds.has(step.route)) {
        issues.push(`Step "${step.title}" points at route ${step.route}, which no longer exists.`);
      }
      if (step.source && !projectFile(root, step.source.path)) {
        issues.push(`Step "${step.title}" points at ${step.source.path}, which no longer exists.`);
      }
    }
    return { ...trail, issues };
  });
}
