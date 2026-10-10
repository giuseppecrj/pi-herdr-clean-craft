import {
	copyFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	readlinkSync,
	realpathSync,
	rmSync,
	statSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, delimiter, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { deadline } from "./phase3/event-log.mjs";
import { runBounded } from "./phase3/processes.mjs";

export const PACKAGE_ROOT = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), ".."));

const PORTABLE_FIELDS = new Set([
	"name",
	"description",
	"license",
	"compatibility",
	"metadata",
	"allowed-tools",
	"disable-model-invocation",
]);
const NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const NEVER_PACKED_NAMES = new Set([".npmrc", ".git"]);
const CORE_SCHEMA_SCALARS = [
	[/^(?:~|null|Null|NULL)?$/, () => null],
	[/^(?:true|True|TRUE)$/, () => true],
	[/^(?:false|False|FALSE)$/, () => false],
	[/^0o[0-7]+$/, (raw) => Number.parseInt(raw.slice(2), 8)],
	[/^(?:0x[0-9a-fA-F]+|[-+]?(?:\.[0-9]+|[0-9]+(?:\.[0-9]*)?)(?:[eE][-+]?[0-9]+)?)$/, Number],
	[/^[-+]?\.(?:inf|Inf|INF)$/, (raw) => (raw.startsWith("-") ? -Infinity : Infinity)],
	[/^\.(?:nan|NaN|NAN)$/, () => Number.NaN],
];

function plainScalar(raw) {
	const match = CORE_SCHEMA_SCALARS.find(([pattern]) => pattern.test(raw));
	return match ? match[1](raw) : raw;
}

function typeName(value) {
	return value === null ? "null" : typeof value;
}

export function parseFrontmatter(text) {
	const problems = [];
	const fields = {};
	if (!text.startsWith("---\n")) return { fields, problems: ["frontmatter must start on the first line with ---"] };
	const end = text.indexOf("\n---\n", 3);
	if (end === -1) return { fields, problems: ["frontmatter has no closing ---"] };
	for (const line of text.slice(4, end).split("\n")) {
		const match = /^([a-z][a-z-]*): (.+)$/.exec(line);
		if (!match) {
			problems.push(`frontmatter line is not a single-line key: value pair: ${JSON.stringify(line)}`);
			continue;
		}
		const [, key, padded] = match;
		const raw = padded.replace(/^[ \t]+|[ \t]+$/g, "");
		if (!PORTABLE_FIELDS.has(key)) problems.push(`frontmatter field is not portable: ${key}`);
		if (key in fields) problems.push(`frontmatter field is duplicated: ${key}`);
		const quoted = /^"([^"\\]*)"$/.exec(raw);
		if (!quoted && (/^[\[\]{}&*!|>'"%@`#,?:-]/.test(raw) || raw.includes(": ") || raw.includes(" #"))) {
			problems.push(`frontmatter value for ${key} needs quoting to remain plain YAML`);
		}
		fields[key] = quoted ? quoted[1] : plainScalar(raw);
	}
	return { fields, problems };
}

function stripCode(markdown) {
	return markdown.replace(/^(```|~~~)[^\n]*\n[\s\S]*?^\1[ \t]*$/gm, "").replace(/`[^`\n]*`/g, "");
}

export function localLinkTargets(markdown) {
	const prose = stripCode(markdown);
	const targets = [
		...[...prose.matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)].map((match) => match[1]),
		...[...prose.matchAll(/^\s*\[[^\]]+\]:\s*(\S+)/gm)].map((match) => match[1]),
	];
	return targets
		.filter((target) => !/^[a-z][a-z0-9+.-]*:/i.test(target) && !target.startsWith("#"))
		.map((target) => decodeURI(target.split("#")[0]));
}

export function listFiles(root) {
	return readdirSync(root, { recursive: true })
		.map(String)
		.filter((path) => statSync(join(root, path)).isFile())
		.map((path) => path.split(sep).join("/"))
		.toSorted();
}

function siblingSkill(skillsRoot, resolved) {
	const path = relative(skillsRoot, resolved);
	const [name, ...rest] = path.split(sep);
	if (name === ".." || isAbsolute(path)) return { problem: "links outside the skills directory" };
	if (rest.length !== 1 || rest[0] !== "SKILL.md") return { problem: "links to a sibling skill path other than its SKILL.md" };
	if (!existsSync(resolved) || !statSync(resolved).isFile()) return { problem: "links to a missing sibling skill" };
	if (relative(realpathSync(skillsRoot), realpathSync(resolved)) !== join(name, "SKILL.md")) {
		return { problem: "links to a sibling skill that resolves outside the skills directory" };
	}
	return { name };
}

