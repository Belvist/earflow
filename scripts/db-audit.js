#!/usr/bin/env node

'use strict';

const fs = require('node:fs');
const path = require('node:path');

function parseArgs(argv) {
    const args = {
        root: process.cwd(),
        include: ['backend'],
        outJson: null,
        outMd: null,
    };

    const rest = Array.isArray(argv) ? argv.slice(2) : [];
    const readPair = (idx) => {
        const key = rest[idx];
        const value = rest[idx + 1];
        if (!key || !value) return null;
        return { key, value };
    };

    for (let i = 0; i < rest.length; i += 1) {
        const pair = readPair(i);
        if (!pair) continue;
        if (pair.key === '--root') {
            args.root = pair.value;
            i += 1;
            continue;
        }
        if (pair.key === '--include') {
            args.include = pair.value.split(',').map((s) => s.trim()).filter(Boolean);
            i += 1;
            continue;
        }
        if (pair.key === '--out-json') {
            args.outJson = pair.value;
            i += 1;
            continue;
        }
        if (pair.key === '--out-md') {
            args.outMd = pair.value;
            i += 1;
        }
    }

    args.root = path.resolve(args.root);
    args.include = args.include.length > 0 ? args.include : ['backend'];
    return args;
}

function isTextFile(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    return ext === '.js' || ext === '.ts' || ext === '.sql' || ext === '.md' || ext === '.yaml' || ext === '.yml' || ext === '.json';
}

function safeReadText(filePath) {
    try {
        const buf = fs.readFileSync(filePath);
        if (!buf || buf.length === 0) return '';
        if (buf.length > 5 * 1024 * 1024) return '';
        return buf.toString('utf8');
    } catch {
        return '';
    }
}

function walkFiles(rootDir, { includeExts = null } = {}) {
    const out = [];

    const stack = [rootDir];
    while (stack.length > 0) {
        const dir = stack.pop();
        if (!dir) continue;
        let entries;
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
            continue;
        }

        for (const ent of entries) {
            if (!ent) continue;
            const full = path.join(dir, ent.name);
            if (ent.isDirectory()) {
                if (ent.name === 'node_modules' || ent.name === '.git' || ent.name === 'dist' || ent.name === 'build' || ent.name === '.next') {
                    continue;
                }
                stack.push(full);
                continue;
            }

            if (!ent.isFile()) continue;

            const ext = path.extname(ent.name).toLowerCase();
            if (includeExts && !includeExts.includes(ext)) continue;
            if (!isTextFile(full)) continue;
            out.push(full);
        }
    }

    return out;
}

function stripSqlIdentifier(raw) {
    const s = typeof raw === 'string' ? raw.trim() : '';
    if (!s) return '';

    const noAlias = s.split(/\s+/)[0];
    const normalized = noAlias
        .replace(/[,;]+$/g, '')
        .replace(/^\(+/g, '')
        .replace(/\)+$/g, '')
        .trim();

    const unquoted = normalized.replace(/^"(.+)"$/g, '$1');
    const parts = unquoted.split('.').map((p) => p.replace(/^"(.+)"$/g, '$1'));
    const name = parts[parts.length - 1] || '';

    const lowered = name.toLowerCase();
    if (!lowered) return '';
    if (lowered === 'select' || lowered === 'values' || lowered === 'unnest' || lowered === 'generate_series') return '';
    if (lowered === 'information_schema' || lowered === 'pg_catalog') return '';
    if (!/^[a-z_][a-z0-9_]*$/.test(lowered)) return '';
    return lowered;
}

