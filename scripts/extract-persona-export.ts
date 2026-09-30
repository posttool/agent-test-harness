/**
 * Extracts Aura personas, days and observations from a Firestore emulator export (the
 * `exported-data*` folders in posttool/persona) into test fixtures:
 *
 *   node scripts/extract-persona-export.ts <export-dir> [out-dir] [maxPersonas] [maxDays]
 *
 * The export is LevelDB log files holding Datastore EntityProto records. This decodes the
 * protobuf wire format directly, so it needs no Firebase tooling.
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

type Field = { field: number; wire: number; value: bigint | Uint8Array | Field[] };

const BLOCK = 32768;

function readLogRecords(data: Uint8Array): Uint8Array[] {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const records: Uint8Array[] = [];
  let pending: Uint8Array[] = [];
  let pos = 0;
  while (pos < data.length) {
    const blockEnd = (Math.floor(pos / BLOCK) + 1) * BLOCK;
    if (blockEnd - pos < 7) {
      pos = blockEnd;
      continue;
    }
    const length = view.getUint16(pos + 4, true);
    const type = data[pos + 6]!;
    if (type === 0 && length === 0) {
      pos = blockEnd;
      continue;
    }
    const chunk = data.subarray(pos + 7, pos + 7 + length);
    pos += 7 + length;
    if (type === 1) records.push(chunk);
    else if (type === 2) pending = [chunk];
    else if (type === 3) pending.push(chunk);
    else if (type === 4) {
      pending.push(chunk);
      records.push(Buffer.concat(pending));
      pending = [];
    }
  }
  return records;
}

function varint(b: Uint8Array, i: number): [bigint, number] {
  let result = 0n;
  let shift = 0n;
  while (true) {
    const byte = b[i++]!;
    result |= BigInt(byte & 0x7f) << shift;
    shift += 7n;
    if (!(byte & 0x80)) return [result, i];
  }
}

function decodeOne(b: Uint8Array, i: number): [Field, number] {
  const [key, j] = varint(b, i);
  const field = Number(key >> 3n);
  const wire = Number(key & 7n);
  i = j;
  if (wire === 0) {
    const [v, k] = varint(b, i);
    return [{ field, wire, value: v }, k];
  }
  if (wire === 1) return [{ field, wire, value: b.subarray(i, i + 8) }, i + 8];
  if (wire === 5) return [{ field, wire, value: b.subarray(i, i + 4) }, i + 4];
  if (wire === 2) {
    const [len, k] = varint(b, i);
    return [{ field, wire, value: b.subarray(k, k + Number(len)) }, k + Number(len)];
  }
  if (wire === 3) {
    const children: Field[] = [];
    while (true) {
      const [k, next] = varint(b, i);
      if (Number(k & 7n) === 4 && Number(k >> 3n) === field) return [{ field, wire, value: children }, next];
      const [child, after] = decodeOne(b, i);
      children.push(child);
      i = after;
    }
  }
  throw new Error(`unsupported wire type ${wire}`);
}

function decode(b: Uint8Array): Field[] {
  const out: Field[] = [];
  let i = 0;
  while (i < b.length) {
    const [f, next] = decodeOne(b, i);
    out.push(f);
    i = next;
  }
  return out;
}

const text = (v: Field["value"]) => Buffer.from(v as Uint8Array).toString("utf8");
const bytesOf = (fields: Field[], n: number) => fields.find((f) => f.field === n)?.value as Uint8Array | undefined;

function pathOf(entity: Field[]): string[] {
  const key = bytesOf(entity, 13);
  if (!key) return [];
  const path = bytesOf(decode(key), 14);
  if (!path) return [];
  return decode(path).flatMap((el) => {
    const parts = el.value as Field[];
    const kind = parts.find((p) => p.field === 2);
    const name = parts.find((p) => p.field === 4);
    const id = parts.find((p) => p.field === 3);
    return [kind ? text(kind.value) : "?", name ? text(name.value) : String(id?.value ?? "")];
  });
}

/** Nested maps are embedded EntityProtos; inside arrays their meaning flag is not always set. */
function asEntity(bytes: Uint8Array): Field[] | null {
  if (bytes[0] !== 0x6a) return null; // field 13 (key), length-delimited
  try {
    const fields = decode(bytes);
    return fields.every((f) => f.field >= 13 && f.field <= 16) ? fields : null;
  } catch {
    return null;
  }
}