export function checkSkill(skillDir) {
	const problems = [];
	const skillFile = join(skillDir, "SKILL.md");
	if (!existsSync(skillFile)) return { fields: {}, references: [], siblings: [], problems: ["SKILL.md is missing"] };
	const text = readFileSync(skillFile, "utf8");
	const { fields, problems: frontmatterProblems } = parseFrontmatter(text);
	problems.push(...frontmatterProblems);
	const name = fields.name;
	if (name === undefined) problems.push("name is missing");
	else if (typeof name !== "string") problems.push(`name must be a string, found ${typeName(name)}`);
	else {
		if (!NAME_PATTERN.test(name) || name.length > 64) problems.push(`name is not a portable skill name: ${name}`);
		if (name !== basename(skillDir)) problems.push(`name ${name} does not match directory ${basename(skillDir)}`);
	}
	const description = fields.description;
	if (description === undefined) problems.push("description is missing");
	else if (typeof description !== "string") problems.push(`description must be a string, found ${typeName(description)}`);
	else if (description.trim() === "") problems.push("description is empty");
	else if (description.length > 1024) problems.push("description exceeds 1024 characters");
	const invocation = fields["disable-model-invocation"];
	if (invocation !== undefined && typeof invocation !== "boolean") {
		problems.push(`disable-model-invocation must be a boolean, found ${typeName(invocation)}`);
	}

	const references = new Set();
	const siblings = new Set();
	const pending = [skillFile];
	const visited = new Set();
	while (pending.length > 0) {
		const file = pending.pop();
		if (visited.has(file)) continue;
		visited.add(file);
		const from = relative(skillDir, file);
		for (const target of localLinkTargets(readFileSync(file, "utf8"))) {
			if (target.startsWith("/")) {
				problems.push(`${from} links to an absolute path: ${target}`);
				continue;
			}
			const resolved = resolve(dirname(file), target);
			const inside = relative(skillDir, resolved);
			if (inside === "" || inside === ".." || inside.startsWith(`..${sep}`)) {
				const sibling = siblingSkill(dirname(skillDir), resolved);
				if (sibling.problem) problems.push(`${from} ${sibling.problem}: ${target}`);
				else siblings.add(sibling.name);
				continue;
			}
			if (!existsSync(resolved) || !statSync(resolved).isFile()) {
				problems.push(`${from} links to a missing file: ${target}`);
				continue;
			}
			references.add(inside.split(sep).join("/"));
			if (resolved.endsWith(".md")) pending.push(resolved);
		}
	}
	return { fields, references: [...references].toSorted(), siblings: [...siblings].toSorted(), problems };
}

const RUN_GRACE_MS = 1_000;
const unresolvedRuns = new Set();

export function unresolvedUnder(dir) {
	return [...unresolvedRuns].filter((entry) => entry.root === dir || entry.root.startsWith(`${dir}${sep}`));
}

function describeRun({ argv, identity, identityProblem, reason }) {
	return `${basename(argv[0])} ${identity ? `pid ${identity.pid} start ${identity.startTime}` : `with unknown identity (${identityProblem})`} ${reason}`;
}

export function makeTempRoot(t, label, parent = tmpdir()) {
	const root = realpathSync(mkdtempSync(join(parent, `clean-craft-${label}-`)));
	t.after(() => {
		const open = unresolvedUnder(root);
		if (open.length > 0) throw new Error(`retained ${root} because a command it owns has not closed: ${open.map(describeRun).join("; ")}`);
		rmSync(root, { recursive: true, force: true });
	});
	return root;
}

export function findExecutable(name) {
	for (const dir of (process.env.PATH ?? "").split(delimiter)) {
		if (!dir) continue;
		const candidate = join(dir, name);
		try {
			if (statSync(candidate).isFile()) return realpathSync(candidate);
		} catch {}
	}
	return undefined;
}

