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
  let tree;
  try {
    tree = parser.parse(code);
  } catch (err) {
    return fallbackParseFile(filePath, code);
  }
  const root = tree.rootNode;
  const imports = [];
  const exports = [];
  const declarations = [];

  function getSignature(node, name = 'default') {
    if (node.type === 'function_declaration' || node.type === 'method_definition') {
      const params = node.childForFieldName('parameters');
      return `${name}${params ? params.text : '()'}`;
    }
    if (node.type === 'class_declaration') {
      let sig = `class ${name}`;
      const body = node.childForFieldName('body');
      if (body) {
        const methods = [];
        for (let i = 0; i < body.childCount; i++) {
          const child = body.child(i);
          if (child.type === 'method_definition') {
            const mName = child.childForFieldName('name');
            const mParams = child.childForFieldName('parameters');
            if (mName) {
              methods.push(`  ${mName.text}${mParams ? mParams.text : '()'}`);
            }
          }
        }
        if (methods.length > 0) {
          sig += ` {\n${methods.join('\n')}\n}`;
        }
      }
      return sig;
    }
    return name;
  }

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
        const name = nameNode ? nameNode.text : 'default';
        const signature = getSignature(decNode, name);
        exports.push({ file: filePath, name, kind: decNode.type, line: nameNode ? nameNode.startPosition.row + 1 : node.startPosition.row + 1, signature });
      }
      const sourceNode = node.childForFieldName('source');
      if (sourceNode) {
        exports.push({ file: filePath, name: 're-export', kind: 'reexport', module: sourceNode.text.slice(1, -1), line: node.startPosition.row + 1, signature: `re-export from ${sourceNode.text}` });
      }
    }

    // Declarations (only if not already exported)
    if (['function_declaration','class_declaration','variable_declarator'].includes(node.type)) {
      const parent = node.parent;
      if (parent && parent.type !== 'export_statement') {
        const nameNode = node.childForFieldName('name');
        if (nameNode) {
          const signature = getSignature(node, nameNode.text);
          declarations.push({ file: filePath, name: nameNode.text, kind: node.type.replace('_declaration',''), line: node.startPosition.row + 1, signature });
        }
      }
    }

    for (let i = 0; i < node.childCount; i++) walk(node.child(i));
  }

  walk(root);
  return { imports, exports, declarations };
}

function fallbackParseFile(filePath, code) {
  const imports = [];
  const exports = [];
  const declarations = [];
  const lines = code.split(/\r?\n/);

  const addDeclaration = (name, kind, line, signature = name) => {
    if (!name) return;
    declarations.push({ file: filePath, name, kind, line, signature });
  };

  for (let i = 0; i < lines.length; i++) {
    const lineNo = i + 1;
    const line = lines[i];

    let m = line.match(/\brequire\(\s*['"]([^'"]+)['"]\s*\)/);
    if (m) imports.push({ file: filePath, module: m[1], names: [], isDefault: false });

    m = line.match(/^\s*import\s+(.+?)\s+from\s+['"]([^'"]+)['"]/);
    if (m) {
      imports.push({
        file: filePath,
        module: m[2],
        names: m[1].replace(/[{}]/g, '').split(',').map(s => s.trim()).filter(Boolean),
        isDefault: !m[1].trim().startsWith('{'),
      });
    }

    m = line.match(/^\s*(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*(\([^)]*\))/);
    if (m) addDeclaration(m[1], 'function', lineNo, `${m[1]}${m[2]}`);

    m = line.match(/^\s*class\s+([A-Za-z_$][\w$]*)/);
    if (m) addDeclaration(m[1], 'class', lineNo, `class ${m[1]}`);

    m = line.match(/^\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/);
    if (m) addDeclaration(m[1], 'variable_declarator', lineNo, m[1]);

    m = line.match(/^\s*module\.exports\s*=\s*\{([^}]*)/);
    if (m) {
      for (const name of m[1].split(',').map(s => s.trim()).filter(Boolean)) {
        const clean = name.split(':')[0].trim();
        exports.push({ file: filePath, name: clean, kind: 'commonjs', line: lineNo, signature: clean });
      }
    }

    m = line.match(/^\s*exports\.([A-Za-z_$][\w$]*)\s*=/);
    if (m) exports.push({ file: filePath, name: m[1], kind: 'commonjs', line: lineNo, signature: m[1] });
  }

  return { imports, exports, declarations };
}

module.exports = { parseFile };