function propertyValue(meaning: number, value: Field[]): unknown {
  const str = bytesOf(value, 3);
  const nested = str ? asEntity(str) : null;
  if ((meaning === 21 || nested) && str) return entityToObject(nested ?? decode(str)); // nested map
  if (meaning === 22) return []; // empty array
  for (const f of value) {
    if (f.field === 1) return Number(BigInt.asIntN(64, f.value as bigint));
    if (f.field === 2) return (f.value as bigint) !== 0n;
    if (f.field === 3) return text(f.value);
    if (f.field === 4) return Buffer.from(f.value as Uint8Array).readDoubleLE(0);
  }
  return null;
}

function entityToObject(entity: Field[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const prop of entity.filter((f) => f.field === 14 || f.field === 15)) {
    const parts = decode(prop.value as Uint8Array);
    const name = text(parts.find((p) => p.field === 3)!.value);
    const meaning = Number((parts.find((p) => p.field === 1)?.value as bigint | undefined) ?? 0n);
    const multiple = (parts.find((p) => p.field === 4)?.value as bigint | undefined) === 1n;
    const raw = bytesOf(parts, 5);
    const value = propertyValue(meaning, raw ? decode(raw) : []);
    if (multiple) {
      const list = (out[name] as unknown[] | undefined) ?? [];
      out[name] = Array.isArray(value) && meaning === 22 ? list : [...list, value];
    } else {
      out[name] = value;
    }
  }
  return out;
}

const [exportDir, outDir = "fixtures/personas", maxPersonas = "3", maxDays = "2"] = process.argv.slice(2);
if (!exportDir) throw new Error("usage: extract-persona-export.ts <export-dir> [out-dir] [maxPersonas] [maxDays]");
const dataDir = join(exportDir, "firestore_export", "all_namespaces", "all_kinds");
const byKind = new Map<string, { id: string; data: Record<string, unknown> }[]>();
for (const file of readdirSync(dataDir).filter((f) => f.startsWith("output-"))) {
  for (const record of readLogRecords(readFileSync(join(dataDir, file)))) {
    const entity = decode(record);
    const path = pathOf(entity);
    const kind = path.at(-2);
    const id = path.at(-1);
    if (!kind || !id) continue;
    byKind.set(kind, [...(byKind.get(kind) ?? []), { id, data: entityToObject(entity) }]);
  }
}
console.log("collections:", Object.fromEntries([...byKind].map(([k, v]) => [k, v.length])));

// Mirror the persona service's HTTP responses (see PLAN.md section 7, persona service contract).
const personas = byKind.get("persona") ?? [];
const days = byKind.get("day") ?? [];
const observations = byKind.get("observations") ?? [];
const withObservations = personas.filter((p) => observations.some((o) => o.data.personaId === p.id));
const chosen = withObservations.slice(0, Number(maxPersonas));
const index: unknown[] = [];
for (const persona of chosen) {
  const dir = join(outDir, persona.id);
  mkdirSync(join(dir, "observations"), { recursive: true });
  const d = persona.data;
  index.push({ id: persona.id, name: d.name, occupation: d.occupation, city: d.city, age: d.age, image: d.image, hobbies: d.hobbies, goals_this_week: d.goals_this_week, family: d.family, apps: d.apps_and_services });
  const personaDays = days
    .filter((day) => day.data.personaId === persona.id && observations.some((o) => o.data.personaId === persona.id && o.data.date === day.data.date))
    .sort((a, b) => String(a.data.date).localeCompare(String(b.data.date)))
    .slice(0, Number(maxDays));
  writeFileSync(join(dir, "persona.json"), JSON.stringify({ ...d, id: persona.id, days: personaDays.map((day) => ({ id: day.id, date: day.data.date })) }, null, 2));
  writeFileSync(join(dir, "days.json"), JSON.stringify(personaDays.map((day) => ({ id: day.id, date: day.data.date })), null, 2));
  for (const day of personaDays) {
    const obs = observations
      .filter((o) => o.data.personaId === persona.id && o.data.date === day.data.date)
      .map((o) => {
        const { personaId: _p, ...rest } = o.data;
        return { ...rest, id: o.id };
      })
      .sort((a, b) => String(a.time).localeCompare(String(b.time)));
    writeFileSync(join(dir, "observations", `${String(day.data.date)}.json`), JSON.stringify(obs, null, 2));
  }
  console.log("wrote", persona.id, d.name, personaDays.map((x) => x.data.date));
}
writeFileSync(join(outDir, "index.json"), JSON.stringify(index, null, 2));
