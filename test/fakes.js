// In-memory stand-ins for the mongoose models, enough for these tests.
const crypto = require("crypto");
let seq = 1;
function getPath(doc, k) {
  return k.split(".").reduce((o, part) => (o == null ? undefined : o[part]), doc);
}
function cmp(a) { return a instanceof Date ? a.getTime() : a; }
function matches(doc, q) {
  return Object.entries(q || {}).every(([k, v]) => {
    if (k === "$or") return v.some((sub) => matches(doc, sub));
    const actual = getPath(doc, k);
    if (v instanceof RegExp) return v.test(String(actual));
    if (v && typeof v === "object" && !(v instanceof Date) && Object.keys(v).some((x) => x.startsWith("$"))) {
      return Object.entries(v).every(([op, val]) => {
        if (actual === undefined || actual === null) return op === "$ne" ? val !== actual : op === "$in" ? val.includes(actual) : false;
        if (op === "$gt") return cmp(actual) > cmp(val);
        if (op === "$gte") return cmp(actual) >= cmp(val);
        if (op === "$lt") return cmp(actual) < cmp(val);
        if (op === "$lte") return cmp(actual) <= cmp(val);
        if (op === "$in") return val.includes(actual);
        if (op === "$ne") return actual !== val;
        throw new Error("fake: unsupported operator " + op);
      });
    }
    if (k === "_id") return String(doc._id) === String(v);
    return actual === v;
  });
}
function query(result) {
  const p = Promise.resolve(result);
  p.select = () => query(result);
  p.sort = () => query(result);
  p.lean = () => query(result);
  p.limit = (n) => query(Array.isArray(result) ? result.slice(0, n) : result);
  return p;
}
function makeModel(name, methods = {}) {
  const store = [];
  class Doc {
    constructor(data) { Object.assign(this, data); if (!this._id) this._id = `${name}-${seq++}`; if (!this.createdAt) this.createdAt = new Date(); }
    async save() {
      const i = store.findIndex((d) => d._id === this._id);
      if (i === -1) store.push(this); else store[i] = this;
      return this;
    }
  }
  Object.assign(Doc.prototype, methods);
  Doc.store = store;
  Doc.find = (q) => query(store.filter((d) => matches(d, q)));
  Doc.findOne = (q) => query(store.find((d) => matches(d, q)) || null);
  Doc.findById = (id) => {
    const found = store.find((d) => String(d._id) === String(id)) || null;
    if (!Doc.delayMs) return query(found);
    const p = new Promise((r) => setTimeout(() => r(found), Doc.delayMs));
    p.select = () => p; p.sort = () => p; p.lean = () => p;
    return p;
  };
  Doc.countDocuments = async (q) => store.filter((d) => matches(d, q)).length;
  Doc.findOneAndUpdate = async (q, update, opts = {}) => {
    let doc = store.find((d) => matches(d, q));
    const set = update && update.$set ? update.$set : update;
    if (!doc) {
      if (!opts.upsert) return null;
      doc = new Doc(Object.assign({}, q));
      store.push(doc);
    }
    Object.assign(doc, set);
    return doc;
  };
  Doc.updateOne = async (q, update, opts = {}) => {
    Doc.calls = (Doc.calls || 0) + 1;
    if (Doc.writeDelayMs) await new Promise((r) => setTimeout(r, Doc.writeDelayMs));
    let doc = store.find((d) => matches(d, q));
    if (!doc) {
      if (!opts.upsert) return { matchedCount: 0, modifiedCount: 0 };
      doc = new Doc(Object.assign({}, q));
      store.push(doc);
    }
    Object.assign(doc, update && update.$set ? update.$set : update);
    return { matchedCount: 1, modifiedCount: 1 };
  };
  Doc.updateMany = async (q, update) => {
    const docs = store.filter((d) => matches(d, q));
    docs.forEach((d) => Object.assign(d, update && update.$set ? update.$set : update));
    return { matchedCount: docs.length, modifiedCount: docs.length };
  };
  Doc.deleteOne = async (q) => { const i = store.findIndex((d) => matches(d, q)); if (i >= 0) store.splice(i, 1); };
  Doc.deleteMany = async (q) => { for (let i = store.length - 1; i >= 0; i--) if (matches(store[i], q)) store.splice(i, 1); };
  Doc.findByIdAndDelete = async (id) => { const i = store.findIndex((d) => String(d._id) === String(id)); if (i >= 0) store.splice(i, 1); };
  Doc.create = async (data) => { const d = new Doc(data); await d.save(); return d; };
  Doc.aggregate = async () => {
    const m = new Map();
    store.forEach((d) => { const k = String(d.email).toLowerCase(); m.set(k, (m.get(k) || 0) + 1); });
    return [...m].map(([k, n]) => ({ _id: k, n }));
  };
  return Doc;
}
const userMethods = {
  genPasswordResetToken(validForMs = 3600000) {
    const t = crypto.randomBytes(8).toString("hex");
    this.passwordResetToken = crypto.createHash("sha256").update(t).digest("hex");
    this.passwordResetTokenExpiresIn = Date.now() + validForMs;
    this.lastTokenValidMs = validForMs;
    return t;
  },
  async correctPassword(p) { return p === this.password; },
};
module.exports = { makeModel, userMethods };