function extractDefinedObjectsFromSql(sql) {
    const text = typeof sql === 'string' ? sql : '';
    const out = {
        tables: new Set(),
        indexes: new Set(),
        views: new Set(),
        functions: new Set(),
        triggers: new Set(),
    };

    const addAll = (re, target) => {
        let m;
        // eslint-disable-next-line no-cond-assign
        while ((m = re.exec(text)) !== null) {
            const name = stripSqlIdentifier(m[1]);
            if (name) target.add(name);
        }
    };

    addAll(/\bCREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+([a-zA-Z0-9_."]+)/gi, out.tables);
    addAll(/\bCREATE\s+TABLE\s+([a-zA-Z0-9_."]+)/gi, out.tables);
    addAll(/\bALTER\s+TABLE\s+([a-zA-Z0-9_."]+)/gi, out.tables);

    addAll(/\bCREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:CONCURRENTLY\s+)?IF\s+NOT\s+EXISTS\s+([a-zA-Z0-9_."]+)/gi, out.indexes);
    addAll(/\bCREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:CONCURRENTLY\s+)?([a-zA-Z0-9_."]+)/gi, out.indexes);

    addAll(/\bCREATE\s+MATERIALIZED\s+VIEW\s+IF\s+NOT\s+EXISTS\s+([a-zA-Z0-9_."]+)/gi, out.views);
    addAll(/\bCREATE\s+MATERIALIZED\s+VIEW\s+([a-zA-Z0-9_."]+)/gi, out.views);
    addAll(/\bCREATE\s+VIEW\s+IF\s+NOT\s+EXISTS\s+([a-zA-Z0-9_."]+)/gi, out.views);
    addAll(/\bCREATE\s+VIEW\s+([a-zA-Z0-9_."]+)/gi, out.views);

    addAll(/\bCREATE\s+OR\s+REPLACE\s+FUNCTION\s+([a-zA-Z0-9_."]+)/gi, out.functions);
    addAll(/\bCREATE\s+FUNCTION\s+([a-zA-Z0-9_."]+)/gi, out.functions);

    addAll(/\bCREATE\s+TRIGGER\s+([a-zA-Z0-9_."]+)/gi, out.triggers);

    return out;
}

function extractTableReferences(sql) {
    const text = typeof sql === 'string' ? sql : '';
    const refs = [];

    const patterns = [
        { op: 'select', re: /\bFROM\s+([^\s\n\r,;()]+(?:\.[^\s\n\r,;()]+)?)/gi },
        { op: 'join', re: /\bJOIN\s+([^\s\n\r,;()]+(?:\.[^\s\n\r,;()]+)?)/gi },
        { op: 'insert', re: /\bINSERT\s+INTO\s+([^\s\n\r,;()]+(?:\.[^\s\n\r,;()]+)?)/gi },
        { op: 'update', re: /\bUPDATE\s+([^\s\n\r,;()]+(?:\.[^\s\n\r,;()]+)?)/gi },
        { op: 'delete', re: /\bDELETE\s+FROM\s+([^\s\n\r,;()]+(?:\.[^\s\n\r,;()]+)?)/gi },
    ];

    for (const p of patterns) {
        let m;
        // eslint-disable-next-line no-cond-assign
        while ((m = p.re.exec(text)) !== null) {
            const t = stripSqlIdentifier(m[1]);
            if (t) refs.push({ table: t, op: p.op });
        }
    }

    return refs;
}

function mergeUsageMap(usage, fileRel, refs) {
    for (const ref of refs) {
        if (!ref || !ref.table) continue;
        const key = ref.table;
        if (!usage[key]) {
            usage[key] = {
                table: key,
                ops: { select: 0, join: 0, insert: 0, update: 0, delete: 0 },
                files: new Set(),
            };
        }
        const entry = usage[key];
        entry.files.add(fileRel);
        if (ref.op && entry.ops[ref.op] !== undefined) {
            entry.ops[ref.op] += 1;
        }
    }
}

function toSortedArray(setLike) {
    const arr = Array.from(setLike || []);
    arr.sort((a, b) => String(a).localeCompare(String(b)));
    return arr;
}

function formatOps(ops) {
    const o = ops || {};
    const parts = [];
    if (o.select) parts.push(`select:${o.select}`);
    if (o.join) parts.push(`join:${o.join}`);
    if (o.insert) parts.push(`insert:${o.insert}`);
    if (o.update) parts.push(`update:${o.update}`);
    if (o.delete) parts.push(`delete:${o.delete}`);
    return parts.join(', ');
}

function buildMarkdownReport(report) {
    const lines = [];
    lines.push('# DB Audit Report');
    lines.push('');
    lines.push(`Root: \`${report.root}\``);
    lines.push('');

    lines.push('## Sources scanned');
    lines.push('');
    for (const src of report.sources) {
        lines.push(`- **${src.kind}**: \`${src.path}\``);
    }

    lines.push('');
    lines.push('## Tables: usage summary');
    lines.push('');

    const used = report.tables
        .filter((t) => t.usage && t.usage.totalOps > 0)
        .sort((a, b) => b.usage.totalOps - a.usage.totalOps);
    const unused = report.tables
        .filter((t) => !t.usage || t.usage.totalOps === 0)
        .sort((a, b) => a.name.localeCompare(b.name));

    lines.push(`Used tables: **${used.length}**`);
    lines.push(`Unused (by code scan) tables: **${unused.length}**`);
    lines.push('');

    lines.push('### Top used tables');
    lines.push('');
    const top = used.slice(0, 40);
    for (const t of top) {
        lines.push(`- **${t.name}**: ${formatOps(t.usage.ops)} | files: ${t.usage.filesCount}`);
    }

    lines.push('');
    lines.push('### Candidate unused tables (needs live DB confirmation)');
    lines.push('');
    for (const t of unused.slice(0, 80)) {
        lines.push(`- **${t.name}**`);
    }

    if (report.schemaConflicts && report.schemaConflicts.length > 0) {
        lines.push('');
        lines.push('## Schema drift / conflicts');
        lines.push('');
        for (const c of report.schemaConflicts) {
            lines.push(`- **${c.object}**: defined in`);
            for (const p of c.definedIn) {
                lines.push(`  - \`${p}\``);
            }
        }
    }

    lines.push('');
    lines.push('## Next: live audit SQL (run on production replica or staging)');
    lines.push('');
    lines.push('```sql');
    lines.push('SELECT');
    lines.push('  schemaname,');
    lines.push('  relname AS table_name,');
    lines.push('  n_live_tup,');
    lines.push('  n_dead_tup,');
    lines.push('  seq_scan, seq_tup_read,');
    lines.push('  idx_scan, idx_tup_fetch,');
    lines.push('  n_tup_ins, n_tup_upd, n_tup_del,');
    lines.push('  last_vacuum, last_autovacuum, last_analyze, last_autoanalyze');
    lines.push('FROM pg_stat_user_tables');
    lines.push('ORDER BY (n_tup_ins + n_tup_upd + n_tup_del + idx_scan + seq_scan) DESC;');
    lines.push('');
    lines.push('SELECT');
    lines.push('  schemaname,');
    lines.push('  relname AS table_name,');
    lines.push('  indexrelname AS index_name,');
    lines.push('  idx_scan, idx_tup_read, idx_tup_fetch');
    lines.push('FROM pg_stat_user_indexes');
    lines.push('ORDER BY idx_scan DESC;');
    lines.push('```');

    lines.push('');
    return lines.join('\n');
}

function computeSchemaConflicts(definedBySource) {
    const map = new Map();

    for (const src of definedBySource) {
        for (const tbl of src.tables) {
            if (!map.has(tbl)) map.set(tbl, []);
            map.get(tbl).push(src.path);
        }
    }

    const conflicts = [];
    for (const [obj, files] of map.entries()) {
        if (files.length <= 1) continue;
        conflicts.push({ object: obj, definedIn: files.slice().sort() });
    }

    conflicts.sort((a, b) => a.object.localeCompare(b.object));
    return conflicts;
}

async function main() {
    const args = parseArgs(process.argv);

    const includeDirs = args.include.map((p) => path.resolve(args.root, p));
    const files = [];
    for (const d of includeDirs) {
        files.push(...walkFiles(d));
    }

    const sources = [];
    const definedBySource = [];
    const usage = {};

    for (const filePath of files) {
        const rel = path.relative(args.root, filePath).replaceAll('\\', '/');
        const text = safeReadText(filePath);
        if (!text) continue;

        const isSql = path.extname(filePath).toLowerCase() === '.sql';
        const isJsTs = path.extname(filePath).toLowerCase() === '.js' || path.extname(filePath).toLowerCase() === '.ts';

        if (isSql || isJsTs) {
            const defs = extractDefinedObjectsFromSql(text);
            const tables = toSortedArray(defs.tables);
            if (tables.length > 0) {
                sources.push({ kind: isSql ? 'sql' : 'code-ddl', path: rel });
                definedBySource.push({ path: rel, tables });
            }

            const refs = extractTableReferences(text);
            if (refs.length > 0) {
                mergeUsageMap(usage, rel, refs);
            }
        }
    }

    const definedTables = new Set();
    for (const src of definedBySource) {
        for (const t of src.tables) definedTables.add(t);
    }

    const usedTables = new Set(Object.keys(usage));
    const allTables = new Set([...definedTables, ...usedTables]);

    const tableEntries = [];
    for (const t of toSortedArray(allTables)) {
        const u = usage[t];
        const totalOps = u ? Object.values(u.ops).reduce((a, b) => a + b, 0) : 0;
        tableEntries.push({
            name: t,
            defined: definedTables.has(t),
            usage: u
                ? {
                    ops: u.ops,
                    filesCount: u.files.size,
                    totalOps,
                    files: toSortedArray(u.files).slice(0, 200),
                }
                : { ops: { select: 0, join: 0, insert: 0, update: 0, delete: 0 }, filesCount: 0, totalOps: 0, files: [] },
        });
    }

    const report = {
        generatedAt: new Date().toISOString(),
        root: args.root.replaceAll('\\', '/'),
        sources,
        tables: tableEntries,
        schemaConflicts: computeSchemaConflicts(definedBySource),
    };

    const md = buildMarkdownReport(report);

    if (args.outJson) {
        const out = path.resolve(args.root, args.outJson);
        fs.mkdirSync(path.dirname(out), { recursive: true });
        fs.writeFileSync(out, JSON.stringify(report, null, 2), 'utf8');
    }

    if (args.outMd) {
        const out = path.resolve(args.root, args.outMd);
        fs.mkdirSync(path.dirname(out), { recursive: true });
        fs.writeFileSync(out, md, 'utf8');
    }

    if (!args.outJson && !args.outMd) {
        process.stdout.write(md);
    }
}

main().catch((e) => {
    const msg = e && typeof e === 'object' && typeof e.message === 'string' ? e.message : String(e);
    process.stderr.write(`${msg}\n`);
    process.exitCode = 1;
});
