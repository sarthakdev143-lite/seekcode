class DependencyGraph {
  constructor() {
    this.importMap = new Map();
    this.reverseMap = new Map();
    this._allFiles = new Set();
  }
  addFile(fp) { this._allFiles.add(fp); if (!this.importMap.has(fp)) this.importMap.set(fp, new Set()); }
  addImport(from, to) {
    this.addFile(from); this.addFile(to);
    this.importMap.get(from).add(to);
    if (!this.reverseMap.has(to)) this.reverseMap.set(to, new Set());
    this.reverseMap.get(to).add(from);
  }
  getImportsOf(f) { return Array.from(this.importMap.get(f) || []); }
  getDependents(f) { return Array.from(this.reverseMap.get(f) || []); }
  getAllFiles() { return Array.from(this._allFiles); }
  toJSON() {
    return {
      imports: Object.fromEntries(Array.from(this.importMap.entries()).map(([k,v]) => [k, Array.from(v)])),
      reverse: Object.fromEntries(Array.from(this.reverseMap.entries()).map(([k,v]) => [k, Array.from(v)])),
    };
  }
}
module.exports = { DependencyGraph };