export function isolatedEnv(root, extra = {}) {
	const home = join(root, "home");
	const xdg = join(root, "xdg");
	const npm = findExecutable("npm");
	const path = [dirname(process.execPath), npm && dirname(npm), "/usr/bin", "/bin"].filter(Boolean);
	const userNpmrc = join(root, "user.npmrc");
	const globalNpmrc = join(root, "global.npmrc");
	writeFileSync(userNpmrc, "");
	writeFileSync(globalNpmrc, "");
	return {
		PATH: [...new Set(path)].join(delimiter),
		HOME: home,
		TMPDIR: root,
		LANG: "C.UTF-8",
		XDG_CONFIG_HOME: join(xdg, "config"),
		XDG_CACHE_HOME: join(xdg, "cache"),
		XDG_DATA_HOME: join(xdg, "data"),
		XDG_STATE_HOME: join(xdg, "state"),
		npm_config_cache: join(root, "npm-cache"),
		npm_config_userconfig: userNpmrc,
		npm_config_globalconfig: globalNpmrc,
		npm_config_offline: "true",
		npm_config_audit: "false",
		npm_config_fund: "false",
		npm_config_update_notifier: "false",
		...extra,
	};
}

export async function run(command, args, { cwd, env, timeoutMs, input, root, graceMs = RUN_GRACE_MS }) {
	const name = basename(command);
	if (typeof root !== "string") throw new TypeError(`${name} needs the owned root it may write into`);
	const result = await runBounded({ command, args, cwd, env, input, limit: deadline(timeoutMs, name), grace: graceMs });
	if (result.closure !== "closed") {
		const ended = result.exit ? `it exited ${result.exit.signal ? `on ${result.exit.signal}` : `with code ${result.exit.code}`}` : "its exit was not observed";
		const reason = `exceeded ${timeoutMs} ms; ${ended}, but its output did not close within ${graceMs} ms more, so a process it started may still hold it`;
		const entry = Object.freeze({
			root,
			argv: Object.freeze([command, ...args]),
			identity: result.identity,
			identityProblem: result.identityProblem,
			exit: result.exit,
			reason,
			closed: result.closed,
		});
		unresolvedRuns.add(entry);
		result.closed.then(() => unresolvedRuns.delete(entry));
		throw new Error(`${describeRun(entry)}; ${root} is retained`);
	}
	if (result.errors.length > 0) throw new Error(`${name} failed: ${result.errors.join(", ")}\nstderr:\n${result.stderr}`);
	if (result.timedOut) throw new Error(`${name} exceeded ${timeoutMs} ms\nstderr:\n${result.stderr}`);
	if (result.truncated) throw new Error(`${name} wrote more output than the capture limit`);
	return { code: result.code, signal: result.signal, stdout: result.stdout, stderr: result.stderr };
}

function stageCandidate(source, root) {
	const stage = join(root, "candidate");
	const candidate = realpathSync(source);
	const unstaged = new Set([root, join(candidate, "node_modules")]);
	const copy = (from, to) => {
		mkdirSync(to);
		for (const entry of readdirSync(from, { withFileTypes: true })) {
			const path = join(from, entry.name);
			if (NEVER_PACKED_NAMES.has(entry.name) || unstaged.has(path)) continue;
			const target = join(to, entry.name);
			if (entry.isDirectory()) copy(path, target);
			else if (entry.isSymbolicLink()) symlinkSync(readlinkSync(path), target);
			else if (entry.isFile()) copyFileSync(path, target);
		}
	};
	copy(candidate, stage);
	return stage;
}

export async function npmPack(t, { dryRun, candidateRoot = PACKAGE_ROOT, tempParent }) {
	return packInto(makeTempRoot(t, "npm", tempParent), { dryRun, candidateRoot });
}

export async function packInto(root, { dryRun, candidateRoot = PACKAGE_ROOT }) {
	const npm = findExecutable("npm");
	if (!npm) throw new Error("npm was not found on PATH; the package contents gate cannot run");
	mkdirSync(root, { recursive: true });
	const stage = stageCandidate(candidateRoot, root);
	const mode = dryRun ? ["--dry-run"] : ["--pack-destination", root];
	const result = await run(npm, ["pack", "--json", "--ignore-scripts", ...mode], {
		cwd: stage,
		env: isolatedEnv(root),
		timeoutMs: 60_000,
		root,
	});
	if (result.code !== 0) throw new Error(`npm pack exited ${result.code}\n${result.stderr}`);
	const [entry] = JSON.parse(result.stdout);
	return { entry, root, stage };
}

export async function extractPack({ entry, root }) {
	const extract = join(root, "extract");
	mkdirSync(extract);
	const tar = await run("tar", ["-xzf", join(root, entry.filename), "-C", extract], {
		cwd: root,
		env: isolatedEnv(root),
		timeoutMs: 30_000,
		root,
	});
	if (tar.code !== 0) throw new Error(`tar exited ${tar.code}\n${tar.stderr}`);
	return join(extract, "package");
}
