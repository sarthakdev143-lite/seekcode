const Parser = require('tree-sitter');
const JavaScript = require('tree-sitter-javascript');
const TypeScript = require('tree-sitter-typescript').typescript;
const fs = require('fs');
const path = require('path');

const jsParser = new Parser(); jsParser.setLanguage(JavaScript);
const tsParser = new Parser(); tsParser.setLanguage(TypeScript);

function getParser(fp) {
  return ['.ts','.tsx'].includes(path.extname(fp).toLowerCase()) ? tsParser : jsParser;
}

function parseFile(filePath) {
  const parser = getParser(filePath);
  const code = fs.readFileSync(filePath, 'utf8');
  const tree = parser.parse(code);
  const root = tree.rootNode;
  const imports = [];
  const exports = [];
  const declarations = [];

  function walk(node) {
    if (!node) return;

    // Import statements
    if (node.type === 'import_statement') {
      const sourceNode = node.childForFieldName('source');
      const modulePath = sourceNode ? sourceNode.text.slice(1, -1) : '';
      const names = [];
      for (let i = 0; i < node.childCount; i++) {
        const c = node.child(i);
        if (c.type === 'import_specifier' || c.type === 'namespace_import') names.push(c.text);
      }
      imports.push({ file: filePath, module: modulePath, names, isDefault: names.includes('default') });
    }

    // Export statements
    if (node.type === 'export_statement') {
      const decNode = node.childForFieldName('declaration');
      if (decNode) {
        const nameNode = decNode.childForFieldName('name');
        if (nameNode) {
          exports.push({ file: filePath, name: nameNode.text, kind: decNode.type, line: nameNode.startPosition.row + 1 });
        }
      }
      const sourceNode = node.childForFieldName('source');
      if (sourceNode) {
        exports.push({ file: filePath, name: 're-export', kind: 'reexport', module: sourceNode.text.slice(1, -1), line: node.startPosition.row + 1 });
      }
    }

    // Declarations (only if not already exported)
    if (['function_declaration','class_declaration','variable_declarator'].includes(node.type)) {
      const parent = node.parent;
      if (parent && parent.type !== 'export_statement') {
        const nameNode = node.childForFieldName('name');
        if (nameNode) {
          declarations.push({ file: filePath, name: nameNode.text, kind: node.type.replace('_declaration',''), line: node.startPosition.row + 1 });
        }
      }
    }

    for (let i = 0; i < node.childCount; i++) walk(node.child(i));
  }

  walk(root);
  return { imports, exports, declarations };
}

module.exports = { parseFile };
