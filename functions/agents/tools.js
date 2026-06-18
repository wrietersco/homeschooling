// Firestore tool layer for AI agents. Every tool is bound to ONE family tenant
// and the caller's role — the "all-powerful CRUD" is powerful only *within* the
// caller's family. Reads are paginated; large result sets spill into a context
// store the agent reads in slices (read_context), so we never stuff unbounded
// data into the prompt. Mutations are role-gated and appended to the run audit.

// Collections an agent may read / write within a family. `members` is
// read-only to agents (membership management stays an owner-only UI action).
const READABLE = [
  "profile", "meta", "members", "children", "guardians", "skills",
  "curriculum", "activities", "calendarDays", "scores", "observations",
  "exposures", "contentStats", "intercom",
];
const WRITABLE = [
  "children", "guardians", "skills", "curriculum", "activities",
  "calendarDays", "scores", "observations", "contentStats", "intercom",
];

const MAX_LIMIT = 50;

function assertReadable(c) {
  if (!READABLE.includes(c)) throw new Error(`collection "${c}" is not readable`);
}
function assertWritable(c) {
  if (!WRITABLE.includes(c)) throw new Error(`collection "${c}" is not writable by an agent`);
}

// JSON-schema tool declarations handed to the model (Gemini functionDeclarations).
export const TOOL_DECLARATIONS = [
  {
    name: "list_collections",
    description:
      "List the family's data collections with document counts and known field names. Call this first to discover where data lives before querying.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "query_collection",
    description:
      "Read documents from a family collection with optional filter + ordering. Paginated; if the collection is large, prefer a tight filter or a small limit and iterate.",
    parameters: {
      type: "object",
      properties: {
        collection: { type: "string", description: `One of: ${READABLE.join(", ")}` },
        whereField: { type: "string" },
        whereOp: { type: "string", description: "==, !=, <, <=, >, >=, array-contains" },
        whereValue: {},
        orderByField: { type: "string" },
        direction: { type: "string", description: "asc or desc" },
        limit: { type: "number", description: `max ${MAX_LIMIT}` },
      },
      required: ["collection"],
    },
  },
  {
    name: "get_document",
    description: "Fetch a single document by id from a family collection.",
    parameters: {
      type: "object",
      properties: { collection: { type: "string" }, id: { type: "string" } },
      required: ["collection", "id"],
    },
  },
  {
    name: "read_context",
    description:
      "Read a slice of a large result set previously stored under a handle by query_collection (when it reported more rows than returned).",
    parameters: {
      type: "object",
      properties: {
        handle: { type: "string" },
        start: { type: "number" },
        count: { type: "number" },
      },
      required: ["handle"],
    },
  },
  {
    name: "create_document",
    description: "Create a document in a writable family collection. Returns the new id.",
    parameters: {
      type: "object",
      properties: {
        collection: { type: "string", description: `One of: ${WRITABLE.join(", ")}` },
        data: { type: "object" },
      },
      required: ["collection", "data"],
    },
  },
  {
    name: "update_document",
    description: "Merge fields into an existing document in a writable family collection.",
    parameters: {
      type: "object",
      properties: {
        collection: { type: "string" },
        id: { type: "string" },
        data: { type: "object" },
      },
      required: ["collection", "id", "data"],
    },
  },
  {
    name: "delete_document",
    description: "Delete a document from a writable family collection.",
    parameters: {
      type: "object",
      properties: { collection: { type: "string" }, id: { type: "string" } },
      required: ["collection", "id"],
    },
  },
];

// Read-only agents (e.g. the guide) only get the read tools.
export const READ_ONLY_TOOL_NAMES = [
  "list_collections", "query_collection", "get_document", "read_context",
];

export function filterDeclarations(names) {
  return TOOL_DECLARATIONS.filter((d) => names.includes(d.name));
}

/**
 * Build tool implementations bound to a family + caller.
 * @param {object} o
 * @param {FirebaseFirestore.Firestore} o.db   Admin Firestore
 * @param {string} o.familyId
 * @param {string} o.uid
 * @param {string} o.role   owner | parent | viewer
 * @param {"read"|"write"} o.mode
 * @param {object} o.run    mutable run record; mutations push to run.audit
 * @param {object} o.contextStore  in-memory map of handle -> rows for read_context
 */
export function createTools({ db, familyId, uid, role, mode = "read", run, contextStore = {} }) {
  if (!familyId) throw new Error("familyId required");
  const root = db.collection("families").doc(familyId);
  const col = (name) => root.collection(name);
  const canWrite = mode === "write" && ["owner", "parent"].includes(role);

  function audit(entry) {
    if (run) {
      run.audit = run.audit || [];
      run.audit.push({ ...entry, uid, at: new Date().toISOString() });
    }
  }

  const impls = {
    async list_collections() {
      const snap = await root.collection("_agent_index").get();
      if (snap.empty) {
        return { collections: READABLE.map((c) => ({ collection: c, count: null })) };
      }
      return {
        collections: snap.docs.map((d) => ({ collection: d.id, ...d.data() })),
      };
    },

    async query_collection({ collection, whereField, whereOp, whereValue, orderByField, direction, limit }) {
      assertReadable(collection);
      let q = col(collection);
      if (whereField && whereOp !== undefined && whereValue !== undefined) {
        q = q.where(whereField, whereOp, whereValue);
      }
      if (orderByField) q = q.orderBy(orderByField, direction === "desc" ? "desc" : "asc");
      const capped = Math.min(Math.max(1, limit || 20), MAX_LIMIT);
      // Fetch one extra to detect "there is more".
      const snap = await q.limit(capped + 1).get();
      const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      const hasMore = rows.length > capped;
      const page = rows.slice(0, capped);
      const out = { collection, count: page.length, rows: page, hasMore };
      if (hasMore) {
        // Stash the full (capped+1) set under a handle; a real impl would page
        // further, but this proves the context-handle mechanism.
        const handle = `${collection}:${Date.now()}`;
        contextStore[handle] = rows;
        out.handle = handle;
        out.note = "More rows exist; use read_context with the handle to read further.";
      }
      return out;
    },

    async get_document({ collection, id }) {
      assertReadable(collection);
      const d = await col(collection).doc(id).get();
      return d.exists ? { id: d.id, ...d.data() } : { id, exists: false };
    },

    async read_context({ handle, start = 0, count = 20 }) {
      const rows = contextStore[handle];
      if (!rows) return { error: `unknown handle ${handle}` };
      return { handle, total: rows.length, rows: rows.slice(start, start + count) };
    },

    async create_document({ collection, data }) {
      if (!canWrite) throw new Error("write not permitted for this agent/role");
      assertWritable(collection);
      const ref = await col(collection).add({ ...data, _agentCreated: true, createdAt: new Date() });
      audit({ action: "create", collection, id: ref.id });
      return { id: ref.id };
    },

    async update_document({ collection, id, data }) {
      if (!canWrite) throw new Error("write not permitted for this agent/role");
      assertWritable(collection);
      await col(collection).doc(id).set({ ...data, updatedAt: new Date() }, { merge: true });
      audit({ action: "update", collection, id });
      return { id, updated: true };
    },

    async delete_document({ collection, id }) {
      if (!canWrite) throw new Error("write not permitted for this agent/role");
      assertWritable(collection);
      await col(collection).doc(id).delete();
      audit({ action: "delete", collection, id });
      return { id, deleted: true };
    },
  };

  return { impls, contextStore };
}

export const _internal = { READABLE, WRITABLE, MAX_LIMIT };
